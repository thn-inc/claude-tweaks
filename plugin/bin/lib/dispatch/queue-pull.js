'use strict';

// #5227: the module port of dispatch's queue-pull script -- the ```bash fence in
// plugin/skills/dispatch/queue-pull-script.md that starts at the `DISPATCH_QUEUE_RAW=` line.
// This file holds the registry, the session paths, the pass loop and every pass runner.
// Since #5230 dispatch runs this module (bin/queue-pull.js), not the fence: the module is the
// live queue pull, and the retained fence is its revert path and parity oracle until #5231
// removes it. Fix a defect here and mirror the change into the fence, never the other way round.
// Two rules are module-only by decision and are not mirrored, both in the blocked pass's `files`
// block: #5408's omitted-dependency check and #5865's `unreadable` freshness entry, which warns and
// keeps the queue-order cache unwritten (search `#5408`, `#5865`). The fence cannot see either,
// because it never gets the agent's raw dependency-freshness text there. They stay divergences
// until #5231 deletes the fence.
//
// R6, step-for-step port: each fence step is one function. A throw inside a step is caught and
// printed to stderr as `queue-pull: <step>: <message>`, and the run then continues or stops
// exactly where the fence has an RC check or a `grep -q 'appendExclusion:'` check. Stop and
// Warning texts match the fence byte for byte, and the two must keep the same behavior, except for
// the #5408 and #5865 rules named above.
//   The fence's own calls are unbounded; the default deps bound every one (shared-primitives.js),
// so a call that hangs, or outlasts its bound, is where the two can differ. GH_BATCH_TIMEOUT_MS
// bounds an aliased GraphQL batch and every paginated list call (`issue list` / `pr list` with
// --limit above 100, and the `pr list --json files` overlap fetch: isBatchGhCall); GH_TIMEOUT_MS
// bounds every other gh call (a single `issue view` / `pr view`); GIT_TIMEOUT_MS every git call;
// CLI_TIMEOUT_MS every spawned plugin CLI.
//
// R7, registry semantics: PASSES is the ordered registry. `queuePull` walks it in array order, so
// position in the array is position in the run. Each entry is
//   { id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp }
// where `kind` is 'setup' | 'exclusion' | 'informational' and `reason` is null unless `kind` is
// 'exclusion'. `removes` says whether the reason drops the record from dispatch-groups.json,
// `bypass` whether a named #N form may still dispatch it, `runsOnCacheHit` whether the pass runs
// on a queue-order cache hit, and `mcp` how the pass behaves on the `files` transport.
//   failOpen is the pull-level posture of a fetch failure within that pass, in AC11's fixed set:
//     'stop' -- a fetch failure in the pass can stop the pull;
//     'open' -- a fetch failure lets the pull continue (whether the pass then excludes nothing,
//               or excludes fail-closed as "unreadable");
//     'n/a'  -- the pass makes no fetch.
//   It is the strictest posture across all of the pass's fetches and across BOTH transports.
//   A consumer cannot read fail-closed from failOpen alone: `blocked` is 'open', yet an unreadable
//   foreign state excludes its record. Each fetch's exclusion effect is pinned by the fault rows
//   (queue-pull-parity-ac4.test.js AC4.1 and queue-pull-parity-ac7.test.js AC7.2), and each value
//   here is asserted from those oracle runs (AC4.2, one test per transport: AC4.2 [gh] in
//   queue-pull-parity-ac4.test.js and AC4.2 [files] in queue-pull-parity-ac7.test.js), never from
//   the spec.
// `malformed-blocker` and `unlanded-blocker` share `id: 'blocker-landing'`, because one
// dispatch-unlanded-blockers.js call writes both; they carry one identical failOpen. A shared id
// runs once, at its first entry.
//
// `omit` (queuePull option) takes reasons or ids and removes that pass's own filtering and
// appends and nothing else, with one exception: omitting either blocker-landing reason skips the
// shared call, so both reasons; the eligibility screen for non-array labels always runs, and its
// `malformed-blocker` append follows `blocker-landing`'s omit. runPasses ALWAYS calls every pass's
// runner and exposes the omit set as `ctx.omit` (a Set of ids); each runner skips only its own
// filtering and appends when `ctx.omit.has(<its id>)` and runs its shared steps regardless (for
// example `oversized` owns the grouping block that writes dispatch-groups.json and the `blocked`
// appends, and `target-missing` owns the integration-branch and run-dir resolution). Omitting a
// setup pass, or naming an unknown reason or id, throws TypeError. Omit has one shipped caller,
// `runBudget`'s `omit: ['driver-lane']` (#6119); because an omitted pass positioned before
// `write-back` leaves groups the cache blob would then misdescribe, the write-back pass writes
// nothing (no writeOrder call) whenever the omit set holds such a pass (today `blocked`,
// `oversized`); a pass after it cannot change the blob, so omitting only that one still writes it.
//
// failOpen is taken across both transports, so a gh-only reader sees `stop` for a pass whose
// gh fetch fails open (neighbour-in-flight): on `files`, a missing or malformed in-flight or
// claims file stops the pull.
//
// Test seams beyond `deps` (no shipped caller uses them; a refactor keeps them or updates the
// tests that read them: queue-pull.test.js, and the shared `pull` harness in queue-pull-helpers.js
// that it and queue-pull-oracle-checks.test.js run): `makeContext(options, deps)` is exported,
// and tests run passes over its context and then assert on `ctx.state.cacheHit`, `.workLinks`,
// `.groupSizeGuard`, `.integrationBranch`, `.integrationRef` and `.files` (the effective input
// paths); `runPasses` takes `ctx.runners` ({ [id]: fn }) in place of the real runners; and
// `defaultDeps({ execFileSync, spawnSync })` replaces the two child_process calls the default
// runner and spawnCli make.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { readExclusions, appendExclusion, groupIsExcluded } = require('./exclusions');
const { writeReleaseTimes, readReleaseTimes } = require('./shipped-releases');
const { GRAPHQL_INT_MAX } = require('./unlanded-blockers');
const { buildFreshnessSignal, cacheUsable, composeOrderBlob } = require('./queue-order');
const { aliasMcpTimestamps } = require('../issues/mcp-issue-shape');
const { parseRecordFacets, parseDependencies, partitionByOpenBodyBlockers, openBlockerRefs } = require('../issues/record');
const { bodyForeignBlockers } = require('../issues/cross-repo-states');
const { shapeGate } = require('../issues/materialize-format');
const { namedTarget } = require('../issues/named-target');
const { classifyShipped, predatesClaimRelease, downgradedAfterMerge } = require('../issues/shipped-candidate');
const { extractKeyFiles, expectsKeyFilesSection, buildDispatchGroups, partitionGroupsBySizeGuard, detectCrossPRFileOverlap } = require('../issues/grouping');
const { neighbourInFlightExclusions, claimReaderFromMap } = require('./in-flight-neighbours');
const { nearDuplicatePairsAcrossGroups } = require('./near-dup-pairs');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { sessionTmpPath, envTmpdir } = require('../session-tmp');
const { resolveBuildAuthority, formatAuthorityLine } = require('../issues/build-authority');
const { ghOptions } = require('../repo-resolve');
const { driverLaneExclusions, spawnCommentReader, readDriverRunner } = require('./driver-lane');
const { GH_TIMEOUT_MS, GH_BATCH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('../shared-primitives');

const BIN_DIR = path.join(__dirname, '..', '..');

const deepFreeze = (value) => {
  for (const v of Object.values(value)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(value);
};

const row = (id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp) => (
  { id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp }
);

const PASSES = deepFreeze([
  row('truncate', 'setup', null, false, false, true, 'n/a', 'same'),
  row('fetch', 'setup', null, false, false, true, 'stop', 'agent-fetched'),
  row('blocked', 'exclusion', 'blocked', true, false, true, 'open', 'agent-fetched'),
  row('oversized', 'exclusion', 'oversized', false, true, true, 'n/a', 'same'),
  row('write-back', 'setup', null, false, false, false, 'open', 'same'),
  row('not-spec-shaped', 'exclusion', 'not-spec-shaped', true, false, true, 'n/a', 'same'),
  row('open-pr', 'exclusion', 'open-pr', true, false, true, 'open', 'fails-open'),
  row('target-missing', 'exclusion', 'target-missing', true, false, true, 'open', 'same'),
  row('shipped', 'exclusion', 'shipped', true, false, true, 'open', 'skipped-empty'),
  row('blocker-landing', 'exclusion', 'malformed-blocker', true, false, true, 'open', 'same'),
  row('blocker-landing', 'exclusion', 'unlanded-blocker', true, false, true, 'open', 'fails-open'),
  row('driver-lane', 'exclusion', 'driver-lane', false, true, true, 'open', 'fails-open'),
  row('neighbour-in-flight', 'exclusion', 'neighbour-in-flight', false, true, true, 'stop', 'agent-fetched'),
  row('cross-pr-overlap', 'informational', null, false, false, true, 'open', 'skipped-empty'),
  row('near-dup-pairs', 'informational', null, false, false, true, 'n/a', 'same'),
]);

const PASS_FIELD_VALUES = deepFreeze({
  kind: ['setup', 'exclusion', 'informational'],
  failOpen: ['open', 'stop', 'n/a'],
  mcp: ['same', 'skipped-empty', 'fails-open', 'agent-fetched'],
});

// The fence's `--value` names in fence order, then the ranking script's own pick file.
const SESSION_FILES = deepFreeze([
  'dispatch-queue-raw.json',
  'dispatch-open-numbers.json',
  'dispatch-eligible-pre-dep.json',
  'dispatch-unresolved-deps.json',
  'dispatch-verified-open-deps.txt',
  'dispatch-eligible.json',
  'dispatch-blocked-excluded-body.json',
  'dispatch-native-deps.json',
  'dispatch-native-deps.tmp.json',
  'dispatch-native-deps.err',
  'dispatch-groups.json',
  'dispatch-exclusions.json',
  'dispatch-fastlane-bundles.json',
  'dispatch-in-flight-raw.json',
  'dispatch-in-flight-claims.json',
  'dispatch-dep-freshness.json',
  'dispatch-open-prs.json',
  'dispatch-crosspr-overlap.json',
  'dispatch-near-dup-pairs.json',
  'dispatch-linked-prs.json',
  'dispatch-linked-prs.err',
  'dispatch-named-targets.json',
  'dispatch-shipped-probe-prs.json',
  'dispatch-shipped-pr-files.jsonl',
  'dispatch-shipped-releases.json',
  'dispatch-shape-gate.err',
  'dispatch-next-pick.json',
]);

// The session files written only after their step's fallible work (#5409): removed at pull start.
// The fence's `rm -f` line carries the same set. A new session file written that way joins both;
// every other SESSION_FILES entry is reset before its step's fallible work, removed by its own step
// (ELIGIBILITY_FILES), or an agent input. The #5409 partition test names each one's class.
const END_WRITTEN_FILES = deepFreeze([
  'dispatch-named-targets.json',
  'dispatch-shipped-probe-prs.json',
  'dispatch-shipped-releases.json',
  'dispatch-crosspr-overlap.json',
  'dispatch-near-dup-pairs.json',
]);

// sessionId -> { [name]: absolute path }; with no session id each falls back to os.tmpdir()/name.
function sessionPaths(sessionId) {
  const out = {};
  for (const name of SESSION_FILES) out[name] = sessionTmpPath(sessionId, name) || path.join(os.tmpdir(), name);
  return out;
}

// A stop: `.line` is the exact 'dispatch: queue-pull stopped -- ...' text the fence prints.
class QueuePullStopped extends Error {
  constructor(line) {
    super(line);
    this.name = 'QueuePullStopped';
    this.line = line;
  }
}

// Fence lines 44 and 46-51. The only direct write to the exclusions file; every later pass appends
// through appendExclusion. Keeps only the 'firing' entries (firing-exclusion.md).
function runTruncate(ctx) {
  // #5409 (fence 44): each of these files is written after its step's fallible work, so a step that
  // throws first would leave an earlier pull's copy for the pass or reader after it; the agent
  // inputs and the exclusions file are not in the set. One step per file, like `rm -f`'s operands.
  for (const name of END_WRITTEN_FILES) step(ctx, 'rm-end-written', () => fs.rmSync(ctx.paths[name], { force: true }));
  const file = ctx.paths['dispatch-exclusions.json'];
  try {
    const kept = readExclusions(file).filter((e) => e.reason === 'firing');
    fs.writeFileSync(file, JSON.stringify(kept));
  } catch (err) {
    ctx.deps.stderr(`queue-pull: truncate: ${err.message}\n`);
  }
}

// ---- helpers shared by the fetch / blocked / oversized / write-back passes --------------------

const QUEUE_ARGV = ['issue', 'list', '--label', 'auto:build', '--state', 'open', '--json',
  'number,title,body,labels,createdAt,updatedAt,state', '--limit', '500'];
const OPEN_NUMBERS_ARGV = ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'];

// fence line 72, byte for byte
const QUEUE_CAP_WARNING = 'Warning: the auto:build queue pull returned exactly the --limit cap (500) — this repo may have more open auto:build records than fetched. gh issue list returns newest-first, so any records beyond the cap are the OLDEST same-priority ones, exactly what next\'s own oldest-first tie-break (Step 3) exists to surface first. Consider raising the cap, or filing this as a signal to re-triage the queue down.';

const CACHE_HIT_MESSAGE = 'Queue-order cache hit — using persisted groups/excluded, skipping dependency verification and native blocker query (#1571).';

// What `require(file)` of a session .json file does: read and parse, throwing on a missing or
// malformed file.
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// What bash's $(...) does to a captured value: drop every trailing newline.
const trimNl = (s) => String(s == null ? '' : s).replace(/\n+$/, '');

const cliOpts = (ctx) => ({ cwd: ctx.options.cwd, env: ctx.options.env });
const optionEnv = (ctx) => ctx.options.env || process.env;

// Runs one fence step. A throw is printed as `queue-pull: <step>: <message>` and the run goes on
// (R6); the caller decides what its own RC check does with { ok: false }.
function step(ctx, name, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    ctx.deps.stderr(`queue-pull: ${name}: ${err && err.message}\n`);
    return { ok: false, error: err };
  }
}

// The injected runner owns the host seam: defaultDeps().run wraps every gh argv in ghOptions, so
// the call site names the command through a constant.
const GH = 'gh';

// gh stdout as bash's `> file` captures it: the answer on success, whatever a failed call printed
// before it failed otherwise. `quiet` is `2>/dev/null`.
function ghRun(ctx, args, { quiet = false } = {}) {
  try {
    return { ok: true, stdout: String(ctx.deps.run(GH, args, runOpts(ctx, quiet ? { stdio: ['pipe', 'pipe', 'ignore'] } : {}))) };
  } catch (err) {
    return { ok: false, stdout: err && err.stdout != null ? String(err.stdout) : '' };
  }
}

// `resolve-policy.js --values <key>` in $( ), stderr forwarded, failure reads as the empty string.
function readPolicy(ctx, key) {
  const r = spawnCli(ctx, 'resolve-policy.js', ['--values', key], { label: 'policy' });
  forward(ctx, r, { stdout: false });
  return trimNl(r.stdout);
}

// A fence redirect or echo that fails does not stop the fence (R6): the write is a step.
const put = (ctx, file, content) => step(ctx, `write ${path.basename(file)}`, () => fs.writeFileSync(file, content));

// alias_mcp_timestamps (fence 56-66): the camelCase keys added in place. D3 (#5307): a non-array
// file is a failed read -- a Warning, the file left as the agent wrote it, and a not-ok step no caller
// checks: the reads that follow fail on their own array checks (readArray).
function aliasFile(ctx, name, file) {
  const parsed = step(ctx, name, () => readJson(file));
  if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.value)) {
    ctx.deps.stderr(`Warning: ${file} is not a JSON array — treated as a failed read\n`);
    return { ok: false };
  }
  return step(ctx, name, () => fs.writeFileSync(file, JSON.stringify(aliasMcpTimestamps(parsed.value))));
}

