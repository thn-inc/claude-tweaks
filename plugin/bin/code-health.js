#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { fingerprint } = require('./lib/code-health/fingerprint');
const {
  cachePath, readCache, writeCache, computeChurn, createDurable, buildValidateFindingsUpdate,
} = require('./lib/code-health/cache');
const { lstatType, resolveWithin } = require('./lib/path-guard');
const { decide, RISK_RANK } = require('./lib/code-health/dedup');
const { computeRisk } = require('./lib/code-health/risk');
const { validateFindingV2, applyConfidenceFloor } = require('./lib/code-health/validate-finding');
const { toIssuePayloadV2 } = require('./lib/code-health/issue-payload');
const { resolveReadCommit } = require('./lib/health-core/read-commit');
const { getCriterion } = require('./lib/code-health/criteria');
const { classifyArea } = require('./lib/code-health/area-type');
const { listSlices, contentHash, selectSlice, sliceRecursive } = require('./lib/code-health/scope');
const { DEFAULT_IO, makeExec, resolveAgainst } = require('./lib/health-core/io');
const { makeRetryQueueCommands } = require('./lib/health-core/retry-cli');
const { loadIssueIndex } = require('./lib/health-core/issue-index');
const { selectBudget } = require('./lib/health-core/budget');
const { makeCmdChurnReport } = require('./lib/health-core/churn-report');

const TOOL_NAME = 'code-health';
const FAIL_ON_VALUES = new Set(['regressed', 'risk-high']);
// Why `status --fail-on` refuses to evaluate (exit 2) rather than pass on an untrusted cache.
const FAIL_ON_REFUSAL = Object.freeze({
  missing: 'no cache file (no sweep has written one under this root)',
  notRegular: 'not a regular file inside the checkout',
  unreadable: 'not a readable code-health cache',
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Strict read of the local cache for the --fail-on gate: unlike readCache, a missing,
// non-regular, escaping or malformed cache is a refusal, never an empty cache.
// The cache is found at a path no caller names and decides a pass/fail verdict, so the
// lookup is a trust decision (#5529): any symlink is refused, even one that stays
// inside the checkout — one regular-file rule, no cases to argue about.
function readGateCache(root) {
  const p = cachePath(root);
  const refuse = (key) => ({ ok: false, path: p, reason: FAIL_ON_REFUSAL[key] });
  const t = lstatType(p).type;
  if (t === 'missing') return refuse('missing');
  if (t === 'unreadable') return refuse('unreadable');
  if (t !== 'file') return refuse('notRegular');
  // lstat sees only the leaf; this catches a symlinked parent directory
  // (.claude-tweaks/code-health -> outside the checkout) that lstat reports as a plain file.
  const real = resolveWithin(p, root);
  if (real === null) return refuse('notRegular');
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(real, 'utf8'));
  } catch {
    return refuse('unreadable');
  }
  if (!isPlainObject(cache) || !Object.values(cache).every(isPlainObject)) return refuse('unreadable');
  return { ok: true, cache };
}

// cmdValidateFindings' --min-risk check — rejects a value that isn't a RISK_RANK key,
// prints an error naming the offending flag/command, and returns { ok: false, code: 2 }.
function validateRiskArg(value, { argName, cmdName, consequence }, stderr) {
  if (value == null) return { ok: true };
  if (Object.prototype.hasOwnProperty.call(RISK_RANK, value)) return { ok: true };
  stderr(
    `${cmdName}: --${argName} "${value}" is not a recognized risk tier ` +
    `(must be one of ${Object.keys(RISK_RANK).join('|')}) — ${consequence}\n`,
  );
  return { ok: false, code: 2 };
}

