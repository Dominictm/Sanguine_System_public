'use strict';
// Воркфлоу генерации персонажей через локальный ComfyUI.
// Покрывает все ручные итерации: txt2img, InstantID-лицо, LoRA, refine-проход, акцент на кисти.
//
// Использование:
//   node tools/generate_character.js --prompt-file=char.json [--model=main|alt]
//     [--size=1023x1537] [--ref=face.png] [--identity=0.8]
//     [--pose=standing|pose.png] [--pose-strength=0.85]
//     [--lora="SDXL 1.0\\style\\Oil_painting.safetensors"] [--lora-strength=0.8]
//     [--hands] [--refine=0.35] [--seed=N] [--out=DIR] [--dry-run]
//
// char.json: { "blocks": ["...", "..."], "negative": "..." }
//   или { "positive": "...", "negative": "..." }.
// --ref: референс лица (локальный путь — сам копируется в ComfyUI/input).
//   Лицо ставится через InstantIDAttentionPatch (только identity, без заморозки
//   компоновки — в отличие от полного ApplyInstantID и от img2img).
// --hands: добавляет в промт упор на анатомию кистей + делает refine-проход.
//   Честная оговорка: глобальный low-denoise проход дефект кистей обычно НЕ чинит
//   (при denoise ~0.35 выход 1:1 повторяет вход вместе с дефектом — проверено
//   16.10.2026). Упрямые кисти — только маскированный инпейнт вручную в UI ComfyUI.
// Подробнее — doc/design/2026-10-16-library-art-models.md (модели).

const fs = require('fs');
const path = require('path');
const os = require('os');

const COMFY_HOST = 'http://127.0.0.1:8188';
const COMFY_DIR = process.env.COMFY_DIR || 'D:\\ComfyUI';
const MODELS = {
  main: 'Illustrious\\base model\\illustriousRealism_ilXL10V40.safetensors',
  alt: 'SDXL 1.0\\photography\\zavychromaxl_v100.safetensors',
};
const INSTANTID_MODEL = 'ip-adapter.bin';
const POSE_CN_DEFAULT = 'xinsirControlnetOpenposeSDXL.safetensors';
const HANDS_SUFFIX = 'perfect anatomically correct hands with five natural fingers on each hand';

function parseArgs(argv) {
  const a = {};
  for (const x of argv) {
    const m = x.match(/^--([^=]+)(=(.*))?$/);
    if (m) a[m[1]] = m[3] === undefined ? true : m[3];
  }
  return a;
}

function usage() {
  console.log('Usage: node tools/generate_character.js --prompt-file=char.json [options]');
  console.log('  --model=main|alt|<ckpt path>  (default: main)');
  console.log('  --size=WxH                    (default: 1023x1537)');
  console.log('  --ref=face.png                (InstantID face reference, local path ok)');
  console.log('  --identity=0.8                (InstantID attention weight, default 0.8)');
  console.log('  --pose=standing|pose.png      (ControlNet OpenPose skeleton)');
  console.log('  --pose-strength=0.85');
  console.log('  --lora="<lora path>"          (backslashes, as in /object_info)');
  console.log('  --lora-strength=0.8');
  console.log('  --hands                       (hand anatomy emphasis + refine pass)');
  console.log('  --refine=0.35                 (second img2img pass denoise; default with --hands)');
  console.log('  --seed=N --out=DIR --prefix=NAME --dry-run');
}

