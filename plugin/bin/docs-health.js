#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { fingerprint } = require('./lib/docs-health/fingerprint');
const { computeWordCount } = require('./lib/docs-health/depth');
const { readCache, writeCache, readDurableState, writeDurableState, buildValidateFindingsUpdate } = require('./lib/docs-health/cache');
const { computeChurn } = require('./lib/health-core/runs');
const { makeRetryQueueCommands } = require('./lib/health-core/retry-cli');
const { loadIssueIndex } = require('./lib/health-core/issue-index');
const { selectBudget } = require('./lib/health-core/budget');
const { makeCmdChurnReport } = require('./lib/health-core/churn-report');
const { makeCmdMark, mergeDeclinedIntoCache } = require('./lib/health-core/mark');
const { makeCmdStatus } = require('./lib/health-core/remembered-status');
const { decide } = require('./lib/docs-health/dedup');
const { validateFinding } = require('./lib/docs-health/validate-finding');
const { toIssuePayload } = require('./lib/docs-health/issue-payload');
const { resolveReadCommit } = require('./lib/health-core/read-commit');
const { selectTarget, listDocs } = require('./lib/docs-health/scope');
const path = require('path');
const { computeInboundReferences } = require('./lib/docs-health/findability');
const { checkTrackedFreshness } = require('./lib/docs-health/freshness');

const TOOL_NAME = 'docs-health';
const retryQueueCommands = makeRetryQueueCommands({ readDurableState, writeDurableState });
const cmdChurnReport = makeCmdChurnReport({ readDurableState, computeChurn });
// readDurableState/writeDurableState wired through so a "declined" mark also
// persists to the health-state git branch, not just the local gitignored
// cache — see bin/lib/health-core/mark.js's own header comment. Without
// this, a declined finding (by definition never filed as a GitHub issue, so
// there is nothing for dedup to reconstruct from) would silently reappear
// on a scheduled Routine's next fresh, stateless container.
const cmdMark = makeCmdMark({
  readCache, writeCache, readDurableState, writeDurableState, toolName: TOOL_NAME,
});
const cmdStatus = makeCmdStatus({ readDurableState });

// Confidence rank: lower number = more urgent (highest priority to file).
// Mirrors bin/lib/code-health/dedup.js's RISK_RANK shape/direction exactly —
// --min-confidence's "file when at or above the floor" semantics. Kept local
// to this CLI (rather than in bin/lib/docs-health/dedup.js, which is a thin
// re-export of the shared bin/lib/health-core/dedup.js used by three of the
// four health skills) since the threshold/remember behavior below has no
// equivalent in that shared module — same reason code-health forked its own
// dedup.js instead of extending the shared one.
const CONFIDENCE_RANK = { high: 0, med: 1, low: 2 };

