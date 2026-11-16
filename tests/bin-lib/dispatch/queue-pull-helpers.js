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
// This module holds what queue-pull.test.js and the four queue-pull-parity-*.test.js files share (one
// file per `#5227 parity` describe, each its own node:test process): the fence and the strings read
// from it, the parity-pair machinery (one memoized runPair per config name, per process) and the
// fetch-failure fault pool. State that must be one instance per process (PAIR_MEMO, the fault-pool
// promise) lives here and is never exported; each parity file registers the cleanup hooks through
// registerParityCleanup().
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');

const { readText } = require('../../helpers/read-skill');
const {
  SCRIPT_MD, FENCE_FIRST_LINE, extractFence, createSandbox, runOracle, runModuleCli, runPair, normalize, reported, assertParity, runAll, failedJobs,
  STREAM_TRUNCATED, TAIL_LINES,
} = require('./queue-pull-oracle');
const { S1, S2, agentInputs, LANDING_COMMIT, FAULTS, FILES_FAULTS, D1Second, S1LiveDep } = require('./queue-pull-fixtures');
const { PASSES, SESSION_FILES } = require('../../../plugin/bin/lib/dispatch/queue-pull');
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

// The one fault pool of a process: the rows and bases of the `transports` it is asked for (both by
// default) and D1, started by the first call. Each parity file runs in its own process now, so the
// file's own `before` is the only caller and its `transports` the whole decision. A second call with
// a different `transports` throws rather than silently handing back the first pool.
let faultPool = null;
let faultPoolTransports = null;
function runFaultPool(transports = ['gh', 'files']) {
  const key = transports.join();
  if (faultPool && key !== faultPoolTransports) {
    throw new Error(`runFaultPool: the pool already runs transports [${faultPoolTransports}], asked for [${key}]`);
  }
  if (!faultPool) {
    const configs = faultConfigs(transports);
    const t0 = Date.now();
    // D1 first: its two pulls run one after the other, so it starts before the single-pull pairs.
    faultPool = runAll([{ name: 'D1', run: runD1 }, ...pairJobs(configs)], POOL)
      .then((R) => ({ R, pairs: configs.length, ms: Date.now() - t0 }));
    faultPoolTransports = key;
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
    cleanupPairs([d1.first]); // the second pull ran in the same two sandboxes; the pairs are the memo's
  });
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
  LANDING_SKIPPED,
  LANDING_EXITED,
  CLAIM_READ_FAILED_7001,
  FOREIGN_LOOKUP_NO_GH,
  FOREIGN_UNREADABLE,
  assertFaultRow,
  runFaultPool,
};