async function comfyUp() {
  try {
    const r = await fetch(COMFY_HOST + '/system_stats', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function submitWorkflow(workflow, tag) {
  const clientId = 'sanguine-char-' + tag + '-' + Date.now();
  const res = await fetch(COMFY_HOST + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const data = await res.json();
  if (data.error) throw new Error('ComfyUI queue error: ' + JSON.stringify(data.error));
  return data.prompt_id;
}

async function waitResult(promptId) {
  for (let i = 0; i < 480; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const hData = await (await fetch(COMFY_HOST + '/history/' + promptId)).json();
    const h = hData[promptId];
    if (h && h.status && h.status.completed) {
      const imgs = [];
      for (const [, node] of Object.entries(h.outputs || {})) {
        for (const img of (node.images || [])) imgs.push(img.filename);
      }
      if (!imgs.length) throw new Error('No images in completed output');
      return path.join(COMFY_DIR, 'output', imgs[0]);
    }
    if (h && h.status && h.status.status_str === 'error') {
      throw new Error('Generation error: ' + JSON.stringify(h.status));
    }
  }
  throw new Error('Timeout waiting for ComfyUI generation');
}

// ckpt — путь чекпоинта (уже резолвлен); lora — имя из /object_info (обратные слэши).
// Возвращает { modelOut, clipOut, extraNodes } для вставки в workflow.
function styleChain(ckpt, lora, loraStrength) {
  if (!lora) return { modelOut: ['4', 0], clipOut: ['4', 1], extraNodes: {} };
  return {
    modelOut: ['10', 0],
    clipOut: ['10', 1],
    extraNodes: {
      10: { class_type: 'LoraLoader', inputs: {
        lora_name: lora, strength_model: loraStrength, strength_clip: loraStrength,
        model: ['4', 0], clip: ['4', 1],
      } },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompt-file'] || args.help) { usage(); process.exit(args.help ? 0 : 1); }

  const spec = JSON.parse(fs.readFileSync(args['prompt-file'], 'utf8'));
  let positive = spec.positive || (spec.blocks || []).join(', ');
  if (!positive) throw new Error('prompt-file must contain "positive" or "blocks"');
  const negative = spec.negative || '';
  if (args.hands) positive += ', ' + HANDS_SUFFIX;

  const modelRaw = String(args.model || 'main');
  const ckpt = MODELS[modelRaw] || modelRaw;
  const [w, h] = String(args.size || '1023x1537').split('x').map(Number);
  if (!w || !h) throw new Error('Bad --size, want WxH');
  const seed = args.seed !== undefined ? Number(args.seed) : Math.floor(Math.random() * 1e9);
  const outDir = args.out || path.join(os.tmpdir(), 'opencode');
  const prefix = args.prefix || 'sanguine_char';
  const lora = args.lora || null;
  const loraStrength = Number(args['lora-strength'] || 0.8);

  // Референс лица: локальный файл — копируем в ComfyUI/input.
  let refName = null;
  if (args.ref) {
    if (path.isAbsolute(args.ref) || fs.existsSync(args.ref)) {
      refName = 'char_ref_' + Date.now() + path.extname(args.ref);
      fs.copyFileSync(args.ref, path.join(COMFY_DIR, 'input', refName));
    } else {
      refName = args.ref; // уже лежит в ComfyUI/input
    }
  }
  const identity = Number(args.identity || 0.8);
  const useIdentity = !!refName;

  // Поза: пресет standing (рисуем скелет под холст) или свой файл скелета.
  // Скелет кладём в ComfyUI/input, т.к. LoadImage читает только оттуда.
  const { execFileSync } = require('child_process');
  let poseName = null;
  if (args.pose) {
    if (args.pose === 'standing') {
      poseName = `pose_standing_${w}x${h}.png`;
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'pose_skeleton.ps1'),
        '-Preset', 'standing', '-Width', String(w), '-Height', String(h),
        '-Out', path.join(COMFY_DIR, 'input', poseName)]);
    } else if (path.isAbsolute(args.pose) || fs.existsSync(args.pose)) {
      poseName = 'char_pose_' + Date.now() + path.extname(args.pose);
      fs.copyFileSync(args.pose, path.join(COMFY_DIR, 'input', poseName));
    } else {
      poseName = args.pose; // уже лежит в ComfyUI/input
    }
  }
  const poseStrength = Number(args['pose-strength'] || 0.85);
  const poseCn = args['pose-cn'] || POSE_CN_DEFAULT;

  const { modelOut, clipOut, extraNodes } = styleChain(ckpt, lora, loraStrength);

  const stamp = Date.now();
  const base = {
    3: { class_type: 'KSampler', inputs: {
      seed, steps: 32, cfg: 6.5,
      sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1.0,
      model: modelOut, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: clipOut } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: clipOut } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: prefix + '_' + stamp, images: ['8', 0] } },
    ...extraNodes,
  };
  if (useIdentity) {
    Object.assign(base, {
      11: { class_type: 'LoadImage', inputs: { image: refName } },
      20: { class_type: 'InstantIDModelLoader', inputs: { instantid_file: INSTANTID_MODEL } },
      21: { class_type: 'InstantIDFaceAnalysis', inputs: { provider: 'CUDA' } },
      23: { class_type: 'InstantIDAttentionPatch', inputs: {
        instantid: ['20', 0], insightface: ['21', 0],
        image: ['11', 0], model: modelOut,
        weight: identity, start_at: 0.0, end_at: 1.0, noise: 0.0,
      } },
    });
    base[3].inputs.model = ['23', 0];
  }
  if (poseName) {
    // ControlNet OpenPose поверх conditioning (модель уже с InstantID-патчем —
    // порядок: поза правит компоновку, identity — лицо).
    Object.assign(base, {
      24: { class_type: 'ControlNetLoader', inputs: { control_net_name: poseCn } },
      26: { class_type: 'LoadImage', inputs: { image: poseName } },
      30: { class_type: 'ControlNetApply', inputs: {
        conditioning: ['6', 0], control_net: ['24', 0], image: ['26', 0], strength: poseStrength,
      } },
      31: { class_type: 'ControlNetApply', inputs: {
        conditioning: ['7', 0], control_net: ['24', 0], image: ['26', 0], strength: poseStrength,
      } },
    });
    base[3].inputs.positive = ['30', 0];
    base[3].inputs.negative = ['31', 0];
  }

  if (args['dry-run']) {
    console.log(JSON.stringify({
      ckpt, size: [w, h], seed, ref: refName, identity: useIdentity ? identity : null,
      pose: poseName, poseStrength: poseName ? poseStrength : null,
      lora, positive: positive.slice(0, 120) + '…', stages: args.hands || args.refine ? 2 : 1,
    }, null, 1));
    return;
  }

  if (!await comfyUp()) throw new Error('ComfyUI is down at ' + COMFY_HOST);

  console.log('stage 1/2: base txt2img' + (useIdentity ? ' + InstantID face' : '') + ' ...');
  const id1 = await submitWorkflow(base, 'base');
  console.log('queued:', id1);
  const out1 = await waitResult(id1);
  fs.mkdirSync(outDir, { recursive: true });
  const dst1 = path.join(outDir, path.basename(out1));
  fs.copyFileSync(out1, dst1);
  console.log('saved:', dst1);

  const refineDenoise = args.refine !== undefined ? Number(args.refine) : (args.hands ? 0.35 : null);
  if (refineDenoise) {
    console.log(`stage 2/2: img2img refine (denoise ${refineDenoise}) ...`);
    // LoadImage читает из ComfyUI/input — кладём туда копию результата стадии 1.
    const refineName = 'char_refine_' + stamp + '.png';
    fs.copyFileSync(out1, path.join(COMFY_DIR, 'input', refineName));
    console.log(`stage 2/2: img2img refine (denoise ${refineDenoise}) ...`);
    const w2 = {
      3: { class_type: 'KSampler', inputs: {
        seed: Math.floor(Math.random() * 1e9), steps: 32, cfg: 6.5,
        sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: refineDenoise,
        model: modelOut, positive: ['6', 0], negative: ['7', 0], latent_image: ['12', 0],
      } },
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      6: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: clipOut } },
      7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: clipOut } },
      8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      9: { class_type: 'SaveImage', inputs: { filename_prefix: prefix + '_refine_' + stamp, images: ['8', 0] } },
      11: { class_type: 'LoadImage', inputs: { image: refineName } },
      12: { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['4', 2] } },
      ...extraNodes,
    };
    const id2 = await submitWorkflow(w2, 'refine');
    console.log('queued:', id2);
    const out2 = await waitResult(id2);
    const dst2 = path.join(outDir, path.basename(out2));
    fs.copyFileSync(out2, dst2);
    console.log('saved:', dst2);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