// The queue or dependency-freshness session file read as the list it must be. Any other JSON value
// throws: a string would otherwise be spread character by character into the freshness signal (D3, #5307).
const readArray = (file) => {
  const value = readJson(file);
  if (!Array.isArray(value)) throw new TypeError(`${path.basename(file)} is not a JSON array`);
  return value;
};

// The `gh issue list --search "#a #b" --state all ...` dependency-freshness fetch (fence: the cache check and the
// write-back): a failure writes [] and prints one Warning naming the consequence (#5310).
function fetchDepFreshness(ctx, numbersCsv, file, consequence) {
  const search = numbersCsv.split(',').join(' ').replace(/[0-9]+/g, '#$&');
  const r = ghRun(ctx, ['issue', 'list', '--search', search, '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'], { quiet: true });
  put(ctx, file, r.ok ? r.stdout : '[]');
  if (!r.ok) ctx.deps.stderr(`Warning: dependency-freshness search failed — queue-order cache not ${consequence} this run\n`);
  return r.ok;
}

// On `files` the agent's dependency-freshness file stands where the fence's `gh issue list --search`
// stands (mcp-transport.md's Step 2): written to the session file at each search the fence makes,
// or the session file removed when the agent wrote none. The agent's text was read once, before the
// fence's `echo '[]'` reset the session file (the input defaults to that same path).
function agentDepFreshness(ctx, file) {
  const text = ctx.state.depFreshnessInput;
  if (text === null) step(ctx, 'agent-dep-freshness', () => fs.rmSync(file, { force: true }));
  else put(ctx, file, text);
}

// #5311: a dependency number the blocked pass checks, 1..GRAPHQL_INT_MAX. Anything else belongs to the
// blocker-landing pass's malformed-blocker exclusion (unlanded-blockers.js malformedRecords, the exact
// complement, hence the shared constant) and is never live-checked.
function inLiveCheckRange(dep) {
  return dep > 0 && dep <= GRAPHQL_INT_MAX;
}

// The valid entries of the agent's dependency-freshness text: an unparseable value, a non-array, or an
// entry without an integer `number` and a string `state` yields none.
function validFreshnessEntries(text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e && Number.isInteger(e.number) && typeof e.state === 'string');
}

// The numbers the agent's dependency-freshness text shows closed (#5408). A number counts closed
// only when every valid entry for it says so: two contradictory entries are untrusted input that
// must fail closed, not open.
function closedDependencyNumbers(text) {
  const valid = validFreshnessEntries(text);
  const isClosed = (e) => e.state.toLowerCase() === 'closed';
  const contested = new Set(valid.filter((e) => !isClosed(e)).map((e) => e.number));
  return new Set(valid.filter(isClosed).map((e) => e.number).filter((n) => !contested.has(n)));
}

