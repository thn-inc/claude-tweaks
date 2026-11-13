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
const {
  merge, parkComment, conflictComment, classifyMergeFailure, MERGE_WATCH_BOUND_MS, MERGE_WATCH_POLL_MS, RECONCILE_TIMEOUT_MS,
} = require(path.join(LIB, 'driver', 'merge'));
const { MERGE_STEP_NAMES } = require(path.join(LIB, 'driver', 'events'));
const { VERDICT_STEPS, verdictMarker } = require(path.join(LIB, 'dispatch', 'merge-verdict'));
const { formatEntry } = require(path.join(LIB, 'log-decision', 'append'));
const { aggregateReproductionProblem } = require(path.join(LIB, 'log-decision', 'aggregate-reproduction'));
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');

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
// `realMain` (optional): an existing real git checkout to build the run dir inside, in place of a fake one.
function fixture(realMain) {
  const main = realMain || fs.mkdtempSync(path.join(os.tmpdir(), 'merge-test-'));
  roots.push(main);
  if (!realMain) fs.mkdirSync(path.join(main, '.git'));
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
// `gh pr merge` goes out through the write-bound ghCreate kind; any kind is matched so a merge on the
// wrong kind still counts as a merge.
const isMergeCall = (c) => ['gh', 'ghCreate'].includes(c.kind) && c.args[0] === 'pr' && c.args[1] === 'merge';
const describeArgs = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

// The lever read's JSON reply: `{ "merge-verification": entry }`, or `{}` when entry is undefined.
function leverReply(entry) {
  return { code: 0, stdout: JSON.stringify(entry === undefined ? {} : { 'merge-verification': entry }), stderr: '' };
}

// The gate's two pr view field sets: the first read and the `wait` row's re-read.
const GATE_FIELDS = 'state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup';
const REREAD_FIELDS = 'state,mergeStateStatus,headRefOid';
const GREEN_CHECK = { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u' };
const GREEN_RUN = { name: 'CI', workflowName: 'CI', status: 'completed', conclusion: 'success', url: 'u' };
const MET = { state: 'met', failing: [], draftSkipWithoutReadyTrigger: [] };
// The confirmation read after a merge call that exited 0 (Step 3 item 6, plus mergeCommit).
const CONFIRM_FIELDS = 'state,mergedAt,autoMergeRequest,statusCheckRollup,mergeCommit';
const MERGE_SHA = 'f'.repeat(40);
const TITLE = 'feat: composed title';
// What a merged run carries when every post-merge call succeeds (post-merge-run.js verdict clean).
const POST_MERGE_STUB = { verdict: 'clean', failedSteps: [], failures: [] };
// lstatType's real answer shape, `{ type, code }` (path-guard's lstatType), read from the real
// filesystem so a test that moves or deletes a fixture directory is seen as it would be.
function realLstat(p) {
  try {
    const st = fs.lstatSync(p);
    return { type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other', code: null };
  } catch (err) {
    return { type: err.code === 'ENOENT' ? 'missing' : 'unreadable', code: err.code };
  }
}
const isGit = (...words) => (c) => c.kind === 'git' && words.every((w, i) => c.args[i + 2] === w);
// `git worktree list --porcelain` as the post-merge teardown reads it: the main checkout plus the record's worktree.
const worktreeListing = (f) => `worktree ${f.main}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/main\n\n`
  + `worktree ${f.worktree}\nHEAD ${'2'.repeat(40)}\nbranch refs/heads/drive-7\nlocked\n`;
// A knob may be a function (evaluated per call, so a test can script a sequence with seq()).
const knob = (v) => (typeof v === 'function' ? v() : v);
// An object is merged over the default reply; a string is the raw stdout; an Error throws.
function jsonReply(v, dflt) {
  if (v instanceof Error) throw v;
  if (typeof v === 'string') return v;
  return JSON.stringify(v === undefined ? dflt : { ...dflt, ...v });
}

// Replies for every call the entry makes on the happy path. Later tasks append theirs here.
function defaultMergeScript(over, files, logs, applied) {
  return [
    [isGh('issue', 'view'), () => {
      // Read per call, so seq() can script the entry read and the pre-merge read apart.
      const labels = over.labels === undefined ? [{ name: 'auto:merge' }] : knob(over.labels);
      if (labels instanceof Error) throw labels;
      if (typeof labels === 'string') return labels;
      return JSON.stringify({ labels: [...labels, ...applied.map((name) => ({ name }))] });
    }],
    [(c) => isNode('resolve-policy.js')(c) && c.args.includes('--values'),
      over.integrationModel || { code: 0, stdout: 'pr-first\n', stderr: '' }],
    [isNode('resolve-policy.js'), over.verification || leverReply({ value: 'merge-when-green', source: 'run-config' })],
    [isNode('log-decision.js'), (c) => {
      const a = c.args;
      const file = a[a.indexOf('--text-file') + 1];
      // The real CLI's refusals (log-decision.js run(): exit 2), so a call it would reject goes red here.
      const flag = (name) => (a.includes(name) ? a[a.indexOf(name) + 1] : undefined);
      const stepName = flag('--step');
      const line = String(files[file]).replace(/\s+$/, '');
      const reversibility = flag('--reversibility') === undefined ? 'n/a' : flag('--reversibility');
      // The CLI's aggregate-reproduction check, called as it calls it (a pure function; STAGED lines only).
      const aggregate = aggregateReproductionProblem({ status: flag('--status'), step: stepName, text: line });
      const refusal = aggregate ? 'aggregate reproduction' : !['AUTO', 'STAGED', 'KEPT-PROMPT', 'SCANNED', 'REFUSED', 'SKIP'].includes(flag('--status')) ? 'bad status'
        : !line.trim() ? 'empty text'
          : /[\r\n]/.test(line) ? 'interior line break'
            : (typeof stepName === 'string' && stepName !== '' && line.trim().startsWith(`${stepName}:`)) ? 'text repeats step'
              : !/^(?:high|med|low|n\/a)( \(.+\))?$/.test(reversibility) ? 'bad reversibility' : null;
      if (refusal) return { code: 2, stdout: '', stderr: `log-decision.js: ${refusal}\n` };
      logs.push({ status: a[a.indexOf('--status') + 1], step: a[a.indexOf('--step') + 1], text: String(files[file]).trim(), args: a.slice(1) });
      return over.logReply || { code: 0, stdout: '', stderr: '' };
    }],
    [(c) => c.kind === 'readFile' && base(c.args[0]) === 'run-state.json',
      () => {
        const rs = over.runState === undefined ? { pr: { number: 9 } } : over.runState;
        if (rs instanceof Error) throw rs;
        return typeof rs === 'string' ? rs : JSON.stringify(rs);
      }],
    [isNode('closing-links.js'), over.closingLinks || { code: 0, stdout: JSON.stringify({ action: 'clean', keepOpen: [] }), stderr: '' }],
    [isNode('compose-subject.js'), over.compose || { code: 0, stdout: "SUBJECT_TITLE='x'\n", stderr: '' }],
    [(c) => c.kind === 'readFile' && base(c.args[0]) === 'title.txt', () => {
      const ti = over.title === undefined ? TITLE : over.title;
      if (ti instanceof Error) throw ti;
      return ti;
    }],
    [(c) => isGh('pr', 'view')(c) && c.args.includes('isDraft'), () => {
      const d = over.isDraft === undefined ? true : over.isDraft;
      if (d instanceof Error) throw d;
      return typeof d === 'string' ? d : JSON.stringify({ isDraft: d });
    }],
    [isGh('pr', 'ready'), () => {
      if (over.ready instanceof Error) throw over.ready;
      return '';
    }],
    [(c) => c.kind === 'lstatType', (c) => realLstat(c.args[0])],
    [(c) => isGh('pr', 'view')(c) && c.args.includes(GATE_FIELDS), () => jsonReply(knob(over.prState), {
      state: 'OPEN', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', headRefOid: CTX.head, statusCheckRollup: [GREEN_CHECK],
    })],
    [(c) => isGh('pr', 'view')(c) && c.args.includes(REREAD_FIELDS), () => jsonReply(knob(over.reread), {
      state: 'OPEN', mergeStateStatus: 'CLEAN', headRefOid: CTX.head,
    })],
    [isGh('run', 'list'), () => {
      const runs = knob(over.runs);
      if (runs instanceof Error) throw runs;
      return typeof runs === 'string' ? runs : JSON.stringify(runs === undefined ? [GREEN_RUN] : runs);
    }],
    [isNode('ready-run.js'), () => {
      const rr = knob(over.readyRun);
      if (rr instanceof Error) throw rr;
      if (rr && typeof rr === 'object' && 'code' in rr) return rr;
      return { code: 0, stdout: `${JSON.stringify(rr === undefined ? MET : rr)}\n`, stderr: '' };
    }],
    [isGh('label', 'list'), () => (over.labelList === undefined ? 'bot:parked\n' : over.labelList)],
    [isGh('label', 'create'), ''],
    [isGh('issue', 'edit'), (c) => {
      const mode = knob(over.addLabel);
      if (mode instanceof Error) throw mode;
      // addLabel: 'noop' leaves the label off, as a write GitHub accepted but did not apply
      if (mode !== 'noop') applied.push(c.args[c.args.indexOf('--add-label') + 1]);
      return '';
    }],
    [isGh('issue', 'comment'), () => {
      if (over.issueComment instanceof Error) throw over.issueComment;
      return '';
    }],
    [isGh('pr', 'comment'), ''],
    [isMergeCall, () => {
      const m = knob(over.prMerge);
      if (m instanceof Error) throw m;
      return typeof m === 'string' ? m : '';
    }],
    [(c) => isGh('pr', 'view')(c) && c.args.includes(CONFIRM_FIELDS), () => jsonReply(knob(over.confirm), {
      state: 'MERGED', mergedAt: '2026-11-13T09:30:00Z', autoMergeRequest: null, statusCheckRollup: [GREEN_CHECK], mergeCommit: { oid: MERGE_SHA },
    })],
    // The post-merge sequence (Task 6). Each knob may be a function; an Error throws, `{code}` is a CLI reply.
    [isNode('post-merge-run.js'), () => {
      const r = knob(over.postMergeRun);
      if (r instanceof Error) throw r;
      return r || { code: 0, stdout: `${JSON.stringify({ verdict: 'clean', next: 'none' })}\n`, stderr: '' };
    }],
    [isGit('fetch'), () => { if (over.fetch instanceof Error) throw over.fetch; return ''; }],
    [isGit('describe'), () => {
      const d = knob(over.describe);
      if (d instanceof Error) throw d;
      return d === undefined ? 'v6.170.0~2\n' : d;
    }],
    [isNode('hooks.js'), (c) => {
      const r = knob(over.reconcile);
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return r(c);
      return r || { code: 0, stdout: '', stderr: '' };
    }],
    [isGit('worktree', 'list'), () => {
      const l = knob(over.worktreeList);
      if (l instanceof Error) throw l;
      return l === undefined ? worktreeListing(over.fx || fx) : l;
    }],
    [isGit('worktree', 'unlock'), () => { if (over.unlock instanceof Error) throw over.unlock; return ''; }],
    [isGit('worktree', 'remove'), () => { if (over.remove instanceof Error) throw over.remove; return ''; }],
    [isGit('rev-parse'), () => { if (over.revParse instanceof Error) throw over.revParse; return `${'3'.repeat(40)}\n`; }],
    [isGit('branch'), () => { if (over.branchDelete instanceof Error) throw over.branchDelete; return ''; }],
    [(c) => isGh('api')(c) && c.args[1] === '-X' && c.args[2] === 'DELETE', () => {
      if (over.deleteBranch instanceof Error) throw over.deleteBranch;
      return '';
    }],
  ];
}

// over: script (tried first), deps (replaces a dep, `undefined` removes it), labels, runState,
// integrationModel, verification, logReply, ghAvailable, decisions (decisions.md text; null = absent),
// supplier (the judgments reply), closingLinks / compose (CLI replies), title (title.txt text or
// Error), isDraft (boolean, raw string or Error), ready (an Error makes gh pr ready throw).
// Gate knobs (each may be a function, so seq() scripts a per-call sequence): prState / reread (the
// first read and the wait re-read: an object merged over the green default, a raw string or an
// Error), runs (array, raw string or Error), readyRun (an envelope object, a full {code,stdout}
// reply or an Error), labelList (`gh label list` stdout), addLabel ('noop' or an Error),
// issueComment (an Error makes the record comment throw).
// Merge-call knobs (each may be a function): labels (also per call, so seq() splits the entry read
// from the pre-merge read), prMerge (the ghCreate `pr merge` reply: '' or an Error carrying stderr),
// confirm (the confirmation read: an object merged over the MERGED default, a raw string or an Error).
// Post-merge knobs (each may be a function): fx (a fixture other than the module's, whose decisions.md
// is written and whose worktree the default listing names), postMergeRun / reconcile (full CLI replies;
// a reconcile function runs real fs moves and returns the reply), fetch / unlock / remove / revParse /
// branchDelete / deleteBranch (an Error throws), describe (stdout or an Error), worktreeList (stdout or Error).
function mergeHarness(over = {}) {
  const calls = [];
  const events = [];
  const logs = [];
  const files = {};
  const applied = [];
  const clock = { t: CLOCK_START };
  (over.fx || fx).writeDecisions(over.decisions === undefined ? CONFIRMED : over.decisions);
  const script = [...(over.script || []), ...defaultMergeScript(over, files, logs, applied)];
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

test('entry passing: the happy path merges, every entry call as specified', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'merged', reason: null, mergeCommit: MERGE_SHA, postMerge: POST_MERGE_STUB });
  assert.equal(r.runDir, CTX.runDir);
  assert.equal(r.ciWaitMs, 0);
  assert.equal(r.eventsStdoutOnly, false);
  assert.deepEqual(kindsOf(h).slice(0, 6), ['ghAvailable', 'gh', 'node', 'readFile', 'node', 'judgments']);
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
  assert.deepEqual(h.logs.filter((l) => l.step === 'Step 2.5'), []);
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
  assert.equal((await merge(CTX, ok.deps)).outcome, 'merged');
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
    assert.equal(r.outcome, 'merged', `${name}: entry passed (supplier reached, no stop)`);
    assert.ok(kindsOf(h).includes('judgments'), name);
    h.logs = h.logs.filter((l) => l.step === 'Step 2.5');
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
    assert.deepEqual(h.logs.filter((l) => l.step === 'Step 2.5'), [], value);
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
  assert.equal(r.outcome, 'merged');
  assert.ok(kindsOf(h).includes('judgments'));
  assert.match(h.events.find((e) => e.step === 'merge-entry').detail, /log:Step 2\.5/);
});

test('a thrown error is classified on its stderr, never on the argv-bearing message', async () => {
  const err = Object.assign(new Error('Command failed: node resolve-policy.js --run /x --values integration-model'), { stderr: 'HTTP 502 bad gateway\n' });
  const h = mergeHarness({ script: [[isNode('resolve-policy.js'), err]] });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'unclassified');
  assert.equal(r.detail, 'merge-entry: HTTP 502 bad gateway');
  assert.doesNotMatch(r.detail, /Command failed|--values/);
});

test('merge never throws: a throw inside a step is unclassified naming the sub-step; a throwing emit is swallowed', async () => {
  const h = mergeHarness({ script: [[isNode('resolve-policy.js'), new Error('spawn exploded')]] });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'unclassified', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /^merge-entry: spawn exploded/);
  const h2 = mergeHarness({ deps: { emit: () => { throw new Error('emit broke'); } } });
  const r2 = await merge(CTX, h2.deps);
  assert.equal(r2.outcome, 'merged');
  assert.equal(r2.runDir, CTX.runDir);
});

// ---- Task 2: closing links, subject composition, mark ready ----

const isReadyCall = (c) => c.kind === 'gh' && c.args[0] === 'pr' && c.args[1] === 'ready';
const nodeCalls = (h, name) => h.calls.filter((c) => isNode(name)(c));
const closingReply = (obj) => ({ code: 0, stdout: JSON.stringify(obj), stderr: '' });
const skipsOf = (h) => h.logs.filter((l) => l.status === 'SKIP');

test('AC4.1: the tail runs closing links, compose, the isDraft read, gh pr ready, then the gate reads in that order', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  const seq = beforePostMerge(h.calls.slice(h.calls.findIndex((c) => c.kind === 'judgments') + 1)).map((c) => (
    c.kind === 'node' ? base(c.args[0]) : c.kind === 'gh' ? `gh ${c.args.slice(0, 2).join(' ')}` : c.kind));
  assert.deepEqual(seq, ['closing-links.js', 'compose-subject.js', 'readFile', 'gh pr view', 'gh pr ready', 'log-decision.js',
    'gh pr view', 'gh run list', 'ready-run.js', 'gh issue view', 'ghCreate', 'gh pr view']);
  const cl = nodeCalls(h, 'closing-links.js')[0];
  assert.deepEqual(cl.args.slice(1), ['--run', CTX.runDir, '--mode', 'pre-merge']);
  assert.equal(cl.cwd, CTX.mainCheckout);
  assert.equal(cl.timeout, 120000);
  assert.deepEqual(cl.env, { HARNESS: '1' });
  const view = h.calls.find((c) => isGh('pr', 'view')(c));
  assert.deepEqual(view.args, ['pr', 'view', '9', '--repo', 'o/r', '--json', 'isDraft']);
  assert.deepEqual(h.calls.find(isReadyCall).args, ['pr', 'ready', '9', '--repo', 'o/r']);
  const ready = h.logs.find((l) => l.step === 'Step 2 (mark ready)');
  assert.equal(ready.status, 'AUTO');
  assert.equal(ready.text, 'undrafted PR #9 (was draft).');
  assert.equal(ready.args[ready.args.indexOf('--reversibility') + 1], 'high (gh pr ready 9 --undo)');
  for (const step of ['merge-closing-links', 'merge-compose', 'merge-ready']) {
    assert.deepEqual(h.events.filter((e) => e.step === step).map((e) => e.status), ['ok'], step);
  }
});