// Rejects a --min-confidence value that isn't a CONFIDENCE_RANK key, prints
// an error, and exit(2) — mirrors bin/code-health.js's validateRiskArg.
function validateConfidenceArg(value) {
  if (value == null) return;
  if (Object.prototype.hasOwnProperty.call(CONFIDENCE_RANK, value)) return;
  process.stderr.write(
    `validate-findings: --min-confidence "${value}" is not a recognized confidence tier ` +
    `(must be one of ${Object.keys(CONFIDENCE_RANK).join('|')}) — an unrecognized value would silently ` +
    'file every finding regardless of confidence, defeating the floor.\n',
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
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--fail-on-high-churn') args['fail-on-high-churn'] = argv[++i];
    else if (a === '--budget') args.budget = Number(argv[++i]);
    else if (a === '--min-confidence') args['min-confidence'] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function cmdNextTarget(args) {
  const root = args.root || process.cwd();
  const now = Date.now();

  if (args.target) {
    const found = listDocs(root).find((t) => t.id === args.target) || null;
    const target = found ? { ...found, why: 'manual' } : null;
    process.stdout.write(JSON.stringify({ target }, null, 2) + '\n');
    return;
  }

  const budget = Number.isFinite(args.budget) && args.budget > 0 ? args.budget : 1;
  const cursors = readDurableState(root).cursors;

  if (budget === 1) {
    const target = selectTarget(root, cursors, { now, dir: args.dir });
    process.stdout.write(JSON.stringify({ target }, null, 2) + '\n');
    return;
  }

  // Budget > 1: pick up to `budget` distinct docs, simulating post-audit
  // cursor state in-memory between picks (see bin/lib/health-core/budget.js).
  const targets = selectBudget(budget, cursors, (c) => selectTarget(root, c, { now, dir: args.dir }), {
    getCursorKey: (t) => `doc:${t.id}`,
    buildCursorPatch: (existing) => ({ ...(existing || {}), lastAuditedMs: now }),
  });
  process.stdout.write(JSON.stringify({ targets }, null, 2) + '\n');
}

function cmdValidateFindings(args) {
  const root = args.root || process.cwd();
  // Resolved ONCE per run, right before filing — #117's freshness stamp
  // must reflect the commit this sweep actually read, not the moment each
  // finding's issue happens to be created.
  const verifiedAsOf = resolveReadCommit(root);
  const findingsPath = args._[1];
  if (!findingsPath) {
    process.stderr.write(
      'usage: docs-health.js validate-findings <findings.json> [--root <dir>] [--issues <file>] ' +
      '[--target <id>] [--run-id <id>] [--min-confidence <level>] [--dry-run]\n',
    );
    process.exitCode = 2;
    return;
  }

  validateConfidenceArg(args['min-confidence']);
  if (process.exitCode) return;

  // buildValidateFindingsUpdate only patches a cursor when target is present
  // (see lib/docs-health/cache.js) — docs-health has no gap-scan-equivalent
  // fallback (unlike harness-health/journey-health), so --target is the sole
  // mechanism for cursor advancement. A real (non-dry-run) run that omits it
  // (a flag typo, or a skill-prompt drift) still writes the run record and
  // dedup cache correctly but never advances any audit cursor — the doc then
  // gets perpetually re-selected as stale/overdue on every future run.
  // Mirrors bin/harness-health.js's own hard-gate for validate-findings.
  if (!args.dryRun && !args.target) {
    process.stderr.write(
      'validate-findings: a real (non-dry-run) run requires --target — ' +
      'without it, no audit cursor advances and rotation state silently drifts. ' +
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
  for (const f of raw) {
    const v = validateFinding(f);
    if (!v.ok) {
      process.stderr.write(
        `[docs-health] validate-findings: dropped finding for target "${(f && f.target) || '?'}": ${v.errors.join('; ')}\n`,
      );
      continue;
    }
    const id = fingerprint({
      assetType: v.value.assetType,
      target: v.value.target,
      section: v.value.section,
      description: v.value.description,
    });
    survivors.push({ ...v.value, id });
  }

  // Inlined dedup/dispatch loop (rather than the shared
  // health-core/validate-findings-dispatch.js helper harness-health/
  // journey-health use) so the --min-confidence floor can intercept a
  // 'file' decision BEFORE the cache is marked 'staged' for it — diverting
  // a below-floor finding into the durable 'remembered' cache instead.
  // Mirrors bin/code-health.js's own inline validate-findings loop (which
  // forks away from the shared helper for the identical reason: its
  // --min-risk floor needs the same interception point).
  // Merge durable `declined` marks into the local cache this loop sees, so a
  // finding declined via `mark ... declined` on a prior firing (possibly a
  // different, since-recycled Routine container) is suppressed here too —
  // not just on the same-container run `mark` itself was tested against.
  const cache = mergeDeclinedIntoCache(readCache(root), readDurableState(root).declined || {});
  const issueIndex = loadIssueIndex(args.issues, TOOL_NAME);
  const payloads = [];
  const rememberCandidates = [];
  const seen = new Set();
  // Fingerprints suppressed because their matching issue carries `wontfix`.
  // Kept so the durable write below can outlive the issue index they were
  // read from — the same hand-off health-core/validate-findings-dispatch.js
  // performs for the two skills that do use the shared loop.
  const wontfixSuppressed = [];
  const threshold = args['min-confidence'];
  for (const finding of survivors) {
    if (seen.has(finding.id)) continue; // intra-run dedup
    seen.add(finding.id);

    const decision = decide(finding, issueIndex, cache);
    if (decision.action === 'suppress') {
      if (decision.reason === 'wontfix-label') wontfixSuppressed.push(finding.id);
      continue;
    }
    if (decision.action === 'skip') continue;

    if (decision.action === 'file' && threshold) {
      const rank = CONFIDENCE_RANK[finding.confidence];
      const thresholdRank = CONFIDENCE_RANK[threshold];
      if (rank !== undefined && thresholdRank !== undefined && rank > thresholdRank) {
        // Below the floor: remember instead of filing — not dropped, not
        // staged, so it never re-proposes as brand-new on a future run
        // (see cache.js's buildValidateFindingsUpdate merge).
        cache[finding.id] = { status: 'remembered', issue: null, confidence: finding.confidence };
        rememberCandidates.push({ id: finding.id, confidence: finding.confidence });
        continue;
      }
    }

    if (decision.action === 'file' || decision.action === 'reopen') {
      cache[finding.id] = decision.action === 'reopen'
        ? { status: 'regressed', issue: decision.issue || null, lastSeenMs: Date.now() }
        : { status: 'staged', lastSeenMs: Date.now() };
      payloads.push(toIssuePayload(finding, verifiedAsOf));
    }
  }

  if (!args.dryRun) {
    writeCache(root, cache);
    const runRecord = { runId: args.runId, runAt: new Date().toISOString(), fingerprints: [...seen] };
    // Named rather than inlined into the mutator call below, for readability.
    const mutatorInput = { target: args.target, runRecord, rememberCandidates, wontfixSuppressed };
    const result = writeDurableState(root, (current) => buildValidateFindingsUpdate(current, mutatorInput));
    if (!result.ok) {
      process.stderr.write(`[docs-health] validate-findings: health-state persistence failed after retries: ${result.error}\n`);
    }
  }

  process.stdout.write(JSON.stringify(payloads, null, 2) + '\n');
  process.stderr.write(
    `[docs-health] validate-findings: ${survivors.length} valid finding(s), ${payloads.length} payload(s) after dedup\n`,
  );
}

function cmdWordCount(args) {
  const targetPath = args._[1];
  if (!targetPath) {
    process.stderr.write('usage: docs-health.js word-count <path>\n');
    process.exitCode = 2;
    return;
  }
  let content;
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch {
    process.stderr.write(`word-count: could not read file: ${targetPath}\n`);
    process.exitCode = 1;
    return;
  }
  const result = computeWordCount(content);
  process.stdout.write(JSON.stringify({ result }, null, 2) + '\n');
}

// Derives a doc's id (relative to docs/, no .md extension) from a raw
// path argument — mirrors scope.js's own id-deriving logic in walk().
function deriveDocId(targetPath, root) {
  const docsRoot = path.join(root, 'docs');
  // Resolve targetPath against root, not process.cwd(): --root means
  // "audit a project elsewhere," so a relative targetPath is meant to be
  // read relative to that root, not to wherever the command happens to be
  // invoked from. path.resolve(root, targetPath) is also correct when
  // targetPath is already absolute — path.resolve discards the leading
  // `root` segment in that case, per Node's own right-to-left resolution.
  const rel = path.relative(docsRoot, path.resolve(root, targetPath));
  return rel.split(path.sep).join('/').replace(/\.md$/, '');
}

function cmdFindRefs(args) {
  const targetPath = args._[1];
  if (!targetPath) {
    process.stderr.write('usage: docs-health.js find-refs <path> [--root <dir>]\n');
    process.exitCode = 2;
    return;
  }
  const root = args.root || process.cwd();
  // Resolve against root, not process.cwd(), the same way deriveDocId does
  // just below: --root means "audit a project elsewhere," so a relative
  // targetPath is meant to be read relative to that root.
  if (!fs.existsSync(path.resolve(root, targetPath))) {
    process.stderr.write(`find-refs: could not read file: ${targetPath}\n`);
    process.exitCode = 1;
    return;
  }
  const docId = deriveDocId(targetPath, root);
  const result = computeInboundReferences(docId, root);
  process.stdout.write(JSON.stringify({ result }, null, 2) + '\n');
}

function cmdCheckFreshness(args) {
  const targetPath = args._[1];
  if (!targetPath) {
    process.stderr.write('usage: docs-health.js check-freshness <path> [--root <dir>]\n');
    process.exitCode = 2;
    return;
  }
  const root = args.root || process.cwd();
  let content;
  try {
    // Resolve against root, not process.cwd(), the same way deriveDocId does
    // just below: --root means "audit a project elsewhere," so a relative
    // targetPath is meant to be read relative to that root.
    content = fs.readFileSync(path.resolve(root, targetPath), 'utf8');
  } catch {
    process.stderr.write(`check-freshness: could not read file: ${targetPath}\n`);
    process.exitCode = 1;
    return;
  }
  const docId = deriveDocId(targetPath, root);
  const cursors = readDurableState(root).cursors;
  const cursor = cursors[`doc:${docId}`];
  const sinceTimestamp = cursor && cursor.lastAuditedMs != null ? cursor.lastAuditedMs : null;
  const result = checkTrackedFreshness(content, root, sinceTimestamp);
  process.stdout.write(JSON.stringify({ result }, null, 2) + '\n');
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'next-target') return cmdNextTarget(args);
  if (cmd === 'validate-findings') return cmdValidateFindings(args);
  if (cmd === 'churn-report') { const code = cmdChurnReport(args); if (code) process.exitCode = code; return; }
  if (cmd === 'mark') { const code = cmdMark(args); if (code) process.exitCode = code; return; }
  if (cmd === 'status') return cmdStatus(args);
  if (cmd === 'word-count') return cmdWordCount(args);
  if (cmd === 'find-refs') return cmdFindRefs(args);
  if (cmd === 'check-freshness') return cmdCheckFreshness(args);
  if (cmd === 'retry-queue' && args._[1] === 'drain') return retryQueueCommands.drain(args);
  if (cmd === 'retry-queue' && args._[1] === 'update') {
    const code = retryQueueCommands.update({ ...args, _: args._.slice(1) });
    if (code) process.exitCode = code;
    return;
  }
  process.stderr.write(
    'usage: docs-health.js <command> [options]\n' +
    'commands: next-target [--target <id>] [--dir <path>] [--budget <n>], ' +
    'validate-findings <file> [--target <id>] [--issues <file>] [--min-confidence <level>] [--dry-run], ' +
    'churn-report [--fail-on-high-churn <r>], mark <fingerprint> <declined>, status, ' +
    'word-count <path>, find-refs <path> [--root <dir>], check-freshness <path> [--root <dir>], ' +
    'retry-queue drain, retry-queue update <results.json>\n',
  );
  process.exitCode = 2;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseArgs, cmdNextTarget, cmdValidateFindings, cmdChurnReport, cmdMark, cmdStatus, cmdWordCount, cmdFindRefs, cmdCheckFreshness, deriveDocId, main };
