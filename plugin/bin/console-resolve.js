#!/usr/bin/env node
// plugin/bin/console-resolve.js — resolve an `unattended` Review Console in
// one process (#1932): every staged item, one decisions block, one
// console.json (the write the auto-resolve path never made — #1854, so
// archive-merged.js never archived an unattended run), one rendered table.
// The merge half is computed, never executed — `gh pr merge` stays in the
// skill's own path. Exit 0 resolved, 2 malformed, 3 --run not anchored under
// the main checkout ([IL-127]), 4 consoleAutoResolve not granted at the
// resolved ceiling (never resolve a console at supervised/trusted), 5 a
// console.json this process must not clobber — one already rendered on the PR
// and awaiting a human, or one that will not parse (fail closed); never under
// `--dry-run`, which writes nothing and so has nothing to clobber, 6 (control mode) the carried
// decision facts could not be written — nothing else is written then. A console.json
// already carrying `resolved: true` is not an error, in either shape: it
// re-renders and exits 0.
//
// Second shape (#4170): `--run <dir> --set-item <id> --resolution keep-staged
// --reason <text>` rewrites one stored item `apply` → `keep-staged` after its
// execution failed, so it re-surfaces as residue (lib/console/item-resolution.js).
// It needs no ceiling (it only records what already happened). Exit 0 rewrote or
// already there, 2 malformed, 3 --run not anchored or the write failed, 5 refused
// (no console.json, not this CLI's shape, unknown/duplicate id, resolution not
// rewritable), 6 (control mode) the carried fact could not be written. `--resolution pending` rewrites one stored item `approve` → `pending` (#4636): a
// Reference-repairs row whose staged diff no longer applies at Phase 4 (`reference-repair-stale`).
//
// Third shape (#4636): `--run <dir> --check-repair <file> [--full]` re-runs the reference-repair
// floor (lib/console/reference-repair.js) on a diff composed after the resolver ran, for Phase 4's
// execution-and-verification.md Reference repairs bullet. It prints `console-resolve.js: {file}
// clear` and exits 0, or prints `console-resolve.js: {file} {reason}` (the reason word is the last
// token: reference-repair-held, -unclassified or -unreadable) followed by one `console-resolve.js:
// hit {path} ({why})` line per floor hit, and exits 5. `--full` runs the whole hold rule instead
// of the floor alone (the `Held:` line, the `Hold:` header, the finding's JSON `hold` from
// engine-state.json, then the floor) and reads only a file directly in `{run}/staged/`. It writes
// nothing and needs no ceiling. Exit 0 clear, 2 malformed (or `--full` on a file outside staged/),
// 3 --run not anchored, 5 held, unclassified or unreadable. It takes none of --policy, --dry-run,
// --json, --set-item.
//
// Fourth shape (#4620): `--run <dir> --ceiling` — read-only. Prints one line, `console-resolve.js: ceiling
// {tier} consoleAutoResolve {true|false} control-mode {on|off} source {cli|explicit|control-mode|invalid-autonomy|default}`,
// the effective ceiling the Review Console's short-circuit pre-check reads (run config over project policy,
// control mode under any explicit `autonomy`, exactly as the resolve shape computes it). It takes no other
// flag, needs no ceiling and writes nothing. Exit 0 printed, 2 malformed (any other flag), 3 --run not
// anchored, or the policy could not be read (`console-resolve.js: ceiling unreadable ({message})`: an
// unreadable policy never reads as `supervised`).
//
// Fifth shape (#4620): `--run <dir> --converge <items.json>` — run-end residue convergence
// (lib/console/residue-convergence.js), called from _shared/ledger-format.md's control-mode paragraph.
// It reads a JSON array of `{ id, source: ledger|insight, text, status, deferReason?, belowFloor?,
// filingFailed? }`, ends every item resolved, filed, digested or carried, writes every carried item's
// decision fact through writeDecisionFacts, logs one AUTO line per item (SKIP for a failed one), and prints `{ items: [{ id,
// state, proposal?, factId?, error? }], failed: [ids] }` as JSON. It needs control mode on with consoleAutoResolve
// granted (exit 4 otherwise, nothing written) and takes no other flag (`--dry-run` included). Exit 0 converged, 2 malformed (any other flag, or an unreadable,
// unparseable or malformed items file), 3 --run not anchored or the decisions.md entries could not be
// written (the JSON is printed first), 6 a carried fact could not be written — every carried item
// then reads `failed`, the JSON is printed, and stderr names each one.
//
// Sixth shape (#4620): `--run <dir> --memory-write <target> --memory-dir <dir> --content-file <file>` — one
// automatic, revertable memory write (lib/console/memory-write.js), the Review Console's step 8 under control
// mode. The target must resolve inside --memory-dir (symlinks followed; a create needs its parent to exist). It
// writes the target, then logs one AUTO entry under /wrap-up naming the path, the prior sha256 (`none` on a
// create) and the whole-file diff (reverse with `MEMORY_REVERT_COMMAND`); a diff over 20 KiB stores the prior content
// at `{run}/staged/.memory-prior-{sha12}.md` (dot-prefixed so it never becomes a console item) and the entry
// names that path instead. It needs control mode on with consoleAutoResolve granted (exit 4 otherwise, nothing
// written) and takes no other flag. Exit 0 written, 2 malformed (any
// other flag, a missing flag, or an unreadable --content-file), 3 --run not anchored, the target or backup
// write failed (nothing logged), or the entry could not be written (stderr names the written path), 5 the
// memory write refused, nothing written (target outside or unresolvable in the memory dir — why
// `outside-memory-dir` or `parent-missing` — or the memory dir unreadable, `memory-dir-unreadable`).
//
// Seventh shape (#4621): `--run <dir> --upstream-route <staged-id> [--hold filing-failed|scrub-hit --reason <text> |
// --filed <url>]` — the per-item ownership route for a wrap-up upstream-feedback item under control mode, at every
// ceiling. Below `unattended` it decides the item; at `unattended` the resolve shape already routed it in-process, and
// a repeat is idempotent (an owned item reads `file` again, a held one is held again with no second fact), so a console
// the resolve shape never saw (the reconciler-side executor's) is still routed. The id must match
// `wrap-up-upstream-*` (no whitespace) and, except under `--filed`, name a regular file in `{run}/staged/`, else
// exit 5 with nothing on stdout; that check runs BEFORE the policy read, so a bad id is exit 5 even with control mode
// off. The policy is read strictly, as `--ceiling` reads it: an absent file is unset, and any other read failure exits
// 3 (`console-resolve.js: upstream-route {id} policy unreadable ({message}) — nothing written`). Then
// `bookkeepingPermissions(ceiling, { controlMode }).ownedUpstreamFiling !== true` prints
// `upstream-route {id} unchanged (control mode off)`, exits 0 and writes nothing. With no modifier it
// prints `upstream-route {id} {file|hold} target {repo|none} reason {reason|none}` (`none` for a missing target or one
// outside the owner/name grammar, which is never echoed); a staged draft whose header names any repo but the one
// `/claude-tweaks:feedback` files into (`UPSTREAM_FILING_TARGET`) holds as `external`, since the header is an
// agent-written claim, while `--filed` judges the repo its URL names as it stands; a `hold` also carries the item
// (below). `--hold R --reason T` records a failure the agent met while filing (R is the hold reason, T its detail) and
// reads no ownership. `--filed URL` (one line, no whitespace) logs a filing at every ceiling, `unattended` included,
// and needs no staged file: `/claude-tweaks:feedback --pre-confirmed` deletes it on success, before this call. Its
// target is the repo the URL names, parsed strictly from `https://github.com/{owner}/{name}/issues/{n}` (anything else
// is an unresolved target) and routed like a staged one. On `file` it logs `filed into {repo} as {url}`; otherwise
// it still logs the issue that exists — `filed as {url} against a hold verdict ({reason})` — prints
// `upstream-route {id} hold target {repo|none} reason {reason} filed {url}`, writes no fact and exits 5.
// The hold writes run in this order, so a fact exists before anything claims the item
// carried: the decision fact (writeDecisionFacts; a failed write exits 6), then the console.json rewrite `filed` →
// `carried` (only when the auto-resolve shape holds the id as `filed`; any other console is left alone; one that exists but
// cannot be read exits 5), then one AUTO line. A repeated `--hold` for the same id writes no second fact (merge by id,
// first copy wins) and logs again, saying the fact was already held and not recording the repeat's reason. Each
// failed ownership read logs one SKIP line (step `Upstream ownership`), as the resolve shape does: on the route call,
// and on a `--filed` call only when it ends on a hold verdict, so a filing that stays `file` logs one set of notes
// and one that ends on a hold verdict logs a second. Ownership is not
// read at all when the target is missing or malformed (the verdict is `external` from the target alone). It takes no
// other flag. Exit 0 routed, 2 malformed, 3 --run not anchored, the policy could not be read (nothing written), a
// decisions.md entry could not be written, or the console.json rewrite threw (the decision fact has landed), 5 the id
// refused (nothing written, nothing on stdout), `--filed` against a hold verdict (the filing is logged, and stdout
// says so), or the console.json rewrite refused or console.json present but unreadable (the decision fact has landed), 6 the decision fact could not be
// written. A stderr line names the fact whenever it landed before the failure.
//
// Control mode also routes a wrap-up upstream-feedback item by repo ownership (#4621): it files only into an
// owned repo (the origin remote's owner, or a base-branch `owned-owners` entry — read from git, never `gh`),
// any other target is carried as a decision fact, and each failed ownership read logs one `SKIP` line.
//
// Control mode (#4620, `control-mode: on`): the Review Console resolves what policy can and CARRIES
// every item a human must decide — `pending`, `keep-staged`, `refused` — as a `carried` item whose
// decision fact lands in `{run}/packet-facts/decisions.json`. This file owns every write of that
// file (`writeDecisionFacts`): merge by id (first copy wins), under a lock, through an atomic write,
// and an unreadable existing file is never overwritten. The facts are written BEFORE the decisions
// block and console.json; a failed write exits 6, names every item it could not carry, and writes
// nothing else, so no item is ever dropped. Under `--set-item`, control mode stores a requested
// `keep-staged`/`pending` as `carried`; `--resolution carried` is the one route for a failed or
// refused `ledger-record-*` or Queue-write item, and `--ledger <path>` (a `--set-item` modifier only)
// settles the one ledger row naming `staged/{id}` (a bundle-* id: every such row, one fact, one settle per
// member — #6283) `deferred` with `carried to the acceptance packet as {factId}` — exit 5 when no row names it or the ledger path is refused (resolveLedgerPath's confinement: a
// ledger.md or *-ledger.md under the run or worktree), 3 when the settle throws. `carried` and `--ledger` need
// control mode and a ledger-record-* or bundle-* id: otherwise exit 2. Exit 6: the facts could not be written.
//
// Eighth shape (#5833): `--run <dir> --recheck-merge` — the merge site's re-read of the console's merge half
// against the decisions.md as it stands now (lib/console/resolve.js's recheckMerge). It takes no other flag than
// --run and needs no ceiling. Everything runs under `{run}/.console.lock` (fail closed). stdout is exactly one line,
// `console-resolve.js: recheck-merge merge — … (stored: {merge|leave-open|none})` (no needs-human, malformed or
// unconfirmed merge-check verdict: merge may proceed, nothing written; the suffix names console.json's stored
// resolution so `merge` here is never read as authorization while console.json reads `leave-open`) or `console-resolve.js: recheck-merge leave-open — {late verdict}` (do not merge).
// Both exit 0; EVERY other exit means "do not merge". On a hit it logs one `Merge re-check:` AUTO line (skipped when
// one naming the same verdict is already there) and, when console.json recorded `merge`, rewrites it to
// `leave-open`. An absent console.json is the local-merge case (decisions.md judged alone, console.json never
// created). When console.json recorded `merge` the stale set is always derived from the run's members (never
// stored), and members that cannot be read are a hit (`members-unresolved`). Exit 0 judged, 2 malformed, 3 --run not
// anchored, the lock not taken, decisions.md or console.json unreadable (absent is empty / the local-merge case), an
// unexpected throw inside the lock, or a write failed (the line may have landed), 5 console.json present but
// unparseable or not an object (nothing written).
// `.console.lock` excludes other console.json writers but not decisions.md verdict writers (`.decisions.lock`), so
// the re-check is a read at the routing point, not a hold through the merge.
// The resolve shape names a stale merge half on stderr (`merge half stale — {reason}`) and carries `mergeStale` in
// `--json` output when non-null; console.json's byte shape is unchanged.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveAll, renderStoredTable, recheckMerge, readMembers } = require('./lib/console/resolve');
const { resolveTarget } = require('./lib/stage-item/write');
const { stackVerdicts } = require('./lib/staged-patch/stack-check');
const { appendEntry, formatEntry, parseEntry } = require('./lib/log-decision/append');
const { resolvePolicyConfig, parseFlatLines, EMPTY_LIST_RE } = require('./lib/policy-schema');
const { UPSTREAM_FILING_TARGET, ownedOwnersList, ownerContextFromOrigin, parseTargetRepo, upstreamFilingRoute, parseStagedUpstream } = require('./lib/issues/upstream-ownership');
const { effectiveCeiling, bookkeepingPermissions } = require('./lib/issues/autonomy');
const { extractPendingGrantedAt, partitionGrantComments } = require('./lib/issues/grant-maturation');
const { writeFileAtomic } = require('./lib/atomic-write');
const { unresolvedItems, splitMissing, formatResidueLines, consoleResidueItems } = require('./lib/console/residue');
const { REWRITE_FROM, CARRY_REWRITE_FROM, REWRITE_TARGETS, REWRITE_ONLY_IN, rewriteItemResolution } = require('./lib/console/item-resolution');
const { planMemoryWrite, resolveMemoryTarget, MEMORY_REVERT_COMMAND } = require('./lib/console/memory-write');
const { decisionFactFor, upstreamDecisionFact } = require('./lib/console/decision-facts');
const { convergeResidue, composeResidueProposal, RESIDUE_FAILED } = require('./lib/console/residue-convergence');
const { withLock } = require('./lib/file-lock');
const { parseLedgerTable, resolveLedgerPath, TERMINAL_STATUSES } = require('./lib/wrap-up/ledger-write');
const { ledgerRowCells } = require('./lib/wrap-up/ledger-cells');
const { settleRow } = require('./lib/stage-item/ledger');
const { ghOptions } = require('./lib/repo-resolve');
const { sensitivePathsOf } = require('./lib/express/policy');
const { canonicalRealpath, lstatType } = require('./lib/path-guard');
const { execTimeoutMsFor } = require('./lib/shared-primitives');
const { REFERENCE_REPAIR_REASONS, stagedDiffPaths, referenceRepairFloorHits, referenceRepairFloorReason, referenceRepairHoldReason, referenceFindingsByFile } = require('./lib/console/reference-repair');

