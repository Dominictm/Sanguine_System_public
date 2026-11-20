'use strict';
// Пути встроенного провайдера llama.cpp (спека doc/design/archive/llamacpp-local-provider/spec.md §2.3).
// Всё живёт в <проект>/LLM/ — вне git, релиза и бэкапа. LLAMACPP_ROOT и
// LLAMACPP_SERVER_BIN переопределяют пути в тестах (фейковый llama-server на Node).

const path = require('path');
const fsp  = require('fs').promises;
const fs   = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

const llmRoot    = () => process.env.LLAMACPP_ROOT || path.join(PROJECT_ROOT, 'LLM');
const binDir     = () => path.join(llmRoot(), 'llama.cpp');
const modelsDir  = () => path.join(llmRoot(), 'models');
const configPath = () => path.join(llmRoot(), 'llamacpp.json');
const pidPath    = () => path.join(llmRoot(), '.pid');
const stagingDir = () => path.join(llmRoot(), '.staging');
const installInfoPath = () => path.join(binDir(), 'install.json');
const serverBin  = () => process.env.LLAMACPP_SERVER_BIN || path.join(binDir(), 'llama-server.exe');

const platformOk = () => process.platform === 'win32' || process.env.LLAMACPP_ANY_OS === '1';

// С фейковым бинарём (тесты) «установлено» = есть install.json, иначе — сам exe.
function isInstalled() {
  const probe = process.env.LLAMACPP_SERVER_BIN ? installInfoPath() : serverBin();
  try { return fs.statSync(probe).isFile(); } catch { return false; }
}

async function ensureDirs() {
  await fsp.mkdir(modelsDir(), { recursive: true });
}

// spawn-команда для бинаря: фейковый сервер в тестах — .js под текущим Node.
function serverCommand(args) {
  const bin = serverBin();
  return bin.endsWith('.js')
    ? { cmd: process.execPath, args: [bin, ...args] }
    : { cmd: bin, args };
}

module.exports = {
  PROJECT_ROOT, llmRoot, binDir, modelsDir, configPath, pidPath, stagingDir, installInfoPath,
  serverBin, serverCommand, platformOk, isInstalled, ensureDirs,
};
