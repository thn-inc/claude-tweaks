'use strict';
// #5227: queue-pull module parity suite. The bash oracle runs plugin/skills/dispatch/
// queue-pull-script.md's fence whole, in a throwaway sandbox under PATH shims for gh, git and
// mktemp (tests/bin-lib/dispatch/queue-pull-oracle.js), with a frozen clock preloaded into every
// node process (queue-pull-clock-stub.js).
//
// Normalizations (AC1, and nothing else): the sandbox root becomes <SCR> and the pre-minted
// run-dir basename becomes <RUN>. The clock is frozen by the stub rather than normalized, and
// temp names match across sides through the QP_TMPNAME_COUNTER_FILE seam.
// One documented exception (controller ruling, Task 4 review): the four failure lines whose fence
// tail is `$(cat <err file>)` (the not-spec-shaped and open-pr corrupt-exclusions stop lines and
// the not-spec-shaped / open-linked-PR filtering Warnings) compare up to and including their fixed
// prefix, tail excluded. The fence's tail opens with Node's uncaught-exception header (a throw-site
// file:line or a node:internal loader line, Node-version dependent, absent from err.stack); the
// module prints err.message. See TAIL_LINES in queue-pull-oracle.js. The same tail is the whole of
// the .err file the line reads, so on a fault row that prints such a line that one .err file
// compares by its fixed part only (written and non-empty on both sides, the module's message inside
// the oracle's report; faultComparison); every other .err file compares whole.
// One exit-code mapping, not a normalization (R4): where the fence stops (`exit 1`), the CLI exits 4,
// so the parity tests compare a stopped pair's statuses as 1 and 4 and everything else as is.
//
// Script defects the parity matrix (Task 8) shows, reproduced by the module, never fixed:
//   - A candidate whose `labels` is not an array (SMalformed's #9020) throws inside the eligibility
//     block (record-vocabulary.js's normalizeLabelNames calls .map on it), so the eligible list is
//     never written and the pull stops at the group-building check: one malformed record stops
//     every candidate, the clean #9001 included (a cross-candidate effect, on the run ledger).
// Script behavior the fault rows (Task 9) show, reproduced by the module, never fixed:
//   - D1 reaches past the session files: the second pull's write-back persists the first pull's
//     stale groups under the second pull's freshness signal, so a third pull over the same queue
//     would hit the cache on them (NEW: beyond ledger row 1, which names the session files only).
//   - One failed native-dependency GraphQL call (F-native) turns off two passes: the blocked pass's
//     native filtering and, through preflight-records.js's native read, the unlanded-blocker pass
//     (a Warning each). One failed claim fetch (F-claim) prints an AUTO line for the shipped pass and
//     one for the neighbour pass. (NEW cross-pass effects; each pass still fails open.)
//   - A missing or malformed DISPATCH_FOREIGN_STATES file on files prints two fail-closed Warnings:
//     the ignored file, then the gh lookup bodyForeignBlockers still attempts with no gh.
//   - A failed queue or open-numbers fetch stops the pull at the group-building check (the fetch
//     pass's `stop`), a third and fourth stop beside Q3's corrupt-exclusions and unreadable-groups.
//   - F-linked's single Warning (the open-linked-PR lookup failed) also turns off the shipped pass:
//     it drops shipped:9010 as well as the two open-pr exclusions. F-intbranch (no integration-branch
//     policy key, `git remote show origin` fails) drops the unlanded-blocker:9011 exclusion. (NEW
//     cross-pass effects; each pass still fails open.)
//   - A silent fail-open on the files transport: files-verifiedOpenDeps-missing and
//     files-verifiedOpenDeps-malformed exit 0 with no Warning or AUTO line and drop the blocked:9002
//     exclusion, so a blocked record becomes dispatchable with nothing printed (the files twin of
//     F-depview).
//   - The silent fail-opens (ledger row 6) are F-depfresh, F-depview, F-prview and F-openprs.
// One module divergence the matrix found and the module fixed (Task 3 carry): on `files` the
// agent's dependency-freshness file stands where the fence's `gh issue list --search` stands, so
// it is read only when there are dependency numbers to search; otherwise the fence's `echo '[]'`
// holds (S2-files-miss, whose queue declares no dependency, diverged on the write-back blob).
//
// This module holds what queue-pull.test.js, queue-pull-oracle-checks.test.js and the five
// queue-pull-parity-*.test.js files share (each its own node:test process): the fence and the
// strings read from it, the in-process pull harness, the parity-pair machinery (one memoized runPair
// per config name, per process) and the fetch-failure fault pool. State that must be one instance per
// process (PAIR_MEMO, the fault-pool promise) lives here and is never exported; each parity file
// registers the cleanup hooks through registerParityCleanup().
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readText } = require('../../helpers/read-skill');
const {
  SCRIPT_MD, FENCE_FIRST_LINE, extractFence, createSandbox, runOracle, runModuleCli, runPair, normalize, reported, assertParity, runAll, failedJobs,
  STREAM_TRUNCATED, TAIL_LINES,
} = require('./queue-pull-oracle');
const { S1, S2, agentInputs, LANDING_COMMIT, FAULTS, FILES_FAULTS, D1Second, S1LiveDep, fakeRun, fakeSpawnCli } = require('./queue-pull-fixtures');
const { PASSES, SESSION_FILES, sessionPaths, makeContext, runPasses } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const { appendExclusion } = require('../../../plugin/bin/lib/dispatch/exclusions');

