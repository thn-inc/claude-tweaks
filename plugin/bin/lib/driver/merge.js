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
// Every external call except two in-process reads goes through `deps` (gh, git, node, readFile,
// lstatType, ...), so this module spawns nothing itself. The two: the decisions.md read
// (`confirmFromFile`, spec AC3), and teardown's worktree-path realpath, which falls back to the
// imported `safeReal` (`fs.realpathSync`) when no `deps.realpath` is given.
// `merge` never throws: an unexpected throw in any step becomes `pending-review` /
// `unclassified` naming the sub-step.

const path = require('node:path');
const {
  neutralize, errorText, firstLine, CLI_TIMEOUT_MS, MERGE_STEP_NAMES,
} = require('./events');
const { reduceDetail, canonicalWorktreePath } = require('./settle');
const { confirmFromFile } = require('../dispatch/merge-verdict');
const { classifyRollup, normalizeEntry } = require('../pr-checks/classify');
const { ensureLabelPayload } = require('../issues/labels');
const { LABELS } = require('../issues/record-vocabulary');
const { parseWorktreeList, findWorktreeEntry } = require('../hooks/worktree-reap');
const { safeReal } = require('../hooks/worktree-detect');

const BIN_DIR = path.join(__dirname, '..', '..');
const AUTHORIZING_LABEL = LABELS.AUTO_MERGE;
// The bounded watch (pr-first-merge.md Step 2.5): 15 minutes, polled every 30 seconds.
const MERGE_WATCH_BOUND_MS = 15 * 60 * 1000;
const MERGE_WATCH_POLL_MS = 30 * 1000;

function bin(name) {
  return path.join(BIN_DIR, name);
}

// The clock as event timing reads it: a missing or throwing deps.now reads 0, so neither merge()'s
// start nor an emit can throw outside merge()'s catch.
function clock(deps) {
  try {
    return typeof deps.now === 'function' ? deps.now() : 0;
  } catch {
    return 0;
  }
}