function parseArgs(argv, cwd = process.cwd()) {
  const args = { _: [], root: cwd, dryRun: false, runId: new Date().toISOString() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--area') args.area = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--slice') args.slice = argv[++i];
    else if (a === '--fail-on') args['fail-on'] = argv[++i];
    else if (a === '--fail-on-high-churn') args['fail-on-high-churn'] = argv[++i];
    else if (a === '--min-risk') args['min-risk'] = argv[++i];
    else if (a === '--budget') args.budget = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

function cmdStatus(args, ctx) {
  const root = args.root || ctx.cwd();
  const failOn = args['fail-on'];
  // `in`, not `failOn != null`: a bare trailing `--fail-on` parses to undefined and must
  // refuse like any other unrecognized value, never fall through to plain status.
  if ('fail-on' in args && !FAIL_ON_VALUES.has(failOn)) {
    ctx.stderr(
      `status: --fail-on "${failOn ?? ''}" is not a recognized value ` +
      `(must be one of ${[...FAIL_ON_VALUES].join('|')}) — an unrecognized value silently disables ` +
      'the gate (always exits 0) regardless of how many regressed/risk-high findings actually exist.\n',
    );
    return 2;
  }

  let cache;
  if (failOn) {
    const gate = readGateCache(root);
    if (!gate.ok) {
      ctx.stderr(`status: --fail-on cannot evaluate: ${gate.path}: ${gate.reason}\n`);
      return 2;
    }
    cache = gate.cache;
  } else {
    cache = readCache(root);
  }
  const findings = Object.values(cache);
  const counts = {
    open: findings.filter((f) => f.status === 'open').length,
    regressed: findings.filter((f) => f.status === 'regressed').length,
    closed: findings.filter((f) => f.status === 'closed').length,
    wontfix: findings.filter((f) => f.status === 'wontfix').length,
    // A regressed finding is a previously-closed GitHub issue that
    // validate-findings just reopened — i.e. currently open and unresolved,
    // exactly as live as an 'open' one. Excluding it here would let
    // --fail-on risk-high silently pass while a high-risk issue sits open
    // in the tracker under status 'regressed'.
    riskHigh: findings.filter((f) => (f.status === 'open' || f.status === 'regressed') && f.risk === 'high').length,
  };

  // The `remembered` count is purely informational (sub-threshold, not yet
  // filed) — neither --fail-on gate branch below reads it, only the printed
  // summary line does. Computing it requires readDurableState's `git fetch
  // origin health-state`, which can take up to a 30s timeout when offline —
  // wasteful on every invocation of the documented CI/pre-push fast pass/fail
  // gate, for a value that gate never consults. Skip it in --fail-on mode;
  // a plain `status` invocation (informational, interactive) still fetches
  // and shows it.
  const remembered = failOn ? null : Object.keys(ctx.durable.readDurableState(root).remembered).length;
  const line = `open:${counts.open} regressed:${counts.regressed} closed:${counts.closed} ` +
    `wontfix:${counts.wontfix}` + (remembered != null ? ` remembered:${remembered}` : '') + '\n';

  if (failOn === 'regressed' && counts.regressed > 0) {
    ctx.stdout(`FAIL: ${counts.regressed} regressed finding(s)\n` + line);
    return 1;
  }
  if (failOn === 'risk-high' && counts.riskHigh > 0) {
    ctx.stdout(`FAIL: ${counts.riskHigh} open risk-high finding(s)\n` + line);
    return 1;
  }
  ctx.stdout(line);
  return 0;
}

function cmdValidateFindings(args, ctx) {
  const root = args.root || ctx.cwd();
  const seam = { env: ctx.env, stderr: ctx.stderr };
  // Resolved ONCE per run, right before filing — #117's freshness stamp
  // must reflect the commit this sweep actually read, not the moment each
  // finding's issue happens to be created.
  const verifiedAsOf = resolveReadCommit(root, makeExec(seam));
  const findingsPath = args._[1]; // positional after the subcommand name
  if (!findingsPath) {
    ctx.stderr(
      'usage: code-health.js validate-findings <findings.json> [--root <dir>] [--issues <file>] ' +
      '[--run-id <id>] [--slice <id>] [--min-risk <level>] [--dry-run]\n',
    );
    return 2;
  }

  if (!args.dryRun && !args.slice) {
    ctx.stderr(
      'validate-findings: --slice is required for a real (non-dry-run) run — without it, ' +
      'the round-robin cursor for this slice never persists and rotation state silently drifts. ' +
      'Pass --dry-run to preview without it.\n',
    );
    return 2;
  }

  const risk = validateRiskArg(args['min-risk'], {
    argName: 'min-risk',
    cmdName: 'validate-findings',
    consequence: 'an unrecognized value silently remembers every finding instead of filing it, including high-risk ones.',
  }, ctx.stderr);
  if (!risk.ok) return risk.code;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolveAgainst(ctx.cwd(), findingsPath), 'utf8'));
  } catch (err) {
    ctx.stderr(`validate-findings: could not read or parse findings file: ${findingsPath}\n`);
    return 1;
  }
  if (!Array.isArray(raw)) {
    ctx.stderr('validate-findings: findings file must contain a JSON array\n');
    return 1;
  }

  // 1. Validate every finding; drop malformed ones with a logged reason.
  const survivors = [];
  for (const f of raw) {
    const v = validateFindingV2(f);
    if (!v.ok) {
      ctx.stderr(
        `[code-health] validate-findings: dropped finding "${(f && f.title) || '?'}" ` +
        `(criterion ${(f && f.criterion) || '?'}, area ${(f && f.areaId) || '?'}): ` +
        `${v.errors.join('; ')}\n`,
      );
      continue;
    }
    // 1a. Confidence-floor gate: drop findings below the criterion's floor.
    const crit = getCriterion(v.value.criterion);
    const floorResult = applyConfidenceFloor(v.value, crit && crit.confidenceFloor);
    if (!floorResult.pass) {
      ctx.stderr(`[code-health] validate-findings: dropped "${v.value.title}" — ${floorResult.reason}\n`);
      continue;
    }
    // 2. Fingerprint from criterion + areaId + anchor, then compute risk (severity x likelihood — deterministic, not judged).
    const id = fingerprint({ criterion: v.value.criterion, areaId: v.value.areaId, anchor: v.value.anchor });
    const risk = computeRisk(v.value.severity, v.value.likelihood);
    survivors.push({ ...v.value, id, risk });
  }

  // 3. Dedup against the issue index and local cache.
  const cache = readCache(root);
  const issueIndex = loadIssueIndex(args.issues, TOOL_NAME, { stderr: ctx.stderr, cwd: ctx.cwd });
  // Durable twin of the local cache's wontfix suppressions (#171) — read
  // once, up front, so decide() can honor a wontfix suppression persisted on
  // an earlier firing even when this firing's local cache is empty (a fresh
  // scheduled-Routine container). Read unconditionally, including in
  // --dry-run mode, so a dry-run preview reflects the same suppression a
  // real run would apply. readDurableState/readState never throws (see
  // health-core/durable-state.js's "Reads never throw" comment) — an
  // unreachable health-state branch degrades to {} on its own, printing a
  // trace to stderr, same as every other durable-state read in this codebase.
  const durableDeclined = ctx.durable.readDurableState(root).declined || {};
  // Collected as raw candidates, not a pre-computed delta object — the
  // "already remembered, don't touch it" decision is made later, inside
  // writeDurableState's mutator (buildValidateFindingsUpdate), against
  // whatever state that CAS attempt actually fetched. Deciding it here
  // would need its own readDurableState(root) call purely to consult one
  // field (remembered[id]) — a second, redundant network fetch on top of
  // writeDurableState's own (and one that also runs even in --dry-run mode,
  // when nothing is written at all), reading a snapshot that could already
  // be stale by the time of the actual write.
  const rememberCandidates = [];
  const payloads = [];
  const seen = new Set();
  const wontfixSuppressed = [];
  for (const finding of survivors) {
    if (seen.has(finding.id)) continue; // intra-run dedup
    seen.add(finding.id);

    const decision = decide(finding, issueIndex, cache, { threshold: args['min-risk'] || 'high', durableDeclined });
    if (decision.action === 'suppress') {
      // A wontfix match is a standing decision meant to survive into gh-unavailable runs
      // (dedup.js's `cached.status === 'wontfix'` cache-only fallback depends on this write
      // existing — without it, that fallback path can never fire, and a wontfix'd finding can
      // get re-filed the next time gh is unreachable).
      cache[finding.id] = { status: 'wontfix', issue: decision.issue || null, severity: finding.severity, risk: finding.risk };
      // A fresh reading of a live `wontfix`-labelled issue (not already
      // durable) — persist it into the durable declined slice below so it
      // survives a later firing whose local cache is empty too (#171). The
      // cache-level and durable-level suppress branches carry no `reason`
      // (they're already durable/persisted; re-persisting is a no-op).
      if (decision.reason === 'wontfix-label') wontfixSuppressed.push(finding.id);
      continue;
    }
    if (decision.action === 'skip') continue;

    if (decision.action === 'file' || decision.action === 'reopen') {
      cache[finding.id] = decision.action === 'reopen'
        ? { status: 'regressed', issue: decision.issue || null, severity: finding.severity, risk: finding.risk }
        : { status: 'open', issue: null, severity: finding.severity, risk: finding.risk };
      payloads.push(toIssuePayloadV2(finding, verifiedAsOf));
    } else if (decision.action === 'remember') {
      rememberCandidates.push({ id: finding.id, severity: finding.severity, risk: finding.risk });
    }
  }

  // 4. Persist the local cache, then the durable cursor/run/remembered update
  // in one batched health-state write; a dry-run writes neither.
  if (!args.dryRun) {
    // Non-fatal, same as the writeDurableState block below: cache.json is
    // rebuildable from `gh issue list` (see cache.js's header comment), so a
    // write failure here (unwritable dir, read-only checkout, disk full)
    // must not crash the process before payloads are ever emitted on stdout —
    // an entire sweep's worth of already-judged, already-deduped findings
    // would otherwise be silently discarded on a local-persistence hiccup.
    try {
      writeCache(root, cache);
    } catch (err) {
      ctx.stderr(
        `[code-health] validate-findings: local cache write failed (non-fatal, payloads still emitted): ${err.message}\n`,
      );
    }
    try {
      const sliceId = args.slice;
      const areasSwept = sliceId ? [sliceId] : [];
      const hashes = sliceId ? { [sliceId]: contentHash(path.resolve(root, sliceId), null, { env: ctx.env, recursive: sliceRecursive(sliceId, root, seam) }) } : {};
      const runRecord = { runId: args.runId, runAt: new Date().toISOString(), fingerprints: [...seen] };
      // Named rather than inlined into the mutator call below, for readability.
      const mutatorInput = { areasSwept, hashes, rememberCandidates, runRecord, wontfixSuppressed };
      const result = ctx.durable.writeDurableState(root, (current) => buildValidateFindingsUpdate(current, mutatorInput));
      if (!result.ok) {
        ctx.stderr(
          `[code-health] validate-findings: health-state persistence failed after retries (non-fatal, payloads still emitted): ${result.error}\n`,
        );
      }
    } catch (err) {
      ctx.stderr(
        `[code-health] validate-findings: health-state persistence threw (non-fatal, payloads still emitted): ${err.message}\n`,
      );
    }
  }

  // 5. Emit gh-ready payloads on stdout.
  ctx.stdout(JSON.stringify(payloads, null, 2) + '\n');
  ctx.stderr(
    `[code-health] validate-findings ${args.runId || '?'}: ` +
    `${survivors.length} valid finding(s), ${payloads.length} payload(s) after dedup\n`,
  );
  return 0;
}

