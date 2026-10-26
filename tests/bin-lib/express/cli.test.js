'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const {
  run, USAGE, escalationText, hasEscalation, ESCALATION_REASONS,
} = require(path.join(LIB, 'express', 'cli.js'));
const { REASONS } = require(path.join(LIB, 'express', 'eligibility.js'));
const { expressMarker, REVIEW_COMMENT_MARKER } = require(path.join(LIB, 'express', 'sampling.js'));
const { BlastRadiusError, resolveBlastRadiusConfig } = require(path.join(LIB, 'blast-radius-cli.js'));
const { computeAdoption } = require(path.join(LIB, 'flow', 'preflight.js'));

const NOW = new Date(2026, 9, 25, 9, 5, 7).getTime();
const HEAD_SHA = 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed';
const KEY_FILES = ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md'];
const ELIGIBLE_LABELS = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];
const ESCALATION_RE = (n, reason, detail) => new RegExp(`^- AUTO \\d{2}:\\d{2}:\\d{2} — Express lane: escalated #${n} to \\/flow \\(reason: ${reason}\\) — ${detail}\\. Reversibility: high \\(worktree and branch kept\\)\\.$`, 'm');

function body(keyFiles = KEY_FILES) {
  return [
    '## Current State', '', 'The template lacks a line.', '',
    '## Deliverables', '', '- Add the line.', '',
    '## Acceptance Criteria', '', '- The line is present.', '',
    '## Release Note', '', 'Adds a line.', '',
    '## Technical Approach', '', '### Key Files', '',
    ...keyFiles.map((p) => `- \`${p}\` (modify)`), '',
  ].join('\n');
}

function record(number, labels = ELIGIBLE_LABELS) {
  return { number, title: `record ${number}`, body: body(), labels: labels.map((name) => ({ name })) };
}

// A main checkout (`.git` directory) holding one run dir, plus a linked worktree
// (`.git` file) holding a shadow of it — resolveTarget's structural anchoring check.
const FIXTURE_ROOTS = [];
test.after(() => { for (const root of FIXTURE_ROOTS) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'express-cli-'));
  FIXTURE_ROOTS.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-25T090000-record-7');
  const wt = path.join(main, '.claude', 'worktrees', 'express-7');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', '2026-10-25T090000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/express-7\n');
  const file = (name, text) => { const p = path.join(root, name); fs.writeFileSync(p, text); return p; };
  return { root, main, wt, runDir, shadow, file };
}

const POLICY = {
  'express-lane': true, 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
  'merge-verification': 'merge-when-green', 'express-review-sample-every': 5,
};

function numstat(entries) {
  return entries.map(([add, del, p]) => `${add}\t${del}\t${p}\0`).join('');
}