const EXIT_CARRY_FAILED = 6;
// #4621: the hold reasons a caller can report to `--upstream-route`; `external` and `owner-unresolved` are only ever the route's own verdict.
const UPSTREAM_CALLER_HOLDS = Object.freeze(['filing-failed', 'scrub-hit']);
const UPSTREAM_ROUTE_ID_RE = /^wrap-up-upstream-[^/\\]+$/;
const ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)$/;

// The `owner/name` a filed issue's URL names, parsed strictly from `https://github.com/{owner}/{name}/issues/{n}`
// and validated by the one owner/name grammar (parseTargetRepo); anything else is null, an unresolved target.
function issueUrlRepo(url) {
  const m = ISSUE_URL_RE.exec(url);
  if (m === null) return null;
  const repo = `${m[1]}/${m[2]}`;
  return parseTargetRepo(repo) === null ? null : repo;
}

const USAGE = 'usage: console-resolve.js --run <dir> --policy console-auto [--dry-run] [--json]  (exit 6: carried decision facts could not be written)\n'
  + '       console-resolve.js --run <dir> --set-item <id> --resolution keep-staged|pending|carried --reason <text> [--ledger <path>]  (carried and --ledger: control mode only, --ledger on a ledger-record-* or bundle-* id, else exit 2; exit 5 refused incl. a refused ledger path; exit 6 carried fact could not be written)\n'
  + '       console-resolve.js --run <dir> --check-repair <file> [--full]\n'
  + '       console-resolve.js --run <dir> --recheck-merge  (takes no other flag; stdout `recheck-merge merge` or `recheck-merge leave-open`, both exit 0, every other exit means do not merge; exit 2 malformed, 3 unanchored, lock not taken, decisions.md or console.json unreadable, or a write failed, 5 console.json unparseable)\n'
  + '       console-resolve.js --run <dir> --ceiling  (read-only; takes no other flag; exit 3 unanchored or policy unreadable)\n'
  + '       console-resolve.js --run <dir> --converge <items.json>  (takes no other flag; exit 2 malformed items file, 3 unanchored or decisions.md unwritable, 6 a carried fact could not be written)\n'
  + '       console-resolve.js --run <dir> --memory-write <target> --memory-dir <dir> --content-file <file>  (takes no other flag; exit 2 malformed or unreadable content file, 3 unanchored or a write failed, 5 memory write refused: target outside or unresolvable in the memory dir, or memory dir unreadable)\n'
  + '       console-resolve.js --run <dir> --upstream-route <wrap-up-upstream-id> [--hold filing-failed|scrub-hit --reason <text> | --filed <url>]  (takes no other flag; control mode only, else prints unchanged; exit 2 malformed, 3 unanchored, policy unreadable (nothing written), a decisions.md entry unwritable or the console.json rewrite threw (the fact has landed), 5 id refused (nothing written, no stdout), --filed against a hold verdict (logged, printed on stdout; it needs no staged file) or the console.json rewrite refused or console.json unreadable (the fact has landed), 6 decision fact could not be written)';

class UsageError extends Error {}

