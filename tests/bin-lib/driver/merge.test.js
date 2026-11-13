'use strict';
// merge.js (#5226): the driver's merge step. Every test drives merge(ctx, deps) through the
// scripted harness below, which mirrors run.test.js's harness: a call with no scripted answer
// throws `unexpected {kind} {args}`, so a step that makes a call its test did not plan for fails
// loudly. Later tasks append their happy-path replies to defaultMergeScript and add over.* knobs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { merge } = require(path.join(LIB, 'driver', 'merge'));
const { MERGE_STEP_NAMES } = require(path.join(LIB, 'driver', 'events'));
const { VERDICT_STEPS, verdictMarker } = require(path.join(LIB, 'dispatch', 'merge-verdict'));
const { formatEntry } = require(path.join(LIB, 'log-decision', 'append'));

const MAIN_NOW = new Date(2026, 10, 13, 9, 0, 0);
const CLOCK_START = 1000;

function verdictLine(verdict) {
  const marker = verdictMarker(VERDICT_STEPS.gate, 7, verdict);
  const [step, ...rest] = marker.split(': ');
  return formatEntry({ status: 'AUTO', now: MAIN_NOW, step, text: rest.join(': '), reversibility: 'high' });
}

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// A real temp main checkout (a `.git` dir) holding the run directory and its decisions.md, the one
// file merge.js reads from disk itself (confirmFromFile).
function fixture() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-test-'));
  roots.push(main);
  fs.mkdirSync(path.join(main, '.git'));
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-11-13T000000-drive-7');
  fs.mkdirSync(runDir, { recursive: true });
  const worktree = path.join(main, '.claude', 'worktrees', 'drive-7');
  const decisions = path.join(runDir, 'decisions.md');
  const writeDecisions = (content) => {
    if (content === null) fs.rmSync(decisions, { force: true });
    else fs.writeFileSync(decisions, content);
  };
  const ctx = {
    record: 7, pr: 9, repo: 'o/r', branch: 'drive-7', base: 'main', head: 'a'.repeat(40),
    runDir, runRoot: main, mainCheckout: main, worktree, summaryLogged: true,
  };
  return { main, runDir, worktree, decisions, writeDecisions, ctx };
}
const fx = fixture();
const CTX = fx.ctx;
const CONFIRMED = `${verdictLine()}\n`;

const base = (p) => path.basename(p);
const isNode = (name) => (c) => c.kind === 'node' && base(c.args[0]) === name;
const isGh = (...words) => (c) => c.kind === 'gh' && words.every((w, i) => c.args[i] === w);
const describeArgs = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

// The lever read's JSON reply: `{ "merge-verification": entry }`, or `{}` when entry is undefined.
function leverReply(entry) {
  return { code: 0, stdout: JSON.stringify(entry === undefined ? {} : { 'merge-verification': entry }), stderr: '' };
}

// Replies for every call the entry makes on the happy path. Later tasks append theirs here.
function defaultMergeScript(over, files, logs) {
  const labels = over.labels === undefined ? [{ name: 'auto:merge' }] : over.labels;
  return [
    [isGh('issue', 'view'), () => {
      if (labels instanceof Error) throw labels;
      return typeof labels === 'string' ? labels : JSON.stringify({ labels });
    }],
    [(c) => isNode('resolve-policy.js')(c) && c.args.includes('--values'),
      over.integrationModel || { code: 0, stdout: 'pr-first\n', stderr: '' }],
    [isNode('resolve-policy.js'), over.verification || leverReply({ value: 'merge-when-green', source: 'run-config' })],
    [isNode('log-decision.js'), (c) => {
      const a = c.args;
      const file = a[a.indexOf('--text-file') + 1];
      logs.push({ status: a[a.indexOf('--status') + 1], step: a[a.indexOf('--step') + 1], text: String(files[file]).trim(), args: a.slice(1) });
      return over.logReply || { code: 0, stdout: '', stderr: '' };
    }],
    [(c) => c.kind === 'readFile' && base(c.args[0]) === 'run-state.json',
      () => {
        const rs = over.runState === undefined ? { pr: { number: 9 } } : over.runState;
        if (rs instanceof Error) throw rs;
        return typeof rs === 'string' ? rs : JSON.stringify(rs);
      }],
    [(c) => c.kind === 'lstatType', (c) => (
      [fx.main, fx.runDir].includes(c.args[0]) ? { type: 'directory', code: null } : { type: 'missing', code: 'ENOENT' })],
  ];
}