const FENCE = extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE);

const fenceText = (re) => {
  const m = FENCE.match(re);
  assert.ok(m, `the fence no longer matches ${re}`);
  return m[1];
};
const HIT_MESSAGE = fenceText(/echo "(Queue-order cache hit [^"]*)" >&2/);
const NATIVE_WARNING_PREFIX = fenceText(/echo "(Warning: native dependency query failed[^$]*)\$\(cat /);
const GROUPING_STOP_RE = /echo "(dispatch: queue-pull stopped -- group-building exclusion pass failed \(exit )\$GROUPING_RC(\); see error above\.)" >&2/;
const CACHE_HIT_STOP_RE = /echo "(dispatch: queue-pull stopped -- cache-hit exclusion pass failed \(exit )\$CACHE_HIT_RC(\); see error above\.)" >&2/;
const LINKED_WARNING = fenceText(/echo "(Warning: linked-PR query failed[^$]*)\$\(cat /);
const OPEN_FILTER_WARNING = fenceText(/echo "(Warning: open-linked-PR filtering failed[^$]*)\$\(cat /);
const OPEN_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: )\$\(cat /);
const TARGET_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- target-missing exclusion pass failed \(exit )\$TARGET_MISSING_RC\); see error above\.\" >&2/);
const MALFORMED_CAUSE = 'a Blocked by line names no valid issue number (#0)';
const NEIGHBOUR_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed \(exit )\$NEIGHBOUR_RC\); see error above\.\" >&2/);
const IN_FLIGHT_POOL_AUTO = fenceText(/echo "(AUTO — dispatch: neighbour-in-flight pool fetch failed[^"]*)" >&2/);

// The canned dispatch-unlanded-blockers.js: for the pipeline fixture's #9012 (a Blocked by line with
// no valid number) and #9011 (a closed blocker whose commit never landed) it appends the real CLI's
// entries and prints the pool without them. A pool holding neither is handed back unchanged.
function cannedLanding(seen) {
  return (args) => {
    seen.push(args);
    const val = (flag) => args[args.indexOf(flag) + 1];
    const groups = JSON.parse(fs.readFileSync(val('--groups'), 'utf8'));
    const present = new Set(groups.flat().map((c) => c.number));
    const gone = new Set();
    if (present.has(9012)) {
      appendExclusion(val('--exclusions'), { reason: 'malformed-blocker', records: [9012], detail: { cause: MALFORMED_CAUSE } });
      gone.add(9012);
    }
    if (present.has(9011)) {
      appendExclusion(val('--exclusions'), { reason: 'unlanded-blocker', records: [9011], detail: { blockers: [{ blocker: 8001, commit: LANDING_COMMIT }] } });
      gone.add(9011);
    }
    return { status: 0, stdout: JSON.stringify(groups.map((g) => g.filter((c) => !gone.has(c.number))).filter((g) => g.length > 0)), stderr: '' };
  };
}

// ---- Task 8: the parity matrix (AC1), multi-reason (AC3), empty and malformed queues (AC5),
// portability and the real-writer pins. Each pair is the bash oracle over the fence (or, on files,
// filesOracleScript's mcp-transport.md rendering of it) beside the real CLI, both under the same
// sandbox shims; see the header for the normalizations and the one exit-code mapping. ----

const POOL = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
const PARITY_S1 = () => S1({ parity: true });
const ALL_REASONS = [...new Set(PASSES.map((p) => p.reason).filter(Boolean))].sort();
const FILES_S1_REASONS = ['blocked', 'malformed-blocker', 'neighbour-in-flight', 'not-spec-shaped', 'oversized', 'target-missing'];
// `reasons`: the exclusion reasons the config's oracle run writes. On files the three gh-backed
// probes (open-pr, shipped, unlanded-blocker) fail open as mcp-transport.md documents.
const MATRIX = [
  { name: 'S1-gh-miss', scenario: PARITY_S1(), transport: 'gh', reasons: ALL_REASONS },
  { name: 'S1-gh-hit', scenario: PARITY_S1(), transport: 'gh', after: 'S1-gh-miss', reasons: ALL_REASONS },
  { name: 'S1-files-miss', scenario: PARITY_S1(), transport: 'files', reasons: FILES_S1_REASONS },
  { name: 'S1-files-hit', scenario: PARITY_S1(), transport: 'files', after: 'S1-files-miss', reasons: FILES_S1_REASONS },
  { name: 'S2-gh-miss', scenario: S2(), transport: 'gh', reasons: ['blocked'] },
  { name: 'S2-files-miss', scenario: S2(), transport: 'files', reasons: ['blocked'] },
];

