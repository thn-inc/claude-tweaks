#!/usr/bin/env node
// bin/wrap-up-engine.js — CLI wiring the wrap-up curation engine modules
// (facts.js, engine-plan.js, engine-record.js, engine-render.js, engine-verify.js)
// into five verbs: `plan` (gather facts, build the worklist, initialize engine
// state), `record` (validate and store one judgment payload), `amend`
// (correct an already-recorded row without hand-editing engine-state.json),
// `render` (produce the Phase 2 phase-trace table or the Review Console's
// engine-fed sections), `verify` (run the closure-gate checks against a run
// dir).
//
// Exit codes: 0 for success (including a `render --strict` completeness
// failure is the one deliberate exception — see below); 1 when the
// invocation shape was fine but the payload/content was not (a `record` or
// `amend` payload that fails validation, or JSON that doesn't parse); 2 only
// for a
// malformed invocation (missing/unknown flags, an unknown verb, an
// unanchored --run-dir (#790/[IL-127] — a worktree-relative shadow, or a
// path with no determinable git repository root), bad `--signals` JSON at
// plan time — since --signals is parsed before any engine work starts, an
// unparseable value is invocation shape, not payload). `render --strict` is
// documented separately: it prints first, THEN exits 2 when rows are
// missing, so the hole is visible AND fatal. `verify` has its own additional
// exit code, 3, on any `fail` row (or a run dir that couldn't be located at
// all) — 0/1/2 keep their meanings above unchanged.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const wtDetect = require('./lib/hooks/worktree-detect');
const { readRunState } = require('./lib/hooks/context');

// The plugin payload root — the directory with `skills/` directly beneath it
// (this repo: `plugin/`; an installed consumer: `${CLAUDE_PLUGIN_ROOT}`).
// Resolved from this script's own location, never from `process.cwd()`, so
// `render --section procedure:<name>` finds the real skill files regardless
// of which directory it's invoked from (#2546).
const PLUGIN_ROOT = path.join(__dirname, '..');

const { gatherFacts } = require('./lib/wrap-up/facts');
const { buildWorklist } = require('./lib/wrap-up/engine-plan');
const { initState, recordResult, amendResult } = require('./lib/wrap-up/engine-record');
const { renderTrace, renderConsoleSections, renderConsoleSectionsMulti, strictCheck, resolveProcedureHeadPath } = require('./lib/wrap-up/engine-render');
const { runVerify, renderVerifyTable, resolveArchivedRunDir } = require('./lib/wrap-up/engine-verify');
const { resolveLedgerPath, flipLedgerRow, TERMINAL_STATUSES } = require('./lib/wrap-up/ledger-write');
const { appendEntry, formatEntry } = require('./lib/log-decision/append');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = [
  'usage: wrap-up-engine.js plan --run-dir <dir> --base <sha> [--ceremony <profile>] [--skill-budget n] [--doc-budget n] [--signals <json>] [--dry-run]',
  '       wrap-up-engine.js record --run-dir <dir> [--dry-run]   (payload JSON on stdin)',
  '       wrap-up-engine.js record --run-dir <dir> --batch <file> [--dry-run]   (JSON array of payloads, one file)',
  '       wrap-up-engine.js amend --run-dir <dir>   (payload JSON on stdin)',
  '       wrap-up-engine.js render --run-dir <dir> [--strict] [--section trace|console] [--start-at n]',
  '       wrap-up-engine.js render --section procedure:<name>   (no --run-dir, no --spec-state, no --strict)',
  '       wrap-up-engine.js render --section console --spec-state <id>=<path> [--spec-state <id>=<path> ...] [--start-at n] [--strict]   (no --run-dir)',
  '       wrap-up-engine.js verify --run-dir <dir> --base <ref>',
  '       wrap-up-engine.js finish-console --run-dir <dir> --approve-all [--ledger <path>]   (JSON {memory?,upstream?,ledger?} on stdin)',
  '',
].join('\n');

function usageExit() {
  process.stderr.write(USAGE);
  process.exitCode = 2;
}