function cmdNextSlice(args, ctx) {
  const root = args.root || ctx.cwd();
  const budget = Number.isFinite(args.budget) && args.budget > 0 ? args.budget : 1;
  const cursors = ctx.durable.readDurableState(root).cursors;
  const seam = { env: ctx.env, stderr: ctx.stderr };
  const now = Date.now();
  // Shared across every selectSlice call in this one CLI invocation (and the
  // final buildCursorPatch hash below) — on-disk content can't change during
  // a single invocation, so a slice's source files only need to be read (and
  // hashed) once, not once per budget iteration plus once more for the
  // picked slice's cursor-patch hash. See scope.js's selectSlice/contentHash
  // fileDataCache doc comments.
  const fileDataCache = new Map();

  if (budget === 1) {
    const slice = selectSlice(root, cursors, { now, fileDataCache, ...seam });
    ctx.stdout(JSON.stringify(slice, null, 2) + '\n');
    return 0;
  }

  // Budget > 1: pick up to `budget` distinct slices, simulating post-judge
  // cursor state in-memory between picks (see bin/lib/health-core/budget.js).
  const chosen = selectBudget(budget, cursors, (c) => selectSlice(root, c, { now, fileDataCache, ...seam }), {
    getCursorKey: (slice) => slice.id,
    // slice.recursive comes straight from listSlices — no re-derivation, and no
    // repo-wide re-list per chosen slice the way sliceRecursive(id, root) does.
    buildCursorPatch: (_, slice) => ({ lastSweptMs: now, lastHash: contentHash(slice.path, fileDataCache, { recursive: slice.recursive, env: ctx.env }) }),
  });
  ctx.stdout(JSON.stringify(chosen, null, 2) + '\n');
  return 0;
}