const AC1_FILES = ['dispatch-groups.json', 'dispatch-exclusions.json', 'dispatch-fastlane-bundles.json', 'dispatch-near-dup-pairs.json',
  'dispatch-crosspr-overlap.json', 'dispatch-linked-prs.json', 'dispatch-shipped-releases.json'];

// One runPair per config name for the whole process: whichever pool reaches a config first runs it,
// and every later pool naming it gets that same result (since the split a process runs one pool, so
// nothing is reused across pools; the memo still guards a name standing for one config and registers
// every pair for cleanup). Every memoized pair's sandboxes are removed once, after the file's last test.
const PAIR_MEMO = new Map();
const pairKey = (cfg) => JSON.stringify([cfg.scenario, cfg.transport || 'gh', cfg.after || null, cfg.agent || null]);
function memoPair(cfg, miss) {
  const key = pairKey(cfg);
  const memo = PAIR_MEMO.get(cfg.name);
  if (memo) {
    if (memo.key !== key) throw new Error(`pair memo: ${cfg.name} names two different configs`);
    return memo.pair;
  }
  const pair = runPair({ ...cfg, origin: miss ? { oracle: miss.oracle.sandbox.origin, module: miss.module.sandbox.origin } : null });
  PAIR_MEMO.set(cfg.name, { key, pair });
  return pair;
}
// Each config as a runAll job: a hit config starts only once its miss config has finished, and each
// of its two sides copies that same side's origin from the miss run (PF1).
const pairJobs = (configs) => configs.map((cfg) => ({ name: cfg.name, after: cfg.after, run: (miss) => memoPair(cfg, miss) }));
const cleanupPairs = (pairs) => { for (const pair of pairs) for (const r of [pair.oracle, pair.module]) r.sandbox.cleanup(); };
// A pool's own summary row: every job settled with a result (each row reading a failed job also
// fails on that job's own error, B7).
const assertEveryJobRan = (R) => assert.deepEqual(failedJobs(R).map(([name, err]) => `${name}: ${err.message}`), [], 'every job in this pool ran');
const sides = (pair) => [['oracle', pair.oracle], ['module', pair.module]];

// Every gh call either side made was answered by the scenario's table, no git call left the
// sandbox (the git shim refuses and logs any directory outside it), and neither stream overflowed
// the 64 KiB capture (a cut stream would compare only its kept head).
function assertClean(pair, label) {
  for (const [side, r] of sides(pair)) {
    assert.deepEqual(r.ghArgv.filter((a) => a.tag === 'UNHANDLED').map((a) => a.argv.join(' ').slice(0, 300)), [], `${label} ${side}: an unanswered gh call`);
    assert.deepEqual(r.gitArgv.filter((a) => a.tag === 'REFUSED'), [], `${label} ${side}: a git call outside the sandbox`);
    for (const channel of ['stdout', 'stderr']) assert.ok(!r[channel].includes(STREAM_TRUNCATED), `${label} ${side}: ${channel} was truncated at 64 KiB`);
  }
}

// R4's mapping for a stopped pair: the fence's `exit 1` is the CLI's 4. Returns the module result
// with the oracle's status, so assertParity compares everything else as is.
function stopMapped(oracle, module) {
  assert.equal(oracle.status, 1, `the oracle stopped: ${oracle.stderr.slice(-2000)}`);
  assert.equal(module.status, 4, `the module stopped: ${module.stderr.slice(-2000)}`);
  return Object.defineProperty({ ...module, status: oracle.status }, 'sandbox', { value: module.sandbox });
}

const exclusionsIn = (r) => JSON.parse(r.files['dispatch-exclusions.json']);
const groupedIn = (r) => JSON.parse(r.files['dispatch-groups.json']).flat().map((c) => c.number);
const ghCall = (r, pattern) => r.ghArgv.map((a) => a.argv).filter((argv) => argv.some((x) => pattern.test(x)));

// ---- Task 9: fetch-failure faults (AC4), files-input faults (AC7.2) and the reproduced script
// defects (D1, D3, D4). Each FAULTS row (queue-pull-fixtures.js) fails one gh fetch, and each
// FILES_FAULTS row one files input, on both sides through the shared table. Its base is the same
// scenario un-faulted: the matrix's config of it where the matrix has one (S1 and S2), else a base config of
// its own; the fault pool runs either (the AC1 file's runs are not shared: each file is its own process).
// One pool runs the rows, bases and D1 of the transports it is asked for, from one `before`. A row asserts what the ORACLE did (Plan Review
// Clarifications, criteria 4, 5 and 7): its exit, the lines it adds on each channel, and its
// exclusions read against the base's. It then asserts that the module did the same.
// Files compared: every session file, byte-equal (JSON-equal), with two row-level carve-outs (see
// faultComparison). ----

