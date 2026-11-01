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

test('AC1.1: --reversibility "low (divergence persists)" exits 0 and writes `Reversibility: low (divergence persists).`', () => {
  const r = reversibilityRun('low (divergence persists)');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: low (divergence persists).\n');
});

test('AC1.1: the Manifesto design-critique template value "n/a (a policy read, not a code mutation)" exits 0 and renders verbatim', () => {
  const r = reversibilityRun('n/a (a policy read, not a code mutation)');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: n/a (a policy read, not a code mutation).\n');
});

test('AC2.1: "bogus (x)" and "lowish" exit 2 with the existing usage message and write nothing', () => {
  for (const bad of ['bogus (x)', 'lowish']) {
    const r = reversibilityRun(bad);
    assert.equal(r.code, 2, bad);
    assert.equal(r.text, null, `${bad}: decisions.md never created`);
    assert.match(streamOf(r.out, 'err'), /--reversibility must be one of high\|med\|low\|n\/a, optionally followed by " \(qualifier\)"/, bad);
  }
});

const entriesFile = (root, value) => {
  const file = path.join(root, 'entries.json');
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test('--entries appends every entry in one call and echoes them', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [
    { status: 'AUTO', text: 'first', spec: 12, step: 'Step 1', reversibility: 'high' },
    { status: 'SKIP', text: 'condition: x → fallback: y', lever: 'k=v (policy)' },
    { status: 'STAGED', text: 'third.', spec: '12', reversibility: 'low (divergence persists)' },
  ]);
  const out = [];
  const code = run(['--run', runDir, '--entries', file, '--section', '/build'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text,
    '## /build\n' +
    '- AUTO 09:05:07 — spec #12 — Step 1: first. Reversibility: high.\n' +
    '- SKIP 09:05:07 — log-decision: condition: x → fallback: y. Reversibility: n/a. [lever: k=v (policy)]\n' +
    '- STAGED 09:05:07 — spec #12: third. Reversibility: low (divergence persists).\n');
  assert.equal(streamOf(out, 'out'), text.split('\n').slice(1).join('\n'));
});

test('--entries rejects a batch with one invalid entry and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'ok' }, { status: 'NOPE', text: 'x' }]);
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2);
  assert.match(streamOf(out, 'err'), /entries\[1\]/);
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--entries rejects each invalid element shape, naming its index', () => {
  const bad = [
    'not-an-object', { text: 'x' }, { status: 'AUTO' }, { status: 'AUTO', text: '  ' }, { status: 'AUTO', text: 'a\nb' },
    { status: 'AUTO', text: 'x', reversibility: 'sometimes' }, { status: 'AUTO', text: 'x', spec: 'abc' },
    { status: 'AUTO', text: 'x', step: 'a\nb' }, { status: 'AUTO', text: 'x', reversability: 'high' },
  ];
  for (const el of bad) {
    const { main, root, run: runDir } = fixture();
    const out = [];
    assert.equal(run(['--run', runDir, '--entries', entriesFile(root, [{ status: 'AUTO', text: 'ok' }, el])], deps(main, out)), 2, JSON.stringify(el));
    assert.match(streamOf(out, 'err'), /entries\[1\]/, JSON.stringify(el));
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, JSON.stringify(el));
  }
});

test('--entries with --text is a usage error', () => {
  for (const flag of [['--text', 'x'], ['--status', 'AUTO'], ['--text-file', 'f'], ['--step', 's'], ['--spec', '1'], ['--reversibility', 'high'], ['--lever', 'k=v']]) {
    const { main, root, run: runDir } = fixture();
    const out = [];
    assert.equal(run(['--run', runDir, '--entries', entriesFile(root, [{ status: 'AUTO', text: 'ok' }]), ...flag], deps(main, out)), 2, flag[0]);
    assert.match(streamOf(out, 'err'), /mutually exclusive/, flag[0]);
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, flag[0]);
  }
});

