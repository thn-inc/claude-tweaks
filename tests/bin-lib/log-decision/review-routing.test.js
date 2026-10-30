'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/review-routing-line');
const { ALLOWED_SEVERITIES } = require('../../../plugin/bin/lib/log-decision/review-routing');
const { readText } = require('../../helpers/read-skill');

const NOW = new Date(2026, 7, 16, 9, 5, 7).getTime();
const SKILL = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'release', 'SKILL.md');
const ROUTING = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'review', 'step3-routing.md');

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrl-'));
  roots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  return { root, main, runDir, shadow };
}

function deps(main, out) {
  return { now: () => NOW, cwd: () => main, mainRoot: main, stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) };
}

const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');
const decisionsOf = (runDir) => fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');

// The release gate's Step 3 table, read from SKILL.md (the first cell is the verdict label, so only the cells after it are scanned).
function gateTokens(skill, rowPrefix) {
  const row = skill.split('\n').find((l) => l.startsWith(rowPrefix));
  assert.ok(row, `release SKILL.md has a row starting ${rowPrefix}`);
  return [...row.split('|').slice(2).join('|').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

const skill = readText(SKILL);
const BLOCKING = gateTokens(skill, '| `review: blocking` |');
const FINDINGS = gateTokens(skill, '| `review: findings').filter((t) => t !== 'Step 3 Routing:');

// The release gate's classification (the brief's definition): blocking on a blocking token, findings on any Step 3 Routing line, else clean.
function classify(lines) {
  if (lines.some((l) => BLOCKING.some((t) => l.includes(t)))) return 'review: blocking';
  if (lines.some((l) => l.includes('Step 3 Routing:'))) return 'review: findings';
  return 'review: clean';
}

test('AC2.1: a high finding routed staged produces the literal "high-severity finding"', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- STAGED 09:05:07 — Step 3 Routing: high-severity finding security at src/a.js:12. Stage path: staged/review-3.patch. Reversibility: high.\n');
  assert.equal(streamOf(out, 'out'), decisionsOf(runDir).split('\n').slice(1).join('\n'));
});

test('#4484: --route staged accepts a staged/review-followup-{n}.md stage path', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'staged', '--severity', 'medium', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-followup-2.md'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- STAGED 09:05:07 — Step 3 Routing: medium-severity finding security at src/a.js:12. Stage path: staged/review-followup-2.md. Reversibility: high.\n');
  assert.equal(streamOf(out, 'out'), decisionsOf(runDir).split('\n').slice(1).join('\n'));
});

// _shared/staged-patch.md's Stacked check: its three non-clean outcomes each change the STAGED line.
const STACK_BASE = ['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'];

test('a re-derived patch suffixes the staged line with the patch it was re-derived onto', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, ...STACK_BASE, '--rederived-onto', 'staged/review-1.patch'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- STAGED 09:05:07 — Step 3 Routing: high-severity finding security at src/a.js:12. Stage path: staged/review-3.patch. Re-derived onto staged/review-1.patch. Reversibility: high.\n');
});

test('a stacked-check conflict names both sides and the first stderr line, before the stage path', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, ...STACK_BASE, '--conflict', 'staged/review-3.patch', '--conflicts-with', 'staged/test-2.patch', '--stack-stderr', 'error: patch failed: src/a.js:12'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- STAGED 09:05:07 — Step 3 Routing: high-severity finding security at src/a.js:12 — stacked check: staged/review-3.patch does not apply on top of staged/test-2.patch in apply order (error: patch failed: src/a.js:12); kept — the console re-derives staged/review-3.patch from its Invariant:. Stage path: staged/review-3.patch. Reversibility: high.\n');
});

test('a stacked check that could not run names its exit code and keeps the patch unstacked', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, ...STACK_BASE, '--stack-exit', '3', '--stack-stderr', 'run dir not anchored'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- STAGED 09:05:07 — Step 3 Routing: high-severity finding security at src/a.js:12 — gate could not run: stacked check exit 3 (run dir not anchored); kept unstacked — the console\'s stale path covers a conflict. Stage path: staged/review-3.patch. Reversibility: high.\n');
});