function parseArgs(argv) {
  const out = {
    runDir: null, base: null, ceremony: null, skillBudget: null, docBudget: null,
    signals: null, dryRun: false, strict: false, section: null, startAt: null, specStates: [],
    batch: null, approveAll: false, ledger: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const hasValue = i + 1 < argv.length && !argv[i + 1].startsWith('--');
    // A blank or whitespace-only value (the shape an unset $PIPELINE_RUN_DIR
    // expands to in shell) is treated as no value at all — out.runDir stays
    // null, so every existing `if (!args.runDir) usageExit();` check below
    // already rejects it before any guard or I/O runs (#1138). A plain
    // empty string is already falsy and caught the same way without this
    // check; this closes the whitespace-only gap specifically.
    if (a === '--run-dir' && hasValue) {
      out.runDir = argv[i + 1].trim() === '' ? null : argv[i + 1];
      i += 1; continue;
    }
    if (a === '--base' && hasValue) { out.base = argv[i + 1]; i += 1; continue; }
    if (a === '--ceremony' && hasValue) { out.ceremony = argv[i + 1]; i += 1; continue; }
    if (a === '--skill-budget' && hasValue) { out.skillBudget = argv[i + 1]; i += 1; continue; }
    if (a === '--doc-budget' && hasValue) { out.docBudget = argv[i + 1]; i += 1; continue; }
    if (a === '--signals' && hasValue) { out.signals = argv[i + 1]; i += 1; continue; }
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--strict') { out.strict = true; continue; }
    if (a === '--section' && hasValue) { out.section = argv[i + 1]; i += 1; continue; }
    if (a === '--start-at' && hasValue) { out.startAt = argv[i + 1]; i += 1; continue; }
    if (a === '--spec-state' && hasValue) { out.specStates.push(argv[i + 1]); i += 1; continue; }
    if (a === '--batch' && hasValue) { out.batch = argv[i + 1]; i += 1; continue; }
    if (a === '--approve-all') { out.approveAll = true; continue; }
    if (a === '--ledger' && hasValue) { out.ledger = argv[i + 1]; i += 1; continue; }
  }
  return out;
}

// ---- repo-root / telemetry path resolution --------------------------------
//
// `git rev-parse --git-common-dir` resolves to the MAIN checkout's .git dir
// even when invoked from a linked worktree, mirroring
// bin/claude-tweaks-statusline.js's resolveMainProjectDir(). Telemetry always
// anchors to the main checkout, never the worktree the plan/record run
// happens to execute from.
function resolveRepoRoot(cwd) {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!commonDir) return cwd;
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    return path.dirname(abs);
  } catch {
    return cwd;
  }
}

function resolveTelemetryPath(cwd) {
  return path.join(resolveRepoRoot(cwd), '.claude-tweaks', 'wrap-up-outcomes.tsv');
}

// ---- journey frontmatter parsing (no YAML dep) -----------------------------
//
// `files:` YAML list in the frontmatter block: lines between the first `---`
// pair, a `^files:\s*$` key line, then consecutive `^\s*-\s+(.+)$` items
// until a non-matching line. Normalize CRLF first -- a journey file with
// `\r\n` line endings otherwise leaves each line carrying a trailing `\r`
// that the item regex's `(.+)$` (no `m` flag, and `.` excludes `\r`) can
// never consume, so the very first `- path` line fails to match and the
// whole list silently parses to `[]` (#1787).
function parseJourneyFilesList(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (!lines.length || lines[0].trim() !== '---') return [];
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return [];
  const fm = lines.slice(1, end);
  const filesIdx = fm.findIndex((l) => /^files:\s*$/.test(l.trim()));
  if (filesIdx === -1) return [];
  const files = [];
  for (let i = filesIdx + 1; i < fm.length; i += 1) {
    const m = fm[i].match(/^\s*-\s+(.+)$/);
    if (!m) break;
    files.push(m[1].trim());
  }
  return files;
}