// The numbers the agent's dependency-freshness text marks `unreadable` (#5865): ascending and
// de-duplicated, under the same validity test. Never closed, whatever else the file says about the
// same number.
function unreadableDependencyNumbers(text) {
  const numbers = validFreshnessEntries(text)
    .filter((e) => e.state.toLowerCase() === 'unreadable')
    .map((e) => e.number);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

// On `files` the agent's queue file stands where the fence's queue pull stands, as the agent's Write
// does: copied into the session file, which is the one aliased and read from then on, so the
// caller's own file is never rewritten (a non-array session copy is a failed read, #5307). A
// queue file the agent never wrote removes the session file, so an earlier pull's queue is not read.
function agentQueueRaw(ctx, input, file) {
  const text = step(ctx, 'queue-input', () => readTextOrNull(input)).value ?? null;
  if (text === null) step(ctx, 'agent-queue', () => fs.rmSync(file, { force: true }));
  else put(ctx, file, text);
}

// The input file's text, or null when it does not exist.
function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// The two exclusion-append loops the hit and miss paths share.
function appendBlocked(file, entries) {
  for (const e of entries) appendExclusion(file, { reason: 'blocked', records: [e.number], detail: { blockedBy: e.blockedBy } });
}
// The partition runs before the omit check on purpose: omit removes only this pass's appends, so
// an omitted run still fails wherever the full run fails. parseInt of an unset policy is NaN, and
// partitionGroupsBySizeGuard then flags nothing, as the fence's own `parseInt(process.argv[5], 10)`
// does (queue-pull-script.md, both the cache-hit and the grouping blocks).
function appendOversized(file, groups, groupSizeGuard, omitted) {
  const { oversized, threshold } = partitionGroupsBySizeGuard(groups, { groupSizeGuard: parseInt(groupSizeGuard, 10) });
  if (omitted) return;
  for (const g of oversized) {
    appendExclusion(file, { reason: 'oversized', records: g.map((i) => i.number), detail: { size: g.length, threshold } });
  }
}

const rootOf = (ctx) => {
  const cwd = ctx.options.cwd || process.cwd();
  return mainCheckoutRoot(cwd) || cwd;
};

const cacheHitStop = (ctx, err) => {
  ctx.deps.stderr(`queue-pull: cache-hit: ${err && err.message}\n`);
  return new QueuePullStopped('dispatch: queue-pull stopped -- cache-hit exclusion pass failed (exit 1); see error above.');
};

// The per-run state the passes share. `files` are the effective input paths: the session files on
// `gh`, and on `files` the supplied paths (each defaulting to its session file).
function makeContext(options = {}, deps = {}) {
  const merged = { ...defaultDeps(), ...deps };
  const omit = resolveOmit(options.omit);
  const paths = sessionPaths(options.sessionId);
  const inputs = options.inputs || {};
  const onFiles = options.transport === 'files';
  const pick = (given, name) => (onFiles && given ? given : paths[name]);
  const env = options.env || process.env;
  const state = {
    cacheHit: false,
    persisted: null,
    workLinks: '',
    groupSizeGuard: '',
    bundleCap: '',
    foreignStates: inputs.foreignStates || env.DISPATCH_FOREIGN_STATES,
    shippedUnreadable: [], // #5304: '#N (cause)' claims the shipped pass could not read; the neighbour pass reports them
    claimLineReported: false, // #5304: set when reportClaimReadFailures runs; a stop before it flushes the shipped list
    neighbourUnreadable: [], // #5304: the neighbour pass's unreadable claims, kept before its appends so a throwing append still reports them
    claimReader: null, // #5304: the pull's one claim reader, built on its first read (claimReader(ctx))
    depFreshnessInput: null, // files only: the agent's dependency-freshness text, read by the fetch pass
    nativeUnreadable: false, // #5309: the native-blockers query failed closed; every eligible record is excluded
    depUnreadable: false, // #5311: a dependency view or the verified-open-deps file failed closed; nothing is written back
    depFreshFailed: false, // #5310: the write-back's dependency-freshness search failed, or #5865: the files freshness text marks a dependency unreadable; nothing is written back
    labelsSkipped: false, // #5315: a record with non-array labels was excluded at eligibility; nothing is written back
    standaloneDir: '',
    typedNumbers: new Set(), // #5584: the named records admitted on a typed command (fetch pass)
    integrationBranch: '',
    integrationRef: '',
    files: {
      queueRaw: pick(inputs.queueRaw, 'dispatch-queue-raw.json'),
      depFreshness: pick(inputs.depFreshness, 'dispatch-dep-freshness.json'),
      openNumbers: pick(inputs.openNumbers, 'dispatch-open-numbers.json'),
      verifiedOpenDeps: pick(inputs.verifiedOpenDeps, 'dispatch-verified-open-deps.txt'),
      inFlightRaw: pick(inputs.inFlightRaw, 'dispatch-in-flight-raw.json'),
      inFlightClaims: pick(inputs.inFlightClaims, 'dispatch-in-flight-claims.json'),
    },
  };
  return { options, deps: merged, paths, omit, state };
}

// #5584: `--named` (options.named, record numbers a person typed after /claude-tweaks:dispatch).
// Runs between the pool fetch and its aliasing, before any pass, so the passes and their registry
// are untouched: a named record already in the pool is left alone (no fetch, no line); any other is
// fetched and judged by the one build-authority rule. A record the rule answers `typed` for is
// appended to the queue file and to state.typedNumbers, which the blocked pass's grant filter
// accepts; every later pass then judges it as it judges a granted record. Each fetched record prints
// exactly one line on stdout:
//   - not OPEN: the open-records-only line, printed before the rule runs;
//   - `none`: formatAuthorityLine's refusal, naming the rule's reason words;
//   - `label` (carries auto:build, yet the pool fetch missed it): the not-in-this-pull's-queue line;
//   - `typed` but carrying bot:in-progress: the already-claimed line, no AUTO line (the eligibility
//     filter would drop it);
//   - `typed`, AUTO line written to options.runDir's decisions.md: the admit line, and the record is
//     admitted (only once that line is written);
//   - `typed`, AUTO write failed: the not-admitted line (the cause goes to stderr);
//   - `typed` and admitted, but the queue-file write that makes it real failed: a second not-admitted
//     line and a corrective decisions.md line, and the record leaves state.typedNumbers.
// Nothing here writes a label. Under the files transport nothing is fetched: one line per named
// number says the label is required.
function admitNamed(ctx, queueFile) {
  const { deps, state } = ctx;
  const named = ctx.options.named || [];
  if (named.length === 0) return;
  if (ctx.options.transport === 'files') {
    for (const number of named) deps.stdout(`#${number}: --named admits nothing under --transport files; the auto:build label is required\n`);
    return;
  }
  // A pool that does not read as an array admits nothing: the pull stops at group-building on it.
  const pool = step(ctx, 'named-pool', () => readJson(queueFile));
  if (!pool.ok || !Array.isArray(pool.value)) return;
  const pooled = new Set(pool.value.map((i) => i && i.number));
  const env = optionEnv(ctx);
  const admitted = [];
  for (const number of named) {
    if (pooled.has(number)) continue;
    const raw = fetchNamed(ctx, number);
    let result;
    if (raw === null) {
      result = { authority: 'none', reasons: ['labels-unreadable'] };
    } else if (raw.state !== 'OPEN') {
      deps.stdout(`#${number} is ${raw.state.toLowerCase()} — not built: the queue pull takes open records only\n`);
      continue;
    } else {
      result = deps.buildAuthority({
        number,
        labels: raw.labels,
        named: true,
        env,
        typedCommand: () => deps.readTypedCommand({ number, env, now: deps.now(), tmpdir: ctx.options.tmpdir || envTmpdir(env) }),
        // Never the terminal route: only drive.js is run with a person at a terminal, so outside a
        // session the pull answers none (not-a-terminal) by design (build-authority.js header).
        stdinIsTTY: false,
      });
    }
    if (result.authority === 'typed') {
      // The blocked pass's eligibility filter drops a claimed record, granted or typed: refuse it here,
      // before an AUTO line could record a build that will not happen. Checked only on `typed`, so a
      // refusal the rule names (held, not-ready, ...) keeps its own words. A typed answer means the
      // labels read as an array.
      if (parseRecordFacets(raw.labels).bot.inProgress) {
        deps.stdout(`#${number} is already claimed (bot:in-progress) — not built this firing\n`);
        continue;
      }
      const text = `#${number} admitted on a typed /claude-tweaks:dispatch command (no auto:build label)`;
      if (!step(ctx, `named #${number}`, () => deps.appendDecision({ runDir: ctx.options.runDir, text, now: deps.now() })).ok) {
        deps.stdout(`#${number} not admitted: the decisions.md audit line could not be written\n`);
        continue;
      }
      admitted.push(raw);
      state.typedNumbers.add(number);
    }
    // A `label` answer here means the record carries auto:build yet the pool fetch did not return it.
    const line = result.authority === 'label'
      ? `#${number} carries auto:build but is not in this pull's queue — not built this firing`
      : formatAuthorityLine(number, result);
    deps.stdout(`${line}\n`);
  }
  if (admitted.length === 0) return;
  // The admit line and AUTO line above were written before this write: a failed write must not leave
  // a record reported admitted that never reaches the queue, so each is un-admitted and says so.
  if (put(ctx, queueFile, JSON.stringify([...pool.value, ...admitted])).ok) return;
  for (const raw of admitted) {
    state.typedNumbers.delete(raw.number);
    deps.stdout(`#${raw.number} not admitted: the queue file could not be written\n`);
    step(ctx, `named #${raw.number} rollback`, () => deps.appendDecision({
      runDir: ctx.options.runDir, text: `#${raw.number} not admitted after all: the queue file could not be written`, now: deps.now(),
    }));
  }
}

// One named record as `gh issue view` returns it, or null when the fetch failed or its answer is not
// that record (another number, or no string state).
function fetchNamed(ctx, number) {
  let raw;
  try {
    raw = ctx.deps.fetchRecord(ctx, number);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || raw.number !== number || typeof raw.state !== 'string') return null;
  return raw;
}

const NAMED_FIELDS = 'number,title,body,labels,createdAt,updatedAt,state';

// Fence 68-137, then line 141 and the policy reads of 142-144 on a miss: the queue pull, the
// aliasing, the 500-cap Warning, the dependency-freshness fetch and the cache check. On a hit it
// has written dispatch-groups.json; the blocked and oversized passes replay the rest.
function runFetch(ctx) {
  const { deps, paths, state } = ctx;
  const f = state.files;
  const onGh = ctx.options.transport !== 'files';
  const depFile = paths['dispatch-dep-freshness.json'];
  const queueFile = paths['dispatch-queue-raw.json'];

  if (!onGh) state.depFreshnessInput = step(ctx, 'dep-freshness-input', () => readTextOrNull(f.depFreshness)).value ?? null;
  if (onGh) put(ctx, queueFile, ghRun(ctx, QUEUE_ARGV).stdout);
  else agentQueueRaw(ctx, f.queueRaw, queueFile);
  admitNamed(ctx, queueFile);
  aliasFile(ctx, 'alias-queue', queueFile);
  // The cap is the auto:build list's own --limit: the records admitted above are not counted.
  const count = step(ctx, 'queue-count', () => {
    const queue = readJson(queueFile);
    return Array.isArray(queue) ? queue.length - state.typedNumbers.size : 0;
  });
  if (count.ok && count.value >= 500) deps.stderr(`${QUEUE_CAP_WARNING}\n`);
  // A pull that admitted a typed record never reads the cache (Deliverable 5): a hit reuses stored
  // groups, which either drop this pull's typed record or (once written) hand it to a later drain.
  const readOrder = () => (state.typedNumbers.size > 0 ? null : deps.queueOrder.readOrder(rootOf(ctx)));

  const depNumbers = step(ctx, 'dep-numbers', () => {
    const persisted = readOrder();
    if (!persisted) return '';
    const autoBuildNumbers = new Set(readJson(queueFile).map((i) => i.number));
    const depOnly = (persisted.freshnessSignal.issues || []).filter((i) => !autoBuildNumbers.has(i.number));
    return depOnly.map((i) => i.number).join(',');
  }).value || '';
  put(ctx, depFile, '[]');
  put(ctx, paths['dispatch-fastlane-bundles.json'], '[]');
  if (depNumbers) {
    if (onGh) fetchDepFreshness(ctx, depNumbers, depFile, 'used'); // its [] is always a miss: the numbers are the persisted signal's extra issues
    else agentDepFreshness(ctx, depFile);
  }
  aliasFile(ctx, 'alias-dep-freshness', depFile);

  // The size guard is read for the cache check whether or not a blob exists (fence line 97).
  state.groupSizeGuard = readPolicy(ctx, 'dispatch-group-size-guard');
  try {
    const persisted = readOrder();
    if (persisted) {
      const autoBuild = readArray(queueFile);
      const current = buildFreshnessSignal([...autoBuild, ...readArray(depFile)]);
      // #5314 (fence 109): an empty queue never reuses the earlier pull's groups.
      if (autoBuild.length > 0 && cacheUsable(persisted, current, deps.expressQueuePolicy({ stderr: deps.stderr }))) {
        fs.writeFileSync(paths['dispatch-groups.json'], JSON.stringify(persisted.groups));
        state.cacheHit = true;
        state.persisted = persisted;
      }
    }
  } catch (err) {
    throw cacheHitStop(ctx, err);
  }
  if (state.cacheHit) return;

  if (onGh) put(ctx, f.openNumbers, ghRun(ctx, OPEN_NUMBERS_ARGV).stdout);
  state.workLinks = readPolicy(ctx, 'work-links');
  state.groupSizeGuard = readPolicy(ctx, 'dispatch-group-size-guard');
  state.bundleCap = readPolicy(ctx, 'dispatch-fastlane-bundle-cap');
}

// #5304: the CLI lookup's Warning when gh is absent (resolve-foreign-blockers.js's exit 2), the one
// foreign-states Warning the dispatch layer drops after an ignored states file. Matches the fence's test.
const GH_ABSENT_LOOKUP = /^Warning: foreign blocker state lookup failed \(exit 2: [^)]*gh[^)]* is required\)/;