test('compose argv: --tag auto-merge, --pr, --out-dir under the run dir, --keep-open only when closing-links names the record', async () => {
  const outDir = path.join(CTX.runDir, 'merge-subject');
  const none = mergeHarness({ closingLinks: closingReply({ action: 'clean', keepOpen: [] }) });
  await merge(CTX, none.deps);
  const a = nodeCalls(none, 'compose-subject.js')[0];
  assert.deepEqual(a.args.slice(1), ['7', '--repo', 'o/r', '--tag', 'auto-merge', '--pr', '9', '--out-dir', outDir]);
  assert.equal(a.cwd, CTX.mainCheckout);
  assert.equal(a.timeout, 120000);
  const keep = mergeHarness({ closingLinks: closingReply({ action: 'unlinked', keepOpen: [7, 12] }) });
  await merge(CTX, keep.deps);
  assert.deepEqual(nodeCalls(keep, 'compose-subject.js')[0].args.slice(1),
    ['7', '--repo', 'o/r', '--tag', 'auto-merge', '--keep-open', '7', '--pr', '9', '--out-dir', outDir]);
  const other = mergeHarness({ closingLinks: closingReply({ action: 'unlinked', keepOpen: [12] }) });
  await merge(CTX, other.deps);
  assert.ok(!nodeCalls(other, 'compose-subject.js')[0].args.includes('--keep-open'));
  assert.equal(keep.calls.find((c) => c.kind === 'readFile' && base(c.args[0]) === 'title.txt').args[0], path.join(outDir, 'title.txt'));
});

test('closing links: still-linked is left for post-merge Step 4.0 and named in the event; no SKIP', async () => {
  const h = mergeHarness({ closingLinks: closingReply({ action: 'still-linked', keepOpen: [7] }) });
  await merge(CTX, h.deps);
  const e = h.events.find((x) => x.step === 'merge-closing-links');
  assert.equal(e.status, 'ok');
  assert.match(e.detail, /still-linked.*post-merge Step 4\.0/);
  assert.ok(nodeCalls(h, 'compose-subject.js')[0].args.includes('--keep-open'));
  assert.deepEqual(skipsOf(h), []);
});

test('closing-links exit 3 warns, logs a SKIP and proceeds; exit 5 proceeds without a second SKIP', async () => {
  const skipText = (code) => `condition: closing-links.js exited ${code} → fallback: closing links not checked this merge`;
  const three = mergeHarness({ closingLinks: { code: 3, stdout: '', stderr: 'run dir not anchored' } });
  const r3 = await merge(CTX, three.deps);
  assert.equal(r3.outcome, 'merged');
  assert.ok(!nodeCalls(three, 'compose-subject.js')[0].args.includes('--keep-open'));
  assert.equal(skipsOf(three).length, 1);
  assert.equal(skipsOf(three)[0].step, 'Closing links (pre-merge) (degraded)');
  assert.equal(skipsOf(three)[0].text, skipText(3));
  const ri = skipsOf(three)[0].args.indexOf('--reversibility');
  assert.equal(skipsOf(three)[0].args[ri + 1], 'n/a');
  const ev3 = three.events.find((e) => e.step === 'merge-closing-links');
  assert.equal(ev3.status, 'ok');
  assert.match(ev3.detail, /exit 3/);
  for (const code of [4, 5]) {
    const h = mergeHarness({ closingLinks: { code, stdout: '', stderr: 'self-logged' } });
    await merge(CTX, h.deps);
    assert.deepEqual(skipsOf(h), [], `exit ${code} is self-logged by closing-links.js`);
    const ev = h.events.find((e) => e.step === 'merge-closing-links');
    assert.equal(ev.status, 'ok');
    assert.match(ev.detail, new RegExp(`exit ${code}`));
  }
  const seven = mergeHarness({ closingLinks: { code: 7, stdout: '', stderr: 'x' } });
  await merge(CTX, seven.deps);
  assert.equal(skipsOf(seven)[0].text, skipText(7));
  const nul = mergeHarness({ closingLinks: { code: null, stdout: '', stderr: 'timed out' } });
  await merge(CTX, nul.deps);
  assert.equal(skipsOf(nul).length, 1);
});

test('closing links: exit-0 degraded results proceed with keepOpen [] and log one SKIP, except gh-absent (self-logged by the CLI)', async () => {
  const rows = [
    [closingReply({ action: 'gh-absent', keepOpen: [7] }), null],
    [closingReply({ action: 'no-pr', keepOpen: [7] }), /exited 0 with action no-pr →/],
    [closingReply({ action: 'no-fixes-span', keepOpen: [7] }), /exited 0 with action no-fixes-span →/],
    [closingReply({ action: 'mystery', keepOpen: [7] }), /exited 0 with action mystery →/],
    [{ code: 0, stdout: 'not json', stderr: '' }, /exited 0 with unparseable output →/],
    [{ code: 0, stdout: JSON.stringify({ action: 'clean' }), stderr: '' }, /exited 0 with action clean →/],
    [{ code: 0, stdout: 'null', stderr: '' }, /exited 0 with unparseable output →/],
  ];
  for (const [closingLinks, skip] of rows) {
    const h = mergeHarness({ closingLinks });
    const r = await merge(CTX, h.deps);
    assert.equal(r.outcome, 'merged', JSON.stringify(closingLinks));
    assert.ok(!nodeCalls(h, 'compose-subject.js')[0].args.includes('--keep-open'), JSON.stringify(closingLinks));
    assert.equal(h.events.find((e) => e.step === 'merge-closing-links').status, 'ok');
    const skips = skipsOf(h);
    if (!skip) {
      assert.deepEqual(skips, [], 'gh-absent is self-logged by closing-links.js');
      continue;
    }
    assert.equal(skips.length, 1, JSON.stringify(closingLinks));
    assert.equal(skips[0].step, 'Closing links (pre-merge) (degraded)');
    assert.match(skips[0].text, skip);
    assert.match(skips[0].text, /fallback: closing links not checked this merge$/);
    assert.equal(skips[0].args[skips[0].args.indexOf('--reversibility') + 1], 'n/a');
  }
});

test('AC7.1: compose-subject exit 1 is compose-refused with the reduced stderr line, PR still draft', async () => {
  const h = mergeHarness({ compose: { code: 1, stdout: '', stderr: 'compose-subject.js: record(s) #7 carry no non-empty "## Release Note" section\nsecond line\n' } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'compose-refused', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /carry no non-empty/);
  assert.doesNotMatch(r.detail, /second line|"|#7/);
  assert.ok(!h.calls.some(isReadyCall), 'no gh pr ready recorded');
  assert.ok(!h.calls.some((c) => isGh('pr', 'view')(c)), 'the isDraft read comes after compose');
  assertNoReadyNoMerge(h);
  assert.deepEqual(h.events.filter((e) => e.step === 'merge-compose').map((e) => e.status), ['stop']);
});

test('AC11.10: compose-subject exit 2 is gh-absent, no ready', async () => {
  const h = mergeHarness({ compose: { code: 2, stdout: '', stderr: 'compose-subject.js: origin host "git.example.com" has no GitHub signal\nmore\n' } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'gh-absent', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /origin host .*git\.example\.com.* has no GitHub signal/);
  assert.doesNotMatch(r.detail, /more|"/);
  const bare = mergeHarness({ compose: { code: 2, stdout: '', stderr: '' } });
  assert.equal((await merge(CTX, bare.deps)).detail, 'compose-subject.js could not use gh');
  assertNoReadyNoMerge(h);
});

test('compose: exit 3, another exit or a timeout is unclassified naming the exit; empty or unreadable title.txt is unclassified', async () => {
  for (const code of [3, 9, null]) {
    const h = mergeHarness({ compose: { code, stdout: '', stderr: 'read failed' } });
    const r = await merge(CTX, h.deps);
    assert.equal(r.reason, 'unclassified');
    assert.equal(r.detail, `compose: compose-subject.js exited ${code}`);
    assertNoReadyNoMerge(h);
  }
  for (const title of ['', '  \n', new Error('ENOENT')]) {
    const h = mergeHarness({ title });
    const r = await merge(CTX, h.deps);
    assert.equal(r.reason, 'unclassified');
    assert.match(r.detail, /^compose: .*title/);
    assertNoReadyNoMerge(h);
  }
});

test('compose: the composed event carries the title.txt text, never the single-quoted stdout line', async () => {
  const h = mergeHarness({ title: 'feat: a title\n', compose: { code: 0, stdout: "SUBJECT_TITLE='from stdout'\n", stderr: '' } });
  await merge(CTX, h.deps);
  const ev = h.events.find((e) => e.step === 'merge-compose');
  assert.equal(ev.status, 'ok');
  assert.doesNotMatch(ev.detail, /from stdout/);
});

test('AC4.3: an already-ready PR skips gh pr ready and logs the skip', async () => {
  const h = mergeHarness({ isDraft: false });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.ok(!h.calls.some(isReadyCall));
  const l = h.logs.find((x) => x.step === 'Step 2 (mark ready)');
  assert.equal(l.status, 'AUTO');
  assert.equal(l.text, 'PR #9 already ready — skipped gh pr ready.');
  assert.equal(l.args[l.args.indexOf('--reversibility') + 1], 'n/a (no state change)');
});

test('AC4.4: a failed isDraft read, a non-boolean isDraft or a failed gh pr ready is ready-failed and no merge call', async () => {
  const readyErr = Object.assign(new Error('Command failed: gh pr ready 9 --repo o/r'), { stderr: 'GraphQL: Resource not accessible\n' });
  const rows = [
    [{ isDraft: new Error('HTTP 502') }, /isDraft/],
    [{ isDraft: 'not json' }, /isDraft/],
    [{ isDraft: '{"isDraft":"yes"}' }, /isDraft/],
    [{ isDraft: '{}' }, /isDraft/],
    [{ isDraft: 'null' }, /isDraft/],
    [{ isDraft: true, ready: readyErr }, /Resource not accessible/],
  ];
  for (const [over, detail] of rows) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'ready-failed', mergeCommit: null, postMerge: null }, JSON.stringify(over));
    assert.match(r.detail, detail);
    assert.doesNotMatch(r.detail, /Command failed|--repo/);
    assert.ok(!h.calls.some(isMergeCall));
    const last = h.events[h.events.length - 1];
    assert.deepEqual([last.step, last.status], ['merge-ready', 'stop']);
    assert.ok(!h.logs.some((l) => l.step === 'Step 2 (mark ready)'), 'no AUTO line for a failed ready');
  }
});

test('mark ready: compose precedes ready, and a failed log write never stops the step', async () => {
  const h = mergeHarness({ logReply: { code: 1, stdout: '', stderr: 'x' } });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  const order = h.calls.map((c) => (c.kind === 'node' ? base(c.args[0]) : isReadyCall(c) ? 'ready' : null)).filter(Boolean);
  assert.ok(order.indexOf('compose-subject.js') < order.indexOf('ready'));
  assert.match(h.events.find((e) => e.step === 'merge-ready').detail, /log:Step 2 \(mark ready\)/);
});

// ---- Task 3: the merge-verification gate, Red path, Conflict path ----

const isGateRead = (c) => isGh('pr', 'view')(c) && c.args.includes(GATE_FIELDS);
const isReread = (c) => isGh('pr', 'view')(c) && c.args.includes(REREAD_FIELDS);
const isUndo = (c) => isReadyCall(c) && c.args.includes('--undo');
const isParkCall = (c) => ['label', 'issue'].includes(c.args[0]) && ['list', 'create', 'edit', 'comment'].includes(c.args[1]);
const WAIT = leverReply({ value: 'wait', source: 'run-config' });
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const PARKED_DESC = 'Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact';
const FAILING_CHECK = { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u' };
const PENDING_CHECK = { ...GREEN_CHECK, status: 'IN_PROGRESS', conclusion: null };
const B = 'b'.repeat(40);
const lastEvent = (h) => h.events[h.events.length - 1];
// The mode of the last merge call a run made: --auto (merge-when-green) or immediate; null for none.
const modeOf = (h) => {
  const m = h.calls.filter(isMergeCall);
  if (!m.length) return null;
  return m[m.length - 1].args.includes('--auto') ? 'auto' : 'immediate';
};
const shortOf = (c) => (c.kind === 'node' ? base(c.args[0]) : c.kind === 'gh' ? `gh ${c.args.slice(0, 2).join(' ')}` : c.kind);
// Calls after the first match, up to the post-merge sequence (which the Task 6 tests below read in full via afterAll).
const beforePostMerge = (calls) => {
  const pm = calls.findIndex(isNode('post-merge-run.js'));
  return pm === -1 ? calls : calls.slice(0, pm);
};
const afterAll = (h, pred) => h.calls.slice(h.calls.findIndex(pred) + 1);
const after = (h, pred) => {
  const rest = afterAll(h, pred);
  const pm = rest.findIndex(isNode('post-merge-run.js'));
  return pm === -1 ? rest : rest.slice(0, pm);
};
const noMerge = (h) => assert.ok(!h.calls.some(isMergeCall), 'no gh pr merge');

test('AC4.2: the gate reads state, the head runs and ready-run, each as specified', async () => {
  const h = mergeHarness();
  await merge(CTX, h.deps);
  assert.equal(modeOf(h), 'auto');
  const g = h.calls.findIndex(isGateRead);
  assert.deepEqual(h.calls[g].args, ['pr', 'view', '9', '--repo', 'o/r', '--json', GATE_FIELDS]);
  assert.deepEqual(h.calls[g + 1].args,
    ['run', 'list', '--repo', 'o/r', '--commit', CTX.head, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']);
  const rr = h.calls[g + 2];
  assert.equal(base(rr.args[0]), 'ready-run.js');
  assert.deepEqual(rr.args.slice(1), ['--pr', '9', '--sha', CTX.head]);
  assert.equal(rr.cwd, CTX.mainCheckout);
  assert.equal(rr.timeout, 120000);
  assert.deepEqual(rr.env, { HARNESS: '1' });
  assert.deepEqual(beforePostMerge(h.calls.slice(g + 3)).map(shortOf), ['gh issue view', 'ghCreate', 'gh pr view'],
    'then the pre-merge label read, the merge call and the confirmation read');
  assert.deepEqual(h.events.filter((e) => e.step === 'merge-gate').map((e) => e.status), ['ok']);
  assert.match(h.events.find((e) => e.step === 'merge-gate').detail, /green/);
});

test('AC5.1–AC5.6: red, draft-skip and read failures never merge', async () => {
  const failingRun = (workflowName, conclusion = 'failure') => ({ name: workflowName, workflowName, status: 'completed', conclusion, url: 'u' });
  const parks = [
    // [name, over, reason, parkComment's names/files]
    ['rollup FAILURE', { prState: { statusCheckRollup: [GREEN_CHECK, FAILING_CHECK] } }, 'check-failed:unit', { names: ['unit'] }],
    ['rollup red beats a pending entry', { prState: { statusCheckRollup: [PENDING_CHECK, FAILING_CHECK] } }, 'check-failed:unit', { names: ['unit'] }],
    ['status context ERROR', { prState: { statusCheckRollup: [{ context: 'ci/legacy', state: 'ERROR', targetUrl: 'u' }] } }, 'check-failed:ci/legacy', { names: ['ci/legacy'] }],
    ['head run completed/failure', { runs: [GREEN_RUN, failingRun('lint')] }, 'check-failed:lint', { names: ['lint'] }],
    ['head run completed/timed_out', { runs: [failingRun('build', 'timed_out')] }, 'check-failed:build', { names: ['build'] }],
    ['ready-run red', { readyRun: { state: 'red', failing: [{ name: 'e2e', url: 'u' }], draftSkipWithoutReadyTrigger: [] } }, 'check-failed:e2e', { names: ['e2e'] }],
    ['names de-duplicated, rollup then runs then ready-run', {
      prState: { statusCheckRollup: [{ ...FAILING_CHECK, name: 'lint' }] },
      runs: [failingRun('lint')],
      readyRun: { state: 'red', failing: [{ name: 'lint' }, { name: 'e2e' }], draftSkipWithoutReadyTrigger: [] },
    }, 'check-failed:lint,e2e', { names: ['lint', 'e2e'] }],
    ['draft-skip', { readyRun: { state: 'draft-skip-without-ready-trigger', failing: [], draftSkipWithoutReadyTrigger: ['.github/workflows/test.yml'] } },
      'draft-skip-without-ready-trigger:.github/workflows/test.yml', { files: ['.github/workflows/test.yml'] }],
    ['red beats draft-skip', {
      prState: { statusCheckRollup: [FAILING_CHECK] },
      readyRun: { state: 'draft-skip-without-ready-trigger', failing: [], draftSkipWithoutReadyTrigger: ['.github/workflows/test.yml'] },
    }, 'check-failed:unit', { names: ['unit'] }],
    ['ready-run red with no failing names', { readyRun: { state: 'red', failing: [], draftSkipWithoutReadyTrigger: [] } },
      'check-failed:unnamed', { names: ['unnamed'] }],
  ];
  for (const [name, over, reason, info] of parks) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason, mergeCommit: null, postMerge: null }, name);
    noMerge(h);
    assert.ok(!h.calls.some(isUndo), `${name}: PR not re-drafted`);
    assert.ok(!h.calls.some((c) => isGh('pr', 'comment')(c)), `${name}: no PR comment`);
    assert.deepEqual(afterAll(h, (c) => c.kind === 'node' && base(c.args[0]) === 'ready-run.js').map(shortOf),
      ['gh label list', 'gh issue edit', 'gh issue view', 'gh issue comment', 'log-decision.js'], name);
    assert.deepEqual(h.calls.find((c) => isGh('issue', 'edit')(c)).args, ['issue', 'edit', '--repo', 'o/r', '--add-label', 'bot:parked', '--', '7']);
    const comments = h.calls.filter((c) => isGh('issue', 'comment')(c));
    assert.equal(comments.length, 1, name);
    const body = parkComment({ value: 'merge-when-green', reason, pr: 9, ...info });
    assert.deepEqual(comments[0].args, ['issue', 'comment', '--repo', 'o/r', '--body', body, '--', '7'], name);
    assert.match(body, info.files ? /Resume once its workflow is fixed or a post-ready run lands\.$/ : /Resume once green\.$/, name);
    const log = h.logs.find((l) => l.step === 'Step 2.5 (merge-verification gate)');
    assert.equal(log.status, 'AUTO');
    assert.equal(log.text, `parked — ${reason} on PR #9; bot:parked applied to #7`, name);
    assert.equal(log.args[log.args.indexOf('--reversibility') + 1], 'high (label removal + resume)');
    assert.equal(log.args[log.args.indexOf('--lever') + 1], 'merge-verification=merge-when-green (run-config)');
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-park', 'stop'], name);
    assert.ok(!h.events.some((e) => e.step === 'merge-call'), name);
  }
  // The literal comment, so the template is pinned apart from parkComment itself.
  const lit = mergeHarness({ prState: { statusCheckRollup: [FAILING_CHECK] } });
  await merge(CTX, lit.deps);
  assert.equal(lit.calls.find((c) => isGh('issue', 'comment')(c)).args[5],
    'Parked by merge-verification (merge-when-green): unit on PR #9. Resume once green.');

  const failures = [
    ['state read throws', { prState: new Error('HTTP 502') }],
    ['state read unparseable', { prState: 'not json' }],
    ['state read without a rollup list', { prState: { statusCheckRollup: null } }],
    ['state read without headRefOid', { prState: { headRefOid: null } }],
    ['state read without mergeable', { prState: { mergeable: 7 } }],
    ['run list throws', { runs: new Error('HTTP 502') }],
    ['run list not an array', { runs: '{"runs":[]}' }],
    ['run list unparseable', { runs: 'nope' }],
    ['ready-run exit 2', { readyRun: { code: 2, stdout: '', stderr: 'usage' } }],
    ['ready-run timed out', { readyRun: { code: null, stdout: '', stderr: '' } }],
    ['ready-run read-failed', { readyRun: { state: 'read-failed', reason: 'timeline read failed' } }],
    ['ready-run without a state', { readyRun: { failing: [] } }],
    ['ready-run unparseable', { readyRun: { code: 0, stdout: 'nope', stderr: '' } }],
    ['ready-run unknown state', { readyRun: { state: 'mystery' } }],
  ];
  for (const [name, over] of failures) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'state-read-failed', mergeCommit: null, postMerge: null }, name);
    assert.ok(!h.calls.some(isParkCall), `${name}: parks nothing`);
    assert.ok(!h.calls.some(isUndo), name);
    noMerge(h);
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-gate', 'stop'], name);
  }
  // A ready-run read-failed names its own reason in the detail.
  const rf = mergeHarness({ readyRun: { state: 'read-failed', reason: 'timeline read failed' } });
  assert.equal((await merge(CTX, rf.deps)).detail, 'ready-run read-failed: timeline read failed');
  for (const state of ['CLOSED', 'MERGED']) {
    const h = mergeHarness({ prState: { state, statusCheckRollup: [FAILING_CHECK] } });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'pr-not-open', mergeCommit: null, postMerge: null }, state);
    // CLOSED is named in other words (prStateWords), though neutralize would now keep a bare `closed`.
    assert.equal(r.detail, state === 'CLOSED' ? 'PR state shut, not merged' : 'PR state MERGED', state);
    assert.deepEqual(afterAll(h, isGateRead), [], `${state}: no further call`);
    noMerge(h);
  }
});