const AGENT_STAGED = new Set(['dispatch-queue-raw.json', 'dispatch-open-numbers.json', 'dispatch-dep-freshness.json',
  'dispatch-verified-open-deps.txt', 'dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json']);
// pair -> { files: the session files compared whole, tailErr: the .err files compared by their fixed
// part }. The carve-outs, each only on the row that needs it:
//   - On files, an agent-written input the oracle never wrote while the module holds it: the module
//     side has the agent's files staged before its run, while the oracle's agent writes each at its
//     fence point, so a run that stops first leaves it unwritten on the oracle side only. Every
//     other combination (both written, neither, only the oracle's) compares.
//   - A row whose oracle stderr carries one of the header's four `$(cat <err file>)` lines: that
//     line's .err file is all tail, so it compares by its fixed part only (written and non-empty on
//     both sides, the module's err.message inside the oracle's Node report of the same error).
function faultComparison(pair, transport) {
  const stderrLines = String(pair.oracle.stderr).split('\n');
  const tailErr = [...new Set(TAIL_LINES.filter((t) => stderrLines.some((l) => l.startsWith(t.prefix))).map((t) => t.errFile))];
  const stagedOnly = (n) => transport === 'files' && AGENT_STAGED.has(n) && pair.oracle.files[n] === null && pair.module.files[n] !== null;
  return { files: SESSION_FILES.filter((n) => !tailErr.includes(n) && !stagedOnly(n)), tailErr };
}
function assertFaultFiles(pair, transport, label, module = pair.module) {
  const { files, tailErr } = faultComparison(pair, transport);
  assertParity(pair.oracle, module, { files });
  for (const name of tailErr) {
    const [o, m] = [pair.oracle, pair.module].map((r) => r.files[name]);
    assert.ok(o && m, `${label}: ${name} is written and non-empty on both sides (oracle ${JSON.stringify(o)}, module ${JSON.stringify(m)})`);
    assert.ok(normalize(o, pair.oracle.sandbox).includes(normalize(m.trim(), pair.module.sandbox)), `${label}: the module's ${name} is the error the oracle's reports:\n${o}\n---\n${m}`);
  }
  return tailErr;
}
const fullStop = (re) => { const m = re.exec(FENCE); return `${m[1]}1${m[2]}`; };
const STOP_LINE = {
  grouping: fullStop(GROUPING_STOP_RE),
  cacheHit: fullStop(CACHE_HIT_STOP_RE),
  neighbour: `${NEIGHBOUR_STOP}1); see error above.`,
  target: `${TARGET_STOP}1); see error above.`,
};
// Lines the CLIs and libraries the fence runs print (not fence echo text).
const LANDING_SKIPPED = 'Warning: unlanded-blocker pass skipped — ';
const LANDING_EXITED = `${LANDING_SKIPPED}preflight-records.js exited 1; no unlanded-blocker exclusions this pull`;
const CLAIM_READ_FAILED_7001 = 'AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight';
const FOREIGN_LOOKUP_NO_GH = 'Warning: foreign blocker state lookup failed (exit 2: resolve-foreign-blockers.js: `gh` is required) — every body-declared foreign blocker reads state unreadable (fail closed)';
const NEAR_DUP = 'AUTO — dispatch: near-duplicate candidates across groups: ';
const FOREIGN_UNREADABLE = 'acme-corp/other#12 (state unreadable)';