// #5309: the blockedBy entry every eligible record carries when the native query failed closed.
const NATIVE_UNREADABLE = 'native blockers (state unreadable)';

// #5314: the eligibility files the miss path computes, removed before it does.
const ELIGIBILITY_FILES = ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json'];

// #5309: a failed native-blockers call. On gh every failure fails closed: the Warning names the
// call and the consequence, and the grouping block excludes every eligible record. On files only
// exit 3 fails closed (exit 2 is gh absent, the normal files result); any other failure keeps the
// gh-absent fallback and its Warning. Module and fence print the same bytes.
function nativeQueryFailed(ctx, r) {
  if (ctx.options.transport === 'files' && r.status !== 3) {
    ctx.deps.stderr(`Warning: native dependency query failed — falling back to no native filtering this run: ${trimNl(r.stderr)}\n`);
    return;
  }
  ctx.state.nativeUnreadable = true;
  ctx.deps.stderr(`Warning: native dependency query failed — every candidate excluded as blocked (native blockers unreadable, fail closed) this run: ${trimNl(r.stderr)}\n`);
}

// Fence 145-208 on a miss (the removal of an earlier pull's eligibility files, the eligible list, the
// unresolved-dependency check, the body-text and native blocker filtering); on a hit the persisted
// `excluded` entries replayed as 'blocked'.
function runBlocked(ctx) {
  const { deps, paths, omit, state } = ctx;
  const f = state.files;
  const skip = omit.has('blocked');

  if (state.cacheHit) {
    if (skip) return;
    try {
      // persisted.excluded is the disk cache's own {number, blockedBy}[] shape; convert here (Q28).
      appendBlocked(paths['dispatch-exclusions.json'], state.persisted.excluded);
    } catch (err) {
      throw cacheHitStop(ctx, err);
    }
    return;
  }

  // #5314 (fence 145-146): this pull's eligibility files are computed below; an earlier pull's
  // never stand in for them when a read below fails, so a failed step stops at group-building.
  step(ctx, 'rm-eligibility', () => {
    for (const name of ELIGIBILITY_FILES) fs.rmSync(paths[name], { force: true });
  });

  step(ctx, 'eligible-pre-dep', () => {
    const queued = readJson(paths['dispatch-queue-raw.json']);
    const openNumbers = new Set(readJson(f.openNumbers).map((i) => i.number));
    // #5315 (fence 151-152, 160): a non-array labels value is excluded on its own; the pull writes no cache.
    const issues = queued.filter((i) => {
      if (i.labels == null || Array.isArray(i.labels)) return true;
      if (!omit.has('blocker-landing')) appendExclusion(paths['dispatch-exclusions.json'], { reason: 'malformed-blocker', records: [i.number], detail: { cause: 'its labels are not an array' } });
      deps.stderr(`Warning: #${i.number} excluded — its labels are not an array\n`);
      state.labelsSkipped = true;
      return false;
    });
    const eligiblePreDep = issues
      .map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))
      .filter((i) => (i.facets.grants.build || state.typedNumbers.has(i.number)) && !i.facets.bot.inProgress && !i.facets.bot.blocked && !i.facets.bot.parked);
    // '--limit 200' can truncate the open-issues pull: a dependency absent from it is
    // unresolved, not closed, and is checked live below. #5311: a number outside inLiveCheckRange
    // is never live-checked; live-checking it would fail closed as a spurious `blocked` with a
    // Warning every pull.
    const unresolved = [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)).filter((dep) => inLiveCheckRange(dep) && !openNumbers.has(dep)))];
    fs.writeFileSync(paths['dispatch-eligible-pre-dep.json'], JSON.stringify(eligiblePreDep));
    fs.writeFileSync(paths['dispatch-unresolved-deps.json'], JSON.stringify(unresolved));
  });

  if (!skip && ctx.options.transport !== 'files') {
    step(ctx, 'verified-open-deps', () => {
      // #5879: removed, never truncated (rationale: queue-pull-notes.md).
      fs.rmSync(f.verifiedOpenDeps, { force: true });
      const open = [];
      const unresolved = readJson(paths['dispatch-unresolved-deps.json']).join(' ').split(/\s+/).filter(Boolean);
      for (const dep of unresolved) {
        const r = ghRun(ctx, ['issue', 'view', dep, '--json', 'state', '-q', '.state'], { quiet: true });
        // #5311: a failed view fails closed.
        if (!r.ok) {
          deps.stderr(`Warning: gh issue view ${dep} failed — dependency #${dep} treated as open (fail closed) this run\n`);
          state.depUnreadable = true;
        }
        if (!r.ok || trimNl(r.stdout) === 'OPEN') open.push(`${dep}\n`);
      }
      // #5311: one write after the loop; a failed write removes the file, so the blocked pass below
      // fails closed on a missing file rather than reading a partial or empty one as "none open".
      try {
        fs.writeFileSync(f.verifiedOpenDeps, open.join(''));
      } catch (err) {
        try { fs.rmSync(f.verifiedOpenDeps, { force: true }); } catch { /* the step's error stands */ }
        throw err;
      }
    });
  }

  step(ctx, 'blocked-body', () => {
    const eligiblePreDep = readJson(paths['dispatch-eligible-pre-dep.json']);
    if (skip) {
      fs.writeFileSync(paths['dispatch-eligible.json'], JSON.stringify(eligiblePreDep));
      fs.writeFileSync(paths['dispatch-blocked-excluded-body.json'], '[]');
      return;
    }
    const openNumbers = new Set(readJson(f.openNumbers).map((i) => i.number));
    let lines = null;
    try {
      lines = fs.readFileSync(f.verifiedOpenDeps, 'utf8').trim().split('\n').filter(Boolean);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    // #5311: a missing or malformed file fails closed: every unresolved dependency counts as open.
    const bad = lines === null || lines.some((l) => !/^\d+$/.test(l.trim()));
    const unresolved = bad ? readJson(paths['dispatch-unresolved-deps.json']) : [];
    if (bad && unresolved.length) {
      deps.stderr('Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run\n');
      state.depUnreadable = true;
    }
    const verifiedOpen = bad ? unresolved.map(Number) : lines.map(Number);
    for (const dep of verifiedOpen) openNumbers.add(dep);
    // #5408: on `files` the agent writes the verified-open list, so it is not complete by construction
    // as the CLI's is. An unresolved dependency it omits counts as closed only when the agent's own
    // dependency-freshness text shows it closed; otherwise it counts as open (fail closed).
    // Module-only: the fence has no twin of this block, by the plan-review decision, until #5231
    // deletes the fence. Do not mirror it, and do not remove it to restore parity.
    // #5865: a number the freshness file marks `unreadable` (the agent's issue_read failed on it) is
    // never closed: the one Warning below names it in place of the omitted-dependency Warning, and
    // depFreshFailed keeps the queue-order cache unwritten. Checked whether or not the file was `bad`.
    // Only an in-range dependency of an eligible record counts: `Blocked by #0` or a number above
    // GRAPHQL_INT_MAX is the blocker-landing pass's malformed-blocker case (#5311, inLiveCheckRange).
    if (ctx.options.transport === 'files') {
      const depended = new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)).filter(inLiveCheckRange));
      const unreadable = unreadableDependencyNumbers(state.depFreshnessInput).filter((n) => depended.has(n));
      if (!bad) {
        const closed = closedDependencyNumbers(state.depFreshnessInput);
        const unreadableSet = new Set(unreadable);
        for (const dep of readJson(paths['dispatch-unresolved-deps.json'])) {
          if (verifiedOpen.includes(dep) || closed.has(dep)) continue;
          openNumbers.add(dep);
          if (!unreadableSet.has(dep)) deps.stderr(`Warning: verified-open-deps file omits #${dep}, which the dependency-freshness file does not show closed — treated as open (fail closed) this run\n`);
          state.depUnreadable = true;
        }
      }
      if (unreadable.length) {
        deps.stderr(`Warning: dependency-freshness file marks ${unreadable.map((n) => `#${n}`).join(', ')} unreadable — treated as open (fail closed), queue-order cache not written this run\n`);
        state.depFreshFailed = true;
      }
    }
    // #4793: a supplied states file (either transport) answers the foreign refs; the rest go to
    // resolve-foreign-blockers.js through the library's own bounded spawn (tests inject
    // deps.foreignDeps.spawn).
    // #5304: after an ignored states file, the CLI lookup's gh-absent Warning is dropped (the states
    // file's stays); a lookup that fails for another cause keeps its Warning. Keyed on the text, the
    // same test the fence applies. The library is unchanged.
    let statesIgnored = false;
    const foreignStderr = (line) => {
      if (line.startsWith('Warning: foreign blocker states file ')) statesIgnored = true;
      else if (statesIgnored && GH_ABSENT_LOOKUP.test(line)) return;
      deps.stderr(line);
    };
    const foreign = bodyForeignBlockers(eligiblePreDep, {
      statesFile: state.foreignStates,
      stderr: foreignStderr,
      ...deps.foreignDeps,
    });
    const { eligible, excluded } = partitionByOpenBodyBlockers(eligiblePreDep, openNumbers, foreign);
    fs.writeFileSync(paths['dispatch-eligible.json'], JSON.stringify(eligible));
    fs.writeFileSync(paths['dispatch-blocked-excluded-body.json'], JSON.stringify(excluded));
  });

  put(ctx, paths['dispatch-native-deps.json'], '{}');
  if (!skip && state.workLinks === 'native') {
    step(ctx, 'native-deps', () => {
      // A failed read of the eligible list keeps step()'s line, as the fence's does (#5309's
      // fail-closed Warning covers only a failed query and its own writes, below).
      const nativeNums = readJson(paths['dispatch-eligible.json']).map((i) => i.number).join(',');
      if (!nativeNums) return;
      // #5309: a throw from the call or its writes is a failed query with no step line: the one
      // Warning carries the message, and the transport rule applies.
      let r;
      try {
        r = deps.spawnCli('resolve-blockers.js', [nativeNums], cliOpts(ctx));
        fs.writeFileSync(paths['dispatch-native-deps.tmp.json'], r.stdout || '');
        fs.writeFileSync(paths['dispatch-native-deps.err'], r.stderr || '');
        if (r.status === 0) fs.renameSync(paths['dispatch-native-deps.tmp.json'], paths['dispatch-native-deps.json']);
      } catch (err) {
        nativeQueryFailed(ctx, { status: null, stderr: errText(err) });
        return;
      }
      if (r.status !== 0) nativeQueryFailed(ctx, r);
    });
  }
}

