'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/log-decision');

const SCHEMA = /^- (AUTO|STAGED|KEPT-PROMPT|SCANNED|SKIP) (\d{2}:\d{2}:\d{2}) — (.+?): (.+)\. Reversibility: (high|med|low|n\/a)\.(?: \[lever: .+\])?$/;
const NOW = new Date(2026, 7, 16, 9, 5, 7).getTime();

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldcli-'));
  const main = path.join(root, 'main');
  const run = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
  fs.mkdirSync(run, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  // Realistic git shape: the main checkout has a `.git` DIRECTORY; a linked worktree has a
  // `.git` FILE carrying a gitdir: pointer. resolveTarget's structural check keys on that.
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  return { root, main, run, shadow };
}

function deps(main, out) {
  return { now: () => NOW, cwd: () => main, mainRoot: main, stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) };
}

const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');

test('appends a schema-valid AUTO line and prints it', () => {
  const { main, run: runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--spec', '12', '--status', 'AUTO', '--text', 'x'], deps(main, out));
  assert.equal(code, 0);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text, '- AUTO 09:05:07 — spec #12: x. Reversibility: n/a.\n');
  assert.match(text.trim(), SCHEMA);
  assert.equal(streamOf(out, 'out'), text);
});

test('--section places the entry under the heading; --lever/--reversibility carried', () => {
  const { main, run: runDir } = fixture();
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# Auto-Decision Log — pipeline x\n\n## /build\n- AUTO 08:00:00 — a: b. Reversibility: high.\n## /test\n- AUTO 08:00:01 — c: d. Reversibility: high.\n');
  const code = run(['--run', runDir, '--status', 'STAGED', '--step', 'Step 3 Routing', '--text', '2 findings staged', '--reversibility', 'high', '--lever', 'review-auto-apply-ceiling=low (default)', '--section', '/build'], deps(main, []));
  assert.equal(code, 0);
  const lines = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').split('\n');
  assert.equal(lines[4], '- STAGED 09:05:07 — Step 3 Routing: 2 findings staged. Reversibility: high. [lever: review-auto-apply-ceiling=low (default)]');
  assert.equal(lines[5], '## /test');
});

test('--status SKIP appends a schema-valid degrade-trace line', () => {
  const { main, run: runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--status', 'SKIP', '--section', '/build', '--step', 'Common Step 6.5 (skipped)', '--text', 'condition: no docs/REGISTRY.md → fallback: no doc-sync check'], deps(main, out));
  assert.equal(code, 0);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text, '## /build\n- SKIP 09:05:07 — Common Step 6.5 (skipped): condition: no docs/REGISTRY.md → fallback: no doc-sync check. Reversibility: n/a.\n');
  assert.match(text.trim().split('\n').pop(), SCHEMA);
});

test('a --run inside a linked-worktree path is rejected non-zero and names the shadow', () => {
  const { main, shadow } = fixture();
  const out = [];
  const code = run(['--run', shadow, '--status', 'AUTO', '--text', 'x'], deps(main, out));
  assert.equal(code, 3);
  const err = streamOf(out, 'err');
  assert.match(err, /not anchored/);
  assert.match(err, /pipeline-run-dir\.md/);
  assert.equal(fs.existsSync(path.join(shadow, 'decisions.md')), false, 'nothing written to the shadow');
});

test("appendEntry write failure maps to exit 3 (decisions.md is a directory, not a file)", () => {
  const { main, run: runDir } = fixture();
  fs.mkdirSync(path.join(runDir, 'decisions.md'));
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--text', 'x'], deps(main, out));
  assert.equal(code, 3);
  const err = streamOf(out, 'err');
  assert.match(err, /could not write decisions\.md/);
  assert.equal(streamOf(out, 'out'), '', 'nothing printed to stdout');
});

test('malformed invocations exit 2: missing --run, bad status, empty text, missing dir exits 3', () => {
  const { main, run: runDir } = fixture();
  assert.equal(run(['--status', 'AUTO', '--text', 'x'], deps(main, [])), 2);
  assert.equal(run(['--run', runDir, '--status', 'MAYBE', '--text', 'x'], deps(main, [])), 2);
  assert.equal(run(['--run', runDir, '--status', 'AUTO', '--text', '   '], deps(main, [])), 2);
  assert.equal(run(['--run', runDir, '--status', 'AUTO', '--text', 'x', '--reversibility', 'sometimes'], deps(main, [])), 2);
  assert.equal(run(['--run', path.join(main, 'missing'), '--status', 'AUTO', '--text', 'x'], deps(main, [])), 3);
  const out = [];
  assert.equal(run(['--help'], deps(main, out)), 0);
  assert.match(out[0][1], /usage: log-decision\.js/);
  assert.match(out[0][1], /--text-file <path>/);
});