test('AC5.7: label still missing after one retry re-drafts the PR and says so', async () => {
  for (const [addLabel, error] of [['noop', 'label missing after retry'], [new Error('HTTP 502'), 'label add failed: HTTP 502']]) {
    const h = mergeHarness({ prState: { statusCheckRollup: [FAILING_CHECK] }, addLabel });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'check-failed:unit', mergeCommit: null, postMerge: null });
    assert.deepEqual(afterAll(h, (c) => c.kind === 'node' && base(c.args[0]) === 'ready-run.js').map(shortOf),
      ['gh label list', 'gh issue edit', 'gh issue view', 'gh issue edit', 'gh issue view', 'gh pr ready', 'gh issue comment', 'log-decision.js']);
    const undos = h.calls.filter(isUndo);
    assert.equal(undos.length, 1);
    assert.deepEqual(undos[0].args, ['pr', 'ready', '9', '--repo', 'o/r', '--undo']);
    const ev = h.events.find((e) => e.step === 'merge-park');
    assert.equal(ev.status, 'stop');
    assert.match(ev.detail, /bot:parked NOT applied/);
    assert.match(ev.detail, /re-drafted/);
    assert.equal(h.logs.find((l) => l.step === 'Step 2.5 (merge-verification gate)').text,
      `parked — check-failed:unit on PR #9; bot:parked NOT applied to #7 (${error}); PR re-drafted as the fallback lock`);
    noMerge(h);
  }
  // Applied on the retry: no re-draft.
  const retry = mergeHarness({ prState: { statusCheckRollup: [FAILING_CHECK] }, addLabel: seq('noop', undefined) });
  await merge(CTX, retry.deps);
  assert.equal(retry.calls.filter((c) => isGh('issue', 'edit')(c)).length, 2);
  assert.ok(!retry.calls.some(isUndo));
  assert.equal(retry.logs.find((l) => l.step === 'Step 2.5 (merge-verification gate)').text,
    'parked — check-failed:unit on PR #9; bot:parked applied to #7');
});

test('AC5.8: bot:parked is bootstrapped (label create) when the repo lacks it', async () => {
  for (const labelList of ['', 'bot:parked-old\n']) {
    const h = mergeHarness({ prState: { statusCheckRollup: [FAILING_CHECK] }, labelList });
    await merge(CTX, h.deps);
    assert.deepEqual(h.calls.find((c) => isGh('label', 'list')(c)).args,
      ['label', 'list', '--repo', 'o/r', '--search', 'bot:parked', '--json', 'name', '-q', '.[].name']);
    const create = h.calls.findIndex((c) => isGh('label', 'create')(c));
    assert.deepEqual(h.calls[create].args,
      ['label', 'create', 'bot:parked', '--repo', 'o/r', '--color', '6A737D', '--description', PARKED_DESC], JSON.stringify(labelList));
    assert.ok(create < h.calls.findIndex((c) => isGh('issue', 'edit')(c)), 'created before the add');
  }
  const present = mergeHarness({ prState: { statusCheckRollup: [FAILING_CHECK] } });
  await merge(CTX, present.deps);
  assert.ok(!present.calls.some((c) => isGh('label', 'create')(c)));
});

test('park: a failed bootstrap read or record comment never changes the reason, and the event names it', async () => {
  const h = mergeHarness({
    prState: { statusCheckRollup: [FAILING_CHECK] },
    issueComment: Object.assign(new Error('Command failed: gh issue comment --body x'), { stderr: 'HTTP 502\n' }),
    script: [[isGh('label', 'list'), new Error('HTTP 500')]],
  });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'check-failed:unit', mergeCommit: null, postMerge: null });
  assert.ok(h.calls.some((c) => isGh('issue', 'edit')(c)), 'the add still runs');
  assert.ok(!h.calls.some(isUndo), 'the add landed, so no fallback');
  const ev = h.events.find((e) => e.step === 'merge-park');
  assert.match(ev.detail, /label bootstrap failed/);
  assert.match(ev.detail, /record comment failed: HTTP 502/);
  assert.doesNotMatch(ev.detail, /Command failed|--body/);
  noMerge(h);
});

test('AC6.1: DIRTY or CONFLICTING on the first read is conflict: one PR comment, no further call', async () => {
  const text = 'Merge stopped: PR #9 conflicts with main. The driver does not update a conflicting branch; resolve the conflict and run the record again.';
  assert.equal(conflictComment({ pr: 9, base: 'main' }), text);
  const rows = [{ mergeStateStatus: 'DIRTY' }, { mergeable: 'CONFLICTING' }, { mergeStateStatus: 'DIRTY', statusCheckRollup: [FAILING_CHECK] }];
  for (const lever of [undefined, WAIT]) {
    for (const prState of rows) {
      const h = mergeHarness({ prState, verification: lever });
      const r = await merge(CTX, h.deps);
      assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'conflict', mergeCommit: null, postMerge: null }, JSON.stringify(prState));
      assert.deepEqual(afterAll(h, isGateRead).map((c) => [c.kind, c.args]), [['gh', ['pr', 'comment', '--repo', 'o/r', '--body', text, '--', '9']]]);
      assert.ok(!h.calls.some((c) => c.kind === 'git'));
      assert.ok(!h.calls.some(isUndo), 'PR left ready');
      assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-conflict', 'stop']);
    }
  }
  // AC6: "on any read" — a DIRTY wait re-read is conflict too.
  const w = mergeHarness({ verification: WAIT, reread: { mergeStateStatus: 'DIRTY' } });
  const r = await merge(CTX, w.deps);
  assert.equal(r.reason, 'conflict');
  assert.deepEqual(afterAll(w, isReread).map((c) => c.args), [['pr', 'comment', '--repo', 'o/r', '--body', text, '--', '9']]);
  // A failed comment still stops as conflict, and the event says the comment failed.
  const f = mergeHarness({ prState: { mergeable: 'CONFLICTING' }, script: [[isGh('pr', 'comment'), new Error('HTTP 502')]] });
  assert.equal((await merge(CTX, f.deps)).reason, 'conflict');
  assert.match(lastEvent(f).detail, /PR comment failed/);
});

test('AC9.1: a first read whose headRefOid differs from ctx.head is moving-target, no merge call', async () => {
  for (const lever of [undefined, WAIT]) {
    const h = mergeHarness({ prState: { headRefOid: B }, verification: lever });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'moving-target', mergeCommit: null, postMerge: null });
    assert.deepEqual(afterAll(h, isGateRead), []);
    assert.ok(!h.events.some((e) => e.step === 'merge-call'));
    noMerge(h);
  }
});