// The fault rows' expectations, one table per family. Each family's file asserts its own table row by
// row (AC4.1 in queue-pull-parity-ac4, AC7.2 in queue-pull-parity-ac7, through assertFaultRow), and
// the other family's file reads the table's `status` column in AC4.2 (postureView).
// Per row: `status` the oracle's exit (the CLI's is 4 where it is 1); `base` the un-faulted run it
// is read against (default <transport>-P1); `stderr` / `stdout` the prefixes, in order, of the
// reported lines it adds on that channel, near-duplicate AUTO lines aside (that informational pass
// reports whatever pool reaches it); `entries` its exclusions literally (reason:records), or else
// `drops` / `adds` against the base's.
const FAULT_EXPECT = {
  'F-queue': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-opennum': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-depfresh': { status: 0, stderr: [], drops: [] },
  'F-depview': { status: 0, base: 'gh-livedep', stderr: [], drops: ['blocked:9002'] },
  'F-native': { status: 0, base: 'S2-gh-miss', stderr: [`${NATIVE_WARNING_PREFIX}gh-fault: injected failure`, LANDING_EXITED], drops: ['blocked:9030'] },
  'F-foreign': { status: 0, base: 'S2-gh-miss', stderr: ['Warning: foreign blocker state lookup failed (exit 3: gh-fault: injected failure resolve-foreign-blockers.js: '], drops: [] },
  'F-linked': { status: 0, stderr: [`${LINKED_WARNING}gh-fault: injected failure`], drops: ['open-pr:9005', 'open-pr:9008', 'shipped:9010'] },
  'F-intbranch': {
    status: 0, stderr: [`${LANDING_SKIPPED}no integration branch resolved; no unlanded-blocker exclusions this pull`],
    stdout: [6, 9, 17].map((n) => `- AUTO 12:00:00 — log-decision: dispatch: #90${String(n).padStart(2, '0')} excluded, named target docs/${{ 6: 'gone6', 9: 'gone', 17: 'present' }[n]}.md absent at origin/. Reversibility: n/a.`),
    drops: ['unlanded-blocker:9011'], adds: ['target-missing:9017'],
  },
  'F-prview': { status: 0, stderr: [], drops: [] },
  'F-landing': { status: 0, stderr: [LANDING_EXITED], drops: ['unlanded-blocker:9011'] },
  'F-inflight': { status: 0, stderr: [IN_FLIGHT_POOL_AUTO], drops: ['neighbour-in-flight:9013'] },
  'F-claim': {
    status: 0,
    stderr: ['AUTO — dispatch: shipped-candidate claim read failed for #9010 (network-failure), #9016 (network-failure); release time unknown, no downgrade', CLAIM_READ_FAILED_7001],
    drops: ['neighbour-in-flight:9013'],
  },
  'F-openprs': { status: 0, stderr: [], drops: [] },
  'F-writeback': { status: 0, stderr: ['Queue-order cache write-back failed (non-blocking): Command failed: git -C <SCR>/proj push origin '], drops: [] },
  'F-corrupt': { status: 1, stderr: [OPEN_STOP], entries: '{corrupt' },
  'F-groups': { status: 1, stderr: [OPEN_FILTER_WARNING, STOP_LINE.target], entries: ['blocked:9002', 'oversized:9001+9003+9016', 'not-spec-shaped:9004', 'not-spec-shaped:9007'] },
};
const posture = (r) => (r.status === 0 ? 'open' : 'stop');

const FILES_STOPPED_NEIGHBOUR = { status: 1, stderr: [STOP_LINE.neighbour], drops: ['neighbour-in-flight:9013'] };
const FILES_FOREIGN = (why) => ({ status: 0, base: 'S2-files-miss', stderr: [`Warning: foreign blocker states file <SCR>/agent/foreign-states.json ignored (${why}`, FOREIGN_LOOKUP_NO_GH], drops: [] });
const FILES_EXPECT = {
  'files-queueRaw-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-queueRaw-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-depFreshness-missing': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-malformed': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-missing-cold': { status: 0, stderr: [], drops: [] },
  'files-openNumbers-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-openNumbers-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-verifiedOpenDeps-missing': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-verifiedOpenDeps-malformed': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-inFlightRaw-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightRaw-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-queueRaw-wrapper': { status: 0, stderr: [], entries: [] },
  'files-inFlightRaw-empty': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-empty': { status: 0, stderr: [CLAIM_READ_FAILED_7001], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-string': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-foreignStates-missing': FILES_FOREIGN('ENOENT: '),
  'files-foreignStates-malformed': FILES_FOREIGN('not valid JSON) — supplied states not used (fail closed)'),
};

// AC4.2 per family (each family is its own process since the fault pool split): the runs its own pool
// made, plus, for each row of the other family, a stand-in holding only the exit that family's table
// pins (`status`; the CLI's is 4 where the oracle's is 1, R4). The other family's file asserts that
// exit against its own runs row by row, so the two AC4.2 tests together assert what one test over both
// families did.
function postureView(R, family) {
  const [own, other, expect] = family === 'gh' ? [FAULTS, FILES_FAULTS, FILES_EXPECT] : [FILES_FAULTS, FAULTS, FAULT_EXPECT];
  const view = {};
  for (const row of other) {
    const { status } = expect[row.id];
    view[row.id] = { oracle: { status }, module: { status: status === 1 ? 4 : status } };
  }
  for (const row of own) view[row.id] = R[row.id];
  return view;
}

// A row's default base, and the fault pool's bases: the matrix configs themselves (one
// definition of each base), the live-dependency scenario the matrix does not run, and S1-gh-hit,
// F-depfresh's un-faulted warm control on the same miss origin.
const MATRIX_CFG = Object.fromEntries(MATRIX.map((c) => [c.name, c]));
const BASE = { gh: 'S1-gh-miss', files: 'S1-files-miss' };
const FAULT_BASES = [
  MATRIX_CFG['S1-gh-miss'], MATRIX_CFG['S1-gh-hit'], MATRIX_CFG['S2-gh-miss'], { name: 'gh-livedep', scenario: S1LiveDep(), transport: 'gh' },
  MATRIX_CFG['S1-files-miss'], MATRIX_CFG['S2-files-miss'], { name: 'files-livedep', scenario: S1LiveDep(), transport: 'files' },
];

