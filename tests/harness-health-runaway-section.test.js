'use strict';
// #2684: harness-health check 4's runaway-section signal, stated identically
// in judge-procedure.md and _shared/harness-health-analysis.md, and the
// specific-past-failure principle in init's CLAUDE.md template.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const JUDGE = read('plugin/skills/harness-health/judge-procedure.md');
const ANALYSIS = read('plugin/skills/_shared/harness-health-analysis.md');
const TEMPLATE = read('plugin/skills/init/claude-md-template.md');

function runawayParagraphs(md) {
  const start = md.indexOf('**Runaway section**');
  assert.ok(start >= 0, 'no **Runaway section** paragraph');
  const end = md.indexOf('5. **Unscoped-rule structural check**', start);
  assert.ok(end > start, 'runaway-section text must sit inside check 4, before check 5');
  return md.slice(start, end);
}

function snippet(md) {
  const m = runawayParagraphs(md).match(/```bash\n\s*node -e '([^\n]*)' /);
  assert.ok(m, 'no node -e snippet in the runaway-section paragraph');
  return m[1];
}

test('check 4 states the runaway-section signal in both files: heading-bounded, lines and bytes, 40%, a flag for review', () => {
  for (const md of [JUDGE, ANALYSIS]) {
    const text = runawayParagraphs(md);
    assert.match(text, /Split the file at its `##` headings/);
    assert.match(text, /share of the file's lines \*\*and\*\* of its bytes/);
    assert.match(text, /exceeds \*\*40%\*\*/);
    assert.match(text, /`template-conformance` finding for review, never a hard failure/);
  }
});

test('the two copies of the signal are identical apart from each file\'s target vocabulary', () => {
  // judge-procedure.md names targets by kind (`claude-md`) and paths as
  // "{target.path}"; the shared analysis says CLAUDE.md and <target-path>.
  const norm = (md) => runawayParagraphs(md)
    .replace(/"\{target\.path\}"|<target-path>/, '<path>')
    .replace(/\((`claude-md`|CLAUDE\.md) only,/, '(<kind> only,')
    .replace(/\s+$/, '');
  assert.strictEqual(norm(JUDGE), norm(ANALYSIS));
});

test('the shipped snippet reports a runaway section and a balanced file correctly', () => {
  const code = snippet(JUDGE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-runaway-'));
  const lines = (n, word) => Array.from({ length: n }, (_, i) => `${word} ${i}`).join('\n');

  const runaway = path.join(dir, 'runaway.md');
  fs.writeFileSync(runaway, `# P\n\n## Small\n${lines(5, 'a')}\n## Big\n${lines(40, 'b')}\n\`\`\`\n## not a heading\n\`\`\`\n## Tail\n${lines(5, 'c')}\n`);
  const out = execFileSync(process.execPath, ['-e', code, runaway], { encoding: 'utf8' });
  const big = out.split('\n').find((l) => l.endsWith('## Big'));
  assert.ok(big, out);
  assert.ok(Number(big.split('%')[0]) > 40, big);
  assert.ok(!out.includes('## not a heading'), 'a heading inside a code fence must not split a section');

  const repoOut = execFileSync(process.execPath, ['-e', code, path.join(ROOT, 'CLAUDE.md')], { encoding: 'utf8' });
  for (const line of repoOut.trim().split('\n')) {
    const [linePct, bytePct] = line.match(/\d+(?=%)/g).map(Number);
    assert.ok(linePct <= 40 && bytePct <= 40, `this repo's own CLAUDE.md must not flag: ${line}`);
  }
});

test('the shipped snippet skips files under 50 lines and files with fewer than two ## sections', () => {
  const code = snippet(ANALYSIS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-runaway-skip-'));
  const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const cases = {
    'short.md': [`# T\n## A\n${body(10)}\n## B\n${body(10)}\n`, 'skip: under 50 lines'],
    'headingless.md': [`# T\n${body(60)}\n`, 'skip: fewer than two ## sections'],
    'one-section.md': [`# T\n## Only\n${body(60)}\n`, 'skip: fewer than two ## sections'],
    'empty.md': ['', 'skip: under 50 lines'],
  };
  for (const [name, [content, expected]] of Object.entries(cases)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    assert.strictEqual(execFileSync(process.execPath, ['-e', code, file], { encoding: 'utf8' }).trim(), expected, name);
  }
  assert.match(runawayParagraphs(JUDGE), /prints `skip: …` instead of shares/);
});

test('the always-loaded budget default is still 150', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'plugin/bin/resolve-policy.js'), 'harness-health-always-loaded-budget'], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'hh-policy-')), encoding: 'utf8' });
  const resolved = JSON.parse(out)['harness-health-always-loaded-budget'];
  assert.deepStrictEqual(resolved, { value: 150, source: 'default' });
});

test('init CLAUDE.md template states the specific-past-failure principle and cites its sources', () => {
  assert.match(TEMPLATE, /\*\*Each rule names a specific past failure, not a vague preference\*\*/);
  assert.match(TEMPLATE, /"The new rules of context engineering for Claude 5 generation models"/);
  assert.match(TEMPLATE, /"A global CLAUDE\.md and its best pieces"/);
});
