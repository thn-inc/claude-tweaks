'use strict';

// #5227: the module port of dispatch's queue-pull script -- the ```bash fence in
// plugin/skills/dispatch/queue-pull-script.md that starts at the `DISPATCH_QUEUE_RAW=` line.
// This file holds the registry, the session paths, the pass loop and the passes ported so far.
//
// R6, step-for-step port: each fence step is one function. A throw inside a step is caught and
// printed to stderr as `queue-pull: <step>: <message>`, and the run then continues or stops
// exactly where the fence has an RC check or a `grep -q 'appendExclusion:'` check. Stop and
// Warning texts are copied from the fence byte for byte. The module reproduces the fence's
// behavior, including behavior that looks wrong; a defect found while porting goes to the run
// ledger and is never fixed here.
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
// `malformed-blocker` and `unlanded-blocker` share `id: 'blocker-landing'`, because one
// dispatch-unlanded-blockers.js call writes both; they carry one identical failOpen. A shared id
// runs once, at its first entry.
//
// `omit` (queuePull option) takes reasons or ids and removes that pass's own filtering and
// appends and nothing else, with one exception: omitting either blocker-landing reason skips the
// shared call, so both reasons. runPasses ALWAYS calls every pass's runner and exposes the omit
// set as `ctx.omit` (a Set of ids); each runner skips only its own filtering and appends when
// `ctx.omit.has(<its id>)` and runs its shared steps regardless (for example `oversized` owns the
// grouping block that writes dispatch-groups.json and the `blocked` appends, and `target-missing`
// owns the integration-branch and run-dir resolution). Omitting a setup pass, or naming an
// unknown reason or id, throws TypeError. Omit is a test-only contract (no shipped caller passes
// it); because an omitted pass leaves groups the cache blob would then misdescribe, the write-back
// pass writes nothing (no writeOrder call) whenever the omit set is non-empty.
//
// PF6: failOpen is taken across both transports, so a gh-only reader sees `stop` for a pass whose
// gh fetch fails open (neighbour-in-flight): on `files`, a missing or malformed in-flight or
// claims file stops the pull.
//
// Test-only seam: when QP_TMPNAME_COUNTER_FILE is set, defaultDeps().tmpName reads that file's
// integer (a missing file is 0; a non-integer or negative value is refused, as the oracle's
// mktemp shim refuses it), creates `tmp.qp<8-digit counter+1>` exclusively, and only then writes
// the counter back, so a failed create does not advance it. The parity CLI is
// a subprocess and cannot take an injected function, and the oracle's mktemp shim implements the
// same format over the same variable, so both sides emit identical names. Production never sets it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const { readExclusions, appendExclusion, groupIsExcluded } = require('./exclusions');
const { writeReleaseTimes, readReleaseTimes } = require('./shipped-releases');
const { buildFreshnessSignal, cacheUsable, composeOrderBlob } = require('./queue-order');
const { aliasMcpTimestamps } = require('../issues/mcp-issue-shape');
const { parseRecordFacets, parseDependencies, partitionByOpenBodyBlockers, openBlockerRefs } = require('../issues/record');
const { bodyForeignBlockers } = require('../issues/cross-repo-states');
const { shapeGate } = require('../issues/materialize-format');
const { namedTarget } = require('../issues/named-target');
const { classifyShipped, predatesClaimRelease } = require('../issues/shipped-candidate');
const { extractKeyFiles, expectsKeyFilesSection, buildDispatchGroups, partitionGroupsBySizeGuard } = require('../issues/grouping');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { sessionTmpPath } = require('../session-tmp');
const { ghOptions } = require('../repo-resolve');
const { lstatType } = require('../path-guard');
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

// Fence lines 50-55. The only direct write to the exclusions file; every later pass appends
// through appendExclusion. Keeps only the 'firing' entries (firing-exclusion.md).
function runTruncate(ctx) {
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

// fence line 75, byte for byte
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
  const r = spawnCli(ctx, 'resolve-policy.js', ['--values', key], 'policy');
  forward(ctx, r, { stdout: false });
  return trimNl(r.stdout);
}

