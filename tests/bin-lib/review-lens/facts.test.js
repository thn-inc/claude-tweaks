'use strict';
// plugin/bin/lib/review-lens/facts.js (#6001): named per-diff facts, computed from real git.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { committedRepo } = require('../../helpers/git-fixtures');
const { computeFacts, classifyPathKind, isExecutableProseLine, FACT_NAMES } = require('../../../plugin/bin/lib/review-lens/facts');

const lines = (...l) => `${l.join('\n')}\n`;

// base: {path: content}; head: {path: content | null (delete)}; renames: [[from, to]] applied before head writes.
function diffRepo(base, head, { renames = [] } = {}) {
  const repo = committedRepo({ prefix: 'ct-facts-' });
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(repo.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, rel), content);
  };
  for (const [rel, content] of Object.entries(base)) put(rel, content);
  repo.git('add', '.');
  repo.git('commit', '-q', '--allow-empty', '-m', 'base');
  const baseSha = repo.git('rev-parse', 'HEAD');
  for (const [from, to] of renames) {
    fs.mkdirSync(path.dirname(path.join(repo.dir, to)), { recursive: true });
    repo.git('mv', from, to);
  }
  for (const [rel, content] of Object.entries(head)) {
    if (content === null) fs.rmSync(path.join(repo.dir, rel));
    else put(rel, content);
  }
  repo.git('add', '-A');
  repo.git('commit', '-q', '--allow-empty', '-m', 'head');
  return { ...repo, base: baseSha };
}

const OFF = { controlMode: false, pathGlobs: {}, globsInvalid: false };

function factsOf(base, head, opts = {}, extra = {}) {
  const r = diffRepo(base, head, opts);
  const out = computeFacts({ cwd: r.dir, base: r.base, riskPolicy: OFF, ...extra });
  assert.strictEqual(out.ok, true, JSON.stringify(out));
  return out.facts;
}

