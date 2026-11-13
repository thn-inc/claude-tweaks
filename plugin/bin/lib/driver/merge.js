'use strict';
// The pipeline driver's merge step (#5226): takes a record whose live labels carry `auto:merge`
// from a green draft PR to a merged one, in program code, with no model call. The one judgment
// the lane needs (the merge-check verdict and the acceptance state) arrives only through the
// optional `deps.judgments` supplier; with none configured the step changes nothing.
//
// Ported procedure, by section: `_shared/pr-first-merge.md` Steps 2 to 3,
// `_shared/pr-first-merge-post-merge.md` Steps 4 and 5, and `_shared/express-lane.md` step 9.
// No test reads that prose, and drift between it and this module is accepted by design (the
// spec's Gotchas); each step function's comment names the section it ports, by symbol.
//
// Every external call except the decisions.md read (`confirmFromFile`, in-process, spec AC3)
// goes through `deps` (gh, git, node, readFile, lstatType, ...), so this module spawns nothing
// itself. `merge` never throws: an unexpected throw in any step becomes
// `pending-review` / `unclassified` naming the sub-step.

const path = require('node:path');
const {
  neutralize, errorText, firstLine, CLI_TIMEOUT_MS, MERGE_STEP_NAMES,
} = require('./events');
const { reduceDetail } = require('./settle');
const { confirmFromFile } = require('../dispatch/merge-verdict');
const { classifyRollup } = require('../pr-checks/classify');
const { ensureLabelPayload } = require('../issues/labels');
const { LABELS } = require('../issues/record-vocabulary');

const BIN_DIR = path.join(__dirname, '..', '..');
const AUTHORIZING_LABEL = 'auto:merge';
// The bounded watch (pr-first-merge.md Step 2.5): 15 minutes, polled every 30 seconds.
const MERGE_WATCH_BOUND_MS = 15 * 60 * 1000;
const MERGE_WATCH_POLL_MS = 30 * 1000;

function bin(name) {
  return path.join(BIN_DIR, name);
}

// One event per sub-step call. An emit that throws never breaks the step it describes.
function emit(s, step, status, detail, extra) {
  if (!MERGE_STEP_NAMES.includes(step)) throw new Error(`unknown merge step name: ${step}`);
  if (typeof s.deps.emit !== 'function') return;
  const ms = typeof s.deps.now === 'function' ? s.deps.now() - s.startedAt : 0;
  try {
    s.deps.emit(step, status, ms, neutralize(String(detail || '')), extra);
  } catch {
    // an event is a report about the step, never part of it
  }
}

function stop(s, step, reason, detail) {
  emit(s, step, 'stop', `${reason}: ${detail || ''}`.trim());
  return { stop: reason, detail: neutralize(String(detail || '')) };
}