// over: script (tried first), deps (replaces a dep, `undefined` removes it), labels, runState,
// integrationModel, verification, logReply, ghAvailable, decisions (decisions.md text; null = absent),
// supplier (the judgments reply).
function mergeHarness(over = {}) {
  const calls = [];
  const events = [];
  const logs = [];
  const files = {};
  const clock = { t: CLOCK_START };
  fx.writeDecisions(over.decisions === undefined ? CONFIRMED : over.decisions);
  const script = [...(over.script || []), ...defaultMergeScript(over, files, logs)];
  function dispatch(kind, args, cwd, extra = {}) {
    const call = { kind, args, cwd, ...extra };
    calls.push(call);
    for (const [match, reply] of script) {
      if (!match(call)) continue;
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(call) : reply;
    }
    throw new Error(`unexpected ${kind} ${describeArgs(args)}`);
  }
  const supplier = over.supplier === undefined
    ? { mergeCheck: { verdict: 'auto-merge' }, acceptance: { completed: true } }
    : over.supplier;
  const deps = {
    gh: (args) => dispatch('gh', args),
    ghCreate: (args) => dispatch('ghCreate', args),
    git: (args, opts = {}) => dispatch('git', args, opts.cwd, { remoteWrite: opts.remoteWrite }),
    node: (script_, args, opts = {}) => dispatch('node', [script_, ...args], opts.cwd, { env: opts.env, timeout: opts.timeout }),
    readFile: (p) => dispatch('readFile', [p]),
    lstatType: (p) => dispatch('lstatType', [p]),
    writeFile: (p, s) => { files[p] = s; },
    mkdirSync: () => {},
    ghAvailable: () => {
      calls.push({ kind: 'ghAvailable', args: [] });
      return over.ghAvailable === undefined ? true : over.ghAvailable;
    },
    judgments: async (ctx) => {
      calls.push({ kind: 'judgments', args: [ctx] });
      if (typeof supplier === 'function') return supplier(ctx);
      if (supplier instanceof Error) throw supplier;
      return supplier;
    },
    emit: (step, status, ms, detail, extra) => { events.push({ step, status, ms, detail, extra }); },
    rebindEvents: () => {},
    interrupted: () => null,
    watchClock: () => null,
    now: () => { clock.t += 1; return clock.t; },
    sleep: async (ms) => { clock.t += ms; },
    env: { HARNESS: '1' },
    ...(over.deps || {}),
  };
  for (const k of Object.keys(deps)) if (deps[k] === undefined) delete deps[k];
  return { deps, calls, events, logs, files, clock };
}

const pick = (r) => ({ outcome: r.outcome, reason: r.reason, mergeCommit: r.mergeCommit, postMerge: r.postMerge });
const kindsOf = (h) => h.calls.map((c) => c.kind);

// Residue row 1 of the spec's table: the PR is still a draft, no label or comment was written,
// nothing merged. A write would be an `issue edit`/`issue comment`/`pr comment`/`pr ready`/`pr merge`.
function assertNoReadyNoMerge(h) {
  for (const c of h.calls) {
    if (!['gh', 'ghCreate', 'git'].includes(c.kind)) continue;
    const j = describeArgs(c.args);
    assert.doesNotMatch(j, /\bpr ready\b|\bpr merge\b|\bissue edit\b|\bissue comment\b|\bpr comment\b|\bpr edit\b|\bpush\b/, `forbidden call: ${c.kind} ${j}`);
  }
}

