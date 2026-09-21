#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { fingerprint } = require('./lib/harness-health/fingerprint');
const {
  readCache, writeCache, readDurableState, writeDurableState, buildValidateFindingsUpdate,
} = require('./lib/harness-health/cache');
const { computeChurn } = require('./lib/health-core/runs');
const { makeRetryQueueCommands } = require('./lib/health-core/retry-cli');
const { dedupAndDispatch } = require('./lib/health-core/validate-findings-dispatch');
const { resolveReadCommit } = require('./lib/health-core/read-commit');
const { selectBudget } = require('./lib/health-core/budget');
const { makeCmdChurnReport } = require('./lib/health-core/churn-report');
const { makeCmdMark, mergeDeclinedIntoCache } = require('./lib/health-core/mark');
const { makeCmdStatus } = require('./lib/health-core/remembered-status');
const { decide } = require('./lib/harness-health/dedup');
const { validateFinding } = require('./lib/harness-health/validate-finding');
const { toIssuePayload } = require('./lib/harness-health/issue-payload');
const {
  selectTarget, listTargets, listMemory, selectMemoryTarget,
} = require('./lib/harness-health/scope');
const { STALE_DAYS } = require('./lib/harness-health/score');

const TOOL_NAME = 'harness-health';
const retryQueueCommands = makeRetryQueueCommands({ readDurableState, writeDurableState });
const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
// readDurableState/writeDurableState wired through so a "declined" mark also
// persists to the health-state git branch, not just the local gitignored
// cache — see bin/lib/health-core/mark.js's own header comment. Without
// this, a declined finding (by definition never filed as a GitHub issue, so
// there is nothing for dedup to reconstruct from) would silently reappear
// on a scheduled Routine's next fresh, stateless container despite this
// skill's own Anti-Patterns table promising it won't.
const cmdMark = makeCmdMark({
  readCache, writeCache, readDurableState, writeDurableState, toolName: TOOL_NAME,
});
const cmdStatus = makeCmdStatus({ readDurableState });

// Confidence rank: lower number = more urgent (highest priority to file).
// Mirrors bin/lib/code-health/dedup.js's RISK_RANK convention/shape.
const CONFIDENCE_RANK = { high: 0, med: 1, low: 2 };

function validateConfidenceArg(value) {
  if (value === undefined) return;
  if (Object.prototype.hasOwnProperty.call(CONFIDENCE_RANK, value)) return;
  process.stderr.write(
    `harness-health.js: validate-findings --min-confidence "${value}" is not a recognized value ` +
    `(must be one of ${Object.keys(CONFIDENCE_RANK).join('|')}) — an unrecognized value silently ` +
    'files every finding regardless of confidence, same as omitting the flag.\n',
  );
  process.exitCode = 2;
}

function parseArgs(argv) {
  const args = { _: [], root: process.cwd(), dryRun: false, runId: new Date().toISOString() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--kind') args.kind = argv[++i];
    else if (a === '--memory-dir') args.memoryDir = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--gap-scan') args.gapScan = true;
    else if (a === '--force-gap-scan') args.forceGapScan = true;
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--fail-on-high-churn') args['fail-on-high-churn'] = argv[++i];
    else if (a === '--budget') args.budget = Number(argv[++i]);
    else if (a === '--min-confidence') args.minConfidence = argv[++i];
    else args._.push(a);
  }
  return args;
}