// Appends one decision line through log-decision.js, the text in a file in the run directory
// first (--text-file), mirroring steps.js's logDecisionFile. A failed log never stops the
// merge: it is recorded on s.logFailures and named in the sub-step's event.
function logDecision(s, step, text, status = 'AUTO', reversibility = null, lever = null) {
  const { ctx, deps } = s;
  s.logSeq += 1;
  const file = path.join(s.runDir, `merge-log-${s.logSeq}.txt`);
  try {
    deps.writeFile(file, `${text}\n`);
    const r = deps.node(bin('log-decision.js'),
      ['--run', s.runDir, '--status', status, '--section', '/express-lane', '--step', step, '--text-file', file,
        ...(reversibility ? ['--reversibility', reversibility] : []), ...(lever ? ['--lever', lever] : [])],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
    if (r.code !== 0) s.logFailures.push(`log:${step}`);
  } catch {
    s.logFailures.push(`log:${step}`);
  }
}

// Ports pr-first-merge.md Step 2 (the live label read): `auto:merge` is the authorization,
// read from GitHub now, not from a cached copy. `auto:merge-pending` does not count.
function readLabels(s) {
  const { ctx, deps } = s;
  let raw;
  try {
    raw = deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'labels']);
  } catch (err) {
    return { unreadable: `label read failed: ${errorText(err)}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { unreadable: 'label read returned unparseable output' };
  }
  const labels = parsed && parsed.labels;
  if (!Array.isArray(labels) || !labels.every((l) => l && typeof l === 'object' && typeof l.name === 'string')) {
    return { unreadable: 'label read returned no label list' };
  }
  return { names: labels.map((l) => l.name) };
}

function isPositiveInteger(n) {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

// Ports pr-first-merge.md Step 2's entry condition: the run resolves `integration-model` to
// `pr-first` and run-state.json carries the PR the run opened. Any failure of this read is a
// stop (`not-pr-first`); the lever read below is a separate call so it never decides this one.
function readIntegrationModel(s) {
  const { ctx, deps } = s;
  const r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, '--values', 'integration-model'],
    { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  if (r.code !== 0 || String(r.stdout).trim() !== 'pr-first') {
    return `integration-model did not resolve pr-first (${r.code === 0 ? neutralize(String(r.stdout).trim()) || 'empty' : `exit ${r.code}`})`;
  }
  let state;
  try {
    state = JSON.parse(deps.readFile(path.join(s.runDir, 'run-state.json')));
  } catch (err) {
    return `run-state.json unreadable: ${errorText(err)}`;
  }
  if (!state || typeof state !== 'object' || !state.pr || !isPositiveInteger(state.pr.number)) {
    return 'run-state.json carries no pr number';
  }
  return null;
}

// Ports pr-first-merge.md Step 3's lever read (merge-verification). Never a stop: every failure
// of the read, and the value `off`, runs as `wait`. The JSON form of the `--values` read, so the
// source rides along for the `--lever` log field.
function readLever(s) {
  const { ctx, deps } = s;
  const r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, 'merge-verification'],
    { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  let raw = '';
  let source = 'unresolved';
  if (r.code === 0) {
    try {
      const parsed = JSON.parse(r.stdout);
      const entry = parsed && typeof parsed === 'object' ? parsed['merge-verification'] : undefined;
      if (entry && typeof entry === 'object' && !entry.error && typeof entry.value === 'string') {
        raw = entry.value;
        source = entry.source || 'unresolved';
      }
    } catch {
      // unparseable: stays unresolved
    }
  }
  s.valueRaw = raw;
  s.source = source;
  s.value = raw === 'merge-when-green' ? 'merge-when-green' : 'wait';
  if (raw === 'off') {
    logDecision(s, 'Step 2.5', 'lever off is not ported on the driver lane — proceeding as wait');
  } else if (raw !== 'merge-when-green' && raw !== 'wait') {
    logDecision(s, 'Step 2.5', `lever unresolved ("${neutralize(raw)}") — proceeding as wait`);
  }
}

// Ports the express-lane.md step 9 judgment inputs: the supplier's merge-check verdict and
// acceptance state, then pr-first-merge.md Step 2's backstop, decisions.md's own verdict line
// (the latest line per record wins, so a later needs-human beats an earlier auto-merge).
async function consultSupplier(s) {
  const { ctx, deps } = s;
  let j;
  try {
    j = await deps.judgments(ctx);
  } catch (err) {
    return stop(s, 'merge-supplier', 'supplier-failed', `judgments threw: ${errorText(err)}`);
  }
  const mc = j && typeof j === 'object' ? j.mergeCheck : null;
  const ac = j && typeof j === 'object' ? j.acceptance : null;
  if (!mc || typeof mc.verdict !== 'string' || !ac || typeof ac.completed !== 'boolean') {
    return stop(s, 'merge-supplier', 'supplier-failed', 'judgments returned an unusable shape');
  }
  if (mc.verdict !== 'auto-merge') {
    return stop(s, 'merge-supplier', 'verdict-not-confirmed', `supplier verdict ${neutralize(mc.verdict) || 'empty'}`);
  }
  if (ac.completed !== true) {
    return stop(s, 'merge-supplier', 'acceptance-not-completed', 'acceptance not completed');
  }
  const confirm = confirmFromFile(path.join(s.runDir, 'decisions.md'), [ctx.record])[ctx.record];
  if (!confirm || confirm.confirmed !== true) {
    const why = confirm && confirm.error ? `decisions.md unreadable: ${confirm.error}` : `latest logged verdict ${(confirm && confirm.latest) || 'none'}`;
    return stop(s, 'merge-supplier', 'verdict-not-confirmed', why);
  }
  emit(s, 'merge-supplier', 'ok', 'verdict auto-merge confirmed in decisions.md');
  return { ok: true };
}

// Entry, in the order the spec fixes. Each refusal is `pending-review` with no label, comment,
// ready or merge call made. The supplier check comes first and makes no call of any kind.
async function entry(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-entry';
  if (typeof deps.judgments !== 'function') return stop(s, 'merge-entry', 'no-supplier', 'no judgment supplier configured');
  let available = false;
  try {
    available = deps.ghAvailable() === true;
  } catch {
    available = false;
  }
  if (!available) return stop(s, 'merge-entry', 'gh-absent', 'gh is not available');
  const labels = readLabels(s);
  if (labels.unreadable) return stop(s, 'merge-entry', 'labels-unreadable', labels.unreadable);
  if (!labels.names.includes(AUTHORIZING_LABEL)) return stop(s, 'merge-entry', 'not-authorized', `record lacks ${AUTHORIZING_LABEL}`);
  if (ctx.summaryLogged !== true) return stop(s, 'merge-entry', 'summary-entry-missing', 'the summary decision entry was not logged');
  const notPrFirst = readIntegrationModel(s);
  if (notPrFirst) return stop(s, 'merge-entry', 'not-pr-first', notPrFirst);
  readLever(s);
  const note = s.logFailures.length ? ` (${s.logFailures.join(', ')})` : '';
  emit(s, 'merge-entry', 'ok', `entry conditions met; lever ${s.value} (${s.source})${note}`);
  s.stage = 'merge-supplier';
  return consultSupplier(s);
}

const CLOSING_LINKS_USED = ['clean', 'unlinked', 'still-linked'];

// Ports pr-checklist-refresh.md "Then check the forge's closing links": unlink closing keywords
// the PR's Fixes span does not name, and learn which records must stay open (`keepOpen`, handed
// to the composer). Never a stop: any failure degrades to "not checked" with keepOpen [].
// closing-links.js self-logs gh-absent, exit 4 and exit 5; every other degraded result gets the
// driver's own SKIP line: exit 3 (run dir untrusted, so the CLI cannot log), an unexpected exit,
// and every exit-0 result the driver cannot use (no-pr, no-fixes-span, an unknown action,
// unparseable output) — everything except gh-absent.
function closingLinks(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-closing-links';
  s.keepOpen = [];
  let r;
  try {
    r = deps.node(bin('closing-links.js'), ['--run', s.runDir, '--mode', 'pre-merge'],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    r = { code: null, stdout: '', stderr: errorText(err) };
  }
  const failuresBefore = s.logFailures.length;
  let detail;
  if (r.code === 0) {
    let env = null;
    try {
      env = JSON.parse(r.stdout);
    } catch {
      env = null;
    }
    if (env && typeof env === 'object' && CLOSING_LINKS_USED.includes(env.action) && Array.isArray(env.keepOpen)) {
      s.keepOpen = env.keepOpen.includes(ctx.record) ? [ctx.record] : [];
      detail = `closing links ${env.action}; keep open ${s.keepOpen.length ? `#${ctx.record}` : 'none'}`;
      if (env.action === 'still-linked') detail += ' (still-linked: left for post-merge Step 4.0)';
    } else {
      const action = env && typeof env === 'object' && typeof env.action === 'string' ? env.action : 'unparseable';
      detail = `closing links not checked (action ${action}); proceeding with keep open none`;
      // closing-links.js self-logs gh-absent only; every other exit-0 degraded result is ours to log.
      if (action !== 'gh-absent') {
        const what = action === 'unparseable' ? 'unparseable output' : `action ${reduceDetail(action)}`;
        logDecision(s, 'Closing links (pre-merge) (degraded)',
          `condition: closing-links.js exited 0 with ${what} → fallback: closing links not checked this merge`, 'SKIP', 'n/a');
      }
    }
  } else {
    detail = `closing links not checked (exit ${r.code}); proceeding with keep open none`;
    if (r.code !== 4 && r.code !== 5) {
      logDecision(s, 'Closing links (pre-merge) (degraded)',
        `condition: closing-links.js exited ${r.code} → fallback: closing links not checked this merge`, 'SKIP', 'n/a');
    }
  }
  const note = s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
  emit(s, 'merge-closing-links', 'ok', `${detail}${note}`);
  return { ok: true };
}

// Ports pr-first-merge.md Step 3's composer fence: the Conventional-Commits subject and body the
// squash commit carries, written to files by compose-subject.js. The title is read from
// title.txt; the composer's single-quoted stdout line is never parsed. Runs before mark ready on
// purpose: a refusal leaves the PR in draft. The gate's re-entry runs it once more, after ready,
// so a refusal there leaves the PR ready and its stop event says so.
function compose(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-compose';
  const tail = s.reentries > 0 ? ' (re-entry: PR left ready)' : '';
  const halt = (reason, detail) => stop(s, 'merge-compose', reason, `${detail}${tail}`);
  const outDir = path.join(s.runDir, 'merge-subject');
  const keep = s.keepOpen.length ? ['--keep-open', String(ctx.record)] : [];
  let r;
  try {
    r = deps.node(bin('compose-subject.js'),
      [String(ctx.record), '--repo', ctx.repo, '--tag', 'auto-merge', ...keep, '--pr', String(ctx.pr), '--out-dir', outDir],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    return halt('unclassified', `compose: compose-subject.js failed: ${errorText(err)}`);
  }
  if (r.code === 1) return halt('compose-refused', reduceDetail(firstLine(r.stderr)));
  if (r.code === 2) {
    const line = firstLine(r.stderr);
    return halt('gh-absent', line ? reduceDetail(line) : 'compose-subject.js could not use gh');
  }
  if (r.code !== 0) return halt('unclassified', `compose: compose-subject.js exited ${r.code}`);
  let title = '';
  try {
    title = String(deps.readFile(path.join(outDir, 'title.txt'))).trim();
  } catch (err) {
    return halt('unclassified', `compose: title.txt unreadable: ${errorText(err)}`);
  }
  if (!title) return halt('unclassified', 'compose: title.txt is empty');
  s.subject = { title, bodyFile: path.join(outDir, 'body.md') };
  emit(s, 'merge-compose', 'ok', `composed subject (${title.length} chars)`);
  return { ok: true, title, bodyFile: s.subject.bodyFile };
}

// Ports pr-first-merge.md Step 2's un-draft: a draft PR is marked ready, an already-ready one is
// left alone and the skip is logged. The one place this module undrafts a PR.
function markReady(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-ready';
  let isDraft;
  try {
    const parsed = JSON.parse(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', 'isDraft']));
    isDraft = parsed && typeof parsed === 'object' ? parsed.isDraft : undefined;
  } catch (err) {
    return stop(s, 'merge-ready', 'ready-failed', `isDraft read failed: ${errorText(err)}`);
  }
  if (typeof isDraft !== 'boolean') return stop(s, 'merge-ready', 'ready-failed', 'isDraft read returned no boolean');
  const failuresBefore = s.logFailures.length;
  let detail;
  if (isDraft) {
    try {
      deps.gh(['pr', 'ready', String(ctx.pr), '--repo', ctx.repo]);
    } catch (err) {
      return stop(s, 'merge-ready', 'ready-failed', `gh pr ready failed: ${errorText(err)}`);
    }
    logDecision(s, 'Step 2 (mark ready)', `undrafted PR #${ctx.pr} (was draft).`, 'AUTO', `high (gh pr ready ${ctx.pr} --undo)`);
    detail = 'PR undrafted';
  } else {
    logDecision(s, 'Step 2 (mark ready)', `PR #${ctx.pr} already ready — skipped gh pr ready.`, 'AUTO', 'n/a (no state change)');
    detail = 'PR already ready; gh pr ready skipped';
  }
  const note = s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
  emit(s, 'merge-ready', 'ok', `${detail}${note}`);
  return { ok: true };
}