test('harness: a call with no scripted answer throws unexpected {kind} {args}', () => {
  const h = mergeHarness();
  assert.throws(() => h.deps.gh(['pr', 'view', '9']), /unexpected gh pr view 9/);
  assert.deepEqual(h.deps.lstatType(fx.runDir), { type: 'directory', code: null });
  assert.deepEqual(h.deps.lstatType(path.join(fx.main, 'nope')), { type: 'missing', code: 'ENOENT' });
});

test('events: MERGE_STEP_NAMES is the frozen sub-step vocabulary', () => {
  assert.ok(Object.isFrozen(MERGE_STEP_NAMES));
  assert.equal(MERGE_STEP_NAMES[0], 'merge-entry');
  assert.equal(new Set(MERGE_STEP_NAMES).size, MERGE_STEP_NAMES.length);
  assert.ok(MERGE_STEP_NAMES.every((n) => /^merge-[a-z-]+$/.test(n)));
});

test('entry passing: the tail stays pending-review/unclassified until later tasks, every call as specified', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'unclassified', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /not implemented past entry/);
  assert.equal(r.runDir, CTX.runDir);
  assert.equal(r.ciWaitMs, 0);
  assert.equal(r.eventsStdoutOnly, false);
  assert.deepEqual(kindsOf(h), ['ghAvailable', 'gh', 'node', 'readFile', 'node', 'judgments']);
  assert.deepEqual(h.calls[1].args, ['issue', 'view', '7', '--repo', 'o/r', '--json', 'labels']);
  const a = h.calls[2];
  const b = h.calls[4];
  assert.equal(path.basename(a.args[0]), 'resolve-policy.js');
  assert.deepEqual(a.args.slice(1), ['--run', CTX.runDir, '--values', 'integration-model']);
  assert.deepEqual(b.args.slice(1), ['--run', CTX.runDir, 'merge-verification']);
  for (const c of [a, b]) {
    assert.equal(c.cwd, CTX.mainCheckout);
    assert.equal(c.timeout, 120000);
    assert.deepEqual(c.env, { HARNESS: '1' });
  }
  assert.equal(h.calls[3].args[0], path.join(CTX.runDir, 'run-state.json'));
  assert.deepEqual(h.logs, []);
  assertNoReadyNoMerge(h);
  assert.equal(h.events[0].step, 'merge-entry');
  assert.equal(h.events[0].status, 'ok');
  for (const e of h.events) assert.ok(MERGE_STEP_NAMES.includes(e.step));
});

test('AC1.1: no supplier makes no call at all and returns no-supplier', async () => {
  const h = mergeHarness({ deps: { judgments: undefined } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'no-supplier', mergeCommit: null, postMerge: null });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.events.map((e) => [e.step, e.status]), [['merge-entry', 'stop']]);
  assert.deepEqual(h.logs, []);
  const h2 = mergeHarness({ deps: { judgments: 'not a function' } });
  assert.equal((await merge(CTX, h2.deps)).reason, 'no-supplier');
  assert.deepEqual(h2.calls, []);
});