// A fence redirect or echo that fails does not stop the fence (R6): the write is a step.
const put = (ctx, file, content) => step(ctx, `write ${path.basename(file)}`, () => fs.writeFileSync(file, content));

// alias_mcp_timestamps (fence 61-69): the camelCase keys added in place. D3: a non-array file is
// silently rewritten as [].
function aliasFile(ctx, name, file) {
  return step(ctx, name, () => fs.writeFileSync(file, JSON.stringify(aliasMcpTimestamps(readJson(file)))));
}

// The `gh issue list --search "#a #b" --state all ...` dependency-freshness fetch (fence 104, 275):
// stderr dropped, any failure writes [].
function fetchDepFreshness(ctx, numbersCsv, file) {
  const search = numbersCsv.split(',').join(' ').replace(/[0-9]+/g, '#$&');
  const r = ghRun(ctx, ['issue', 'list', '--search', search, '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'], { quiet: true });
  put(ctx, file, r.ok ? r.stdout : '[]');
}

// The two exclusion-append loops the hit and miss paths share.
function appendBlocked(file, entries) {
  for (const e of entries) appendExclusion(file, { reason: 'blocked', records: [e.number], detail: { blockedBy: e.blockedBy } });
}
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
    standaloneDir: '',
    integrationBranch: '',
    integrationRef: '',
    files: {
      queueRaw: pick(inputs.queueRaw, 'dispatch-queue-raw.json'),
      depFreshness: pick(inputs.depFreshness, 'dispatch-dep-freshness.json'),
      openNumbers: pick(inputs.openNumbers, 'dispatch-open-numbers.json'),
      verifiedOpenDeps: pick(inputs.verifiedOpenDeps, 'dispatch-verified-open-deps.txt'),
    },
  };
  return { options, deps: merged, paths, omit, state };
}