// Fence 209-255 on a miss: the grouping block, which writes dispatch-groups.json, then the
// bundles, then the 'blocked' appends, then the 'oversized' appends. On a hit it runs the size
// guard over the persisted groups and keeps the persisted bundles.
function runOversized(ctx) {
  const { deps, paths, omit, state } = ctx;
  const exclusions = paths['dispatch-exclusions.json'];

  if (state.cacheHit) {
    try {
      appendOversized(exclusions, state.persisted.groups, state.groupSizeGuard, omit.has('oversized'));
      // #2066: a persisted record from before the field existed has no `bundles`.
      fs.writeFileSync(paths['dispatch-fastlane-bundles.json'], JSON.stringify(state.persisted.bundles || []));
    } catch (err) {
      throw cacheHitStop(ctx, err);
    }
    deps.stderr(`${CACHE_HIT_MESSAGE}\n`);
    return;
  }

  try {
    fs.writeFileSync(paths['dispatch-groups.json'], ''); // the fence's `>` redirect
    const eligible = readJson(paths['dispatch-eligible.json']);
    const nativeDeps = readJson(paths['dispatch-native-deps.json']);
    const finalEligible = [];
    const excludedNative = [];
    for (const c of eligible) {
      const dep = nativeDeps[c.number];
      let refs = [];
      if (state.nativeUnreadable) refs = [NATIVE_UNREADABLE];
      else if (dep) refs = openBlockerRefs(dep);
      if (refs.length > 0) excludedNative.push({ number: c.number, blockedBy: refs });
      else finalEligible.push(c);
    }
    const items = finalEligible.map((i) => ({ id: i.number, keyFiles: extractKeyFiles(i) }));
    const byId = new Map(finalEligible.map((i) => [i.number, i]));
    for (const item of items) {
      if (item.keyFiles.length === 0 && expectsKeyFilesSection(byId.get(item.id))) {
        deps.stderr(`Warning: eligible record #${item.id} has no ### Key Files subsection — overlap detection disabled for it.\n`);
      }
    }
    // Grouping is per-record (#3278); fast-lane bundles (#1910) stay disjoint.
    const bundleCap = parseInt(state.bundleCap, 10);
    const { groups, bundles } = buildDispatchGroups(finalEligible, { bundleCap, keepSingleton: deps.expressQueuePolicy({ stderr: deps.stderr }).keepSingleton });
    fs.writeFileSync(paths['dispatch-groups.json'], `${JSON.stringify(groups)}\n`); // console.log
    fs.writeFileSync(paths['dispatch-fastlane-bundles.json'], JSON.stringify(bundles));
    const excludedBody = readJson(paths['dispatch-blocked-excluded-body.json']);
    if (!omit.has('blocked')) {
      appendBlocked(exclusions, [...excludedBody, ...excludedNative]);
    }
    // Size guard (#1228): flagged, never removed from the groups.
    appendOversized(exclusions, groups, state.groupSizeGuard, omit.has('oversized'));
  } catch (err) {
    deps.stderr(`queue-pull: group-building: ${err && err.message}\n`);
    throw new QueuePullStopped('dispatch: queue-pull stopped -- group-building exclusion pass failed (exit 1); see error above.');
  }
}

// Fence 257-296, the cache-miss path only: the dependency-freshness refetch over every eligible
// record's dependencies, then the best-effort write-back of the queue-order blob.
function runWriteBack(ctx) {
  const { deps, paths, state } = ctx;
  if (state.cacheHit) return;
  const onGh = ctx.options.transport !== 'files';
  const depFile = paths['dispatch-dep-freshness.json'];

  const allDeps = step(ctx, 'all-dep-numbers', () => {
    const eligiblePreDep = readJson(paths['dispatch-eligible-pre-dep.json']);
    return [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)))].join(',');
  }).value || '';
  put(ctx, depFile, '[]');
  if (allDeps) {
    if (onGh) state.depFreshFailed = !fetchDepFreshness(ctx, allDeps, depFile, 'written');
    else agentDepFreshness(ctx, depFile);
  }
  aliasFile(ctx, 'alias-dep-freshness', depFile);

  if ([...ctx.omit].some((id) => PASSES.findIndex((p) => p.id === id) < PASSES.findIndex((p) => p.id === 'write-back'))) return; // an omitted pass before this one leaves groups the blob would misdescribe
  if (state.nativeUnreadable) return; // #5309: a failed native read is never persisted as a verdict
  if (state.depUnreadable) return; // #5311: nor is a fail-closed dependency verdict
  if (state.depFreshFailed) return; // #5310: nor a freshness signal missing its dependencies
  if (state.labelsSkipped) return; // #5315: nor a pull that excluded a non-array-labels record
  if (state.typedNumbers.size > 0) return; // a typed record must not reach a later drain's cache hit (#5584)
  step(ctx, 'write-back', () => {
    const root = rootOf(ctx);
    const autoBuild = readArray(paths['dispatch-queue-raw.json']);
    const depFreshness = readArray(depFile);
    const groups = readJson(paths['dispatch-groups.json']);
    // The disk cache keeps its pre-#1752 {number, blockedBy}[] `excluded` shape: reshape the
    // unified 'blocked' entries back at the one place the schemas meet (Q28).
    const excluded = readExclusions(paths['dispatch-exclusions.json'])
      .filter((e) => e.reason === 'blocked')
      .map((e) => ({ number: e.records[0], blockedBy: e.detail.blockedBy }));
    const bundles = readJson(paths['dispatch-fastlane-bundles.json']);
    const freshnessSignal = buildFreshnessSignal([...autoBuild, ...depFreshness]);
    const runDir = optionEnv(ctx).PIPELINE_RUN_DIR;
    const blob = composeOrderBlob({
      computedAt: deps.now().toISOString(),
      runId: runDir ? path.basename(runDir) : null,
      freshnessSignal, groups, excluded, bundles, ...deps.expressQueuePolicy({ stderr: deps.stderr }),
    });
    const result = deps.queueOrder.writeOrder(root, blob);
    if (!result.ok) deps.stderr(`Queue-order cache write-back failed (non-blocking): ${result.error}\n`);
  });
}

// ---- not-spec-shaped, open-pr, target-missing and shipped (fence 300-566) ---------------------

// The text this module quotes where the fence prints `$(cat $ERR_FILE)`. The fence's file holds
// Node's uncaught-exception report: a header (a throw-site file:line, or a node:internal loader
// line, depending on the Node version) that err.stack does not carry, then the error text and a
// stack. This is the thrown message only, so those four lines differ from the oracle's after
// their fixed prefix, and the parity suite's reported() compares those lines up to that prefix.
const errText = (err) => String(err && err.message != null ? err.message : err);

// The options a runner call carries: the context's cwd and env, no undefined keys.
function runOpts(ctx, extra = {}) {
  const opts = { ...cliOpts(ctx), ...extra };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  return opts;
}

// A fence CLI call: a spawn that throws reads as a failed call with no output, noted as
// `queue-pull: <label>: <message>` (label defaults to the CLI name), or not noted at all when
// `quiet` (a fence call whose stderr goes to /dev/null).
function spawnCli(ctx, name, args, { label = name, quiet = false } = {}) {
  try {
    const r = ctx.deps.spawnCli(name, args, cliOpts(ctx));
    return { status: r && r.status, stdout: (r && r.stdout) || '', stderr: (r && r.stderr) || '' };
  } catch (err) {
    if (!quiet) ctx.deps.stderr(`queue-pull: ${label}: ${errText(err)}\n`);
    return { status: null, stdout: '', stderr: '' };
  }
}

// A CLI whose stdout and stderr the fence leaves on the terminal.
function forward(ctx, r, { stdout = true, stderr = true } = {}) {
  if (stdout && r.stdout) ctx.deps.stdout(r.stdout);
  if (stderr && r.stderr) ctx.deps.stderr(r.stderr);
}

// Reads dispatch-groups.json, keeps each group's members `makeKeep()` accepts (called after the read,
// like the fence's `require` order), drops emptied groups, and writes `console.log(JSON.stringify(..))`.
function rewriteGroups(ctx, makeKeep) {
  const file = ctx.paths['dispatch-groups.json'];
  const groups = readJson(file);
  const keep = makeKeep();
  const finalGroups = groups.map((g) => g.filter(keep)).filter((g) => g.length > 0);
  fs.writeFileSync(file, `${JSON.stringify(finalGroups)}\n`);
}

// The node block of an exclusion pass whose stderr the fence redirects into `errFile` (fence 301,
// 344): the file keeps the failure text. Returns the failure text, or null on success.
function runRedirectedBlock(ctx, errFile, fn) {
  try {
    fn();
    put(ctx, errFile, '');
    return null;
  } catch (err) {
    const text = errText(err);
    put(ctx, errFile, `${text}\n`);
    return text;
  }
}

// Fence 300-328. Keeps a candidate only when its cached body passes the Materialization gate.
function runNotSpecShaped(ctx) {
  const { deps, paths, omit } = ctx;
  const skip = omit.has('not-spec-shaped');
  const failure = runRedirectedBlock(ctx, paths['dispatch-shape-gate.err'], () => rewriteGroups(ctx, () => (c) => {
    if (skip) return true;
    const result = shapeGate(c.body);
    if (!result.ok) {
      appendExclusion(paths['dispatch-exclusions.json'], { reason: 'not-spec-shaped', records: [c.number], detail: { missing: result.missing } });
      return false;
    }
    return true;
  }));
  if (failure === null) return;
  // #3110: a thrown appendExclusion means the exclusions file itself may be partially written.
  if (failure.includes('appendExclusion:')) {
    throw new QueuePullStopped(`dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: ${trimNl(failure)}`);
  }
  deps.stderr(`Warning: not-spec-shaped pass skipped — ${trimNl(failure)}\n`);
}

// Fence 330-374. The linked-PR query is shared setup (the shipped pass reads its mentions); only the
// exclusion filtering is this pass's own.
function runOpenPr(ctx) {
  const { deps, paths, omit } = ctx;
  const linkedFile = paths['dispatch-linked-prs.json'];
  const errFile = paths['dispatch-linked-prs.err'];
  const nums = step(ctx, 'group-numbers', () => readJson(paths['dispatch-groups.json']).flat().map((i) => i.number).join(',')).value || '';
  put(ctx, linkedFile, '{}\n'); // the fence's `echo '{}'`
  if (nums) {
    const r = spawnCli(ctx, 'resolve-linked-prs.js', [nums]);
    put(ctx, linkedFile, r.stdout);
    put(ctx, errFile, r.stderr);
    if (r.status !== 0) {
      deps.stderr(`Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: ${trimNl(r.stderr)}\n`);
      put(ctx, linkedFile, '{}\n');
    }
  }
  const skip = omit.has('open-pr');
  const failure = runRedirectedBlock(ctx, errFile, () => rewriteGroups(ctx, () => {
    const linkedPRs = readJson(linkedFile);
    return (c) => {
      const entry = linkedPRs[c.number];
      if (!skip && entry && entry.openPR) {
        appendExclusion(paths['dispatch-exclusions.json'], { reason: 'open-pr', records: [c.number], detail: { pr: entry.openPR } });
        return false;
      }
      return true;
    };
  }));
  if (failure === null) return;
  // #3110: a thrown appendExclusion is not a transient resolve-linked-prs.js failure.
  if (failure.includes('appendExclusion:')) {
    throw new QueuePullStopped(`dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: ${trimNl(failure)}`);
  }
  deps.stderr(`Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: ${trimNl(failure)}\n`);
}

