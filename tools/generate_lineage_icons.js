'use strict';
// Батч-генерация иконок линеек WoD через локальный ComfyUI.
// Использование: node tools/generate_lineage_icons.js [--only=slug1,slug2] [--force]
//
// Отличается от generate_library_art.js только тремя вещами: шаблон промта
// заточен под чтение эмблемы на 36–44 CSS px (там филигранная рама карточек
// библиотеки превращается в кашу), результат сохраняется 256×256 и ложится в
// web/public/img/system/lineages/. Всё остальное — подъём ComfyUI, очередь,
// опрос истории, squoosh — берётся оттуда же по образцу.

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const COMFY_HOST = 'http://127.0.0.1:8188';
// Git-установка ComfyUI (D:\ComfyUI, venv) — прежняя portable-версия удалена.
const COMFY_DIR  = process.env.COMFY_DIR || 'D:\\ComfyUI';
// Чекпоинт из models/checkpoints (подпапки — через '\\', как отдаёт /object_info).
const COMFY_CKPT = process.env.COMFY_CKPT || 'Illustrious\\base model\\illustriousRealism_ilXL10V40.safetensors';
// SDXL/Illustrious обучены на ~1024×1024; ниже ~768 модель разваливает
// композицию. Генерим 1024 и уменьшаем при сохранении.
const COMFY_SIZE = parseInt(process.env.COMFY_SIZE, 10) || 1024;
// 256 покрывает 44 CSS × 2 dpr = 88 и узел графа 36 × 2 = 72 с запасом.
const ICON_SIZE  = 256;
const ROOT       = path.join(__dirname, '..');
const MANIFEST   = require('./lineage-icons-manifest.json');
const { compressPngViaSquoosh } = require('./lib/squoosh_compress');
const { resizeImage } = require('./lib/image_resize');

// Сюжет — первым и с весом: в середине длинного промта он проигрывает
// «эмблемным» токенам, и модель рисует пустой орнамент вместо символа.
//
// Формулировки подобраны опытным путём (прогон 2026-08-26): чекпоинт
// illustriousRealism реалистичный и по умолчанию рисует СЦЕНУ, а не знак —
// на «vampire fang» он выдал череп с крыльями в кинематографическом свете, на
// «wolf paw print» — морду волка. Вытягивает его только явный набор
// «flat vector pictogram / stencil / silhouette / no shading». По той же
// причине выброшено требование «поля вокруг эмблемы» из первой редакции: на
// 36px поля съедают и без того малую эмблему, знак должен заполнять кадр.
const POSITIVE_TMPL = scene => "(flat white silhouette pictogram of " + scene + ":1.6), "
  + "(pure monochrome white shape on solid black background:1.4), "
  + "minimalist app icon, stencil glyph, sign, single solid shape, "
  + "black and white only, no color, no shading, no gradient, no texture, no internal detail, "
  + "the shape fills the frame, centered, symmetrical, "
  + "extreme contrast, sharp clean edges, readable at 32 pixels";

// Три группы запретов, каждая закрывает конкретный провал предыдущего прогона:
// цвет (получали оранжевую бабочку мимо палитры), фотореализм с окружением
// (свеча в интерьере с колоннами), и существа/лица — модель охотно подменяет
// предмет его «носителем» (клык → череп, след лапы → морда волка, капюшон →
// лицо в капюшоне). Кольца и рамы запрещены отдельно: с ними mage и hunter
// вышли двумя почти одинаковыми окружностями.
// Текст — с весом и в начале: обычного «text, watermark» модели мало, она
// подписывала эмблему («th| pari» на крыле бабочки, «Fivver» внутри звезды).
const NEGATIVE = "(text:1.6), (letters:1.5), (words:1.5), typography, caption, label, lettering, "
  + "color, colorful, orange, blue, green, yellow, brown, purple, "
  + "photo, photorealistic, realistic, 3d render, cinematic lighting, depth of field, bokeh, "
  + "detailed texture, fur, hair strands, skin, shading, soft light, glow, volumetric light, gradient, "
  // Людей и руки — с весом: без этого модель подставляет «носителя» предмета
  // (глаз → лицо с глазом, стрела → рука со стрелой, капюшон → человек в худи).
  + "(human:1.5), (person:1.5), (face:1.5), (hands:1.5), (fingers:1.4), (arm:1.3), "
  + "skull, skeleton, bones, antlers, portrait, human figure, animal head, creature, "
  // Чертёжная графика: «одно высокое пламя» вышло парой пламён с размерными линиями.
  + "measurement, dimension lines, ruler, diagram, blueprint, technical drawing, "
  + "duplicate, two objects, pair, side by side, "
  + "scene, landscape, environment, room, wall, floor, table, wooden table, plate, tray, candlestick, pillars, background objects, "
  + "ornate frame, filigree border, decorated corners, medallion rim, ring border, circle border, runes, "
  + "wheel, compass, crosshair, scope, spokes, planks, wood grain, matchstick, "
  + "multiple subjects, collage, text, watermark, signature, "
  + "grey background, beige background, light background, parchment, "
  + "small subject, tiny object, large empty margin, blurry, low contrast, washed out, deformed, extra limbs";