// Fence 71-151, then line 155 and the policy reads of 156-158 on a miss: the queue pull, the
// aliasing, the 500-cap Warning, the dependency-freshness fetch and the cache check. On a hit it
// has written dispatch-groups.json; the blocked and oversized passes replay the rest.
function runFetch(ctx) {
  const { deps, paths, state } = ctx;
  const f = state.files;
  const onGh = ctx.options.transport !== 'files';

  if (onGh) put(ctx, f.queueRaw, ghRun(ctx, QUEUE_ARGV).stdout);
  aliasFile(ctx, 'alias-queue', f.queueRaw);
  const count = step(ctx, 'queue-count', () => readJson(f.queueRaw).length);
  if (count.ok && count.value >= 500) deps.stderr(`${QUEUE_CAP_WARNING}\n`);

  const depNumbers = step(ctx, 'dep-numbers', () => {
    const persisted = deps.queueOrder.readOrder(rootOf(ctx));
    if (!persisted) return '';
    const autoBuildNumbers = new Set(readJson(f.queueRaw).map((i) => i.number));
    const depOnly = (persisted.freshnessSignal.issues || []).filter((i) => !autoBuildNumbers.has(i.number));
    return depOnly.map((i) => i.number).join(',');
  }).value || '';
  if (onGh) put(ctx, f.depFreshness, '[]');
  put(ctx, paths['dispatch-fastlane-bundles.json'], '[]');
  if (onGh && depNumbers) fetchDepFreshness(ctx, depNumbers, f.depFreshness);
  aliasFile(ctx, 'alias-dep-freshness', f.depFreshness);

  // The size guard is read for the cache check whether or not a blob exists (fence line 107).
  state.groupSizeGuard = readPolicy(ctx, 'dispatch-group-size-guard');
  try {
    const persisted = deps.queueOrder.readOrder(rootOf(ctx));
    if (persisted) {
      const current = buildFreshnessSignal([...readJson(f.queueRaw), ...readJson(f.depFreshness)]);
      if (cacheUsable(persisted, current, deps.expressQueuePolicy({ stderr: deps.stderr }).grouping)) {
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

// Fence 159-205 on a miss (the eligible list, the unresolved-dependency check, the body-text and
// native blocker filtering); on a hit the persisted `excluded` entries replayed as 'blocked'.
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

  step(ctx, 'eligible-pre-dep', () => {
    const issues = readJson(f.queueRaw);
    const openNumbers = new Set(readJson(f.openNumbers).map((i) => i.number));
    const eligiblePreDep = issues
      .map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))
      .filter((i) => i.facets.grants.build && !i.facets.bot.inProgress && !i.facets.bot.blocked && !i.facets.bot.parked);
    // '--limit 200' can truncate the open-issues pull: a dependency absent from it is
    // unresolved, not closed, and is checked live below.
    const unresolved = [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)).filter((dep) => !openNumbers.has(dep)))];
    fs.writeFileSync(paths['dispatch-eligible-pre-dep.json'], JSON.stringify(eligiblePreDep));
    fs.writeFileSync(paths['dispatch-unresolved-deps.json'], JSON.stringify(unresolved));
  });

  if (!skip && ctx.options.transport !== 'files') {
    step(ctx, 'verified-open-deps', () => {
      fs.writeFileSync(f.verifiedOpenDeps, '');
      const unresolved = readJson(paths['dispatch-unresolved-deps.json']).join(' ').split(/\s+/).filter(Boolean);
      for (const dep of unresolved) {
        const r = ghRun(ctx, ['issue', 'view', dep, '--json', 'state', '-q', '.state'], { quiet: true });
        if (trimNl(r.stdout) === 'OPEN') fs.appendFileSync(f.verifiedOpenDeps, `${dep}\n`);
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
    let verifiedOpen = [];
    try {
      verifiedOpen = fs.readFileSync(f.verifiedOpenDeps, 'utf8').trim().split('\n').filter(Boolean).map(Number);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    for (const dep of verifiedOpen) openNumbers.add(dep);
    // #4793: a supplied states file (either transport) answers the foreign refs; the rest go to
    // resolve-foreign-blockers.js through the library's own bounded spawn (tests inject
    // deps.foreignDeps.spawn).
    const foreign = bodyForeignBlockers(eligiblePreDep, {
      statesFile: state.foreignStates,
      stderr: deps.stderr,
      ...deps.foreignDeps,
    });
    const { eligible, excluded } = partitionByOpenBodyBlockers(eligiblePreDep, openNumbers, foreign);
    fs.writeFileSync(paths['dispatch-eligible.json'], JSON.stringify(eligible));
    fs.writeFileSync(paths['dispatch-blocked-excluded-body.json'], JSON.stringify(excluded));
  });

  put(ctx, paths['dispatch-native-deps.json'], '{}');
  if (!skip && state.workLinks === 'native') {
    step(ctx, 'native-deps', () => {
      const nativeNums = readJson(paths['dispatch-eligible.json']).map((i) => i.number).join(',');
      if (!nativeNums) return;
      const r = deps.spawnCli('resolve-blockers.js', [nativeNums], cliOpts(ctx));
      fs.writeFileSync(paths['dispatch-native-deps.tmp.json'], r.stdout || '');
      fs.writeFileSync(paths['dispatch-native-deps.err'], r.stderr || '');
      if (r.status === 0) {
        fs.renameSync(paths['dispatch-native-deps.tmp.json'], paths['dispatch-native-deps.json']);
      } else {
        deps.stderr(`Warning: native dependency query failed — falling back to no native filtering this run: ${trimNl(r.stderr)}\n`);
      }
    });
  }
}

// Fence 206-258 on a miss: the grouping block, which writes dispatch-groups.json, then the
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
      const refs = dep ? openBlockerRefs(dep) : [];
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

// Fence 266-303, the cache-miss path only: the dependency-freshness refetch over every eligible
// record's dependencies, then the best-effort write-back of the queue-order blob.
function runWriteBack(ctx) {
  const { deps, paths, state } = ctx;
  if (state.cacheHit) return;
  const f = state.files;
  const onGh = ctx.options.transport !== 'files';

  const allDeps = step(ctx, 'all-dep-numbers', () => {
    const eligiblePreDep = readJson(paths['dispatch-eligible-pre-dep.json']);
    return [...new Set(eligiblePreDep.flatMap((i) => parseDependencies(i.body)))].join(',');
  }).value || '';
  if (onGh) put(ctx, f.depFreshness, '[]');
  if (onGh && allDeps) fetchDepFreshness(ctx, allDeps, f.depFreshness);
  aliasFile(ctx, 'alias-dep-freshness', f.depFreshness);

  if (ctx.omit.size > 0) return; // an omitted pass leaves groups the blob would misdescribe
  step(ctx, 'write-back', () => {
    const root = rootOf(ctx);
    const autoBuild = readJson(f.queueRaw);
    const depFreshness = readJson(f.depFreshness);
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
      freshnessSignal, groups, excluded, bundles, grouping: deps.expressQueuePolicy({ stderr: deps.stderr }).grouping,
    });
    const result = deps.queueOrder.writeOrder(root, blob);
    if (!result.ok) deps.stderr(`Queue-order cache write-back failed (non-blocking): ${result.error}\n`);
  });
}

