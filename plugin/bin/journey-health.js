#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { fingerprint } = require('./lib/journey-health/fingerprint');
const {
  readCache, writeCache, createDurable, buildValidateFindingsUpdate,
} = require('./lib/journey-health/cache');
const { makeExec } = require('./lib/health-core/io');
const { computeChurn } = require('./lib/health-core/runs');
const { makeRetryQueueCommands } = require('./lib/health-core/retry-cli');
const { dedupAndDispatch } = require('./lib/health-core/validate-findings-dispatch');
const { resolveReadCommit } = require('./lib/health-core/read-commit');
const { selectBudget } = require('./lib/health-core/budget');
const { makeCmdChurnReport } = require('./lib/health-core/churn-report');
const { makeCmdMark, mergeDeclinedIntoCache } = require('./lib/health-core/mark');
const { decide } = require('./lib/journey-health/dedup');
const { validateFinding } = require('./lib/journey-health/validate-finding');
const { toIssuePayload } = require('./lib/journey-health/issue-payload');
const { selectTarget, listJourneys, currentDeletedFileSignature } = require('./lib/journey-health/scope');
const { STALE_DAYS_LIGHT } = require('./lib/journey-health/score');
const { evaluateQaEvidence } = require('./lib/journey-health/qa-evidence');

const TOOL_NAME = 'journey-health';

// Mirrors code-health's RISK_RANK/validateRiskArg shape (bin/code-health.js)
// for the analogous --min-confidence floor, scoped to journey-health's own
// three-tier confidence vocabulary (validate-finding.js's CONFIDENCE_VALUES).
// Unlike code-health's --min-risk, this floor is opt-in only (no internal
// default) and drops a sub-threshold finding for this run only, rather than
// diverting it into a `remembered` cache tier — journey-health's cache.js
// explicitly documents having no `remembered` tier.
const CONFIDENCE_RANK = { low: 0, med: 1, high: 2 };

// Writes its message to `stderr` and returns { ok: false, code: 2 } for an
// unrecognized value; { ok: true } otherwise (an omitted flag included).
function validateConfidenceArg(value, stderr) {
  if (value == null) return { ok: true };
  if (Object.prototype.hasOwnProperty.call(CONFIDENCE_RANK, value)) return { ok: true };
  stderr(
    `validate-findings: --min-confidence "${value}" is not a recognized confidence tier ` +
    `(must be one of ${Object.keys(CONFIDENCE_RANK).join('|')}) — an unrecognized value silently files every finding instead of applying the floor.\n`,
  );
  return { ok: false, code: 2 };
}

