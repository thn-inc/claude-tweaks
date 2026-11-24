'use strict';
// #5227: queue-pull module parity suite. The bash oracle runs plugin/skills/dispatch/
// queue-pull-script.md's fence whole, in a throwaway sandbox under PATH shims for gh and git
// (tests/bin-lib/dispatch/queue-pull-oracle.js), with a frozen clock preloaded into every
// node process (queue-pull-clock-stub.js).
//
// Normalizations (AC1, and nothing else): the sandbox root becomes <SCR> and the pre-minted
// run-dir basename becomes <RUN>. The clock is frozen by the stub rather than normalized; the one
// temp file both sides name (the target-missing proposal) has a fixed name.
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
// Script behavior the fault rows (Task 9) show, reproduced by the module (some since fixed, noted per bullet):
//   - A candidate whose `labels` is not an array (SMalformed's #9020) threw inside the eligibility
//     block, so one malformed record stopped every candidate; fixed by #5315: it is excluded as
//     malformed-blocker with one Warning, the pull writes no queue-order cache, and the clean #9001
//     dispatches.
//   - D1 (a second pull in one session whose open-numbers fetch fails) reused the first pull's
//     eligibility files and wrote its groups back under the new freshness signal; fixed by #5314:
//     the miss path removes them first, so the pull stops at group-building as a fresh session does.
//   - One failed native-dependency GraphQL call (F-native) turns off two passes: the blocked pass's
//     native filtering and, through preflight-records.js's native read, the unlanded-blocker pass
//     (a Warning each). (NEW cross-pass effects; each pass still fails open.) Fixed by #5309: a
//     failed call fails closed (every eligible record excluded as blocked, one Warning, no write-back).
//   - One failed claim fetch (F-claim) printed an AUTO line for the shipped pass and one for the
//     neighbour pass; #5304 prints one combined line per pull (both fence and module).
//   - A missing or malformed DISPATCH_FOREIGN_STATES file on files printed two fail-closed Warnings
//     (the ignored file, then the gh lookup with no gh); #5304 prints the ignored file's only.
//   - A failed queue or open-numbers fetch stops the pull at the group-building check (the fetch
//     pass's `stop`), a third and fourth stop beside Q3's corrupt-exclusions and unreadable-groups.
//   - F-linked's single Warning (the open-linked-PR lookup failed) names the shipped pass it also turns off:
//     it drops shipped:9010 as well as the two open-pr exclusions. F-intbranch (no integration-branch
//     policy key, `git remote show origin` fails) skips the target-missing pass with one Warning and
//     drops the unlanded-blocker:9011 exclusion beside it. (NEW cross-pass effects; each pass still
//     fails open.)
//   - Fixed by #5311: a missing or malformed file fails closed (every unresolved dependency open, one
//     Warning) — files-verifiedOpenDeps-missing and files-verifiedOpenDeps-malformed keep blocked:9002.
//     F-depview fails closed too, with one Warning naming the view, since #5311.
//   - No silent fail-open remains in this list: F-prview warns since #5313 and F-openprs since #5312. F-depfresh,
//     F-depfresh-writeback and F-depfresh-both print one Warning per failed search since #5310.
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
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('../../helpers/read-skill');
const {
  SCRIPT_MD, FENCE_FIRST_LINE, extractFence, createSandbox, runOracle, runModuleCli, runPair, normalize, reported, assertParity, runAll, failedJobs,
  STREAM_TRUNCATED, TAIL_LINES,
} = require('./queue-pull-oracle');
const {
  S1, S2, agentInputs, LANDING_COMMIT, FAULTS, FILES_FAULTS, D1Second, D1Third, EmptyAfterS1, S1LiveDep, S1OpenDeps, fakeRun, fakeSpawnCli,
} = require('./queue-pull-fixtures');
const { PASSES, SESSION_FILES, sessionPaths, makeContext, runPasses } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const { appendExclusion } = require('../../../plugin/bin/lib/dispatch/exclusions');

const FENCE = extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE);