test('AC1.2, AC1.3: labels without auto:merge, empty, auto:merge-pending only → not-authorized; unreadable → labels-unreadable', async () => {
  const rows = [
    [[], 'not-authorized'],
    [[{ name: 'auto:merge-pending' }], 'not-authorized'],
    [[{ name: 'auto:build' }], 'not-authorized'],
    [new Error('HTTP 502'), 'labels-unreadable'],
    ['not json', 'labels-unreadable'],
    ['{"labels":"auto:merge"}', 'labels-unreadable'],
    ['{"labels":[{"nom":"auto:merge"}]}', 'labels-unreadable'],
    ['{"labels":["auto:merge"]}', 'labels-unreadable'],
    ['null', 'labels-unreadable'],
  ];
  for (const [labels, reason] of rows) {
    const h = mergeHarness({ labels });
    const r = await merge(CTX, h.deps);
    assert.equal(r.outcome, 'pending-review');
    assert.equal(r.reason, reason, String(labels));
    assertNoReadyNoMerge(h);
    assert.ok(!kindsOf(h).includes('judgments'));
    assert.ok(!kindsOf(h).includes('node'), 'labels are read before any policy read');
  }
  const ok = mergeHarness({ labels: [{ name: 'bug' }, { name: 'auto:merge' }] });
  assert.equal((await merge(CTX, ok.deps)).reason, 'unclassified');
});

test('AC2.1–AC2.6: entry refusals with their residue', async () => {
  const noAcceptance = { mergeCheck: { verdict: 'auto-merge' } };
  const rows = [
    // [name, over, ctx override, reason]
    ['summaryLogged false', {}, { summaryLogged: false }, 'summary-entry-missing'],
    ['summaryLogged "true"', {}, { summaryLogged: 'true' }, 'summary-entry-missing'],
    ['summaryLogged undefined', {}, { summaryLogged: undefined }, 'summary-entry-missing'],
    ['local-merge', { integrationModel: { code: 0, stdout: 'local-merge\n', stderr: '' } }, {}, 'not-pr-first'],
    ['resolver exit 1', { integrationModel: { code: 1, stdout: '', stderr: 'boom' } }, {}, 'not-pr-first'],
    ['resolver timeout', { integrationModel: { code: null, stdout: 'pr-first\n', stderr: 'timed out' } }, {}, 'not-pr-first'],
    ['empty value', { integrationModel: { code: 0, stdout: '\n', stderr: '' } }, {}, 'not-pr-first'],
    ['run-state without pr', { runState: { other: 1 } }, {}, 'not-pr-first'],
    ['run-state pr.number 0', { runState: { pr: { number: 0 } } }, {}, 'not-pr-first'],
    ['run-state pr.number string', { runState: { pr: { number: '9' } } }, {}, 'not-pr-first'],
    ['run-state pr.number fractional', { runState: { pr: { number: 1.5 } } }, {}, 'not-pr-first'],
    ['run-state unparseable', { runState: '{nope' }, {}, 'not-pr-first'],
    ['run-state unreadable', { runState: new Error('ENOENT') }, {}, 'not-pr-first'],
    ['gh absent', { ghAvailable: false }, {}, 'gh-absent'],
    ['judgments throws', { supplier: new Error('boom') }, {}, 'supplier-failed'],
    ['judgments rejects', { supplier: () => Promise.reject(new Error('boom')) }, {}, 'supplier-failed'],
    ['judgments returns null', { supplier: null }, {}, 'supplier-failed'],
    ['verdict not a string', { supplier: { mergeCheck: { verdict: 1 }, acceptance: { completed: true } } }, {}, 'supplier-failed'],
    ['completed not boolean', { supplier: { acceptance: { completed: 'yes' }, mergeCheck: { verdict: 'auto-merge' } } }, {}, 'supplier-failed'],
    ['acceptance missing', { supplier: noAcceptance }, {}, 'supplier-failed'],
    ['verdict needs-human', { supplier: { mergeCheck: { verdict: 'needs-human' }, acceptance: { completed: true } } }, {}, 'verdict-not-confirmed'],
    ['acceptance not completed', { supplier: { mergeCheck: { verdict: 'auto-merge' }, acceptance: { completed: false } } }, {}, 'acceptance-not-completed'],
  ];
  for (const [name, over, ctxOver, reason] of rows) {
    const h = mergeHarness(over);
    const ctx = { ...CTX, ...ctxOver };
    const r = await merge(ctx, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason, mergeCommit: null, postMerge: null }, name);
    assert.equal(r.runDir, CTX.runDir, name);
    assertNoReadyNoMerge(h);
    assert.ok(h.events.length >= 1, name);
    assert.equal(h.events[h.events.length - 1].status === 'ok', false, `${name}: last event is not ok`);
  }
});

