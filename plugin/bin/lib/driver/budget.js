'use strict';
// The pipeline driver's `--budget <n|all>` loop (drive.js, record #5229). runBudget reads the
// policy through the table's own policy step (an unreadable policy exits 1; `express-driver:
// off` refuses before any pull), then loops: pull the dispatch queue (deps.queuePull), pre-screen
// every record of every group the ranking could select (a group the pull excluded for an
// UNSELECTABLE_REASONS reason is left alone) with the eligibility step's own call, rank
// (deps.rankNext) against the pull's exclusions plus this invocation's in-memory `firing`
// entry, and drive the top group's members one at a time, in the group's own order, through
// `driveOne` (run.js's driveRecord). It never reorders, filters or re-derives the
// selection beyond the pre-screen and the `firing` entry. One summary line (BUDGET_STEP) closes
// the run, except on the exit-1 policy path and after an interrupt, where nothing further is
// emitted.
//
// Counting: from the claim. A record whose claim was obtained and whose run directory was
// minted (`claimed` true) is `driven` and consumes budget, whatever its outcome; nothing else
// does. Every handled record lands in exactly one COUNTERS entry (classifyFacts; a pre-screen
// skip is `skipped`); a record only in a group the pull excluded for an UNSELECTABLE_REASONS
// reason is never pre-screened, never handled and never counted. A claim stop
// ends the run with the rest of the budget unused: claim-targets.js exit 7
// (`permission-stop`), or exit 2 or 6 (`claim-stop`), whose cause every later claim would meet
// too; exits 3, 4 and 5, an exit 0 that claimed nothing, a killed claim and a failed mint are
// per-record.
//
// Termination: every member of every handled group, and every member of a selectable group whose
// members the pre-screen all skips, joins the in-memory `firing` set handed to the ranking, so no
// record is selected twice in one invocation and a queue that never shrinks still ends. A failed
// or malformed pull (a group that is not an array or is empty, a member that is not an object with a
// positive integer `number`), or a ranking that throws, is `pull-failed` (exit 1), never an empty queue.
//
// Every effect goes through `deps`: this module makes no file call and spawns nothing. The loop
// keeps its own drain-PR list (`dispatch-drain-prs.json`, the PRs it opened, rewritten whole after
// each driven record) and hands it, plus the latest pull's `dispatch-near-dup-pairs.json` when
// that file exists, to every record it drives through `shared`, so the merge step's drain-overlap
// hold applies as it does in a dispatch drain. A list that cannot be trusted (a failed write, a
// record that returned no final line or threw) makes every later record hold as
// in-flight-unreadable. The list file is left in place when the run ends, beside the pull's own
// session files in the same session directory. The
// queue-pull module's own stdout (Warnings, AUTO lines) is routed to deps.stderr, so the
// driver's stdout carries JSON event lines only. The event sink is never bound to a run
// directory: these run-level lines go to stdout alone.
const path = require('node:path');
const { STEP, BUDGET_STEP, createEventSink, yieldToEventLoop, firstLine, errorText } = require('./events');
const { STEPS, eligibilityOptions } = require('./steps');
const { formatTimestamp } = require('../hooks/run-dir-resolve');
const { groupIsExcluded } = require('../dispatch/exclusions');
const { CLAIM_KIND, readClaimExit } = require('./claim-exit');
const { sessionTmpRoot } = require('../session-tmp');

const DRAIN_PRS_FILE = 'dispatch-drain-prs.json';
// A path that never exists: merge.js maps a failed read of the list to in-flight-unreadable.
const DRAIN_PRS_MISSING_FILE = 'dispatch-drain-prs.missing.json';
// The queue pull's strong near-duplicate pairs, written under the same session directory.
const NEAR_DUP_PAIRS_FILE = 'dispatch-near-dup-pairs.json';

// The pull's exclusion reasons whose groups stay in the pulled groups yet are never selectable
// (rankNext skips them too): the queue-pull module's own list, never a copy. `firing` is this
// loop's own and is handled by `attempted`.
const { STAYING_EXCLUSION_REASONS: UNSELECTABLE_REASONS } = require('../dispatch/queue-pull');

