'use strict';
// Список моделей llama.cpp: *.gguf в LLM/models и на один уровень вглубь
// (раскладка LM Studio «автор/модель/файл.gguf»). Проекторы зрения mmproj-*
// в список не попадают, а подбираются к модели из той же папки (спека
// llamacpp-vision §2.2); у многотомных моделей показывается первый том,
// размер — сумма томов.

const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { modelsDir } = require('./paths');

const PART_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;
const MMPROJ_RE = /^mmproj.*\.gguf$/i;
const HEADER_READ = 8 * 1024 * 1024;

async function _scan(dir, rel, depth, out, projs) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (depth < 1) await _scan(abs, r, depth + 1, out, projs); continue; }
    if (!e.isFile() || !/\.gguf$/i.test(e.name)) continue;
    if (MMPROJ_RE.test(e.name)) { projs.push({ rel: r, dir: rel }); continue; }
    const st = await fsp.stat(abs).catch(() => null);
    if (st) out.push({ rel: r, abs, size: st.size, mtimeMs: st.mtimeMs });
  }
}

// ── Подбор проектора зрения (§2.2) ────────────────────────────────────────────
// В папке одна модель и один mmproj — он. Иначе — тот, чьё «ядро» имени входит
// в имя модели (самое длинное; при равенстве — по точности). Ни одного
// совпадения — проектора нет: в общей папке чужой проектор не подцепится.
const PRECISION_RE = /[-_.](f16|bf16|f32|q8_0)$/i;
const PRECISION_RANK = { f16: 0, bf16: 1, f32: 2, q8_0: 3 };

function _projCore(name) {
  return name.replace(/\.gguf$/i, '').replace(/^mmproj[-_.]?/i, '').replace(PRECISION_RE, '').toLowerCase();
}
function _projRank(name) {
  const m = name.replace(/\.gguf$/i, '').match(PRECISION_RE);
  return m ? PRECISION_RANK[m[1].toLowerCase()] : 9;
}

function pickMmproj(modelBase, projNames, modelsInDir = 1) {
  if (!projNames.length) return null;
  if (projNames.length === 1 && modelsInDir === 1) return projNames[0];
  const base = modelBase.toLowerCase();
  const hits = projNames.filter(n => { const c = _projCore(n); return c && base.includes(c); });
  if (!hits.length) return null;
  return hits.sort((a, b) => (_projCore(b).length - _projCore(a).length) || (_projRank(a) - _projRank(b)) || a.localeCompare(b))[0];
}

const _ctxCache = new Map(); // abs → { key, value }