// #3370: the human-facing block for items a console left pending/keep-staged,
// or '' when there are none. Read-only: nothing here applies or resolves them.
// Items whose staged file is gone (#3772) are not counted — they are named in
// the block's `not counted` line instead.
function needsAHumanBlock(unresolved, runDir, consolePath) {
  const { items, missing } = splitMissing(unresolved, path.dirname(consolePath));
  if (items.length === 0) return '';
  const pluginRoot = path.resolve(__dirname, '..');
  const lines = formatResidueLines({ dir: runDir, consoles: [{ path: consolePath, items, missing }] }, { pluginRoot });
  lines.push(`  paths move when the run is archived; current paths: node "${pluginRoot}/bin/console-residue.js" --run "${runDir}"`);
  return `\nNeeds a human — ${items.length} item(s) this console did not resolve (never auto-applied):\n${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const out = { run: null, policy: null, dryRun: false, json: false, setItem: null, resolution: null, reason: null, checkRepair: null, full: false, ledger: null, ceiling: false, converge: null, memoryWrite: null, memoryDir: null, contentFile: null, upstreamRoute: null, hold: null, filed: null, recheckMerge: false };
  const valued = { '--upstream-route': 'upstreamRoute', '--hold': 'hold', '--filed': 'filed', '--memory-write': 'memoryWrite', '--memory-dir': 'memoryDir', '--content-file': 'contentFile', '--run': 'run', '--policy': 'policy', '--set-item': 'setItem', '--resolution': 'resolution', '--reason': 'reason', '--check-repair': 'checkRepair', '--ledger': 'ledger', '--converge': 'converge' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (Object.prototype.hasOwnProperty.call(valued, flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      out[valued[flag]] = value;
      i += 1;
    } else if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--json') out.json = true;
    else if (flag === '--full') out.full = true;
    else if (flag === '--ceiling') out.ceiling = true;
    else if (flag === '--recheck-merge') out.recheckMerge = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (!out.run) throw new UsageError('--run <dir> is required');
  if (out.recheckMerge) {
    const { run: _run, recheckMerge: _rm, ...others } = out;
    if (Object.values(others).some((v) => v !== null && v !== false)) throw new UsageError('--recheck-merge takes no other flag than --run');
    return out;
  }
  if (out.upstreamRoute === null && (out.hold !== null || out.filed !== null)) throw new UsageError('--hold and --filed require --upstream-route');
  if (out.upstreamRoute !== null) {
    if (out.policy !== null || out.dryRun || out.json || out.setItem !== null || out.resolution !== null || out.checkRepair !== null || out.full || out.ledger !== null || out.ceiling || out.converge !== null || out.memoryWrite !== null || out.memoryDir !== null || out.contentFile !== null) throw new UsageError('--upstream-route takes no other flag than --run, --hold, --reason and --filed');
    if (out.upstreamRoute === '') throw new UsageError('--upstream-route requires a non-empty id');
    if (out.hold !== null && out.filed !== null) throw new UsageError('--hold and --filed are exclusive');
    if (out.hold !== null) {
      if (!UPSTREAM_CALLER_HOLDS.includes(out.hold)) throw new UsageError(`--hold must be one of ${UPSTREAM_CALLER_HOLDS.join(', ')} (got ${out.hold})`);
      if (out.reason === null || out.reason.trim() === '') throw new UsageError('--hold requires --reason (non-empty)');
    } else if (out.reason !== null) throw new UsageError('--reason requires --hold under --upstream-route');
    if (out.filed !== null && !/^\S+$/.test(out.filed)) throw new UsageError('--filed requires a single-line URL with no whitespace');
    return out;
  }
  if (out.memoryWrite !== null || out.memoryDir !== null || out.contentFile !== null) {
    if (out.memoryWrite === null || out.memoryDir === null || out.contentFile === null) throw new UsageError('--memory-write, --memory-dir and --content-file go together');
    if (out.memoryWrite === '' || out.memoryDir === '' || out.contentFile === '') throw new UsageError('--memory-write, --memory-dir and --content-file require non-empty values');
    if (out.policy !== null || out.dryRun || out.json || out.setItem !== null || out.resolution !== null || out.reason !== null || out.checkRepair !== null || out.full || out.ledger !== null || out.ceiling || out.converge !== null) throw new UsageError('--memory-write takes no other flag than --run, --memory-dir and --content-file');
    return out;
  }
  if (out.ceiling) {
    if (out.policy !== null || out.dryRun || out.json || out.setItem !== null || out.resolution !== null || out.reason !== null || out.checkRepair !== null || out.full || out.ledger !== null || out.converge !== null) throw new UsageError('--ceiling takes no other flag than --run');
    return out;
  }
  if (out.converge !== null) {
    if (out.policy !== null || out.dryRun || out.json || out.setItem !== null || out.resolution !== null || out.reason !== null || out.checkRepair !== null || out.full || out.ledger !== null) throw new UsageError('--converge takes no other flag than --run (--dry-run included)');
    if (out.converge === '') throw new UsageError('--converge requires a non-empty file');
    return out;
  }
  if (out.full && out.checkRepair === null) throw new UsageError('--full requires --check-repair');
  if (out.checkRepair !== null) {
    if (out.policy !== null || out.dryRun || out.json || out.setItem !== null || out.resolution !== null || out.reason !== null || out.ledger !== null) throw new UsageError('--check-repair takes none of --policy, --dry-run, --json, --set-item, --resolution, --reason, --ledger');
    if (out.checkRepair === '') throw new UsageError('--check-repair requires a non-empty file');
    return out;
  }
  if (out.setItem !== null) {
    if (out.policy !== null || out.dryRun || out.json) throw new UsageError('--set-item takes none of --policy, --dry-run, --json');
    if (out.setItem === '') throw new UsageError('--set-item requires a non-empty id');
    if (!out.resolution || !out.reason) throw new UsageError('--set-item requires --resolution and --reason (both non-empty)');
    if (out.ledger === '') throw new UsageError('--ledger requires a non-empty path');
    if (!REWRITE_TARGETS.includes(out.resolution)) throw new UsageError(`--resolution must be one of ${Object.keys(REWRITE_FROM).join(', ')} (got ${out.resolution})`);
    return out;
  }
  if (out.resolution !== null || out.reason !== null) throw new UsageError('--resolution and --reason require --set-item');
  if (out.ledger !== null) throw new UsageError('--ledger requires --set-item');
  if (out.policy !== 'console-auto') throw new UsageError(`--policy must be console-auto (got ${out.policy || 'nothing'})`);
  return out;
}

// Exported for #5050's per-command bound tests (tests/bin-lib/console/resolve.test.js) — keep the export.
function defaultExecFile(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: execTimeoutMsFor(cmd), ...opts, windowsHide: true });
}

// The ceiling AND the veto window, resolved in-process with the same precedence
// resolve-policy.js applies (run config over project policy): `resolvePolicyKeys`
// already folds config.yml over policy.yml, so the single resolved value is what
// effectiveCeiling sees as the autonomy entry (it also composes `control-mode`).
// One call, all keys — a run that widened `grant-veto-window-hours` must not
// have evaluateMaturation fall back to its own 24h default the way this CLI's
// first cut did.
//
// `strict` (the `--ceiling` and `--upstream-route` shapes): an absent file (ENOENT/ENOTDIR) still reads as unset, but any
// other read failure, or an `autonomy`/`control-mode` entry carrying an `error`, throws — a policy that
// cannot be read must never print as `supervised`. The other shapes keep the tolerant read. (The `.error`
// entry only arises if `autonomy` or `control-mode` is retired or removed from the schema — fail-closed
// against schema drift.)
function readPolicy({ execFile, cwd, runDir, strict = false }) {
  const git = (args) => execFile('git', args, { cwd });
  const readFile = (p) => {
    try { return fs.readFileSync(p, 'utf8'); } catch (err) {
      if (strict && !(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) throw err;
      return null;
    }
  };
  const { result } = resolvePolicyConfig({ git, readFile, runDir, keys: ['autonomy', 'control-mode', 'grant-veto-window-hours', 'merge-sensitive-paths'] });
  if (strict) {
    for (const key of ['autonomy', 'control-mode']) {
      if (result[key] && result[key].error !== undefined) throw new Error(`${key} policy entry is unreadable: ${result[key].error}`);
    }
  }
  const valueOf = (key) => { const entry = result[key]; return entry && entry.error === undefined ? entry.value : null; };
  const raw = valueOf('grant-veto-window-hours');
  const veto = raw === null || raw === undefined ? NaN : Number(raw);
  // An unreadable `merge-sensitive-paths` is null, never []: the reference-repair floor holds on it (#4636).
  const sensitiveEntry = result['merge-sensitive-paths'];
  const sensitivePaths = sensitiveEntry && sensitiveEntry.error === undefined ? sensitivePathsOf(sensitiveEntry) : null;
  const { ceiling, controlMode, source: ceilingSource } = effectiveCeiling({ autonomyEntry: result.autonomy, controlModeEntry: result['control-mode'] });
  return { ceiling, controlMode, ceilingSource, vetoWindowHours: Number.isFinite(veto) ? veto : undefined, sensitivePaths };
}

// #4621: what the resolver needs to route a wrap-up upstream-feedback item by repo ownership, read from git
// only (never `gh`, and never the authenticated account): the `origin` remote's owner, and `owned-owners`
// from the BASE branch's policy.yml — `origin/{branch}`, so a change in the branch under review cannot widen
// it. The base branch is `origin/HEAD`'s, else `main`.
// Called lazily (only when an upstream item would file) and never throws: every failed read becomes a note,
// `{condition} → fallback: {what the resolver does instead}`, that the caller logs as a SKIP line. A bad
// `owned-owners` entry is ignored on its own (ownedOwnersList), never the whole list.
const NOTE_TEXT_MAX = 160;

function oneLineNote(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > NOTE_TEXT_MAX ? `${text.slice(0, NOTE_TEXT_MAX)}…` : text;
}

function failureText(err) {
  const detail = err && (err.stderr || err.message);
  return oneLineNote(detail || err);
}

function readUpstreamOwnership({ execFile, cwd }) {
  const notes = [];
  const note = (condition, fallback) => { notes.push(`${condition} → fallback: ${fallback}`); };
  const git = (args) => String(execFile('git', args, { cwd }));
  let ownerContext = null;
  try {
    ownerContext = ownerContextFromOrigin(git(['remote', 'get-url', 'origin']).trim());
    if (ownerContext === null) note('the origin remote does not name a valid owner', 'targets held');
  } catch (err) {
    note(`the origin remote could not be read (${failureText(err)})`, 'targets held');
  }

  // Never the checkout's own `integration-branch` policy value or run config: a PR controls both, so it could
  // pick the branch whose policy decides ownership (task-review ruling).
  let branch = 'main';
  try {
    const head = git(['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim().replace(/^origin\//, '');
    if (head !== '' && head !== 'HEAD') branch = head;
  } catch (err) {
    branch = 'main';
    note(`origin/HEAD could not be resolved (${failureText(err)})`, 'the base branch read as main');
  }

  let ownedOwners = [];
  const policyRef = `origin/${branch}:.claude-tweaks/policy.yml`;
  try {
    const value = parseFlatLines(git(['show', policyRef]))['owned-owners'];
    // The literal `[]` (inner whitespace allowed) is the schema's empty list, not an entry.
    if (value !== undefined && !EMPTY_LIST_RE.test(value)) {
      const list = ownedOwnersList(value);
      ownedOwners = list.owners;
      for (const entry of list.ignored) note(`the owned-owners entry ${JSON.stringify(oneLineNote(entry))} is not a valid owner`, 'the entry ignored');
    }
  } catch (err) {
    ownedOwners = [];
    note(`base-branch policy ${policyRef} could not be read (${failureText(err)})`, 'owned-owners read as []');
  }
  return { ownerContext, ownedOwners, notes };
}

// Live grants per member — the Authorization read is never a snapshot
// (auto-merge-short-circuit.md's Authorization layer): labels and, for a
// pending grant, the grant timestamp from the audit-trail comment marker.
function ghReadGrants(execFile, cwd) {
  return (numbers) => {
    const out = {};
    for (const n of numbers) {
      const args = ['issue', 'view', String(n), '--json', 'labels,comments'];
      const raw = execFile('gh', args, ghOptions(args, { cwd }));
      const parsed = JSON.parse(raw);
      const labels = (parsed.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
      // #3358: trusted comments only; each untrusted marker comment passed over is named.
      const { bodies, skippedUntrusted } = partitionGrantComments(parsed.comments);
      out[n] = { labels, pendingSince: extractPendingGrantedAt(bodies), skippedUntrusted };
    }
    return out;
  };
}

function gitApplyCheck(execFile, cwd) {
  return (patchPath) => {
    try { execFile('git', ['apply', '--check', patchPath], { cwd }); return { ok: true }; } catch (err) {
      const msg = err && (err.stderr || err.message) ? String(err.stderr || err.message).trim() : 'git apply --check failed';
      return { ok: false, error: msg };
    }
  };
}

// One stacked verdict per staged .patch (#3290): the paths arrive in apply order and a re-derived
// patch is ok at its position on top of the earlier ones. A walk that cannot run fails closed —
// every patch reads as not applying, the same route a failing per-patch check takes.
function checkPatchStack(worktree) {
  return (paths) => {
    if (paths.length === 0) return {};
    try {
      return stackVerdicts({ worktree, patches: paths });
    } catch (err) {
      const error = `stacked check could not run: ${err && err.message ? err.message : err}`;
      return Object.fromEntries(paths.map((p) => [path.basename(p), { ok: false, error }]));
    }
  };
}

// Live PR state for a drain-overlap hold's re-verification (resolve.js's
// mergeResolution) — mirrors ghReadGrants's shape: one execFile call, thrown
// errors propagate so resolve.js can fail closed to leave-open on a
// transport failure rather than silently treating it as resolved.
function ghCheckPrState(execFile, cwd) {
  return (prNumber) => {
    const args = ['pr', 'view', String(prNumber), '--json', 'state'];
    const raw = execFile('gh', args, ghOptions(args, { cwd }));
    return JSON.parse(raw).state;
  };
}

// #4620: the one writer of `{runDir}/packet-facts/decisions.json`. Reads the file directly (ENOENT/ENOTDIR
// is empty; unparseable or not an array throws — an existing file is never overwritten blind), merges by
// `id` with the first copy winning, and writes through writeFileAtomic under a fail-closed lock. Throws on
// any failure so a caller never believes an item was carried when it was not.
function writeDecisionFacts(runDir, facts) {
  const dir = path.join(runDir, 'packet-facts');
  const file = path.join(dir, 'decisions.json');
  fs.mkdirSync(dir, { recursive: true });
  return withLock(path.join(dir, '.decisions.lock'), () => {
    let existing = [];
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
      if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) throw err;
    }
    if (raw !== null) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (err) { throw new Error(`${file} does not parse as JSON (${err.message}) — not overwritten`); }
      if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array — not overwritten`);
      existing = parsed;
    }
    const seen = new Set(existing.map((f) => (f && typeof f === 'object' ? f.id : undefined)).filter((id) => id !== undefined));
    const added = [];
    for (const fact of facts) {
      if (seen.has(fact.id)) continue;
      seen.add(fact.id);
      added.push(fact);
    }
    if (added.length > 0) writeFileAtomic(file, `${JSON.stringify([...existing, ...added], null, 2)}\n`);
    return { path: file, added: added.length };
  }, { failClosed: true });
}

