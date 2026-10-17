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

const { run } = require('../plugin/bin/load-delta');

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
  assert.match(scoped, /\| foo:s \|/);
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

test('AC12: this repo — exits 0 and lists both the plugin and .claude roots', () => {
  const r = call(['--json'], REPO);
  assert.strictEqual(r.code, 0, r.stderr);
  const roots = JSON.parse(r.stdout).roots.map((x) => x.pluginRoot);
  assert.ok(roots.includes('plugin') && roots.includes('.claude'), JSON.stringify(roots));
});

const REVIEW = path.join(REPO, 'plugin', 'skills', 'review');

test('review 3j pointer: at most 4 lines, cites step3-skill-load-delta.md', () => {
  const text = fs.readFileSync(path.join(REVIEW, 'code-mode-steps.md'), 'utf8');
  const start = text.indexOf('### 3j: Skill Load Delta (informational)');
  assert.ok(start !== -1, '3j heading missing');
  const end = text.indexOf('\n### ', start + 1);
  const block = text.slice(start, end).replace(/\n+$/, '');
  assert.ok(block.split('\n').length <= 4, `3j block is ${block.split('\n').length} lines`);
  assert.match(block, /`step3-skill-load-delta\.md`/);
  assert.ok(start > text.indexOf('### 3i: Documentation Freshness'), '3j must follow 3i');
});

test('step3-skill-load-delta.md quotes every outcome line the CLI prints, verbatim', () => {
  const doc = fs.readFileSync(path.join(REVIEW, 'step3-skill-load-delta.md'), 'utf8');
  for (const line of [
    'Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>)',
    '— skill files changed under {parent}',
    'Skill load delta: no skill files changed — skipped',
    'Skill load delta: skill files changed, no entry point\'s load moved',
    '(also changed outside discovered roots: {parent}; pass --plugin-root to measure)',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
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
  const t = fs.readFileSync(path.join(REVIEW, 'review-summary-template.md'), 'utf8');
  const full = t.slice(t.indexOf('## Full template'));
  assert.match(full, /### Skill Load Delta\n/);
  const compact = t.slice(t.indexOf('## Compact form'), t.indexOf('## Full template'));
  assert.match(compact, /\*\*Skill load delta:\*\*/);
});