const ENDED = Object.freeze({
  BUDGET: 'budget',
  EXHAUSTED: 'exhausted',
  PERMISSION_STOP: 'permission-stop',
  CLAIM_STOP: 'claim-stop',
  PULL_FAILED: 'pull-failed',
  POLICY_REFUSED: 'policy-refused',
});

const STATUS_BY_ENDED = Object.freeze({
  [ENDED.BUDGET]: 'ok',
  [ENDED.EXHAUSTED]: 'ok',
  [ENDED.PERMISSION_STOP]: 'stop',
  [ENDED.CLAIM_STOP]: 'stop',
  [ENDED.PULL_FAILED]: 'fail',
  [ENDED.POLICY_REFUSED]: 'ok',
});

const COUNTERS = Object.freeze(['driven', 'refused', 'skipped', 'contested', 'claimFailed', 'permissionStopped']);

// One counter per handled record. Whether the run then ends is the loop's decision, not this one.
// What a claim-targets.js exit means is claim-exit.js's reading.
function classifyFacts(facts) {
  if (facts.claimed === true) return 'driven';
  const { kind } = readClaimExit(facts.claimExit);
  if (kind === CLAIM_KIND.PERMISSION_DENIED) return 'permissionStopped';
  if (kind === CLAIM_KIND.CONTESTED) return 'contested';
  if (facts.outcome === 'refused' && facts.claimExit === null) return 'refused';
  // Exits 2, 4, 5 and 6, an exit 0 that claimed nothing, a killed claim, a failed mint.
  return 'claimFailed';
}

// The eligibility step's own call over the pulled record. `unparseable` (the pulled data lacks a
// field the call needs, or the call throws) passes through to the full per-record path: the
// pre-screen may skip a record, never admit one.
function preScreen(record, opts, deps) {
  if (!record || typeof record !== 'object') return { verdict: 'unparseable', reasons: ['not an object'] };
  if (typeof record.body !== 'string') return { verdict: 'unparseable', reasons: ['body is not a string'] };
  if (!Array.isArray(record.labels)) return { verdict: 'unparseable', reasons: ['labels is not an array'] };
  const { number, title, body, labels, state } = record;
  let verdict;
  try {
    verdict = deps.evaluateRecordEligibility({ number, title, body, labels, state }, opts);
  } catch (err) {
    return { verdict: 'unparseable', reasons: [`eligibility call failed: ${errorText(err)}`] };
  }
  if (!verdict || verdict.eligible !== true) {
    return { verdict: 'skip', reasons: verdict && Array.isArray(verdict.reasons) ? verdict.reasons : [] };
  }
  return { verdict: 'pass', reasons: [] };
}

// The pull's result, or a throw when its shape is not the module's: a malformed pull is a
// failed pull, never an empty queue.
function checkedPull(result) {
  if (!result || typeof result !== 'object') throw new Error('malformed result: not an object');
  if (!Array.isArray(result.groups) || !result.groups.every((g) => Array.isArray(g))) {
    throw new Error('malformed result: groups is not an array of arrays');
  }
  const isRecord = (r) => r !== null && typeof r === 'object' && Number.isSafeInteger(r.number) && r.number > 0;
  if (!result.groups.every((g) => g.every(isRecord))) {
    throw new Error('malformed result: a group member is not a record with a positive integer number');
  }
  // An empty group is no candidate: the ranking returns [] for it (not null), so the loop would
  // attempt nothing and pull again without end.
  if (!result.groups.every((g) => g.length > 0)) throw new Error('malformed result: a group is empty');
  if (!Array.isArray(result.exclusions)) throw new Error('malformed result: exclusions is not an array');
  return result;
}