function carryFailure(stderr, ids, err) {
  stderr(`console-resolve.js: could not carry ${ids.length} item(s) to the acceptance packet (${err && err.message ? err.message : err}) — ${ids.join(', ')}\n`);
  return EXIT_CARRY_FAILED;
}

// Control mode as the carry paths use it: on AND consoleAutoResolve granted, the one gate controlModeGate holds
// for the other shapes (an explicit lower autonomy tier keeps the human-present console, so nothing carries);
// a read that throws counts as off.
function controlModeOn({ execFile, cwd, runDir }) {
  try {
    const { ceiling, controlMode } = readPolicy({ execFile, cwd: cwd(), runDir });
    return controlMode === true && bookkeepingPermissions(ceiling).consoleAutoResolve === true;
  } catch { return false; }
}

// #4620 review: `--memory-write` and `--converge` act without a human, so the one control-mode gate the
// resolve shape uses (control mode on and consoleAutoResolve granted, whatever set the ceiling) is held here
// in code, not left to the prose that tells the agent when to call them. Exit 4, as the resolve shape's own
// ceiling refusal; a policy that cannot be read fails closed through the same supervised default.
function controlModeGate({ shape, runDir, stderr, execFile, cwd }) {
  let granted = false;
  try {
    const { ceiling, controlMode } = readPolicy({ execFile, cwd: cwd(), runDir });
    granted = controlMode === true && bookkeepingPermissions(ceiling).consoleAutoResolve === true;
  } catch { granted = false; }
  if (granted) return null;
  stderr(`console-resolve.js: ${shape} needs control mode on with consoleAutoResolve granted — nothing written\n`);
  return 4;
}

// The one ledger row a carried `ledger-record-*` item settles: the row whose Resolution names `staged/{id}`.
// { rows: [{ number, resolution }] } of the rows naming it, plus `already`: the numbers of rows that
// already read the carried text for this fact.
function findCarryRows(ledgerText, id, factId) {
  const table = parseLedgerTable(ledgerText);
  const named = new RegExp(`\\bstaged/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\w)`);
  const carriedText = `carried to the acceptance packet as ${factId}`;
  const rows = [];
  const already = [];
  for (const [number, line] of table.rows) {
    const cells = ledgerRowCells(line);
    const resolution = cells.slice(4).join('|');
    if (named.test(resolution)) rows.push({ number, resolution, status: String(cells[3] || '').trim().toLowerCase() });
    else if (resolution.includes(carriedText)) already.push(number);
  }
  return { rows, already };
}

// `--set-item … carried` (also what a requested keep-staged/pending becomes under control mode): the item's
// decision fact first, then — for a `ledger-record-*` or `bundle-*` item with `--ledger` — its ledger row (a bundle:
// every member row, #6283), and only then the stored rewrite. Returns an exit code, or null when the item does not qualify so the plain path refuses or
// reports it exactly as it always has.
function carryItem(o, runDir, { stdout, stderr, now, cwd }) {
  const consolePath = path.join(runDir, 'console.json');
  let stored = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(consolePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.mode === 'auto-resolve' && Array.isArray(parsed.items)) {
      const matches = parsed.items.filter((i) => i && i.id === o.setItem);
      if (matches.length === 1) [stored] = matches;
    }
  } catch { stored = null; }
  if (stored === null) return null;
  const alreadyCarried = stored.resolution === 'carried';
  if (!alreadyCarried) {
    if (o.resolution === 'carried') {
      if (!CARRY_REWRITE_FROM.includes(stored.resolution)) return null;
    } else {
      // A requested keep-staged/pending keeps its own source rules; only a rewrite it would have made becomes a carry.
      if (stored.resolution === o.resolution || !REWRITE_FROM[o.resolution].includes(stored.resolution)) return null;
      if (REWRITE_ONLY_IN[o.resolution] && stored.section !== REWRITE_ONLY_IN[o.resolution]) return null;
    }
  }
  const staged = lstatType(path.join(runDir, 'staged', o.setItem)).type === 'file';
  const fact = decisionFactFor({
    id: o.setItem, section: stored.section, resolution: alreadyCarried ? (stored.carriedFrom || stored.resolution) : stored.resolution, reason: o.reason,
  }, { runDir, staged });
  const carriedText = `carried to the acceptance packet as ${fact.id}`;

  // The ledger row is located (read-only) before anything is written, so a refusal leaves no orphan fact.
  let ledger = null;
  const isBundle = o.setItem.startsWith('bundle-');
  if (o.ledger !== null && (isBundle || o.setItem.startsWith('ledger-record-'))) {
    // The same confinement every other ledger writer applies (hooks.js ledger-row): a ledger.md or *-ledger.md
    // file under the run directory or the worktree. A refused path is exit 5, with nothing written.
    const resolved = resolveLedgerPath({ runDir, worktree: cwd(), explicit: path.resolve(cwd(), o.ledger) });
    if (!resolved.ok) {
      stderr(`console-resolve.js: ledger ${resolved.reason}${resolved.detail ? ` (${resolved.detail})` : ''}: ${o.ledger} — nothing written\n`);
      return 5;
    }
    const ledgerPath = resolved.path;
    let text;
    try { text = fs.readFileSync(ledgerPath, 'utf8'); } catch (err) {
      stderr(`console-resolve.js: could not read ledger ${ledgerPath}: ${err && err.message ? err.message : err} — nothing written\n`);
      return 3;
    }
    let found;
    try { found = findCarryRows(text, o.setItem, fact.id); } catch (err) {
      stderr(`console-resolve.js: could not parse ledger ${ledgerPath}: ${err && err.message ? err.message : err} — nothing written\n`);
      return 3;
    }
    if (found.rows.length === 0 && found.already.length === 0) {
      stderr(`console-resolve.js: no ledger row names staged/${o.setItem} in ${ledgerPath} — nothing written\n`);
      return 5;
    }
    if (found.rows.length > 1 && !isBundle) {
      stderr(`console-resolve.js: ${found.rows.length} ledger rows name staged/${o.setItem} in ${ledgerPath} (#${found.rows.map((r) => r.number).join(', #')}) — nothing written\n`);
      return 5;
    }
    // A row already final in a terminal status the carry cannot settle (settleRow would throw after the fact landed) is refused here;
    // any other status (open, empty, malformed) falls through to settleRow's own handling.
    const stuck = found.rows.find((r) => TERMINAL_STATUSES.includes(r.status) && r.status !== 'deferred');
    if (stuck) {
      stderr(`console-resolve.js: ledger row #${stuck.number} naming staged/${o.setItem} is already ${stuck.status} (terminal) — nothing written\n`);
      return 5;
    }
    // A bundle settles every member row (one decision fact, one settle per row); a ledger-record-* item has exactly one.
    ledger = { ledgerPath, rows: found.rows.map((r) => r.number), alreadyRows: found.already };
  }

  try { writeDecisionFacts(runDir, [fact]); } catch (err) { return carryFailure(stderr, [o.setItem], err); }

  let ledgerNote = '';
  let ledgerChanged = false;
  if (ledger !== null) {
    const list = (rows) => `ledger row${rows.length > 1 ? 's' : ''} #${rows.join(', #')}`;
    if (ledger.rows.length === 0) {
      ledgerNote = `${list(ledger.alreadyRows)} already carried`;
    } else {
      for (const [i, row] of ledger.rows.entries()) {
        try {
          settleRow({ runDir, ledgerPath: ledger.ledgerPath, row, status: 'deferred', resolution: carriedText });
        } catch (err) {
          stderr(`console-resolve.js: could not settle ledger row #${row} in ${ledger.ledgerPath}: ${err && err.message ? err.message : err} — item ${o.setItem} unchanged${i > 0 ? `; ${list(ledger.rows.slice(0, i))} already settled` : ''}\n`);
          return 3;
        }
        ledgerChanged = true;
      }
      ledgerNote = `${list(ledger.rows)} settled`;
    }
  }

  const at = new Date(now()).toISOString();
  const why = `${carriedText} — ${o.reason}`;
  let r;
  try {
    r = rewriteItemResolution({ consolePath, id: o.setItem, resolution: 'carried', reason: why, at });
  } catch (err) {
    stderr(`console-resolve.js: could not write ${consolePath}: ${err && err.message ? err.message : err}\n`);
    return 3;
  }
  if (r.status === 'refused') {
    // The fact (and possibly the ledger row) already landed: say so, never "nothing written".
    stderr(`console-resolve.js: ${r.why} — the decision fact ${fact.id} is in decisions.json${ledgerChanged ? ` and ${ledgerNote}` : ''}; the console item is unchanged\n`);
    return 5;
  }
  // One helper for both paths: appends the AUTO line; returns null, or the message a failed append leaves.
  const logLine = (text) => {
    try {
      appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text, reversibility: 'n/a' }) });
      return null;
    } catch (err) { return err && err.message ? err.message : String(err); }
  };
  const unchanged = r.status === 'unchanged';
  // A repeat call that changed neither the item nor the row logs nothing: the report is stdout's.
  if (!unchanged || ledgerChanged) {
    const text = unchanged
      ? `Console item ${o.setItem} (${r.item.section}): already carried; ${ledgerNote}`
      : `Console item ${o.setItem} (${r.item.section}): rewritten ${r.from} → carried after execution — ${why}${ledgerNote ? `; ${ledgerNote}` : ''}`;
    const failure = logLine(text);
    if (failure !== null) {
      stderr(`console-resolve.js: ${o.setItem} ${unchanged ? 'already carried' : `rewritten ${r.from} → carried in ${consolePath}`}${ledgerNote ? `; ${ledgerNote}` : ''}, but the decisions.md entry could not be written (${failure})\n`);
      return 3;
    }
  }
  if (unchanged) {
    stdout(`console-resolve.js: ${o.setItem} already carried${ledgerNote ? `; ${ledgerNote}` : ' — nothing rewritten'}\n`);
    return 0;
  }
  stdout(`console-resolve.js: ${o.setItem} rewritten ${r.from} → carried in ${consolePath}${ledgerNote ? `; ${ledgerNote}` : ''}\n`);
  return 0;
}

