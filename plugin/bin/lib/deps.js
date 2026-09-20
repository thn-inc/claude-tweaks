#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');

function has(cmd) {
  // This code can only ever execute while a Node process is already
  // running, so shelling out to `node --version` to answer "is node
  // present" spawns a subprocess purely to re-derive a fact this process
  // already knows for free — the same principle detectVersionManager()
  // below already applies to the node *path* via process.execPath.
  if (cmd === 'node') return true;
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager() {
  const platform = os.platform();
  if (platform === 'darwin') {
    if (has('brew')) return { name: 'brew', needsSudo: false };
  }
  if (platform === 'win32') {
    if (has('winget')) return { name: 'winget', needsSudo: false };
    if (has('scoop')) return { name: 'scoop', needsSudo: false };
  }
  if (platform === 'linux') {
    if (has('apt')) return { name: 'apt', needsSudo: true };
    if (has('dnf')) return { name: 'dnf', needsSudo: true };
    if (has('pacman')) return { name: 'pacman', needsSudo: true };
  }
  return null;
}

function installCommand(pm, dep) {
  const map = {
    brew: { node: 'brew install node', git: 'brew install git' },
    winget: { node: 'winget install OpenJS.NodeJS', git: 'winget install Git.Git' },
    scoop: { node: 'scoop install nodejs', git: 'scoop install git' },
    apt: { node: 'sudo apt install -y nodejs', git: 'sudo apt install -y git' },
    dnf: { node: 'sudo dnf install -y nodejs', git: 'sudo dnf install -y git' },
    pacman: { node: 'sudo pacman -S --noconfirm nodejs', git: 'sudo pacman -S --noconfirm git' },
  };
  return map[pm.name]?.[dep];
}

function detectVersionManager() {
  // process.execPath is the currently-running node binary's own path — no
  // subprocess needed, unlike shelling out to `which node` to re-derive
  // the same answer this process already has for free.
  const path = process.execPath;
  if (path.includes('/.nvm/') || path.includes('/.fnm/') || path.includes('/.volta/') || path.includes('/.n/')) {
    return path.includes('.nvm') ? 'nvm' : path.includes('.fnm') ? 'fnm' : path.includes('.volta') ? 'volta' : 'n';
  }
  return null;
}

function playwrightCliMessage() {
  let installed;
  try {
    execSync('npx --no-install playwright-cli --version', { stdio: 'ignore' });
    installed = true;
  } catch {
    installed = false;
  }
  if (!installed) {
    return 'claude-tweaks: Browser features require playwright-cli. Install: npm install -g @playwright/cli. Browser features are optional.';
  }
  return null;
}

function missingMessage(dep, pm, vm) {
  const platform = os.platform();
  if (dep === 'node' && vm) {
    return `claude-tweaks: Node not found, but ${vm} is on PATH. Install Node via your version manager.`;
  }
  if (pm) {
    const cmd = installCommand(pm, dep);
    const sudoNote = pm.needsSudo ? ' (requires sudo)' : '';
    return `claude-tweaks: ${dep} not found. Install via ${pm.name}: ${cmd}${sudoNote}`;
  }
  const fallback = {
    darwin: { node: 'https://nodejs.org/ or `xcode-select --install` then install brew', git: 'https://git-scm.com/ or `xcode-select --install`' },
    win32: { node: 'https://nodejs.org/ or install winget/scoop first', git: 'https://git-scm.com/' },
    linux: { node: 'use your distro package manager', git: 'use your distro package manager' },
  };
  const url = fallback[platform]?.[dep] || `install ${dep}`;
  return `claude-tweaks: ${dep} not found. Install: ${url}`;
}

function collect() {
  const pm = detectPackageManager();
  const vm = detectVersionManager();
  const msgs = [];
  if (!has('node')) msgs.push(missingMessage('node', pm, vm));
  if (!has('git')) msgs.push(missingMessage('git', pm, null));
  const pw = playwrightCliMessage();
  if (pw) msgs.push(pw);
  return msgs;
}

function main() {
  for (const m of collect()) process.stdout.write(m + '\n');
}

if (require.main === module) main();

module.exports = { has, detectPackageManager, detectVersionManager, installCommand, collect, main };