// `git remote show origin | sed -n '/HEAD branch/s/.*: //p'` (fence 382): a failed git still hands
// over whatever it printed.
function remoteHeadBranch(ctx) {
  let out;
  try {
    out = String(ctx.deps.run('git', ['remote', 'show', 'origin'], runOpts(ctx)));
  } catch (err) {
    out = err && err.stdout != null ? String(err.stdout) : '';
  }
  return trimNl(out.split('\n').filter((l) => /HEAD branch/.test(l) && /: /.test(l)).map((l) => l.replace(/^.*: /, '')).join('\n'));
}

// POSIX single-quoting, the rule of the fence's node quoter in the comment echo (#5317) and of queue-pull-oracle.js's shQuote.
const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// The staged Close (GitHub) body of a target-missing exclusion: the fence's echo lines.
function targetMissingProposal(num, tpath, ref) {
  return [
    `# Staged: Close (GitHub) — #${num} (named target absent at ${ref})`,
    '',
    `**Finding:** \`[gh-issue] #${num}\` names target \`${tpath}\`, which is absent at \`${ref}\` — deleted by a later commit after this record was filed.`,
    '',
    `**Proposed:** Close #${num} as not planned — named target deleted, nothing left to fix.`,
    '',
    '**Commands:**',
    `gh issue comment ${num} --body ${shQuote(`Closing: the named target ${tpath} no longer exists at ${ref} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).`)}`,
    `gh issue close ${num} --reason "not planned"`,
  ].map((l) => `${l}\n`).join('');
}

// #5863: whether `ref` (origin/{branch}) names a commit here. `git remote show origin` prints
// `HEAD branch: (unknown)` for a dangling origin HEAD, and a policy key can name a deleted branch.
function originRefResolves(ctx, ref) {
  try {
    ctx.deps.run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], runOpts(ctx, { stdio: 'pipe' }));
    return true;
  } catch {
    return false;
  }
}

// #5305, #5863: the Warning printed in place of the target-missing pass when the integration branch is empty
// or its origin/ ref does not resolve (fence 394-395).
const TARGET_MISSING_SKIPPED = 'Warning: target-missing pass skipped — no resolvable integration branch';

// Fence 376-459. The run-dir and integration-branch resolution (377-384) is shared setup and
// runs whether or not this pass is omitted; later passes read state.integrationBranch.
function runTargetMissing(ctx) {
  const { deps, paths, omit, state } = ctx;
  // Fence 377: `$(node hooks.js resolve-run-dir ...)` captures stdout; its stderr stays on the terminal.
  const runDirCall = spawnCli(ctx, 'hooks.js', ['resolve-run-dir', '--spec-slug', 'dispatch-standalone']);
  forward(ctx, runDirCall, { stdout: false });
  state.standaloneDir = trimNl(runDirCall.stdout);
  let branch = readPolicy(ctx, 'integration-branch');
  if (!branch) branch = remoteHeadBranch(ctx);
  state.integrationBranch = branch;
  // #5305: an empty or unresolvable branch (#5863) composes no usable origin/ ref; the pass that compares against it is skipped.
  // Only this pass skips: the shared branch and ref stay as resolved for the unlanded-blocker pass, which checks landing through the GitHub API.
  const ref = branch ? `origin/${branch}` : '';
  state.integrationRef = ref;
  const exclusions = paths['dispatch-exclusions.json'];

  if (!omit.has('target-missing')) {
    step(ctx, 'named-targets', () => {
      const named = readJson(paths['dispatch-groups.json']).flat()
        .map((c) => ({ number: c.number, target: namedTarget(c) }))
        .filter((c) => c.target);
      fs.writeFileSync(paths['dispatch-named-targets.json'], JSON.stringify(named));
    });
    // The probe runs only when this pass does, as in the fence; an empty branch never reaches it.
    if (!branch || !originRefResolves(ctx, ref)) {
      deps.stderr(`${TARGET_MISSING_SKIPPED}\n`);
    } else {
      const probe = step(ctx, 'target-missing', () => {
        const named = readJson(paths['dispatch-named-targets.json']);
        const missing = named.filter(({ target }) => {
          try {
            deps.run('git', ['cat-file', '-e', `${ref}:${target.path}`], runOpts(ctx, { stdio: 'pipe' }));
            return false;
          } catch {
            return true;
          }
        });
        for (const { number, target } of missing) {
          appendExclusion(exclusions, { reason: 'target-missing', records: [number], detail: { path: target.path } });
        }
      });
      // #3110: stop rather than continue with a partial exclusion list.
      if (!probe.ok) throw new QueuePullStopped('dispatch: queue-pull stopped -- target-missing exclusion pass failed (exit 1); see error above.');
    }
  }

  step(ctx, 'target-missing-filter', () => rewriteGroups(ctx, () => {
    const entries = readExclusions(exclusions);
    return (c) => !groupIsExcluded([c], entries, ['target-missing']);
  }));

  const rows = step(ctx, 'target-missing-rows', () => readExclusions(exclusions)
    .filter((e) => e.reason === 'target-missing')
    .map((e) => ({ number: e.records[0], path: e.detail.path }))).value || [];
  for (const { number, path: tpath } of rows) {
    forward(ctx, spawnCli(ctx, 'log-decision.js', ['--run', state.standaloneDir, '--status', 'AUTO',
      '--text', `dispatch: #${number} excluded, named target ${tpath} absent at ${ref}`, '--reversibility', 'n/a']));
    // Fence 444: beside dispatch-exclusions.json, as the shipped pass's proposals are;
    // the .md names the staged item (#5316).
    const file = path.join(path.dirname(exclusions), `target-missing-proposal-${number}.md`);
    if (!put(ctx, file, targetMissingProposal(number, tpath, ref)).ok) continue;
    forward(ctx, spawnCli(ctx, 'stage-item.js', ['--run', state.standaloneDir, '--id', `dispatch-target-missing-${number}`, '--file', file]));
  }
}

// The one claim reader of a pull, shared by the shipped and neighbour-in-flight passes; built on its first read.
function claimReader(ctx) {
  return {
    read: (n) => {
      if (!ctx.state.claimReader) ctx.state.claimReader = ctx.deps.createClaimReader();
      return ctx.state.claimReader.read(n);
    },
  };
}

// Fence 539-566: one Close proposal per strong-tier exclusion, staged into the firing's own run dir.
// The run-dir call is `2>/dev/null || true`: its stderr is dropped and a spawn throw is silent.
function stageShippedProposals(ctx) {
  const { paths } = ctx;
  const runDir = trimNl(spawnCli(ctx, 'hooks.js', ['resolve-run-dir', '--spec-slug', 'dispatch-standalone'], { quiet: true }).stdout);
  if (!runDir) return;
  const exclusions = paths['dispatch-exclusions.json'];
  const entries = step(ctx, 'shipped-stage', () => readExclusions(exclusions)
    .filter((e) => e.reason === 'shipped')
    .map((e) => ({ number: e.records[0], pr: e.detail.pr, signals: e.detail.signals }))).value || [];
  const tmpDir = path.dirname(exclusions);
  for (const entry of entries) {
    const file = path.join(tmpDir, `shipped-close-proposal-${entry.number}.md`);
    const wrote = step(ctx, 'shipped-stage', () => fs.writeFileSync(file, [
      '## Close (GitHub)',
      '',
      `#${entry.number} — deliverables already shipped by merged PR #${entry.pr}`,
      '',
      `Signals: ${entry.signals.join(', ')}`,
      '',
      `Comment then close: \`gh issue close ${entry.number} --comment "Deliverables already shipped by #${entry.pr}"\``,
    ].join('\n')));
    if (!wrote.ok) break;
    // stdout dropped (`>/dev/null`), failure ignored (`|| true`); stderr stays on the terminal.
    forward(ctx, spawnCli(ctx, 'stage-item.js', ['--run', runDir, '--id', `shipped-close-${entry.number}`, '--file', file]), { stdout: false });
  }
}