// One event per sub-step call. An emit that throws never breaks the step it describes.
function emit(s, step, status, detail, extra) {
  if (!MERGE_STEP_NAMES.includes(step)) throw new Error(`unknown merge step name: ${step}`);
  if (typeof s.deps.emit !== 'function') return;
  const ms = clock(s.deps) - s.startedAt;
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
  // No run directory to write into once the events went stdout-only: skipped, and named.
  if (s.eventsStdoutOnly) {
    s.logFailures.push(`log:${step}`);
    return;
  }
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
// A resolver that throws (a spawn failure) is such a failure too, never the run-level catch's.
function readIntegrationModel(s) {
  const { ctx, deps } = s;
  let r;
  try {
    r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, '--values', 'integration-model'],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch (err) {
    return `integration-model read failed: ${errorText(err)}`;
  }
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
// source rides along for the `--lever` log field. A resolver that throws is a failed read
// (AC8: "a resolver error … run as wait"), so it reads as unresolved like a non-zero exit.
function readLever(s) {
  const { ctx, deps } = s;
  let r;
  try {
    r = deps.node(bin('resolve-policy.js'), ['--run', s.runDir, 'merge-verification'],
      { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  } catch {
    r = { code: null, stdout: '', stderr: '' };
  }
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
// The supplier contract: `deps.judgments(ctx)` returns, or resolves to,
// `{ mergeCheck: { verdict: string }, acceptance: { completed: boolean } }`; a throw, a rejection
// or any other shape is `supplier-failed`.
async function consultSupplier(s) {
  const { ctx, deps } = s;
  let j;
  let threw = null;
  try {
    j = await deps.judgments(ctx);
  } catch (err) {
    threw = err;
  }
  // The supplier await is one of this module's two yields (the other is the watch's sleep): a
  // signal that landed during it was already reported by run.js's handler, so, as the watch does,
  // no further call is made and nothing is emitted, whether the supplier resolved or threw.
  if (typeof deps.interrupted === 'function' && deps.interrupted()) {
    return { stop: 'unclassified', detail: 'supplier: interrupted' };
  }
  if (threw) return stop(s, 'merge-supplier', 'supplier-failed', `judgments threw: ${errorText(threw)}`);
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
// `mergeable` rides on the re-read too (AC6: conflicting "on any read"), beyond the prose's three fields.
const REREAD_FIELDS = 'state,mergeStateStatus,mergeable,headRefOid';
const RUN_FIELDS = 'name,workflowName,status,conclusion,url';
// The ready-run.js states classify reads; `read-failed`, and any state not named here, is a read failure.
const READY_RUN_USED = ['not-applicable', 'met', 'awaiting', 'red', 'draft-skip-without-ready-trigger'];
const LEVER_VALUES = ['merge-when-green', 'wait'];
const PARKED_DESC = 'Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact';
const PARKED_COLOR = '6A737D';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasStrings = (o, keys) => isObject(o) && keys.every((k) => typeof o[k] === 'string');
const isConflicting = (read) => read.mergeStateStatus === 'DIRTY' || read.mergeable === 'CONFLICTING';

// A PR state for a detail. CLOSED is named in other words, not as a closing keyword: neutralize
// strips such a keyword only before a `#N` or issue/PR path, which a bare state word never has, so
// this is wording for the reader, not a guard. Any other state is reduced free text.
function prStateWords(state) {
  return state === 'CLOSED' ? 'shut, not merged' : reduceDetail(state);
}

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
  // A gate entry (the first, or a re-entry on a changed head) owns no running watch: a watch it
  // starts, or a degrade from its own arm, counts its bound afresh.
  s.watchBoundFrom = null;
  const g = gateReads(s, 'state-read-failed');
  if (g.stop) return stop(s, 'merge-gate', g.stop, g.detail);
  const { read } = g;
  if (read.state !== 'OPEN') return stop(s, 'merge-gate', 'pr-not-open', `PR state ${prStateWords(read.state)}`);
  if (read.headRefOid !== ctx.head) return stop(s, 'merge-gate', 'moving-target', 'the PR head is not the verified head');
  if (isConflicting(read)) {
    emit(s, 'merge-gate', 'ok', `checks not read: conflicting; merge state ${reduceDetail(read.mergeStateStatus)}`);
    return conflictStop(s);
  }
  s.lastRead = read;
  const verdict = classify(ctx, read, g.runs, g.ready);
  s.lastVerdict = verdict.kind;
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
  // Once GitHub refused to arm (Step 3 item 1, s.autoRefused), the rest of the run is the `wait` row.
  if (s.value === 'merge-when-green' && !s.autoRefused) {
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
  if (!hasStrings(read, ['state', 'mergeStateStatus', 'mergeable', 'headRefOid'])) {
    return stop(s, 'merge-gate', 'state-read-failed', 'state re-read returned an unusable shape');
  }
  if (read.headRefOid !== first.headRefOid || read.state !== 'OPEN') {
    if (s.reentries >= 1) return stop(s, 'merge-gate', 'moving-target', 'the PR changed between reads a second time');
    s.reentries += 1;
    s.recomposeOnReentry = true;
    emit(s, 'merge-gate', 'ok', `${read.state !== 'OPEN' ? 'state' : 'head'} changed between reads; re-entering the gate once`);
    return gate(s);
  }
  if (isConflicting(read)) return conflictStop(s);
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

// Ports Step 3 items 2, 4 and 5, "degrade to ready+comment": a `merge-refused` stop leaves the PR
// as the last call left it, with one PR comment from the fixed template, and parks nothing. `detail` is the result's
// detail (the stop event's too, after `eventHead`), `said` the free text the comment reduces. A
// failed post never changes the reason: the detail names it, and a SKIP degrade trace keeps it in
// decisions.md.
function refusedStop(s, step, cls, { detail: base, said, eventHead = '' }) {
  const { ctx, deps } = s;
  let note = '';
  try {
    deps.gh(['pr', 'comment', '--repo', ctx.repo, '--body', refusedComment({ pr: ctx.pr, cls, detail: said }), '--', String(ctx.pr)]);
  } catch (err) {
    const failuresBefore = s.logFailures.length;
    logDecision(s, 'Step 3 (merge refused) (degraded)',
      `condition: merge-refused PR comment post failed (${reduceDetail(errorText(err))}) → fallback: refusal kept in the event and the result only`,
      'SKIP', 'n/a');
    note = ` (PR comment failed: ${errorText(err)}${logNote(s, failuresBefore)})`;
  }
  const detail = `${base}${note}`;
  emit(s, step, 'stop', `${eventHead}${detail}`);
  return { stop: 'merge-refused', detail: neutralize(detail) };
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

// Step 3 items 2, 4 and 5 (and item 6's read that shows neither merged nor armed): the class word
// and its fixed phrase, worded after the prose. Any other class renders as `unrecognized`.
const REFUSED_PHRASES = Object.freeze({
  checks: 'checks are red or still running, and there is no auto-merge to arm around them',
  permission: 'a permission gap needs a human with the right access, not a retry',
  unrecognized: 'an error this procedure does not recognize, so it does not guess at its meaning',
  unconfirmed: 'the merge call exited 0 but the PR read back neither merged nor holding auto-merge',
});

// The closing sentence claims a ready PR only for a refusal of the merge call itself; a confirmation
// read that found the PR shut or in draft (`unconfirmed`) names that state in its detail instead.
function refusedComment({ pr, cls, detail } = {}) {
  const c = Object.prototype.hasOwnProperty.call(REFUSED_PHRASES, cls) ? cls : 'unrecognized';
  const close = c === 'unconfirmed' ? 'A human decides what happens next; nothing was parked.'
    : 'The PR stays ready for a human to decide; nothing was parked.';
  return `Merge stopped: PR #${isPositiveInteger(pr) ? pr : 'unknown'} was not merged (${c}: ${REFUSED_PHRASES[c]}). `
    + `Detail: ${reduceDetail(detail)}. ${close}`;
}

// Ports Step 2.5 "Bounded watch", deliberately not the prose loop's shape (#5179): every poll
// re-reads the merge state as well as the checks, so a PR that turns conflicting mid-watch stops
// as `conflict` at that poll instead of timing out. Each poll runs its guards (read failure, not
// OPEN or head changed since the previous read, conflicting) before `classify`, and `s.lastRead`
// moves only once they pass, so the head comparison is against the prior read. Returns { step }
// for a stop the watch owns, or { next } for a hand-off that runs after the watch's time is
// accounted (a hand-off may itself re-enter the gate, which starts another watch).
async function pollUntilDecided(s, boundFrom) {
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
    s.lastVerdict = verdict.kind;
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
    // pending. Step 3's rule applies at every poll: under merge-when-green a BLOCKED read arms,
    // unless GitHub already refused to arm this run (then the watch is the `wait` row's).
    if (s.value === 'merge-when-green' && !s.autoRefused && read.mergeStateStatus === 'BLOCKED') {
      return { next: () => mergeCall(s, 'auto'), note: 'pending and BLOCKED; arming auto-merge', polls };
    }
    if (deps.now() - boundFrom >= MERGE_WATCH_BOUND_MS) {
      return { next: () => park(s, 'checks-pending-timeout'), note: 'checks still pending at the bound', polls };
    }
  }
}

// The watch's time is CI wait: summed on s.ciWaitMs across re-entries, and carried by this
// watch's one exit event as extra.ciWaitMs (run.js's final line sums the events' values).
// `boundFrom` is the start the 15-minute bound counts from: this watch's own start, or, when
// Step 3's degrade resumes a watch it interrupted (same head), that watch's start, so the bound
// stays fixed at the same deadline. The time counted here is always this watch's own.
async function watch(s, boundFrom = null) {
  const { deps } = s;
  s.stage = 'merge-watch';
  const started = deps.now();
  s.watchBoundFrom = typeof boundFrom === 'number' ? boundFrom : started;
  deps.watchClock(started);
  let out;
  let failure = null;
  let waited = 0;
  try {
    out = await pollUntilDecided(s, s.watchBoundFrom);
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

// ---- Step 3: the merge call, its failure signatures, and the confirmation read ----

const CONFIRM_FIELDS = 'state,mergedAt,autoMergeRequest,statusCheckRollup,mergeCommit';
// A SHA-1 or SHA-256 object id.
const MERGE_OID = /^[0-9a-f]{40,64}$/i;
const AUTO_NOT_ALLOWED_LITERALS = [
  'Auto merge is not allowed for this repository',
  'Protected branch rules not configured for this branch',
  'Pull request is in clean status',
];

// Ports pr-first-merge.md Step 3 items 1–5 over a failed call's stderr (never err.message, which
// embeds the argv, title included). Conflict and permission are tested first: the spec's AC11
// degrades an auto-merge wording only when no conflict or permission wording is present, and
// item 1 has the bare mutation name defer to those two. Prose order is 1 auto-not-allowed,
// 2 checks, 3 conflict, 4 permission; only a stderr carrying two classes reads differently.
function classifyMergeFailure(stderr) {
  const t = String(stderr || '');
  if ((/not mergeable/i.test(t) && /conflict/i.test(t)) || /CONFLICTING/.test(t)) return 'conflict';
  // `#403` is a PR or issue number, not an HTTP status.
  if (/(?<!#)\b403\b/.test(t) || /not accessible/i.test(t) || /must have write access/i.test(t)) return 'permission';
  if (AUTO_NOT_ALLOWED_LITERALS.some((l) => t.includes(l))
    || (/auto-merge/i.test(t) && /not allowed|not enabled/i.test(t))
    || t.includes('enablePullRequestAutoMerge')) return 'auto-not-allowed';
  if (/not mergeable/i.test(t) && /required status check|review|checks/i.test(t)) return 'checks';
  return 'unrecognized';
}

// The kill signature of a call cut off by its bound or a signal: execFileSync's ETIMEDOUT code, a
// `killed` flag, or the signal name. Null for any other throw. The word is reduced: it reaches a detail.
function timeoutSignature(err) {
  if (!err) return null;
  if (err.code === 'ETIMEDOUT') return 'ETIMEDOUT';
  if (typeof err.signal === 'string' && err.signal) return reduceDetail(err.signal);
  if (err.killed) return 'killed';
  return null;
}

// Ports Step 3's `gh pr merge` call. `mode` is 'auto' (merge-when-green: arm, or merge when GitHub
// can now) or 'immediate' (the `wait` row). The labels are read again right before every call, so
// an `auto:merge` removed since entry (during the supplier call or the watch) is honored. The
// subject is the one composed before ready, or by the gate's re-entry: no compose happens here.
// `--match-head-commit` is always ctx.head; never --admin, never --delete-branch.
async function mergeCall(s, mode) {
  const { ctx, deps } = s;
  s.stage = 'merge-call';
  const labels = readLabels(s);
  if (labels.unreadable) return stop(s, 'merge-call', 'labels-unreadable', `pre-merge ${labels.unreadable}`);
  if (!labels.names.includes(AUTHORIZING_LABEL)) {
    return stop(s, 'merge-call', 'not-authorized', `record lacks ${AUTHORIZING_LABEL} at the pre-merge read`);
  }
  const auto = mode === 'auto';
  try {
    deps.ghCreate(['pr', 'merge', String(ctx.pr), '--repo', ctx.repo, ...(auto ? ['--auto'] : []), '--squash',
      '-t', s.subject.title, '--body-file', s.subject.bodyFile, '--match-head-commit', ctx.head]);
  } catch (err) {
    const stderr = String((err && err.stderr) || '');
    // A call killed by its bound (or a signal) before saying anything may already have merged or
    // armed on the forge: its outcome is unknown, never a refusal. It takes Step 3 item 6's
    // confirmation read, exactly as an exit 0 does, so a landed merge is not reported as refused.
    const cut = timeoutSignature(err);
    if (!stderr.trim() && cut) {
      emit(s, 'merge-call', 'ok', `gh pr merge timed out with no stderr (mode ${mode}, ${cut}); reading the state`);
      return confirm(s, `merge call timed out (${cut}); state unconfirmed`);
    }
    const cls = classifyMergeFailure(stderr);
    // A hand-off is an `ok` event; the step it hands to emits the real stop (the gate's convention).
    if (cls === 'conflict') {
      emit(s, 'merge-call', 'ok', `gh pr merge refused with a conflict signature (mode ${mode}); handing off to the conflict path`);
      return conflictStop(s);
    }
    if (cls === 'auto-not-allowed' && auto) {
      // Step 3 item 1 under merge-when-green: degrade to Step 2.5's `wait` row, never to an
      // immediate merge. A green read re-reads and merges; a pending (BLOCKED) read lands in the
      // bounded watch. s.autoRefused keeps the rest of the run on the `wait` row, so no later
      // read arms again and an immediate call never degrades. An arm from a watch poll resumes
      // that watch at its deadline (s.watchBoundFrom, null after a gate arm): the head is unchanged.
      s.autoRefused = true;
      const green = s.lastVerdict === 'green';
      emit(s, 'merge-call', 'ok', `gh pr merge --auto refused (auto-not-allowed); degrading to the wait row (${green ? 're-read' : 'watch'})`);
      return green ? rereadThenMerge(s, s.lastRead) : watch(s, s.watchBoundFrom);
    }
    // Only the immediate form reaches here with auto-not-allowed: an arm refusal on a call that
    // did not arm is a signature this procedure does not recognize.
    const shown = cls === 'auto-not-allowed' ? 'unrecognized' : cls;
    const first = firstLine(stderr);
    const code = err && typeof err.code === 'string' ? ` (${reduceDetail(err.code)})` : '';
    const said = first ? reduceDetail(first) : `gh pr merge failed with no stderr${code}`;
    return refusedStop(s, 'merge-call', shown, { detail: `merge-refused (${shown}): ${said}`, said });
  }
  emit(s, 'merge-call', 'ok', `gh pr merge exited 0 (mode ${mode})`);
  return confirm(s);
}

// Step 3 item 6's report of the rollup at merge time: concluded, not concluded, or none at all.
function rollupSummary(rollup) {
  if (!Array.isArray(rollup)) return 'merged — status checks unreadable at merge time';
  if (rollup.length === 0) return 'merged — no status checks on this PR';
  const entries = rollup.map(normalizeEntry);
  const open = entries.filter((e) => e.status !== 'COMPLETED');
  // Joined first, reduced once, so reduceDetail's length cap bounds the whole list, not each name.
  const names = (es) => reduceDetail(es.map((e) => e.name || 'unnamed').join(', '));
  if (open.length) return `merged — ${names(open)} had not concluded at merge time`;
  return `merged, ${names(entries)} concluded ${reduceDetail(entries.map((e) => e.conclusion || 'unknown').join(', '))}`;
}

function readConfirmation(s) {
  const { ctx, deps } = s;
  try {
    const read = parseJson(deps.gh(['pr', 'view', String(ctx.pr), '--repo', ctx.repo, '--json', CONFIRM_FIELDS]));
    return hasStrings(read, ['state']) ? read : null;
  } catch {
    return null;
  }
}

// Ports Step 3 item 6: a merge call that exited 0 either merged or armed, and only this read says
// which; exit 0 alone is never `merged`. A failed read is retried once; a second failure is
// state-read-failed with no post-merge call (the reconciler completes a merge that did land).
// mergeCommit rides on the same read so the merge sha needs no second call. A merge call that
// timed out routes here too; `unreadDetail` then names the timeout instead of the exit 0.
async function confirm(s, unreadDetail = 'merge call exited 0; state unconfirmed') {
  const { ctx } = s;
  s.stage = 'merge-confirm';
  const read = readConfirmation(s) || readConfirmation(s);
  if (!read) return stop(s, 'merge-confirm', 'state-read-failed', unreadDetail);
  if (read.state === 'MERGED') {
    const mc = read.mergeCommit;
    // Only a full hex object id counts: the sha becomes a `git describe` argument, so anything
    // else (an option-shaped string included) is treated as no merge commit.
    const mergeCommit = isObject(mc) && typeof mc.oid === 'string' && MERGE_OID.test(mc.oid) ? mc.oid : null;
    // Check names are free text: the result detail is neutralized like every stop's.
    const detail = neutralize(rollupSummary(read.statusCheckRollup));
    emit(s, 'merge-confirm', 'ok', detail);
    return { outcome: 'merged', mergeCommit, detail };
  }
  if (read.state === 'OPEN' && read.autoMergeRequest) {
    // Step 2.5's armed line; the parenthetical names the read that handed off to the arm, which is
    // the contract's literal "(mergeStateStatus BLOCKED, checks pending)" on its own path.
    const held = `mergeStateStatus ${reduceDetail(s.lastRead && s.lastRead.mergeStateStatus)}, checks ${s.lastVerdict}`;
    const failuresBefore = s.logFailures.length;
    logDecision(s, 'Step 2.5 (merge-verification gate)',
      `armed — forge holds the merge (${held}) on PR #${ctx.pr}; reconciler completes cleanup on merged evidence.`,
      'AUTO', 'high (gh pr merge --disable-auto)', `merge-verification=${s.value} (${s.source})`);
    const note = s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
    const detail = neutralize(`armed — auto-merge armed, the forge holds the merge; the reconciler completes cleanup${note}`);
    emit(s, 'merge-confirm', 'ok', detail);
    return { outcome: 'armed', mergeCommit: null, detail };
  }
  const said = `confirmation read state ${prStateWords(read.state)}`;
  return refusedStop(s, 'merge-confirm', 'unconfirmed', { detail: said, said, eventHead: 'merge-refused: ' });
}

// ---- The post-merge sequence: _shared/pr-first-merge-post-merge.md Steps 4 and 5 ----

// The reconcile call mirrors, checks the release and archives the run: it gets a long bound.
const RECONCILE_TIMEOUT_MS = 150000;
const NOT_LOCKED = /not locked/i;

// The ONLY git call site in this module: every git argv is a literal array passed here (the
// source scan relies on it). settle.js's gitIn shape. No call here writes to the remote, so none
// passes `remoteWrite` and every one takes deps.git's ordinary GIT_TIMEOUT_MS bound; `env` is for
// a call whose stderr is classified (the describe, pinned to the C locale).
function runGit(s, args, { env = null } = {}) {
  const { ctx, deps } = s;
  const opts = { cwd: ctx.mainCheckout };
  if (env) opts.env = env;
  return deps.git(['-C', ctx.mainCheckout, ...args], opts);
}

// A post-merge failure: a `fail` event and an entry on the result's failures. It never changes
// the outcome from `merged`.
function postFail(s, step, name, detail, extra) {
  s.pmFailures.push(name);
  emit(s, step, 'fail', `${name}: ${detail}`, extra);
}

// Each sub-step is fail-safe: a throw inside one is that sub-step's failure and the sequence goes on.
function guarded(s, step, name, fn) {
  try {
    fn();
  } catch (err) {
    postFail(s, step, name, `threw: ${errorText(err)}`);
  }
}

// The decision lines a sub-step could not write (named by logDecision), for its event detail.
function logNote(s, failuresBefore) {
  return s.logFailures.length > failuresBefore ? ` (${s.logFailures.slice(failuresBefore).join(', ')})` : '';
}

// Ports Steps 4.0 and 4.0b: post-merge-run.js is routed on its `verdict`, never on exit 0 alone
// (exit 2 and 3 are malformed and unanchored calls).
function runPostMergeRun(s, out) {
  const { ctx, deps } = s;
  s.stage = 'merge-post-merge';
  const r = deps.node(bin('post-merge-run.js'), ['--run', s.runDir], { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  if (r.code !== 0) {
    return postFail(s, 'merge-post-merge', 'post-merge-run', `post-merge-run.js exited ${r.code === null ? 'without finishing (timed out)' : r.code}`);
  }
  const body = parseJson(String(r.stdout).trim());
  if (!isObject(body) || typeof body.verdict !== 'string') {
    return postFail(s, 'merge-post-merge', 'post-merge-run', 'post-merge-run.js printed no verdict');
  }
  out.verdict = body.verdict;
  out.failedSteps = Array.isArray(body.failedSteps) ? body.failedSteps.filter((x) => typeof x === 'string') : [];
  if (body.verdict === 'failed') {
    // A verdict, not a failed call: carried on the result and the event, never an entry on `failures`.
    // A `failed` entry with no failedSteps is a skip (no-pr, claim-failed, gh-absent, ...): name its
    // reason and the `next` routing field instead of an empty step list.
    const extra = { verdict: 'failed', failedSteps: out.failedSteps };
    let named = out.failedSteps.join(', ');
    if (!named) {
      const reason = typeof body.reason === 'string' && body.reason ? reduceDetail(body.reason) : 'unnamed';
      const next = typeof body.next === 'string' && body.next ? reduceDetail(body.next) : null;
      named = `${reason}${next ? ` (next ${next})` : ''}`;
      extra.reason = reason;
      if (next) extra.next = next;
    }
    emit(s, 'merge-post-merge', 'fail', `post-merge steps failed: ${named}`, extra);
  } else {
    emit(s, 'merge-post-merge', 'ok', `post-merge verdict ${reduceDetail(body.verdict)}`);
  }
  return undefined;
}

// Ports Step 4.1: which release carried this merge, from tag ancestry, then the run comment.
function releaseStatus(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-release-status';
  const failuresBefore = s.logFailures.length;
  const unavailable = (reason) => {
    // log-decision.js writes the `{step}: ` prefix itself and refuses a text that repeats it.
    const text = `release status unavailable (${reduceDetail(reason)})`;
    logDecision(s, 'pr-first-merge Step 4.1', text, 'AUTO', 'n/a');
    return postFail(s, 'merge-release-status', 'release-status', `pr-first-merge Step 4.1: ${text}${logNote(s, failuresBefore)}`);
  };
  if (!s.mergeCommit) return unavailable('no merge commit was reported');
  try {
    // A read of the base, as steps.js fetches the same ref: the ordinary git bound, and
    // `--end-of-options` so a base named like an option is never read as one.
    runGit(s, ['fetch', '--end-of-options', 'origin', ctx.base]);
  } catch (err) {
    return unavailable(`fetch failed: ${errorText(err)}`);
  }
  let line;
  try {
    // The "not yet tagged" answer is read off git's English stderr, so the call runs in the C
    // locale (LC_ALL also overrides LANGUAGE there), as run-liveness/process-probe.js pins ps.
    const out = runGit(s, ['describe', '--tags', '--contains', '--first-parent', '--match', 'v*', '--end-of-options', s.mergeCommit],
      { env: { ...(deps.env || process.env), LC_ALL: 'C' } });
    // `git describe` suffixes every ancestor of the tagged commit with ~N or ^N.
    const tag = firstLine(out).replace(/(?:[~^]\d*)+$/, '');
    if (!/^v[0-9A-Za-z._+-]+$/.test(tag)) return unavailable('git describe printed no tag');
    line = `already carried by ${tag}`;
  } catch (err) {
    if (!String((err && err.stderr) || '').startsWith('fatal: cannot describe')) {
      return unavailable(`git describe failed: ${errorText(err)}`);
    }
    line = 'not yet in a release — bump pending';
  }
  logDecision(s, 'pr-first-merge Step 4.1', `release status — ${line}.`, 'AUTO', 'n/a');
  // Create only: the run directory is minted fresh for each driver run and the merge runs once per
  // run, so no earlier release-status comment can exist on this PR to update.
  const file = path.join(s.runDir, 'release-status-comment.md');
  try {
    deps.writeFile(file, `<!-- run-comment: release-status -->\n${line}\n`);
    deps.gh(['pr', 'comment', String(ctx.pr), '--repo', ctx.repo, '--body-file', file]);
  } catch (err) {
    // The comment is the only surface for this line besides the event: keep it in decisions.md too.
    logDecision(s, 'pr-first-merge Step 4.1 (degraded)',
      `condition: release-status comment post failed (${reduceDetail(errorText(err))}) → fallback: release line kept in decisions.md and the event`,
      'SKIP', 'n/a');
    return postFail(s, 'merge-release-status', 'release-status-comment', `${line}; run comment failed: ${errorText(err)}${logNote(s, failuresBefore)}`);
  }
  emit(s, 'merge-release-status', 'ok', `${line}${logNote(s, failuresBefore)}`);
  return undefined;
}

// `lstatType` answers `{ type, code }`; only a directory counts as a run dir (a file or a symlink
// at the path does not), and an unreadable answer is "not there".
function isDirectory(deps, p) {
  try {
    const st = deps.lstatType(p);
    return !!st && st.type === 'directory';
  } catch {
    return false;
  }
}

// Ports Step 4.2: reconcile, then follow the run directory, which reconcile may have archived.
// Neither the original nor its archive twin existing leaves the original path in use and sends
// the events to stdout only.
function reconcile(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-reconcile';
  const r = deps.node(bin('hooks.js'), ['reconcile', '--checks', 'mirror,release,archive'],
    { cwd: ctx.mainCheckout, timeout: RECONCILE_TIMEOUT_MS, env: deps.env });
  if (r.code !== 0) {
    // null: killed by the timeout. The original path stays in use.
    return postFail(s, 'merge-reconcile', 'reconcile',
      r.code === null || r.code === undefined ? 'reconcile did not finish (timed out or killed)' : `reconcile exited ${r.code}`);
  }
  let where = 'run directory kept in place';
  if (!isDirectory(deps, s.runDir)) {
    const archive = path.join(ctx.mainCheckout, '.claude-tweaks', 'pipelines', 'archive', path.basename(s.runDir));
    if (isDirectory(deps, archive)) {
      s.runDir = archive;
      where = 'run directory followed into the archive';
    } else {
      s.eventsStdoutOnly = true;
      where = 'run directory and its archive are missing or unreadable; events go to stdout only';
    }
  }
  // Before the reconcile event, so it lands where the rest of the run writes (or on stdout alone).
  deps.rebindEvents(s.eventsStdoutOnly ? null : s.runDir);
  emit(s, 'merge-reconcile', 'ok', where);
  return undefined;
}

// Ports Step 4's teardown: remove the record's worktree, then its local branch. No force flag: a
// worktree with modified or untracked files refuses removal, stays, and is named in the event.
// Returns whether the worktree is gone (the remote delete runs only then).
function teardown(s) {
  const { ctx, deps } = s;
  s.stage = 'merge-teardown';
  const { worktree, branch, base } = ctx;
  const failuresBefore = s.logFailures.length;
  const failedBefore = s.pmFailures.length;
  const notes = [];
  let gone = false;
  try {
    // No worktree path to match is not "already gone": nothing was removed, so nothing downstream runs.
    if (!worktree) throw new Error('the run records no worktree path');
    const listed = parseWorktreeList(runGit(s, ['worktree', 'list', '--porcelain']));
    if (!findWorktreeEntry(listed, canonicalWorktreePath(worktree, deps.realpath || safeReal, deps.pathImpl || path), deps.pathImpl || path)) {
      notes.push('worktree already gone');
      gone = true;
    } else {
      try {
        // A locked worktree refuses a plain `worktree remove`, and this teardown never forces.
        runGit(s, ['worktree', 'unlock', worktree]);
      } catch (err) {
        // A worktree that is not locked is fine; any other refusal is left for the removal to surface.
        if (!NOT_LOCKED.test(String((err && err.stderr) || ''))) notes.push(`unlock failed: ${errorText(err)}`);
      }
      runGit(s, ['worktree', 'remove', worktree]);
      notes.push('worktree removed');
      gone = true;
    }
  } catch (err) {
    s.pmFailures.push('teardown-worktree');
    notes.push(`worktree kept (${worktree || 'unnamed'}): ${errorText(err)}`);
  }
  if (gone) {
    let present = true;
    if (!branch || branch === base) {
      present = false;
      s.pmFailures.push('teardown-branch');
      notes.push(`local branch not deleted: ${branch ? 'refused (integration branch)' : 'no branch name'}`);
    } else {
      try {
        runGit(s, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}`]);
      } catch (err) {
        if (err && err.status === 1) {
          present = false;
          notes.push('local branch already gone');
        } else {
          present = false;
          s.pmFailures.push('teardown-branch');
          notes.push(`local branch lookup failed: ${errorText(err)}`);
        }
      }
    }
    if (present) {
      try {
        runGit(s, ['branch', '-D', '--end-of-options', branch]);
        notes.push('local branch deleted');
      } catch (err) {
        s.pmFailures.push('teardown-branch');
        notes.push(`local branch kept: ${errorText(err)}`);
      }
    }
  }
  logDecision(s, 'Step 4 (teardown)', `teardown: ${notes.join('; ')}`, 'AUTO', 'n/a');
  emit(s, 'merge-teardown', s.pmFailures.length > failedBefore ? 'fail' : 'ok', `${notes.join('; ')}${logNote(s, failuresBefore)}`);
  return gone;
}

// ctx.repo is the run's `--repo` slug, host-qualified off github.com (`{host}/owner/name`,
// repo-resolve.js resolveRepoTarget). A REST path takes the bare owner/name, so the host is split
// off and travels as --hostname, which also keeps ghOptions from injecting another host.
function apiTarget(repo) {
  const parts = String(repo || '').split('/');
  return parts.length === 3 ? { slug: `${parts[1]}/${parts[2]}`, host: ['--hostname', parts[0]] } : { slug: String(repo || ''), host: [] };
}

// Ports Step 5: the remote branch delete, only once the worktree is gone and never for the
// integration branch. "reference does not exist" (already deleted) is success. The branch goes
// into the REST path encoded per segment: its `/` separators stay, while a `#`, `?` or `%` in a
// segment cannot end or reshape the path.
function deleteRemoteBranch(s, worktreeGone) {
  const { ctx, deps } = s;
  s.stage = 'merge-delete-branch';
  const failuresBefore = s.logFailures.length;
  if (!worktreeGone) return postFail(s, 'merge-delete-branch', 'delete-branch: worktree kept', 'no remote delete while the worktree is kept');
  if (!ctx.branch || ctx.branch === ctx.base) {
    return postFail(s, 'merge-delete-branch', 'delete-branch: refused (integration branch)',
      'no remote delete for the integration branch or an empty branch name');
  }
  let detail = 'deleted the remote branch';
  try {
    const target = apiTarget(ctx.repo);
    const ref = String(ctx.branch).split('/').map(encodeURIComponent).join('/');
    deps.gh(['api', '-X', 'DELETE', `repos/${target.slug}/git/refs/heads/${ref}`, ...target.host]);
  } catch (err) {
    // Unverified wording: the post-merge prose names only the phrase, matched case-insensitively.
    if (!/reference does not exist/i.test(String((err && err.stderr) || ''))) {
      return postFail(s, 'merge-delete-branch', 'delete-branch', `delete failed: ${errorText(err)}`);
    }
    detail = 'the remote branch was already gone';
  }
  logDecision(s, 'Step 5 (delete remote branch)', `${detail}.`, 'AUTO', 'n/a');
  emit(s, 'merge-delete-branch', 'ok', `${detail}${logNote(s, failuresBefore)}`);
  return undefined;
}

// Ports settle.js's `settle-close` row: a run reconcile kept in place, once teardown removed its
// worktree, is left non-terminal (status active, naming a worktree that is gone), so close it.
// --run is explicit, so close-run does not refuse the driver-owned run as foreign. No call when
// reconcile archived the run (s.runDir moved to the archive twin), when the run directory is gone
// (events stdout-only), or when the worktree was kept (close-run refuses a live worktree).
function closeRun(s, worktreeGone) {
  const { ctx, deps } = s;
  if (!worktreeGone || s.eventsStdoutOnly || s.runDir !== ctx.runDir) return undefined;
  s.stage = 'merge-close-run';
  const r = deps.node(bin('hooks.js'), ['close-run', '--run', s.runDir], { cwd: ctx.mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env });
  if (r.code !== 0) {
    return postFail(s, 'merge-close-run', 'close-run',
      r.code === null || r.code === undefined ? 'hooks.js close-run did not finish (timed out or killed)' : `hooks.js close-run exited ${r.code}`);
  }
  emit(s, 'merge-close-run', 'ok', 'run closed (reconcile kept it in place)');
  return undefined;
}

// The sequence, in the spec's order (AC12), then the run's close. It never throws and never
// changes the outcome.
async function postMerge(s) {
  const out = { verdict: null, failedSteps: [] };
  s.pmFailures = [];
  guarded(s, 'merge-post-merge', 'post-merge-run', () => runPostMergeRun(s, out));
  guarded(s, 'merge-release-status', 'release-status', () => releaseStatus(s));
  guarded(s, 'merge-reconcile', 'reconcile', () => reconcile(s));
  let gone = false;
  guarded(s, 'merge-teardown', 'teardown-worktree', () => { gone = teardown(s); });
  guarded(s, 'merge-delete-branch', 'delete-branch', () => deleteRemoteBranch(s, gone));
  guarded(s, 'merge-close-run', 'close-run', () => closeRun(s, gone));
  return { verdict: out.verdict, failedSteps: out.failedSteps, failures: [...s.pmFailures] };
}

// `ciWaitMs` is informational: run.js totals the CI wait from the `merge-watch` events' own
// ciWaitMs, so adding this field to that total as well would count the wait twice.
function result(s, outcome, reason, detail, extra = {}) {
  return {
    outcome, reason, detail: detail || '', mergeCommit: null, runDir: s.runDir, ciWaitMs: s.ciWaitMs, postMerge: null,
    eventsStdoutOnly: s.eventsStdoutOnly === true, ...extra,
  };
}

async function merge(ctx, deps) {
  const s = {
    ctx, deps, runDir: ctx.runDir, value: 'wait', source: 'unresolved', valueRaw: '', keepOpen: [],
    subject: null, reentries: 0, recomposeOnReentry: false, ciWaitMs: 0, lastRead: null, lastVerdict: null, autoRefused: false,
    watchBoundFrom: null, logFailures: [], logSeq: 0, eventsStdoutOnly: false, mergeCommit: null, pmFailures: [], stage: 'merge-entry',
    startedAt: clock(deps),
  };
  try {
    const e = await entry(s);
    if (e.stop) return result(s, 'pending-review', e.stop, e.detail);
    closingLinks(s);
    const c = compose(s);
    if (c.stop) return result(s, 'pending-review', c.stop, c.detail);
    const ready = markReady(s);
    if (ready.stop) return result(s, 'pending-review', ready.stop, ready.detail);
    // Every route through the gate ends in a stop or in confirm's merged / armed.
    const g = await gate(s);
    if (g.stop) return result(s, 'pending-review', g.stop, g.detail);
    if (g.outcome === 'armed') return result(s, 'armed', null, g.detail);
    if (g.outcome !== 'merged') throw new Error(`the gate returned no stop and no outcome (${String(g.outcome)})`);
    s.stage = 'merge-post-merge';
    s.mergeCommit = g.mergeCommit;
    const pm = await postMerge(s);
    return result(s, 'merged', null, g.detail, { mergeCommit: g.mergeCommit, postMerge: pm });
  } catch (err) {
    return result(s, 'pending-review', 'unclassified', `${s.stage}: ${neutralize(errorText(err))}`);
  }
}

// The spec's closed rule: every `pending-review` reason `merge` reports, plus `unclassified` for a
// stop outside it. Two always carry a detail after a colon (`check-failed:{names}`,
// `draft-skip-without-ready-trigger:{files}`) and are listed by their stem; isReason reads both forms.
const REASONS = Object.freeze([
  'no-supplier', 'labels-unreadable', 'not-authorized', 'summary-entry-missing', 'not-pr-first', 'gh-absent',
  'supplier-failed', 'verdict-not-confirmed', 'acceptance-not-completed', 'compose-refused', 'ready-failed',
  'state-read-failed', 'pr-not-open', 'moving-target', 'checks-read-failed', 'check-failed', 'checks-pending-timeout',
  'draft-skip-without-ready-trigger', 'conflict', 'merge-refused', 'unclassified',
]);
const PREFIXED_REASONS = Object.freeze(['check-failed', 'draft-skip-without-ready-trigger']);

function isReason(reason) {
  if (typeof reason !== 'string') return false;
  const i = reason.indexOf(':');
  if (i === -1) return REASONS.includes(reason) && !PREFIXED_REASONS.includes(reason);
  return PREFIXED_REASONS.includes(reason.slice(0, i)) && reason.length > i + 1;
}

module.exports = {
  merge, parkComment, conflictComment, refusedComment, classifyMergeFailure, REASONS, PREFIXED_REASONS, isReason,
  MERGE_WATCH_BOUND_MS, MERGE_WATCH_POLL_MS, RECONCILE_TIMEOUT_MS,
};