test('AC9.2: a head change between the first read and the re-read re-enters once and then merges (wait)', async () => {
  const h = mergeHarness({ verification: WAIT, reread: seq({ headRefOid: B }, {}) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.equal(modeOf(h), 'immediate');
  assert.equal(nodeCalls(h, 'compose-subject.js').length, 2, 'initial before ready, and the re-entry');
  // The re-entry recomposes only after its own first read's guards pass, before the handoff.
  assert.deepEqual(after(h, (c) => isReadyCall(c)).map(shortOf), [
    'log-decision.js', 'gh pr view', 'gh run list', 'ready-run.js', 'gh pr view',
    'gh pr view', 'gh run list', 'ready-run.js', 'compose-subject.js', 'readFile', 'gh pr view',
    'gh issue view', 'ghCreate', 'gh pr view',
  ]);
  assert.equal(h.calls.filter(isGateRead).length, 2);
  assert.equal(h.calls.filter(isReread).length, 2);
  assert.equal(h.calls.filter(isReadyCall).length, 1, 'the re-entry does not mark ready again');
  assert.ok(h.events.some((e) => e.step === 'merge-gate' && /re-enter/.test(e.detail)));
  // A state no longer OPEN on the re-read re-enters too; the re-entry's first read decides.
  const m = mergeHarness({ verification: WAIT, reread: { state: 'MERGED' }, prState: seq({}, { state: 'MERGED' }) });
  assert.equal((await merge(CTX, m.deps)).reason, 'pr-not-open');
  assert.equal(nodeCalls(m, 'compose-subject.js').length, 1, 'a re-entry that stops composes nothing');
  assert.equal(m.calls.filter(isReread).length, 1);
  // The re-entry's first read must again equal ctx.head.
  const moved = mergeHarness({ verification: WAIT, reread: { headRefOid: B }, prState: seq({}, { headRefOid: B }) });
  assert.equal((await merge(CTX, moved.deps)).reason, 'moving-target');
  assert.equal(moved.calls.filter(isGateRead).length, 2);
  assert.equal(nodeCalls(moved, 'compose-subject.js').length, 1, 'a re-entry that stops composes nothing');
  // A re-entry that parks composes nothing either.
  const parked = mergeHarness({ verification: WAIT, reread: { headRefOid: B }, prState: seq({}, { statusCheckRollup: [FAILING_CHECK] }) });
  assert.equal((await merge(CTX, parked.deps)).reason, 'check-failed:unit');
  assert.equal(nodeCalls(parked, 'compose-subject.js').length, 1);
  // A compose refusal on re-entry returns its reason with the PR ready, and the event says so.
  const refused = mergeHarness({
    verification: WAIT, reread: seq({ headRefOid: B }, {}),
    compose: seq({ code: 0, stdout: '', stderr: '' }, { code: 1, stdout: '', stderr: 'compose-subject.js: no type label\n' }),
  });
  const rr = await merge(CTX, refused.deps);
  assert.equal(rr.reason, 'compose-refused');
  assert.ok(!refused.calls.some(isUndo));
  assert.equal(refused.calls.filter(isGateRead).length, 2, 'the recompose follows the re-entry read');
  assert.equal(refused.calls.filter(isReread).length, 1, 'a refusal hands off nothing');
  const stops = refused.events.filter((e) => e.step === 'merge-compose');
  assert.deepEqual(stops.map((e) => e.status), ['ok', 'stop']);
  assert.match(stops[1].detail, /re-entry.*PR left ready/);
  noMerge(refused);
});

test('AC9.3: two changes return moving-target', async () => {
  const h = mergeHarness({ verification: WAIT, reread: { headRefOid: B } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'moving-target', mergeCommit: null, postMerge: null });
  assert.equal(h.calls.filter(isGateRead).length, 2);
  assert.equal(h.calls.filter(isReread).length, 2);
  assert.equal(nodeCalls(h, 'compose-subject.js').length, 2);
  assert.deepEqual(afterAll(h, (c) => h.calls.filter(isReread)[1] === c), []);
  assert.ok(!h.events.some((e) => e.step === 'merge-call'));
  noMerge(h);
});

test('AC8.2: merge-when-green pending with BLOCKED arms; pending with CLEAN runs the wait row (watch)', async () => {
  const green = mergeHarness();
  await merge(CTX, green.deps);
  assert.equal(modeOf(green), 'auto');
  assert.ok(!green.calls.some(isReread));
  const blocked = mergeHarness({ prState: { statusCheckRollup: [PENDING_CHECK], mergeStateStatus: 'BLOCKED' } });
  await merge(CTX, blocked.deps);
  assert.equal(modeOf(blocked), 'auto');
  assert.ok(!blocked.calls.some(isReread));
  const pendings = [
    ['a rollup entry not COMPLETED', { prState: { statusCheckRollup: [PENDING_CHECK] } }],
    ['an empty rollup', { prState: { statusCheckRollup: [] } }],
    ['a head run not completed', { runs: [{ ...GREEN_RUN, status: 'in_progress', conclusion: '' }] }],
    ['ready-run awaiting', { readyRun: { state: 'awaiting', failing: [], draftSkipWithoutReadyTrigger: [] } }],
    ['a status context PENDING', { prState: { statusCheckRollup: [{ context: 'ci/x', state: 'PENDING' }] } }],
  ];
  for (const [name, over] of pendings) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    // Pending and not BLOCKED: the wait row's bounded watch, which these constant reads never leave.
    assert.equal(r.reason, 'checks-pending-timeout', name);
    assert.ok(!h.calls.some(isReread), name);
    assert.ok(h.calls.some(isParkCall), name);
    noMerge(h);
  }
  // A not-applicable ready-run is no requirement: green.
  const na = mergeHarness({ readyRun: { state: 'not-applicable', failing: [], draftSkipWithoutReadyTrigger: [] } });
  await merge(CTX, na.deps);
  assert.equal(modeOf(na), 'auto');
});

test('AC8.3: wait re-reads state and compares the head before the immediate merge', async () => {
  const h = mergeHarness({ verification: WAIT });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.equal(modeOf(h), 'immediate');
  const rereads = h.calls.filter(isReread);
  assert.equal(rereads.length, 1);
  assert.deepEqual(rereads[0].args, ['pr', 'view', '9', '--repo', 'o/r', '--json', REREAD_FIELDS]);
  assert.ok(h.calls.indexOf(rereads[0]) > h.calls.findIndex((c) => isNode('ready-run.js')(c)));
  assert.deepEqual(after(h, isReread).map(shortOf), ['gh issue view', 'ghCreate', 'gh pr view'],
    'the re-read is the last state read before the merge call');
  assert.ok(!h.calls.some((c) => c.args.includes('--auto')));
  // A re-read that fails is state-read-failed, no merge.
  const f = mergeHarness({ verification: WAIT, reread: new Error('HTTP 502') });
  assert.equal((await merge(CTX, f.deps)).reason, 'state-read-failed');
  const g = mergeHarness({ verification: WAIT, reread: '{"state":"OPEN"}' });
  assert.equal((await merge(CTX, g.deps)).reason, 'state-read-failed');
  // wait never arms: a BLOCKED pending read watches.
  const blocked = mergeHarness({ verification: WAIT, prState: { statusCheckRollup: [PENDING_CHECK], mergeStateStatus: 'BLOCKED' } });
  assert.equal((await merge(CTX, blocked.deps)).reason, 'checks-pending-timeout');
  noMerge(blocked);
});

test('AC8.4: a state read always precedes the first merge call under every lever value', async () => {
  const levers = [
    leverReply({ value: 'merge-when-green', source: 'run-config' }),
    WAIT,
    leverReply({ value: 'off', source: 'run-config' }),
    leverReply({ value: '', source: 'default' }),
    { code: 1, stdout: '', stderr: 'resolver failed' },
  ];
  for (const verification of levers) {
    const h = mergeHarness({ verification });
    await merge(CTX, h.deps);
    assert.ok(modeOf(h), JSON.stringify(verification));
    const steps = h.events.map((e) => e.step);
    assert.ok(steps.indexOf('merge-gate') >= 0 && steps.indexOf('merge-gate') < steps.indexOf('merge-call'), JSON.stringify(verification));
    assert.ok(h.calls.some(isGateRead));
    if (modeOf(h) === 'immediate') assert.ok(h.calls.some(isReread), 'wait re-reads before the immediate merge');
  }
});

test('parkComment and conflictComment are fixed templates with reduced free text', () => {
  assert.equal(parkComment({ value: 'wait', reason: 'check-failed:unit,lint', pr: 9, names: ['unit', 'lint'] }),
    'Parked by merge-verification (wait): unit, lint on PR #9. Resume once green.');
  assert.equal(parkComment({ value: 'merge-when-green', reason: 'checks-pending-timeout', pr: 9 }),
    'Parked by merge-verification (merge-when-green): checks still pending after 15m on PR #9. Resume once green.');
  assert.equal(parkComment({ value: 'wait', reason: 'draft-skip-without-ready-trigger:.github/workflows/test.yml', pr: 9, files: ['.github/workflows/test.yml'] }),
    'Parked by merge-verification (wait): .github/workflows/test.yml skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md) on PR #9. Resume once its workflow is fixed or a post-ready run lands.');
  for (const value of ['off', '', undefined, 'closes #5']) {
    assert.match(parkComment({ value, reason: 'checks-pending-timeout', pr: 9 }), /^Parked by merge-verification \(wait\): /);
  }
  const hostile = parkComment({ value: 'wait', reason: 'check-failed:x', pr: 9, names: ['@octo `x` closes #5'] });
  assert.doesNotMatch(hostile, /@|`|#5/);
  assert.doesNotMatch(conflictComment({ pr: 9, base: '@octo/main #5' }), /@|#5/);
});

// ---- Task 4: the bounded watch (AC10, AC5's pending-timeout and read-failure clauses, AC8.2's BLOCKED arm) ----

const WATCH_POLLS = Math.ceil(MERGE_WATCH_BOUND_MS / MERGE_WATCH_POLL_MS);
const PENDING = { statusCheckRollup: [PENDING_CHECK] };
const GREEN = {};
const C = 'c'.repeat(40);
// A harness whose sleep records its argument; a poll's sleeps are the polls made.
function watchHarness(over) {
  const h = mergeHarness(over);
  const sleeps = [];
  const watchClock = [];
  const realSleep = h.deps.sleep;
  h.deps.sleep = async (ms) => { sleeps.push(ms); return realSleep(ms); };
  h.deps.watchClock = (v) => { watchClock.push(v); };
  return { ...h, sleeps, watchClock };
}
const parkLabelAdds = (h) => h.calls.filter((c) => isGh('issue', 'edit')(c) && c.args.includes('bot:parked'));
const mergeCalls = (h) => h.calls.filter(isMergeCall);

test('AC10.1: the watch constants are 15 minutes and 30 seconds', () => {
  assert.equal(MERGE_WATCH_BOUND_MS, 15 * 60 * 1000);
  assert.equal(MERGE_WATCH_POLL_MS, 30 * 1000);
});

test('AC10.2: a PR that turns conflicting mid-watch returns conflict at that poll, not checks-pending-timeout', async () => {
  for (const state of [{ mergeStateStatus: 'DIRTY' }, { mergeable: 'CONFLICTING' }]) {
    const h = watchHarness({ verification: WAIT, prState: seq(PENDING, PENDING, PENDING, { ...PENDING, ...state }) });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'conflict', mergeCommit: null, postMerge: null });
    assert.equal(h.sleeps.length, 3);
    assert.equal(h.calls.filter(isGateRead).length, 4, 'the first read and three polls');
    // The conflicting poll decides before the checks are read: only the PR comment follows its read.
    assert.deepEqual(afterAll(h, (c) => h.calls.filter(isGateRead)[3] === c).map(shortOf), ['gh pr comment']);
    assert.ok(!h.calls.some((c) => isGh('issue', 'edit')(c)), 'nothing parked');
    noMerge(h);
  }
});

test('AC10.3: a red result at any poll takes the Red path at once', async () => {
  const h = watchHarness({ verification: WAIT, prState: seq(PENDING, PENDING, { statusCheckRollup: [FAILING_CHECK] }) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'check-failed:unit');
  assert.equal(h.sleeps.length, 2);
  assert.equal(parkLabelAdds(h).length, 1);
  assert.ok(!h.calls.some(isUndo));
  noMerge(h);
  // A draft-skip workflow found at a poll parks the same way.
  const d = watchHarness({
    verification: WAIT,
    readyRun: seq(
      { state: 'awaiting', failing: [], draftSkipWithoutReadyTrigger: [] },
      { state: 'draft-skip-without-ready-trigger', failing: [], draftSkipWithoutReadyTrigger: ['.github/workflows/t.yml'] },
    ),
    prState: PENDING,
  });
  const dr = await merge(CTX, d.deps);
  assert.equal(dr.reason, 'draft-skip-without-ready-trigger:.github/workflows/t.yml');
  assert.equal(d.sleeps.length, 1);
  noMerge(d);
});

test('AC10.4: still pending at the bound parks as checks-pending-timeout after WATCH_POLLS polls', async () => {
  for (const verification of [WAIT, undefined]) {
    const h = watchHarness({ verification, prState: PENDING });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'checks-pending-timeout', mergeCommit: null, postMerge: null });
    assert.equal(h.sleeps.length, WATCH_POLLS);
    assert.ok(h.sleeps.every((ms) => ms === MERGE_WATCH_POLL_MS));
    assert.equal(parkLabelAdds(h).length, 1);
    const comment = h.calls.find((c) => isGh('issue', 'comment')(c));
    const body = comment.args[comment.args.indexOf('--body') + 1];
    assert.equal(body, parkComment({ value: verification ? 'wait' : 'merge-when-green', reason: 'checks-pending-timeout', pr: 9 }));
    // The minutes in the comment agree with the bound the watch waits.
    assert.match(body, new RegExp(`after ${MERGE_WATCH_BOUND_MS / 60000}m`));
    assert.ok(!h.calls.some(isUndo), 'the PR is left ready');
    noMerge(h);
  }
});

test('AC10.5: watch time is reported as ciWaitMs, on the result and on the exit event', async () => {
  const h = watchHarness({ verification: WAIT, prState: seq(PENDING, PENDING, PENDING, GREEN) });
  const r = await merge(CTX, h.deps);
  assert.equal(h.sleeps.length, 3);
  assert.ok(r.ciWaitMs >= 3 * MERGE_WATCH_POLL_MS, `ciWaitMs ${r.ciWaitMs}`);
  const watchEvents = h.events.filter((e) => e.step === 'merge-watch');
  assert.equal(watchEvents.length, 1);
  assert.equal(watchEvents[0].extra.ciWaitMs, r.ciWaitMs);
  // The watch clock is armed with the start and cleared on exit.
  assert.equal(h.watchClock.length, 2);
  assert.equal(typeof h.watchClock[0], 'number');
  assert.equal(h.watchClock[1], null);
  // Every kind of exit clears it, and a gate that never watches reports no CI wait.
  const t = watchHarness({ verification: WAIT, prState: PENDING });
  const tr = await merge(CTX, t.deps);
  assert.ok(tr.ciWaitMs >= WATCH_POLLS * MERGE_WATCH_POLL_MS);
  assert.equal(t.watchClock[t.watchClock.length - 1], null);
  const none = watchHarness({ verification: WAIT });
  assert.equal((await merge(CTX, none.deps)).ciWaitMs, 0);
  assert.equal(none.watchClock.length, 0);
});

test('AC5.9: a read failure during the watch is checks-read-failed and parks nothing', async () => {
  const cases = [
    ['the state read throws', { prState: seq(PENDING, new Error('HTTP 502')) }],
    ['the state read is unusable', { prState: seq(PENDING, '{"state":"OPEN"}') }],
    ['the head-runs read throws', { prState: PENDING, runs: seq(undefined, new Error('HTTP 502')) }],
    ['ready-run read-failed', { prState: PENDING, readyRun: seq(undefined, { state: 'read-failed', reason: 'x' }) }],
    ['ready-run exits non-zero', { prState: PENDING, readyRun: seq(undefined, { code: 3, stdout: '', stderr: '' }) }],
  ];
  for (const [name, over] of cases) {
    const h = watchHarness({ verification: WAIT, ...over });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'checks-read-failed', mergeCommit: null, postMerge: null }, name);
    assert.equal(h.sleeps.length, 1, name);
    assert.ok(!h.calls.some((c) => isGh('issue', 'edit')(c) || isGh('issue', 'comment')(c) || isUndo(c)), `${name}: parks nothing`);
    // The stop the watch itself returns still reports its time: one stop event carrying ciWaitMs.
    const stops = h.events.filter((e) => e.step === 'merge-watch');
    assert.equal(stops.length, 1, name);
    assert.equal(stops[0].status, 'stop', name);
    assert.ok(stops[0].extra.ciWaitMs > 0, name);
    assert.equal(stops[0].extra.ciWaitMs, r.ciWaitMs, name);
    noMerge(h);
  }
});

test('watch: a green poll re-reads and merges immediately (no --auto)', async () => {
  const w = watchHarness({ verification: WAIT, prState: seq(PENDING, GREEN) });
  await merge(CTX, w.deps);
  assert.equal(modeOf(w), 'immediate');
  assert.equal(w.sleeps.length, 1);
  assert.equal(w.calls.filter(isReread).length, 1);
  assert.ok(!w.calls.some((c) => c.args.includes('--auto')));
  // A pending read that was not BLOCKED ran the wait row, so even under merge-when-green its green poll
  // merges immediately after a re-read, never via --auto.
  const m = watchHarness({ prState: seq(PENDING, GREEN) });
  await merge(CTX, m.deps);
  assert.equal(modeOf(m), 'immediate');
  assert.equal(m.calls.filter(isReread).length, 1);
});

test('AC8.2: under merge-when-green a pending poll that reads BLOCKED arms (--auto), under wait it keeps watching', async () => {
  const BLOCKED = { ...PENDING, mergeStateStatus: 'BLOCKED' };
  const mwg = watchHarness({ prState: seq(PENDING, PENDING, BLOCKED) });
  await merge(CTX, mwg.deps);
  assert.equal(modeOf(mwg), 'auto');
  assert.equal(mwg.sleeps.length, 2, 'armed at poll 2, no further sleep');
  assert.ok(!mwg.calls.some(isReread));
  assert.ok(!mwg.calls.some(isParkCall));
  const wait = watchHarness({ verification: WAIT, prState: seq(PENDING, BLOCKED, BLOCKED, GREEN) });
  await merge(CTX, wait.deps);
  assert.equal(modeOf(wait), 'immediate');
  assert.equal(wait.sleeps.length, 3, 'wait never arms on BLOCKED');
  assert.ok(!wait.calls.some((c) => c.args.includes('--auto')));
});

test('watch: an interrupt during a sleep makes no further call', async () => {
  const h = watchHarness({ verification: WAIT, prState: PENDING });
  let seenAtInterrupt = null;
  h.deps.interrupted = () => {
    if (h.sleeps.length < 1) return null;
    if (seenAtInterrupt === null) seenAtInterrupt = h.calls.length;
    return 'SIGTERM';
  };
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'unclassified');
  assert.equal(r.detail, 'watch: interrupted');
  assert.equal(h.sleeps.length, 1);
  assert.equal(h.calls.length, seenAtInterrupt, 'no gh, node or file call after the interrupted sleep');
  assert.equal(h.watchClock[h.watchClock.length - 1], null);
  assert.ok(!h.events.some((e) => e.step === 'merge-watch'), 'an interrupted watch emits nothing after the handler');
  assert.equal(r.ciWaitMs > 0, true, 'the time is still summed on the result');
  noMerge(h);
});

test('watch: a throw inside the watch emits a fail merge-watch event carrying ciWaitMs and is unclassified', async () => {
  const h = watchHarness({ verification: WAIT, prState: PENDING });
  const realSleep = h.deps.sleep;
  let n = 0;
  h.deps.sleep = async (ms) => {
    await realSleep(ms);
    n += 1;
    if (n === 2) throw new Error('sleep rejected');
  };
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'pending-review');
  assert.equal(r.reason, 'unclassified');
  assert.match(r.detail, /^merge-watch: /);
  const ev = h.events.filter((e) => e.step === 'merge-watch');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].status, 'fail');
  assert.ok(ev[0].extra.ciWaitMs >= 2 * MERGE_WATCH_POLL_MS);
  assert.equal(ev[0].extra.ciWaitMs, r.ciWaitMs);
  assert.equal(h.watchClock[h.watchClock.length - 1], null);
  noMerge(h);
});

test('watch: a head change mid-watch re-enters the gate once; a second change is moving-target', async () => {
  // Compares s.lastRead's head with the poll's: a lastRead overwritten before the comparison never re-enters.
  const h = watchHarness({ verification: WAIT, prState: seq(PENDING, { ...PENDING, headRefOid: B }, PENDING, GREEN) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.equal(modeOf(h), 'immediate');
  assert.equal(nodeCalls(h, 'compose-subject.js').length, 2, 'the re-entry recomposes once');
  assert.ok(h.events.some((e) => e.step === 'merge-watch' && /re-entering the gate once/.test(e.detail)));
  assert.equal(h.sleeps.length, 2, 'one poll before the change, one after the re-entry');
  assert.equal(h.events.filter((e) => e.step === 'merge-watch').length, 2, 'each watch reports its own CI wait');
  assert.equal(h.calls.filter(isReadyCall).length, 1);
  assert.equal(mergeCalls(h).length, 1, 'one merge, after the re-entry');
  const two = watchHarness({ verification: WAIT, prState: seq(PENDING, { ...PENDING, headRefOid: B }, PENDING, { ...PENDING, headRefOid: C }) });
  const tr = await merge(CTX, two.deps);
  assert.deepEqual(pick(tr), { outcome: 'pending-review', reason: 'moving-target', mergeCommit: null, postMerge: null });
  assert.equal(two.sleeps.length, 2);
  assert.ok(!two.calls.some(isParkCall));
  noMerge(two);
  const watchStops = two.events.filter((e) => e.step === 'merge-watch' && e.status === 'stop');
  assert.equal(watchStops.length, 1, 'the second watch ends in a stop event');
  assert.ok(watchStops[0].extra.ciWaitMs > 0);
  // The ciWaitMs of both watches is summed.
  assert.ok(tr.ciWaitMs >= 2 * MERGE_WATCH_POLL_MS);
  // A change onto a head that is not the verified one is moving-target at the re-entry's first read.
  const off = watchHarness({ verification: WAIT, prState: seq(PENDING, { ...PENDING, headRefOid: B }, { ...PENDING, headRefOid: B }) });
  assert.equal((await merge(CTX, off.deps)).reason, 'moving-target');
});

test('watch: a PR no longer OPEN mid-watch re-enters, and the gate reports pr-not-open', async () => {
  const h = watchHarness({ verification: WAIT, prState: seq(PENDING, { state: 'MERGED' }, { state: 'MERGED' }) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'pr-not-open');
  assert.equal(nodeCalls(h, 'compose-subject.js').length, 1, 'a re-entry that stops composes nothing');
  assert.ok(!h.calls.some(isParkCall));
  noMerge(h);
});

test('watch: under merge-when-green a red poll parks and makes no merge call', async () => {
  const h = watchHarness({ prState: seq(PENDING, PENDING, { statusCheckRollup: [FAILING_CHECK] }) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'check-failed:unit');
  assert.equal(mergeCalls(h).length, 0);
});

// ---- Task 5: Step 3's merge call, failure signatures and confirmation (AC11, AC1.4, AC1.5, AC4, AC9.4) ----

// Fixture stderr literals — source: _shared/pr-first-merge.md Step 3 (items 1–5)
const SIG = {
  notAllowed: 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)',
  protectedRules: 'GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)',
  cleanStatus: 'GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)',
  mutationOnly: 'GraphQL: something unexpected (enablePullRequestAutoMerge)',
  checks: 'X Pull request o/r#9 is not mergeable: the base branch policy requires 1 required status check.',
  permission: 'HTTP 403: Resource not accessible by integration',
  conflict: 'X Pull request o/r#9 is not mergeable: the merge commit cannot be cleanly created (conflict).',
  conflictWithMutation: 'GraphQL: Pull request is not mergeable: conflict (enablePullRequestAutoMerge)',
  unknown: 'some brand new failure',
};
// A failed gh call as execFileSync throws it: the message carries the whole argv (the title
// included); gh's own words are on stderr.
const ghErr = (stderr) => Object.assign(new Error(`Command failed: gh pr merge 9 --repo o/r --squash -t ${TITLE}`), { stderr: `${stderr}\n` });
const argAfter = (c, flags) => flags.map((f) => (c.args.includes(f) ? c.args[c.args.indexOf(f) + 1] : undefined));
const isConfirmRead = (c) => isGh('pr', 'view')(c) && c.args.includes(CONFIRM_FIELDS);
const isLabelRead = isGh('issue', 'view');
const AUTO_MERGE = [{ name: 'auto:merge' }];
const ARMED = { state: 'OPEN', mergedAt: null, autoMergeRequest: { enabledAt: '2026-11-13T09:30:00Z', mergeMethod: 'SQUASH' }, mergeCommit: null };
const BLOCKED_PENDING = { ...PENDING, mergeStateStatus: 'BLOCKED' };
const BODY_FILE = path.join(CTX.runDir, 'merge-subject', 'body.md');
const ARMED_LOG = 'armed — forge holds the merge (mergeStateStatus BLOCKED, checks pending) on PR #9; reconciler completes cleanup on merged evidence.';

// Each recorded call from the supplier call on, as a short label; log-decision.js calls are dropped.
function sequenceFromSupplier(calls) {
  return calls.slice(Math.max(0, calls.findIndex((c) => c.kind === 'judgments'))).filter((c) => !isNode('log-decision.js')(c)).map((c) => {
    if (c.kind === 'judgments') return 'judgments';
    if (c.kind === 'readFile') return `readFile ${base(c.args[0])}`;
    if (c.kind === 'node') {
      const name = base(c.args[0]);
      return `${name} ${c.args.slice(1, name === 'ready-run.js' ? 3 : 2).join(' ')}`;
    }
    const a = c.args;
    const json = a.includes('--json') ? a[a.indexOf('--json') + 1] : null;
    if (isMergeCall(c)) return `${c.kind} pr merge ${a[2]} ${a.filter((x) => x === '--auto' || x === '--squash').join(' ')}`;
    if (a[0] === 'pr' && a[1] === 'view') return `gh pr view ${json}`;
    if (a[0] === 'issue' && a[1] === 'view') return `gh issue view ${a[2]} ${json}`;
    if (a[0] === 'run' && a[1] === 'list') return 'gh run list --commit';
    if (a[0] === 'pr' && a[1] === 'ready') return `gh pr ready ${a[2]}`;
    if (c.kind === 'git') return `git ${a.slice(2).join(' ')}`;
    if (a[0] === 'pr' && a[1] === 'comment') return 'gh pr comment --body-file';
    return `${c.kind} ${describeArgs(a)}`;
  });
}

test('AC11.1: the auto-not-allowed signatures degrade to the wait row — a state read before an immediate merge', async () => {
  const paraphrase = 'GraphQL: auto-merge is not enabled on this repository';
  for (const stderr of [SIG.notAllowed, SIG.protectedRules, SIG.cleanStatus, SIG.mutationOnly, paraphrase]) {
    const h = mergeHarness({ prMerge: seq(ghErr(stderr), '') });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'merged', reason: null, mergeCommit: MERGE_SHA, postMerge: POST_MERGE_STUB }, stderr);
    const [armed, immediate, ...rest] = mergeCalls(h);
    assert.deepEqual(rest, [], stderr);
    assert.ok(armed.args.includes('--auto'), stderr);
    assert.ok(!immediate.args.includes('--auto'), stderr);
    // The wait row: a fresh state read, then the pre-merge label read, then the immediate merge.
    const then = after(h, (c) => c === armed);
    assert.deepEqual(then.map(shortOf), ['gh pr view', 'gh issue view', 'ghCreate', 'gh pr view'], stderr);
    assert.ok(isReread(then[0]), stderr);
    assert.equal(nodeCalls(h, 'compose-subject.js').length, 1, 'the merge call composes nothing');
    // The degrade is a hand-off (ok), as the gate's are; the run goes on to the merge.
    const ev = h.events.filter((e) => e.step === 'merge-call');
    assert.deepEqual(ev.map((e) => e.status), ['ok', 'ok'], stderr);
    assert.match(ev[0].detail, /auto-not-allowed.*wait row/, stderr);
    assert.ok(!h.calls.some(isParkCall), stderr);
  }
  // A pending read that armed (BLOCKED) degrades into the bounded watch, never into an immediate
  // merge while checks are pending; with --auto refused the watch never arms again.
  const w = watchHarness({ prState: seq(BLOCKED_PENDING, BLOCKED_PENDING, BLOCKED_PENDING, GREEN), prMerge: seq(ghErr(SIG.notAllowed), '') });
  const wr = await merge(CTX, w.deps);
  assert.equal(wr.outcome, 'merged');
  assert.equal(w.sleeps.length, 3, 'two BLOCKED polls watched, the third poll green');
  assert.deepEqual(mergeCalls(w).map((c) => c.args.includes('--auto')), [true, false], '--auto is tried once');
  const lastGate = w.calls.filter(isGateRead).pop();
  assert.deepEqual(after(w, (c) => c === lastGate).map(shortOf),
    ['gh run list', 'ready-run.js', 'gh pr view', 'gh issue view', 'ghCreate', 'gh pr view'], 'the immediate merge follows the green poll');
  // A degrade at a late poll resumes the same watch at its original deadline (the head did not
  // change): checks-pending-timeout after WATCH_POLLS polls in all, never a fresh 15 minutes.
  const late = watchHarness({
    prState: seq(...Array(1 + WATCH_POLLS - 3).fill(PENDING), BLOCKED_PENDING, PENDING),
    prMerge: ghErr(SIG.notAllowed),
  });
  const lr = await merge(CTX, late.deps);
  assert.deepEqual(pick(lr), { outcome: 'pending-review', reason: 'checks-pending-timeout', mergeCommit: null, postMerge: null });
  assert.equal(late.sleeps.length, WATCH_POLLS, 'the bound counts from the first watch\'s start');
  assert.equal(mergeCalls(late).length, 1, 'only the refused --auto call');
  const lateWatches = late.events.filter((e) => e.step === 'merge-watch');
  assert.equal(lateWatches.length, 2, 'the interrupted watch and the resumed one each report their own time');
  // Single-counted: the result is the sum of the two watches' own times, about one bound in all.
  assert.equal(lateWatches.reduce((n, e) => n + e.extra.ciWaitMs, 0), lr.ciWaitMs);
  assert.ok(lr.ciWaitMs >= WATCH_POLLS * MERGE_WATCH_POLL_MS && lr.ciWaitMs < (WATCH_POLLS + 1) * MERGE_WATCH_POLL_MS, `ciWaitMs ${lr.ciWaitMs}`);
  // A degrade from the gate's own arm starts the watch afresh: a full WATCH_POLLS of polls.
  const fromGate = watchHarness({ prState: seq(BLOCKED_PENDING, PENDING), prMerge: ghErr(SIG.notAllowed) });
  assert.equal((await merge(CTX, fromGate.deps)).reason, 'checks-pending-timeout');
  assert.equal(fromGate.sleeps.length, WATCH_POLLS);
  // A head change re-enters the gate, which owns no running watch: when the re-entry's arm is
  // refused, its watch counts a fresh bound (as any re-entry's watch does), not the old watch's.
  const reentered = watchHarness({
    prState: seq(...Array(1 + 10).fill(PENDING), { ...PENDING, headRefOid: B }, BLOCKED_PENDING, PENDING),
    prMerge: ghErr(SIG.notAllowed),
  });
  assert.equal((await merge(CTX, reentered.deps)).reason, 'checks-pending-timeout');
  assert.equal(reentered.sleeps.length, 11 + WATCH_POLLS, 'eleven polls before the re-entry, then a full bound');
  // A re-entry after the degrade runs as wait too: no second --auto.
  const re = mergeHarness({ prMerge: seq(ghErr(SIG.notAllowed), ''), reread: seq({ headRefOid: B }, {}) });
  assert.equal((await merge(CTX, re.deps)).outcome, 'merged');
  assert.deepEqual(mergeCalls(re).map((c) => c.args.includes('--auto')), [true, false]);
  assert.equal(nodeCalls(re, 'compose-subject.js').length, 2, 'the initial compose and the re-entry recompose');
});

test('AC11.2: an immediate call never degrades again', async () => {
  const h = mergeHarness({ verification: WAIT, prMerge: ghErr(SIG.notAllowed) });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'merge-refused', mergeCommit: null, postMerge: null });
  assert.match(r.detail, /^merge-refused \(unrecognized\): /);
  assert.equal(mergeCalls(h).length, 1, 'exactly one immediate merge call');
  assert.equal(h.calls.filter(isReread).length, 1);
  assert.deepEqual(afterAll(h, isMergeCall), []);
  // After a degrade, the immediate call's own refusal is final too: --auto once, immediate once.
  const d = mergeHarness({ prMerge: ghErr(SIG.notAllowed) });
  const dr = await merge(CTX, d.deps);
  assert.equal(dr.reason, 'merge-refused');
  assert.match(dr.detail, /^merge-refused \(unrecognized\): /);
  assert.deepEqual(mergeCalls(d).map((c) => c.args.includes('--auto')), [true, false]);
});

test('AC11.3–AC11.5: checks, permission and unrecognized are merge-refused with the class named, nothing parked', async () => {
  const rows = [
    [SIG.checks, 'checks'],
    ['X Pull request o/r#9 is not mergeable: review required', 'checks'],
    [SIG.permission, 'permission'],
    ['GraphQL: Resource not accessible by integration', 'permission'],
    ['GraphQL: you must have write access to merge', 'permission'],
    [SIG.unknown, 'unrecognized'],
    ['', 'unrecognized'],
  ];
  for (const lever of [undefined, WAIT]) {
    for (const [stderr, cls] of rows) {
      const name = `${cls}: ${stderr}`;
      const h = mergeHarness({ verification: lever, prMerge: ghErr(stderr) });
      const r = await merge(CTX, h.deps);
      assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'merge-refused', mergeCommit: null, postMerge: null }, name);
      assert.ok(r.detail.startsWith(`merge-refused (${cls}): `), `${name}: ${r.detail}`);
      assert.doesNotMatch(r.detail, /Command failed|composed title/, name);
      const ev = lastEvent(h);
      assert.deepEqual([ev.step, ev.status], ['merge-call', 'stop'], name);
      assert.match(ev.detail, new RegExp(`\\(${cls}\\)`), name);
      assert.equal(mergeCalls(h).length, 1, name);
      assert.deepEqual(afterAll(h, isMergeCall), [], `${name}: no call after the refused merge`);
      assert.ok(!h.calls.some(isParkCall), `${name}: nothing parked`);
      assert.ok(!h.calls.some((c) => isGh('pr', 'comment')(c) || isUndo(c)), `${name}: no comment, no re-draft`);
    }
  }
  assert.equal((await merge(CTX, mergeHarness({ prMerge: ghErr(SIG.checks) }).deps)).detail,
    'merge-refused (checks): X Pull request o/r 9 is not mergeable: the base branch policy requires 1 required status check.');
});

test('AC11.6: a conflict wording (with or without the mutation name) returns conflict', async () => {
  const text = conflictComment({ pr: 9, base: 'main' });
  for (const lever of [undefined, WAIT]) {
    for (const stderr of [SIG.conflict, SIG.conflictWithMutation, 'GraphQL: mergeable: CONFLICTING']) {
      const h = mergeHarness({ verification: lever, prMerge: ghErr(stderr) });
      const r = await merge(CTX, h.deps);
      assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'conflict', mergeCommit: null, postMerge: null }, stderr);
      assert.deepEqual(afterAll(h, isMergeCall).map((c) => [c.kind, c.args]), [['gh', ['pr', 'comment', '--repo', 'o/r', '--body', text, '--', '9']]], stderr);
      assert.equal(mergeCalls(h).length, 1, `${stderr}: a conflict never degrades`);
      assert.ok(!h.calls.some((c) => c.kind === 'git'));
      assert.ok(!h.calls.some(isUndo), 'PR left ready');
      assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-conflict', 'stop']);
      // One stop for one stop: the merge call's event is the hand-off (ok), the conflict path stops.
      assert.deepEqual(h.events.filter((e) => e.status === 'stop').map((e) => e.step), ['merge-conflict'], stderr);
      const handoff = h.events.find((e) => e.step === 'merge-call');
      assert.deepEqual([handoff.status, /conflict path/.test(handoff.detail)], ['ok', true], stderr);
    }
  }
});

test('classifyMergeFailure order: conflict and permission beat the bare mutation name', () => {
  assert.equal(classifyMergeFailure(SIG.conflictWithMutation), 'conflict');
  assert.equal(classifyMergeFailure('HTTP 403 (enablePullRequestAutoMerge)'), 'permission');
  assert.equal(classifyMergeFailure(SIG.mutationOnly), 'auto-not-allowed');
  const table = [
    [SIG.notAllowed, 'auto-not-allowed'], [SIG.protectedRules, 'auto-not-allowed'], [SIG.cleanStatus, 'auto-not-allowed'],
    ['auto-merge is not allowed here', 'auto-not-allowed'], ['Auto-Merge not enabled', 'auto-not-allowed'],
    [SIG.checks, 'checks'], ['not mergeable: checks are failing', 'checks'], [SIG.permission, 'permission'],
    [SIG.conflict, 'conflict'], ['state CONFLICTING', 'conflict'], [SIG.unknown, 'unrecognized'], ['', 'unrecognized'],
    // `conflicting` in lower case is no CONFLICTING reason, and `not mergeable` alone names no class.
    ['the PR is conflicting', 'unrecognized'], ['not mergeable', 'unrecognized'], ['HTTP 4031', 'unrecognized'],
    // A PR or issue number 403 is no HTTP 403.
    ['X Pull request o/r#403 is not mergeable: the base branch policy requires 1 required status check.', 'checks'],
    ['record #403 has no label', 'unrecognized'], ['HTTP 403 on #403', 'permission'],
    [undefined, 'unrecognized'], [null, 'unrecognized'],
  ];
  for (const [stderr, cls] of table) assert.equal(classifyMergeFailure(stderr), cls, String(stderr));
});

test('a failed merge call is classified on its stderr, never on the argv-bearing message', async () => {
  const err = Object.assign(new Error('Command failed: gh pr merge 9 -t fix: not mergeable conflict 403 enablePullRequestAutoMerge'), { stderr: `${SIG.unknown}\n` });
  const h = mergeHarness({ prMerge: err });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'merge-refused');
  assert.equal(r.detail, 'merge-refused (unrecognized): some brand new failure');
  assert.equal(mergeCalls(h).length, 1);
  // A throw with no stderr at all (a timeout kill) is unrecognized and names no argv either.
  const t = mergeHarness({ prMerge: Object.assign(new Error('Command failed: gh pr merge 9 -t x'), { code: 'ETIMEDOUT' }) });
  const tr = await merge(CTX, t.deps);
  assert.equal(tr.reason, 'merge-refused');
  assert.match(tr.detail, /^merge-refused \(unrecognized\): .*ETIMEDOUT/);
  assert.doesNotMatch(tr.detail, /Command failed/);
});

test('AC11.7: MERGED is merged with the merge commit; OPEN with autoMergeRequest is armed; anything else merge-refused', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'merged', reason: null, mergeCommit: MERGE_SHA, postMerge: POST_MERGE_STUB });
  assert.deepEqual(h.calls.filter(isConfirmRead).map((c) => c.args), [['pr', 'view', '9', '--repo', 'o/r', '--json', CONFIRM_FIELDS]]);
  const confirmEvent = h.events.find((e) => e.step === 'merge-confirm');
  assert.deepEqual([confirmEvent.status, confirmEvent.detail], ['ok', 'merged, unit concluded SUCCESS']);
  assert.equal(r.detail, 'merged, unit concluded SUCCESS');
  // The rollup at merge time is read before the merge is reported (Step 3 item 6).
  const rollups = [
    [[], 'merged — no status checks on this PR'],
    [[GREEN_CHECK, PENDING_CHECK], 'merged — unit had not concluded at merge time'],
    [[GREEN_CHECK, { context: 'ci/legacy', state: 'SUCCESS', targetUrl: 'u' }], 'merged, unit, ci/legacy concluded SUCCESS, SUCCESS'],
    [[{ context: 'ci/legacy', state: 'PENDING' }], 'merged — ci/legacy had not concluded at merge time'],
    [null, 'merged — status checks unreadable at merge time'],
  ];
  for (const [statusCheckRollup, detail] of rollups) {
    const m = mergeHarness({ confirm: { statusCheckRollup } });
    const mr = await merge(CTX, m.deps);
    assert.equal(mr.outcome, 'merged', detail);
    assert.equal(m.events.find((e) => e.step === 'merge-confirm').detail, detail);
    assert.equal(mr.detail, detail);
  }
  // The whole name list is bounded by reduceDetail's cap (200), not each name: ~40 checks.
  const many = Array.from({ length: 40 }, (_, i) => ({ ...GREEN_CHECK, name: `integration-suite-${i}` }));
  for (const statusCheckRollup of [many, [...many, PENDING_CHECK, ...many.map((c) => ({ ...c, status: 'QUEUED', conclusion: null }))]]) {
    const m = mergeHarness({ confirm: { statusCheckRollup } });
    const d = (await merge(CTX, m.deps)).detail;
    const parts = /^merged, (.*) concluded (.*)$/.exec(d) || /^merged — (.*) had not concluded at merge time$/.exec(d);
    assert.ok(parts, d);
    for (const part of parts.slice(1)) assert.ok(part.length <= 200, `${part.length} chars`);
    assert.ok(d.length <= 2 * 200 + 'merged,  concluded '.length, `${d.length} chars`);
  }
  // A hostile check name is reduced and neutralized before it reaches the result detail.
  const hostile = mergeHarness({ confirm: { statusCheckRollup: [{ ...GREEN_CHECK, name: '@octo `x` closes #5' }] } });
  const hr = await merge(CTX, hostile.deps);
  assert.match(hr.detail, /^merged, .* concluded SUCCESS$/);
  assert.doesNotMatch(hr.detail, /@|`|#/);
  // reduceDetail has already removed the `#`, so `closes 5` links nothing and neutralize keeps the
  // bare keyword (it strips one only before a `#N` or issue/PR path); the same keyword before an
  // issue path is a link marker and goes.
  assert.equal(hr.detail, 'merged, at octo x closes 5 concluded SUCCESS');
  const linking = mergeHarness({ confirm: { statusCheckRollup: [{ ...GREEN_CHECK, name: 'closes o/r/issues/5' }] } });
  const lr = await merge(CTX, linking.deps);
  assert.equal(lr.detail, 'merged, o/r/issues/5 concluded SUCCESS');
  assert.doesNotMatch(lr.detail, /closes/i);
  for (const mergeCommit of [null, {}, { oid: '' }, 'abc']) {
    const m = mergeHarness({ confirm: { mergeCommit } });
    // No merge commit to describe: the release status is unavailable, the merge is still merged.
    assert.deepEqual(pick(await merge(CTX, m.deps)),
      { outcome: 'merged', reason: null, mergeCommit: null, postMerge: { ...POST_MERGE_STUB, failures: ['release-status'] } });
  }
  // Armed: the forge holds the merge. Logged once, nothing torn down, no post-merge.
  const a = mergeHarness({ prState: BLOCKED_PENDING, confirm: ARMED });
  const ar = await merge(CTX, a.deps);
  assert.deepEqual(pick(ar), { outcome: 'armed', reason: null, mergeCommit: null, postMerge: null });
  assert.equal(modeOf(a), 'auto');
  const log = a.logs.find((l) => l.step === 'Step 2.5 (merge-verification gate)');
  assert.equal(log.status, 'AUTO');
  assert.equal(log.text, ARMED_LOG);
  assert.equal(log.args[log.args.indexOf('--reversibility') + 1], 'high (gh pr merge --disable-auto)');
  assert.equal(log.args[log.args.indexOf('--lever') + 1], 'merge-verification=merge-when-green (run-config)');
  assert.deepEqual(afterAll(a, isConfirmRead).map(shortOf), ['log-decision.js'], 'no teardown, no post-merge');
  assert.deepEqual([lastEvent(a).step, lastEvent(a).status], ['merge-confirm', 'ok']);
  assert.match(lastEvent(a).detail, /armed/);
  // Armed from a green read says what that read showed.
  const g = mergeHarness({ confirm: ARMED });
  assert.equal((await merge(CTX, g.deps)).outcome, 'armed');
  assert.equal(g.logs.find((l) => l.step === 'Step 2.5 (merge-verification gate)').text,
    'armed — forge holds the merge (mergeStateStatus CLEAN, checks green) on PR #9; reconciler completes cleanup on merged evidence.');
  // A failed armed log never changes the outcome; the event names it.
  const lf = mergeHarness({ prState: BLOCKED_PENDING, confirm: ARMED, logReply: { code: 1, stdout: '', stderr: 'x' } });
  assert.equal((await merge(CTX, lf.deps)).outcome, 'armed');
  assert.match(lastEvent(lf).detail, /log:Step 2\.5 \(merge-verification gate\)/);
  // CLOSED is named in other words (prStateWords), though neutralize would now keep a bare `closed`.
  for (const [state, shown] of [['CLOSED', 'shut, not merged'], ['DRAFT', 'DRAFT']]) {
    const c = mergeHarness({ confirm: { state } });
    const cr = await merge(CTX, c.deps);
    assert.deepEqual(pick(cr), { outcome: 'pending-review', reason: 'merge-refused', mergeCommit: null, postMerge: null }, state);
    assert.equal(cr.detail, `confirmation read state ${shown}`);
    assert.equal(lastEvent(c).detail, `merge-refused: confirmation read state ${shown}`);
    assert.deepEqual(afterAll(c, isConfirmRead), [], state);
  }
});

test('AC11.8: exit 0 alone is never merged', async () => {
  for (const lever of [undefined, WAIT]) {
    const h = mergeHarness({ verification: lever, confirm: { state: 'OPEN', autoMergeRequest: null } });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'merge-refused', mergeCommit: null, postMerge: null });
    assert.equal(r.detail, 'confirmation read state OPEN');
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-confirm', 'stop']);
  }
});