// #4170: the `--set-item` shape — one stored item rewritten after its execution failed. Exit 0 rewrote or
// already there, 3 the write threw, 5 refused, 6 (control mode) the carried fact could not be written. Runs
// before the ceiling check: it only records what happened.
function setItem(o, runDir, { stdout, stderr, now, execFile, cwd }) {
  const usage = (message) => { stderr(`console-resolve.js: ${message}\n${USAGE}\n`); return 2; };
  const carryable = o.resolution === 'carried' || o.resolution === 'keep-staged' || o.resolution === 'pending';
  const controlMode = carryable && controlModeOn({ execFile, cwd, runDir });
  // `carried` is control mode's resolution: with it off the value is refused as it was before this record.
  if (o.resolution === 'carried' && !controlMode) return usage(`--resolution must be one of ${Object.keys(REWRITE_FROM).join(', ')} (got carried)`);
  if (o.ledger !== null) {
    if (!o.setItem.startsWith('ledger-record-') && !o.setItem.startsWith('bundle-')) return usage(`--ledger applies only to a ledger-record-* item or a bundle-* item (got ${o.setItem})`);
    if (!controlMode) return usage('--ledger applies only to a carried item, which needs control mode');
  }
  if (controlMode) {
    const code = carryItem(o, runDir, { stdout, stderr, now, cwd });
    if (code !== null) return code;
  }
  if (o.ledger !== null) { stderr(`console-resolve.js: item ${o.setItem} cannot be carried (it is not a rewritable item) — --ledger not applied, nothing written\n`); return 5; }
  const consolePath = path.join(runDir, 'console.json');
  const at = new Date(now()).toISOString();
  let r;
  try {
    r = rewriteItemResolution({ consolePath, id: o.setItem, resolution: o.resolution, reason: o.reason, at });
  } catch (err) {
    stderr(`console-resolve.js: could not write ${consolePath}: ${err && err.message ? err.message : err}\n`);
    return 3;
  }
  if (r.status === 'refused') { stderr(`console-resolve.js: ${r.why} — nothing written\n`); return 5; }
  if (r.status === 'unchanged') { stdout(`console-resolve.js: ${o.setItem} already ${o.resolution} — nothing rewritten\n`); return 0; }
  const text = `Console item ${o.setItem} (${r.item.section}): rewritten ${r.from} → ${o.resolution} after execution — ${o.reason}`;
  try {
    appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text, reversibility: 'n/a' }) });
  } catch (err) {
    stderr(`console-resolve.js: ${o.setItem} rewritten ${r.from} → ${o.resolution} in ${consolePath}, but the decisions.md entry could not be written (${err && err.message ? err.message : err})\n`);
    return 3;
  }
  stdout(`console-resolve.js: ${o.setItem} rewritten ${r.from} → ${o.resolution} in ${consolePath}\n`);
  return 0;
}

// #4636: the `--check-repair` shape — the reference-repair floor (or, with `--full`, the whole hold
// rule) over one file, writing nothing. Exit 0 clear, 2 `--full` on a file outside `{run}/staged/`,
// 5 held, unclassified or unreadable. Runs before the ceiling check: it only reads.
function checkRepair(o, runDir, { stdout, stderr, execFile, cwd }) {
  const file = o.checkRepair;
  const real = (p) => canonicalRealpath(p) || path.resolve(p);
  // `--full` pairs the file with its engine-state findings by basename (referenceFindingsByFile), so a
  // same-named file elsewhere would inherit a real staged file's findings and their `hold: false`.
  if (o.full && real(path.dirname(path.resolve(file))) !== real(path.join(runDir, 'staged'))) {
    stderr(`console-resolve.js: --full reads only a file directly in ${path.join(runDir, 'staged')} (got ${file})\n${USAGE}\n`);
    return 2;
  }
  let text = null;
  let readError = false;
  try { text = fs.readFileSync(file, 'utf8'); } catch { readError = true; }
  // A policy that cannot be read leaves the merge-sensitive list unreadable (null), which holds.
  let sensitivePaths = null;
  try { ({ sensitivePaths } = readPolicy({ execFile, cwd: cwd(), runDir })); } catch { sensitivePaths = null; }
  let reason;
  if (o.full) {
    let engineState = null;
    try { engineState = JSON.parse(fs.readFileSync(path.join(runDir, 'engine-state.json'), 'utf8')); } catch { engineState = null; }
    reason = referenceRepairHoldReason({ text, readError }, referenceFindingsByFile(engineState).get(path.basename(file)) || [], sensitivePaths);
  } else {
    reason = readError ? REFERENCE_REPAIR_REASONS.UNREADABLE : referenceRepairFloorReason(text, sensitivePaths);
  }
  if (reason === null) { stdout(`console-resolve.js: ${file} clear\n`); return 0; }
  stdout(`console-resolve.js: ${file} ${reason}\n`);
  // An unreadable policy holds every repair the same way an unparseable diff does; name it so a human
  // chasing a repair that holds on every run looks at `merge-sensitive-paths`, not at the diff.
  if (sensitivePaths === null) stdout('console-resolve.js: note the merge-sensitive-paths policy could not be read, so no repair clears\n');
  if (text !== null) {
    for (const hit of referenceRepairFloorHits(stagedDiffPaths(text), sensitivePaths)) stdout(`console-resolve.js: hit ${hit.path} (${hit.why})\n`);
  }
  return 5;
}

// #4620: the `--ceiling` shape — the effective ceiling, read-only. Runs after the anchoring check; a policy
// read that throws is exit 3 with its own line, never a `supervised` guess.
function ceilingQuery(runDir, { stdout, stderr, execFile, cwd }) {
  let policy;
  try { policy = readPolicy({ execFile, cwd: cwd(), runDir, strict: true }); } catch (err) {
    stderr(`console-resolve.js: ceiling unreadable (${err && err.message ? err.message : err})\n`);
    return 3;
  }
  const { ceiling, controlMode, ceilingSource } = policy;
  stdout(`console-resolve.js: ceiling ${ceiling} consoleAutoResolve ${bookkeepingPermissions(ceiling).consoleAutoResolve === true} control-mode ${controlMode === true ? 'on' : 'off'} source ${ceilingSource}\n`);
  return 0;
}

// The `--converge` items file: null and a problem when it is not a well-formed array of residue items.
function readResidueItems(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    return { items: null, problem: `${file} could not be read as JSON (${err && err.message ? err.message : err})` };
  }
  if (!Array.isArray(parsed)) return { items: null, problem: `${file} is not a JSON array` };
  const seen = new Set();
  for (const [i, it] of parsed.entries()) {
    const bad = (why) => ({ items: null, problem: `${file} item ${i} ${why}` });
    if (!it || typeof it !== 'object' || Array.isArray(it)) return bad('is not an object');
    if (typeof it.id !== 'string' || it.id.trim() === '' || /[\r\n]/.test(it.id)) return bad('has no non-empty single-line string id');
    if (seen.has(it.id)) return bad(`repeats the id ${it.id}`);
    seen.add(it.id);
    if (it.source !== 'ledger' && it.source !== 'insight') return bad('has a source other than ledger or insight');
    if (typeof it.text !== 'string' || it.text.trim() === '') return bad('has no non-empty string text');
    if (typeof it.status !== 'string' || it.status === '') return bad('has no string status');
    if (it.deferReason !== undefined && typeof it.deferReason !== 'string') return bad('has a deferReason that is not a string');
    if (it.belowFloor !== undefined && typeof it.belowFloor !== 'boolean') return bad('has a belowFloor that is not a boolean');
    if (it.filingFailed !== undefined && typeof it.filingFailed !== 'boolean') return bad('has a filingFailed that is not a boolean');
  }
  return { items: parsed, problem: null };
}