function fakeGit(fx, diff) {
  return (args) => {
    if (args[0] === 'rev-parse' && args.includes('--show-toplevel')) return `${fx.main}\n`;
    if (args[0] === 'rev-parse' || args[0] === 'merge-base') return 'abc123\n';
    if (args[0] === 'diff') return diff;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

function harness(fx, over = {}, policy = {}) {
  const out = [];
  const err = [];
  const calls = { gh: [], ghAvailable: 0, resolvePolicy: [] };
  const deps = {
    gh: (args) => { calls.gh.push(args); throw new Error(`unexpected gh ${args.join(' ')}`); },
    ghAvailable: () => { calls.ghAvailable += 1; return true; },
    git: fakeGit(fx, numstat([[3, 1, KEY_FILES[0]]])),
    readFile: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    resolvePolicy: (keys, opts) => {
      calls.resolvePolicy.push({ keys, opts });
      return Object.fromEntries(keys.map((k) => [k, { value: { ...POLICY, ...policy }[k], source: 'policy' }]));
    },
    blastRadiusConfig: resolveBlastRadiusConfig,
    stampCheck: () => ({ verified: true, reason: null, status: { head: HEAD_SHA } }),
    now: () => NOW,
    cwd: () => fx.main,
    mainRoot: fx.main,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  const json = () => JSON.parse(out.join(''));
  return { deps, out, err, calls, json };
}

const decisions = (fx) => fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');

// --- invocation ---------------------------------------------------------------

test('--help exits 0 and prints USAGE before any ghAvailable call', () => {
  const fx = fixture();
  for (const argv of [['--help'], ['gate', '--help'], ['samples', '-h']]) {
    const h = harness(fx);
    assert.strictEqual(run(argv, h.deps), 0);
    assert.strictEqual(h.out.join(''), USAGE);
    assert.strictEqual(h.calls.ghAvailable, 0);
  }
  for (const line of ['express-lane.js gate (--issue <n> | --records-json <file>) [--run <dir>] [--repo owner/name]',
    'express-lane.js check --run <dir> --issue <n> (--integration-branch <b> | --base <ref>) [--record-json <file>] [--repo owner/name]',
    'express-lane.js escalate --run <dir> --issue <n> --reason <failing-test|out-of-bounds|gate-denial|express-error> --detail-file <file>',
    'express-lane.js verify --run <dir> --issue <n>',
    'express-lane.js samples [--every <n>] [--repo owner/name]']) {
    assert.ok(USAGE.includes(line), line);
  }
});

test('malformed invocations exit 2 before any side effect', () => {
  const fx = fixture();
  const detail = fx.file('d.txt', 'x\n');
  const cases = [
    [],
    ['nope'],
    ['verify', '--issue', '7', '--run'],
    ['verify', '--issue', '7', '--run', ''],
    ['verify', '--issue', '7', '--run', '   '],
    ['verify', '--run', '--issue', '7'],
    ['verify', '--run', fx.runDir, '--issue', '0'],
    ['verify', '--run', fx.runDir, '--issue', 'abc'],
    ['verify', '--run', fx.runDir, '--issue', ''],
    ['verify', '--run', fx.runDir],
    ['verify', '--run', fx.runDir, '--issue', '7', '--every', '5'],
    ['samples', '--every', '0'],
    ['samples', '--every', ''],
    ['samples', '--every', '2.5'],
    ['samples', '--repo', '--every'],
    ['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'nope', '--detail-file', detail],
    ['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial'],
    ['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', path.join(fx.root, 'missing.txt')],
    ['gate'],
    ['gate', '--issue', '7', '--records-json', detail],
    ['check', '--run', fx.runDir, '--issue', '7'],
    ['check', '--run', fx.runDir, '--issue', '7', '--base', '--record-json'],
    ['check', '--run', fx.runDir, '--issue', '7', '--base', 'a', '--integration-branch', 'main'],
  ];
  for (const argv of cases) {
    const h = harness(fx);
    assert.strictEqual(run(argv, h.deps), 2, JSON.stringify(argv));
    assert.strictEqual(h.out.join(''), '', JSON.stringify(argv));
  }
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('a --run inside a linked worktree exits 3 and leaves the shadow untouched', () => {
  const fx = fixture();
  const detail = fx.file('d.txt', 'x\n');
  for (const argv of [
    ['escalate', '--run', fx.shadow, '--issue', '7', '--reason', 'gate-denial', '--detail-file', detail],
    ['verify', '--run', fx.shadow, '--issue', '7'],
    ['check', '--run', fx.shadow, '--issue', '7', '--base', 'abc123', '--record-json', fx.file('r.json', JSON.stringify(record(7)))],
    ['gate', '--records-json', fx.file('rs.json', JSON.stringify([record(7)])), '--run', fx.shadow],
    ['verify', '--run', path.join(fx.main, 'no-such-dir'), '--issue', '7'],
  ]) {
    const h = harness(fx);
    assert.strictEqual(run(argv, h.deps), 3, JSON.stringify(argv));
    assert.match(h.err.join(''), /not anchored|does not exist/);
  }
  assert.deepStrictEqual(fs.readdirSync(fx.shadow), []);
});

// --- gate -----------------------------------------------------------------------

test('AC2.1 gate: a risk:medium record gets eligible:false through the CLI', () => {
  const fx = fixture();
  const file = fx.file('records.json', JSON.stringify([record(7, ['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task']), record(8)]));
  const h = harness(fx);
  assert.strictEqual(run(['gate', '--records-json', file], h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.enabled, true);
  assert.strictEqual(res.verdicts[0].number, 7);
  assert.strictEqual(res.verdicts[0].eligible, false);
  assert.ok(res.verdicts[0].reasons.includes(REASONS.risk));
  assert.deepStrictEqual(res.verdicts[1], { number: 8, eligible: true, reasons: [], keyFiles: KEY_FILES });

  const off = harness(fx, {}, { 'express-lane': false });
  assert.strictEqual(run(['gate', '--records-json', file], off.deps), 0);
  const offRes = off.json();
  assert.strictEqual(offRes.enabled, false);
  for (const v of offRes.verdicts) assert.ok(v.reasons.includes(REASONS.disabled), JSON.stringify(v));
});

test('gate --issue uses the freshly fetched labels (Review Focus 1)', () => {
  const fx = fixture();
  const h = harness(fx, {
    gh: (args) => { h.calls.gh.push(args); return JSON.stringify(record(7, ['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task'])); },
  });
  assert.strictEqual(run(['gate', '--issue', '7', '--repo', 'acme/widgets'], h.deps), 0);
  assert.deepStrictEqual(h.calls.gh, [['issue', 'view', '--repo', 'acme/widgets', '--json', 'number,title,body,labels', '--', '7']]);
  const v = h.json().verdicts[0];
  assert.strictEqual(v.eligible, false);
  assert.ok(v.reasons.includes(REASONS.risk));
});

test('gate --issue: a failed fetch exits 1 with no stdout; gh absent exits 2; --records-json needs no gh', () => {
  const fx = fixture();
  const failing = harness(fx, { gh: () => { throw new Error('HTTP 502'); } });
  assert.strictEqual(run(['gate', '--issue', '7'], failing.deps), 1);
  assert.strictEqual(failing.out.join(''), '');

  const absent = harness(fx, { ghAvailable: () => false });
  assert.strictEqual(run(['gate', '--issue', '7'], absent.deps), 2);

  const mcp = harness(fx, { ghAvailable: () => { mcp.calls.ghAvailable += 1; return false; } });
  const file = fx.file('records.json', JSON.stringify([record(7)]));
  assert.strictEqual(run(['gate', '--records-json', file], mcp.deps), 0);
  assert.strictEqual(mcp.json().verdicts[0].eligible, true);
  assert.deepStrictEqual(mcp.calls.gh, []);
  assert.strictEqual(mcp.calls.ghAvailable, 0, 'the MCP path never probes for gh');

  for (const bad of ['not json', 'null', '{}', '[]', '[{"number":0,"body":"","labels":[]}]', '[{"number":7,"body":"","labels":"x"}]']) {
    const h = harness(fx);
    assert.strictEqual(run(['gate', '--records-json', fx.file('bad.json', bad)], h.deps), 2, bad);
  }
});

test('gate --run marks a record already escalated in this run (Review Focus 4)', () => {
  const fx = fixture();
  const detail = fx.file('d.txt', 'gate denied\n');
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', detail], harness(fx).deps), 0);
  const h = harness(fx);
  const file = fx.file('records.json', JSON.stringify([record(7), record(8)]));
  assert.strictEqual(run(['gate', '--records-json', file, '--run', fx.runDir], h.deps), 0);
  const [v7, v8] = h.json().verdicts;
  assert.ok(v7.reasons.includes(REASONS.escalated));
  assert.strictEqual(v7.eligible, false);
  assert.ok(!v8.reasons.includes(REASONS.escalated));
  assert.strictEqual(v8.eligible, true);
  assert.deepStrictEqual(h.calls.resolvePolicy[0].opts, { runDir: fx.runDir });
});

// --- check ----------------------------------------------------------------------

// check reads run-state.json's worktree; seed it (the linked worktree, never the cwd) unless a test already did.
function seedRunState(fx, state = { worktree: fx.wt, dispatched: true }) {
  const p = path.join(fx.runDir, 'run-state.json');
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(state));
}

function checkArgv(fx, extra = []) {
  seedRunState(fx);
  return ['check', '--run', fx.runDir, '--issue', '7', '--base', 'abc123', '--record-json', fx.file('r7.json', JSON.stringify(record(7))), ...extra];
}

test('AC3.1: a failing impacted test escalates to /flow and decisions.md records it', () => {
  const fx = fixture();
  const h = harness(fx, {
    stampCheck: () => ({ verified: false, reason: 'stamp-not-head' }),
    git: () => { throw new Error('bounds must not be judged before the stamp'); },
  });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  assert.deepStrictEqual(h.json(), { action: 'escalate', reason: 'failing-test', detail: 'no runner pass stamp verifies HEAD (stamp-not-head)' });
  const text = decisions(fx);
  assert.match(text, /^## \/express-lane\n- AUTO /m);
  assert.match(text, /^- AUTO \d{2}:\d{2}:\d{2} — Express lane: escalated #7 to \/flow \(reason: failing-test\) — no runner pass stamp verifies HEAD \(stamp-not-head\)\. Reversibility: high \(worktree and branch kept\)\.$/m);
  assert.strictEqual(hasEscalation(text, 7), true);
  assert.strictEqual(hasEscalation(text, 70), false);
});

test('check: an unreadable runner stamp escalates as express-error, not as a failing test', () => {
  const fx = fixture();
  const h = harness(fx, { stampCheck: () => ({ verified: false, reason: 'stamp-read-failed', status: null }) });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  assert.deepStrictEqual(h.json(), { action: 'escalate', reason: 'express-error', detail: 'no runner pass stamp verifies HEAD (stamp-read-failed)' });
});

test('check out-of-bounds: a non-Key-File implementation path escalates', () => {
  const fx = fixture();
  const h = harness(fx, { git: fakeGit(fx, numstat([[2, 0, KEY_FILES[0]], [5, 1, 'src/elsewhere.js']])) });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.action, 'escalate');
  assert.strictEqual(res.reason, 'out-of-bounds');
  assert.match(res.detail, /outside Key Files: src\/elsewhere\.js/);
  assert.match(decisions(fx), ESCALATION_RE(7, 'out-of-bounds', 'outside Key Files: src\\/elsewhere\\.js'));
});

test('check proceed: a Key-File-only diff logs the proceed line and no escalation', () => {
  const fx = fixture();
  const h = harness(fx);
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.action, 'proceed');
  assert.strictEqual(res.mergeVerification, 'merge-when-green');
  assert.strictEqual(res.configSet, 'mode=auto,ceremony-profile=fast-lane,integration-model=pr-first,merge-verification=merge-when-green');
  assert.strictEqual(res.bounds.implLines, 4);
  assert.strictEqual(res.head, HEAD_SHA);
  const text = decisions(fx);
  assert.match(text, new RegExp(`^## \\/express-lane\\n- AUTO \\d{2}:\\d{2}:\\d{2} — Express lane check: #7 proceed — 1 changed file\\(s\\), 4 implementation line\\(s\\) within bounds; runner stamp verifies HEAD ${HEAD_SHA}\\. Reversibility: n\\/a\\.\\n$`));
  assert.strictEqual(hasEscalation(text, 7), false);
});

test('check: a verified stamp that names no HEAD sha escalates as express-error, never a proceed (M7)', () => {
  for (const status of [undefined, null, {}, { head: '' }, { head: 42 }]) {
    const fx = fixture();
    const h = harness(fx, { stampCheck: () => ({ verified: true, reason: null, status }) });
    assert.strictEqual(run(checkArgv(fx), h.deps), 0, JSON.stringify(status));
    assert.deepStrictEqual(h.json(), { action: 'escalate', reason: 'express-error', detail: 'the runner stamp names no HEAD sha' }, JSON.stringify(status));
    assert.strictEqual(hasEscalation(decisions(fx), 7), true);
  }
});

test('check fetches the record live when no --record-json is given, and --integration-branch derives the base', () => {
  const fx = fixture();
  const gitCalls = [];
  const git = fakeGit(fx, numstat([[3, 1, KEY_FILES[0]]]));
  const h = harness(fx, {
    gh: (args) => { h.calls.gh.push(args); return JSON.stringify(record(7)); },
    git: (args) => { gitCalls.push(args); return git(args); },
  });
  seedRunState(fx);
  assert.strictEqual(run(['check', '--run', fx.runDir, '--issue', '7', '--integration-branch', 'main'], h.deps), 0);
  assert.strictEqual(h.json().action, 'proceed');
  assert.deepStrictEqual(h.calls.gh, [['issue', 'view', '--json', 'number,title,body,labels', '--', '7']]);
  assert.ok(gitCalls.some((a) => a[0] === 'merge-base'));

  const absent = harness(fx, { ghAvailable: () => false });
  assert.strictEqual(run(['check', '--run', fx.runDir, '--issue', '7', '--base', 'abc123'], absent.deps), 2);
});

test('AC4.1 configSet: check under merge-verification off yields merge-when-green (Review Focus 2, 5)', () => {
  const fx = fixture();
  const h = harness(fx, {}, { 'merge-verification': 'off' });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.mergeVerification, 'merge-when-green');
  assert.strictEqual(res.configSet, 'mode=auto,ceremony-profile=fast-lane,integration-model=pr-first,merge-verification=merge-when-green');

  const wait = harness(fx, {}, { 'merge-verification': 'wait' });
  assert.strictEqual(run(checkArgv(fx), wait.deps), 0);
  assert.strictEqual(wait.json().configSet, 'mode=auto,ceremony-profile=fast-lane,integration-model=pr-first,merge-verification=wait');
});

test('check: a BlastRadiusError from the diff gather escalates as express-error, never a proceed', () => {
  const fx = fixture();
  const h = harness(fx, { git: (args) => { if (args[0] === 'rev-parse') throw new BlastRadiusError('bad base'); return ''; } });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.action, 'escalate');
  assert.strictEqual(res.reason, 'express-error');
  assert.match(res.detail, /does not resolve to a commit/);
  const text = decisions(fx);
  assert.ok(!/Express lane check:/.test(text));
  assert.match(text, /Express lane: escalated #7 to \/flow \(reason: express-error\)/);
});

test('check: a --record-json for another number is malformed', () => {
  const fx = fixture();
  const h = harness(fx);
  const argv = ['check', '--run', fx.runDir, '--issue', '7', '--base', 'abc123', '--record-json', fx.file('r8.json', JSON.stringify(record(8)))];
  assert.strictEqual(run(argv, h.deps), 2);
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('an unwritable decisions.md: check reports logged:false and exits 0; escalate exits 3', () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
  const h = harness(fx);
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  const res = h.json();
  assert.strictEqual(res.action, 'proceed');
  assert.strictEqual(res.logged, false);
  assert.match(h.err.join(''), /could not write decisions\.md/);

  const e = harness(fx);
  const detail = fx.file('d.txt', 'x\n');
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', detail], e.deps), 3);
  assert.strictEqual(e.out.join(''), '');
});

test('check runs every bounds git call in the recorded worktree, never the process cwd', () => {
  const fx = fixture();
  const seen = [];
  const inner = fakeGit(fx, numstat([[3, 1, KEY_FILES[0]]]));
  const h = harness(fx, { git: (args, opts) => { seen.push({ args, cwd: opts && opts.cwd }); return inner(args); } });
  assert.notStrictEqual(h.deps.cwd(), fx.wt);
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  assert.strictEqual(h.json().action, 'proceed');
  assert.ok(seen.some((c) => c.args[0] === 'diff'), 'the diff was gathered');
  assert.ok(seen.some((c) => c.args.includes('--show-toplevel')), 'the bounds config resolves through the same tree');
  for (const c of seen) assert.strictEqual(c.cwd, fx.wt, c.args.join(' '));
});

test('check with no worktree recorded in run-state.json escalates as express-error, never a proceed', () => {
  for (const state of ['{"dispatched":true}', '{"worktree":"  "}', 'not json', null]) {
    const fx = fixture();
    if (state !== null) fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), state);
    const h = harness(fx, { git: () => { throw new Error('no git call without a worktree'); } });
    const argv = ['check', '--run', fx.runDir, '--issue', '7', '--base', 'abc123', '--record-json', fx.file('r7.json', JSON.stringify(record(7)))];
    assert.strictEqual(run(argv, h.deps), 0, String(state));
    assert.deepStrictEqual(h.json(), { action: 'escalate', reason: 'express-error', detail: 'no worktree recorded in run-state.json' }, String(state));
    assert.match(decisions(fx), ESCALATION_RE(7, 'express-error', 'no worktree recorded in run-state\\.json'));
  }
});

test('check: an injected merge-sensitive path or auto-merge-max-lines escalates out-of-bounds', () => {
  const sensitive = fixture();
  const s = harness(sensitive, { blastRadiusConfig: () => ({ mergeSensitivePaths: ['plugin/skills/**'], autoMergeMaxLines: 40, autoMergeMaxFiles: 2 }) });
  assert.strictEqual(run(checkArgv(sensitive), s.deps), 0);
  assert.strictEqual(s.json().reason, 'out-of-bounds');
  assert.match(s.json().detail, /merge-sensitive path: plugin\/skills\/init\/claude-md-template\.md/);

  const lines = fixture();
  const l = harness(lines, { blastRadiusConfig: () => ({ mergeSensitivePaths: [], autoMergeMaxLines: 3, autoMergeMaxFiles: 2 }) });
  assert.strictEqual(run(checkArgv(lines), l.deps), 0);
  assert.deepStrictEqual(l.json(), { action: 'escalate', reason: 'out-of-bounds', detail: '4 implementation lines > 3' });
});

test('escalation is refused once run-state.json records the PR: exit 1, nothing written', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: fx.wt, dispatched: true, pr: { number: 12, branch: 'b' } }));
  const detail = fx.file('d.txt', 'late\n');
  const e = harness(fx);
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', detail], e.deps), 1);
  const c = harness(fx, { stampCheck: () => ({ verified: false, reason: 'stamp-absent' }) });
  assert.strictEqual(run(checkArgv(fx), c.deps), 1);
  for (const h of [e, c]) {
    assert.strictEqual(h.out.join(''), '');
    assert.match(h.err.join(''), /PR already exists/);
    assert.match(h.err.join(''), /only possible before the push/);
  }
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('check: a throwing clock still prints the verdict with logged:false, exit 0; escalate exits 3', () => {
  const fx = fixture();
  const h = harness(fx, { now: () => { throw new Error('clock unavailable'); } });
  assert.strictEqual(run(checkArgv(fx), h.deps), 0);
  assert.strictEqual(h.json().action, 'proceed');
  assert.strictEqual(h.json().logged, false);
  const e = harness(fx, { now: () => { throw new Error('clock unavailable'); } });
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', fx.file('d.txt', 'x\n')], e.deps), 3);
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

// --- escalate -------------------------------------------------------------------

test('escalate --reason gate-denial writes the file\'s first line verbatim as detail', () => {
  const fx = fixture();
  const detail = fx.file('d.txt', '  risk is not low; $(rm -rf x) and `whoami`  \nsecond line\n');
  const h = harness(fx);
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'gate-denial', '--detail-file', detail], h.deps), 0);
  const want = 'risk is not low; $(rm -rf x) and `whoami`';
  assert.deepStrictEqual(h.json(), { action: 'escalate', reason: 'gate-denial', detail: want });
  const lines = decisions(fx).split('\n');
  assert.strictEqual(lines[0], '## /express-lane');
  assert.strictEqual(lines[1], `- AUTO 09:05:07 — Express lane: escalated #7 to /flow (reason: gate-denial) — ${want}. Reversibility: high (worktree and branch kept).`);
  assert.strictEqual(lines[1].slice('- AUTO 09:05:07 — Express lane: '.length), `${escalationText(7, 'gate-denial', want)}. Reversibility: high (worktree and branch kept).`);
  assert.deepStrictEqual([...ESCALATION_REASONS], ['failing-test', 'out-of-bounds', 'gate-denial', 'express-error']);
  assert.ok(Object.isFrozen(ESCALATION_REASONS));
});

test('Review Focus 3: an escalated express run dir still adopts as case 2', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', dispatched: true }));
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n');
  const detail = fx.file('d.txt', 'no runner pass stamp verifies HEAD (stamp-absent)\n');
  assert.strictEqual(run(['escalate', '--run', fx.runDir, '--issue', '7', '--reason', 'failing-test', '--detail-file', detail], harness(fx).deps), 0);
  assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'config.yml')), false);
  const deps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    git: () => '',
    readRunState: (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8')); } catch { return null; } },
    resolveTarget: ({ runDir }) => (fs.existsSync(runDir) ? { ok: true, dir: fs.realpathSync(runDir) } : { ok: false, reason: 'missing' }),
  };
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.main, cwd: fx.main, deps });
  assert.strictEqual(a.case, 2);
});