const fenceText = (re) => {
  const m = FENCE.match(re);
  assert.ok(m, `the fence no longer matches ${re}`);
  return m[1];
};
const HIT_MESSAGE = fenceText(/echo "(Queue-order cache hit [^"]*)" >&2/);
const NATIVE_WARNING_PREFIX = fenceText(/echo "(Warning: native dependency query failed[^$]*falling back[^$]*)\$\(cat /);
const NATIVE_FAIL_CLOSED_PREFIX = fenceText(/echo "(Warning: native dependency query failed[^$]*fail closed[^$]*)\$\(cat /);
const GROUPING_STOP_RE = /echo "(dispatch: queue-pull stopped -- group-building exclusion pass failed \(exit )\$GROUPING_RC(\); see error above\.)" >&2/;
const CACHE_HIT_STOP_RE = /echo "(dispatch: queue-pull stopped -- cache-hit exclusion pass failed \(exit )\$CACHE_HIT_RC(\); see error above\.)" >&2/;
const LINKED_WARNING = fenceText(/echo "(Warning: linked-PR query failed[^$]*)\$\(cat /);
const OPEN_FILTER_WARNING = fenceText(/echo "(Warning: open-linked-PR filtering failed[^$]*)\$\(cat /);
const OPEN_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: )\$\(cat /);
const TARGET_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- target-missing exclusion pass failed \(exit )\$TARGET_MISSING_RC\); see error above\.\" >&2/);
const MALFORMED_CAUSE = 'a Blocked by line names no valid issue number (#0)';
const NEIGHBOUR_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed \(exit )\$NEIGHBOUR_RC\); see error above\.\" >&2/);
const IN_FLIGHT_POOL_AUTO = fenceText(/echo "(AUTO — dispatch: neighbour-in-flight pool fetch failed[^"]*)" >&2/);
const UNLANDED_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above\.)" >&2/);
const OPEN_PR_FAIL = 'Warning: open-PR pull failed — cross-PR overlap not checked this run';
const PR_VIEW_FAILED = (pr, n) => `Warning: gh pr view ${pr} failed — #${n} kept as a weak shipped candidate (files unprobed) this run\n`;

// #5315: the eligibility step's Warning for a non-array labels value, read from the fence.
const LABELS_WARNING_RE = /console\.error\('(Warning: #)' \+ i\.number \+ '([^']*)'\)/;
const labelsWarning = (n) => {
  const m = FENCE.match(LABELS_WARNING_RE);
  assert.ok(m, `the fence no longer matches ${LABELS_WARNING_RE}`);
  return `${m[1]}${n}${m[2]}\n`;
};
const LABELS_ENTRY_9020 = { reason: 'malformed-blocker', records: [9020], detail: { cause: 'its labels are not an array' } };

// #5317: a Doc path holding ", $(id), a backtick and '. Its two " are deliberate: they keep the pre-fix
// double-quoted comment line parseable, so bash really runs `id` there (an odd count is a syntax error,
// nothing expands, and the "id never ran" assertion would pass on the unfixed code). The literal backslash-x27
// is there so a fence regressing to `echo -e` / `printf '%b'` (which turns it into ') fails the verbatim check.
const HOSTILE_DOC = 'docs/q"$(id)`id`"it\'s\\x27.md';
const CLOSING_BODY = (tpath, ref) => `Closing: the named target ${tpath} no longer exists at ${ref} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).`;