// #4620: the `--converge` shape — every residue item ends resolved, filed, digested or carried. The carried
// facts are written in one call; a failed write turns every carried item `failed` and exits 6, so no item is
// reported carried without its fact. Gated in run() by controlModeGate, not left to the caller.
function converge(o, runDir, { stdout, stderr, now, cwd }) {
  const file = path.resolve(cwd(), o.converge);
  const { items, problem } = readResidueItems(file);
  if (items === null) { stderr(`console-resolve.js: --converge ${problem}\n${USAGE}\n`); return 2; }
  const sectionOf = (item) => (item.source === 'insight' ? 'Reflection insights' : 'Ledger residue');
  const carry = (item) => decisionFactFor({ id: item.id, section: sectionOf(item), resolution: 'pending', reason: item.text }, { runDir, staged: false });
  const results = convergeResidue(items, { compose: composeResidueProposal, carry });
  const facts = results.filter((r) => r.state === 'carried').map((r) => r.fact);
  let writeError = null;
  if (facts.length > 0) {
    try { writeDecisionFacts(runDir, facts); } catch (err) { writeError = err; }
  }
  const out = results.map((r) => {
    if (r.state === 'carried' && writeError !== null) return { id: r.id, state: RESIDUE_FAILED, error: writeError && writeError.message ? writeError.message : String(writeError) };
    if (r.state === 'carried') return { id: r.id, state: r.state, factId: r.fact.id };
    if (r.state === 'filed') return { id: r.id, state: r.state, proposal: r.proposal };
    if (r.state === RESIDUE_FAILED) return { id: r.id, state: r.state, error: r.error };
    return { id: r.id, state: r.state };
  });
  const failed = out.filter((r) => r.state === RESIDUE_FAILED).map((r) => r.id);
  stdout(`${JSON.stringify({ items: out, failed }, null, 2)}\n`);
  const sourceOf = new Map(items.map((it) => [it.id, it.source]));
  const reversibility = (state) => (state === 'filed' ? 'high' : 'n/a');
  // A failed item is a degrade, logged `SKIP` in _shared/auto-decision-log.md's Degrade-trace shape (never `AUTO`).
  const lines = out.map((r) => (r.state === RESIDUE_FAILED
    ? formatEntry({ status: 'SKIP', now: now(), step: 'Residue convergence (degraded)', text: `condition: Residue ${r.id} (${sourceOf.get(r.id)}) failed — ${r.error} → fallback: not converged; the failure card names it`, reversibility: 'n/a' })
    : formatEntry({ status: 'AUTO', now: now(), step: 'Residue convergence', text: `Residue ${r.id} (${sourceOf.get(r.id)}): ${r.state}${r.factId ? ` as ${r.factId}` : ''}`, reversibility: reversibility(r.state) })));
  let logError = null;
  if (lines.length > 0) {
    try { appendEntry({ runDir, section: '/wrap-up', entry: lines.join('\n') }); } catch (err) { logError = err; }
  }
  if (failed.length > 0) {
    const why = writeError !== null ? (writeError.message || String(writeError)) : out.filter((r) => r.state === RESIDUE_FAILED).map((r) => `${r.id}: ${r.error}`).join('; ');
    carryFailure(stderr, failed, { message: why });
  }
  if (logError !== null) {
    stderr(`console-resolve.js: --converge printed ${out.length} item state(s), but the decisions.md entries could not be written (${logError.message || logError})\n`);
    if (failed.length === 0) return 3;
  }
  return failed.length > 0 ? EXIT_CARRY_FAILED : 0;
}

// #4620: the `--memory-write` shape — one memory file written automatically, with a reversible log entry.
// Order: resolve (refuse outside the memory dir), read the prior, back it up when the diff is over the cap,
// write the target, then log. A failed target write logs nothing; a failed log names the written path.
function memoryWrite(o, runDir, { stdout, stderr, now, cwd }) {
  const memoryDir = path.resolve(cwd(), o.memoryDir);
  const refused = (why) => { stderr(`console-resolve.js: memory write refused (${why}) — nothing written\n`); return 5; };
  const resolved = resolveMemoryTarget({ memoryDir, target: o.memoryWrite });
  if (!resolved.ok) return refused(resolved.why);
  let content;
  try { content = fs.readFileSync(path.resolve(cwd(), o.contentFile), 'utf8'); } catch (err) {
    stderr(`console-resolve.js: --content-file ${o.contentFile} could not be read (${err && err.message ? err.message : err})\n${USAGE}\n`);
    return 2;
  }
  let priorText = null;
  try { priorText = fs.readFileSync(resolved.path, 'utf8'); } catch (err) {
    if (!(err && err.code === 'ENOENT')) {
      stderr(`console-resolve.js: could not read ${resolved.path} (${err && err.message ? err.message : err}) — nothing written\n`);
      return 3;
    }
  }
  const plan = planMemoryWrite({ memoryDir, target: o.memoryWrite, content, priorText });
  if (!plan.ok) return refused(plan.why);
  let backup = null;
  let failing = plan.path;
  try {
    if (plan.overCap && priorText !== null) {
      failing = path.join(runDir, 'staged', `.memory-prior-${plan.priorHash.slice(0, 12)}.md`);
      fs.mkdirSync(path.dirname(failing), { recursive: true });
      writeFileAtomic(failing, priorText);
      backup = failing;
      failing = plan.path;
    }
    writeFileAtomic(plan.path, content);
  } catch (err) {
    stderr(`console-resolve.js: could not write ${failing} (${err && err.message ? err.message : err}) — no decisions.md entry written\n`);
    return 3;
  }
  const head = `Memory write ${plan.path}: prior sha256 ${plan.priorHash}; to reverse, strip the 4-space indent from the diff below into a patch file, then run ${MEMORY_REVERT_COMMAND} {patch} from the memory directory`;
  const indented = plan.diff.replace(/\n$/, '').split('\n').map((l) => `    ${l}`).join('\n');
  let text;
  let block = '';
  if (!plan.overCap) { text = head; block = `\n${indented}`; }
  else if (backup !== null) text = `Memory write ${plan.path}: prior sha256 ${plan.priorHash}; diff over ${Buffer.byteLength(plan.diff)} bytes not inlined, prior content stored at ${backup}`;
  else text = `Memory write ${plan.path}: prior sha256 none; created, diff over the cap not inlined — reverse by deleting the file`;
  try {
    appendEntry({ runDir, section: '/wrap-up', entry: `${formatEntry({ status: 'AUTO', now: now(), step: 'Memory write', text, reversibility: 'high' })}${block}` });
  } catch (err) {
    stderr(`console-resolve.js: wrote ${plan.path}, but the decisions.md entry could not be written (${err && err.message ? err.message : err})\n`);
    return 3;
  }
  stdout(`console-resolve.js: wrote ${plan.path} (prior sha256 ${plan.priorHash})\n`);
  return 0;
}

// #4621: the `--upstream-route` shape — one wrap-up upstream-feedback item routed by repo ownership under control
// mode, at every ceiling (and the agent's report of a filing that failed, hit the scrub, or succeeded). Exit 0 routed,
// 3 the policy could not be read, a decisions.md entry could not be written or the console.json rewrite threw, 5 the
// id refused, `--filed` against a hold verdict or the console.json rewrite refused or unreadable, 6 the decision fact could not
// be written. See the header's seventh shape for the whole contract, including which exits follow a landed fact.
function upstreamRoute(o, runDir, { stdout, stderr, now, execFile, cwd }) {
  const id = o.upstreamRoute;
  const stagedPath = path.join(runDir, 'staged', id);
  // `--filed` needs no staged file (feedback --pre-confirmed deletes it on success, before this call); the id still passes the regex.
  const idOk = UPSTREAM_ROUTE_ID_RE.test(id) && !/\s/.test(id);
  if (!idOk || (o.filed === null && lstatType(stagedPath).type !== 'file')) {
    stderr(`console-resolve.js: --upstream-route ${JSON.stringify(id)} is not a ${o.filed === null ? 'staged wrap-up-upstream-* file' : 'wrap-up-upstream-* id'} — nothing written\n`);
    return 5;
  }
  // Strict, as `--ceiling`: an absent policy reads as unset (control mode off), but one that cannot be read is
  // exit 3, never an `unchanged` that would hand an external item to the causal-tag default or leave a filing unlogged.
  let permissions;
  try {
    const { ceiling, controlMode } = readPolicy({ execFile, cwd: cwd(), runDir, strict: true });
    permissions = bookkeepingPermissions(ceiling, { controlMode });
  } catch (err) {
    stderr(`console-resolve.js: upstream-route ${id} policy unreadable (${err && err.message ? err.message : err}) — nothing written\n`);
    return 3;
  }
  if (permissions.ownedUpstreamFiling !== true) {
    stdout(`console-resolve.js: upstream-route ${id} unchanged (control mode off)\n`);
    return 0;
  }
  // `--filed` routes the repo its URL names; every other modifier reads the draft.
  const draftNotes = [];
  let staged;
  if (o.filed !== null) {
    staged = { targetRepo: issueUrlRepo(o.filed), title: null, body: '' };
  } else {
    let text = '';
    try { text = fs.readFileSync(stagedPath, 'utf8'); } catch (err) {
      // No text parses to no target, so the item holds as external; say why, since the fact alone would read as an untargeted draft.
      draftNotes.push(`the staged draft could not be read (${failureText(err)}) → fallback: held as external with no target`);
    }
    staged = parseStagedUpstream(text);
  }
  // Echoed only when it is a valid owner/name, so a crafted marker can never spoof a stdout token.
  const target = parseTargetRepo(staged.targetRepo) === null ? 'none' : staged.targetRepo;
  // One append for the whole call: the ownership degrade lines, then the decision line (the resolve shape's order).
  const appendLines = (lines) => {
    if (lines.length === 0) return null;
    try {
      appendEntry({ runDir, section: '/wrap-up', entry: lines.join('\n') });
      return null;
    } catch (err) { return err && err.message ? err.message : String(err); }
  };
  const auto = (line) => formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text: line, reversibility: 'n/a' });
  const skipLines = (notes) => notes.map((note) => formatEntry({ status: 'SKIP', now: now(), step: 'Upstream ownership', text: `condition: ${note}`, reversibility: 'n/a' }));
  const hold = (reason, detail, notes) => {
    const fact = upstreamDecisionFact({ id, targetRepo: staged.targetRepo, title: staged.title, body: staged.body, reason, detail, runDir, staged: true });
    // The fact first, so nothing below ever claims the item carried without it.
    let written;
    try { written = writeDecisionFacts(runDir, [fact]); } catch (err) { return carryFailure(stderr, [id], err); }
    const consolePath = path.join(runDir, 'console.json');
    // At `unattended` the resolve shape has already stamped this item `filed` in an auto-resolve console, so a hold
    // reported afterwards (a failed filing, a scrub stop) must flip it to `carried`; any other console (absent, a
    // PR-rendered one, an item not held as filed) is left alone. A console that exists but cannot be read cannot be
    // judged either way, so it is refused like a rewrite that cannot proceed (the fact has landed).
    let heldFiled = false;
    try {
      const parsed = JSON.parse(fs.readFileSync(consolePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.mode === 'auto-resolve' && Array.isArray(parsed.items)) {
        const matches = parsed.items.filter((i) => i && i.id === id);
        heldFiled = matches.length === 1 && matches[0].resolution === 'filed';
      }
    } catch (err) {
      if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) {
        stderr(`console-resolve.js: could not read ${consolePath} (${err && err.message ? err.message : err}) — the decision fact ${fact.id} is in decisions.json; the console item is unchanged\n`);
        return 5;
      }
    }
    if (heldFiled) {
      let r;
      try {
        r = rewriteItemResolution({ consolePath, id, resolution: 'carried', reason: `carried to the acceptance packet as ${fact.id} — held: ${reason}`, at: new Date(now()).toISOString() });
      } catch (err) {
        stderr(`console-resolve.js: could not write ${consolePath}: ${err && err.message ? err.message : err} — the decision fact ${fact.id} is in decisions.json; the console item is unchanged\n`);
        return 3;
      }
      if (r.status === 'refused') {
        stderr(`console-resolve.js: ${r.why} — the decision fact ${fact.id} is in decisions.json; the console item is unchanged\n`);
        return 5;
      }
    }
    const why = detail ? `${reason}: ${detail.replace(/\s+/g, ' ').trim()}` : reason;
    // A repeat finds the fact already there (first copy wins), so the line says so instead of naming a reason the fact does not carry.
    const line = written.added === 0
      ? `Upstream filing: ${id} already held for the acceptance packet as ${fact.id}; this report (${why}) is not recorded on the fact`
      : `Upstream filing: ${id} held for the acceptance packet as ${fact.id} — ${why}`;
    const failure = appendLines([...skipLines(notes), auto(line)]);
    if (failure !== null) {
      stderr(`console-resolve.js: ${id} held, decision fact ${fact.id} written${heldFiled ? ' and the console item carried' : ''}, but the decisions.md entry could not be written (${failure})\n`);
      return 3;
    }
    stdout(`console-resolve.js: upstream-route ${id} hold target ${target} reason ${reason} fact ${fact.id}\n`);
    return 0;
  };

  // A failure the agent met while filing: the route is not asked, so no ownership is read.
  if (o.hold !== null) return hold(o.hold, o.reason, draftNotes);

  // upstreamFilingRoute holds a null or malformed target as `external` before it looks at the owner context, so
  // the verdict is the same without ownership: nothing is read, and nothing is logged about a read that never ran.
  let ownership = { ownerContext: null, ownedOwners: [], notes: [] };
  if (parseTargetRepo(staged.targetRepo) !== null) ownership = readUpstreamOwnership({ execFile, cwd: cwd() });
  const { ownerContext, ownedOwners, notes } = ownership;
  // A staged draft's header is an agent-written claim, so it must name the repo `/claude-tweaks:feedback` files into;
  // `--filed` already names the repo the issue landed in, which is judged as it stands.
  const verdict = upstreamFilingRoute({ permissions, targetRepo: staged.targetRepo, ownerContext, ownedOwners, ...(o.filed === null ? { filingTarget: UPSTREAM_FILING_TARGET } : {}) });
  if (verdict.route === 'file') {
    // A `file` verdict leaves the notes to the route call, so the `--filed` call that follows logs only the filing.
    const lines = o.filed !== null
      ? [auto(`Upstream filing: ${id} filed into ${verdict.targetRepo} as ${o.filed} (control mode: owned target, no prompt)`)]
      : skipLines(notes);
    const failure = appendLines(lines);
    if (failure !== null) {
      stderr(`console-resolve.js: ${id} routes to file, but the decisions.md entry could not be written (${failure})\n`);
      return 3;
    }
    stdout(`console-resolve.js: upstream-route ${id} file target ${target} reason none\n`);
    return 0;
  }
  // Only `file` files: any other verdict holds (reason `external` when it names none), so an unexpected one fails closed.
  const reason = verdict.reason || 'external';
  if (o.filed !== null) {
    // The issue exists, so it is logged whatever the route says (an external or unparseable URL, or an origin or
    // base-branch policy that moved since the filing decision): no fact, no console rewrite, plus the ownership
    // notes of this read (the `file` path above leaves them to the route call).
    const failure = appendLines([...skipLines(notes), auto(`Upstream filing: ${id} filed as ${o.filed} against a hold verdict (${reason})`)]);
    if (failure !== null) {
      stderr(`console-resolve.js: ${id} routes to hold (${reason}) but ${o.filed} was filed, and the decisions.md entry could not be written (${failure})\n`);
      return 3;
    }
    // The stdout line is what tells this exit 5 (logged) from a refused id's (nothing on stdout, nothing logged).
    stdout(`console-resolve.js: upstream-route ${id} hold target ${target} reason ${reason} filed ${o.filed}\n`);
    stderr(`console-resolve.js: ${id} routes to hold (${reason}), not file — ${o.filed} logged as filed against a hold verdict; nothing else written\n`);
    return 5;
  }
  return hold(reason, undefined, [...draftNotes, ...notes]);
}