test('AC11.9: a confirmation read that fails twice is state-read-failed, detail says unconfirmed, no post-merge call', async () => {
  for (const confirm of [new Error('HTTP 502'), 'not json', '{"state":7}', 'null']) {
    const h = mergeHarness({ confirm });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'state-read-failed', mergeCommit: null, postMerge: null }, String(confirm));
    assert.equal(r.detail, 'merge call exited 0; state unconfirmed');
    const reads = h.calls.filter(isConfirmRead);
    assert.equal(reads.length, 2, 'retried once');
    assert.deepEqual(afterAll(h, (c) => c === reads[1]), [], 'no call after the second read');
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-confirm', 'stop']);
  }
  // One failure, then a good read: merged on the retry.
  const once = mergeHarness({ confirm: seq(new Error('HTTP 502'), undefined) });
  assert.equal((await merge(CTX, once.deps)).outcome, 'merged');
  assert.equal(once.calls.filter(isConfirmRead).length, 2);
});

test('AC1.4: auto:merge removed between the two label reads is not-authorized with no merge call', async () => {
  for (const second of [[], [{ name: 'auto:merge-pending' }], [{ name: 'auto:build' }]]) {
    const h = mergeHarness({ labels: seq(AUTO_MERGE, second) });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'not-authorized', mergeCommit: null, postMerge: null }, JSON.stringify(second));
    const reads = h.calls.filter(isLabelRead);
    assert.equal(reads.length, 2);
    assert.ok(h.calls.indexOf(reads[1]) > h.calls.findIndex(isGateRead), 'the second read is the pre-merge read');
    assert.deepEqual(afterAll(h, (c) => c === reads[1]), []);
    noMerge(h);
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-call', 'stop']);
  }
  // Removed during the bounded watch: the BLOCKED poll's pre-merge read refuses.
  const w = watchHarness({ prState: seq(PENDING, PENDING, BLOCKED_PENDING), labels: seq(AUTO_MERGE, []) });
  assert.equal((await merge(CTX, w.deps)).reason, 'not-authorized');
  assert.equal(w.sleeps.length, 2);
  noMerge(w);
  // The labels are read again before every merge call: the degraded immediate call too.
  const d = mergeHarness({ prMerge: ghErr(SIG.notAllowed), labels: seq(AUTO_MERGE, AUTO_MERGE, []) });
  assert.equal((await merge(CTX, d.deps)).reason, 'not-authorized');
  assert.equal(mergeCalls(d).length, 1, 'only the --auto call went out');
  assert.equal(d.calls.filter(isLabelRead).length, 3);
});