function cmdNextTarget(args) {
  const root = args.root || process.cwd();
  const now = Date.now();
  // Fetch durable state exactly once and reuse it for both the gap-scan check
  // and the target-selection cursors below, so gapScanDue and cursors answer
  // the same point in time and the CLI doesn't pay for a second git
  // fetch/show round-trip per invocation (mirrors bin/code-health.js's
  // cmdNextSlice, which also reads durable state exactly once).
  const durableCursors = readDurableState(root).cursors;
  const gapScan = durableCursors.__gapScan || { lastScannedSha: null, lastScannedMs: null };
  // --force-gap-scan bypasses the 90-day cursor entirely, mirroring the
  // existing --target manual override for the deep-audit side of next-target
  // — a human escape hatch for testing gap-detection heuristics or checking
  // a suspected fresh pattern without waiting out the cursor.
  const gapScanDue = args.forceGapScan
    || gapScan.lastScannedMs == null || (now - gapScan.lastScannedMs) / 86400000 > STALE_DAYS;

  if (args.kind === 'memory') {
    if (!args.memoryDir) {
      process.stderr.write('harness-health.js: next-target --kind memory requires --memory-dir <path>\n');
      process.exitCode = 2;
      return;
    }
    const memCursors = durableCursors;

    if (args.target) {
      const found = listMemory(args.memoryDir).find((t) => t.id === args.target) || null;
      const target = found ? { ...found, why: 'manual' } : null;
      process.stdout.write(JSON.stringify({ target, gapScanDue }, null, 2) + '\n');
      return;
    }

    const memBudget = Number.isFinite(args.budget) && args.budget > 0 ? args.budget : 1;

    if (memBudget === 1) {
      const target = selectMemoryTarget(args.memoryDir, memCursors, { now });
      process.stdout.write(JSON.stringify({ target, gapScanDue }, null, 2) + '\n');
      return;
    }

    // Budget > 1: pick up to `memBudget` distinct memory targets, simulating
    // post-audit cursor state in-memory between picks.
    const memTargets = selectBudget(memBudget, memCursors, (c) => selectMemoryTarget(args.memoryDir, c, { now }), {
      getCursorKey: (t) => `${t.kind}:${t.id}`,
      buildCursorPatch: (existing) => ({ ...(existing || {}), lastAuditedMs: now }),
    });
    process.stdout.write(JSON.stringify({ targets: memTargets, gapScanDue }, null, 2) + '\n');
    return;
  }

  if (args.target) {
    // --kind disambiguates when a skill/rule/CLAUDE.md id collides; without it,
    // the first match in listTargets' skill->rule->claude-md order wins.
    const found = listTargets(root).find((t) => t.id === args.target && (!args.kind || t.kind === args.kind)) || null;
    const target = found ? { ...found, why: 'manual' } : null;
    process.stdout.write(JSON.stringify({ target, gapScanDue }, null, 2) + '\n');
    return;
  }

  const budget = Number.isFinite(args.budget) && args.budget > 0 ? args.budget : 1;
  const cursors = durableCursors;

  if (budget === 1) {
    const target = selectTarget(root, cursors, { now, kind: args.kind });
    process.stdout.write(JSON.stringify({ target, gapScanDue }, null, 2) + '\n');
    return;
  }

  // budget > 1: pick up to `budget` distinct targets, simulating post-audit
  // cursor state in-memory between picks (mirrors code-health's next-slice
  // --budget; see bin/lib/health-core/budget.js).
  const targets = selectBudget(budget, cursors, (c) => selectTarget(root, c, { now, kind: args.kind }), {
    getCursorKey: (t) => `${t.kind}:${t.id}`,
    buildCursorPatch: (existing) => ({ ...(existing || {}), lastAuditedMs: now }),
  });
  process.stdout.write(JSON.stringify({ targets, gapScanDue }, null, 2) + '\n');
}