test('AC10.1: low-tier executable-content fact matches step3-tier-variants.md', () => {
  const proseBase = lines('# T', '', '```', 'code', '```', 'tail');
  const cases = [
    ['a prose-only diff', { 'docs/a.md': lines('# T', 'one') }, { 'docs/a.md': lines('# T', 'one', 'two') }, false],
    ['an added line inside a fence opened before the hunk', { 'docs/a.md': proseBase },
      { 'docs/a.md': lines('# T', '', '```', 'code', 'more', '```', 'tail') }, true],
    ['an added node -e', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'Run `node -e "x"` now') }, true],
    ['an added git line', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'git status') }, true],
    ['an added gh line', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'gh pr view 1') }, true],
    ['a plain-text file', { 'notes.txt': 'a\n' }, { 'notes.txt': 'a\nb\n' }, false],
    ['a changed js file', { 'a.js': '1;\n' }, { 'a.js': '2;\n' }, true],
    ['a changed json config', { 'c.json': '{}\n' }, { 'c.json': '{"a":1}\n' }, true],
    ['a deleted line that sat inside a fence', { 'docs/a.md': proseBase },
      { 'docs/a.md': lines('# T', '', '```', '```', 'tail') }, true],
    ['a deleted git line', { 'docs/a.md': lines('# T', 'git status', 'end') }, { 'docs/a.md': lines('# T', 'end') }, true],
    ['a list-nested fenced line that is not itself a command', { 'docs/a.md': lines('- step', '    ```bash', '    ls', '    ```') },
      { 'docs/a.md': lines('- step', '    ```bash', '    ls -la', '    ```') }, true],
    ['a column-0 fence holding an indented fence line stays open', { 'docs/a.md': lines('# T', '```', '    ```bash', '    x', '    ```', 'plain', '```', 'tail') },
      { 'docs/a.md': lines('# T', '```', '    ```bash', '    x', '    ```', 'plain edit', '```', 'tail') }, true],
    ['a closer indented 2 spaces still closes a column-0 fence', { 'docs/a.md': lines('# T', '```', 'code', '  ```', 'plain') },
      { 'docs/a.md': lines('# T', '```', 'code', '  ```', 'plain edit') }, false],
    ['a tab-indented fence line is content: a tab reaches column 4, past a column-0 opener\'s closer limit', { 'docs/a.md': lines('# T', '```', 'code', '\t```', 'plain') },
      { 'docs/a.md': lines('# T', '```', 'code', '\t```', 'plain edit') }, true],
    ['an added line inside a fence of a CRLF file', { 'docs/a.md': '# T\r\n```\r\ncode\r\n```\r\ntail\r\n' },
      { 'docs/a.md': '# T\r\n```\r\ncode\r\nmore\r\n```\r\ntail\r\n' }, true],
    ['a pwsh command', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'pwsh -File x.ps1') }, true],
    ['a node script command', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --local` first') }, true],
    ['a leading node command', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'node bin/x.js --y') }, true],
    ['a python3 command', { 'docs/a.md': lines('# T') }, { 'docs/a.md': lines('# T', 'Use `python3 x.py` here') }, true],
    ['a deleted plain line', { 'docs/a.md': lines('# T', 'words', 'end') }, { 'docs/a.md': lines('# T', 'end') }, false],
  ];
  for (const [name, base, head, want] of cases) {
    assert.strictEqual(factsOf(base, head).executableContent, want, name);
  }
});

test('an interHunkContext git config does not change the facts (the explicit flag wins); a patch that still carries context lines keeps line numbers right', () => {
  const r = diffRepo({ 'docs/a.md': lines('l1', 'l2', 'l3', 'l4', '```', 'code', '```') },
    { 'docs/a.md': lines('l1', 'L2', 'l3', 'l4', '```', 'code', 'more', '```') });
  const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.interHunkContext', GIT_CONFIG_VALUE_0: '5' };
  const git = (args) => execFileSync('git', ['-C', r.dir, ...args], { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  const out = computeFacts({ cwd: r.dir, base: r.base, riskPolicy: OFF, git });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.facts.executableContent, true);
  // The parser alone: a patch that still carries context lines (flag ignored) keeps line numbers right.
  const patch = ['diff --git a/docs/a.md b/docs/a.md', '@@ -2,5 +2,6 @@', ' l2', '-x', '+L2', ' l4', ' ```', ' code', '+more', ' ```'].join('\n');
  const fake = (args) => (args.includes('--name-status') ? 'M\0docs/a.md\0' : args[0] === 'show' ? lines('l1', 'l2', 'l3', 'l4', '```', 'code', 'more', '```') : patch);
  const parsed = computeFacts({ cwd: '.', base: 'b', riskPolicy: OFF, git: fake });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.facts.executableContent, true);
});

test('classifies path kinds', () => {
  assert.strictEqual(classifyPathKind('README.md'), 'prose');
  assert.strictEqual(classifyPathKind('a/b.txt'), 'prose');
  assert.strictEqual(classifyPathKind('plugin/bin/x.js'), 'source');
  assert.strictEqual(classifyPathKind('tests/x.test.js'), 'test');
  assert.strictEqual(classifyPathKind('src/a.test.ts'), 'test');
  assert.strictEqual(classifyPathKind('.github/workflows/ci.yml'), 'workflow');
  assert.strictEqual(classifyPathKind('plugin/x.json'), 'config');
  assert.strictEqual(classifyPathKind('a.yml'), 'config');
});

test('a rename reports its new path; a delete reports D and adds no lines', () => {
  const f = factsOf({ 'old.md': lines('a', 'b', 'c', 'd'), 'gone.md': 'x\n' }, { 'gone.md': null }, { renames: [['old.md', 'docs/new.md']] });
  const byPath = Object.fromEntries(f.paths.map((p) => [p.path, p]));
  assert.strictEqual(byPath['docs/new.md'].status, 'R');
  assert.strictEqual(byPath['docs/new.md'].kind, 'prose');
  assert.strictEqual(byPath['gone.md'].status, 'D');
  assert.ok(!('old.md' in byPath));
  assert.strictEqual(f.executableContent, false);
  assert.strictEqual(f.shellInvocationAdded, false);
});

test('AC2.2 facts: git call inside a per-file loop in plugin/bin sets loopSpawn and perCallPath stays false outside hooks', () => {
  const f = factsOf({}, { 'plugin/bin/lib/x.js': lines('for (const f of files) {', "  execFileSync('git', ['log', f]);", '}') });
  assert.strictEqual(f.loopSpawn, true);
  assert.strictEqual(f.shellInvocationAdded, true);
  assert.strictEqual(f.perCallPath, false);
});

test('loopSpawn reads a CRLF source file the same way', () => {
  const crlf = (...l) => `${l.join('\r\n')}\r\n`;
  const loop = (...body) => crlf('function a() {', '  for (const f of files) {', ...body, '  }', '}');
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': loop('    work(f);') },
    { 'plugin/bin/lib/x.js': loop('    work(f);', "    execFileSync('git', ['log', f]);") }).loopSpawn, true);
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': crlf('function a() {', '  for (const f of files) {', '    work(f);', '  }', '}') },
    { 'plugin/bin/lib/x.js': crlf('function a() {', '  for (const f of files) {', '    work(f);', '  }', "  execFileSync('git', ['log']);", '}') }).loopSpawn, false);
});

test('loopSpawn when a spawn is added inside an existing loop, and the converse', () => {
  const loop = (...body) => lines('function a() {', '  for (const f of files) {', ...body, '  }', '}');
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': loop('    work(f);') },
    { 'plugin/bin/lib/x.js': loop('    work(f);', "    execFileSync('git', ['log', f]);") }).loopSpawn, true);
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': lines('function a() {', "  execFileSync('git', ['log']);", '}') },
    { 'plugin/bin/lib/x.js': lines('function a() {', '  for (const f of files) {', "    execFileSync('git', ['log']);", '  }', '}') }).loopSpawn, true);
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': lines('for (const f of files) {', '  work(f);', '}', 'function a() {', '}') },
    { 'plugin/bin/lib/x.js': lines('for (const f of files) {', '  work(f);', '}', 'function a() {', "  execFileSync('git', ['log']);", '}') }).loopSpawn, false);
  // A loop closed before a sibling-indent spawn is not an enclosing loop.
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': lines('function a() {', '  for (const f of files) {', '    work(f);', '  }', '}') },
    { 'plugin/bin/lib/x.js': lines('function a() {', '  for (const f of files) {', '    work(f);', '  }', "  execFileSync('git', ['log']);", '}') }).loopSpawn, false);
  // A loop header swapped in above an unchanged spawn line.
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': lines('function a() {', '  if (ok) {', "    execFileSync('git', ['log']);", '  }', '}') },
    { 'plugin/bin/lib/x.js': lines('function a() {', '  for (const f of files) {', "    execFileSync('git', ['log']);", '  }', '}') }).loopSpawn, true);
  // A spawn nested under an if inside an existing loop still counts.
  assert.strictEqual(factsOf({ 'plugin/bin/lib/x.js': lines('for (const f of files) {', '  if (f) {', '    work(f);', '  }', '}') },
    { 'plugin/bin/lib/x.js': lines('for (const f of files) {', '  if (f) {', '    work(f);', "    execFileSync('gh', ['x']);", '  }', '}') }).loopSpawn, true);
});

test('perCallPath for hook and runner paths', () => {
  for (const p of ['plugin/bin/lib/hooks/x.js', 'plugin/bin/hooks.js', 'tools/run-tests.js', 'plugin/bin/verify.js']) {
    assert.strictEqual(factsOf({ [p]: '1;\n' }, { [p]: '2;\n' }).perCallPath, true, p);
  }
  assert.strictEqual(factsOf({ 'docs/lib/hooks/readme.md': 'a\n' }, { 'docs/lib/hooks/readme.md': 'b\n' }).perCallPath, false);
  assert.strictEqual(factsOf({ 'plugin/bin/hooks.sh': 'a\n' }, { 'plugin/bin/hooks.sh': 'b\n' }).perCallPath, true);
  assert.strictEqual(factsOf({ 'plugin/bin/other.js': '1;\n' }, { 'plugin/bin/other.js': '2;\n' }).perCallPath, false);
});

test('riskPathTouched from protected paths, Risk-flags and risk-path-globs under control mode only (Reading A)', () => {
  const globs = { auth: ['src/auth/**'] };
  const on = { controlMode: true, pathGlobs: globs, globsInvalid: false };
  const off = { controlMode: false, pathGlobs: globs, globsInvalid: false };
  const auth = [{ 'src/auth/a.js': '1;\n' }, { 'src/auth/a.js': '2;\n' }];
  assert.strictEqual(factsOf({ 'plugin/skills/_shared/x.md': 'a\n' }, { 'plugin/skills/_shared/x.md': 'b\n' }, {}, { riskPolicy: off }).riskPathTouched, true);
  assert.strictEqual(factsOf(...auth, {}, { riskPolicy: on }).riskPathTouched, true);
  assert.strictEqual(factsOf(...auth, {}, { riskPolicy: off }).riskPathTouched, false);
  assert.strictEqual(factsOf(...auth, {}).riskPathTouched, false);
  const flagged = factsOf(...auth, {}, { riskPolicy: off, riskFlags: ['public-contract'] });
  assert.strictEqual(flagged.riskPathTouched, true);
  assert.deepStrictEqual(flagged.riskFlags, ['public-contract']);
});

test('a missing riskPolicy fails riskPathTouched', () => {
  const r = diffRepo({ 'a.js': '1;\n' }, { 'a.js': '2;\n' });
  const out = computeFacts({ cwd: r.dir, base: r.base });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.fact, 'riskPathTouched');
  assert.match(out.reason, /riskPolicy/);
});

test('a rename out of a protected path counts through its old path', () => {
  const f = factsOf({ 'plugin/skills/_shared/x.md': lines('a', 'b', 'c', 'd') }, {}, { renames: [['plugin/skills/_shared/x.md', 'docs/x.md']] });
  assert.strictEqual(f.paths[0].path, 'docs/x.md');
  assert.strictEqual(f.paths[0].status, 'R');
  assert.strictEqual(f.riskPathTouched, true);
});

test('deleting a fenced line from a renamed prose file judges the old path pre-image', () => {
  const body = lines('# T', 'intro words here', '```', 'code one', 'code two', '```', 'tail');
  const f = factsOf({ 'old.md': body }, { 'docs/new.md': lines('# T', 'intro words here', '```', 'code two', '```', 'tail') }, { renames: [['old.md', 'docs/new.md']] });
  assert.strictEqual(f.paths[0].status, 'R');
  assert.strictEqual(f.executableContent, true);
});

test('a regex .exec( is not a spawn; bare exec(, cp.exec( and child_process.exec( are', () => {
  const spawn = (line) => factsOf({ 'a.js': '1;\n' }, { 'a.js': `1;\n${line}\n` }).shellInvocationAdded;
  assert.strictEqual(spawn('const m = re.exec(x);'), false);
  assert.strictEqual(spawn("exec('ls');"), true);
  assert.strictEqual(spawn("cp.exec('ls');"), true);
  assert.strictEqual(spawn("child_process.exec('ls');"), true);
  assert.strictEqual(spawn("cp.execFileSync('ls');"), true);
  assert.strictEqual(spawn("cp.execFile('ls', cb);"), true);
});

test('newFiles/newModules', () => {
  const md = factsOf({}, { 'docs/n.md': 'a\n' });
  assert.strictEqual(md.newFiles, true);
  assert.strictEqual(md.newModules, false);
  const js = factsOf({}, { 'plugin/bin/lib/y.js': '1;\n' });
  assert.strictEqual(js.newFiles, true);
  assert.strictEqual(js.newModules, true);
  assert.strictEqual(factsOf({ 'a.js': '1;\n' }, { 'a.js': '2;\n' }).newFiles, false);
});

test('source-line facts read added lines of source files only', () => {
  const f = factsOf({ 'a.js': '1;\n' }, { 'a.js': lines('1;', 'const a = process.argv[2];', 'try { x(); } catch (e) {}') });
  assert.strictEqual(f.inputHandlingAdded, true);
  assert.strictEqual(f.errorHandlingTouched, true);
  assert.strictEqual(f.shellInvocationAdded, false);
  const doc = factsOf({ 'a.md': 'x\n' }, { 'a.md': lines('x', 'use process.argv and execFileSync here') });
  assert.strictEqual(doc.inputHandlingAdded, false);
  assert.strictEqual(doc.shellInvocationAdded, false);
  assert.strictEqual(factsOf({ 'a.js': '1;\n' }, { 'a.js': "const p = path.join('a', 'b');\n" }).inputHandlingAdded, false);
  assert.strictEqual(factsOf({ 'a.js': '1;\n' }, { 'a.js': "const p = path.join(dir, 'b');\n" }).inputHandlingAdded, true);
});

test('AC5.1: unresolvable base returns ok:false naming the fact', () => {
  const r = diffRepo({ 'a.md': 'x\n' }, { 'a.md': 'y\n' });
  const out = computeFacts({ cwd: r.dir, base: 'no-such-ref' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.fact, 'paths');
  assert.match(out.reason, /no-such-ref|unknown revision|bad revision/);
  const flag = computeFacts({ cwd: r.dir, base: '--output=x' });
  assert.strictEqual(flag.ok, false);
  assert.strictEqual(flag.fact, 'paths');
});

test('AC7.1: a single fact that throws returns ok:false', () => {
  const git = (args) => {
    if (args.includes('--name-status')) return 'M\0a.js\0';
    throw new Error('boom');
  };
  const out = computeFacts({ cwd: '.', base: 'b', git });
  assert.deepStrictEqual({ ok: out.ok, fact: out.fact }, { ok: false, fact: 'addedLines' });
  assert.match(out.reason, /boom/);

  const r = diffRepo({ 'a.js': '1;\n' }, { 'a.js': '2;\n' });
  for (const riskPolicy of [{ controlMode: true, pathGlobs: {}, globsInvalid: true }, { error: 'EACCES' }]) {
    const bad = computeFacts({ cwd: r.dir, base: r.base, riskPolicy });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.fact, 'riskPathTouched');
    assert.match(bad.reason, /risk-path-globs/);
  }
  const ok = computeFacts({ cwd: r.dir, base: r.base, riskPolicy: { controlMode: false, pathGlobs: {}, globsInvalid: true } });
  assert.strictEqual(ok.ok, true);
});

test('a patch whose sections do not match the changed paths fails addedLines', () => {
  const git = (args) => (args.includes('--name-status') ? 'M\0a.js\0M\0b.js\0' : '');
  const out = computeFacts({ cwd: '.', base: 'b', git });
  assert.deepStrictEqual({ ok: out.ok, fact: out.fact }, { ok: false, fact: 'addedLines' });
});

test('a deleted line is judged against the merge-base pre-image, not the base tip', () => {
  const r = committedRepo({ prefix: 'ct-facts-' });
  const doc = path.join(r.dir, 'a.md');
  fs.writeFileSync(doc, lines('# T', '```', 'code', '```', 'tail'));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'b0');
  const b0 = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(doc, lines('a', 'b', 'c', 'd', 'e'));
  r.git('commit', '-q', '-am', 'side');
  const side = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', '-b', 'topic', b0);
  fs.writeFileSync(doc, lines('# T', '```', '```', 'tail'));
  r.git('commit', '-q', '-am', 'topic');
  const out = computeFacts({ cwd: r.dir, base: side, head: 'topic', riskPolicy: OFF });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.facts.executableContent, true);
});

test('empty diff (base == head) is computable and all false', () => {
  const r = diffRepo({ 'a.md': 'x\n' }, {});
  const out = computeFacts({ cwd: r.dir, base: r.base, head: r.base, riskPolicy: OFF });
  assert.strictEqual(out.ok, true);
  const f = out.facts;
  assert.deepStrictEqual(f.paths, []);
  for (const k of FACT_NAMES.filter((n) => !['paths', 'kinds', 'riskFlags'].includes(n))) assert.strictEqual(f[k], false, k);
  assert.ok(Object.values(f.kinds).every((v) => v === false));
});

test('isExecutableProseLine', () => {
  for (const l of ['git status', '$ ls', 'npm test', 'Run `gh pr view 1` first', 'use node -e "1"', '  bash run.sh', 'curl http://x']) assert.strictEqual(isExecutableProseLine(l), true, l);
  for (const l of ['Git is a tool', 'plain words about nodes', '', 'the gh of it']) assert.strictEqual(isExecutableProseLine(l), false, l);
});