test('AC1.5: a failed pre-merge label read is labels-unreadable with no merge call', async () => {
  for (const second of [new Error('HTTP 502'), 'not json', '{"labels":null}']) {
    const h = mergeHarness({ labels: seq(AUTO_MERGE, second) });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'labels-unreadable', mergeCommit: null, postMerge: null }, String(second));
    assert.equal(h.calls.filter(isLabelRead).length, 2);
    noMerge(h);
    assert.deepEqual([lastEvent(h).step, lastEvent(h).status], ['merge-call', 'stop']);
  }
});

test('AC9.4: every pr merge call carries --match-head-commit ctx.head — auto, immediate, degraded and re-entered paths', async () => {
  const runs = [
    ['auto', {}, ['auto']],
    ['immediate', { verification: WAIT }, ['immediate']],
    ['degraded', { prMerge: seq(ghErr(SIG.notAllowed), '') }, ['auto', 'immediate']],
    ['re-entered', { verification: WAIT, reread: seq({ headRefOid: B }, {}) }, ['immediate']],
    ['watched', { prState: seq(PENDING, BLOCKED_PENDING) }, ['auto']],
  ];
  for (const [name, over, modes] of runs) {
    const h = mergeHarness(over);
    assert.equal((await merge(CTX, h.deps)).outcome, 'merged', name);
    const calls = mergeCalls(h);
    assert.deepEqual(calls.map((c) => (c.args.includes('--auto') ? 'auto' : 'immediate')), modes, name);
    for (const c of calls) {
      assert.equal(c.kind, 'ghCreate', `${name}: the write-bound gh kind`);
      assert.deepEqual(argAfter(c, ['--match-head-commit']), [CTX.head], name);
      assert.deepEqual(argAfter(c, ['-t', '--body-file', '--repo']), [TITLE, BODY_FILE, 'o/r'], name);
      assert.ok(!c.args.includes('--admin') && !c.args.includes('--delete-branch'), name);
    }
  }
  const h = mergeHarness();
  await merge(CTX, h.deps);
  assert.deepEqual(mergeCalls(h)[0].args,
    ['pr', 'merge', '9', '--repo', 'o/r', '--auto', '--squash', '-t', TITLE, '--body-file', BODY_FILE, '--match-head-commit', CTX.head]);
});

test('AC4.1, AC4.2: the happy path calls happen in this order', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(sequenceFromSupplier(h.calls), [
    'judgments', 'closing-links.js --run', 'compose-subject.js 7', 'readFile title.txt', 'gh pr view isDraft', 'gh pr ready 9',
    'gh pr view state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup', 'gh run list --commit', 'ready-run.js --pr 9',
    'gh issue view 7 labels', 'ghCreate pr merge 9 --auto --squash',
    'gh pr view state,mergedAt,autoMergeRequest,statusCheckRollup,mergeCommit',
    'post-merge-run.js --run', 'git fetch origin main', `git describe --tags --contains --first-parent --match v* ${MERGE_SHA}`,
    'gh pr comment --body-file', 'hooks.js reconcile', `lstatType ${CTX.runDir}`,
    'git worktree list --porcelain', `git worktree unlock ${CTX.worktree}`, `git worktree remove ${CTX.worktree}`,
    'git rev-parse --verify --quiet --end-of-options refs/heads/drive-7', 'git branch -D --end-of-options drive-7',
    'gh api -X DELETE repos/o/r/git/refs/heads/drive-7',
  ]);
  const m = h.calls.find(isMergeCall);
  assert.deepEqual(argAfter(m, ['-t', '--body-file', '--match-head-commit']), [TITLE, path.join(CTX.runDir, 'merge-subject', 'body.md'), CTX.head]);
  assert.deepEqual(h.events.slice(-7).map((e) => [e.step, e.status]), [
    ['merge-call', 'ok'], ['merge-confirm', 'ok'], ['merge-post-merge', 'ok'], ['merge-release-status', 'ok'],
    ['merge-reconcile', 'ok'], ['merge-teardown', 'ok'], ['merge-delete-branch', 'ok'],
  ]);
});

// ---- Task 6: the post-merge sequence ----

const postCalls = (h) => afterAll(h, isConfirmRead).filter((c) => !isNode('log-decision.js')(c));
const failureEvents = (h) => h.events.filter((e) => e.status === 'fail');
const SEQ_AFTER_CONFIRM = [
  'post-merge-run.js --run', 'git fetch origin main', `git describe --tags --contains --first-parent --match v* ${MERGE_SHA}`,
  'gh pr comment --body-file', 'hooks.js reconcile', `lstatType ${CTX.runDir}`, 'git worktree list --porcelain', `git worktree unlock ${CTX.worktree}`,
  `git worktree remove ${CTX.worktree}`, 'git rev-parse --verify --quiet --end-of-options refs/heads/drive-7',
  'git branch -D --end-of-options drive-7', 'gh api -X DELETE repos/o/r/git/refs/heads/drive-7',
];

test('AC12.1: on merged the post-merge sequence runs in order', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'merged', reason: null, mergeCommit: MERGE_SHA, postMerge: POST_MERGE_STUB });
  assert.deepEqual(sequenceFromSupplier(postCalls(h)), SEQ_AFTER_CONFIRM);
  const by = (name) => postCalls(h).find((c) => (c.kind === 'node' ? base(c.args[0]) : '') === name);
  assert.deepEqual(by('post-merge-run.js').args.slice(1), ['--run', CTX.runDir]);
  const rc = by('hooks.js');
  assert.deepEqual(rc.args.slice(1), ['reconcile', '--checks', 'mirror,release,archive']);
  assert.ok(rc.timeout >= 150000, `reconcile timeout ${rc.timeout}`);
  assert.equal(rc.cwd, CTX.mainCheckout);
  assert.equal(RECONCILE_TIMEOUT_MS, 150000);
  // Every git call is `git -C {main} …` run in the main checkout; only the fetch writes to the remote.
  const gits = postCalls(h).filter((c) => c.kind === 'git');
  assert.equal(gits.length, 7);
  for (const g of gits) {
    assert.deepEqual(g.args.slice(0, 2), ['-C', CTX.mainCheckout]);
    assert.equal(g.cwd, CTX.mainCheckout);
    assert.equal(g.remoteWrite === true, g.args[2] === 'fetch', g.args.join(' '));
  }
  // The worktree is removed without a force flag, and the branch deleted behind --end-of-options.
  assert.ok(!gits.some((g) => g.args.includes('--force') || g.args.includes('-f')));
  assert.deepEqual(failureEvents(h), []);
  assert.equal(r.eventsStdoutOnly, false);
  assert.equal(r.runDir, CTX.runDir);
});