// ---- Task 4: not-spec-shaped, open-pr, target-missing and shipped ------------------------------

// The text this module quotes where the fence prints `$(cat $ERR_FILE)`. The fence's file holds
// Node's uncaught-exception report: a header (a throw-site file:line, or a node:internal loader
// line, depending on the Node version) that err.stack does not carry, then the error text and a
// stack. This is the thrown message only, so those four lines differ from the oracle's after
// their fixed prefix (controller ruling, Task 4 review; the parity suite compares the prefix).
const errText = (err) => String(err && err.message != null ? err.message : err);

// The options a runner call carries: the context's cwd and env, no undefined keys.
function runOpts(ctx, extra = {}) {
  const opts = { ...cliOpts(ctx), ...extra };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  return opts;
}

// A fence CLI call: a spawn that throws reads as a failed call with no output, noted as
// `queue-pull: <label>: <message>` (label defaults to the CLI name).
function spawnCli(ctx, name, args, label = name) {
  try {
    const r = ctx.deps.spawnCli(name, args, cliOpts(ctx));
    return { status: r && r.status, stdout: (r && r.stdout) || '', stderr: (r && r.stderr) || '' };
  } catch (err) {
    ctx.deps.stderr(`queue-pull: ${label}: ${errText(err)}\n`);
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

// The node block of an exclusion pass whose stderr the fence redirects into `errFile` (fence 308,
// 352): the file keeps the failure text. Returns the failure text, or null on success.
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

// Fence 307-336. Keeps a candidate only when its cached body passes the Materialization gate.
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

// Fence 338-382. The linked-PR query is shared setup (the shipped pass reads its mentions); only the
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
      deps.stderr(`Warning: linked-PR query failed — falling back to no open-PR exclusion this run: ${trimNl(r.stderr)}\n`);
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

// `git remote show origin | sed -n '/HEAD branch/s/.*: //p'` (fence 393): a failed git still hands
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
    `gh issue comment ${num} --body "Closing: the named target ${tpath} no longer exists at ${ref} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull)."`,
    `gh issue close ${num} --reason "not planned"`,
  ].map((l) => `${l}\n`).join('');
}