function cmdValidateFindings(args) {
  const root = args.root || process.cwd();
  const findingsPath = args._[1];
  if (!findingsPath) {
    process.stderr.write(
      'usage: harness-health.js validate-findings <findings.json> [--root <dir>] [--issues <file>] [--target <id>] [--kind <skill|rule|claude-md|design-artifact|memory>] [--gap-scan] [--min-confidence <low|med|high>] [--run-id <id>] [--dry-run]\n',
    );
    process.exitCode = 2;
    return;
  }

  validateConfidenceArg(args.minConfidence);
  if (process.exitCode) return;

  // buildValidateFindingsUpdate only patches a cursor when both target AND
  // kind are present (see lib/harness-health/cache.js), or when gapScan is
  // set. A real run that omits all three (a flag typo, or a skill-prompt
  // drift) still writes the run record and dedup cache correctly but never
  // advances any audit cursor — the target then gets perpetually
  // re-selected as stale/overdue on every future run. Mirrors
  // code-health.js's own --slice hard-gate for validate-findings.
  if (!args.dryRun && !((args.target && args.kind) || args.gapScan)) {
    process.stderr.write(
      'validate-findings: a real (non-dry-run) run requires --target with --kind, or --gap-scan (or both) — ' +
      'without one of them, no audit cursor advances and rotation state silently drifts. ' +
      'Pass --dry-run to preview without it.\n',
    );
    process.exitCode = 2;
    return;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch {
    process.stderr.write(`validate-findings: could not read or parse findings file: ${findingsPath}\n`);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(raw)) {
    process.stderr.write('validate-findings: findings file must contain a JSON array\n');
    process.exitCode = 1;
    return;
  }

  const survivors = [];
  // Findings below the --min-confidence floor (when passed) are held here
  // instead of entering `survivors` at all — never dropped, never filed.
  // Mirrors code-health's own rememberCandidates split in bin/code-health.js.
  const remembered = [];
  for (const f of raw) {
    const v = validateFinding(f);
    if (!v.ok) {
      process.stderr.write(
        `[harness-health] validate-findings: dropped finding for target "${(f && f.target) || '?'}": ${v.errors.join('; ')}\n`,
      );
      continue;
    }
    const id = fingerprint({
      assetType: v.value.assetType,
      target: v.value.target,
      section: v.value.section || v.value.kind,
      description: v.value.description,
    });
    const value = { ...v.value, id };
    if (args.minConfidence) {
      const rank = CONFIDENCE_RANK[value.confidence];
      const floorRank = CONFIDENCE_RANK[args.minConfidence];
      if (rank !== undefined && floorRank !== undefined && rank > floorRank) {
        remembered.push(value);
        continue;
      }
    }
    survivors.push(value);
  }

  // Merge durable `declined` marks into the local cache readCache sees, so a
  // finding declined via `mark ... declined` on a prior firing (possibly a
  // different, since-recycled Routine container) is suppressed here too —
  // not just on the same-container run `mark` itself was tested against.
  const readCacheWithDeclined = (r) => mergeDeclinedIntoCache(readCache(r), readDurableState(r).declined || {});

  // Resolved ONCE per run, right before filing — #117's freshness stamp
  // must reflect the commit this sweep actually read, not the moment each
  // finding's issue happens to be created.
  const verifiedAsOf = resolveReadCommit(root);

  const { cache, payloads, seen, wontfixSuppressed } = dedupAndDispatch({
    root, issuesPath: args.issues, toolName: TOOL_NAME, survivors, readCache: readCacheWithDeclined, decide, toIssuePayload, verifiedAsOf,
  });

  if (!args.dryRun) {
    writeCache(root, cache);
    // Cursor/audit-log persistence is a rebuildable optimization (GitHub issue state is the
    // source of truth), so a persistence failure must never block emitting the payloads —
    // mirrors the pattern already hardened in bin/code-health.js's own writeDurableState call.
    const runRecord = { runId: args.runId, runAt: new Date().toISOString(), fingerprints: [...seen] };
    // Named rather than inlined into the mutator call below, for readability.
    const mutatorInput = {
      target: args.target,
      kind: args.kind,
      gapScan: args.gapScan,
      runRecord,
      rememberCandidates: remembered.map((f) => ({ id: f.id, confidence: f.confidence })),
      wontfixSuppressed,
    };
    const result = writeDurableState(root, (current) => buildValidateFindingsUpdate(current, mutatorInput));
    if (!result.ok) {
      process.stderr.write(`[harness-health] validate-findings: health-state persistence failed after retries: ${result.error}\n`);
    }
  }

  process.stdout.write(JSON.stringify(payloads, null, 2) + '\n');
  process.stderr.write(
    `[harness-health] validate-findings: ${survivors.length} valid finding(s), ${payloads.length} payload(s) after dedup` +
    (remembered.length ? `, ${remembered.length} remembered (below --min-confidence floor)` : '') + '\n',
  );
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'next-target') return cmdNextTarget(args);
  if (cmd === 'validate-findings') return cmdValidateFindings(args);
  if (cmd === 'churn-report') { const code = cmdChurnReport(args); if (code) process.exitCode = code; return; }
  if (cmd === 'mark') { const code = cmdMark(args); if (code) process.exitCode = code; return; }
  if (cmd === 'status') return cmdStatus(args);
  // args._[0] is always 'retry-queue' itself (parseArgs pushes every positional,
  // including the top-level subcommand, into args._) — the drain/update word
  // right after it is args._[1], the same offset validate-findings uses for its
  // own findings-file positional. retryQueueCommands.update() expects its own
  // args._ re-based so index 1 lands on the results-file path, so slice off
  // the leading 'retry-queue' entry before handing args to it.
  if (cmd === 'retry-queue' && args._[1] === 'drain') return retryQueueCommands.drain(args);
  if (cmd === 'retry-queue' && args._[1] === 'update') {
    const code = retryQueueCommands.update({ ...args, _: args._.slice(1) });
    if (code) process.exitCode = code;
    return;
  }
  process.stderr.write(
    'usage: harness-health.js <command> [options]\n' +
    'commands: next-target [--target <id>] [--kind <skill|rule|claude-md|design-artifact|memory>] [--memory-dir <path>] [--budget <n>] [--force-gap-scan], ' +
    'validate-findings <file> [--target <id>] [--kind <skill|rule|claude-md|design-artifact|memory>] [--gap-scan] [--min-confidence <low|med|high>], ' +
    'churn-report [--fail-on-high-churn <r>], mark <fingerprint> <declined>, status, ' +
    'retry-queue drain, retry-queue update <results.json>\n',
  );
  process.exitCode = 2;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  parseArgs, cmdNextTarget, cmdValidateFindings, cmdChurnReport, cmdMark, cmdStatus, CONFIDENCE_RANK, main,
};
