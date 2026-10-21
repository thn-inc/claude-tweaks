// tests/load-delta-cli.test.js — bin/load-delta.js (#3307), the CLI over
// bin/lib/skill-audit/load.js that review step 3j runs. Exercised through
// the run(argv, deps) seam against throwaway git repos, plus one run against
// this repo (AC12).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { run, renderText } = require('../plugin/bin/load-delta');
const { readText } = require('./helpers/read-skill');

const REPO = path.join(__dirname, '..');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

// A repo with one commit on main, recorded as origin/main, then optional head edits.
function makeRepo(baseFiles, { origin = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-delta-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  for (const [rel, text] of Object.entries(baseFiles)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  if (origin) git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}

// Default mock resolver matches the branch every makeRepo() repo records as
// origin/main (resolveIntegrationBranch's real default would spawn
// `git rev-parse --abbrev-ref origin/HEAD`, which these throwaway repos never
// set up). A test exercising the genuinely-unresolved or a different-branch
// path overrides it via `extra`.
function call(argv, cwd, extra = {}) {
  const out = { stdout: '', stderr: '' };
  const code = run(argv, {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
    cwd,
    resolveIntegrationBranch: () => 'main',
    ...extra,
  });
  return { code, ...out };
}

const POINTER = 'Read `part.md` in this skill\'s directory.';

// Spies for deps.git / deps.gitBatch that still shell out for real (so the
// rest of the CLI behaves exactly as it would unspied) while recording every
// call's argv — used to prove base .md reads go through one cat-file
// --batch process per root rather than one git show per file (ledger row 16).
function spyGit(cwd, calls) {
  return (args) => {
    calls.push(args);
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
  };
}
function spyGitBatch(cwd, calls) {
  return (args, input) => {
    calls.push(args);
    return execFileSync('git', args, {
      cwd, input, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
  };
}

test('A: base .md reads are served from one git cat-file --batch process per root, never a git show per file (ledger row 16)', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'Read `a.md` in this skill\'s directory.\n',
    'plugin/skills/s/a.md': 'leaf\n',
  });
  write(dir, 'plugin/skills/s/SKILL.md', 'Read `a.md` in this skill\'s directory.\nchanged\n');
  const gitCalls = [];
  const gitBatchCalls = [];
  const r = call(['--json'], dir, { git: spyGit(dir, gitCalls), gitBatch: spyGitBatch(dir, gitBatchCalls) });
  assert.strictEqual(r.code, 0, r.stderr);
  const showCalls = gitCalls.filter((a) => a.includes('show'));
  assert.deepStrictEqual(showCalls, [], 'no per-file git show calls for base .md reads');
  assert.strictEqual(gitBatchCalls.length, 1, 'exactly one cat-file --batch process for the single root');
  assert.deepStrictEqual(gitBatchCalls[0].slice(-2), ['cat-file', '--batch']);
});

test('B1: a root present at base and deleted (committed) at head reports its entries with removed: true (ledger row 17)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'hello world\n' });
  fs.rmSync(path.join(dir, 'plugin'), { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'delete plugin root');
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.status, 'ok');
  const root = j.roots.find((x) => x.pluginRoot === 'plugin');
  assert.ok(root, JSON.stringify(j.roots));
  assert.deepStrictEqual(root.entries, [
    { entry: 'plugin:s', floor: 0, dFloor: -12, closure: 0, dClosure: -12, newUnresolved: [], removed: true },
  ]);
});

test('B2: a root whose SKILL.md is deleted in the working tree only (still indexed) exits 0, not 1, and reports it removed (ledger row 17)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'hello world\n' });
  fs.rmSync(path.join(dir, 'plugin', 'skills'), { recursive: true }); // uncommitted — still tracked
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const root = j.roots.find((x) => x.pluginRoot === 'plugin');
  assert.ok(root, JSON.stringify(j.roots));
  assert.deepStrictEqual(root.entries.map((e) => [e.entry, e.removed]), [['plugin:s', true]]);
});