// Fence 384-466. PF10: the run-dir and integration-branch resolution (385-395) is shared setup and
// runs whether or not this pass is omitted; later passes read state.integrationBranch.
function runTargetMissing(ctx) {
  const { deps, paths, omit, state } = ctx;
  // Fence 385: `$(node hooks.js resolve-run-dir ...)` captures stdout; its stderr stays on the terminal.
  const runDirCall = spawnCli(ctx, 'hooks.js', ['resolve-run-dir', '--spec-slug', 'dispatch-standalone']);
  forward(ctx, runDirCall, { stdout: false });
  state.standaloneDir = trimNl(runDirCall.stdout);
  let branch = readPolicy(ctx, 'integration-branch');
  if (!branch) branch = remoteHeadBranch(ctx);
  state.integrationBranch = branch;
  const ref = `origin/${branch}`;
  state.integrationRef = ref;
  const exclusions = paths['dispatch-exclusions.json'];

  if (!omit.has('target-missing')) {
    step(ctx, 'named-targets', () => {
      const named = readJson(paths['dispatch-groups.json']).flat()
        .map((c) => ({ number: c.number, target: namedTarget(c) }))
        .filter((c) => c.target);
      fs.writeFileSync(paths['dispatch-named-targets.json'], JSON.stringify(named));
    });
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
    // The mktemp file is extensionless, so stage-item.js names the staged item after its random
    // suffix (ledger row 2). Reproduced, never normalized.
    const tmp = step(ctx, 'mktemp', () => deps.tmpName());
    if (tmp.ok) put(ctx, tmp.value, targetMissingProposal(number, tpath, ref));
    forward(ctx, spawnCli(ctx, 'stage-item.js', ['--run', state.standaloneDir, '--id', `dispatch-target-missing-${number}`, '--file', tmp.ok ? tmp.value : '']));
  }
}

// The claim reader writeReleaseTimes asks for, built only when a candidate has a merged mention.
function lazyClaimReader(ctx) {
  let reader = null;
  return { read: (n) => { if (!reader) reader = ctx.deps.createClaimReader(); return reader.read(n); } };
}