test('AC2: gh-absent is decided before any label read; summary is decided after the labels', async () => {
  const absent = mergeHarness({ ghAvailable: false });
  await merge(CTX, absent.deps);
  assert.deepEqual(kindsOf(absent), ['ghAvailable']);
  const noLabel = mergeHarness({ labels: [] });
  const r = await merge({ ...CTX, summaryLogged: false }, noLabel.deps);
  assert.equal(r.reason, 'not-authorized');
  const noSummary = mergeHarness();
  await merge({ ...CTX, summaryLogged: false }, noSummary.deps);
  assert.ok(!kindsOf(noSummary).includes('node'), 'no policy read before the summary check');
});

test('AC2: a not-pr-first integration-model read stops before the lever read and the supplier', async () => {
  const h = mergeHarness({ integrationModel: { code: 1, stdout: '', stderr: 'x' } });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'not-pr-first');
  assert.equal(h.calls.filter((c) => c.kind === 'node').length, 1);
  assert.ok(!kindsOf(h).includes('judgments'));
});

test('AC3.1–AC3.3: a supplier auto-merge without a confirmed decisions.md line is verdict-not-confirmed', async () => {
  const rows = [
    ['no verdict line', { decisions: '- AUTO 09:00:00 — Step 1: unrelated. Reversibility: high.\n' }, /latest none|none/],
    ['decisions.md missing', { decisions: null }, /ENOENT/],
    ['a later needs-human', { decisions: `${verdictLine()}\n${verdictLine('needs-human')}\n` }, /needs-human/],
  ];
  for (const [name, over, detail] of rows) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.equal(r.reason, 'verdict-not-confirmed', name);
    assert.match(r.detail, detail, name);
    assert.equal(r.outcome, 'pending-review');
    assert.ok(!h.calls.some((c) => c.kind === 'node' && base(c.args[0]) === 'closing-links.js'), name);
    assertNoReadyNoMerge(h);
  }
  // A verdict for another record never confirms this one.
  const other = mergeHarness({ decisions: `${verdictLine().replace('#7', '#8')}\n` });
  assert.equal((await merge(CTX, other.deps)).reason, 'verdict-not-confirmed');
});