function cmdClassify(args, ctx) {
  const root = args.root || ctx.cwd();
  const areaPath = args.area || '.';
  const absDir = path.resolve(root, areaPath);
  const { types } = classifyArea(absDir, root);
  ctx.stdout(JSON.stringify({ areaId: areaPath, types }, null, 2) + '\n');
  return 0;
}

// The in-process entry (#5381): `deps` is { stdout(text), stderr(text), cwd(), env }
// and nothing here reaches process.* — the exit code is returned, never set.
// Everything that holds io or env (durable state, the shared sub-command
// factories) is built per call from `deps`, so an injected stderr/env reaches
// every child git and every message.
function run(argv, deps = realDeps) {
  const stderr = (text) => deps.stderr(text);
  const durable = createDurable({ env: deps.env, stderr });
  const io = { stdout: (text) => deps.stdout(text), stderr, cwd: () => deps.cwd() };
  const { readDurableState, writeDurableState } = durable;
  const ctx = {
    ...io,
    env: deps.env,
    durable,
    retryQueueCommands: makeRetryQueueCommands({ readDurableState, writeDurableState, io }),
    cmdChurnReport: makeCmdChurnReport({ readDurableState, computeChurn, io }),
  };
  const args = parseArgs(argv, ctx.cwd());
  // A relative --root resolves against the injected cwd, never the real one, so the
  // shared sub-commands (which pass it straight to `git -C` and fs) see an absolute path.
  args.root = path.resolve(ctx.cwd(), args.root || '.');
  const cmd = args._[0];
  if (cmd === 'status') return cmdStatus(args, ctx);
  if (cmd === 'churn-report') return ctx.cmdChurnReport(args);
  if (cmd === 'validate-findings') return cmdValidateFindings(args, ctx);
  if (cmd === 'classify') return cmdClassify(args, ctx);
  if (cmd === 'next-slice') return cmdNextSlice(args, ctx);
  // args._[0] is always 'retry-queue' itself (parseArgs pushes every positional,
  // including the top-level subcommand, into args._) — the drain/update word
  // right after it is args._[1], the same offset validate-findings uses for its
  // own findings-file positional. retryQueueCommands.update() expects its own
  // args._ re-based so index 1 lands on the results-file path (mirroring how a
  // stand-alone "update <results.json>" invocation would parse), so slice off
  // the leading 'retry-queue' entry before handing args to it.
  if (cmd === 'retry-queue' && args._[1] === 'drain') return ctx.retryQueueCommands.drain(args);
  if (cmd === 'retry-queue' && args._[1] === 'update') {
    return ctx.retryQueueCommands.update({ ...args, _: args._.slice(1) });
  }
  ctx.stderr(
    'usage: code-health.js <command> [options]\n' +
    'commands: validate-findings [--slice <id>], classify, next-slice, status, churn-report, ' +
    'retry-queue drain, retry-queue update <results.json>\n',
  );
  return 2;
}

const realDeps = {
  ...DEFAULT_IO,
  env: process.env,
};

module.exports = { parseArgs, cmdValidateFindings, run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