function buildJourneyFrontmatter(cwd, journeyFiles) {
  const map = {};
  for (const jf of journeyFiles || []) {
    try {
      map[jf] = parseJourneyFilesList(fs.readFileSync(path.join(cwd, jf), 'utf8'));
    } catch {
      map[jf] = [];
    }
  }
  return map;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ---- verbs ------------------------------------------------------------

function runPlan(args) {
  if (!args.runDir || !args.base) { usageExit(); return; }

  let signals = {};
  if (args.signals) {
    try {
      signals = JSON.parse(args.signals);
    } catch (e) {
      process.stderr.write(`wrap-up-engine.js plan: --signals is not valid JSON: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
  }

  const cwd = process.cwd();
  const facts = gatherFacts({ cwd, base: args.base });
  const journeyFrontmatter = buildJourneyFrontmatter(cwd, facts.journeyFiles);

  const budgets = {};
  if (args.skillBudget !== null) budgets['skill-budget'] = Number(args.skillBudget);
  if (args.docBudget !== null) budgets['doc-budget'] = Number(args.docBudget);

  const ceremonyProfile = args.ceremony || 'standard';
  const worklist = buildWorklist({ facts, signals, ceremonyProfile, budgets, journeyFrontmatter });

  fs.mkdirSync(args.runDir, { recursive: true });

  // initState has no dryRun parameter of its own (unlike recordResult) — a
  // --dry-run plan skips telemetry by passing telemetryPath: null, which
  // appendTelemetry() already treats as "skip the append silently".
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  initState({ runDir: args.runDir, worklist, now: new Date(), telemetryPath });

  process.stdout.write(`${JSON.stringify(worklist, null, 2)}\n`);
}

// Shared by runRecord/runAmend: a run dir with no engine-state.json means
// plan never ran (or the run dir was wiped) — a malformed invocation, not a
// bad payload, so it must exit 2 like render's identical check, not fall
// through to recordResult's/amendResult's readEngineState() throwing inside
// the generic catch below (which would misreport it as exit 1). Returns
// true when the precondition holds; false (having already written the error
// and exit code) otherwise.
function requireEngineState(runDir, verb) {
  if (fs.existsSync(path.join(runDir, 'engine-state.json'))) return true;
  process.stderr.write(`wrap-up-engine.js ${verb}: no engine-state.json in ${runDir} — run plan first\n`);
  process.exitCode = 2;
  return false;
}

// Shared by runRecord/runAmend: read stdin and parse it as JSON. Invocation
// shape (--run-dir) was already fine by this point; the payload wasn't, so
// this is exit 1, not 2 — the model retries with a fixed payload rather than
// re-reading usage. Returns the parsed payload, or null (having already
// written the error and exit code) on a parse failure.
function parseStdinPayload(verb) {
  const raw = readStdin();
  try {
    return JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js ${verb}: stdin is not valid JSON: ${e.message}\n`);
    process.exitCode = 1;
    return null;
  }
}

// Shared by runRecord/runAmend: print decisions.md's last line — the
// SCANNED/AMENDED line the underlying recordResult/amendResult call just
// appended.
function printLastDecisionLine(runDir) {
  const decisionLines = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').trim().split('\n');
  process.stdout.write(`${decisionLines[decisionLines.length - 1]}\n`);
}

// #2546: `record --batch <file>` reads a JSON array of payloads from a file
// instead of one stdin payload — the model no longer hand-assembles N
// separate `record` invocations (or a scratch script looping over them) to
// record a worklist's rows in one pass. Each entry is recorded in worklist
// order, through the same recordResult() the single-payload path uses, so
// engine-record.js's own validation and rowId-uniqueness rules apply
// identically per entry. Sequential, fail-fast: a malformed array, or an
// entry recordResult rejects, stops the batch at that index — entries
// already recorded before the failure stay recorded (recordResult commits
// each one independently; this verb does not roll earlier entries back),
// so the caller re-runs a new --batch file containing only the remaining
// entries rather than retrying the whole set.
function runRecordBatch(args) {
  let raw;
  try {
    raw = fs.readFileSync(args.batch, 'utf8');
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js record --batch: could not read ${args.batch}: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js record --batch: ${args.batch} is not valid JSON: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    process.stderr.write(`wrap-up-engine.js record --batch: ${args.batch} must be a non-empty JSON array of payloads\n`);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  for (let i = 0; i < entries.length; i += 1) {
    try {
      recordResult({
        runDir: args.runDir, payload: entries[i], now: new Date(), dryRun: args.dryRun, telemetryPath,
      });
    } catch (e) {
      process.stderr.write(`wrap-up-engine.js record --batch: entry ${i} (of ${entries.length}) failed: ${e.message}\n`);
      process.exitCode = 1;
      return;
    }
    printLastDecisionLine(args.runDir);
  }
}

function runRecord(args) {
  if (!args.runDir) { usageExit(); return; }
  if (!requireEngineState(args.runDir, 'record')) return;

  if (args.batch) { runRecordBatch(args); return; }

  const payload = parseStdinPayload('record');
  if (!payload) return;

  const cwd = process.cwd();
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  try {
    recordResult({ runDir: args.runDir, payload, now: new Date(), dryRun: args.dryRun, telemetryPath });
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js record: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  printLastDecisionLine(args.runDir);
}

function runAmend(args) {
  if (!args.runDir) { usageExit(); return; }
  if (!requireEngineState(args.runDir, 'amend')) return;

  const payload = parseStdinPayload('amend');
  if (!payload) return;

  try {
    amendResult({ runDir: args.runDir, payload, now: new Date() });
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js amend: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  printLastDecisionLine(args.runDir);
}

function runRender(args) {
  const section = args.section || 'trace';
  const procedureName = section.startsWith('procedure:') ? section.slice('procedure:'.length) : null;
  if (section !== 'trace' && section !== 'console' && procedureName === null) {
    process.stderr.write(`wrap-up-engine.js render: --section must be 'trace', 'console', or 'procedure:<name>'\n`);
    process.exitCode = 2;
    return;
  }

  // #2546: `procedure:<name>` emits a registered split-file's operative-head
  // excerpt verbatim — no engine-state.json, no --run-dir, no --strict. A
  // caller that currently reads one of the four split files whole can read
  // this excerpt instead, lowering per-run read volume without requiring a
  // pipeline run to exist at all.
  if (procedureName !== null) {
    if (procedureName === '') {
      process.stderr.write(`wrap-up-engine.js render: --section procedure:<name> requires a name\n`);
      process.exitCode = 2;
      return;
    }
    if (args.runDir || args.specStates.length > 0 || args.strict) { usageExit(); return; }
    const relPath = resolveProcedureHeadPath(procedureName);
    if (!relPath) {
      process.stderr.write(`wrap-up-engine.js render: unknown procedure '${procedureName}'\n`);
      process.exitCode = 2;
      return;
    }
    const fullPath = path.join(PLUGIN_ROOT, relPath);
    let markdown;
    try {
      markdown = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      process.stderr.write(`wrap-up-engine.js render: could not read procedure '${procedureName}' at ${fullPath}: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    return;
  }

  if (args.specStates.length > 0) {
    if (section !== 'console') { usageExit(); return; } // AC9: --spec-state only valid with --section console
    if (args.runDir) { usageExit(); return; } // AC8: --spec-state and --run-dir are mutually exclusive

    const specStates = [];
    for (const raw of args.specStates) {
      const eq = raw.indexOf('=');
      if (eq === -1) { usageExit(); return; } // AC13: value must be id=path

      const specId = raw.slice(0, eq);
      const p = raw.slice(eq + 1);
      let state;
      try {
        state = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {
        // AC12: name the failing path, exit 2, never an uncaught exception.
        process.stderr.write(`wrap-up-engine.js render: could not read spec state from ${p}: ${e.message}\n`);
        process.exitCode = 2;
        return;
      }
      // Valid JSON that isn't a state object (e.g. a file containing just
      // `null`) parses without throwing above but would otherwise blow up as
      // an uncaught TypeError inside renderConsoleSectionsMulti — treat it
      // as the same failure-to-read case, same message format, exit 2.
      if (state === null || typeof state !== 'object' || state.results === null || typeof state.results !== 'object') {
        process.stderr.write(`wrap-up-engine.js render: could not read spec state from ${p}: parsed value is not a valid engine-state object\n`);
        process.exitCode = 2;
        return;
      }
      specStates.push({ specId, state });
    }

    const { markdown } = renderConsoleSectionsMulti(specStates, { startAt: args.startAt !== null ? Number(args.startAt) : 1 });
    process.stdout.write(`${markdown}\n`);

    if (args.strict) {
      const incomplete = specStates
        .map(({ specId, state }) => ({ specId, missing: strictCheck(state).missing }))
        .filter((entry) => entry.missing.length > 0);
      if (incomplete.length > 0) {
        for (const entry of incomplete) {
          process.stderr.write(`wrap-up-engine.js render: spec ${entry.specId} incomplete — missing: ${entry.missing.join(', ')}\n`);
        }
        process.exitCode = 2;
      }
    }
    return;
  }

  if (!args.runDir) { usageExit(); return; }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(args.runDir, 'engine-state.json'), 'utf8'));
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js render: could not read engine-state.json from ${args.runDir}: ${e.message}\n`);
    process.exitCode = 2;
    return;
  }

  const output = section === 'trace'
    ? renderTrace(state)
    : renderConsoleSections(state, { startAt: args.startAt !== null ? Number(args.startAt) : 1 }).markdown;

  // Print first, so the hole is visible even when --strict is about to make
  // it fatal.
  process.stdout.write(`${output}\n`);

  if (args.strict) {
    const check = strictCheck(state);
    if (!check.ok) process.exitCode = 2;
  }
}

function runVerifyVerb(args) {
  if (!args.runDir || !args.base) { usageExit(); return; }
  const repoRoot = resolveRepoRoot(process.cwd());
  const cwd = process.cwd();
  const resolvedDir = resolveArchivedRunDir(args.runDir, repoRoot);
  const { rows, exitCode } = runVerify({ runDir: resolvedDir, originalRunDir: args.runDir, base: args.base, repoRoot, cwd, deps: {} });
  process.stdout.write(`${renderVerifyTable(rows)}\n`);
  // Never process.exit() right after a large write -- can truncate stdout on
  // a pipe (see MEMORY.md's async-write-vs-process-exit-race incident).
  process.exitCode = exitCode;
}

// #2546: consolidates the Review Console's three "outcome write" steps the
// skill text previously hand-assembled separately — writing
// verify-expectations.json, logging the terminal decision plus each M#/U#
// outcome, and flipping the ledger rows those outcomes resolve — into one
// call. Takes a JSON payload on stdin describing what was already decided
// (the model still decides WHAT to approve; this verb only commits the
// bookkeeping trail for that decision) — it never applies a staged patch,
// writes a skill/doc/journey update, or creates a work record itself; those
// remain the existing per-section apply steps in review-console.md's "On
// approval." `--approve-all` is required (the only mode this verb supports
// today — a plain name rather than a flag with no alternative would be
// equally valid; the flag form was chosen to read naturally at the call
// site and to leave room for a future non-approve-all mode without a
// breaking rename).
//
// Payload shape (all three arrays optional, default []):
//   { "memory": [{ "file": "...", "indexFile": "..." }, ...],
//     "upstream": [{ "url": "..." }, ...],
//     "ledger": [{ "item": 3, "status": "deferred", "resolution": "..." }, ...] }
//
// Atomicity (Gotchas, record #2544): the three writes are NOT transactional
// across each other — verify-expectations.json first, then the decision
// log, then ledger flips, in that fixed order. A failure stops immediately;
// writes already completed stay completed (verify-expectations.json is
// idempotent to re-run, and the decision log is append-only, so re-running
// after fixing the cause re-derives the same state rather than duplicating
// it — only a partially-flipped ledger needs the operator to check which
// rows the stderr message named before resolved). This is a documented
// best-effort posture, not a bug: building real cross-file-format
// transactionality for three unrelated artifacts is out of scope for a
// bookkeeping-consolidation CLI — the exit code and stderr message are the
// recovery contract.
function validateFinishConsolePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'stdin JSON must be an object with optional "memory"/"upstream"/"ledger" array fields';
  }
  const memory = payload.memory ?? [];
  const upstream = payload.upstream ?? [];
  const ledger = payload.ledger ?? [];
  if (!Array.isArray(memory)) return '"memory" must be an array';
  if (!Array.isArray(upstream)) return '"upstream" must be an array';
  if (!Array.isArray(ledger)) return '"ledger" must be an array';
  for (const [i, m] of memory.entries()) {
    if (!m || typeof m.file !== 'string' || !m.file || typeof m.indexFile !== 'string' || !m.indexFile) {
      return `memory[${i}] must be {file, indexFile} (both non-empty strings)`;
    }
  }
  for (const [i, u] of upstream.entries()) {
    if (!u || typeof u.url !== 'string' || !u.url) return `upstream[${i}] must be {url} (a non-empty string)`;
  }
  for (const [i, l] of ledger.entries()) {
    if (!l || !Number.isInteger(l.item) || l.item <= 0) return `ledger[${i}].item must be a positive integer`;
    if (!TERMINAL_STATUSES.includes(l.status)) return `ledger[${i}].status must be one of ${TERMINAL_STATUSES.join(', ')}`;
    if (l.status !== 'observation' && !String(l.resolution || '').trim()) return `ledger[${i}].resolution is required for status '${l.status}'`;
  }
  return null;
}

function runFinishConsole(args) {
  if (!args.runDir || !args.approveAll) { usageExit(); return; }

  const payload = parseStdinPayload('finish-console');
  if (!payload) return;
  const validationError = validateFinishConsolePayload(payload);
  if (validationError) {
    process.stderr.write(`wrap-up-engine.js finish-console: ${validationError}\n`);
    process.exitCode = 1;
    return;
  }
  const memory = payload.memory ?? [];
  const upstream = payload.upstream ?? [];
  const ledgerUpdates = payload.ledger ?? [];

  // Step 1: verify-expectations.json (read-modify-write — preserve every
  // field this verb doesn't itself own, same discipline
  // review-console.md's step 11 documents for oversightExempt/issues).
  const expectationsPath = path.join(args.runDir, 'verify-expectations.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(expectationsPath, 'utf8'));
  } catch { existing = {}; }
  const expectations = {
    ...existing, version: 1, memory, upstream,
  };
  try {
    writeFileAtomic(expectationsPath, `${JSON.stringify(expectations, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js finish-console: step 1 (verify-expectations.json) failed: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  // Step 2: decision log — one terminal header, then one line per outcome.
  const now = new Date();
  try {
    const header = formatEntry({
      status: 'AUTO', now, step: 'Review Console',
      text: `Approved via finish-console --approve-all. ${memory.length} memory, ${upstream.length} upstream, ${ledgerUpdates.length} ledger update(s)`,
      reversibility: 'per item',
    });
    const lines = [
      ...memory.map((m) => formatEntry({
        status: 'AUTO', now, step: 'Review Console', text: `Memory update applied: ${m.file} (index: ${m.indexFile})`, reversibility: 'high',
      })),
      ...upstream.map((u) => formatEntry({
        status: 'AUTO', now, step: 'Review Console', text: `Upstream feedback filed: ${u.url}`, reversibility: 'high',
      })),
      ...ledgerUpdates.map((l) => formatEntry({
        status: 'AUTO', now, step: 'Review Console', text: `Ledger item #${l.item} -> ${l.status}: ${l.resolution || '(no resolution text)'}`, reversibility: 'high',
      })),
    ];
    appendEntry({ runDir: args.runDir, section: '/wrap-up', entry: [header, ...lines].join('\n') });
  } catch (e) {
    process.stderr.write(`wrap-up-engine.js finish-console: step 2 (decision log) failed: ${e.message} — step 1 (verify-expectations.json) already completed\n`);
    process.exitCode = 1;
    return;
  }

  // Step 3: ledger flips — skipped entirely (not an error) when the payload
  // named no ledger updates.
  if (ledgerUpdates.length > 0) {
    const worktree = readRunState(args.runDir)?.worktree || process.cwd();
    const resolved = resolveLedgerPath({ runDir: args.runDir, worktree, explicit: args.ledger || null });
    if (!resolved.ok) {
      const detail = resolved.reason === 'ambiguous'
        ? `${resolved.candidates.length} candidate ledgers found, cannot pick one — pass --ledger <path> explicitly:\n${resolved.candidates.map((c) => `  ${c}`).join('\n')}`
        : resolved.reason === 'rejected'
          ? `--ledger ${resolved.candidates[0]} rejected (${resolved.detail})`
          : 'no ledger found';
      process.stderr.write(`wrap-up-engine.js finish-console: step 3 (ledger flips) failed: ${detail} — steps 1-2 already completed\n`);
      process.exitCode = 1;
      return;
    }
    let text;
    try {
      text = fs.readFileSync(resolved.path, 'utf8');
    } catch (e) {
      process.stderr.write(`wrap-up-engine.js finish-console: step 3 (ledger flips) failed: could not read ${resolved.path}: ${e.message} — steps 1-2 already completed\n`);
      process.exitCode = 1;
      return;
    }
    for (const [i, l] of ledgerUpdates.entries()) {
      try {
        text = flipLedgerRow(text, l);
      } catch (e) {
        process.stderr.write(`wrap-up-engine.js finish-console: step 3 (ledger flips) failed at ledger[${i}]: ${e.message} — steps 1-2 already completed; ${i} of ${ledgerUpdates.length} ledger row(s) flipped so far were written together at the end, so NONE have been written yet\n`);
        process.exitCode = 1;
        return;
      }
    }
    try {
      writeFileAtomic(resolved.path, text);
    } catch (e) {
      process.stderr.write(`wrap-up-engine.js finish-console: step 3 (ledger flips) failed to write ${resolved.path}: ${e.message} — steps 1-2 already completed\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(`finish-console: approved — ${memory.length} memory, ${upstream.length} upstream, ${ledgerUpdates.length} ledger update(s) written.\n`);
}

function main() {
  const verb = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  // #790/[IL-127]: reject an unanchored --run-dir before any verb reads or
  // creates anything there. Existence-independent — plan's own
  // fs.mkdirSync(args.runDir) means the target often doesn't exist yet, and
  // isAnchoredUnderRoot already walks up to whichever ancestor does.
  if (args.runDir) {
    const cwd = process.cwd();
    const mainRoot = wtDetect.mainCheckoutRoot(cwd);
    if (!mainRoot) {
      // Distinct from the anchoring-rejection case below: no git repo could
      // be determined at all (not a repo, an unreadable ancestor, an
      // unparseable .git file) — misdiagnosing this as a worktree-shadow
      // rejection would send a reader hunting for the wrong problem.
      process.stderr.write(`wrap-up-engine.js: ${wtDetect.unanchoredRunDirNoRepoMessage(cwd)}\n`);
      process.exitCode = 2;
      return;
    }
    if (!wtDetect.isAnchoredUnderRoot(path.resolve(args.runDir), mainRoot)) {
      process.stderr.write(`wrap-up-engine.js: ${wtDetect.unanchoredRunDirShadowMessage(args.runDir, mainRoot)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  if (verb === 'plan') { runPlan(args); return; }
  if (verb === 'record') { runRecord(args); return; }
  if (verb === 'amend') { runAmend(args); return; }
  if (verb === 'render') { runRender(args); return; }
  if (verb === 'verify') { runVerifyVerb(args); return; }
  if (verb === 'finish-console') { runFinishConsole(args); return; }

  usageExit();
}

main();