// ---- The merge-verification gate: pr-first-merge.md Step 2.5, `merge-when-green` and `wait`
// columns only (the `off` column is not ported; readLever runs `off` as `wait`). ----

const GATE_FIELDS = 'state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup';
const REREAD_FIELDS = 'state,mergeStateStatus,headRefOid';
const RUN_FIELDS = 'name,workflowName,status,conclusion,url';
// The ready-run.js states classify reads; `read-failed`, and any state not named here, is a read failure.
const READY_RUN_USED = ['not-applicable', 'met', 'awaiting', 'red', 'draft-skip-without-ready-trigger'];
const LEVER_VALUES = ['merge-when-green', 'wait'];
const PARKED_DESC = 'Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact';
const PARKED_COLOR = '6A737D';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasStrings = (o, keys) => isObject(o) && keys.every((k) => typeof o[k] === 'string');
const isConflicting = (read) => read.mergeStateStatus === 'DIRTY' || read.mergeable === 'CONFLICTING';

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Ports Step 2.5 "Read state first": the PR's state, then its head runs and the ready-run read.
// The two checks reads are skipped when the first read already decides the gate (not OPEN, not
// the verified head, conflicting): `runs` and `ready` are then null. A read the gate cannot use
// is a stop with `word` (the caller's: the gate's state-read-failed, the watch's own), never a guess.
// It never writes `s.lastRead`: the caller does, once its own guards pass, so a caller comparing
// a new read against the previous one still sees the previous one.
function gateReads(s, word) {
  const { ctx, deps } = s;
  const fail = (detail) => ({ stop: word, detail });
  let read;
  try {
    read = parseJson(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', GATE_FIELDS]));
  } catch (err) {
    return fail(`state read failed: ${errorText(err)}`);
  }
  if (!hasStrings(read, ['state', 'mergeStateStatus', 'mergeable', 'headRefOid']) || !Array.isArray(read.statusCheckRollup)) {
    return fail('state read returned an unusable shape');
  }
  if (read.state !== 'OPEN' || read.headRefOid !== ctx.head || isConflicting(read)) return { read, runs: null, ready: null };
  let runs;
  try {
    runs = parseJson(deps.gh(['run', 'list', '--repo', ctx.repo, '--commit', read.headRefOid, '--limit', '100', '--json', RUN_FIELDS]));
  } catch (err) {
    return fail(`head-runs read failed: ${errorText(err)}`);
  }
  if (!Array.isArray(runs) || !runs.every(isObject)) return fail('head-runs read returned no run list');
  let r;
  try {
    r = deps.node(bin('ready-run.js'), ['--pr', String(ctx.pr), '--sha', read.headRefOid],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    return fail(`ready-run read failed: ${errorText(err)}`);
  }
  if (r.code !== 0) return fail(`ready-run.js exited ${r.code}`);
  const ready = parseJson(String(r.stdout).trim());
  if (!hasStrings(ready, ['state'])) return fail('ready-run.js printed no state');
  if (ready.state === 'read-failed') return fail(`ready-run read-failed: ${reduceDetail(ready.reason)}`);
  if (!READY_RUN_USED.includes(ready.state)) return fail(`ready-run state ${reduceDetail(ready.state)} not recognized`);
  return { read, runs, ready };
}

// Step 2.5's table over a read the caller's guards passed (OPEN, the verified head, not
// conflicting, so `runs` and `ready` are the real reads). The rollup and head-run rules are
// classify.js's classifyRollup — Step 2.5's one pinned code twin — never restated here; the
// ready-run state is layered on top in the table's order: red adds its failing names,
// then draft-skip, then awaiting makes the result pending.
function classify(ctx, read, runs, ready) {
  if (!Array.isArray(runs) || !ready) throw new Error('classify needs the checks reads');
  const base = classifyRollup({ rollup: read.statusCheckRollup, headRefOid: read.headRefOid, localHead: ctx.head, hasPrCi: true, headRuns: runs });
  // read-failed and stale are unreachable past gateReads' shape checks and the head guard.
  if (!['red', 'pending', 'green'].includes(base.state)) throw new Error(`classifyRollup returned ${base.state}`);
  if (base.state === 'red' || ready.state === 'red') {
    const names = [
      ...base.failing.map((f) => f.name),
      ...(ready.state === 'red' && Array.isArray(ready.failing) ? ready.failing.map((f) => f && f.name) : []),
    ].filter((n) => typeof n === 'string' && n !== '');
    const unique = [...new Set(names)];
    return { kind: 'red', names: unique.length ? unique : ['unnamed'] };
  }
  if (ready.state === 'draft-skip-without-ready-trigger') {
    const files = (Array.isArray(ready.draftSkipWithoutReadyTrigger) ? ready.draftSkipWithoutReadyTrigger : [])
      .filter((f) => typeof f === 'string' && f !== '');
    return { kind: 'draft-skip', files: files.length ? files : ['unnamed'] };
  }
  if (base.state === 'pending' || ready.state === 'awaiting') return { kind: 'pending' };
  return { kind: 'green' };
}

// The gate, from its first read (and again from the top on the one re-entry). The head guard:
// the first read's headRefOid must be the sha `check` verified (ctx.head).
async function gate(s) {
  const { ctx } = s;
  s.stage = 'merge-gate';
  const g = gateReads(s, 'state-read-failed');
  if (g.stop) return stop(s, 'merge-gate', g.stop, g.detail);
  const { read } = g;
  if (read.state !== 'OPEN') return stop(s, 'merge-gate', 'pr-not-open', `PR state ${reduceDetail(read.state)}`);
  if (read.headRefOid !== ctx.head) return stop(s, 'merge-gate', 'moving-target', 'the PR head is not the verified head');
  if (isConflicting(read)) {
    emit(s, 'merge-gate', 'ok', `checks not read: conflicting; merge state ${reduceDetail(read.mergeStateStatus)}`);
    return conflictStop(s);
  }
  s.lastRead = read;
  const verdict = classify(ctx, read, g.runs, g.ready);
  emit(s, 'merge-gate', 'ok', `checks ${verdict.kind}; merge state ${reduceDetail(read.mergeStateStatus)}; lever ${s.value}`);
  if (verdict.kind === 'red') return park(s, `check-failed:${verdict.names.join(',')}`, { names: verdict.names });
  if (verdict.kind === 'draft-skip') {
    return park(s, `draft-skip-without-ready-trigger:${verdict.files.join(',')}`, { files: verdict.files });
  }
  // The re-entry's recompose (the only one) runs here: past its guards, before any handoff
  // toward a merge, so a re-entry that stops or parks composes nothing.
  if (s.recomposeOnReentry) {
    s.recomposeOnReentry = false;
    const c = compose(s);
    if (c.stop) return c;
  }
  if (s.value === 'merge-when-green') {
    // A pending read GitHub reports BLOCKED (required checks still running) arms auto-merge.
    if (verdict.kind === 'green' || read.mergeStateStatus === 'BLOCKED') return mergeCall(s, 'auto');
    return watch(s);
  }
  if (verdict.kind === 'green') return rereadThenMerge(s, read);
  return watch(s);
}

// The `wait` row's fresh read right before the immediate merge. A head or state change since the
// first read re-enters the gate once, which recomposes once its guards pass (the only recompose:
// the subject may name the new head's records); a second change is moving-target.
async function rereadThenMerge(s, first) {
  const { ctx, deps } = s;
  let read;
  try {
    read = parseJson(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', REREAD_FIELDS]));
  } catch (err) {
    return stop(s, 'merge-gate', 'state-read-failed', `state re-read failed: ${errorText(err)}`);
  }
  if (!hasStrings(read, ['state', 'mergeStateStatus', 'headRefOid'])) {
    return stop(s, 'merge-gate', 'state-read-failed', 'state re-read returned an unusable shape');
  }
  if (read.headRefOid !== first.headRefOid || read.state !== 'OPEN') {
    if (s.reentries >= 1) return stop(s, 'merge-gate', 'moving-target', 'the PR changed between reads a second time');
    s.reentries += 1;
    s.recomposeOnReentry = true;
    emit(s, 'merge-gate', 'ok', `${read.state !== 'OPEN' ? 'state' : 'head'} changed between reads; re-entering the gate once`);
    return gate(s);
  }
  if (read.mergeStateStatus === 'DIRTY') return conflictStop(s);
  return mergeCall(s, 'immediate');
}

// label-bootstrap.md's check-then-create for bot:parked, mirroring claim-targets.js's
// ensureAndAddLabel (with --repo, since the driver's cwd is not the record's repo).
function bootstrapParkedLabel(s) {
  const { ctx, deps } = s;
  const p = ensureLabelPayload(LABELS.BOT_PARKED, PARKED_DESC, PARKED_COLOR);
  const existing = String(deps.gh(['label', 'list', '--repo', ctx.repo, '--search', p.name, '--json', 'name', '-q', '.[].name']) || '')
    .split('\n').map((x) => x.trim());
  if (!existing.includes(p.name)) {
    deps.gh(['label', 'create', p.name, '--repo', ctx.repo, '--color', p.color, '--description', p.description]);
  }
}

// Ports Step 2.5 "Red path": never merge. bot:parked on the record (bootstrapped, re-read, added
// once more if missing), one record comment from the fixed template, the PR left ready. When the
// label still does not read back, `gh pr ready --undo` is the fallback lock — the only re-draft
// in this module. Every call is fail-safe: the reason is the one passed, whatever fails here.
function park(s, reason, { names = [], files = [] } = {}) {
  const { ctx, deps } = s;
  s.stage = 'merge-park';
  const notes = [];
  try {
    bootstrapParkedLabel(s);
  } catch (err) {
    notes.push(`label bootstrap failed: ${errorText(err)}`);
  }
  let applied = false;
  let labelError = null; // the first label-add or label-read error: the NOT-applied line's ({error})
  for (let attempt = 0; attempt < 2 && !applied; attempt += 1) {
    try {
      deps.gh(['issue', 'edit', '--repo', ctx.repo, '--add-label', LABELS.BOT_PARKED, '--', String(ctx.record)]);
    } catch (err) {
      notes.push(`label add failed: ${errorText(err)}`);
      labelError = labelError || notes[notes.length - 1];
    }
    const labels = readLabels(s);
    if (labels.unreadable) {
      notes.push(labels.unreadable);
      labelError = labelError || labels.unreadable;
    }
    applied = !labels.unreadable && labels.names.includes(LABELS.BOT_PARKED);
  }
  // The log keeps the #refs; the event detail is neutralized, so it names the record in words.
  let lockLog = `bot:parked applied to #${ctx.record}`;
  let lockEvent = `bot:parked applied to record ${ctx.record}`;
  if (!applied) {
    // pr-first-merge.md Step 2.5 Red path item 3: `bot:parked NOT applied to #{list} ({error}); ...`
    const error = reduceDetail(labelError || 'label missing after retry');
    const missing = `bot:parked NOT applied to #${ctx.record} (${error})`;
    const missingEvent = `bot:parked NOT applied to record ${ctx.record} (${error})`;
    try {
      deps.gh(['pr', 'ready', String(ctx.pr), '--repo', ctx.repo, '--undo']);
      lockLog = `${missing}; PR re-drafted as the fallback lock`;
      lockEvent = `${missingEvent}; PR re-drafted as the fallback lock`;
    } catch (err) {
      lockLog = `${missing}; the re-draft fallback failed too`;
      lockEvent = `${missingEvent}; the re-draft fallback failed too`;
      notes.push(`re-draft failed: ${errorText(err)}`);
    }
  }
  try {
    deps.gh(['issue', 'comment', '--repo', ctx.repo, '--body', parkComment({ value: s.value, reason, pr: ctx.pr, names, files }),
      '--', String(ctx.record)]);
  } catch (err) {
    notes.push(`record comment failed: ${errorText(err)}`);
  }
  const failuresBefore = s.logFailures.length;
  logDecision(s, 'Step 2.5 (merge-verification gate)', `parked — ${neutralize(reason)} on PR #${ctx.pr}; ${lockLog}`,
    'AUTO', 'high (label removal + resume)', `merge-verification=${s.value} (${s.source})`);
  notes.push(...s.logFailures.slice(failuresBefore));
  return stop(s, 'merge-park', reason, `${lockEvent}${notes.length ? ` (${notes.join('; ')})` : ''}`);
}

// Ports Step 2.5's conflict row: the driver never updates a conflicting branch. One PR comment,
// no git call, no further gh call; the PR stays ready for a human to resolve.
function conflictStop(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-conflict';
  let note = '';
  try {
    deps.gh(['pr', 'comment', '--repo', ctx.repo, '--body', conflictComment({ pr: ctx.pr, base: ctx.base }), '--', String(ctx.pr)]);
  } catch (err) {
    note = ` (PR comment failed: ${errorText(err)})`;
  }
  return stop(s, 'merge-conflict', 'conflict', `the PR conflicts with its base; left ready${note}`);
}

// Fixed public templates: closed-set words, free text (check and file names, the base branch)
// reduced by settle.js's reduceDetail.
function parkComment({ value, reason, pr, names = [], files = [] } = {}) {
  const lever = LEVER_VALUES.includes(value) ? value : 'wait';
  const stem = String(reason || '').split(':')[0];
  const list = (xs) => reduceDetail((Array.isArray(xs) ? xs : []).join(', '));
  let phrase = list(names);
  let resume = 'Resume once green.';
  if (stem === 'checks-pending-timeout') phrase = `checks still pending after ${MERGE_WATCH_BOUND_MS / 60000}m`;
  if (stem === 'draft-skip-without-ready-trigger') {
    phrase = `${list(files)} skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md)`;
    resume = 'Resume once its workflow is fixed or a post-ready run lands.';
  }
  return `Parked by merge-verification (${lever}): ${phrase} on PR #${isPositiveInteger(pr) ? pr : 'unknown'}. ${resume}`;
}

function conflictComment({ pr, base } = {}) {
  return `Merge stopped: PR #${isPositiveInteger(pr) ? pr : 'unknown'} conflicts with ${reduceDetail(base)}. `
    + 'The driver does not update a conflicting branch; resolve the conflict and run the record again.';
}

// Ports Step 2.5 "Bounded watch", deliberately not the prose loop's shape (#5179): every poll
// re-reads the merge state as well as the checks, so a PR that turns conflicting mid-watch stops
// as `conflict` at that poll instead of timing out. Each poll runs its guards (read failure, not
// OPEN or head changed since the previous read, conflicting) before `classify`, and `s.lastRead`
// moves only once they pass, so the head comparison is against the prior read. Returns { step }
// for a stop the watch owns, or { next } for a hand-off that runs after the watch's time is
// accounted (a hand-off may itself re-enter the gate, which starts another watch).
async function pollUntilDecided(s, started) {
  const { ctx, deps } = s;
  let polls = 0;
  for (;;) {
    await deps.sleep(MERGE_WATCH_POLL_MS);
    if (deps.interrupted()) {
      // run.js's handler already wrote the final line: no further call, and no hand-off.
      return { step: { stop: 'unclassified', detail: 'watch: interrupted' }, interrupted: true, polls };
    }
    polls += 1;
    const g = gateReads(s, 'checks-read-failed');
    if (g.stop) return { step: g, polls };
    const { read } = g;
    if (read.state !== 'OPEN' || read.headRefOid !== s.lastRead.headRefOid) {
      if (s.reentries >= 1) {
        return { step: { stop: 'moving-target', detail: 'the PR changed during the watch a second time' }, polls };
      }
      s.reentries += 1;
      s.recomposeOnReentry = true;
      return { next: () => gate(s), note: `${read.state !== 'OPEN' ? 'state' : 'head'} changed; re-entering the gate once`, polls };
    }
    if (isConflicting(read)) return { next: () => conflictStop(s), note: 'conflicting', polls };
    s.lastRead = read;
    const verdict = classify(ctx, read, g.runs, g.ready);
    if (verdict.kind === 'red') {
      return { next: () => park(s, `check-failed:${verdict.names.join(',')}`, { names: verdict.names }), note: 'checks red', polls };
    }
    if (verdict.kind === 'draft-skip') {
      return {
        next: () => park(s, `draft-skip-without-ready-trigger:${verdict.files.join(',')}`, { files: verdict.files }),
        note: 'draft-skip without a ready trigger',
        polls,
      };
    }
    if (verdict.kind === 'green') return { next: () => rereadThenMerge(s, read), note: 'checks green', polls };
    // pending. Step 3's rule applies at every poll: under merge-when-green a BLOCKED read arms.
    if (s.value === 'merge-when-green' && read.mergeStateStatus === 'BLOCKED') {
      return { next: () => mergeCall(s, 'auto'), note: 'pending and BLOCKED; arming auto-merge', polls };
    }
    if (deps.now() - started >= MERGE_WATCH_BOUND_MS) {
      return { next: () => park(s, 'checks-pending-timeout'), note: 'checks still pending at the bound', polls };
    }
  }
}

// The watch's time is CI wait: summed on s.ciWaitMs across re-entries, and carried by this
// watch's one exit event as extra.ciWaitMs (run.js's final line sums the events' values).
async function watch(s) {
  const { deps } = s;
  s.stage = 'merge-watch';
  const started = deps.now();
  deps.watchClock(started);
  let out;
  let failure = null;
  let waited = 0;
  try {
    out = await pollUntilDecided(s, started);
  } catch (err) {
    failure = { err };
  } finally {
    waited = Math.max(0, deps.now() - started);
    s.ciWaitMs += waited;
    deps.watchClock(null);
  }
  const extra = { ciWaitMs: waited };
  if (failure) {
    // The time still counts as CI wait on the final line, which sums events: report it, then rethrow
    // so merge's own catch classifies the step.
    emit(s, 'merge-watch', 'fail', `watch threw: ${errorText(failure.err)}`, extra);
    throw failure.err;
  }
  // An interrupt was already reported by run.js's handler: nothing further is emitted or driven.
  if (out.interrupted) return out.step;
  if (out.step) {
    emit(s, 'merge-watch', 'stop', `${out.step.stop}: ${out.step.detail || ''} (after ${out.polls} polls)`.trim(), extra);
    return { stop: out.step.stop, detail: neutralize(String(out.step.detail || '')) };
  }
  emit(s, 'merge-watch', 'ok', `watch ended after ${out.polls} polls: ${out.note}`, extra);
  return out.next();
}

// Task 5 replaces this stub with the merge call; `mode` is 'auto' (merge-when-green) or 'immediate' (wait).
async function mergeCall(s, mode) {
  s.stage = 'merge-call';
  return stop(s, 'merge-call', 'unclassified', `merge call not implemented (mode ${mode})`);
}

function result(s, outcome, reason, detail, extra = {}) {
  return {
    outcome, reason, detail: detail || '', mergeCommit: null, runDir: s.ctx.runDir, ciWaitMs: s.ciWaitMs, postMerge: null,
    eventsStdoutOnly: false, ...extra,
  };
}

async function merge(ctx, deps) {
  const s = {
    ctx, deps, runDir: ctx.runDir, value: 'wait', source: 'unresolved', valueRaw: '', keepOpen: [],
    subject: null, reentries: 0, recomposeOnReentry: false, ciWaitMs: 0, lastRead: null, logFailures: [], logSeq: 0, stage: 'merge-entry',
    startedAt: typeof deps.now === 'function' ? deps.now() : 0,
  };
  try {
    const e = await entry(s);
    if (e.stop) return result(s, 'pending-review', e.stop, e.detail);
    closingLinks(s);
    const c = compose(s);
    if (c.stop) return result(s, 'pending-review', c.stop, c.detail);
    const ready = markReady(s);
    if (ready.stop) return result(s, 'pending-review', ready.stop, ready.detail);
    // Until the merge call lands (Task 5), every route through the gate ends in a stop.
    const g = await gate(s);
    return result(s, 'pending-review', g.stop, g.detail);
  } catch (err) {
    return result(s, 'pending-review', 'unclassified', `${s.stage}: ${neutralize(errorText(err))}`);
  }
}

module.exports = {
  merge, parkComment, conflictComment, MERGE_WATCH_BOUND_MS, MERGE_WATCH_POLL_MS,
};