test('ok: a committed move-not-cut split reports one changed entry against the merge-base', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': `${'a'.repeat(19999)}\n` });
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'plugin/skills/s/SKILL.md', `${'a'.repeat(9999)}\n${POINTER}\n`);
  write(dir, 'plugin/skills/s/part.md', `${'a'.repeat(9999)}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'split');
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.status, 'ok');
  assert.strictEqual(j.base, baseSha);
  assert.deepStrictEqual(j.roots.map((x) => x.pluginRoot), ['plugin']);
  const [row] = j.roots[0].entries;
  assert.strictEqual(row.entry, 'plugin:s');
  assert.strictEqual(row.dClosure, Buffer.byteLength(POINTER) + 1);
});

test('rule (f): a bare-name citation of another skill\'s file joins the closure at head and base', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'see `other-part.md`\n',
    'plugin/skills/t/SKILL.md': 't\n',
    'plugin/skills/t/other-part.md': `${'x'.repeat(100)}\n`,
  });
  const appended = 'one more line\n';
  fs.appendFileSync(path.join(dir, 'plugin/skills/t/other-part.md'), appended);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'grow other-part');
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const row = j.roots[0].entries.find((e) => e.entry === 'plugin:s');
  assert.ok(row, JSON.stringify(j.roots[0].entries));
  assert.strictEqual(row.dClosure, Buffer.byteLength(appended));
});

test('no-baseline: integration branch unresolved still exits 0 with absolute loads, never a zero delta or a guessed main (F2)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'hello\n' }, { origin: false });
  const r = call(['--json'], dir, { resolveIntegrationBranch: () => null });
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual([j.status, j.base], ['no-baseline', null]);
  const [row] = j.roots[0].entries;
  assert.deepStrictEqual([row.entry, row.floor, row.closure], ['plugin:s', 6, 6]);
  assert.strictEqual('dFloor' in row, false);
  const text = call([], dir, { resolveIntegrationBranch: () => null });
  assert.strictEqual(text.stdout, 'Skill load delta: no baseline (integration branch unresolved — pass --integration-branch) — skipped\n');
});

test('no-baseline: a branch resolved but merge-base fails keeps the existing "{ref} unresolved" line (F2)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'hello\n' }); // only origin/main exists
  const text = call([], dir, { resolveIntegrationBranch: () => 'release' });
  assert.strictEqual(text.stdout, 'Skill load delta: no baseline (merge-base with origin/release unresolved) — skipped\n');
});

test('--integration-branch overrides the resolver, accepting both "name" and "origin/name" (F2)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'plugin/skills/s/SKILL.md', 'xyz\n');
  for (const branchArg of ['main', 'origin/main']) {
    const j = JSON.parse(call(['--integration-branch', branchArg, '--json'], dir, { resolveIntegrationBranch: () => { throw new Error('must not be called'); } }).stdout);
    assert.deepStrictEqual([j.status, j.base], ['ok', baseSha]);
  }
  const text = call(['--integration-branch', 'main'], dir, { resolveIntegrationBranch: () => { throw new Error('must not be called'); } }).stdout;
  assert.match(text, /^Skill load delta \(base [0-9a-f]{7} = merge-base with origin\/main\):\n/);
});

test('an explicit --base that does not resolve exits 2 naming the ref', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  const r = call(['--base', 'no-such-ref', '--json'], dir);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /--base no-such-ref does not resolve to a commit/);
});

test('an explicit --base is used as given', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' }, { origin: false });
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'plugin/skills/s/SKILL.md', 'xyz\n');
  const j = JSON.parse(call(['--base', baseSha, '--json'], dir).stdout);
  assert.deepStrictEqual([j.status, j.base, j.roots[0].entries[0].dFloor], ['ok', baseSha, 2]);
  const text = call(['--base', baseSha], dir).stdout;
  assert.match(text, new RegExp(`^Skill load delta \\(base ${baseSha.slice(0, 7)} = --base ${baseSha}\\):\\n`));
});

test('a --plugin-root with no skills/ exits 3 with corpusDir\'s message', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'docs/readme.md': 'd\n' });
  const r = call(['--plugin-root', 'docs'], dir);
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /not a plugin root: no skills\/ directory beneath it/);
});

test('--plugin-root accepts an in-repo directory literally named "..foo" — not a traversal (ledger row 14)', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', '..foo/skills/x/SKILL.md': 'z\n' });
  const r = call(['--plugin-root', '..foo', '--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual(j.roots.map((x) => x.pluginRoot), ['..foo']);
});

test('malformed invocations exit 2', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  assert.strictEqual(call(['--bogus'], dir).code, 2);
  assert.strictEqual(call(['--base'], dir).code, 2);
  assert.strictEqual(call(['--plugin-root'], dir).code, 2);
});

test('discovery skips fixture trees deeper than one directory', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'x\n',
    '.claude/skills/t/SKILL.md': 'y\n',
    'evals/fixtures/repo/skills/u/SKILL.md': 'z\n',
  });
  const j = JSON.parse(call(['--json'], dir).stdout);
  assert.deepStrictEqual(j.roots.map((x) => x.pluginRoot), ['.claude', 'plugin']);
});

test('F1: no plugin roots discovered (deep skill layout) names the parent and --plugin-root still measures it', () => {
  const dir = makeRepo({
    'plugins/foo/skills/s/SKILL.md': 'Read `part.md` in this skill\'s directory.\n',
    'plugins/foo/skills/s/part.md': 'old\n',
  });
  write(dir, 'plugins/foo/skills/s/part.md', 'new, longer than old\n');
  const j = JSON.parse(call(['--json'], dir).stdout);
  assert.deepStrictEqual(j.roots, []);
  assert.strictEqual(j.status, 'ok');
  const text = call([], dir).stdout;
  assert.strictEqual(
    text,
    'Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>) — skill files changed under plugins/foo\n'
  );
  const scoped = call(['--plugin-root', 'plugins/foo'], dir).stdout;
  assert.match(scoped, /^Skill load delta \(base [0-9a-f]{7} = merge-base with origin\/main\):\n/);
  // Full repo-relative root path, not just its basename (ledger row 18): a
  // depth-2 explicit --plugin-root names its entry "plugins/foo:s", never
  // the collision-prone "foo:s".
  assert.match(scoped, /\| plugins\/foo:s \|/);
});

test('F1: roots discovered but none moved, with a changed skill file outside any discovered root, routes to outcome 2 with a suffix', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'x\n',
    'plugins/foo/skills/t/SKILL.md': 'y\n',
    'plugins/foo/skills/t/orphan.md': 'o\n',
  });
  write(dir, 'plugins/foo/skills/t/orphan.md', 'orphan, uncited, changed\n');
  const out = call([], dir).stdout;
  assert.strictEqual(
    out,
    'Skill load delta: skill files changed, no entry point\'s load moved (also changed outside discovered roots: plugins/foo; pass --plugin-root to measure)\n'
  );
});

test('F3: a non-ASCII path cited at base and unchanged at head produces no phantom delta', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'Read `café.md` in this skill\'s directory.\n',
    'plugin/skills/s/café.md': 'accent\n',
  });
  const out = call([], dir).stdout;
  assert.strictEqual(out, 'Skill load delta: no skill files changed — skipped\n');
});

test('F4: an untracked uncited skill file routes to outcome 2, not outcome 1', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  write(dir, 'plugin/skills/s/new-orphan.md', 'never committed, never cited\n');
  const out = call([], dir).stdout;
  assert.strictEqual(out, 'Skill load delta: skill files changed, no entry point\'s load moved\n');
});

test('F5: --plugin-root outside the repository (with a real skills/ beneath it) exits 2 naming the reason', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'load-delta-outside-'));
  write(outside, 'skills/t/SKILL.md', 'z\n');
  const r = call(['--plugin-root', outside], dir);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /is outside the repository/);
});

test('a cited symlink to a file outside the repository is never read into the closure', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'Read `x.md` in this skill\'s directory.\n' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'load-delta-outside-'));
  write(outside, 'secret.md', 'o'.repeat(5000));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'plugin/skills/s/x.md'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'symlink');
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).roots[0].entries, []);
});

test('text outcome 1: a diff touching no skill file', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'README.md': 'r\n' });
  write(dir, 'README.md', 'changed\n');
  assert.strictEqual(call([], dir).stdout, 'Skill load delta: no skill files changed — skipped\n');
});

test('text outcome 2: skill files changed but no entry point moved', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'plugin/skills/s/orphan.md': 'o\n' });
  write(dir, 'plugin/skills/s/orphan.md', 'orphan, not cited by anything\n');
  assert.strictEqual(call([], dir).stdout, 'Skill load delta: skill files changed, no entry point\'s load moved\n');
});

test('text outcome: a committed rename (git mv) out of the skills tree still counts as touched, since the CLI diffs --no-renames (ledger row 15)', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'x\n',
    'plugin/skills/s/orphan.md': 'uncited content, long enough for git to pair it as a rename by similarity\n',
  });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  git(dir, 'mv', 'plugin/skills/s/orphan.md', 'docs/orphan.md');
  git(dir, 'commit', '-q', '-m', 'move orphan.md out of the skills tree');
  // Default rename detection would report only the new path (docs/orphan.md)
  // for a pure rename, hiding that a skills/ file disappeared; --no-renames
  // reports both the old and new path, so this is never silently outcome 1.
  assert.strictEqual(call([], dir).stdout, 'Skill load delta: skill files changed, no entry point\'s load moved\n');
});

test('text outcome 3: a table with added/removed markers and signed deltas', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'plugin/skills/gone/SKILL.md': 'bye\n' });
  write(dir, 'plugin/skills/s/SKILL.md', 'x\n`missing.md`\n');
  fs.rmSync(path.join(dir, 'plugin/skills/gone'), { recursive: true });
  const out = call([], dir).stdout;
  assert.match(out, /^Skill load delta \(base [0-9a-f]{7} = merge-base with origin\/main\):\n/);
  assert.match(out, /\| Entry \| Floor \| ΔFloor \| Closure \| ΔClosure \| New unresolved \|/);
  assert.match(out, /\| plugin:gone \(removed\) \| 0 \| -4 \| 0 \| -4 \| — \|/);
  assert.match(out, /\| plugin:s \| 15 \| \+13 \| 15 \| \+13 \| 1: `missing\.md` \|/);
});

test('AC1.1/AC1.2/AC2.1: a _shared edit moving 4 entries by one ΔClosure renders one grouped row; a different delta stays its own row; --json is per-entry and unchanged', () => {
  const CITE = 'Read `_shared/x.md`.\n';
  const dir = makeRepo({
    'plugin/skills/_shared/x.md': 'shared\n',
    'plugin/skills/a/SKILL.md': CITE,
    'plugin/skills/b/SKILL.md': `${CITE}b\n`,
    'plugin/skills/c/SKILL.md': `${CITE}cc\n`,
    'plugin/skills/e/SKILL.md': `${CITE}eee\n`,
    'plugin/skills/d/SKILL.md': `${CITE}Read \`part.md\` in this skill's directory.\n`,
    'plugin/skills/d/part.md': 'p\n',
  });
  fs.appendFileSync(path.join(dir, 'plugin/skills/_shared/x.md'), 'one added row\n');
  fs.appendFileSync(path.join(dir, 'plugin/skills/d/part.md'), 'more\n');
  const lines = call([], dir).stdout.split('\n');
  const sep = lines.indexOf('|---|---|---|---|---|---|');
  assert.deepStrictEqual(lines.slice(sep + 1), [
    '| 4 entries: plugin:a, plugin:b, plugin:c, … +1 more | 21–25 | 0 | 42–46 | +14 | — |',
    '| plugin:d | 63 | 0 | 91 | +19 | — |',
    '',
  ]);
  const j = JSON.parse(call(['--json'], dir).stdout);
  assert.deepStrictEqual(j.roots[0].entries, [
    { entry: 'plugin:a', floor: 21, dFloor: 0, closure: 42, dClosure: 14, newUnresolved: [] },
    { entry: 'plugin:b', floor: 23, dFloor: 0, closure: 44, dClosure: 14, newUnresolved: [] },
    { entry: 'plugin:c', floor: 24, dFloor: 0, closure: 45, dClosure: 14, newUnresolved: [] },
    { entry: 'plugin:d', floor: 63, dFloor: 0, closure: 91, dClosure: 19, newUnresolved: [] },
    { entry: 'plugin:e', floor: 25, dFloor: 0, closure: 46, dClosure: 14, newUnresolved: [] },
  ]);
});

