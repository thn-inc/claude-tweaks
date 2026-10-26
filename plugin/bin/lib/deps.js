#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function has(cmd) {
  // This code can only ever execute while a Node process is already
  // running, so shelling out to `node --version` to answer "is node
  // present" spawns a subprocess purely to re-derive a fact this process
  // already knows for free — the same principle detectVersionManager()
  // below already applies to the node *path* via process.execPath.
  if (cmd === 'node') return true;
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', windowsHide: true });
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
  const execPath = process.execPath;
  if (execPath.includes('/.nvm/') || execPath.includes('/.fnm/') || execPath.includes('/.volta/') || execPath.includes('/.n/')) {
    return execPath.includes('.nvm') ? 'nvm' : execPath.includes('.fnm') ? 'fnm' : execPath.includes('.volta') ? 'volta' : 'n';
  }
  return null;
}

// Pure PATH scan, no subprocess. `platform` is a parameter (not read from
// process) because path.delimiter reflects the host, not a simulated win32.
// A falsy `cwd` skips the project-local node_modules/.bin and scans PATH only.
function findOnPath(name, { env, platform, cwd }) {
  const win = platform === 'win32';
  const rawPath = env.PATH || env.Path || '';
  const localBin = cwd ? [path.join(cwd, 'node_modules', '.bin')] : [];
  const dirs = [...localBin, ...rawPath.split(win ? ';' : path.delimiter)].filter(Boolean);
  const names = [name];
  if (win) {
    for (const ext of (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)) {
      // Lowercase first, then the given case: PATHEXT is conventionally
      // upper-case but npm shims are `name.cmd`, so a case-sensitive
      // filesystem still finds them (and a case-insensitive one reports the
      // conventional lowercase spelling).
      names.push(name + ext.toLowerCase());
      if (ext !== ext.toLowerCase()) names.push(name + ext);
    }
  }
  for (const dir of dirs) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile() && (win || (st.mode & 0o111))) return candidate;
      } catch {
        // not present / unreadable — keep scanning
      }
    }
  }
  return null;
}

// process.cwd() throws when the cwd was deleted (e.g. a reaped worktree); one throw here would
// drop every message collect() returns, so a missing cwd degrades to a PATH-only lookup.
function safeCwd() {
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

function playwrightCliMessage() {
  // A PATH scan, not `npx --no-install playwright-cli --version`: npx boots a
  // whole npm CLI on every SessionStart (~2 CPU-seconds, 30s+ under load).
  const installed = findOnPath('playwright-cli', {
    env: process.env,
    platform: process.platform,
    cwd: safeCwd(),
  }) !== null;
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
  // The package manager only feeds an install hint, so it is probed only once something is
  // missing — `brew --version` on every SessionStart costs as much as the npx probe did.
  const missing = ['node', 'git'].filter((dep) => !has(dep));
  const pm = missing.length ? detectPackageManager() : null;
  const msgs = missing.map((dep) => missingMessage(dep, pm, dep === 'node' ? detectVersionManager() : null));
  const pw = playwrightCliMessage();
  if (pw) msgs.push(pw);
  return msgs;
}

function main() {
  for (const m of collect()) process.stdout.write(m + '\n');
}

if (require.main === module) main();

module.exports = { has, detectPackageManager, detectVersionManager, installCommand, findOnPath, playwrightCliMessage, collect, main };