// #5833: the `--recheck-merge` shape — the merge site's re-read of the merge half against the decisions.md as it
// stands now. Fail closed: every exit but the two stdout lines' exit 0 means "do not merge".
const RECHECK_TEXT = {
  'needs-human': 'merge withheld — a merge-check verdict asked for a human',
  unparsed: 'merge withheld — a merge-check verdict line did not parse',
  unconfirmed: 'merge withheld — no confirmed merge-check verdict at merge time',
};

// One `Merge re-check:` line per late verdict: a repeat call logs nothing more.
function recheckLogged(decisions, lateVerdict) {
  return decisions.split(/\r?\n/).some((ln) => {
    const entry = parseEntry(ln);
    if (!entry || !(entry.location === 'Merge re-check' || entry.location.endsWith(' — Merge re-check'))) return false;
    // Strip only the trailing `Reversibility:` field formatEntry appended; the late verdict may carry its own.
    const text = entry.action.replace(/\.?\s*Reversibility: [^.]*\.$/, '');
    return text.endsWith(lateVerdict) || text.endsWith(lateVerdict.replace(/\.$/, ''));
  });
}

function recheckMergeShape(runDir, { stdout, stderr, now, deps = {} }) {
  const consolePath = path.join(runDir, 'console.json');
  const decisionsPath = path.join(runDir, 'decisions.md');
  const append = deps.appendEntry || appendEntry;
  const writeAtomic = deps.writeFileAtomic || writeFileAtomic;
  let code = 0;
  let locked = false;
  try {
    code = withLock(path.join(runDir, '.console.lock'), () => {
      locked = true;
      let decisions = '';
      try { decisions = fs.readFileSync(decisionsPath, 'utf8'); } catch (err) {
        if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) {
          stderr(`console-resolve.js: recheck-merge failed (decisions.md unreadable: ${oneLineNote(failureText(err))}) — not merging\n`);
          return 3;
        }
      }
      let data = null;
      let raw = null;
      try { raw = fs.readFileSync(consolePath, 'utf8'); } catch (err) {
        if (!(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'))) {
          stderr(`console-resolve.js: recheck-merge failed (console.json unreadable: ${oneLineNote(failureText(err))}) — not merging\n`);
          return 3;
        }
      }
      if (raw !== null) {
        try { data = JSON.parse(raw); } catch { data = undefined; }
        if (data === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
          stderr('console-resolve.js: recheck-merge refused (console.json unparseable) — nothing written\n');
          return 5;
        }
      }
      const autoResolve = data !== null && data.mode === 'auto-resolve';
      const merge = autoResolve && data.merge && typeof data.merge === 'object' ? data.merge : null;
      // The stale set is never stored: whenever console.json recorded `merge`, derive it from the run's members and let
      // recheckMerge's confirmPassingVerdicts decide against the live decisions.md; members that cannot be read fail closed.
      let mergeStale = null;
      // A merge half this shape already rewrote (`leave-open`, `recheckedFrom: merge`) is re-derived too, so a repeat call still holds.
      if (autoResolve && merge && (merge.resolution === 'merge' || (merge.resolution === 'leave-open' && merge.recheckedFrom === 'merge'))) {
        let members = [];
        try { members = readMembers({ readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } }, ...(deps.resolverDeps || {}) }, runDir); } catch { members = []; }
        mergeStale = Array.isArray(members) && members.length ? { unconfirmed: members } : { unconfirmed: [], membersUnresolved: true };
      }
      const re = recheckMerge(merge, decisions, mergeStale);
      if (!re.hit) {
        stdout(`console-resolve.js: recheck-merge merge — no needs-human, malformed or unconfirmed merge-check verdict in decisions.md (stored: ${merge && typeof merge.resolution === 'string' ? merge.resolution : 'none'})\n`);
        return 0;
      }
      if (!recheckLogged(decisions, re.lateVerdict)) {
        try {
          append({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Merge re-check', text: `${RECHECK_TEXT[re.kind]}: ${re.lateVerdict}`, reversibility: 'n/a' }) });
        } catch (err) {
          stderr(`console-resolve.js: recheck-merge failed (decisions.md entry not written: ${oneLineNote(failureText(err))}) — not merging\n`);
          return 3;
        }
      }
      if (re.changed) {
        try {
          writeAtomic(consolePath, `${JSON.stringify({ ...data, merge: { ...re.merge, recheckedAt: new Date(now()).toISOString() } }, null, 2)}\n`);
        } catch (err) {
          stderr(`console-resolve.js: recheck-merge failed (console.json not rewritten: ${oneLineNote(failureText(err))}) — not merging; the Merge re-check line has landed\n`);
          return 3;
        }
      }
      stdout(`console-resolve.js: recheck-merge leave-open — ${re.lateVerdict}\n`);
      return 0;
    }, { failClosed: true, env: deps.env || process.env });
  } catch (err) {
    stderr(`console-resolve.js: recheck-merge failed (${locked ? '' : 'lock: '}${oneLineNote(failureText(err))}) — not merging\n`);
    return 3;
  }
  return code;
}