test('AC12.2: a failure in any post-merge call stays merged and is listed', async () => {
  const gitFail = (stderr, status = 128) => Object.assign(new Error(`Command failed: git -C /x ${stderr}`), { stderr: `${stderr}\n`, status });
  const rows = [
    ['post-merge-run exit 3', { postMergeRun: { code: 3, stdout: '', stderr: 'x' } }, 'post-merge-run', 'merge-post-merge'],
    ['post-merge-run unparseable', { postMergeRun: { code: 0, stdout: 'nope', stderr: '' } }, 'post-merge-run', 'merge-post-merge'],
    ['post-merge-run no verdict', { postMergeRun: { code: 0, stdout: '{"action":"ran"}', stderr: '' } }, 'post-merge-run', 'merge-post-merge'],
    ['post-merge-run throws', { postMergeRun: new Error('spawn failed') }, 'post-merge-run', 'merge-post-merge'],
    ['describe fails generically', { describe: gitFail('fatal: bad object') }, 'release-status', 'merge-release-status'],
    ['fetch fails', { fetch: gitFail('fatal: could not read from remote') }, 'release-status', 'merge-release-status'],
    ['run comment fails', { script: [[isGh('pr', 'comment'), new Error('boom')]] }, 'release-status-comment', 'merge-release-status'],
    ['reconcile code null', { reconcile: { code: null, stdout: '', stderr: '' } }, 'reconcile', 'merge-reconcile'],
    ['reconcile exit 1', { reconcile: { code: 1, stdout: '', stderr: 'x' } }, 'reconcile', 'merge-reconcile'],
    ['worktree remove throws', { remove: gitFail('fatal: contains modified or untracked files') }, 'teardown-worktree', 'merge-teardown'],
    ['worktree list throws', { worktreeList: gitFail('fatal: not a git repository') }, 'teardown-worktree', 'merge-teardown'],
    ['branch -D throws', { branchDelete: gitFail('error: branch not fully merged') }, 'teardown-branch', 'merge-teardown'],
    ['rev-parse fails other than 1', { revParse: gitFail('fatal: bad', 128) }, 'teardown-branch', 'merge-teardown'],
    ['DELETE throws HTTP 500', { deleteBranch: Object.assign(new Error('Command failed'), { stderr: 'gh: Server Error (HTTP 500)\n' }) }, 'delete-branch', 'merge-delete-branch'],
  ];
  for (const [name, over, failure, step] of rows) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.equal(r.outcome, 'merged', name);
    assert.equal(r.mergeCommit, MERGE_SHA, name);
    assert.ok(r.postMerge.failures.includes(failure), `${name}: ${JSON.stringify(r.postMerge.failures)}`);
    assert.ok(failureEvents(h).some((e) => e.step === step), name);
    // The run keeps going: the later sub-steps still ran (the delete only when its worktree is gone).
    assert.ok(h.events.some((e) => e.step === 'merge-delete-branch'), name);
  }
  // A failed describe or fetch posts no comment, and logs the reason once.
  for (const over of [{ describe: gitFail('fatal: bad object') }, { fetch: gitFail('fatal: no remote') }]) {
    const h = mergeHarness(over);
    await merge(CTX, h.deps);
    assert.ok(!h.calls.some((c) => isGh('pr', 'comment')(c)));
    assert.match(h.logs.find((l) => l.step === 'pr-first-merge Step 4.1').text, /^release status unavailable \(.+\)$/);
  }
  const noFetchDescribe = mergeHarness({ fetch: gitFail('fatal: no remote') });
  await merge(CTX, noFetchDescribe.deps);
  assert.ok(!noFetchDescribe.calls.some(isGit('describe')), 'no describe after a failed fetch');
  // No merge commit: nothing to describe, a failure, no git release call.
  const nm = mergeHarness({ confirm: { mergeCommit: null } });
  const nr = await merge(CTX, nm.deps);
  assert.equal(nr.outcome, 'merged');
  assert.ok(nr.postMerge.failures.includes('release-status'));
  assert.ok(!nm.calls.some(isGit('fetch')) && !nm.calls.some(isGit('describe')));
  // A post-merge-run `failed` verdict is carried, and is not a `failures` entry.
  const fv = mergeHarness({ postMergeRun: { code: 0, stdout: JSON.stringify({ verdict: 'failed', failedSteps: ['4.0', '4.0b'], next: 'none' }), stderr: '' } });
  const fr = await merge(CTX, fv.deps);
  assert.deepEqual(fr.postMerge, { verdict: 'failed', failedSteps: ['4.0', '4.0b'], failures: [] });
  const ev = failureEvents(fv).find((e) => e.step === 'merge-post-merge');
  assert.deepEqual([ev.extra.verdict, ev.extra.failedSteps], ['failed', ['4.0', '4.0b']]);
  // already-done and in-flight are not failures either.
  for (const verdict of ['already-done', 'in-flight']) {
    const v = mergeHarness({ postMergeRun: { code: 0, stdout: JSON.stringify({ verdict, next: 'none' }), stderr: '' } });
    assert.deepEqual((await merge(CTX, v.deps)).postMerge, { verdict, failedSteps: [], failures: [] });
  }
  // A throw out of a sub-step (here the git dep itself) is that sub-step's failure.
  const th = mergeHarness({ deps: { git: () => { throw new Error('git dep exploded'); } } });
  const tr = await merge(CTX, th.deps);
  assert.equal(tr.outcome, 'merged');
  assert.deepEqual(tr.postMerge.failures, ['release-status', 'teardown-worktree', 'delete-branch: worktree kept']);
});

test('AC12.3: the remote delete never targets the integration branch', async () => {
  for (const branch of ['main', '']) {
    const h = mergeHarness();
    const r = await merge({ ...CTX, branch }, h.deps);
    assert.equal(r.outcome, 'merged');
    assert.ok(!h.calls.some((c) => isGh('api')(c)), `no DELETE for branch ${JSON.stringify(branch)}`);
    assert.ok(r.postMerge.failures.includes('delete-branch: refused (integration branch)'), JSON.stringify(r.postMerge.failures));
    assert.ok(!h.calls.some(isGit('branch')), 'the local integration branch is never deleted either');
  }
});

test('AC12.4: "Reference does not exist" counts as success', async () => {
  for (const stderr of ['gh: Reference does not exist (HTTP 422)\n', 'REFERENCE DOES NOT EXIST\n']) {
    const h = mergeHarness({ deleteBranch: Object.assign(new Error('Command failed: gh api -X DELETE'), { stderr }) });
    const r = await merge(CTX, h.deps);
    assert.deepEqual(r.postMerge, POST_MERGE_STUB, stderr);
    assert.deepEqual(failureEvents(h), []);
  }
  // The phrase is matched on stderr, never on the argv-bearing message.
  const m = mergeHarness({ deleteBranch: Object.assign(new Error('Reference does not exist'), { stderr: 'gh: Server Error (HTTP 500)\n' }) });
  assert.deepEqual((await merge(CTX, m.deps)).postMerge.failures, ['delete-branch']);
});

test('AC12.5: the release-status comment carries the run-comment marker and the human line', async () => {
  const cases = [
    [{ describe: 'v6.170.0~2\n' }, 'already carried by v6.170.0'],
    [{ describe: 'v6.170.0^0\n' }, 'already carried by v6.170.0'],
    [{ describe: 'v6.170.0\n' }, 'already carried by v6.170.0'],
    [{ describe: Object.assign(new Error('Command failed'), { stderr: "fatal: cannot describe 'abc'\n", status: 128 }) }, 'not yet in a release — bump pending'],
  ];
  for (const [over, line] of cases) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.deepEqual(r.postMerge, POST_MERGE_STUB, line);
    const c = h.calls.find((x) => isGh('pr', 'comment')(x));
    assert.deepEqual(c.args, ['pr', 'comment', '9', '--repo', 'o/r', '--body-file', path.join(CTX.runDir, 'release-status-comment.md')]);
    assert.equal(h.files[c.args[6]], `<!-- run-comment: release-status -->\n${line}\n`);
    assert.equal(h.logs.find((l) => l.step === 'pr-first-merge Step 4.1').text, `release status — ${line}.`);
  }
  // A describe that prints something that is not a tag is unavailable, never a public comment.
  const odd = mergeHarness({ describe: 'not a tag @octo\n' });
  assert.deepEqual((await merge(CTX, odd.deps)).postMerge.failures, ['release-status']);
  assert.ok(!odd.calls.some((c) => isGh('pr', 'comment')(c)));
});

// A fixture of its own: these tests move or delete the run directory for real.
function movingFixture(reply) {
  const f = fixture();
  const archive = path.join(f.main, '.claude-tweaks', 'pipelines', 'archive', path.basename(f.runDir));
  const h = mergeHarness({ fx: f, reconcile: () => { reply(f, archive); return { code: 0, stdout: '', stderr: '' }; } });
  const order = [];
  h.deps.rebindEvents = (dir) => { h.events.push({ step: 'REBIND', dir }); order.push(dir); };
  return { f, archive, h, order };
}
const logRunArgs = (h, from) => h.calls.slice(from).filter(isNode('log-decision.js')).map((c) => c.args[c.args.indexOf('--run') + 1]);
const reconcileAt = (h) => h.calls.findIndex(isNode('hooks.js'));

test('AC12.6: after reconcile archives the run dir, later writes and runDir follow the archive', async () => {
  const { f, archive, h, order } = movingFixture((fx2, arch) => {
    fs.mkdirSync(path.dirname(arch), { recursive: true });
    fs.renameSync(fx2.runDir, arch);
  });
  const r = await merge(f.ctx, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.runDir, archive);
  assert.equal(r.eventsStdoutOnly, false);
  assert.deepEqual(order, [archive]);
  const names = h.events.map((e) => e.step);
  assert.ok(names.indexOf('REBIND') < names.indexOf('merge-reconcile'), 'rebind before the reconcile event');
  // post-merge-run.js and the release log ran on the original path, before the move.
  assert.deepEqual(h.calls.find(isNode('post-merge-run.js')).args.slice(1), ['--run', f.runDir]);
  const later = logRunArgs(h, reconcileAt(h));
  assert.ok(later.length >= 2, 'the teardown and remote-delete lines were written after reconcile');
  assert.ok(later.every((p) => p === archive), JSON.stringify(later));
  const lines = Object.keys(h.files).filter((p) => /merge-log-\d+\.txt$/.test(p));
  assert.ok(lines.some((p) => path.dirname(p) === archive), 'a decision text file lives in the archive dir');
  assert.deepEqual(r.postMerge, POST_MERGE_STUB);
});