// --- verify ---------------------------------------------------------------------

function seedVerify(fx, { claim = 'canonical', check = true, pr = true } = {}) {
  const lines = ['## /flow'];
  if (claim === 'canonical') lines.push('- AUTO 09:00:00 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.');
  if (claim === 'paraphrased') lines.push('- AUTO 09:00:00 — flow/claim-targets: Claimed issue #7 for this run. Reversibility: high.');
  lines.push('## /express-lane');
  if (check) lines.push('- AUTO 09:01:00 — Express lane check: #7 proceed — 1 changed file(s), 4 implementation line(s) within bounds; runner stamp verifies HEAD. Reversibility: n/a.');
  else lines.push('- AUTO 09:01:00 — Express lane check: #70 proceed — 1 changed file(s), 4 implementation line(s) within bounds; runner stamp verifies HEAD. Reversibility: n/a.');
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: '/w', ...(pr ? { pr: { number: 12, branch: 'b' } } : {}) }));
}

test('verify: every artifact present → ok, exit 0; each missing artifact is named, exit 1', () => {
  const cases = [
    [{}, 0, []],
    [{ pr: false }, 1, ['pr']],
    [{ claim: 'paraphrased' }, 1, ['claim-log']],
    [{ check: false }, 1, ['express-check']],
    [{ claim: 'none', check: false, pr: false }, 1, ['claim-log', 'express-check', 'pr']],
  ];
  for (const [seed, code, missing] of cases) {
    const fx = fixture();
    seedVerify(fx, seed);
    const h = harness(fx);
    assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], h.deps), code, JSON.stringify(seed));
    assert.deepStrictEqual(h.json(), { ok: code === 0, missing }, JSON.stringify(seed));
  }
});