test('--text-file writes the same entry --text would, for each shell-hostile content', () => {
  for (const content of ['conflicted on "a b".md', 'conflicted on $(touch pwned) and $HOME', 'conflicted on `rm -rf x`.md and back\\slash']) {
    const viaText = fixture();
    const viaFile = fixture();
    const file = path.join(viaFile.root, 'entry.txt');
    fs.writeFileSync(file, content + '\n');
    assert.equal(run(['--run', viaText.run, '--status', 'AUTO', '--text', content], deps(viaText.main, [])), 0, content);
    assert.equal(run(['--run', viaFile.run, '--status', 'AUTO', '--text-file', file], deps(viaFile.main, [])), 0, content);
    const textEntry = fs.readFileSync(path.join(viaText.run, 'decisions.md'), 'utf8');
    const fileEntry = fs.readFileSync(path.join(viaFile.run, 'decisions.md'), 'utf8');
    assert.equal(fileEntry, textEntry, content);
    assert.ok(fileEntry.includes(content), content);
  }
});

test('--text and --text-file together exit 2 and write nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = path.join(root, 'entry.txt');
  fs.writeFileSync(file, 'x\n');
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--text', 'x', '--text-file', file], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /mutually exclusive/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--text-file with an interior line break exits 2 and writes nothing', () => {
  for (const content of ['a.md\nb.md\n', 'a.md\r\nb.md']) {
    const { main, root, run: runDir } = fixture();
    const file = path.join(root, 'entry.txt');
    fs.writeFileSync(file, content);
    const out = [];
    const code = run(['--run', runDir, '--status', 'AUTO', '--text-file', file], deps(main, out));
    assert.equal(code, 2, JSON.stringify(content));
    assert.match(streamOf(out, 'err'), /one line/);
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
  }
});

test('--text-file missing or empty exits 2 and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const missing = path.join(root, 'no-such-file.txt');
  const outMissing = [];
  assert.equal(run(['--run', runDir, '--status', 'AUTO', '--text-file', missing], deps(main, outMissing)), 2);
  assert.ok(streamOf(outMissing, 'err').includes(missing), 'the error names the missing file');
  const blank = path.join(root, 'blank.txt');
  fs.writeFileSync(blank, '  \n');
  assert.equal(run(['--run', runDir, '--status', 'AUTO', '--text-file', blank], deps(main, [])), 2);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

const reversibilityRun = (value) => {
  const { main, run: runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--text', 'pushed x to origin', '--reversibility', value], deps(main, out));
  const file = path.join(runDir, 'decisions.md');
  return { code, out, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
};

test('bare tiers still accepted unchanged: each of high|med|low|n/a renders `Reversibility: {tier}.`', () => {
  for (const tier of ['high', 'med', 'low', 'n/a']) {
    const r = reversibilityRun(tier);
    assert.equal(r.code, 0, tier);
    assert.equal(r.text, `- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: ${tier}.\n`);
    assert.match(r.text.trim(), SCHEMA);
  }
});

test('AC3.1: --reversibility "high (branch can be reset/force-pushed)" exits 0 and writes the qualifier verbatim', () => {
  const r = reversibilityRun('high (branch can be reset/force-pushed)');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: high (branch can be reset/force-pushed).\n');
});

test('AC3.2: --reversibility "bogus (x)" exits 2 and writes nothing', () => {
  const r = reversibilityRun('bogus (x)');
  assert.equal(r.code, 2);
  assert.equal(r.text, null, 'decisions.md never created');
  assert.match(streamOf(r.out, 'err'), /--reversibility must be one of high\|med\|low\|n\/a/);
});

test('AC3.3: malformed qualifier shapes exit 2 and write nothing: "high(x)", "high ()", "high (x", "high (x) trailing", and a non-single-space separator', () => {
  for (const bad of ['high(x)', 'high ()', 'high (x', 'high (x) trailing', 'high\n(x)', 'high\t(x)', 'high  (x)']) {
    const r = reversibilityRun(bad);
    assert.equal(r.code, 2, bad);
    assert.equal(r.text, null, `${bad}: decisions.md never created`);
  }
});

test('nested parentheses in the qualifier render verbatim: "low (see (a))"', () => {
  const r = reversibilityRun('low (see (a))');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: low (see (a)).\n');
});