test('--entries: an element section overrides --section', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'a' }, { status: 'AUTO', text: 'b', section: '/review' }]);
  assert.equal(run(['--run', runDir, '--entries', file, '--section', '/build'], deps(main, [])), 0);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'),
    '## /build\n- AUTO 09:05:07 — log-decision: a. Reversibility: n/a.\n## /review\n- AUTO 09:05:07 — log-decision: b. Reversibility: n/a.\n');
});

test('--entries: empty array is a usage error', () => {
  const { main, root, run: runDir } = fixture();
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', entriesFile(root, [])], deps(main, out)), 2);
  assert.match(streamOf(out, 'err'), /non-empty JSON array/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});

test('--entries: a non-array, unparseable JSON, or a missing file is a usage error', () => {
  for (const [value, expected] of [['{"status":"AUTO","text":"x"}', /non-empty JSON array/], ['[{"status":', /not valid JSON/], [null, /could not read --entries .*missing\.json/]]) {
    const { main, root, run: runDir } = fixture();
    const file = value === null ? path.join(root, 'missing.json') : entriesFile(root, value);
    const out = [];
    assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2, String(value));
    assert.match(streamOf(out, 'err'), expected, String(value));
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, String(value));
  }
});

test('--entries: a run dir that is not anchored exits 3 and writes nothing', () => {
  const { main, root, shadow } = fixture();
  assert.equal(run(['--run', shadow, '--entries', entriesFile(root, [{ status: 'AUTO', text: 'ok' }])], deps(main, [])), 3);
  assert.equal(fs.existsSync(path.join(shadow, 'decisions.md')), false);
});

test('--help names the --entries form', () => {
  const out = [];
  assert.equal(run(['--help'], deps(fixture().main, out)), 0);
  assert.match(streamOf(out, 'out'), /--entries <file>/);
});

test('AC1.1: --text repeating --step exits 2 and writes nothing', () => {
  const { main, run: runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--step', 'Step 3 Routing', '--text', 'Step 3 Routing: x'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /Step 3 Routing/);
  assert.ok(streamOf(out, 'err').includes('--text repeats --step: --step "Step 3 Routing", --text "Step 3 Routing: x"'), 'stderr names the repeated --text');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--text-file holding a repeated step prefix exits 2 and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = path.join(root, 'entry.txt');
  fs.writeFileSync(file, 'Step 3 Routing: x\n');
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--step', 'Step 3 Routing', '--text-file', file], deps(main, out));
  assert.equal(code, 2);
  assert.ok(streamOf(out, 'err').includes('Step 3 Routing: x'), 'stderr names the repeated text');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--text with leading whitespace before the repeated step prefix exits 2 and writes nothing', () => {
  const { main, run: runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--status', 'AUTO', '--step', 'Step 3 Routing', '--text', '  Step 3 Routing: x'], deps(main, out));
  assert.equal(code, 2);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--entries element repeating its step exits 2, names entries[1], and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', step: 'a', text: 'ok' }, { status: 'STAGED', step: 'Step 3 Routing', text: 'Step 3 Routing: y' }]);
  const out = [];
  const code = run(['--run', runDir, '--entries', file], deps(main, out));
  assert.equal(code, 2);
  const err = streamOf(out, 'err');
  assert.match(err, /entries\[1\]/);
  assert.ok(err.includes('Step 3 Routing'), 'stderr names the step');
  assert.ok(err.includes('text repeats step: step "Step 3 Routing", text "Step 3 Routing: y"'), 'stderr names the repeated text in element-field terms');
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--entries element with leading whitespace before its repeated step prefix exits 2, names entries[1], and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'ok' }, { status: 'AUTO', step: 'Step 3 Routing', text: '  Step 3 Routing: x' }]);
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2);
  assert.ok(streamOf(out, 'err').includes('entries[1]: text repeats step: step "Step 3 Routing", text "  Step 3 Routing: x"'));
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('--entries element whose multi-line step its text repeats exits 2 on the text line-break check, not the repeat message', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'ok' }, { status: 'AUTO', step: 'Step 3\nRouting', text: 'Step 3\nRouting: x' }]);
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2);
  const err = streamOf(out, 'err');
  assert.match(err, /entries\[1\]: text must be one line/);
  assert.doesNotMatch(err, /repeats/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('AC3.1: a text mentioning the step without the colon prefix is accepted', () => {
  const { main, run: runDir } = fixture();
  const code = run(['--run', runDir, '--status', 'STAGED', '--step', 'Step 3 Routing', '--text', 'Step 3 Routing applied x'], deps(main, []));
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), '- STAGED 09:05:07 — Step 3 Routing: Step 3 Routing applied x. Reversibility: n/a.\n');
});