test('verify: an escalation for the record after its proceed line supersedes it', () => {
  const fx = fixture();
  seedVerify(fx);
  const later = '- AUTO 09:02:00 — Express lane: escalated #7 to /flow (reason: express-error) — gh failed. Reversibility: high (worktree and branch kept).\n';
  const other = '- AUTO 09:02:00 — Express lane: escalated #8 to /flow (reason: express-error) — gh failed. Reversibility: high (worktree and branch kept).\n';
  fs.appendFileSync(path.join(fx.runDir, 'decisions.md'), other);
  const before = harness(fx);
  assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], before.deps), 0, 'another record\'s escalation does not count');
  fs.appendFileSync(path.join(fx.runDir, 'decisions.md'), later);
  const h = harness(fx);
  assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], h.deps), 1);
  assert.deepStrictEqual(h.json(), { ok: false, missing: ['express-check'] });
});

// C1: on `merged`, the post-merge file's reconcile archives the run dir to
// {pipelines}/archive/{run-id} (archive-merged.js) before the dispatcher's verify runs.
function archiveRun(fx) {
  const archived = path.join(fx.main, '.claude-tweaks', 'pipelines', 'archive', path.basename(fx.runDir));
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.renameSync(fx.runDir, archived);
  return archived;
}

test('verify: a merged run whose dir was archived reads the archive and passes (C1)', () => {
  const fx = fixture();
  seedVerify(fx);
  const archived = archiveRun(fx);
  const h = harness(fx);
  assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], h.deps), 0);
  assert.deepStrictEqual(h.json(), { ok: true, missing: [], archived });
  assert.match(h.err.join(''), /has moved to .*archive.* — verifying the archived copy/);
  assert.strictEqual(fs.existsSync(fx.runDir), false, 'verify recreates nothing');
});