async function run(argv, deps = {}) {
  const cwd = deps.cwd || (() => process.cwd());
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const now = deps.now || (() => Date.now());
  const execFile = deps.execFile || defaultExecFile;
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(`console-resolve.js: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  // A relative --run resolves against deps.cwd() (cli-wrapper-contract); read lazily, only when needed.
  if (!path.isAbsolute(o.run)) o.run = path.resolve(cwd(), o.run);
  let isDir = false;
  try { isDir = fs.statSync(o.run).isDirectory(); } catch { isDir = false; }
  if (!isDir) { stderr(`console-resolve.js: --run ${o.run} is not a directory\n${USAGE}\n`); return 2; }
  const target = resolveTarget({ runDir: o.run, cwd: cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    stderr(`console-resolve.js: --run ${o.run} refused (${target.reason === 'missing' ? 'missing' : 'not anchored under the main checkout\'s .claude-tweaks/pipelines'}) — nothing written\n`);
    return 3;
  }
  const runDir = target.dir;
  if (o.recheckMerge) return recheckMergeShape(runDir, { stdout, stderr, now, deps });
  if (o.upstreamRoute !== null) return upstreamRoute(o, runDir, { stdout, stderr, now, execFile, cwd });
  if (o.memoryWrite !== null || o.converge !== null) {
    const refusal = controlModeGate({ shape: o.memoryWrite !== null ? '--memory-write' : '--converge', runDir, stderr, execFile, cwd });
    if (refusal !== null) return refusal;
    if (o.memoryWrite !== null) return memoryWrite(o, runDir, { stdout, stderr, now, cwd });
    return converge(o, runDir, { stdout, stderr, now, cwd });
  }
  if (o.ceiling) return ceilingQuery(runDir, { stdout, stderr, execFile, cwd });
  if (o.setItem !== null) return setItem(o, runDir, { stdout, stderr, now, execFile, cwd });
  if (o.checkRepair !== null) return checkRepair(o, runDir, { stdout, stderr, execFile, cwd });
  const { ceiling, controlMode, ceilingSource, vetoWindowHours, sensitivePaths } = readPolicy({ execFile, cwd: cwd(), runDir });
  if (!bookkeepingPermissions(ceiling).consoleAutoResolve) {
    stderr(`console-resolve.js: consoleAutoResolve is not granted at ceiling ${ceiling} (unattended only) — nothing written\n`);
    return 4;
  }
  // Idempotency and no-clobber, before anything is resolved: this run dir's
  // console.json may already hold a resolution (re-run — re-render it, append
  // nothing) or a console rendered on the PR (never ours, in either state).
  // An unparseable file fails closed for the same reason.
  //
  // The PR shape is tested FIRST, because a PR-rendered console the reconciler
  // has since executed carries `resolved: true` AND `prNumber`/`commentIds` —
  // reading it as this CLI's own auto-resolve shape would render its
  // `{id, kind, summary, stagedHash}` items as `undefined` cells.
  const consolePath = path.join(runDir, 'console.json');
  let existingRaw = null;
  try { existingRaw = fs.readFileSync(consolePath, 'utf8'); } catch { existingRaw = null; }
  // #6284: approvals `recheck-followups.js approve` recorded before this resolve (an unresolved console it created),
  // by item id; the fresh write below carries each onto the same id's pending item rather than dropping it.
  const priorApprovals = new Map();
  if (existingRaw !== null) {
    let parsed;
    try { parsed = JSON.parse(existingRaw); } catch { parsed = undefined; }
    const existing = parsed && typeof parsed === 'object' ? parsed : null;
    for (const it of (existing && Array.isArray(existing.items) ? existing.items : [])) {
      if (it && typeof it.id === 'string' && it.approval && typeof it.approval === 'object') priorApprovals.set(it.id, it.approval);
    }
    const onPr = existing !== null
      && (existing.prNumber !== undefined || existing.commentIds !== undefined || existing.mergeCheckVerdict !== undefined);
    const pr = onPr && existing.prNumber !== undefined ? `PR #${existing.prNumber}` : 'the PR';
    if (existing !== null && existing.resolved === true) {
      const notice = onPr
        ? `${consolePath} is a console rendered on ${pr} and already resolved there — nothing to re-resolve.`
        : `${consolePath} already records a resolved console — re-rendering it; nothing re-resolved.`;
      stdout(`console-resolve.js: ${notice}\n`);
      stdout(`${renderStoredTable(existing)}\n`);
      // A resumed wrap-up re-renders here: the block must still reach its final stop.
      // A planned can't-tell filing with no filed line is residue here too (#4170); the fresh path's filings are about to run.
      let decisions = '';
      try { decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { decisions = ''; }
      const block = needsAHumanBlock(consoleResidueItems(existing, decisions), runDir, consolePath);
      if (block) stdout(block);
      return 0;
    }
    let refusal = null;
    if (onPr) refusal = `${consolePath} is a console rendered on ${pr} and awaiting a human — refusing to overwrite it; nothing written`;
    else if (parsed === undefined) refusal = `${consolePath} exists but does not parse as JSON — refusing to overwrite it; nothing written`;
    if (refusal) {
      stderr(`console-resolve.js: ${refusal}\n`);
      // `--dry-run` is preview-always (review-console.md's Dry-run mode) and
      // writes nothing anyway, so there is nothing here to clobber: the refusal
      // degrades to a warning rather than denying the operator the preview.
      if (!o.dryRun) return 5;
      stderr('console-resolve.js: --dry-run — previewing anyway; nothing is written either way\n');
    }
  }
  // One read per run, and only if resolveAll asks (a control-mode upstream item that would file); its notes are logged below.
  let upstreamRead = null;
  const upstreamOwnership = () => {
    if (upstreamRead === null) upstreamRead = readUpstreamOwnership({ execFile, cwd: cwd() });
    return upstreamRead;
  };
  const resolverDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: gitApplyCheck(execFile, cwd()),
    checkPatchStack: checkPatchStack(cwd()),
    readGrants: ghReadGrants(execFile, cwd()),
    checkPrState: ghCheckPrState(execFile, cwd()),
    vetoWindowHours,
    sensitivePaths,
    upstreamOwnership,
    now,
    ...(deps.resolverDeps || {}),
  };
  const result = resolveAll({ runDir, policy: o.policy, deps: resolverDeps, controlMode: controlMode === true });
  if (priorApprovals.size > 0) {
    result.items = result.items.map((it) => (it.resolution === 'pending' && priorApprovals.has(it.id) ? { ...it, approval: priorApprovals.get(it.id) } : it));
  }
  // The proposal text stays in-process (result.filings); console.json and --json carry only the summary.
  const { snapshot, table, filings, digests, decisionFacts, mergeStale, ...rest } = result;
  const filingSummaries = filings.map(({ item, fingerprint, title }) => ({ item, fingerprint, title }));
  const digestSummaries = digests.map(({ item, fingerprint }) => ({ item, fingerprint }));
  // Outside control mode nothing changes: the public result carries no decisionFacts key.
  const publicResult = { ...rest, ...(mergeStale ? { mergeStale } : {}), ...(controlMode === true ? { decisionFacts } : {}), filings: filingSummaries, digests: digestSummaries };
  const at = new Date(now()).toISOString();
  if (!o.dryRun) {
    // The facts land before the decisions block and console.json: a failed write leaves nothing else behind,
    // so a carried item is never recorded as carried without its fact.
    if (decisionFacts.length > 0) {
      try { writeDecisionFacts(runDir, decisionFacts); } catch (err) {
        return carryFailure(stderr, result.items.filter((it) => it.resolution === 'carried').map((it) => it.id), err);
      }
    }
    const via = ceilingSource === 'control-mode' || controlMode === true ? 'control mode' : 'console-resolve.js';
    const header = formatEntry({ status: 'AUTO', now: now(), step: 'Review Console', text: `Console auto-resolved ${result.items.length} item(s) at unattended (${via})`, reversibility: 'per item' });
    // Reversibility uses _shared/auto-decision-log.md's closed vocabulary
    // (high | med | low | n/a) — nothing else is a legal value on a schema line.
    const nothingToRevert = new Set(['stale', 'keep-staged', 'pending', 'refused', 'dismissed', 'dropped', 'digested', 'carried']);
    const reversibilityFor = (resolution) => {
      if (nothingToRevert.has(resolution)) return 'n/a';
      return resolution === 'apply' ? 'med' : 'high';
    };
    const stagedNames = new Set(snapshot.staged.map((s) => s.name));
    const lines = result.items.map((it) => formatEntry({
      status: 'AUTO',
      now: now(),
      step: 'Review Console',
      text: `Console item ${it.id} (${it.section}): ${it.resolution} — ${it.reason}${stagedNames.has(it.id) ? ` (staged/${it.id})` : ''}`,
      reversibility: reversibilityFor(it.resolution),
    }));
    // A degrade, logged `SKIP` in _shared/auto-decision-log.md's Degrade-trace shape: what the ownership read could not do.
    const ownershipNotes = (upstreamRead === null ? [] : upstreamRead.notes).map((note) => formatEntry({ status: 'SKIP', now: now(), step: 'Upstream ownership', text: `condition: ${note}`, reversibility: 'n/a' }));
    appendEntry({ runDir, section: '/wrap-up', entry: [header, ...lines, ...ownershipNotes].join('\n') });
    // #6284: under the same lock `recheck-followups.js approve`/`execute` take, so an approval written since the early read
    // above is carried onto its pending item instead of being overwritten.
    withLock(path.join(runDir, '.console.lock'), () => {
      let fresh = null;
      try { fresh = JSON.parse(fs.readFileSync(consolePath, 'utf8')); } catch { fresh = null; }
      for (const it of (fresh && Array.isArray(fresh.items) ? fresh.items : [])) {
        if (it && typeof it.id === 'string' && it.approval && typeof it.approval === 'object' && !priorApprovals.has(it.id)) priorApprovals.set(it.id, it.approval);
      }
      result.items = result.items.map((it) => (it.resolution === 'pending' && priorApprovals.has(it.id) && !it.approval ? { ...it, approval: priorApprovals.get(it.id) } : it));
      writeFileAtomic(consolePath, `${JSON.stringify({ resolved: true, mode: 'auto-resolve', at, ceiling: 'unattended', items: result.items, merge: result.merge, droppedByTiebreak: result.droppedByTiebreak, filings: filingSummaries, digests: digestSummaries, ...(controlMode === true ? { controlMode: true, decisionFacts: decisionFacts.length } : {}) }, null, 2)}\n`);
    }, { failClosed: true, env: process.env });
  }
  if (mergeStale && !o.dryRun) stderr(`console-resolve.js: merge half stale — ${mergeStale.reason}\n`);
  // #3370: items this console deliberately left pending/keep-staged must survive
  // the run's own final stop. Read-only: nothing here applies or resolves them.
  const unresolved = unresolvedItems({ items: result.items });
  if (o.json) {
    stdout(`${JSON.stringify({ ...publicResult, unresolved, at, dryRun: o.dryRun }, null, 2)}\n`);
  } else {
    stdout(`${table}\n`);
    const block = needsAHumanBlock(unresolved, runDir, consolePath);
    if (block) stdout(block);
  }
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`console-resolve.js: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
}

module.exports = { run, parseArgs, defaultExecFile, ghReadGrants, readPolicy, controlModeOn, readUpstreamOwnership, checkPatchStack, writeDecisionFacts, EXIT_CARRY_FAILED, USAGE };