// Runs the staged `gh issue comment <num> ...` line under bash with stub gh (logs its argv) and stub id
// (drops a marker): the argv gh received, and whether anything but the quoted word ran `id`.
function runStagedComment(proposalText, num) {
  const dir = scratchDir('qp-5317-');
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(dir, 'gh.log');
    const marker = path.join(dir, 'id.ran');
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexec node -e \'require("fs").appendFileSync(process.env.QP_GH_LOG, JSON.stringify(process.argv.slice(1)) + "\\n")\' -- "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\n: > "$QP_ID_MARKER"\n', { mode: 0o755 });
    const line = proposalText.split('\n').find((l) => l.startsWith(`gh issue comment ${num} `));
    assert.ok(line, 'the proposal has a comment line');
    const r = spawnSync('bash', ['-c', line], {
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QP_GH_LOG: log, QP_ID_MARKER: marker },
      encoding: 'utf8', windowsHide: true,
    });
    const ghCalls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { status: r.status, ghCalls, idRan: fs.existsSync(marker), stderr: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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
// defects (D1, D4; D3 is fixed, #5307). Each FAULTS row (queue-pull-fixtures.js) fails one gh
// fetch, and each FILES_FAULTS row one files input, on both sides through the shared table. Its
// base is the same scenario un-faulted: the matrix's config of it where the matrix has one (S1
// and S2), else a base config of its own; the fault pool runs either (the AC1 file's runs are not
// shared: each file is its own process). One pool runs the rows, bases and D1 of the transports
// it is asked for, from one `before`. A row asserts what the ORACLE did (Plan Review
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
const TARGET_MISSING_SKIPPED = fenceText(/echo "(Warning: target-missing pass skipped[^"]*)" >&2/);
// Lines the CLIs and libraries the fence runs print (not fence echo text).
const LANDING_SKIPPED = 'Warning: unlanded-blocker pass skipped — ';
const LANDING_EXITED = `${LANDING_SKIPPED}preflight-records.js exited 1; no unlanded-blocker exclusions this pull`;
const CLAIM_READ_FAILED_7001 = 'AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight';
// #5304: one line per pull when both passes read unreadable claims (F-claim), naming each and both consequences.
const CLAIM_READ_COMBINED = 'AUTO — dispatch: claim read failed for #9010 (network-failure), #9016 (network-failure), #7001; shipped-candidate release time unknown, no downgrade; neighbour-in-flight treated as not in flight';
// #5304: the shipped pass's unreadable claims printed alone, by the fence's flush_shipped_claims at a stop between the passes.
const CLAIM_READ_SHIPPED_ONLY = 'AUTO — dispatch: shipped-candidate claim read failed for #9010 (network-failure), #9016 (network-failure); release time unknown, no downgrade';
const NEAR_DUP = 'AUTO — dispatch: near-duplicate candidates across groups: ';
const DEP_FRESH_USED = 'Warning: dependency-freshness search failed — queue-order cache not used this run';
const DEP_FRESH_WRITTEN = 'Warning: dependency-freshness search failed — queue-order cache not written this run';
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
  'F-depfresh': { status: 0, stderr: [DEP_FRESH_USED], drops: [] },
  // #5310: the cold write-back search fails; no blob on either side.
  'F-depfresh-writeback': { status: 0, stderr: [DEP_FRESH_WRITTEN], drops: [], blob: null },
  // #5310: a warm pull where the cache check's and the write-back's searches both fail prints both lines, in order.
  'F-depfresh-both': { status: 0, stderr: [DEP_FRESH_USED, DEP_FRESH_WRITTEN], drops: [] },
  'F-depview': { status: 0, base: 'gh-livedep', stderr: ['Warning: gh issue view 8000 failed — dependency #8000 treated as open (fail closed) this run'], drops: [], blob: null },
  // #5309: both eligible records are excluded fail-closed (9030 was already blocked, now with the unreadable detail); the unlanded-blocker pass has no candidate left, so it prints nothing.
  // blob: null, both sides, the row's cold origin left no order blob (no write-back); parityView compares the blobs only against each other.
  'F-native': { status: 0, base: 'S2-gh-miss', stderr: [`${NATIVE_FAIL_CLOSED_PREFIX}gh-fault: injected failure`], drops: [], adds: ['blocked:9001'], blob: null },
  'F-foreign': { status: 0, base: 'S2-gh-miss', stderr: ['Warning: foreign blocker state lookup failed (exit 3: gh-fault: injected failure resolve-foreign-blockers.js: '], drops: [] },
  'F-foreign-states': { status: 0, base: 'S2-gh-miss', stderr: ['Warning: foreign blocker states file <SCR>/agent/foreign-states.json ignored (ENOENT: ', 'Warning: foreign blocker state lookup failed (exit 3: gh-fault: injected failure resolve-foreign-blockers.js: '], drops: [] },
  'F-linked': { status: 0, stderr: [`${LINKED_WARNING}gh-fault: injected failure`], drops: ['open-pr:9005', 'open-pr:9008', 'shipped:9010'] },
  'F-intbranch': {
    // #9006 is no longer pre-excluded as target-missing, so the shipped pass (which runs next) excludes it on its merged-PR signal.
    status: 0, stderr: [TARGET_MISSING_SKIPPED, 'AUTO — dispatch: #9006 excluded, shipped by merged PR #5006', `${LANDING_SKIPPED}no integration branch resolved; no unlanded-blocker exclusions this pull`],
    stdout: [],
    drops: ['target-missing:9006', 'target-missing:9009', 'unlanded-blocker:9011'], adds: ['shipped:9006'],
  },
  'F-headunknown': {
    // #5863: `HEAD branch: (unknown)` skips only the target-missing pass. The unlanded-blocker pass still gets `(unknown)`: its
    // compare call 404s, so it keeps #9011 with one `undetermined` line (read from a baseline run), where F-intbranch's empty branch skips the pass.
    status: 0, stderr: [TARGET_MISSING_SKIPPED, 'AUTO — dispatch: #9006 excluded, shipped by merged PR #5006', 'AUTO — dispatch: #9011 kept — blocker #8001 landing undetermined (via probe-failed)'],
    stdout: [],
    drops: ['target-missing:9006', 'target-missing:9009', 'unlanded-blocker:9011'], adds: ['shipped:9006'],
  },
  'F-prview': { status: 0, stderr: [PR_VIEW_FAILED(5016, 9016).trimEnd()], drops: [] },
  'F-landing': { status: 0, stderr: [LANDING_EXITED], drops: ['unlanded-blocker:9011'] },
  'F-inflight': { status: 0, stderr: [IN_FLIGHT_POOL_AUTO], drops: ['neighbour-in-flight:9013'] },
  'F-claim': { status: 0, stderr: [CLAIM_READ_COMBINED], drops: ['neighbour-in-flight:9013'] },
  'F-claim-stop': { status: 1, stderr: [CLAIM_READ_SHIPPED_ONLY, UNLANDED_STOP], entries: '{corrupt' },
  'F-claim-neighbour-stop': { status: 1, stderr: [CLAIM_READ_SHIPPED_ONLY, STOP_LINE.neighbour], drops: ['neighbour-in-flight:9013'] },
  // #5312: the failed open-PR list warns on both sides; the overlap file is still [].
  'F-openprs': { status: 0, stderr: [OPEN_PR_FAIL], drops: [] },
  'F-writeback': { status: 0, stderr: ['Queue-order cache write-back failed (non-blocking): Command failed: git -C <SCR>/proj push origin '], drops: [] },
  'F-corrupt': { status: 1, stderr: [OPEN_STOP], entries: '{corrupt' },
  'F-groups': { status: 1, stderr: [OPEN_FILTER_WARNING, STOP_LINE.target], entries: ['blocked:9002', 'oversized:9001+9003+9016', 'not-spec-shaped:9004', 'not-spec-shaped:9007'] },
};
const posture = (r) => (r.status === 0 ? 'open' : 'stop');