// budget: a positive integer or 'all'. Resolves to the exit code: 0 when the loop ended
// normally (or was interrupted, when the signal decides how the process ends), 1 for an
// unreadable policy or a failed pull.
async function runBudget(budget, shared, deps, { driveOne, steps = STEPS }) {
  const t0 = deps.now();
  const sink = createEventSink({ stdout: deps.stdout, appendFile: deps.appendFile });
  const counters = Object.fromEntries(COUNTERS.map((c) => [c, 0]));
  const ts = () => deps.date().toISOString();

  const finish = (ended, detail) => {
    const event = { ts: ts(), run: null, record: null, step: BUDGET_STEP, status: STATUS_BY_ENDED[ended], ms: deps.now() - t0 };
    if (detail !== undefined) event.detail = detail;
    event.budget = budget;
    for (const c of COUNTERS) event[c] = counters[c];
    event.ended = ended;
    sink.emit(event);
    return ended === ENDED.PULL_FAILED ? 1 : 0;
  };
  const pullFailed = (err) => {
    const detail = `queue pull failed: ${firstLine((err && (err.line || err.message)) || String(err))}`;
    deps.stderr(`drive.js: ${detail}\n`);
    return finish(ENDED.PULL_FAILED, detail);
  };

  const policyStep = steps.find((s) => s.name === STEP.policy);
  const p0 = deps.now();
  const result = await policyStep.run({ shared, record: null }, deps);
  // The policy read is synchronous: a signal queued during it is delivered only at this turn.
  await yieldToEventLoop();
  if (shared.interrupted) return 0;
  const policyEvent = (status, detail) => ({ ts: ts(), run: null, record: null, step: STEP.policy, status, ms: deps.now() - p0, detail });
  if (result.status !== 'ok') {
    sink.emit(policyEvent(result.status, result.detail));
    deps.stderr(`drive.js: ${result.detail}\n`);
    return 1;
  }
  if (shared.policy['express-driver'].value === 'off') {
    sink.emit(policyEvent('stop', 'express-driver off: --budget drives nothing'));
    return finish(ENDED.POLICY_REFUSED);
  }
  const opts = eligibilityOptions(shared.policy);

  const sessionId = `drive-${formatTimestamp(deps.date())}-${deps.pid}`;
  const moduleDeps = { stdout: deps.stderr, stderr: deps.stderr };
  const root = sessionTmpRoot(sessionId);
  const listPath = path.join(root, DRAIN_PRS_FILE);
  const missingPath = path.join(root, DRAIN_PRS_MISSING_FILE);
  const pairsPath = path.join(root, NEAR_DUP_PAIRS_FILE);
  // The PRs this run opened, and whether the list can no longer be trusted (sticky).
  const drainPrs = [];
  let listBroken = false;
  const breakList = (why, consequence = 'every later driven record holds as in-flight-unreadable') => {
    if (listBroken) return;
    listBroken = true;
    deps.stderr(`drive.js: ${why}; ${consequence}\n`);
  };
  let rootMade = false;
  const writeList = (what) => {
    if (listBroken) return;
    try {
      if (!rootMade) {
        deps.mkdirSync(root, { recursive: true });
        rootMade = true;
      }
      deps.writeFile(listPath, JSON.stringify(drainPrs));
    } catch (err) {
      breakList(`drain-PR list ${what} failed (${listPath}): ${errorText(err)}`);
    }
  };
  // A throwing existence check counts as present: merge.js then reads the file and holds.
  const pairsPresent = () => {
    try {
      return deps.lstatType(pairsPath).type !== 'missing';
    } catch {
      return true;
    }
  };
  // The ranking's in-memory `firing` set, and each record's pre-screen verdict by number.
  const attempted = new Set();
  const verdicts = new Map();
  // A skipped record costs no live fetch and leaves no event line, so its reasons go to stderr
  // where it is counted: the summary's `skipped` says how many, this line says which and why.
  const countSkipped = (n) => {
    counters.skipped += 1;
    deps.stderr(`drive.js: pre-screen skipped #${n} (${verdicts.get(n).reasons.join('; ') || 'not eligible'}); no live fetch\n`);
  };
  // Pre-screens each member not yet attempted, once per record per invocation, in the groups the
  // ranking could select: a group the pull excluded for a UNSELECTABLE_REASONS reason is
  // never screened, counted or added to `firing`. A screened group whose members are all `skip`
  // joins `firing` now, each new member counted `skipped`.
  const screenGroups = (groups, exclusions) => {
    for (const group of groups) {
      if (groupIsExcluded(group, exclusions, UNSELECTABLE_REASONS)) continue;
      const fresh = group.filter((r) => !attempted.has(r.number));
      for (const r of fresh) {
        if (verdicts.has(r.number)) continue;
        const v = preScreen(r, opts, deps);
        verdicts.set(r.number, v);
        if (v.verdict === 'unparseable') {
          deps.stderr(`drive.js: pre-screen could not read #${r.number} (${v.reasons.join('; ')}); taking the full path\n`);
        }
      }
      if (fresh.length > 0 && group.every((r) => verdicts.get(r.number).verdict === 'skip')) {
        for (const r of fresh) {
          attempted.add(r.number);
          countSkipped(r.number);
        }
      }
    }
  };

  writeList('first write');

  for (;;) {
    await yieldToEventLoop();
    if (shared.interrupted) return 0;
    let pull;
    try {
      pull = checkedPull(deps.queuePull({ transport: 'gh', sessionId, cwd: shared.mainRoot, env: deps.env, inputs: {}, omit: [] }, moduleDeps));
    } catch (err) {
      return pullFailed(err);
    }
    shared.nearDupPairsFile = pairsPresent() ? pairsPath : null;
    await yieldToEventLoop();
    if (shared.interrupted) return 0;

    // checkedPull has already refused a member that is not a numbered record, so a throw from
    // the pre-screen pass is a defect here and propagates as an internal error.
    screenGroups(pull.groups, pull.exclusions);
    let top;
    try {
      top = deps.rankNext(pull.groups, [...pull.exclusions, { reason: 'firing', records: [...attempted] }], {});
    } catch (err) {
      return pullFailed(err);
    }
    if (top === null) return finish(ENDED.EXHAUSTED);

    for (const r of top) attempted.add(r.number);
    for (const r of top) {
      const n = r.number;
      if (verdicts.get(n).verdict === 'skip') {
        countSkipped(n);
        continue;
      }
      shared.inFlightPrsFile = listBroken ? missingPath : listPath;
      let facts;
      try {
        facts = await driveOne(n);
      } catch (err) {
        breakList(`#${n} threw before returning its final line`, 'the run ends');
        throw err;
      }
      // Appended only after the record's own merge step has run.
      if (!facts || !facts.final) {
        // An interrupt before the record's first step also yields no final line; the loop returns just below.
        if (!shared.interrupted) breakList(`#${n} returned no final line`);
      } else if (Number.isSafeInteger(facts.final.pr) && facts.final.pr > 0) {
        drainPrs.push({ number: facts.final.pr });
        writeList(`append for #${n}`);
      }
      // A signal queued during the record's last synchronous call is delivered only when the
      // event loop turns (run.js's named-record loop does the same after driveRecord).
      await yieldToEventLoop();
      if (shared.interrupted) return 0;
      const counter = classifyFacts(facts);
      counters[counter] += 1;
      if (counter === 'permissionStopped') {
        return finish(ENDED.PERMISSION_STOP, `claim-targets.js exit ${facts.claimExit} on #${n}`);
      }
      // A cause every later claim would meet too (Plan Review Clarification 1) ends the run.
      if (facts.claimed !== true && readClaimExit(facts.claimExit).kind === CLAIM_KIND.SHARED_CAUSE) {
        return finish(ENDED.CLAIM_STOP, `claim-targets.js exit ${facts.claimExit} on #${n}`);
      }
      if (budget !== 'all' && counters.driven >= budget) return finish(ENDED.BUDGET);
    }
  }
}

module.exports = { runBudget, ENDED, STATUS_BY_ENDED, COUNTERS, UNSELECTABLE_REASONS, classifyFacts, preScreen };