test('renderText groups by mark, deltas and new-unresolved; a pair groups; equal floors render one value', () => {
  const result = {
    status: 'ok', base: 'a'.repeat(40), baseKind: 'base', baseLabel: 'r',
    roots: [{ pluginRoot: 'plugin', entries: [
      { entry: 'p:a', floor: 10, dFloor: 0, closure: 50, dClosure: 5, newUnresolved: [] },
      { entry: 'p:b', floor: 10, dFloor: 0, closure: 60, dClosure: 5, newUnresolved: [] },
      { entry: 'p:c', floor: 10, dFloor: 0, closure: 70, dClosure: 5, newUnresolved: [{ citingFile: 'plugin/skills/c/SKILL.md', token: 'gone.md' }] },
      { entry: 'p:d', floor: 5, dFloor: 5, closure: 5, dClosure: 5, newUnresolved: [], added: true },
      { entry: 'p:e', floor: 5, dFloor: 5, closure: 5, dClosure: 5, newUnresolved: [] },
      { entry: 'p:f', floor: 20, dFloor: 0, closure: 30, dClosure: 9, newUnresolved: [] },
      { entry: 'p:g', floor: 20, dFloor: 0, closure: 31, dClosure: 9, newUnresolved: [] },
      { entry: 'p:h', floor: 21, dFloor: 0, closure: 32, dClosure: 9, newUnresolved: [] },
    ] }],
  };
  const lines = renderText(result, []).split('\n');
  const sep = lines.indexOf('|---|---|---|---|---|---|');
  assert.deepStrictEqual(lines.slice(sep + 1), [
    '| 2 entries: p:a, p:b | 10 | 0 | 50–60 | +5 | — |',
    '| p:c | 10 | 0 | 70 | +5 | 1: `gone.md` |',
    '| p:d (added) | 5 | +5 | 5 | +5 | — |',
    '| p:e | 5 | +5 | 5 | +5 | — |',
    '| 3 entries: p:f, p:g, p:h | 20–21 | 0 | 30–32 | +9 | — |',
    '',
  ]);
});