// The fault pool's pair configs for the transports it runs: their bases, then each transport's rows (a
// `warm` row after its transport's base, copying that side's origin and so its queue-order blob, PF1).
function faultConfigs(transports) {
  const rows = (transport) => (transport === 'gh' ? FAULTS : FILES_FAULTS).map((row) => {
    const scenario = row.scenario();
    return { name: row.id, scenario, transport, after: row.warm ? BASE[transport] : undefined, agent: transport === 'files' ? row.agent(agentInputs(scenario)) : null };
  });
  return [...FAULT_BASES.filter((c) => transports.includes(c.transport)), ...transports.flatMap(rows)];
}

const compactEntries = (r) => {
  const text = r.files['dispatch-exclusions.json'];
  try { return JSON.parse(text).map((e) => `${e.reason}:${e.records.join('+')}`); } catch { return text; }
};
const injectedCalls = (r) => [...r.ghArgv, ...r.gitArgv].filter((a) => a.tag === 'injected').map((a) => a.argv.join(' '));
// The reported lines `r` adds on `channel` over its base's, near-duplicate AUTO lines aside.
function addedLines(r, base, channel) {
  const seen = new Set(normalize(reported(base[channel]), base.sandbox));
  return normalize(reported(r[channel]), r.sandbox).filter((l) => !seen.has(l) && !l.startsWith(NEAR_DUP));
}

// One row: the oracle against the expectation, then the module against the oracle.
function assertFaultRow(row, expect, R, transport) {
  const pair = R[row.id];
  const base = R[expect.base || BASE[transport]];
  assertClean(pair, row.id);
  assertClean(base, `${row.id} base`);
  assert.equal(base.oracle.status, 0, `${row.id} base: ${base.oracle.stderr.slice(-2000)}`);
  const { oracle } = pair;
  const module = expect.status === 1 ? stopMapped(oracle, pair.module) : pair.module;
  assert.equal(oracle.status, expect.status, `${row.id}: the oracle's exit: ${oracle.stderr.slice(-2000)}`);
  if (expect.status === 0) assert.equal(pair.module.status, 0, `${row.id}: the CLI's exit: ${pair.module.stderr.slice(-2000)}`);
  for (const channel of ['stderr', 'stdout']) {
    const added = addedLines(oracle, base.oracle, channel);
    const want = expect[channel] || [];
    assert.equal(added.length, want.length, `${row.id} ${channel}: the oracle adds ${JSON.stringify(added)}`);
    want.forEach((prefix, i) => assert.ok(added[i].startsWith(prefix), `${row.id} ${channel}[${i}]: ${added[i]} does not start ${prefix}`));
  }
  const entries = compactEntries(oracle);
  if (expect.entries !== undefined) {
    assert.deepEqual(entries, expect.entries, `${row.id}: the oracle's exclusions`);
  } else {
    const baseEntries = compactEntries(base.oracle);
    for (const e of expect.drops) assert.ok(baseEntries.includes(e), `${row.id}: the base writes ${e} (control)`);
    const want = [...baseEntries.filter((e) => !expect.drops.includes(e)), ...(expect.adds || [])].sort();
    assert.deepEqual([...entries].sort(), want, `${row.id}: the oracle's exclusions against its base's`);
  }
  if (transport === 'gh' && row.pass !== '(stop)') {
    // The fault fired: each side logged an injected call its base did not make.
    const baseInjected = new Set(injectedCalls(base.oracle));
    for (const [side, r] of sides(pair)) assert.ok(injectedCalls(r).some((c) => !baseInjected.has(c)), `${row.id} ${side}: the fault's call was injected`);
  }
  assertFaultFiles(pair, transport, row.id, module);
}

// D1: two pulls in one session per side (the one deliberate session reuse: one session id and one
// TMPDIR), the second answering from D1Second's table.
async function runD1() {
  const made = [];
  try {
    const oracleSb = createSandbox(S1(), { name: 'D1' });
    made.push(oracleSb);
    const moduleSb = createSandbox(S1(), { name: 'D1' });
    made.push(moduleSb);
    const both = () => Promise.all([
      runOracle(oracleSb, FENCE, { tmp: 'one-session' }),
      runModuleCli(moduleSb, ['--transport', 'gh'], { tmp: 'one-session' }),
    ]);
    const [o1, m1] = await both();
    for (const sb of made) sb.setScenario(D1Second());
    const [o2, m2] = await both();
    return { first: { oracle: o1, module: m1 }, second: { oracle: o2, module: m2 } };
  } catch (err) {
    for (const sb of made) sb.cleanup();
    throw err;
  }
}