test('release Step 3 classifies composed lines as the release gate table says', () => {
  assert.deepEqual(BLOCKING, ['critical finding', 'high-severity finding']);
  assert.deepEqual(FINDINGS, ['medium-severity finding', 'applied low-severity']);
  const cases = [
    { label: 'STAGED high', argv: ['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], verdict: 'review: blocking' },
    { label: 'STAGED high record proposal', argv: ['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-followup-1.md'], verdict: 'review: blocking' },
    { label: 'KEPT-PROMPT critical', argv: ['--route', 'kept-prompt', '--severity', 'critical', '--category', 'security', '--at', 'src/a.js:12'], verdict: 'review: blocking' },
    { label: 'STAGED medium', argv: ['--route', 'staged', '--severity', 'medium', '--category', 'naming', '--at', 'src/b.js:4', '--stage-path', 'staged/review-4.patch'], verdict: 'review: findings' },
    { label: 'AUTO low', argv: ['--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234'], verdict: 'review: findings' },
    { label: 'AUTO medium', argv: ['--route', 'auto', '--severity', 'medium', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234'], verdict: 'review: findings' },
    { label: 'STAGED low', argv: ['--route', 'staged', '--severity', 'low', '--category', 'naming', '--at', 'src/b.js:4', '--stage-path', 'staged/review-5.patch'], verdict: 'review: findings' },
    { label: 'STAGED high re-derived', argv: [...STACK_BASE, '--rederived-onto', 'staged/review-1.patch'], verdict: 'review: blocking' },
    { label: 'STAGED high stack conflict', argv: [...STACK_BASE, '--conflict', 'staged/review-1.patch', '--conflicts-with', 'staged/review-3.patch', '--stack-stderr', 'patch failed'], verdict: 'review: blocking' },
    { label: 'STAGED high stack unverified', argv: [...STACK_BASE, '--stack-exit', '2', '--stack-stderr', 'usage'], verdict: 'review: blocking' },
    { label: 'STAGED medium stack unverified', argv: ['--route', 'staged', '--severity', 'medium', '--category', 'naming', '--at', 'src/b.js:4', '--stage-path', 'staged/review-4.patch', '--stack-exit', '4', '--stack-stderr', 'git failed'], verdict: 'review: findings' },
  ];
  for (const c of cases) {
    const { main, runDir } = fixture();
    const out = [];
    assert.equal(run(['--run', runDir, ...c.argv], deps(main, out)), 0, `${c.label}: ${streamOf(out, 'err')}`);
    const lines = decisionsOf(runDir).split('\n').filter((l) => l.startsWith('- '));
    assert.equal(classify(lines), c.verdict, c.label);
  }
});

test('the composer allows exactly the route/severity pairings step3-routing.md\'s ceiling-keyed table produces', () => {
  const rows = readText(ROUTING).split('\n').filter((l) => /^\| \*\*(Critical|High|Medium|Low)\*\* \|/.test(l));
  assert.equal(rows.length, 4, 'step3-routing.md has the four severity rows of its ceiling-keyed table');
  const table = {};
  for (const row of rows) {
    const [label, ...cells] = row.split('|').slice(1, -1).map((c) => c.trim());
    const severity = label.replace(/\*/g, '').toLowerCase();
    for (const cell of cells) {
      const route = cell.split(/\s/)[0].toLowerCase();
      (table[route] = table[route] || new Set()).add(severity);
    }
  }
  const normalise = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]).sort());
  assert.deepEqual(normalise(table), normalise(ALLOWED_SEVERITIES));
});

test('--help prints the usage on stdout and exits 0', () => {
  const out = [];
  assert.equal(run(['--help'], deps(os.tmpdir(), out)), 0);
  assert.match(streamOf(out, 'out'), /^usage: review-routing-line\.js --run <run-dir> --route auto\|staged\|kept-prompt/);
  assert.equal(streamOf(out, 'err'), '');
});

test('a non-numeric --spec is refused with exit 2, and nothing is written', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234', '--spec', 'abc'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /--spec must be a record number/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('no composed line doubles the step prefix', () => {
  const argvs = [
    ['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'],
    ['--route', 'kept-prompt', '--severity', 'critical', '--category', 'security', '--at', 'src/a.js:12'],
    ['--route', 'staged', '--severity', 'medium', '--category', 'naming', '--at', 'src/b.js:4', '--stage-path', 'staged/review-4.patch'],
    ['--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234'],
  ];
  for (const argv of argvs) {
    const { main, runDir } = fixture();
    assert.equal(run(['--run', runDir, ...argv], deps(main, [])), 0, argv.join(' '));
    assert.doesNotMatch(decisionsOf(runDir), /Step 3 Routing: Step 3 Routing/, argv.join(' '));
  }
});

test('--severity High is normalised', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'staged', '--severity', 'High', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.ok(decisionsOf(runDir).includes('high-severity finding'));
});

test('the AUTO line carries the commit in the reversibility qualifier', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  assert.equal(decisionsOf(runDir), '## /review\n- AUTO 09:05:07 — Step 3 Routing: applied low-severity Convention fix at src/a.js:3. Reversibility: high (commit abc1234).\n');
});