// Fence 551-580: one Close proposal per strong-tier exclusion, staged into the firing's own run dir.
function stageShippedProposals(ctx) {
  const { paths } = ctx;
  const runDir = trimNl(spawnCli(ctx, 'hooks.js', ['resolve-run-dir', '--spec-slug', 'dispatch-standalone']).stdout);
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

// Fence 468-580. Omitting the pass skips its classification, probes, exclusions and staging.
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

  // First pass: title-only classification; only a `weak` result not predating the claim release is
  // probed for the files-based upgrade, capped at 5 live `gh pr view` calls per pull.
  step(ctx, 'shipped-probe', () => {
    const groups = readJson(paths['dispatch-groups.json']);
    const linkedPRs = readJson(linkedFile);
    const releases = writeReleaseTimes(releasesFile, groups.flat(), linkedPRs, { log: (line) => deps.stderr(`${line}\n`), reader: lazyClaimReader(ctx) });
    const toProbe = [];
    for (const c of groups.flat()) {
      const entry = linkedPRs[c.number];
      const mentions = (entry && entry.mentions) || [];
      if (mentions.length === 0) continue;
      const result = classifyShipped(c, mentions, { lastReleasedAt: releases[c.number] });
      if (result.tier === 'weak' && !predatesClaimRelease(result)) toProbe.push(result.pr);
    }
    fs.writeFileSync(probeFile, JSON.stringify([...new Set(toProbe)].slice(0, 5)));
  });

  put(ctx, prFilesFile, '');
  const probePrs = step(ctx, 'shipped-probe-list', () => readJson(probeFile).join(' ').split(/\s+/).filter(Boolean)).value || [];
  for (const pr of probePrs) {
    // `2>/dev/null || echo '[]'`: a failed fetch prints nothing and reads as [].
    const r = ghRun(ctx, ['pr', 'view', pr, '--json', 'files', '-q', '[.files[].path]'], { quiet: true });
    const filesJson = trimNl(r.ok ? r.stdout : `${r.stdout}[]\n`);
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
      const result = classifyShipped(c, mentions, { prFiles, lastReleasedAt: releases[c.number] });
      if (result.tier === 'strong') {
        appendExclusion(paths['dispatch-exclusions.json'], { reason: 'shipped', records: [c.number], detail: { pr: result.pr, signals: result.signals } });
        deps.stderr(`AUTO — dispatch: #${c.number} excluded, shipped by merged PR #${result.pr} (${result.signals.join(', ')})\n`);
        return false;
      }
      if (result.tier === 'weak') {
        deps.stderr(`AUTO — dispatch: #${c.number}${predatesClaimRelease(result)
          ? ` kept: merged PR #${result.pr} predates claim release at ${releases[c.number]} — remaining work assumed`
          : ` mentioned by merged PR #${result.pr} without a closing keyword; dispatching anyway`}\n`);
      }
      return true;
    };
  }));
  // #3110: this pass's shipped-candidate exclusions may be only partially written.
  if (!second.ok) throw new QueuePullStopped('dispatch: queue-pull stopped -- shipped-candidate exclusion pass failed; see error above.');

  stageShippedProposals(ctx);
}

const RUNNERS = {
  truncate: runTruncate, fetch: runFetch, blocked: runBlocked, oversized: runOversized, 'write-back': runWriteBack,
  'not-spec-shaped': runNotSpecShaped, 'open-pr': runOpenPr, 'target-missing': runTargetMissing, shipped: runShipped,
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
// { deps, paths, options, omit?: Set of ids, runners?: { [id]: fn } }.
function runPasses(passes, ctx) {
  const runners = ctx.runners || RUNNERS;
  const seen = new Set();
  for (const pass of passes) {
    if (seen.has(pass.id)) continue;
    seen.add(pass.id);
    const runner = runners[pass.id];
    if (typeof runner !== 'function') throw new Error(`queue-pull: pass not implemented: ${pass.id}`);
    if (ctx.deps.onPass) ctx.deps.onPass(pass.id);
    runner(ctx);
  }
}

function tmpName() {
  const counterFile = process.env.QP_TMPNAME_COUNTER_FILE;
  let base;
  if (counterFile) {
    let stored = null;
    try { stored = fs.readFileSync(counterFile, 'utf8'); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    const n = stored === null ? 0 : Number(stored);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`queue-pull: tmpName: counter file holds ${JSON.stringify(stored)}`);
    const file = path.join(os.tmpdir(), `tmp.qp${String(n + 1).padStart(8, '0')}`);
    fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(counterFile, String(n + 1));
    return file;
  } else {
    const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    base = 'tmp.' + Array.from(crypto.randomBytes(10), (b) => alnum[b % alnum.length]).join('');
  }
  const file = path.join(os.tmpdir(), base);
  fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  return file;
}

function defaultDeps() {
  return {
    run(cmd, args, opts = {}) {
      if (cmd === 'gh') {
        const timeout = args.includes('graphql') ? GH_BATCH_TIMEOUT_MS : GH_TIMEOUT_MS;
        return execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout, windowsHide: true, ...opts }));
      }
      return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, timeout: GIT_TIMEOUT_MS, windowsHide: true, ...opts });
    },
    spawnCli(name, args, { input, cwd, env } = {}) {
      const r = spawnSync(process.execPath, [path.join(BIN_DIR, name), ...args], { encoding: 'utf8', input, cwd, env, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true });
      return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    },
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    now: () => new Date(),
    tmpName,
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    queueOrder: {
      readOrder: (...a) => require('./queue-order').readOrder(...a),
      writeOrder: (...a) => require('./queue-order').writeOrder(...a),
    },
    createClaimReader: (...a) => require('../issues/claim-store').createClaimReader(...a),
    expressQueuePolicy: (...a) => require('../express/queue').expressQueuePolicy(...a),
    foreignDeps: {},
    onPass: null,
  };
}

// Runs the pull. The passes through shipped have runners so far; any other pass throws `queue-pull: pass not implemented: <id>`.
function queuePull(options = {}, deps = {}) {
  const ctx = makeContext(options, deps);
  const { paths } = ctx;
  runPasses(PASSES, ctx);
  const groupsFile = paths['dispatch-groups.json'];
  const groups = lstatType(groupsFile).type === 'missing' ? [] : JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
  return { groups, exclusions: readExclusions(paths['dispatch-exclusions.json']) };
}

module.exports = {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, sessionPaths, QueuePullStopped, runPasses, resolveOmit, defaultDeps, makeContext, queuePull,
};