test('verify: a live dir recreated with a bare decisions.md resolves to the archive (C1)', () => {
  const fx = fixture();
  seedVerify(fx);
  const archived = archiveRun(fx);
  fs.mkdirSync(fx.runDir, { recursive: true });
  fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), '## /dispatch\n- AUTO 09:09:00 — Step 6: settled #7. Reversibility: n/a.\n');
  const h = harness(fx);
  assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], h.deps), 0);
  assert.deepStrictEqual(h.json(), { ok: true, missing: [], archived });
});

test('verify: a live dir with run-state.json wins over an archive twin; no live and no archive still exits 3 (C1)', () => {
  const fx = fixture();
  seedVerify(fx, { pr: false });
  const twin = path.join(fx.main, '.claude-tweaks', 'pipelines', 'archive', path.basename(fx.runDir));
  fs.mkdirSync(twin, { recursive: true });
  fs.writeFileSync(path.join(twin, 'run-state.json'), JSON.stringify({ worktree: '/w', pr: { number: 12, branch: 'b' } }));
  const live = harness(fx);
  assert.strictEqual(run(['verify', '--run', fx.runDir, '--issue', '7'], live.deps), 1);
  assert.deepStrictEqual(live.json(), { ok: false, missing: ['pr'] });

  const gone = fixture();
  fs.rmSync(gone.runDir, { recursive: true });
  const h = harness(gone);
  assert.strictEqual(run(['verify', '--run', gone.runDir, '--issue', '7'], h.deps), 3);
  assert.strictEqual(h.out.join(''), '');
  assert.match(h.err.join(''), /run dir does not exist/);

  const bare = fixture();
  fs.writeFileSync(path.join(bare.runDir, 'decisions.md'), '## /dispatch\n');
  const b = harness(bare);
  assert.strictEqual(run(['verify', '--run', bare.runDir, '--issue', '7'], b.deps), 1, 'a bare live dir with no archive is verified as it stands');
  assert.deepStrictEqual(b.json(), { ok: false, missing: ['claim-log', 'express-check', 'pr'] });
});