test('--spec and --lever are forwarded to log-decision.js and render in the written line', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234', '--spec', '12', '--lever', 'review-auto-apply-ceiling=low (default); prose-exempt bump applied'], deps(main, out));
  assert.equal(code, 0, streamOf(out, 'err'));
  const text = decisionsOf(runDir);
  assert.ok(text.includes('spec #12 — Step 3 Routing:'), text);
  assert.ok(text.includes('[lever: review-auto-apply-ceiling=low (default); prose-exempt bump applied]'), text);
});

test('every invalid route, severity or flag combination exits 2 and writes nothing', () => {
  const COMMON = ['--category', 'security', '--at', 'src/a.js:12'];
  const cases = {
    'kept-prompt with --severity high': ['--route', 'kept-prompt', '--severity', 'high', ...COMMON],
    'staged with --severity critical': ['--route', 'staged', '--severity', 'critical', ...COMMON, '--stage-path', 'staged/review-3.patch'],
    'auto with --severity high': ['--route', 'auto', '--severity', 'high', ...COMMON, '--commit', 'abc1234'],
    'auto without --commit': ['--route', 'auto', '--severity', 'low', ...COMMON],
    'staged without --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON],
    'staged with a non-matching --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-x.patch'],
    'staged with a non-numeric review-followup --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-followup-x.md'],
    'staged with a review-followup .patch --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-followup-3.patch'],
    'staged with a review-{n}.md --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-3.md'],
    'unknown --severity': ['--route', 'staged', '--severity', 'severe', ...COMMON, '--stage-path', 'staged/review-3.patch'],
    'auto with --stage-path': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc1234', '--stage-path', 'staged/review-3.patch'],
    'staged with --commit': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-3.patch', '--commit', 'abc1234'],
    'kept-prompt with --stage-path': ['--route', 'kept-prompt', '--severity', 'critical', ...COMMON, '--stage-path', 'staged/review-3.patch'],
    'kept-prompt with --commit': ['--route', 'kept-prompt', '--severity', 'critical', ...COMMON, '--commit', 'abc1234'],
    'staged with a suffixed --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-3.patch.bak'],
    'staged with a prefixed --stage-path': ['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'x/staged/review-3.patch'],
    'auto with a non-hex --commit': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc)'],
    'auto with a --commit suffixed by a non-hex character': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc1234)'],
    'auto with a --commit prefixed by a word': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'x abc1234'],
    'auto with a too-short --commit': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc12'],
    'a category naming a critical finding': ['--route', 'staged', '--severity', 'low', '--category', 'critical finding', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'],
    'a category naming a severity finding in any case': ['--route', 'staged', '--severity', 'medium', '--category', 'Medium-Severity FINDING', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'],
    'an --at naming a critical finding': ['--route', 'staged', '--severity', 'low', '--category', 'security', '--at', 'critical finding:1', '--stage-path', 'staged/review-3.patch'],
    'a category with an interior newline': ['--route', 'staged', '--severity', 'high', '--category', 'security\nlens', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'],
    'a missing --at': ['--route', 'staged', '--severity', 'high', '--category', 'security', '--stage-path', 'staged/review-3.patch'],
    'trailing bare --category': ['--route', 'staged', '--severity', 'high', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch', '--category'],
    'empty --category': ['--route', 'staged', '--severity', 'high', '--category', '', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'],
    'unknown --route': ['--route', 'deferred', '--severity', 'low', ...COMMON],
    'missing --route': ['--severity', 'low', ...COMMON, '--commit', 'abc1234'],
    'a --lever with an interior newline': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc1234', '--lever', 'a=b (default)\n- KEPT-PROMPT 00:00:00 — Step 3 Routing: x'],
    'a --lever naming a high-severity finding': ['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc1234', '--lever', 'high-severity finding'],
  };
  for (const [label, argv] of Object.entries(cases)) {
    const { main, runDir } = fixture();
    const out = [];
    assert.equal(run(['--run', runDir, ...argv], deps(main, out)), 2, label);
    assert.match(streamOf(out, 'err'), /review-routing-line\.js: /, label);
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, `${label}: decisions.md never created`);
  }
});

test('every invalid stacked-check combination exits 2 naming its own refusal, and writes nothing', () => {
  const COMMON = ['--category', 'security', '--at', 'src/a.js:12'];
  const cases = {
    'a stacked-check flag on --route auto': [['--route', 'auto', '--severity', 'low', ...COMMON, '--commit', 'abc1234', '--rederived-onto', 'staged/review-1.patch'], /only valid with --route staged/],
    'a stacked-check flag on --route kept-prompt': [['--route', 'kept-prompt', '--severity', 'critical', ...COMMON, '--stack-exit', '2', '--stack-stderr', 'usage'], /only valid with --route staged/],
    'a stacked-check flag on a record proposal': [['--route', 'staged', '--severity', 'high', ...COMMON, '--stage-path', 'staged/review-followup-1.md', '--rederived-onto', 'staged/review-1.patch'], /only valid with a staged\/review-\{n\}\.patch --stage-path/],
    'two stacked-check outcomes at once': [[...STACK_BASE, '--rederived-onto', 'staged/review-1.patch', '--stack-exit', '2', '--stack-stderr', 'usage'], /give one stacked-check outcome/],
    'a non-patch --rederived-onto': [[...STACK_BASE, '--rederived-onto', 'staged/review-1.md'], /--rederived-onto must name another staged patch/],
    '--rederived-onto naming the staged patch itself': [[...STACK_BASE, '--rederived-onto', 'staged/review-3.patch'], /--rederived-onto must name another staged patch/],
    '--rederived-onto with --stack-stderr': [[...STACK_BASE, '--rederived-onto', 'staged/review-1.patch', '--stack-stderr', 'x'], /--stack-stderr is not valid with --rederived-onto/],
    '--conflict without --conflicts-with': [[...STACK_BASE, '--conflict', 'staged/review-3.patch', '--stack-stderr', 'patch failed'], /--conflict and --conflicts-with are given together/],
    '--conflicts-with without --conflict': [[...STACK_BASE, '--conflicts-with', 'staged/review-1.patch', '--stack-stderr', 'patch failed'], /--conflict and --conflicts-with are given together/],
    'a conflict side that is not a staged patch': [[...STACK_BASE, '--conflict', 'staged/review-3.patch', '--conflicts-with', 'src/a.js', '--stack-stderr', 'patch failed'], /must each name a staged patch/],
    'a conflict that leaves out the staged patch': [[...STACK_BASE, '--conflict', 'staged/review-1.patch', '--conflicts-with', 'staged/review-2.patch', '--stack-stderr', 'patch failed'], /must be the --stage-path patch/],
    'a conflict without --stack-stderr': [[...STACK_BASE, '--conflict', 'staged/review-3.patch', '--conflicts-with', 'staged/review-1.patch'], /--stack-stderr is required/],
    '--stack-exit 1 (a conflict, not an unverified stack)': [[...STACK_BASE, '--stack-exit', '1', '--stack-stderr', 'patch failed'], /--stack-exit must be one of 2\|3\|4/],
    '--stack-exit without --stack-stderr': [[...STACK_BASE, '--stack-exit', '2'], /--stack-stderr is required/],
    '--stack-stderr without an outcome': [[...STACK_BASE, '--stack-stderr', 'usage'], /--stack-stderr is only valid with --conflict or --stack-exit/],
    'a --stack-stderr naming a high-severity finding': [[...STACK_BASE, '--stack-exit', '2', '--stack-stderr', 'high-severity finding'], /--stack-stderr must not contain/],
    'a --stack-stderr with an interior newline': [[...STACK_BASE, '--stack-exit', '2', '--stack-stderr', 'usage\n- KEPT-PROMPT 00:00:00 — Step 3 Routing: x'], /--stack-stderr must be a single line/],
  };
  for (const [label, [argv, message]] of Object.entries(cases)) {
    const { main, runDir } = fixture();
    const out = [];
    assert.equal(run(['--run', runDir, ...argv], deps(main, out)), 2, label);
    assert.match(streamOf(out, 'err'), message, label);
    assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, `${label}: decisions.md never created`);
  }
});

