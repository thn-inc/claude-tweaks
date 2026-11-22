'use strict';
// The fixture for tests/bin-lib/learned-skills/land.test.js (#5290), built once per argument set and
// copied per call (#5770): a warm call starts no git process. Moved out of the test file so the
// template build and its copy bookkeeping live beside tests/helpers/git-template.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fromTemplateSet, disableReceiveAutoGc } = require('./git-template');
const { capture } = require('../../plugin/bin/lib/learned-skills/learned-skills.js');

const X = '.claude/skills/x/SKILL.md';
const Z = '.claude/skills/z/SKILL.md';
const BODY = '# s\n\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n';
const RUN_ID = '2026-11-13T000000-spec-1';
const BRANCH = `learned-skills/${RUN_ID}`;
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const CONFLICT = '# x\n\nline one\nline two\nline three\nline four\nCHANGED five\nCHANGED six\nCHANGED seven\n';

const IDENT = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};
// The env is read per call, so a template build's maintenance-off keys and a test's GIT_TRACE2_EVENT,
// set on process.env after load, reach its git children.
function sh(cwd, args) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...IDENT }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}
// A tree file's text with its line endings as git records them (a core.autocrlf=true checkout holds CRLF).
const read = (repo, rel) => fs.readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');

// Per key: the merge base, and the template root's spellings (realpath and raw) the copy must not keep.
const built = new Map();

// Every file under dir, fs only (no git).
function filesUnder(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) filesUnder(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

// origin (bare) + a clone with main pushed, two skill files, a run dir, and one captured patch per file.
// autocrlf: 'true' pins core.autocrlf in the clone's config, a Windows checkout on any host. The
// committed files are checked out again, so the tree holds what a clone writes (CRLF under autocrlf).
// originConflict: origin's main carries one more commit, a change to X that no captured patch applies
// over (another session's push), built inside the template.
function fixture(t, { capturedTargets = [X, Z], autocrlf, originConflict = false } = {}) {
  const key = JSON.stringify([capturedTargets, autocrlf || '', originConflict]);
  const { root } = fromTemplateSet(key, (dirs) => {
    const tplReal = fs.realpathSync(dirs.root);
    const origin = path.join(tplReal, 'origin.git');
    const repo = path.join(tplReal, 'wt');
    sh(tplReal, ['init', '-q', '--bare', '-b', 'main', origin]);
    disableReceiveAutoGc(origin);
    fs.mkdirSync(repo);
    sh(repo, ['init', '-q', '-b', 'main']);
    if (autocrlf) sh(repo, ['config', 'core.autocrlf', autocrlf]);
    sh(repo, ['remote', 'add', 'origin', origin]);
    write(repo, X, BODY.replace('# s', '# x'));
    write(repo, Z, BODY.replace('# s', '# z'));
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-q', '-m', 'base']);
    for (const rel of [X, Z]) fs.rmSync(path.join(repo, rel));
    sh(repo, ['checkout', '-q', '--', '.']);
    sh(repo, ['push', '-q', 'origin', 'main']);
    const runDir = path.join(repo, '.claude-tweaks', 'pipelines', RUN_ID);
    fs.mkdirSync(runDir, { recursive: true });
    const mergeBase = sh(repo, ['rev-parse', 'HEAD']).trim();
    for (const target of capturedTargets) {
      write(repo, target, read(repo, target) + `learned: note for ${path.basename(path.dirname(target))}\n`);
      const res = capture({ runDir, worktree: repo, mergeBase, target, summary: 'adds a note' }, { now: () => NOW });
      assert.equal(res.route, 'captured');
    }
    if (originConflict) {
      const other = path.join(tplReal, 'other');
      sh(tplReal, ['clone', '-q', origin, other]);
      write(other, X, CONFLICT);
      sh(other, ['commit', '-q', '-am', 'conflicting change']);
      sh(other, ['push', '-q', 'origin', 'main']);
      fs.rmSync(other, { recursive: true, force: true });
    }
    built.set(key, { mergeBase, spellings: [...new Set([tplReal, dirs.root])] });
  }, { root: { prefix: 'ls-land-', realpath: true } });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { mergeBase, spellings } = built.get(key);
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'wt');
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', RUN_ID);
  // The manifest records each patch by absolute path: move it from the template root to this copy.
  const manifestPath = path.join(runDir, 'learned-skills', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const e of manifest) {
      const from = spellings.find((s) => e.patch.startsWith(s + path.sep));
      if (from) e.patch = root + e.patch.slice(from.length);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  for (const file of filesUnder(runDir)) {
    const bytes = fs.readFileSync(file);
    // A JSON file stores a win32 path with doubled backslashes: search the escaped form too.
    for (const s of spellings) {
      for (const form of new Set([s, JSON.stringify(s).slice(1, -1)])) {
        if (bytes.includes(form)) throw new Error(`land fixture: template root ${s} survived in ${file}`);
      }
    }
  }
  return { root, origin, repo, runDir, mergeBase, mainTip: mergeBase };
}

module.exports = { fixture, sh, write, read, X, Z, RUN_ID, BRANCH, NOW };