function buildWorkflow(scene, filenamePrefix, negative = NEGATIVE) {
  return {
    "3": { "class_type": "KSampler", "inputs": {
      // cfg выше, чем у арта библиотеки (6.5): иконке нужна дословность промта,
      // а не «красивая интерпретация» — иначе модель опять уходит в сцену.
      "seed": Math.floor(Math.random() * 1e9), "steps": 32, "cfg": 8.0,
      "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
      "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
    }},
    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": COMFY_CKPT } },
    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": COMFY_SIZE, "height": COMFY_SIZE, "batch_size": 1 } },
    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": POSITIVE_TMPL(scene), "clip": ["4", 1] } },
    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": ["4", 1] } },
    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": filenamePrefix, "images": ["8", 0] } }
  };
}

async function isComfyUp() {
  try {
    const r = await fetch(COMFY_HOST + '/system_stats', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function ensureComfyRunning() {
  if (await isComfyUp()) return;
  console.log('ComfyUI not running — starting it...');
  const proc = spawn(
    path.join(COMFY_DIR, 'venv', 'Scripts', 'python.exe'),
    ['main.py'],
    { cwd: COMFY_DIR, detached: true, stdio: 'ignore' }
  );
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (await isComfyUp()) { console.log('ComfyUI ready.'); return; }
  }
  throw new Error('ComfyUI did not become ready within 60s');
}

async function generateOne(entry) {
  const clientId = 'sanguine-lineage-' + Date.now();
  // Персональный негатив на запись манифеста (поле negative) — нужен там, где
  // общий запрет мешает самому сюжету: 'unknown' по смыслу знак вопроса, а
  // текст в общем негативе задавлен с весом 1.6.
  const workflow = buildWorkflow(entry.scene, 'lineage_' + entry.slug, entry.negative || NEGATIVE);
  const res = await fetch(COMFY_HOST + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  const data = await res.json();
  if (data.error) throw new Error('ComfyUI queue error: ' + JSON.stringify(data.error));
  const promptId = data.prompt_id;

  // До ~9 минут на картинку: первая генерация включает загрузку SDXL-модели
  // в VRAM (RTX 3050), это заметно дольше самого сэмплинга.
  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const hRes = await fetch(COMFY_HOST + '/history/' + promptId);
    const hData = await hRes.json();
    const entryHist = hData[promptId];
    if (entryHist && entryHist.status && entryHist.status.completed) {
      const img = entryHist.outputs['9'].images[0];
      return path.join(COMFY_DIR, 'output', img.filename);
    }
    if (entryHist && entryHist.status && entryHist.status.status_str === 'error') {
      throw new Error('Generation error: ' + JSON.stringify(entryHist.status));
    }
  }
  throw new Error('Timeout waiting for ComfyUI generation: ' + entry.slug);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find(a => a.startsWith('--only'));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;

  await ensureComfyRunning();

  // Папка уже раздаётся статикой (express.static на web/public), новый роут не нужен.
  const destDir = path.join(ROOT, 'web', 'public', 'img', 'system', 'lineages');
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of MANIFEST) {
    if (only && !only.includes(entry.slug)) continue;
    const destPath = path.join(destDir, entry.slug + '.png');
    if (fs.existsSync(destPath) && !force) {
      console.log('skip (exists):', entry.slug);
      continue;
    }
    console.log('generating:', entry.slug, '...');
    // Ошибка одной картинки не должна ронять весь батч: логируем и идём
    // дальше, недостающие добираются повторным запуском с --only.
    try {
      const outputPath = await generateOne(entry);
      resizeImage({ src: outputPath, dst: destPath, width: ICON_SIZE, height: ICON_SIZE, format: 'png' });
      console.log('saved:', destPath);
    } catch (e) {
      console.error('  FAILED:', entry.slug, '-', e.message);
      continue;
    }

    try {
      const { originalSize, compressedSize } = await compressPngViaSquoosh(destPath);
      const pct = Math.round((1 - compressedSize / originalSize) * 100);
      console.log(`  squoosh: ${originalSize} -> ${compressedSize} bytes (-${pct}%)`);
    } catch (e) {
      console.warn('  squoosh compress failed, keeping uncompressed PNG:', e.message);
    }
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