test('AC3.1: a step-shaped text with no --step is accepted', () => {
  const { main, run: runDir } = fixture();
  const code = run(['--run', runDir, '--status', 'AUTO', '--text', 'Step 3 Routing: x'], deps(main, []));
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), '- AUTO 09:05:07 — log-decision: Step 3 Routing: x. Reversibility: n/a.\n');
});

// #4581: the two observed aggregate reproduction lines (real decisions.md text, prefix and `. Reversibility: …` suffix removed).
const RUN_4481_TEXT = 'Reproduction: lens "3a" 10 findings not reproduced (A: journey:89 medium, test:1921 low, git-command.js:2253 low, :2433 info, journey:34 info; B: ledger:5 medium, policy-schema-coverage.md:30 medium, git-command.js:2066 low, :2475 low, :2008 low). Staged to Review Console as low-confidence; handed to the tiebreak';
const SPEC_1921_TEXT = 'Reproduction: lens "3f Test quality" 4 findings not reproduced (A only; B: no findings): cli.test.js:338 critical claim; cli.test.js:15 tmpDir never cleaned up. Staged to Review Console as low-confidence';

const refusesAggregate = (args) => {
  const { main, run: runDir } = fixture();
  const out = [];
  assert.equal(run(['--run', runDir, '--status', 'STAGED', ...args], deps(main, out)), 2);
  assert.ok(streamOf(out, 'err').includes('one line per finding'));
  assert.ok(streamOf(out, 'err').includes('(--entries writes several in one call)'));
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
};

const acceptsLine = (args, status = 'STAGED') => {
  const { main, run: runDir } = fixture();
  const out = [];
  assert.equal(run(['--run', runDir, '--status', status, ...args], deps(main, out)), 0, streamOf(out, 'err'));
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), true);
};

test('#4581: refuses the run 4481 aggregate line', () => refusesAggregate(['--step', 'Step 3', '--text', RUN_4481_TEXT]));
test('#4581: refuses the spec #1921 aggregate line', () => refusesAggregate(['--spec', '1921', '--text', SPEC_1921_TEXT]));
test('#4581: refuses the run 4481 aggregate line with its prefix inside the text', () => refusesAggregate(['--text', `Step 3: ${RUN_4481_TEXT}`]));
test('#4581: refuses the spec #1921 aggregate line with its prefix inside the text', () => refusesAggregate(['--text', `spec #1921 — ${SPEC_1921_TEXT}`]));
test('#4581: refuses an aggregate whose marker is split into --step', () => refusesAggregate(['--step', 'Reproduction', '--text', 'lens "3a" 10 findings not reproduced']));
test('#4581: refuses a marker-subject aggregate behind a step that also carries the marker', () => refusesAggregate(['--step', 'Step 3 reproduction', '--text', 'Reproduction: unconfirmed findings a/b.js:1 and c/d.js:2']));
test('#4581: refuses a lens noun phrase over a location list', () => refusesAggregate(['--text', 'Reproduction: lens "3c" findings plugin/bin/lib/worktree/remote-branch-collision.js:179 and :134 not reproduced']));
test('#4581: refuses a lens-less marker-subject aggregate', () => refusesAggregate(['--text', 'Reproduction: 26 unconfirmed single-agent findings (3a x4, 3c x4) staged at staged/review-lowconf-8.md']));
test('#4581: refuses an unquoted lens noun phrase', () => refusesAggregate(['--text', 'Reproduction: lens 3a/3f single-agent low findings (Removes-from-Source cell, incidental-wording pins) not reproduced. Stage path: staged/review-unconfirmed-1.md']));
test('#4581: refuses two lens … finding clauses in one line', () => refusesAggregate(['--text', 'Reproduction: lens 3a finding plugin/bin/lib/reconcile/index.js:412 and lens 3f finding plugin/bin/lib/reconcile/index.js:334 not reproduced']));
test('#4581: refuses a coincidence line with a shortened second location', () => refusesAggregate(['--text', 'Reproduction: lens "3a" findings plugin/bin/lib/reconcile/release-merged.js:46 / :46 share a location but not substance; both staged unconfirmed']));
test('#4581: refuses an aggregate behind a lowercase marker', () => refusesAggregate(['--text', '/review reproduction: lens "3a" findings a/b.js:1 and c/d.js:2 surfaced by one agent only']));