test('a trailing bare --stage-path is a usage error naming the flag, and nothing is written', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'auto', '--severity', 'low', '--category', 'Convention', '--at', 'src/a.js:3', '--commit', 'abc1234', '--stage-path'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /--stage-path requires a value/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('a value-taking flag followed directly by another flag is a usage error naming it, and nothing is written', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'staged', '--severity', 'high', '--category', '--at', 'src/a.js:1', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /--category requires a value/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('an unknown --severity names the lowercase set', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--run', runDir, '--route', 'staged', '--severity', 'severe', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /--severity must be one of low\|medium\|high\|critical/);
});

test('a missing --run is a usage error from the CLI itself, and nothing is written', () => {
  const { main, runDir } = fixture();
  const out = [];
  const code = run(['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 2);
  assert.match(streamOf(out, 'err'), /review-routing-line\.js: --run <run-dir> is required/);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false, 'decisions.md never created');
});

test('a shadow run dir is refused with exit 3', () => {
  const { main, shadow } = fixture();
  const out = [];
  const code = run(['--run', shadow, '--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-3.patch'], deps(main, out));
  assert.equal(code, 3);
  assert.match(streamOf(out, 'err'), /not anchored/);
  assert.equal(fs.existsSync(path.join(shadow, 'decisions.md')), false, 'nothing written to the shadow');
});