test('AC12.7: neither path existing sends the final event to stdout only', async () => {
  const { f, h, order } = movingFixture((fx2) => { fs.rmSync(fx2.runDir, { recursive: true, force: true }); });
  const r = await merge(f.ctx, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.equal(typeof r.runDir, 'string');
  assert.equal(r.runDir, f.runDir);
  assert.equal(r.eventsStdoutOnly, true);
  assert.deepEqual(order, [null]);
  assert.deepEqual(logRunArgs(h, reconcileAt(h)), [], 'no log-decision call after reconcile');
  const logged = h.calls.filter(isNode('log-decision.js')).length;
  assert.equal(Object.keys(h.files).filter((p) => /merge-log-\d+\.txt$/.test(p)).length, logged, 'no decision text file is written either');
  // Each skipped decision line is named, and the sequence still finished.
  const teardown = h.events.find((e) => e.step === 'merge-teardown');
  assert.match(teardown.detail, /log:Step 4 \(teardown\)/);
  assert.deepEqual(r.postMerge, POST_MERGE_STUB);
  assert.deepEqual(h.calls.slice(reconcileAt(h) + 1).filter((c) => c.kind === 'gh').map((c) => c.args[0]), ['api']);
});

test('reconcile follow reads lstatType as an object: a directory keeps the path, a file at the path does not count', async () => {
  // The shape the real dep answers (path-guard's lstatType), through the harness's real-fs wrapper.
  const sample = mergeHarness();
  assert.deepEqual(sample.deps.lstatType(fx.runDir), { type: 'directory', code: null });
  assert.deepEqual(sample.deps.lstatType(path.join(fx.runDir, 'absent')), { type: 'missing', code: 'ENOENT' });
  // A directory at the run-dir path: kept, no rebind to anything else.
  const kept = movingFixture(() => {});
  const kr = await merge(kept.f.ctx, kept.h.deps);
  assert.equal(kr.runDir, kept.f.runDir);
  assert.equal(kr.eventsStdoutOnly, false);
  assert.deepEqual(kept.order, [kept.f.runDir]);
  // A file where the run dir was, and a directory at the archive path: the archive wins.
  const swapped = movingFixture((fx2, arch) => {
    fs.rmSync(fx2.runDir, { recursive: true, force: true });
    fs.writeFileSync(fx2.runDir, 'not a directory');
    fs.mkdirSync(arch, { recursive: true });
  });
  const sr = await merge(swapped.f.ctx, swapped.h.deps);
  assert.equal(sr.runDir, swapped.archive);
  assert.equal(sr.eventsStdoutOnly, false);
  // A file at the run-dir path and nothing at the archive: neither counts.
  const none = movingFixture((fx2) => {
    fs.rmSync(fx2.runDir, { recursive: true, force: true });
    fs.writeFileSync(fx2.runDir, 'not a directory');
  });
  const nr = await merge(none.f.ctx, none.h.deps);
  assert.deepEqual([nr.runDir, nr.eventsStdoutOnly], [none.f.runDir, true]);
  // A lstat that throws is "not there", never a throw out of merge.
  const th = mergeHarness({ deps: { lstatType: () => { throw new Error('lstat exploded'); } } });
  const tr = await merge(CTX, th.deps);
  assert.deepEqual([tr.outcome, tr.runDir, tr.eventsStdoutOnly], ['merged', CTX.runDir, true]);
});

test('AC12.8: a failed or timed-out reconcile keeps the original path', async () => {
  for (const reconcile of [{ code: null, stdout: '', stderr: '' }, { code: 1, stdout: '', stderr: 'x' }]) {
    const rebinds = [];
    const h = mergeHarness({ reconcile, deps: { rebindEvents: (d) => rebinds.push(d) } });
    const r = await merge(CTX, h.deps);
    assert.equal(r.outcome, 'merged');
    assert.equal(r.runDir, CTX.runDir);
    assert.equal(r.eventsStdoutOnly, false);
    assert.deepEqual(rebinds, []);
    assert.deepEqual(r.postMerge.failures, ['reconcile']);
    assert.ok(logRunArgs(h, reconcileAt(h)).every((p) => p === CTX.runDir));
    // The teardown still ran after the failed reconcile.
    assert.ok(h.calls.some(isGit('worktree', 'remove')));
  }
});

test('teardown: a worktree that refuses removal stays, is named, and the branch and remote delete are skipped', async () => {
  const stderr = 'fatal: contains modified or untracked files, use --force to delete it\n';
  const h = mergeHarness({ remove: Object.assign(new Error('Command failed: git -C x worktree remove'), { stderr, status: 128 }) });
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(r.postMerge.failures, ['teardown-worktree', 'delete-branch: worktree kept']);
  const rm = h.calls.find(isGit('worktree', 'remove'));
  assert.deepEqual(rm.args, ['-C', CTX.mainCheckout, 'worktree', 'remove', CTX.worktree], 'no force flag');
  assert.ok(!h.calls.some(isGit('rev-parse')) && !h.calls.some(isGit('branch')));
  assert.ok(!h.calls.some((c) => isGh('api')(c)));
  const ev = h.events.find((e) => e.step === 'merge-teardown');
  assert.equal(ev.status, 'fail');
  assert.ok(ev.detail.includes(CTX.worktree), ev.detail);
  assert.match(ev.detail, /modified or untracked/);
});

test('teardown: unlock tolerates "not locked", an absent worktree is already gone, rev-parse status 1 skips branch -D', async () => {
  const notLocked = mergeHarness({ unlock: Object.assign(new Error('Command failed'), { stderr: 'fatal: The working tree is not locked\n', status: 128 }) });
  const nr = await merge(CTX, notLocked.deps);
  assert.deepEqual(nr.postMerge, POST_MERGE_STUB);
  assert.ok(notLocked.calls.some(isGit('worktree', 'remove')));
  // Another unlock refusal does not stop the removal attempt, and is named.
  const otherUnlock = mergeHarness({ unlock: Object.assign(new Error('Command failed'), { stderr: 'fatal: permission denied\n', status: 128 }) });
  const or = await merge(CTX, otherUnlock.deps);
  assert.deepEqual(or.postMerge, POST_MERGE_STUB);
  assert.match(otherUnlock.events.find((e) => e.step === 'merge-teardown').detail, /unlock failed: fatal: permission denied/);
  // The worktree is not in the listing: already gone, nothing unlocked or removed, the rest proceeds.
  const gone = mergeHarness({ worktreeList: `worktree ${fx.main}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/main\n\n` });
  const gr = await merge(CTX, gone.deps);
  assert.deepEqual(gr.postMerge, POST_MERGE_STUB);
  assert.ok(!gone.calls.some(isGit('worktree', 'unlock')) && !gone.calls.some(isGit('worktree', 'remove')));
  assert.ok(gone.calls.some(isGit('branch')) && gone.calls.some((c) => isGh('api')(c)));
  assert.match(gone.events.find((e) => e.step === 'merge-teardown').detail, /worktree already gone/);
  // The branch is already gone (rev-parse --quiet exits 1): no branch -D, no failure, the remote delete still runs.
  const noBranch = mergeHarness({ revParse: Object.assign(new Error('Command failed'), { stderr: '', status: 1 }) });
  const br = await merge(CTX, noBranch.deps);
  assert.deepEqual(br.postMerge, POST_MERGE_STUB);
  assert.ok(!noBranch.calls.some(isGit('branch')));
  assert.ok(noBranch.calls.some((c) => isGh('api')(c)));
  // A branch -D that itself exits 1 is a failure, never "already gone".
  const bd = mergeHarness({ branchDelete: Object.assign(new Error('Command failed'), { stderr: 'error: not found\n', status: 1 }) });
  assert.deepEqual((await merge(CTX, bd.deps)).postMerge.failures, ['teardown-branch']);
});

test('AC8.5: armed tears nothing down and makes no post-merge call', async () => {
  for (const over of [{ prState: BLOCKED_PENDING, confirm: ARMED }, { confirm: ARMED }]) {
    const h = mergeHarness(over);
    const r = await merge(CTX, h.deps);
    assert.deepEqual(pick(r), { outcome: 'armed', reason: null, mergeCommit: null, postMerge: null });
    assert.deepEqual(afterAll(h, isConfirmRead).filter((c) => !isNode('log-decision.js')(c)), []);
    assert.ok(!h.calls.some((c) => c.kind === 'git' || isNode('post-merge-run.js')(c) || isNode('hooks.js')(c) || isGh('api')(c)));
    assert.deepEqual(failureEvents(h), []);
  }
});

// ---- Task 6 fix round 1 ----

test('every decision line the post-merge sequence writes is accepted by the log-decision.js rules the harness mirrors', async () => {
  const h = mergeHarness();
  await merge(CTX, h.deps);
  assert.ok(!h.events.some((e) => /log:/.test(e.detail)), JSON.stringify(h.events.filter((e) => /log:/.test(e.detail))));
  assert.deepEqual(h.logs.filter((l) => /Step 4\.1|Step 4 \(|Step 5/.test(l.step)).map((l) => l.step),
    ['pr-first-merge Step 4.1', 'Step 4 (teardown)', 'Step 5 (delete remote branch)']);
  // The harness fake refuses a text that repeats its step, as the real CLI does.
  const refused = mergeHarness();
  refused.files['/x.txt'] = 'Step 5 (delete remote branch): again';
  const r = refused.deps.node(path.join(LIB, '..', 'log-decision.js'),
    ['--run', CTX.runDir, '--status', 'AUTO', '--step', 'Step 5 (delete remote branch)', '--text-file', '/x.txt']);
  assert.equal(r.code, 2);
  // ... and the aggregate-reproduction rule, which applies to STAGED lines only.
  refused.files['/y.txt'] = 'Reproduction: 3 single-agent findings';
  const agg = (status) => refused.deps.node(path.join(LIB, '..', 'log-decision.js'),
    ['--run', CTX.runDir, '--status', status, '--step', 'Lens 3', '--text-file', '/y.txt']).code;
  assert.deepEqual([agg('STAGED'), agg('AUTO')], [2, 0]);
});

test('teardown canonicalizes the worktree path through the realpath seam before matching git\'s listing', async () => {
  const listing = (listed) => `worktree ${CTX.mainCheckout}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/main\n\n`
    + `worktree ${listed}\nHEAD ${'2'.repeat(40)}\nbranch refs/heads/drive-7\nlocked\n`;
  // (i) the worktree's own realpath resolves: git lists the canonical path.
  const own = '/canon/own/drive-7';
  const a = mergeHarness({ worktreeList: listing(own), deps: { realpath: (p) => (p === CTX.worktree ? own : null) } });
  const ar = await merge(CTX, a.deps);
  assert.deepEqual(ar.postMerge, POST_MERGE_STUB);
  assert.deepEqual(a.calls.filter((c) => isGit('worktree', 'unlock')(c) || isGit('worktree', 'remove')(c)).map((c) => c.args.slice(2)),
    [['worktree', 'unlock', CTX.worktree], ['worktree', 'remove', CTX.worktree]]);
  // (ii) the directory is gone, its parent resolves: the parent's realpath plus the leaf.
  const parent = '/canon/parent';
  const b = mergeHarness({
    worktreeList: listing(`${parent}/drive-7`),
    deps: { realpath: (p) => (p === path.dirname(CTX.worktree) ? parent : null) },
  });
  const br = await merge(CTX, b.deps);
  assert.deepEqual(br.postMerge, POST_MERGE_STUB);
  assert.ok(b.calls.some(isGit('worktree', 'unlock')) && b.calls.some(isGit('worktree', 'remove')));
  // Neither resolves: the path as given matches a listing that names it as given (the fixture's own case).
  const c = mergeHarness({ deps: { realpath: () => null } });
  assert.deepEqual((await merge(CTX, c.deps)).postMerge, POST_MERGE_STUB);
  assert.ok(c.calls.some(isGit('worktree', 'remove')));
});

test('a post-merge-run `failed` skip with no failedSteps names its reason and next routing', async () => {
  const h = mergeHarness({ postMergeRun: { code: 0, stdout: JSON.stringify({ verdict: 'failed', reason: 'claim-failed', next: 'rerun' }), stderr: '' } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(r.postMerge, { verdict: 'failed', failedSteps: [], failures: [] });
  const ev = failureEvents(h).find((e) => e.step === 'merge-post-merge');
  assert.equal(ev.detail, 'post-merge steps failed: claim-failed (next rerun)');
  assert.deepEqual(ev.extra, { verdict: 'failed', failedSteps: [], reason: 'claim-failed', next: 'rerun' });
});

test('an empty ctx.worktree is a teardown-worktree failure and skips the branch and remote delete', async () => {
  const h = mergeHarness();
  const r = await merge({ ...CTX, worktree: '' }, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(r.postMerge.failures, ['teardown-worktree', 'delete-branch: worktree kept']);
  assert.ok(!h.calls.some(isGit('worktree', 'remove')) && !h.calls.some(isGit('branch')) && !h.calls.some((c) => isGh('api')(c)));
  assert.match(h.events.find((e) => e.step === 'merge-teardown').detail, /no worktree path/);
});

test('a failed release-status comment post is also logged to decisions.md as a SKIP degrade trace', async () => {
  const h = mergeHarness({ script: [[isGh('pr', 'comment'), Object.assign(new Error('x'), { stderr: 'HTTP 502\n' })]] });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(r.postMerge.failures, ['release-status-comment']);
  const skip = h.logs.find((l) => l.status === 'SKIP' && l.step === 'pr-first-merge Step 4.1 (degraded)');
  assert.equal(skip.text, 'condition: release-status comment post failed (HTTP 502) → fallback: release line kept in decisions.md and the event');
  assert.ok(h.logs.some((l) => l.status === 'AUTO' && l.text.startsWith('release status — already carried by')));
});

// ---- Task 8: source scans (AC6, AC14), real-git conflict proof (AC6), verify fixtures (AC13) ----

const MERGE = path.join(LIB, 'driver', 'merge.js');
// merge.js code with comments blanked (literals kept, so a quoted argv word still reads). A file the
// stripper mis-parsed is a failure, never a clean scan (bin-source-scan-conformance).
function codeOf(file) {
  const raw = readText(file);
  const stripped = stripComments(raw);
  const v = stripperVerdict(raw, stripped);
  assert.equal(v, 'ok', `${path.basename(file)}: ${STRIPPER_VERDICT_MESSAGES[v]}`);
  return stripped;
}

test('codeOf self-test: a comment never matches, code after a literal opener still does, a mis-parse is flagged', () => {
  const planted = "// runGit(s, ['push'])\nconst s = '/*'; runGit(s, ['fetch']);\n";
  const stripped = stripComments(planted);
  assert.equal(stripped.split('\n')[0].trim(), '', 'the comment line is blanked');
  assert.match(stripped, /runGit\(s, \['fetch'\]\)/, 'the live call after a /* string is still seen');
  assert.equal(stripped.length, planted.length, 'offsets are preserved');
  const misparse = "if (b) /'/.test(b); const c = 'x'; f(c);";
  assert.equal(stripperVerdict(misparse, stripComments(misparse, { literals: 'blank' })), 'misparsed', 'a mis-parse is a verdict, never a clean scan');
  assert.ok(codeOf(MERGE).length > 10000, 'merge.js is read whole');
});

// Recall limits: a require built from a variable or a computed string (`require(name)`), and a model
// reached through a differently named binding, are invisible to this regex scan; it pins the spellings
// merge.js would plausibly use, and review owns the rest.
function noModelCall(src) {
  return !/require\([^)]*\b(worker|roles|judgments?)\b/.test(src) && !/\blaunchWorker\b/.test(src) && !/['"`]claude(\.cmd)?['"`]/.test(src);
}
const bareJudgments = (src) => /(?<!deps\.)\bjudgments\b/.test(src.replace(/['"`][^'"`\n]*['"`]/g, '""'));

test('AC14.1–AC14.3: merge.js requires no worker, roles or judgments module, names no launchWorker and spawns no claude', () => {
  const code = codeOf(MERGE);
  assert.ok(noModelCall(code));
  for (const bad of ["const w = require('./worker');", "const r = require('./roles');", "require('./judgments')", 'deps.launchWorker(x)', "spawn('claude', [])", 'spawn("claude.cmd", [])']) {
    assert.ok(!noModelCall(bad), `go-red: ${bad}`);
  }
  assert.equal(bareJudgments(code), false, 'AC14.2: judgments only as deps.judgments');
  assert.ok(code.includes('deps.judgments'), 'the supplier is reached as deps.judgments');
  assert.ok(bareJudgments('const j = require("./x").judgments; j(ctx);'), 'go-red: bare judgments');
  assert.equal(bareJudgments('const j = deps.judgments;'), false, 'deps.judgments is the sanctioned form');
});

test('AC14 twin pin: the rollup verdict comes from classify.js classifyRollup, never a local re-implementation', () => {
  const twinImport = (src) => /\{[^}]*\bclassifyRollup\b[^}]*\}\s*=\s*require\(\s*['"]\.\.\/pr-checks\/classify['"]\s*\)/.test(src);
  const twinCall = (src) => /\bclassifyRollup\(/.test(src);
  // Recall limit: a copy of the conclusion list under another name (`const FAILED = [...]`) is not seen;
  // the scan names the identifiers the twin owns, and the Step 2.5 conformance suite owns the list itself.
  const reimplements = (src) => /\bFAILING_CONCLUSIONS\b/.test(src) || /\bfunction\s+(?:normalizeEntry|classifyRollup)\b/.test(src)
    || /\b(?:const|let|var)\s+(?:normalizeEntry|classifyRollup)\s*=/.test(src);
  const code = codeOf(MERGE);
  assert.ok(twinImport(code), 'classifyRollup is imported from ../pr-checks/classify');
  assert.ok(twinCall(code), 'the gate calls classifyRollup');
  assert.equal(reimplements(code), false, 'no local FAILING_CONCLUSIONS, normalizeEntry or classifyRollup');
  // go-red controls: each broken shape must fail the matcher that guards it.
  assert.equal(twinImport("const { classifyRollup } = require('./local-classify');"), false, 'go-red: wrong module');
  assert.equal(twinImport('const classifyRollup = (r) => r;'), false, 'go-red: a local binding');
  assert.equal(twinCall('const x = classifyRollup;'), false, 'go-red: imported, never called');
  assert.ok(reimplements("const FAILING_CONCLUSIONS = ['FAILURE'];"), 'go-red: a copied conclusion list');
  assert.ok(reimplements('function normalizeEntry(e) { return e; }'), 'go-red: a local normalizeEntry');
  assert.ok(reimplements('const classifyRollup = () => ({ state: "green" });'), 'go-red: a local classifyRollup');
  assert.equal(reimplements("const { classifyRollup, normalizeEntry } = require('../pr-checks/classify');"), false, 'the destructured import is not a re-implementation');
});

// AC6: every git argv is a literal array passed to runGit. Collect each runGit( call's balanced
// argument text (string and template literals skipped, so a paren inside one never unbalances it).
function gitArgTexts(src) {
  const out = [];
  const re = /(?<![.\w])runGit\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    let depth = 1;
    let i = re.lastIndex;
    let quote = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push(src.slice(re.lastIndex, i - 1));
  }
  return out;
}
const gitWritesBranch = (texts) => texts.some((t) => /['"`](merge|push|rebase)['"`]/.test(t));
const forbiddenText = (src) => /\brebase\b|--force-with-lease|--force\b/.test(src);
const GIT_SUBCOMMANDS = ['fetch', 'describe', 'worktree', 'rev-parse', 'branch'];
const subcommandOf = (t) => (/\[\s*['"`]([^'"`]+)['"`]/.exec(t) || [])[1];
const literalArgv = (t) => /^\s*\w+\s*,\s*\[\s*['"`]/.test(t);
// `.git(` as a call on any receiver: deps.git, d.git, this.git; the sanctioned site is runGit's own body.
const gitCallSites = (src) => (src.match(/\.git\(/g) || []).length;

test('AC6.2: merge.js names no rebase, no --force, and passes no merge or push to git', () => {
  const src = codeOf(MERGE);
  const texts = gitArgTexts(src);
  // fetch, describe, worktree list, worktree unlock, worktree remove, rev-parse, branch -D: 7 sites today.
  // Fewer means the call-site matcher stopped matching, not that the calls went away.
  assert.ok(texts.length >= 7, `runGit call sites seen: ${texts.length}`);
  assert.equal(gitWritesBranch(texts), false);
  assert.equal(forbiddenText(src), false);
  assert.ok(texts.every(literalArgv), `every runGit call passes a literal argv array: ${texts.filter((t) => !literalArgv(t)).join(' | ')}`);
  assert.deepEqual([...new Set(texts.map(subcommandOf))].sort(), [...GIT_SUBCOMMANDS].sort(), 'the git subcommands used are exactly the reviewed set');
  assert.equal(gitCallSites(src), 1, 'runGit is the only deps.git call site');
  // go-red controls
  assert.ok(gitWritesBranch(gitArgTexts("runGit(s, ['merge', 'origin/main'])")), 'go-red: merge');
  assert.ok(gitWritesBranch(gitArgTexts("runGit(s, ['push', 'origin', b])")), 'go-red: push');
  assert.ok(gitWritesBranch(gitArgTexts('runGit(s, [`rebase`, base])')), 'go-red: a backtick-quoted word');
  assert.ok(forbiddenText("x = ['--force']"), 'go-red: --force');
  assert.ok(forbiddenText("x = ['--force-with-lease']"), 'go-red: --force-with-lease');
  assert.ok(forbiddenText("x = ['rebase']"), 'go-red: rebase');
  assert.equal(gitArgTexts("function runGit(s, args) { return 1; }\nrunGit(s, ['fetch', f(a, 'b)')]);").length, 1, 'the definition is skipped, a paren in a string does not unbalance');
  assert.equal(gitArgTexts("runGit(s, ['a']);\nrunGit(s, ['b']);\nrunGit(s, ['c']);").length, 3, 'every call is collected');
  assert.equal(literalArgv('s, argv'), false, 'go-red: a non-literal argv');
  assert.equal(literalArgv("s, ['fetch']"), true);
  assert.equal(gitCallSites("deps.git(['status']); d.git(['push']);"), 2, 'go-red: a second call site');
  assert.ok(!GIT_SUBCOMMANDS.includes(subcommandOf("s, ['gc']")), 'go-red: an unreviewed subcommand');
});

test('AC6.3: a conflict run leaves the branch tip and the integration branch tip unchanged (real git)', async () => {
  const repo = gitRepo({ branch: 'main' });
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
  const git = (...args) => fixtureGit(['-C', repo, ...args], { env, encoding: 'utf8', windowsHide: true }).trim();
  // Diverged tips: a branch commit and a later main commit, so a merge, rebase or reset would move one.
  git('switch', '-q', '-c', 'drive-7');
  git('commit', '-q', '--allow-empty', '-m', 'branch work');
  git('switch', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'main moved on');
  const tips = () => ({ branch: git('rev-parse', 'refs/heads/drive-7'), main: git('rev-parse', 'refs/heads/main'), head: git('rev-parse', 'HEAD') });
  const before = tips();
  assert.notEqual(before.branch, before.main);
  const f = fixture(repo);
  const real = [];
  // A real deps.git, bounded and windowsHide'd, so any git call merge made would have really run.
  const realGit = (args, opts = {}) => {
    real.push(args);
    return fixtureGit(args, { cwd: opts.cwd, env, encoding: 'utf8', windowsHide: true });
  };
  const h = mergeHarness({ fx: f, prState: { mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }, deps: { git: realGit } });
  const r = await merge(f.ctx, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'conflict', mergeCommit: null, postMerge: null });
  assert.deepEqual(tips(), before, 'both branch tips and HEAD are unchanged');
  // The conflict path makes no git call at all (it reads the PR through gh and comments on it), so the
  // contract is an empty list, not a filter over one: any git call here is a change to review.
  assert.deepEqual(real, []);
  assert.ok(!h.calls.some(isMergeCall), 'no gh pr merge went out');
});

// ---- AC13: express-lane.js verify over runs the driver drove to each outcome ----

const EXPRESS_LANE = path.join(LIB, '..', 'express-lane.js');
// The run dir as Phase 1 leaves it, plus the verdict line merge.js reads.
const verifyDecisions = () => [
  '## /flow',
  '- AUTO 09:00:00 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.',
  '## /express-lane',
  `- AUTO 09:01:00 — Express lane check: #7 proceed — 1 changed file(s), 4 implementation line(s) within bounds; runner stamp verifies HEAD ${'a'.repeat(40)}. Reversibility: n/a.`,
  verdictLine(),
  '',
].join('\n');

function spawnVerify(f) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, [EXPRESS_LANE, 'verify', '--run', f.runDir, '--issue', '7'], { cwd: f.main, encoding: 'utf8', windowsHide: true, timeout: 30000 });
}

test('AC13.1–AC13.3: express-lane.js verify exits 0 for fixture runs driven to merged, armed, and pending-review after a red check', async () => {
  const outcomes = [
    ['merged', {}, 'merged', null],
    ['armed', { prState: BLOCKED_PENDING, confirm: ARMED }, 'armed', null],
    ['pending-review after a red check', { prState: { statusCheckRollup: [FAILING_CHECK] } }, 'pending-review', 'check-failed:unit'],
  ];
  for (const [name, over, outcome, reason] of outcomes) {
    const f = fixture();
    fs.writeFileSync(path.join(f.runDir, 'run-state.json'), JSON.stringify({ worktree: f.worktree, pr: { number: 9, url: 'https://github.com/o/r/pull/9' } }));
    const h = mergeHarness({ ...over, fx: f, decisions: verifyDecisions() });
    const r = await merge(f.ctx, h.deps);
    assert.equal(r.outcome, outcome, name);
    assert.equal(r.reason, reason, name);
    assert.equal(r.runDir, f.runDir, `${name}: the run dir stays where verify will look`);
    const v = spawnVerify(f);
    assert.equal(v.status, 0, `${name}: verify exit ${v.status}: ${v.stdout}${v.stderr}`);
    assert.deepEqual(JSON.parse(v.stdout), { ok: true, missing: [] }, name);
  }
});