async function list() {
  const files = [];
  const projs = [];
  await _scan(modelsDir(), '', 0, files, projs);
  const projByDir = new Map();
  for (const p of projs) {
    const arr = projByDir.get(p.dir) || [];
    arr.push(path.basename(p.rel));
    projByDir.set(p.dir, arr);
  }
  const groups = new Map();
  for (const f of files) {
    const m = f.rel.match(PART_RE);
    const key = m ? f.rel.replace(PART_RE, '') : f.rel;
    const g = groups.get(key) || { parts: [], first: null };
    g.parts.push(f);
    if (!m || m[1] === '00001') g.first = g.first || f;
    groups.set(key, g);
  }
  const dirOf = rel => { const d = path.posix.dirname(rel); return d === '.' ? '' : d; };
  const complete = [...groups.values()].filter(g => g.first); // тома без первого — неполная модель
  const modelsPerDir = new Map();
  for (const g of complete) modelsPerDir.set(dirOf(g.first.rel), (modelsPerDir.get(dirOf(g.first.rel)) || 0) + 1);
  const out = [];
  for (const g of complete) {
    const f = g.first;
    const base = path.basename(f.rel).replace(PART_RE, '').replace(/\.gguf$/i, '');
    const dir = dirOf(f.rel);
    const proj = pickMmproj(base, projByDir.get(dir) || [], modelsPerDir.get(dir));
    out.push({
      id: f.rel,
      label: base,
      sizeBytes: g.parts.reduce((s, p) => s + p.size, 0),
      parts: g.parts.length,
      trainCtx: await trainCtxCached(f),
      vision: !!proj,
      mmproj: proj ? (dir ? `${dir}/${proj}` : proj) : null,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

async function trainCtxCached(f) {
  const key = `${f.size}:${f.mtimeMs}`;
  const hit = _ctxCache.get(f.abs);
  if (hit && hit.key === key) return hit.value;
  const value = await readGgufContextLength(f.abs).catch(() => null);
  _ctxCache.set(f.abs, { key, value });
  return value;
}

/** id из списка → { abs, mmprojAbs }; только существующие модели (никаких «..\»). */
async function resolve(id) {
  if (typeof id !== 'string' || !id) return null;
  const found = (await list()).find(m => m.id === id);
  if (!found) return null;
  const toAbs = rel => path.join(modelsDir(), ...rel.split('/'));
  return { abs: toAbs(found.id), mmprojAbs: found.mmproj ? toAbs(found.mmproj) : null };
}

// ── GGUF: минимальный разбор KV-заголовка до <arch>.context_length ────────────
// Формат: 'GGUF', u32 version, u64 tensor_count, u64 kv_count, затем KV:
// string key (u64 len + bytes), u32 type, value. Ошибка/нехватка буфера → null.
const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STR: 8, ARR: 9, U64: 10, I64: 11, F64: 12 };
const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

function parseGgufContextLength(buf) {
  if (buf.length < 24 || buf.toString('latin1', 0, 4) !== 'GGUF') return null;
  const version = buf.readUInt32LE(4);
  if (version < 2) return null;
  let p = 8;
  const need = n => { if (p + n > buf.length) throw new RangeError('eof'); };
  const u64 = () => { need(8); const v = Number(buf.readBigUInt64LE(p)); p += 8; return v; };
  const u32 = () => { need(4); const v = buf.readUInt32LE(p); p += 4; return v; };
  const str = () => { const n = u64(); need(n); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const scalar = type => {
    need(SIZE[type]);
    let v;
    switch (type) {
      case T.U8: v = buf.readUInt8(p); break;   case T.I8: v = buf.readInt8(p); break;
      case T.U16: v = buf.readUInt16LE(p); break; case T.I16: v = buf.readInt16LE(p); break;
      case T.U32: v = buf.readUInt32LE(p); break; case T.I32: v = buf.readInt32LE(p); break;
      case T.F32: v = buf.readFloatLE(p); break;  case T.BOOL: v = buf.readUInt8(p) !== 0; break;
      case T.U64: v = Number(buf.readBigUInt64LE(p)); break; case T.I64: v = Number(buf.readBigInt64LE(p)); break;
      case T.F64: v = buf.readDoubleLE(p); break;
    }
    p += SIZE[type];
    return v;
  };
  const skip = type => {
    if (type === T.STR) { str(); return; }
    if (type === T.ARR) {
      const it = u32(); const n = u64();
      if (it === T.STR) { for (let i = 0; i < n; i++) str(); }
      else if (SIZE[it]) { need(SIZE[it] * n); p += SIZE[it] * n; }
      else throw new Error('nested array');
      return;
    }
    if (!SIZE[type]) throw new Error('bad type');
    need(SIZE[type]); p += SIZE[type];
  };
  try {
    u64(); // tensor_count
    const kvCount = u64();
    let arch = null;
    for (let i = 0; i < kvCount; i++) {
      const key = str();
      const type = u32();
      if (key === 'general.architecture' && type === T.STR) { arch = str(); continue; }
      if (arch && key === `${arch}.context_length` && SIZE[type]) return scalar(type);
      skip(type);
    }
  } catch { /* обрыв буфера или мусор */ }
  return null;
}

async function readGgufContextLength(abs) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(HEADER_READ);
    const { bytesRead } = await fh.read(buf, 0, HEADER_READ, 0);
    return parseGgufContextLength(buf.subarray(0, bytesRead));
  } finally { await fh.close(); }
}

module.exports = { list, resolve, pickMmproj, parseGgufContextLength, readGgufContextLength };