// Fence 466-566. Omitting the pass skips its classification, probes, exclusions and staging.
function runShipped(ctx) {
  const { deps, paths, omit } = ctx;
  if (omit.has('shipped')) {
    step(ctx, 'shipped', () => rewriteGroups(ctx, () => () => true));
    return;
  }
  const linkedFile = paths['dispatch-linked-prs.json'];
  const probeFile = paths['dispatch-shipped-probe-prs.json'];
  const prFilesFile = paths['dispatch-shipped-pr-files.jsonl'];
  const releasesFile = paths['dispatch-shipped-releases.json'];

  // First pass: title-only classification; only a `weak` result not downgraded after the merge (claim release
  // or shaping, #5722) is probed for the files-based upgrade, capped at 5 live `gh pr view` calls per pull. The mentions come
  // from `dispatch-linked-prs.json`, already fetched, so this pass makes no second round trip for them.
  step(ctx, 'shipped-probe', () => {
    const groups = readJson(paths['dispatch-groups.json']);
    const linkedPRs = readJson(linkedFile);
    const releases = writeReleaseTimes(releasesFile, groups.flat(), linkedPRs, { log: (line) => deps.stderr(`${line}\n`), reader: claimReader(ctx), unreadable: ctx.state.shippedUnreadable });
    const toProbe = [];
    for (const c of groups.flat()) {
      const entry = linkedPRs[c.number];
      const mentions = (entry && entry.mentions) || [];
      if (mentions.length === 0) continue;
      const result = classifyShipped(c, mentions, { lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });
      if (result.tier === 'weak' && !downgradedAfterMerge(result)) toProbe.push(result.pr);
    }
    fs.writeFileSync(probeFile, JSON.stringify([...new Set(toProbe)].slice(0, 5)));
  });

  put(ctx, prFilesFile, '');
  const probePrs = step(ctx, 'shipped-probe-list', () => readJson(probeFile).join(' ').split(/\s+/).filter(Boolean)).value || [];
  for (const pr of probePrs) {
    // `2>/dev/null || FILES_JSON=null`: a failed fetch prints nothing (stderr ignored) and reads as null.
    const r = ghRun(ctx, ['pr', 'view', pr, '--json', 'files', '-q', '[.files[].path]'], { quiet: true });
    const filesJson = r.ok ? trimNl(r.stdout) : 'null';
    step(ctx, 'shipped-pr-files', () => fs.appendFileSync(prFilesFile, `${JSON.stringify({ pr: Number(pr), files: JSON.parse(filesJson) })}\n`));
  }

  // Second pass: final tier, with the probed files. `strong` leaves the groups for this pull;
  // `weak` stays, logged for build-time context.
  const second = step(ctx, 'shipped', () => rewriteGroups(ctx, () => {
    const linkedPRs = readJson(linkedFile);
    let prFilesLines = [];
    try {
      prFilesLines = fs.readFileSync(prFilesFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    const prFiles = new Map(prFilesLines.map((e) => [e.pr, e.files]));
    const releases = readReleaseTimes(releasesFile);
    return (c) => {
      const entry = linkedPRs[c.number];
      const mentions = (entry && entry.mentions) || [];
      if (mentions.length === 0) return true;
      const result = classifyShipped(c, mentions, { prFiles, lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });
      if (result.tier === 'strong') {
        appendExclusion(paths['dispatch-exclusions.json'], { reason: 'shipped', records: [c.number], detail: { pr: result.pr, signals: result.signals } });
        deps.stderr(`AUTO — dispatch: #${c.number} excluded, shipped by merged PR #${result.pr} (${result.signals.join(', ')})\n`);
        return false;
      }
      if (result.tier === 'weak') {
        let keptDetail;
        if (predatesClaimRelease(result)) {
          keptDetail = ` kept: merged PR #${result.pr} predates claim release at ${releases[c.number]} — remaining work assumed`;
        } else if (downgradedAfterMerge(result)) {
          keptDetail = ` kept: merged PR #${result.pr} predates ready/auto:build labeling at ${entry.lastShapedAt} — remaining work assumed`;
        } else {
          keptDetail = ` mentioned by merged PR #${result.pr} without a closing keyword; dispatching anyway`;
        }
        deps.stderr(`AUTO — dispatch: #${c.number}${keptDetail}\n`);
        if (!downgradedAfterMerge(result) && prFiles.get(result.pr) === null) deps.stderr(`Warning: gh pr view ${result.pr} failed — #${c.number} kept as a weak shipped candidate (files unprobed) this run\n`);
      }
      return true;
    };
  }));
  // #3110: this pass's shipped-candidate exclusions may be only partially written.
  if (!second.ok) throw new QueuePullStopped('dispatch: queue-pull stopped -- shipped-candidate exclusion pass failed; see error above.');

  stageShippedProposals(ctx);
}

// ---- blocker-landing, neighbour-in-flight, cross-PR overlap and near-duplicate (fence 568-648) --

// Fence 568-576. One dispatch-unlanded-blockers.js call writes both the unlanded-blocker and the
// malformed-blocker entries, so omitting either reason skips the whole call (R7). `--work-links`
// is the value the fetch pass stored: on a queue-order cache hit the fence never sets WORK_LINKS,
// so "$WORK_LINKS" is the empty string and the CLI accepts it.
function runBlockerLanding(ctx) {
  const { paths, omit, state } = ctx;
  if (omit.has('blocker-landing')) return;
  const groupsFile = paths['dispatch-groups.json'];
  const tmp = `${groupsFile}.tmp`;
  const stop = new QueuePullStopped('dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above.');
  // The fence's `> "${DISPATCH_GROUPS}.tmp"` redirect creates the file before the CLI runs; a failed
  // redirect runs no command and takes the `else` branch (rm -f, then the stop).
  if (!put(ctx, tmp, '').ok) {
    step(ctx, 'rm dispatch-groups.json.tmp', () => fs.rmSync(tmp, { force: true }));
    throw stop;
  }
  const r = spawnCli(ctx, 'dispatch-unlanded-blockers.js', ['--groups', groupsFile, '--exclusions', paths['dispatch-exclusions.json'],
    '--integration-branch', state.integrationBranch, '--work-links', state.workLinks]);
  forward(ctx, r, { stdout: false });
  if (r.status === 0) {
    step(ctx, 'unlanded-blocker', () => {
      fs.writeFileSync(tmp, r.stdout);
      fs.renameSync(tmp, groupsFile);
    });
    return;
  }
  fs.rmSync(tmp, { force: true });
  throw stop;
}

// #6119: under `express-driver-runner: script` a script job drains driver-routable singletons, so
// the session drain leaves them: one `driver-lane` entry each (driver-lane.js). Fails open: an
// unreadable runner or comment read excludes none; only a refused appendExclusion stops the pull.
// Why here: queue-pull-notes.md.
function runDriverLane(ctx) {
  if (ctx.omit.has('driver-lane')) return;
  const { deps, paths } = ctx;
  const stream = { write: (s) => deps.stderr(s) };
  const computed = step(ctx, 'driver-lane', () => {
    const runner = deps.readDriverRunner({ stderr: stream });
    if (runner !== 'script') return [];
    const groups = readJson(paths['dispatch-groups.json']);
    const policy = deps.expressQueuePolicy({ stderr: deps.stderr });
    const readComments = ctx.options.transport === 'files'
      ? () => ({ ok: false, cause: 'comment read unavailable on the files transport' })
      : spawnCommentReader({ spawnCli: (name, args) => deps.spawnCli(name, args, cliOpts(ctx)) });
    return driverLaneExclusions({ groups, policy, runner, readComments, stderr: stream });
  });
  if (!computed.ok) return;
  try {
    for (const e of computed.value) appendExclusion(paths['dispatch-exclusions.json'], e);
  } catch (err) {
    throw new QueuePullStopped(`dispatch: queue-pull stopped -- driver-lane exclusion pass hit a corrupt exclusions file: ${errText(err)}`);
  }
}

const IN_FLIGHT_ARGV = ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'];
const IN_FLIGHT_POOL_AUTO = 'AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull';
// fence 587, byte for byte
const IN_FLIGHT_CAP_WARNING = 'Warning: the bot:in-progress pull for the neighbour-in-flight pass (#3278) returned exactly the --limit cap (200) — in-flight records beyond the cap are not checked as neighbours. Informational only; never blocks dispatch.';

// #5304: one AUTO line per pull for the claims the two claim-reading passes could not read. The
// shipped pass's list waits in state.shippedUnreadable for this pass, which runs after it on both
// transports and prints the single line, also when omitted (the shipped list is then all there is).
function reportClaimReadFailures(ctx, neighbourUnreadable) {
  ctx.state.claimLineReported = true;
  const shipped = ctx.state.shippedUnreadable;
  const neighbour = neighbourUnreadable.map((n) => `#${n}`);
  if (shipped.length && neighbour.length) ctx.deps.stderr(`AUTO — dispatch: claim read failed for ${[...shipped, ...neighbour].join(', ')}; shipped-candidate release time unknown, no downgrade; neighbour-in-flight treated as not in flight\n`);
  else if (neighbour.length) ctx.deps.stderr(`AUTO — dispatch: neighbour-in-flight claim read failed for ${neighbour.join(', ')}; treated as not in flight\n`);
  else if (shipped.length) ctx.deps.stderr(`AUTO — dispatch: shipped-candidate claim read failed for ${shipped.join(', ')}; release time unknown, no downgrade\n`);
}

// Fence 578-614 on `gh`; on `files` mcp-transport.md's Step 2 four-step replacement, whose agent-
// written pool and claim-map FILES this pass reads (steps 1-3 are the agent's). Only the compute
// is this pass's own: omitting the pass skips it (and so its appends and AUTO line), while the pool
// fetch and its cap Warning are shared setup. A missing or malformed pool or claim-map file throws
// inside the compute and stops the pull (R8); only the agent-written `[]` / `{}` values fail open.
// This pass prints no claim-targets list (mcp-transport.md's step 2), so the claim-map file must
// cover every record in the pool file; bin/queue-pull.js's header says why.
// The claim reader is the library's own and reads process.cwd()/process.env: options.cwd and
// options.env are not threaded to it (createClaimReader takes only gitRunner/ghApi/runGh seams).
function runNeighbourInFlight(ctx) {
  const { deps, paths, omit, state } = ctx;
  const f = state.files;
  const onGh = ctx.options.transport !== 'files';
  if (onGh) {
    const pool = ghRun(ctx, IN_FLIGHT_ARGV, { quiet: true });
    if (pool.ok) {
      put(ctx, f.inFlightRaw, pool.stdout);
    } else {
      put(ctx, f.inFlightRaw, '[]\n');
      deps.stderr(`${IN_FLIGHT_POOL_AUTO}\n`);
    }
    const count = step(ctx, 'in-flight-count', () => readJson(f.inFlightRaw).length);
    if (count.ok && count.value >= 200) deps.stderr(`${IN_FLIGHT_CAP_WARNING}\n`);
  }
  if (!omit.has('neighbour-in-flight')) {
    const computed = step(ctx, 'neighbour-in-flight', () => {
      const candidates = readJson(paths['dispatch-groups.json']).flat();
      const inFlight = readJson(f.inFlightRaw);
      const readClaimContent = onGh ? claimReader(ctx).read : claimReaderFromMap(readJson(f.inFlightClaims));
      const result = neighbourInFlightExclusions({ candidates, inFlight, readClaimContent, now: deps.now().getTime() });
      state.neighbourUnreadable = result.unreadable;
      for (const e of result.exclusions) appendExclusion(paths['dispatch-exclusions.json'], e);
    });
    if (!computed.ok) throw new QueuePullStopped('dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed (exit 1); see error above.');
  }
  reportClaimReadFailures(ctx, state.neighbourUnreadable);
}

const OPEN_PRS_ARGV = ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'];
// fence 623, byte for byte
const OPEN_PR_CAP_WARNING = 'Warning: the open-PR pull for the cross-PR overlap report (#1579) returned exactly the --limit cap (100) — overlap detection may be missing older open PRs. Informational only; never blocks dispatch.';
// fence 620's failure branch, byte for byte (#5312)
const OPEN_PR_FAIL_WARNING = 'Warning: open-PR pull failed — cross-PR overlap not checked this run';

// Fence 616-637, informational. On `files` mcp-transport.md skips the fetch and has the agent write
// `[]`; the module does the same and makes no gh call. On `gh` a failed open-PR fetch writes [] and
// prints one Warning (#5312), and a compute failure is a step error the fence does not stop on.
function runCrossPrOverlap(ctx) {
  const { deps, paths, omit } = ctx;
  const out = paths['dispatch-crosspr-overlap.json'];
  const skip = omit.has('cross-pr-overlap');
  if (ctx.options.transport === 'files') {
    if (!skip) put(ctx, out, '[]');
    return;
  }
  const prsFile = paths['dispatch-open-prs.json'];
  const r = ghRun(ctx, OPEN_PRS_ARGV, { quiet: true });
  put(ctx, prsFile, r.ok ? r.stdout : '[]\n');
  if (!r.ok) deps.stderr(`${OPEN_PR_FAIL_WARNING}\n`);
  const count = step(ctx, 'open-pr-count', () => readJson(prsFile).length);
  if (count.ok && count.value >= 100) deps.stderr(`${OPEN_PR_CAP_WARNING}\n`);
  if (skip) return;
  step(ctx, 'cross-pr-overlap', () => {
    const groups = readJson(paths['dispatch-groups.json']);
    const openPrsRaw = readJson(prsFile);
    const candidates = groups.flat().map((c) => ({ number: c.number, keyFiles: extractKeyFiles(c) }));
    const openPRs = openPrsRaw.map((pr) => ({
      number: pr.number,
      files: (pr.files || []).map((x) => x.path),
      closingIssueNumbers: (pr.closingIssuesReferences || []).map((i) => i.number),
    }));
    fs.writeFileSync(out, JSON.stringify(detectCrossPRFileOverlap(candidates, openPRs)));
  });
}

// Fence 639-648, informational: every cross-group pair gets an AUTO line, and only the strong ones
// reach dispatch-near-dup-pairs.json (always written, [] when there are none).
function runNearDupPairs(ctx) {
  if (ctx.omit.has('near-dup-pairs')) return;
  const { deps, paths } = ctx;
  step(ctx, 'near-dup-pairs', () => {
    const pairs = nearDuplicatePairsAcrossGroups(readJson(paths['dispatch-groups.json']));
    for (const p of pairs) deps.stderr(`AUTO — dispatch: near-duplicate candidates across groups: #${p.records[0]} / #${p.records[1]} (${p.signals.join(', ')})\n`);
    fs.writeFileSync(paths['dispatch-near-dup-pairs.json'], JSON.stringify(pairs.filter((p) => p.strong).map(({ records, signals, sharedAnchors }) => ({ records, signals, sharedAnchors }))));
  });
}

const RUNNERS = {
  truncate: runTruncate, fetch: runFetch, blocked: runBlocked, oversized: runOversized, 'write-back': runWriteBack,
  'not-spec-shaped': runNotSpecShaped, 'open-pr': runOpenPr, 'target-missing': runTargetMissing, shipped: runShipped,
  'blocker-landing': runBlockerLanding, 'driver-lane': runDriverLane, 'neighbour-in-flight': runNeighbourInFlight,
  'cross-pr-overlap': runCrossPrOverlap, 'near-dup-pairs': runNearDupPairs,
};

// omit entries (reasons or ids) -> the Set of pass ids to skip. Exported so the omit mapping
// (either blocker-landing reason -> the shared id) is testable without a runner for every pass.
function resolveOmit(omit = []) {
  const ids = new Set();
  for (const name of omit) {
    const hit = PASSES.find((p) => p.reason === name || p.id === name);
    if (!hit) throw new TypeError(`queue-pull: omit: unknown reason or pass id: ${name}`);
    if (hit.kind === 'setup') throw new TypeError(`queue-pull: omit: a setup pass cannot be omitted: ${name}`);
    ids.add(hit.id);
  }
  return ids;
}

// Walks a registry in array order, running each id once at its first entry. ctx carries
// { deps, paths, options, omit?: Set of ids, runners?: { [id]: fn } }; an absent omit is the
// empty set, so every pass runs in full.
function runPasses(passes, ctx) {
  const runners = ctx.runners || RUNNERS;
  const passCtx = { ...ctx, omit: ctx.omit ?? new Set() };
  const seen = new Set();
  try {
    for (const pass of passes) {
      if (seen.has(pass.id)) continue;
      seen.add(pass.id);
      const runner = runners[pass.id];
      if (typeof runner !== 'function') throw new Error(`queue-pull: pass not implemented: ${pass.id}`);
      if (ctx.deps.onPass) ctx.deps.onPass(pass.id);
      runner(passCtx);
    }
  } catch (err) {
    // #5304: a stop before the claim line prints (the neighbour pass stops before it, or never ran) still prints the shipped claims read so far, once.
    if (ctx.state && !ctx.state.claimLineReported) reportClaimReadFailures(ctx, ctx.state.neighbourUnreadable);
    throw err;
  }
}

// A gh call bounded by GH_BATCH_TIMEOUT_MS rather than GH_TIMEOUT_MS: an aliased GraphQL batch, or
// a paginated list call (`issue list` / `pr list` with --limit above 100, or a `pr list` asking for
// `files`), the #4815 batched-call precedent.
function isBatchGhCall(args) {
  if (args.includes('graphql')) return true;
  if (args[1] !== 'list' || (args[0] !== 'issue' && args[0] !== 'pr')) return false;
  const at = args.indexOf('--limit');
  const json = args.indexOf('--json');
  const fields = json >= 0 ? String(args[json + 1]).split(',') : [];
  return (at >= 0 && Number(args[at + 1]) > 100) || (args[0] === 'pr' && fields.includes('files'));
}

// dispatch-unlanded-blockers.js's PREFLIGHT_TIMEOUT_MS (300 s, the longest bound any CLI spawned here sets) plus a 5 s margin.
const CLI_TIMEOUT_MS = 300000 + 5000;

// A spawn result's stderr with a spawn error or a killing signal appended, as cross-repo-states.js's
// failureCause names them, so a Warning or stop line that quotes the stderr never ends empty.
function spawnStderr(r) {
  const stderr = r.stderr || '';
  const cause = r.error ? (r.error.message || String(r.error)) : (r.signal ? `signal ${r.signal}` : '');
  if (!cause) return stderr;
  return `${stderr}${stderr && !stderr.endsWith('\n') ? '\n' : ''}${cause}\n`;
}

// seams: { execFileSync, spawnSync }, test-only stand-ins for the two child_process calls below, so
// a test can read the options each call gets without spawning anything.
function defaultDeps(seams = {}) {
  const execFileImpl = seams.execFileSync || execFileSync;
  const spawnImpl = seams.spawnSync || spawnSync;
  return {
    run(cmd, args, opts = {}) {
      if (cmd === 'gh') {
        const timeout = isBatchGhCall(args) ? GH_BATCH_TIMEOUT_MS : GH_TIMEOUT_MS;
        return execFileImpl('gh', args, ghOptions(args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout, windowsHide: true, ...opts }));
      }
      return execFileImpl(cmd, args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout: GIT_TIMEOUT_MS, windowsHide: true, ...opts });
    },
    spawnCli(name, args, { cwd, env } = {}) {
      const r = spawnImpl(process.execPath, [path.join(BIN_DIR, name), ...args], { encoding: 'utf8', cwd, env, timeout: CLI_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true });
      return { status: r.status, stdout: r.stdout || '', stderr: spawnStderr(r) };
    },
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    now: () => new Date(),
    queueOrder: {
      readOrder: (...a) => require('./queue-order').readOrder(...a),
      writeOrder: (...a) => require('./queue-order').writeOrder(...a),
    },
    createClaimReader: (...a) => require('../issues/claim-store').createClaimReader(...a),
    expressQueuePolicy: (...a) => require('../express/queue').expressQueuePolicy(...a),
    readDriverRunner,
    // #5584, the named path (admitNamed). A failed or unparseable fetch reads as null.
    fetchRecord(ctx, number) {
      const r = ghRun(ctx, ['issue', 'view', String(number), '--json', NAMED_FIELDS], { quiet: true });
      if (!r.ok) return null;
      try { return JSON.parse(r.stdout); } catch { return null; }
    },
    buildAuthority: resolveBuildAuthority,
    readTypedCommand: (...a) => require('../issues/typed-command').readTypedCommand(...a),
    appendDecision({ runDir, text, now = new Date() }) {
      const { appendEntry, formatEntry } = require('../log-decision/append');
      appendEntry({ runDir, section: '/dispatch', entry: formatEntry({ status: 'AUTO', now, step: 'queue pull', text, reversibility: 'n/a' }) });
    },
    foreignDeps: {},
    onPass: null,
  };
}