function parseArgs(argv, cwd = process.cwd()) {
  const args = { _: [], root: cwd, dryRun: false, runId: new Date().toISOString(), tier: 'light' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--tier') args.tier = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--coverage-scan') args.coverageScan = true;
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--fail-on-high-churn') args['fail-on-high-churn'] = argv[++i];
    else if (a === '--budget') args.budget = Number(argv[++i]);
    else if (a === '--story-ids') args.storyIds = argv[++i];
    else if (a === '--now') args.now = Number(argv[++i]);
    else if (a === '--min-confidence') args['min-confidence'] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function cmdNextTarget(args, ctx) {
  const root = path.resolve(ctx.cwd(), args.root || '.');
  const env = ctx.env;
  const now = Date.now();
  const tier = args.tier === 'deep' ? 'deep' : 'light';
  // Fetch durable state exactly once and reuse it for both the coverage-scan
  // check and the target-selection cursors below, so coverageScanDue and
  // cursors answer the same point in time and the CLI doesn't pay for a
  // second git fetch/show round-trip per invocation (mirrors
  // bin/harness-health.js's cmdNextTarget).
  const durableCursors = ctx.durable.readDurableState(root).cursors;
  const coverageScan = durableCursors.__coverageScan || { lastScannedMs: null };
  const coverageScanDue = coverageScan.lastScannedMs == null || (now - coverageScan.lastScannedMs) / 86400000 > STALE_DAYS_LIGHT;

  if (args.target) {
    const found = listJourneys(root).find((t) => t.id === args.target) || null;
    const target = found ? { ...found, why: 'manual' } : null;
    ctx.stdout(JSON.stringify({ target, coverageScanDue }, null, 2) + '\n');
    return 0;
  }

  const budget = Number.isFinite(args.budget) && args.budget > 0 ? args.budget : 1;
  const cursors = durableCursors;

  if (budget === 1) {
    const target = selectTarget(root, cursors, { now, tier, env });
    ctx.stdout(JSON.stringify({ target, coverageScanDue }, null, 2) + '\n');
    return 0;
  }

  // budget > 1: pick up to `budget` distinct journeys, simulating post-audit
  // cursor state in-memory between picks (mirrors harness-health's
  // next-target --budget; see bin/lib/health-core/budget.js). alreadyPicked
  // additionally guards Phase 0 (deleted-file force-select): its cross-run
  // suppression keys off the cursor's deletedFileSig, which only a real
  // validate-findings run writes, so the simulated patch below would not
  // stop the same pick repeating on every slot of this batch.
  const alreadyPicked = new Set();
  const auditField = tier === 'deep' ? 'lastDeepAuditMs' : 'lastLightAuditMs';
  const targets = selectBudget(budget, cursors, (c) => selectTarget(root, c, { now, tier, alreadyPicked, env }), {
    getCursorKey: (t) => t.id,
    buildCursorPatch: (existing) => ({ ...(existing || {}), [auditField]: now }),
    onPick: (t) => alreadyPicked.add(t.id),
  });
  ctx.stdout(JSON.stringify({ targets, coverageScanDue }, null, 2) + '\n');
  return 0;
}

function cmdValidateFindings(args, ctx) {
  const { stderr, env } = ctx;
  // Relative paths resolve against the injected cwd, never the real one.
  const root = path.resolve(ctx.cwd(), args.root || '.');
  const findingsArg = args._[1];
  if (!findingsArg) {
    stderr(
      'usage: journey-health.js validate-findings <findings.json> [--root <dir>] [--issues <file>] [--target <id>] [--tier light|deep] [--coverage-scan] [--run-id <id>] [--min-confidence <level>] [--dry-run]\n',
    );
    return 2;
  }
  const findingsPath = path.resolve(ctx.cwd(), findingsArg);
  const issuesPath = args.issues ? path.resolve(ctx.cwd(), args.issues) : args.issues;

  const confidence = validateConfidenceArg(args['min-confidence'], stderr);
  if (!confidence.ok) return confidence.code;

  // buildValidateFindingsUpdate only patches a cursor when target is present,
  // or sets __coverageScan when coverageScan is set (see
  // lib/journey-health/cache.js). A real (non-dry-run) run that omits both (a
  // flag typo, or a caller path that forgets to thread the journey id
  // through) still writes the run record and dedup cache correctly but never
  // advances any audit cursor — the journey then gets perpetually re-selected
  // as stale/overdue on every future run. Mirrors bin/harness-health.js's own
  // hard-gate for validate-findings.
  if (!args.dryRun && !(args.target || args.coverageScan)) {
    stderr(
      'validate-findings: a real (non-dry-run) run requires --target, or --coverage-scan (or both) — ' +
      'without one of them, no audit cursor advances and rotation state silently drifts. ' +
      'Pass --dry-run to preview without it.\n',
    );
    return 2;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch {
    // The message names the findings path as the caller gave it, as before.
    stderr(`validate-findings: could not read or parse findings file: ${findingsArg}\n`);
    return 1;
  }
  if (!Array.isArray(raw)) {
    stderr('validate-findings: findings file must contain a JSON array\n');
    return 1;
  }

  const survivors = [];
  for (const f of raw) {
    const v = validateFinding(f);
    if (!v.ok) {
      stderr(
        `[journey-health] validate-findings: dropped finding for journey "${(f && f.journey) || '?'}": ${v.errors.join('; ')}\n`,
      );
      continue;
    }
    const id = fingerprint({
      journey: v.value.journey,
      category: v.value.category,
      section: v.value.section,
      description: v.value.description,
    });
    survivors.push({ ...v.value, id });
  }

  // Confidence floor: applied here, before dedup/fingerprinting, so a
  // held-back finding never reaches the cache or emits a payload for this
  // run. Opt-in only (see validateConfidenceArg's comment above) — omitting
  // --min-confidence keeps today's unconditional-filing behavior unchanged.
  let filtered = survivors;
  if (args['min-confidence']) {
    const threshold = CONFIDENCE_RANK[args['min-confidence']];
    filtered = survivors.filter((f) => {
      const keep = CONFIDENCE_RANK[f.confidence] >= threshold;
      if (!keep) {
        stderr(
          `[journey-health] validate-findings: held back "${f.description}" (confidence: ${f.confidence}) below --min-confidence ${args['min-confidence']}\n`,
        );
      }
      return keep;
    });
  }

  // Merge durable `declined` marks into the local cache readCache sees, so a
  // finding declined via `mark ... declined` on a prior firing (possibly a
  // different, since-recycled Routine container) is suppressed here too —
  // not just on the same-container run `mark` itself was tested against.
  const readCacheWithDeclined = (r) => mergeDeclinedIntoCache(readCache(r), ctx.durable.readDurableState(r).declined || {});

  // Resolved ONCE per run, right before filing — #117's freshness stamp
  // must reflect the commit this sweep actually read, not the moment each
  // finding's issue happens to be created. makeExec pipes the child's stderr
  // to ctx.stderr rather than letting it reach the process's own.
  const verifiedAsOf = resolveReadCommit(root, makeExec({ env, stderr }));

  const { cache, payloads, seen, wontfixSuppressed } = dedupAndDispatch({
    root, issuesPath, toolName: TOOL_NAME, survivors: filtered, readCache: readCacheWithDeclined, decide, toIssuePayload, verifiedAsOf, stderr,
  });

  if (!args.dryRun) {
    writeCache(root, cache);
    // Cursor/audit-log persistence is a rebuildable optimization (GitHub issue state is the
    // source of truth), so a persistence failure must never block emitting the payloads —
    // mirrors the pattern already hardened in bin/harness-health.js's own writeDurableState call.
    const runRecord = { runId: args.runId, runAt: new Date().toISOString(), fingerprints: [...seen] };
    // Named rather than inlined into the mutator call below, for readability.
    // deletedFileSig (#131) is recomputed here, from the tree as it stands
    // once the audit is done, so the cursor records what the audit actually
    // reported — a journey fixed mid-audit clears its acknowledgement rather
    // than banking the state that selected it. Light tier only (Phase 0 is
    // light-only); `undefined` on the deep tier leaves the field alone.
    const deletedFileSig = args.target && args.tier !== 'deep'
      ? currentDeletedFileSignature(root, args.target)
      : undefined;
    const mutatorInput = {
      target: args.target, tier: args.tier, coverageScan: args.coverageScan, runRecord, deletedFileSig,
      wontfixSuppressed,
    };
    const result = ctx.durable.writeDurableState(root, (current) => buildValidateFindingsUpdate(current, mutatorInput));
    if (!result.ok) {
      stderr(`[journey-health] validate-findings: health-state persistence failed after retries: ${result.error}\n`);
    }
  }

  ctx.stdout(JSON.stringify(payloads, null, 2) + '\n');
  stderr(
    `[journey-health] validate-findings: ${survivors.length} valid finding(s), ${payloads.length} payload(s) after dedup\n`,
  );
  return 0;
}

function cmdQaEvidence(args, ctx) {
  const reportArg = args._[1];
  if (!reportArg) {
    ctx.stderr('usage: journey-health.js qa-evidence <report.json> --story-ids <id1,id2,...> [--now <ms>]\n');
    return 2;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(path.resolve(ctx.cwd(), reportArg), 'utf8'));
  } catch {
    ctx.stderr(`qa-evidence: could not read or parse report file: ${reportArg}\n`);
    return 1;
  }
  const storyIds = args.storyIds ? args.storyIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const now = args.now != null ? args.now : Date.now();
  const result = evaluateQaEvidence(storyIds, report, { now });
  ctx.stdout(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

// The in-process entry (#5380): `deps` is { stdout(text), stderr(text), cwd(), env }
// and nothing here reaches process.* — the exit code is returned, never set.
// Everything that holds io or env (durable state, the shared sub-command
// factories) is built per call from `deps`, so an injected stderr/env reaches
// every child git and every message.
function run(argv, deps = realDeps) {
  const stderr = (text) => deps.stderr(text);
  const durable = createDurable({ env: deps.env, stderr });
  const io = { stdout: (text) => deps.stdout(text), stderr, cwd: () => deps.cwd() };
  const { readDurableState, writeDurableState } = durable;
  // readDurableState/writeDurableState wired through so a "declined" mark also
  // persists to the health-state git branch, not just the local gitignored
  // cache — see bin/lib/health-core/mark.js's own header comment. Without
  // this, a declined finding (by definition never filed as a GitHub issue, so
  // there is nothing for dedup to reconstruct from) would silently reappear
  // on a scheduled Routine's next fresh, stateless container.
  const ctx = {
    ...io,
    env: deps.env,
    durable,
    retryQueueCommands: makeRetryQueueCommands({ readDurableState, writeDurableState, io }),
    cmdChurnReport: makeCmdChurnReport({ readDurableState, computeChurn, io }),
    cmdMark: makeCmdMark({
      readCache, writeCache, readDurableState, writeDurableState, toolName: TOOL_NAME, io,
    }),
  };
  const args = parseArgs(argv, ctx.cwd());
  // A relative --root resolves against the injected cwd, never the real one, so the
  // shared sub-commands (which pass it straight to `git -C` and fs) see an absolute path.
  args.root = path.resolve(ctx.cwd(), args.root || '.');
  const cmd = args._[0];
  if (cmd === 'next-target') return cmdNextTarget(args, ctx);
  if (cmd === 'validate-findings') return cmdValidateFindings(args, ctx);
  if (cmd === 'churn-report') return ctx.cmdChurnReport(args);
  if (cmd === 'mark') return ctx.cmdMark(args);
  if (cmd === 'qa-evidence') return cmdQaEvidence(args, ctx);
  // args._[0] is always 'retry-queue' itself (parseArgs pushes every positional,
  // including the top-level subcommand, into args._) — the drain/update word
  // right after it is args._[1], the same offset validate-findings uses for its
  // own findings-file positional. retryQueueCommands.update() expects its own
  // args._ re-based so index 1 lands on the results-file path, so slice off
  // the leading 'retry-queue' entry before handing args to it.
  if (cmd === 'retry-queue' && args._[1] === 'drain') return ctx.retryQueueCommands.drain(args);
  if (cmd === 'retry-queue' && args._[1] === 'update') {
    const rebased = args._.slice(1);
    // The results file is read by the shared command, so hand it an absolute path.
    if (rebased[1]) rebased[1] = path.resolve(ctx.cwd(), rebased[1]);
    return ctx.retryQueueCommands.update({ ...args, _: rebased });
  }
  ctx.stderr(
    'usage: journey-health.js <command> [options]\n' +
    'commands: next-target [--target <id>] [--tier light|deep] [--budget <n>], ' +
    'validate-findings <file> [--target <id>] [--tier light|deep] [--coverage-scan] [--min-confidence low|med|high], ' +
    'qa-evidence <report.json> --story-ids <id1,id2,...> [--now <ms>], ' +
    'churn-report [--fail-on-high-churn <r>], mark <fingerprint> <declined>, ' +
    'retry-queue drain, retry-queue update <results.json>\n',
  );
  return 2;
}

const realDeps = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: () => process.cwd(),
  env: process.env,
};

// Removal condition: delete once no file under plugin/, tests/, tools/, perf/ or evals/
// imports it — callers use run(argv, deps) instead. Returns the exit code; never sets
// process.exitCode.
function main(argv) {
  return run(argv, realDeps);
}

module.exports = {
  parseArgs, cmdNextTarget, cmdValidateFindings, cmdQaEvidence, main, run, realDeps,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