test('AC8.1: merge-verification off, empty, unparseable and a resolver error all run as wait', async () => {
  const rows = [
    ['off', leverReply({ value: 'off', source: 'run-config' }), /^lever off is not ported on the driver lane — proceeding as wait$/, 'run-config'],
    ['empty', leverReply({ value: '', source: 'default' }), /^lever unresolved \(""\) — proceeding as wait$/, 'default'],
    ['entry error', leverReply({ error: 'boom' }), /^lever unresolved \(""\) — proceeding as wait$/, 'unresolved'],
    ['missing key', leverReply(undefined), /^lever unresolved \(""\)/, 'unresolved'],
    ['non-string value', leverReply({ value: 3, source: 'run-config' }), /^lever unresolved \(""\)/, 'unresolved'],
    ['exit 1', { code: 1, stdout: '', stderr: 'resolver failed' }, /^lever unresolved \(""\)/, 'unresolved'],
    ['unparseable', { code: 0, stdout: 'not json', stderr: '' }, /^lever unresolved \(""\)/, 'unresolved'],
    ['timeout', { code: null, stdout: '', stderr: 'timed out' }, /^lever unresolved \(""\)/, 'unresolved'],
    ['unknown value', leverReply({ value: 'merge-when-gren', source: 'policy' }), /^lever unresolved \("merge-when-gren"\) — proceeding as wait$/, 'policy'],
    ['value with a closing ref', leverReply({ value: 'closes #5', source: 'policy' }), /^lever unresolved \(""\)/, 'policy'],
  ];
  for (const [name, verification, text, source] of rows) {
    const h = mergeHarness({ verification });
    const r = await merge(CTX, h.deps);
    assert.equal(r.reason, 'unclassified', `${name}: entry passed (supplier reached, no stop)`);
    assert.ok(kindsOf(h).includes('judgments'), name);
    assert.equal(h.logs.length, 1, name);
    assert.equal(h.logs[0].status, 'AUTO');
    assert.equal(h.logs[0].step, 'Step 2.5');
    assert.match(h.logs[0].text, text, name);
    assert.ok(h.logs[0].args.includes('/express-lane'), name);
    assert.doesNotMatch(h.logs[0].text, /#\d/, `${name}: neutralized`);
    const entryEvent = h.events.find((e) => e.step === 'merge-entry');
    assert.match(entryEvent.detail, new RegExp(`lever wait \\(${source}\\)`), name);
  }
});

test('AC8.1: merge-when-green and wait are taken as given, and no lever line is logged', async () => {
  for (const [value, expected] of [['merge-when-green', 'merge-when-green'], ['wait', 'wait']]) {
    const h = mergeHarness({ verification: leverReply({ value, source: 'run-config' }) });
    await merge(CTX, h.deps);
    assert.deepEqual(h.logs, [], value);
    assert.match(h.events[0].detail, new RegExp(`lever ${expected} \\(run-config\\)`));
  }
});

test('AC8.1: a failed merge-verification read never stops entry; a failed integration-model read is not-pr-first', async () => {
  const lever = mergeHarness({ verification: { code: 1, stdout: '', stderr: 'resolver failed' } });
  const r = await merge(CTX, lever.deps);
  assert.notEqual(r.reason, 'not-pr-first');
  assert.ok(kindsOf(lever).includes('judgments'));
  const model = mergeHarness({ integrationModel: { code: 1, stdout: '', stderr: 'x' } });
  const r2 = await merge(CTX, model.deps);
  assert.equal(r2.reason, 'not-pr-first');
  assert.ok(!model.calls.some((c) => c.kind === 'node' && !c.args.includes('--values')), 'no merge-verification read');
  assert.ok(!kindsOf(model).includes('judgments'));
});

test('AC8.1: a lever log that fails never stops entry; it is named in the entry event detail', async () => {
  const h = mergeHarness({ verification: leverReply({ value: 'off', source: 'run-config' }), logReply: { code: 1, stdout: '', stderr: 'x' } });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'unclassified');
  assert.ok(kindsOf(h).includes('judgments'));
  assert.match(h.events.find((e) => e.step === 'merge-entry').detail, /log:Step 2\.5/);
});

test('a thrown error is classified on its stderr, never on the argv-bearing message', async () => {
  const err = Object.assign(new Error('Command failed: gh issue view 7 --repo o/r --json labels'), { stderr: 'HTTP 502 bad gateway\n' });
  const h = mergeHarness({ script: [[isNode('resolve-policy.js'), err]] });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'unclassified');
  assert.equal(r.detail, 'merge-entry: HTTP 502 bad gateway');
  assert.doesNotMatch(r.detail, /Command failed|--repo/);
});

test('merge never throws: a throw inside a step is unclassified naming the sub-step; a throwing emit is swallowed', async () => {
  const h = mergeHarness({ script: [[isNode('resolve-policy.js'), new Error('spawn exploded')]] });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'unclassified', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /^merge-entry: spawn exploded/);
  const h2 = mergeHarness({ deps: { emit: () => { throw new Error('emit broke'); } } });
  const r2 = await merge(CTX, h2.deps);
  assert.equal(r2.reason, 'unclassified');
  assert.match(r2.detail, /not implemented past entry/);
  assert.equal(r2.runDir, CTX.runDir);
});