test('#4581: --entries refuses the run 4481 aggregate element, names entries[1], and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'ok' }, { status: 'STAGED', step: 'Step 3', text: RUN_4481_TEXT }, { status: 'STAGED', spec: '1921', text: SPEC_1921_TEXT }]);
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2);
  assert.ok(streamOf(out, 'err').includes('entries[1]: text names several findings'));
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});

test('#4581: --entries refuses the spec #1921 aggregate element on its own, names entries[2], and writes nothing', () => {
  const { main, root, run: runDir } = fixture();
  const file = entriesFile(root, [{ status: 'AUTO', text: 'ok' }, { status: 'AUTO', text: 'ok' }, { status: 'STAGED', spec: '1921', text: SPEC_1921_TEXT }]);
  const out = [];
  assert.equal(run(['--run', runDir, '--entries', file], deps(main, out)), 2);
  assert.ok(streamOf(out, 'err').includes('entries[2]: text names several findings'));
  assert.equal(streamOf(out, 'out'), '');
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false);
});

test('#4581: accepts the documented per-finding not-reproduced line', () => acceptsLine(['--text', 'Reproduction: lens "3a" finding plugin/bin/x.js:10 not reproduced. Staged to Review Console as low-confidence']));
test('#4581: accepts the documented coincidence line (lens with spaces)', () => acceptsLine(['--text', 'Reproduction: lens "3f Test quality" findings tests/a.test.js:466 / tests/a.test.js:466 share a location but not substance; both staged unconfirmed']));
test('#4581: accepts the single-read coverage line', () => acceptsLine(['--text', 'Reproduction: lens "3f" session limit twice; single-read coverage']));
test('#4581: accepts the lens 3f vacuity downgrade line', () => acceptsLine(['--text', 'Reproduction: lens "3f" vacuity finding tests/a.test.js:5 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence']));
test('#4581: accepts the coordination-form per-finding line', () => acceptsLine(['--text', '/review reproduction: lens "3a" finding plugin/x.js:3 surfaced by one agent only. Stage path: staged/review-unconfirmed-1.md']));
test('#4581: accepts a per-finding line followed by lens commentary', () => acceptsLine(['--step', 'Step 3 reproduction', '--text', 'Reproduction: lens "3b" finding plugin/bin/lib/init/release-bootstrap.js:276 not reproduced. Staged to Review Console as low-confidence. Lenses 3a, 3c, 3f: both pair agents returned No findings (6 agents)']));
test('#4581: accepts a per-finding line whose path contains "findings"', () => acceptsLine(['--text', 'Reproduction: lens "3a" finding docs/plans/2026-10-25-short-circuit-tiebreak-findings-4171-ledger.md:6 not reproduced']));
test('#4581: accept — singular finding whose path segment is "findings"', () => acceptsLine(['--text', 'Reproduction: lens "3a" finding findings/x.js:1 not reproduced']));
test('#4581: accepts an AUTO aggregate reproduction line (out of scope)', () => acceptsLine(['--text', 'Reproduction: lens "3a" 2 findings reproduced. Confirmed'], 'AUTO'));
test('#4581: accepts a non-reproduction STAGED line naming several locations', () => acceptsLine(['--step', 'Step 3 Routing', '--text', 'findings a/b.js:1 and c/d.js:2 staged to staged/review-1.patch']));