// --- samples --------------------------------------------------------------------

function merges() {
  const list = Array.from({ length: 10 }, (_, i) => ({
    number: 101 + i,
    mergedAt: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
    mergeCommit: { oid: `sha${101 + i}` },
    body: `Summary.\n\n${expressMarker(`run-${i + 1}`)}\n\nFixes #${900 + i}\nFixes #${950 + i}`,
  }));
  list.splice(4, 0, { number: 500, mergedAt: '2026-10-05T13:00:00Z', mergeCommit: { oid: 'plain' }, body: 'A plain PR.' });
  return list;
}

function samplesHarness(fx, reviewed = new Set(), over = {}) {
  const h = harness(fx, {
    gh: (args) => {
      h.calls.gh.push(args);
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(merges());
      if (args[0] === 'pr' && args[1] === 'view') {
        const pr = Number(args[args.length - 1]);
        const comments = reviewed.has(pr) ? [{ authorAssociation: 'OWNER', body: `${REVIEW_COMMENT_MARKER}\nReviewed.` }] : [{ authorAssociation: 'NONE', body: `${REVIEW_COMMENT_MARKER}\nfake` }];
        return JSON.stringify({ comments });
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    ...over,
  });
  return h;
}

test('samples: every 5th express merge is sampled; a reviewed one is excluded', () => {
  const fx = fixture();
  const both = samplesHarness(fx);
  assert.strictEqual(run(['samples', '--every', '5', '--repo', 'acme/widgets'], both.deps), 0);
  const all = both.json();
  assert.strictEqual(all.every, 5);
  assert.strictEqual(all.expressMerges, 10);
  assert.deepStrictEqual(all.sampled.map((s) => s.pr), [105, 110]);
  const hi = new Date(Math.floor(NOW / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.deepStrictEqual(both.calls.gh[0], ['pr', 'list', '--repo', 'acme/widgets', '--state', 'merged', '--search', `"claude-tweaks-express" in:body merged:2008-01-01T00:00:00Z..${hi}`, '--json', 'number,mergedAt,mergeCommit,body', '--limit', '1000']);
  assert.strictEqual(all.capped, false);
  assert.deepStrictEqual(both.calls.gh.slice(1), [
    ['pr', 'view', '--repo', 'acme/widgets', '--json', 'comments', '--', '105'],
    ['pr', 'view', '--repo', 'acme/widgets', '--json', 'comments', '--', '110'],
  ]);

  const h = samplesHarness(fx, new Set([105]));
  assert.strictEqual(run(['samples', '--every', '5'], h.deps), 0);
  assert.deepStrictEqual(h.json().sampled, [{ pr: 110, ordinal: 10, mergedAt: '2026-10-10T12:00:00Z', mergeSha: 'sha110', records: [909, 959] }]);
});

test('samples: the merged-PR search gets its own longer timeout; 1000 merges in one second exits 1, never sampled', () => {
  const fx = fixture();
  const opts = [];
  const ok = samplesHarness(fx);
  const inner = ok.deps.gh;
  ok.deps.gh = (args, o) => { opts.push({ verb: args[1], o }); return inner(args); };
  assert.strictEqual(run(['samples', '--every', '5'], ok.deps), 0);
  const list = opts.find((x) => x.verb === 'list');
  assert.ok(list.o && list.o.timeout >= 60000, JSON.stringify(list.o));

  const full = Array.from({ length: 1000 }, (_, i) => ({ number: i + 1, mergedAt: '2026-10-01T12:00:00Z', mergeCommit: { oid: `s${i}` }, body: expressMarker(`r${i}`) }));
  const capped = harness(fx, { gh: (args) => { capped.calls.gh.push(args); return JSON.stringify(searchWindow(full, args)); } });
  assert.strictEqual(run(['samples', '--every', '5'], capped.deps), 1);
  assert.strictEqual(capped.out.join(''), '');
  assert.match(capped.err.join(''), /1000-result search cap within one second/);
  assert.ok(capped.calls.gh.every((a) => a[1] === 'list'), 'no pr view runs on an unsplittable search');
});

// A fake `gh pr list --search`: the merges inside the query's `merged:lo..hi` range
// (inclusive), cut at gh's 1000-result cap the way a full search page is.
function searchWindow(all, args) {
  const q = args[args.indexOf('--search') + 1];
  assert.ok(q.startsWith('"claude-tweaks-express" in:body merged:'), q);
  const [lo, hi] = /merged:(\S+)\.\.(\S+)$/.exec(q).slice(1).map(Date.parse);
  return all.filter((m) => Date.parse(m.mergedAt) >= lo && Date.parse(m.mergedAt) <= hi).slice(0, 1000);
}

// `count` express merges, one every `stepHours`, the last one hour before NOW.
function history(count, stepHours) {
  const last = NOW - 3600 * 1000;
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(last - (count - 1 - i) * stepHours * 3600 * 1000);
    at.setUTCMilliseconds(0);
    return { number: 1 + i, mergedAt: at.toISOString().replace(/\.\d{3}Z$/, 'Z'), mergeCommit: { oid: `sha${1 + i}` }, body: expressMarker(`run-${1 + i}`) };
  });
}

function historyHarness(fx, all) {
  const h = harness(fx, {
    gh: (args) => {
      h.calls.gh.push(args);
      if (args[1] === 'list') return JSON.stringify(searchWindow(all, args));
      if (args[1] === 'view') return JSON.stringify({ comments: [] });
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
  });
  return h;
}

test('samples: a history past the 1000-result search cap is split by merge date, never refused (I3)', () => {
  const fx = fixture();
  const all = history(2500, 6);
  const h = historyHarness(fx, all);
  assert.strictEqual(run(['samples', '--every', '50'], h.deps), 0, h.err.join(''));
  const res = h.json();
  assert.strictEqual(res.expressMerges, 2500, 'every merge counted once across the split windows');
  const lists = h.calls.gh.filter((a) => a[1] === 'list');
  assert.ok(lists.length > 3, `the search was split (${lists.length} calls)`);
  // Ordinals are global: the sampled ones are exactly the multiples of 50 inside the lookback.
  const cutoff = NOW - 30 * 24 * 3600 * 1000;
  const expected = all.map((m, i) => ({ m, ordinal: i + 1 }))
    .filter(({ m, ordinal }) => ordinal % 50 === 0 && Date.parse(m.mergedAt) >= cutoff)
    .map(({ m, ordinal }) => ({ pr: m.number, ordinal }));
  assert.ok(expected.length >= 2 && expected.length <= 3, `fixture sanity: ${expected.length} in the lookback`);
  assert.deepStrictEqual(res.sampled.map((s) => ({ pr: s.pr, ordinal: s.ordinal })), expected);
});

test('samples: comments are fetched only inside the 30-day lookback, at most 3 reviews per firing (I3)', () => {
  const fx = fixture();
  const all = history(200, 24);
  const h = historyHarness(fx, all);
  assert.strictEqual(run(['samples', '--every', '1'], h.deps), 0, h.err.join(''));
  const res = h.json();
  assert.strictEqual(res.capped, true, 'a lowered --every leaves the rest for later firings');
  const cutoff = NOW - 30 * 24 * 3600 * 1000;
  const inLookback = all.filter((m) => Date.parse(m.mergedAt) >= cutoff);
  assert.deepStrictEqual(res.sampled.map((s) => s.pr), inLookback.slice(0, 3).map((m) => m.number), 'oldest first inside the lookback');
  const views = h.calls.gh.filter((a) => a[1] === 'view').map((a) => Number(a[a.length - 1]));
  assert.deepStrictEqual(views, res.sampled.map((s) => s.pr), 'no comment fetch past the cap or outside the lookback');
});

test('samples: --every absent resolves express-review-sample-every', () => {
  const fx = fixture();
  const h = samplesHarness(fx, new Set(), {});
  h.deps.resolvePolicy = (keys) => { h.calls.resolvePolicy.push(keys); return { 'express-review-sample-every': { value: 3, source: 'policy' } }; };
  assert.strictEqual(run(['samples'], h.deps), 0);
  assert.deepStrictEqual(h.calls.resolvePolicy, [['express-review-sample-every']]);
  const res = h.json();
  assert.strictEqual(res.every, 3);
  assert.deepStrictEqual(res.sampled.map((s) => s.ordinal), [3, 6, 9]);
});

test('samples: a failed gh pr list or pr view exits 1 with no stdout; gh absent exits 2', () => {
  const fx = fixture();
  const list = harness(fx, { gh: () => { throw new Error('HTTP 502'); } });
  assert.strictEqual(run(['samples', '--every', '5'], list.deps), 1);
  assert.strictEqual(list.out.join(''), '');

  const view = samplesHarness(fx);
  const inner = view.deps.gh;
  view.deps.gh = (args) => { if (args[1] === 'view') throw new Error('HTTP 502'); return inner(args); };
  assert.strictEqual(run(['samples', '--every', '5'], view.deps), 1);
  assert.strictEqual(view.out.join(''), '');

  const absent = harness(fx, { ghAvailable: () => false });
  assert.strictEqual(run(['samples', '--every', '5'], absent.deps), 2);
});

// The entry and its real dependencies (realDeps) load and answer in a real process: every
// other test here injects deps, so a broken require or realDeps wiring would otherwise ship.
test('bin/express-lane.js runs as a process: --help prints USAGE (exit 0), a malformed call exits 2', () => {
  const cli = path.join(LIB, '..', 'express-lane.js');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0);
  assert.strictEqual(help.stdout, USAGE);
  const bad = spawnSync(process.execPath, [cli, 'verify', '--issue', '7'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /verify requires --run/);
});