const FILES_STOPPED_NEIGHBOUR = { status: 1, stderr: [STOP_LINE.neighbour], drops: ['neighbour-in-flight:9013'] };
const FILES_FOREIGN = (why) => ({ status: 0, base: 'S2-files-miss', stderr: [`Warning: foreign blocker states file <SCR>/agent/foreign-states.json ignored (${why}`], drops: [] });
const FILES_EXPECT = {
  // #5309: gh present on files, resolve-blockers.js exits 3: the fence's files exit-3 branch fails closed.
  'F-native-files': { status: 0, base: 'S2-files-miss', stderr: [`${NATIVE_FAIL_CLOSED_PREFIX}gh-fault: injected failure`], drops: [], adds: ['blocked:9001', 'blocked:9030'], blob: null },
  'files-queueRaw-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-queueRaw-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-depFreshness-missing': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-malformed': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-missing-cold': { status: 0, base: 'files-opendeps', stderr: [], drops: [] },
  'files-openNumbers-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-openNumbers-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  // #5311: #8001 (the unresolved dependency of #9011) counts as open too, so #9011 is held as blocked.
  'files-verifiedOpenDeps-missing': { status: 0, base: 'files-livedep', stderr: ['Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run'], drops: [], adds: ['blocked:9011'], blob: null },
  'files-verifiedOpenDeps-malformed': { status: 0, base: 'files-livedep', stderr: ['Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run'], drops: [], adds: ['blocked:9011'], blob: null },
  'files-verifiedOpenDeps-missing-none': { status: 0, base: 'S2-files-miss', stderr: [], drops: [] },
  'files-inFlightRaw-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightRaw-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-queueRaw-wrapper': { status: 1, stderr: ['Warning: <SCR>/tmp/run-1/ct-session-qp-files-queueRaw-wrapper/dispatch-queue-raw.json is not a JSON array — treated as a failed read', STOP_LINE.grouping], entries: [] },
  'files-queueRaw-string': { status: 1, stderr: ['Warning: <SCR>/tmp/run-1/ct-session-qp-files-queueRaw-string/dispatch-queue-raw.json is not a JSON array — treated as a failed read', STOP_LINE.grouping], entries: [] },
  'files-depFreshness-wrapper': { status: 1, stderr: ['Warning: <SCR>/tmp/run-1/ct-session-qp-files-depFreshness-wrapper/dispatch-dep-freshness.json is not a JSON array — treated as a failed read', STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-string': { status: 1, stderr: ['Warning: <SCR>/tmp/run-1/ct-session-qp-files-depFreshness-string/dispatch-dep-freshness.json is not a JSON array — treated as a failed read', STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-wrapper-cold': { status: 0, base: 'files-opendeps', stderr: ['Warning: <SCR>/tmp/run-1/ct-session-qp-files-depFreshness-wrapper-cold/dispatch-dep-freshness.json is not a JSON array — treated as a failed read'], drops: [] },
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

// AC4.2's body, shared by the gh and files families' one test each: every PASSES failOpen equals the
// strictest posture observed across that pass's fault fixtures (stop if any stops, else open), read from
// postureView(pool.R, family). `t` is the calling test's context.
function assertFailOpenPostures(pool, family, t) {
  const R = postureView(pool.R, family);
  const strictest = (side) => {
    const out = {};
    for (const rows of [FAULTS, FILES_FAULTS]) {
      for (const row of rows.filter((x) => x.pass !== '(stop)')) {
        const p = posture(R[row.id][side]);
        out[row.pass] = out[row.pass] === 'stop' || p === 'stop' ? 'stop' : 'open';
      }
    }
    return out;
  };
  const observed = strictest('oracle');
  assert.deepEqual(strictest('module'), observed, 'the module\'s exits give the same postures');
  for (const id of Object.keys(observed)) assert.ok(PASSES.some((p) => p.id === id), `fault rows name a registry id: ${id}`);
  for (const p of PASSES) assert.equal(p.failOpen, observed[p.id] || 'n/a', `${p.id} (${p.reason || p.kind})`);
  // PF6: neighbour-in-flight is open on gh and stop on files; the stricter value wins.
  assert.equal(posture(R['F-inflight'].oracle), 'open');
  assert.equal(posture(R['files-inFlightRaw-missing'].oracle), 'stop');
  t.diagnostic(`postures: ${JSON.stringify(observed)}`);
}

// A row's default base, and the fault pool's bases: the matrix configs themselves (one
// definition of each base), the live-dependency and open-dependency scenarios the matrix does not run, and S1-gh-hit,
// F-depfresh's un-faulted warm control on the same miss origin.
const MATRIX_CFG = Object.fromEntries(MATRIX.map((c) => [c.name, c]));
const BASE = { gh: 'S1-gh-miss', files: 'S1-files-miss' };
const FAULT_BASES = [
  MATRIX_CFG['S1-gh-miss'], MATRIX_CFG['S1-gh-hit'], MATRIX_CFG['S2-gh-miss'], { name: 'gh-livedep', scenario: S1LiveDep(), transport: 'gh' },
  MATRIX_CFG['S1-files-miss'], MATRIX_CFG['S2-files-miss'], { name: 'files-livedep', scenario: S1LiveDep(), transport: 'files' }, { name: 'files-opendeps', scenario: S1OpenDeps(), transport: 'files' },
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
  if (expect.blob === null) {
    assert.equal(oracle.orderBlob, null, `${row.id}: the oracle writes no order blob`);
    assert.equal(pair.module.orderBlob, null, `${row.id}: the module writes no order blob`);
  }
  if (transport === 'gh' && row.pass !== '(stop)') {
    // The fault fired: each side logged an injected call its base did not make.
    const baseInjected = new Set(injectedCalls(base.oracle));
    for (const [side, r] of sides(pair)) assert.ok(injectedCalls(r).some((c) => !baseInjected.has(c)), `${row.id} ${side}: the fault's call was injected`);
  }
  assertFaultFiles(pair, transport, row.id, module);
}

// D1: three pulls in one session per side (the one deliberate session reuse: one session id and one
// TMPDIR), the second answering from D1Second's table, the third from D1Third's.
// Each later scenario is a function: `later` pulls follow `first`, one after the other.
async function runSession(name, first, later) {
  const made = [];
  try {
    const oracleSb = createSandbox(first(), { name });
    made.push(oracleSb);
    const moduleSb = createSandbox(first(), { name });
    made.push(moduleSb);
    const both = async () => {
      const [oracle, module] = await Promise.all([
        runOracle(oracleSb, FENCE, { tmp: 'one-session' }),
        runModuleCli(moduleSb, ['--transport', 'gh'], { tmp: 'one-session' }),
      ]);
      return { oracle, module };
    };
    const pulls = [await both()];
    for (const scenario of later) {
      for (const sb of made) sb.setScenario(scenario());
      pulls.push(await both());
    }
    return pulls;
  } catch (err) {
    for (const sb of made) sb.cleanup();
    throw err;
  }
}
async function runD1() {
  const [first, second, third] = await runSession('D1', S1, [D1Second, D1Third]);
  return { first, second, third };
}
// #5314: a non-empty pull that persists a blob, then a well-formed empty queue.
async function runEmptyAfterS1() {
  const [first, second] = await runSession('EmptyAfterS1', S1, [EmptyAfterS1]);
  return { first, second };
}

// The one fault pool of a process: the rows and bases of the `transports` it is asked for and, when
// `d1` is true, the two session jobs D1 and EmptyAfterS1 (#5314), started by the first call. Each
// parity file runs in its own process now, so the file's own `before` hooks are the only callers and
// their arguments the whole decision: queue-pull-parity-ac4 runs ['gh'] without them,
// queue-pull-parity-ac7 ['files'] without them, and queue-pull-parity-d1 the two session jobs alone
// ([]). A second call with different arguments throws rather than silently handing back the first pool.
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
    // D1 and EmptyAfterS1 first: their pulls run one after the other, so they start before the single-pull pairs.
    const sessionJobs = d1 ? [{ name: 'D1', run: runD1 }, { name: 'EmptyAfterS1', run: runEmptyAfterS1 }] : [];
    faultPool = runAll([...sessionJobs, ...pairJobs(configs)], POOL)
      .then((R) => ({ R, pairs: configs.length, ms: Date.now() - t0 }));
    faultPoolArgs = args;
  }
  return faultPool;
}

// The two cleanup hooks every parity file registers once at its top level (a helper-module `after`
// would also attach to files that run no pair): every memoized pair's sandboxes are removed once, after
// the file's last test, and the fault pool's session-job (D1, EmptyAfterS1) sandboxes after them.
function registerParityCleanup() {
  after(async () => {
    const settled = await Promise.allSettled([...PAIR_MEMO.values()].map((m) => m.pair));
    cleanupPairs(settled.filter((s) => s.status === 'fulfilled').map((s) => s.value));
  });
  after(async () => {
    if (!faultPool) return;
    let R = null;
    try { R = (await faultPool).R; } catch { return; } // a failed session job removed its own sandboxes
    // A pool run with d1: false has neither session job.
    // The later pulls ran in the same two sandboxes as the first; the pairs are the memo's.
    cleanupPairs([R.D1, R.EmptyAfterS1].filter((s) => s && s.first).map((s) => s.first));
  });
}

// ---- The in-process pull harness (Tasks 3 and 4), shared by queue-pull.test.js and
// queue-pull-oracle-checks.test.js, whose oracle cross-checks compare the fence run against it. ----

// Runs fn with TMPDIR (and the win32 spellings) pointed at a test-owned dir, never the host one.
function inOwnTmp(fn) {
  const own = scratchDir('qp-t2-');
  const keys = ['TMPDIR', 'TEMP', 'TMP'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = own;
  try {
    return fn(own);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(own, { recursive: true, force: true });
  }
}

const T3_PASSES = PASSES.slice(0, 5); // truncate, fetch, blocked, oversized, write-back
const NOW = new Date('2026-11-12T12:00:00.000Z');
const EXPRESS_OFF = () => ({ enabled: false, grouping: 'per-record', fingerprint: 'off-fp', keepSingleton: () => false });

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
  NATIVE_FAIL_CLOSED_PREFIX,
  UNLANDED_STOP,
  OPEN_PR_FAIL,
  PR_VIEW_FAILED,
  labelsWarning,
  LABELS_ENTRY_9020,
  HOSTILE_DOC,
  CLOSING_BODY,
  runStagedComment,
  MALFORMED_CAUSE,
  cannedLanding,
  POOL,
  PARITY_S1,
  ALL_REASONS,
  FILES_S1_REASONS,
  MATRIX,
  AC1_FILES,
  memoPair,
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
  TARGET_MISSING_SKIPPED,
  CLAIM_READ_COMBINED,
  DEP_FRESH_USED,
  DEP_FRESH_WRITTEN,
  CLAIM_READ_FAILED_7001,
  FOREIGN_UNREADABLE,
  assertFaultRow,
  runFaultPool,
  FAULT_EXPECT,
  FILES_EXPECT,
  assertFailOpenPostures,
  inOwnTmp,
  NOW,
  EXPRESS_OFF,
  pull,
  entriesOf,
  FULL,
  pull4,
};