// The one fault pool of a process: the rows and bases of the `transports` it is asked for and, when
// `d1` is true, D1, started by the first call. Each parity file runs in its own process now, so the
// file's own `before` hooks are the only callers and their arguments the whole decision:
// queue-pull-parity-ac4 runs ['gh'] without D1, queue-pull-parity-ac7 ['files'] without D1, and
// queue-pull-parity-d1 D1 alone ([]). A second call with different arguments throws rather than
// silently handing back the first pool.
let faultPool = null;
let faultPoolArgs = null;
function runFaultPool(transports, { d1 }) {
  const args = { transports: transports.join(), d1: Boolean(d1) };
  if (faultPool && (args.transports !== faultPoolArgs.transports || args.d1 !== faultPoolArgs.d1)) {
    const show = (a) => `transports [${a.transports}] with D1 ${a.d1 ? 'on' : 'off'}`;
    throw new Error(`runFaultPool: the pool already runs ${show(faultPoolArgs)}, asked for ${show(args)}`);
  }
  if (!faultPool) {
    const configs = faultConfigs(transports);
    const t0 = Date.now();
    // D1 first: its two pulls run one after the other, so it starts before the single-pull pairs.
    faultPool = runAll([...(d1 ? [{ name: 'D1', run: runD1 }] : []), ...pairJobs(configs)], POOL)
      .then((R) => ({ R, pairs: configs.length, ms: Date.now() - t0 }));
    faultPoolArgs = args;
  }
  return faultPool;
}

// The two cleanup hooks every parity file registers once at its top level (a helper-module `after`
// would also attach to files that run no pair): every memoized pair's sandboxes are removed once, after
// the file's last test, and the fault pool's D1 sandboxes after them.
function registerParityCleanup() {
  after(async () => {
    const settled = await Promise.allSettled([...PAIR_MEMO.values()].map((m) => m.pair));
    cleanupPairs(settled.filter((s) => s.status === 'fulfilled').map((s) => s.value));
  });
  after(async () => {
    if (!faultPool) return;
    let d1 = null;
    try { d1 = (await faultPool).R.D1; } catch { return; } // a failed runD1 removed its own sandboxes
    if (!d1) return; // a pool run with d1: false
    cleanupPairs([d1.first]); // the second pull ran in the same two sandboxes; the pairs are the memo's
  });
}

// ---- The in-process pull harness (Tasks 3 and 4), shared by queue-pull.test.js and
// queue-pull-oracle-checks.test.js, whose oracle cross-checks compare the fence run against it. ----