test('AC12: this repo — exits 0 and lists both the plugin and .claude roots', () => {
  const r = call(['--json'], REPO);
  assert.strictEqual(r.code, 0, r.stderr);
  const roots = JSON.parse(r.stdout).roots.map((x) => x.pluginRoot);
  assert.ok(roots.includes('plugin') && roots.includes('.claude'), JSON.stringify(roots));
});

const REVIEW = path.join(REPO, 'plugin', 'skills', 'review');

test('review 3j pointer: at most 4 lines, cites step3-skill-load-delta.md', () => {
  const text = readText(path.join(REVIEW, 'code-mode-steps.md'));
  const start = text.indexOf('### 3j: Skill Load Delta (informational)');
  assert.ok(start !== -1, '3j heading missing');
  const end = text.indexOf('\n### ', start + 1);
  const block = text.slice(start, end).replace(/\n+$/, '');
  assert.ok(block.split('\n').length <= 4, `3j block is ${block.split('\n').length} lines`);
  assert.match(block, /`step3-skill-load-delta\.md`/);
  assert.ok(start > text.indexOf('### 3i: Documentation Freshness'), '3j must follow 3i');
});

test('step3-skill-load-delta.md quotes every outcome line the CLI prints, verbatim', () => {
  const doc = readText(path.join(REVIEW, 'step3-skill-load-delta.md'));
  for (const line of [
    'Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>)',
    '— skill files changed under {parent}',
    'Skill load delta: no skill files changed — skipped',
    'Skill load delta: skill files changed, no entry point\'s load moved',
    '(also changed outside discovered roots: {parent}; pass --plugin-root to measure)',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
    '{count} entries: {e1}, {e2}, {e3}, … +{k} more',
    'Skill load delta (base {sha} = merge-base with origin/{name}):',
    'Skill load delta (base {sha} = --base {ref}):',
    'Skill load delta: no baseline (integration branch unresolved — pass --integration-branch) — skipped',
    'Skill load delta: no baseline (merge-base with {ref} unresolved) — skipped',
    'Skill load delta: not run — ',
    '--integration-branch',
  ]) assert.ok(doc.includes(line), `missing: ${line}`);
  assert.match(doc, /\/bin\/load-delta\.js/);
  assert.match(doc, /never changes the verdict/i);
});

test('review summary template carries the Skill Load Delta section and a compact-form line', () => {
  const t = readText(path.join(REVIEW, 'review-summary-template.md'));
  const full = t.slice(t.indexOf('## Full template'));
  assert.match(full, /### Skill Load Delta\n/);
  const compact = t.slice(t.indexOf('## Compact form'), t.indexOf('## Full template'));
  assert.match(compact, /\*\*Skill load delta:\*\*/);
});