// Runs the pull: every registry pass has a runner.
function queuePull(options = {}, deps = {}) {
  const ctx = makeContext(options, deps);
  const { paths } = ctx;
  runPasses(PASSES, ctx);
  const groupsFile = paths['dispatch-groups.json'];
  const groupsText = readTextOrNull(groupsFile);
  const groups = groupsText === null ? [] : JSON.parse(groupsText);
  return { groups, exclusions: readExclusions(paths['dispatch-exclusions.json']) };
}

// ---- the `next` ranking (next-ranking.md's fence), expression for expression ------------------
// Pure: camelCase input, as the queue pull writes it (it aliases MCP timestamps before writing
// dispatch-groups.json). A snake_case pool is aliased by the caller, never in here.
const RANK = { high: 0, medium: 1, low: 2 };
const bandOf = (r) => (r.facets.priority ? RANK[r.facets.priority] : 3);

// The exclusion reasons whose records stay IN dispatch-groups.json: every PASSES exclusion row
// with removes: false. A removing reason never needs listing, since its records are already gone
// from the groups. drive.js --budget's pre-screen (driver/budget.js) leaves these groups alone.
const STAYING_EXCLUSION_REASONS = Object.freeze([...new Set(PASSES.filter((p) => p.kind === 'exclusion' && !p.removes).map((p) => p.reason))]);
// What the ranking skips: the staying reasons plus `firing`, which the Loop appends between pulls
// and no pass writes. next-ranking.md's fence spells the same four as a literal;
// queue-pull.test.js pins this list to exactly that set.
const RANK_SKIP_REASONS = Object.freeze([...STAYING_EXCLUSION_REASONS, 'firing']);

// groups: arrays of records; exclusionEntries: dispatch-exclusions.json's entries. Returns the
// best eligible group, or null.
function rankNext(groups, exclusionEntries, { priority } = {}) {
  const eligibleGroups = groups.filter((g) => !groupIsExcluded(g, exclusionEntries, RANK_SKIP_REASONS));
  const representative = (g) => g.slice().sort((a, b) =>
    bandOf(a) - bandOf(b) || new Date(a.createdAt) - new Date(b.createdAt))[0];
  const priorityFilter = priority || null;
  let candidates = eligibleGroups.map((g) => ({ group: g, rep: representative(g) }));
  if (priorityFilter) candidates = candidates.filter((c) => c.rep.facets.priority === priorityFilter);
  const ranked = candidates
    .sort((x, y) => bandOf(x.rep) - bandOf(y.rep) || new Date(x.rep.createdAt) - new Date(y.rep.createdAt));
  return ranked.length ? ranked[0].group : null;
}

// The script runs `node ... > "$DISPATCH_NEXT_PICK"`, so the shell truncates the pick file before
// node starts: a missing or malformed dispatch-groups.json (node's require() throws) leaves an
// EMPTY pick file, never the previous iteration's pick. This writes the empty file first for the
// same effect, then reads dispatch-groups.json (a missing or malformed file throws) and
// dispatch-exclusions.json (absent or unreadable reads as [] via readExclusions), and writes the
// pick -- or null -- as console.log would.
function rankFromFiles({ sessionId, priority } = {}) {
  const paths = sessionPaths(sessionId);
  fs.writeFileSync(paths['dispatch-next-pick.json'], '');
  const groups = readJson(paths['dispatch-groups.json']);
  const pick = rankNext(groups, readExclusions(paths['dispatch-exclusions.json']), { priority });
  fs.writeFileSync(paths['dispatch-next-pick.json'], JSON.stringify(pick) + '\n');
  return pick;
}

module.exports = {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, END_WRITTEN_FILES, sessionPaths, QueuePullStopped, runPasses, resolveOmit, defaultDeps, makeContext, queuePull, rankNext, rankFromFiles,
  STAYING_EXCLUSION_REASONS, RANK_SKIP_REASONS, closedDependencyNumbers,
};