// Runs fn with TMPDIR (and the win32 spellings) pointed at a test-owned dir, never the host one.
function inOwnTmp(fn) {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-t2-'));
  const keys = ['TMPDIR', 'TEMP', 'TMP', 'QP_TMPNAME_COUNTER_FILE'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = own;
  delete process.env.QP_TMPNAME_COUNTER_FILE;
  try {
    return fn(own);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(own, { recursive: true, force: true });
  }
}

const T3_PASSES = PASSES.slice(0, 5); // truncate, fetch, blocked, oversized, write-back
const NOW = new Date('2026-11-12T12:00:00.000Z');
const EXPRESS_OFF = () => ({ enabled: false, grouping: 'per-record', keepSingleton: () => false });

// Runs truncate..write-back over a scenario in a test-owned TMPDIR and returns everything a test
// asserts on. o: { transport, omit, persisted, writeResult, spawn (CLI overrides), env, inputs,
// prepare(own) -> extra options, before(ctx), deps, run, allowThrow }.
function pull(scenario, o = {}) {
  return inOwnTmp((own) => {
    const cwd = path.join(own, 'proj');
    fs.mkdirSync(cwd);
    const sessionId = o.sessionId || 'qp-t3';
    const paths = sessionPaths(sessionId);
    fs.mkdirSync(path.dirname(paths['dispatch-groups.json']), { recursive: true });
    const errs = [];
    const ghCalls = [];
    const base = o.run || fakeRun(scenario, { sessionDir: path.dirname(paths['dispatch-groups.json']) });
    const store = { persisted: o.persisted || null, written: [] };
    const spawnCli = fakeSpawnCli(scenario, o.spawn || {});
    const deps = {
      run: (cmd, args, opts) => { ghCalls.push(args); return base(cmd, args, opts); },
      spawnCli,
      stderr: (s) => errs.push(s),
      now: () => NOW,
      expressQueuePolicy: EXPRESS_OFF,
      // Production lets the library spawn resolve-foreign-blockers.js; tests inject through the seam.
      foreignDeps: { spawn: o.foreignSpawn || ((argv) => spawnCli(path.basename(argv[0]), argv.slice(1))) },
      queueOrder: {
        readOrder: () => store.persisted,
        writeOrder: (root, blob) => { store.written.push({ root, blob }); return o.writeResult || { ok: true }; },
      },
      ...(o.deps || {}),
    };
    const extra = o.prepare ? o.prepare(own) : {};
    const options = { transport: o.transport || 'gh', sessionId, cwd, env: o.env || {}, omit: o.omit || [], inputs: o.inputs, ...extra };
    const ctx = (o.lib || { makeContext }).makeContext(options, deps);
    if (o.before) o.before(ctx, own);
    let thrown = null;
    try { (o.lib || { runPasses }).runPasses(o.passes || T3_PASSES, ctx); } catch (err) { thrown = err; }
    if (thrown && !o.allowThrow) throw thrown;
    const text = {};
    for (const name of SESSION_FILES) if (fs.existsSync(paths[name]) && fs.statSync(paths[name]).isFile()) text[name] = fs.readFileSync(paths[name], 'utf8');
    // Any other file a pass left in the session dir (the shipped Close proposals).
    for (const name of fs.readdirSync(path.dirname(paths['dispatch-groups.json']))) {
      const file = path.join(path.dirname(paths['dispatch-groups.json']), name);
      if (!(name in text) && fs.statSync(file).isFile()) text[name] = fs.readFileSync(file, 'utf8');
    }
    for (const file of Object.values(ctx.state.files)) if (fs.existsSync(file)) text[file] = fs.readFileSync(file, 'utf8');
    return {
      thrown, cwd, errs, ghCalls, store, state: ctx.state, text, stderr: errs.join(''),
      cliCalls: spawnCli.calls.map((c) => [c.name, ...c.args]),
      json: (name) => JSON.parse(text[name]),
    };
  });
}

const entriesOf = (r, reason) => r.json('dispatch-exclusions.json').filter((e) => e.reason === reason);
const T4_PASSES = PASSES.slice(0, 9); // truncate .. shipped
const FULL = () => S1({ full: true });

// pull() with the Task 4 CLIs faked: hooks.js answers the run dir (o.hooksOut(callIndex, runDir)
// overrides one answer), log-decision.js and stage-item.js record their argv and the staged file's
// body at call time, and the claim reader answers o.claims (number -> blob content, default absent).
function pull4(scenario, o = {}) {
  const cap = { runDir: null, hooks: [], log: [], staged: [], stdout: [], order: [] };
  const spawn = {
    'hooks.js': (args) => {
      cap.hooks.push(args);
      const out = o.hooksOut ? o.hooksOut(cap.hooks.length - 1, cap.runDir) : cap.runDir;
      return { status: 0, stdout: `${out}\n`, stderr: o.hooksErr ? o.hooksErr(cap.hooks.length - 1) : '' };
    },
    'log-decision.js': (args) => { cap.log.push(args); return { status: 0, stdout: `logged ${args[args.indexOf('--text') + 1]}\n`, stderr: '' }; },
    'stage-item.js': (args) => {
      const id = args[args.indexOf('--id') + 1];
      const file = args[args.indexOf('--file') + 1];
      cap.staged.push({ args, id, file, body: file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null });
      return { status: 0, stdout: `staged ${id}\n`, stderr: '' };
    },
    ...(o.spawn || {}),
  };
  const claims = o.claims || {};
  const r = pull(scenario, {
    passes: T4_PASSES,
    ...o,
    spawn,
    prepare: (own) => {
      cap.runDir = path.join(own, 'run');
      fs.mkdirSync(cap.runDir);
      return o.prepare ? o.prepare(own) : {};
    },
    deps: {
      stdout: (s) => cap.stdout.push(s),
      createClaimReader: () => ({ read: (n) => ({ content: Object.prototype.hasOwnProperty.call(claims, n) ? claims[n] : null }) }),
      onPass: (id) => cap.order.push(id),
      ...(o.deps || {}),
    },
  });
  return { ...r, cap, cli: (name) => r.cliCalls.filter(([n]) => n === name) };
}

module.exports = {
  FENCE,
  fenceText,
  HIT_MESSAGE,
  NATIVE_WARNING_PREFIX,
  GROUPING_STOP_RE,
  CACHE_HIT_STOP_RE,
  LINKED_WARNING,
  OPEN_FILTER_WARNING,
  OPEN_STOP,
  TARGET_STOP,
  NEIGHBOUR_STOP,
  IN_FLIGHT_POOL_AUTO,
  MALFORMED_CAUSE,
  cannedLanding,
  POOL,
  PARITY_S1,
  ALL_REASONS,
  FILES_S1_REASONS,
  MATRIX,
  AC1_FILES,
  pairJobs,
  assertEveryJobRan,
  sides,
  assertClean,
  stopMapped,
  exclusionsIn,
  groupedIn,
  ghCall,
  registerParityCleanup,
  faultComparison,
  assertFaultFiles,
  STOP_LINE,
  CLAIM_READ_FAILED_7001,
  FOREIGN_UNREADABLE,
  assertFaultRow,
  runFaultPool,
  FAULT_EXPECT,
  FILES_EXPECT,
  posture,
  postureView,
  inOwnTmp,
  EXPRESS_OFF,
  pull,
  entriesOf,
  FULL,
  pull4,
};
