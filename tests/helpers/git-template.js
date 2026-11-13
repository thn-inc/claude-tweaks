'use strict';
// Template-copy git fixtures (#5297).
//
// Measured: the suite spent thousands of git processes per run rebuilding the
// same throwaway repos test after test (init, clone, config, commit, push). A
// fixture is now built once per test process, and every caller gets an
// `fs.cpSync` copy of it — a copy starts zero git processes.
//
// What makes a byte copy a working repo: git records absolute paths in a few
// plain-text files, and those are the only things that tie a copy to the
// template. `rewriteTemplatePaths` edits exactly those — every `config` inside
// a `.git` dir or a bare repo dir (remote urls, core.worktree), every
// `.git/worktrees/*/gitdir`, and every `.git` file (a linked worktree's
// pointer) — in each spelling git or the OS may have written (raw, realpath,
// Windows 8.3-expanded `realpath.native`; native, forward-slash and
// git-config-escaped `\\` forms). A spelling that survives throws, so a missed
// one fails the test loudly instead of silently sharing the template's state.
//
// Timestamps are deliberately NOT preserved: copied files get fresh mtimes,
// newer than the copied index, so git treats every entry as racily clean and
// re-verifies content instead of trusting a stat cache that describes the
// template's inodes.

const fs = require('fs');
const os = require('os');
const path = require('path');

let templateRoot = null;
let templateSeq = 0;
const cache = new Map(); // key -> { dirs: {name: path}, froms: string[] }

function root() {
  if (templateRoot) return templateRoot;
  templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-template-'));
  process.on('exit', () => {
    try { fs.rmSync(templateRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  return templateRoot;
}

const fwd = (p) => p.replace(/\\/g, '/');
const esc = (p) => p.replace(/\\/g, '\\\\');
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every spelling of `from` that may appear on disk, each paired with `to`
// rendered in the same style. Longest first so alternation never prefers a
// shorter prefix.
function spellings(from, to) {
  const bases = new Set([from]);
  for (const real of [fs.realpathSync, fs.realpathSync.native]) {
    try { bases.add(real(from)); } catch { /* from need not exist */ }
  }
  const out = new Map();
  for (const base of bases) {
    out.set(base, to);
    out.set(fwd(base), fwd(to));
    out.set(esc(base), esc(to));
  }
  return out;
}

// A path spelling counts only as a whole path: not glued onto a longer name on
// either side (`/T/tpl-1` must not match `/T/tpl-10/o`).
function matcher(froms, tos) {
  const map = new Map();
  froms.forEach((f, i) => { for (const [s, t] of spellings(f, tos ? tos[i] : f)) map.set(s, t); });
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(reEscape);
  if (!alts.length) return { map, re: null };
  return { map, re: new RegExp(`(?<![\\w.~-])(?:${alts.join('|')})(?=[\\\\/"'\\s]|$)`, 'gm') };
}

function isGitDirLike(dir) {
  if (path.basename(dir) === '.git') return true;
  try {
    return fs.statSync(path.join(dir, 'HEAD')).isFile()
      && fs.statSync(path.join(dir, 'objects')).isDirectory()
      && fs.statSync(path.join(dir, 'refs')).isDirectory();
  } catch { return false; }
}

// The git path-bearing files under `dir`.
function pathFiles(dir, out = []) {
  const gitDir = isGitDirLike(dir);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (gitDir && (ent.name === 'objects' || ent.name === 'refs' || ent.name === 'logs')) continue;
      pathFiles(full, out);
    } else if (ent.isFile()) {
      if (ent.name === '.git') out.push(full);
      else if (ent.name === 'config' && gitDir) out.push(full);
      else if (ent.name === 'gitdir' && path.basename(path.dirname(dir)) === 'worktrees') out.push(full);
    }
  }
  return out;
}

function assertNoTemplatePaths(rootDir, froms) {
  const { re } = matcher(froms);
  if (!re) return;
  for (const file of pathFiles(rootDir)) {
    re.lastIndex = 0;
    if (re.test(fs.readFileSync(file, 'utf8'))) {
      throw new Error(`git-template: template path survived rewrite in ${file}`);
    }
  }
}

function rewriteTemplatePaths(rootDir, mapping) {
  const froms = mapping.map(([f]) => f);
  const { map, re } = matcher(froms, mapping.map(([, t]) => t));
  if (!re) return;
  for (const file of pathFiles(rootDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(re, (m) => map.get(m));
    if (next !== text) fs.writeFileSync(file, next);
  }
  assertNoTemplatePaths(rootDir, froms);
}

function fromTemplateSet(key, build, layout) {
  const names = Object.keys(layout);
  let tpl = cache.get(key);
  if (!tpl) {
    const base = fs.mkdtempSync(path.join(root(), `t${templateSeq++}-`));
    const dirs = {};
    try {
      for (const n of names) {
        dirs[n] = path.join(base, n);
        fs.mkdirSync(dirs[n]);
      }
      build(dirs);
    } catch (err) {
      fs.rmSync(base, { recursive: true, force: true });
      throw err;
    }
    tpl = { dirs };
    cache.set(key, tpl);
  }
  const out = {};
  const mapping = [];
  try {
    for (const n of names) {
      const { parent = os.tmpdir(), prefix, realpath = false } = layout[n];
      let dir = fs.mkdtempSync(path.join(parent, prefix));
      out[n] = dir;
      fs.cpSync(tpl.dirs[n], dir, { recursive: true, preserveTimestamps: false, verbatimSymlinks: true });
      if (realpath) out[n] = dir = fs.realpathSync(dir);
      mapping.push([tpl.dirs[n], dir]);
    }
    for (const n of names) rewriteTemplatePaths(out[n], mapping);
  } catch (err) {
    for (const d of Object.values(out)) fs.rmSync(d, { recursive: true, force: true });
    throw err;
  }
  return out;
}

function fromTemplate(key, build, { parent, prefix, realpath = false }) {
  return fromTemplateSet(key, (dirs) => build(dirs.dir), { dir: { parent, prefix, realpath } }).dir;
}

// A push into a local bare origin runs git-receive-pack, which starts
// `maintenance run --auto` afterwards. git's local transport strips
// GIT_CONFIG_* from that side, so only the origin's own config can stop it.
function disableReceiveAutoGc(bareDir) {
  fs.appendFileSync(path.join(bareDir, 'config'), '[receive]\n\tautogc = false\n');
}

module.exports = { fromTemplate, fromTemplateSet, rewriteTemplatePaths, assertNoTemplatePaths, disableReceiveAutoGc };
