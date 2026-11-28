#!/usr/bin/env node
// bin/wrap-up-engine.js — CLI wiring the wrap-up curation engine modules
// (facts.js, engine-plan.js, engine-record.js, engine-render.js, engine-verify.js)
// into five verbs: `plan` (gather facts, build the worklist, initialize engine
// state), `record` (validate and store one judgment payload), `amend`
// (correct an already-recorded row without hand-editing engine-state.json),
// `render` (produce the Phase 2 phase-trace table or the Review Console's
// engine-fed sections), `verify` (run the closure-gate checks against a run
// dir, persisting the rows to verify.json).
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
//
// Repo-relative facts (docs/journeys/, CLAUDE.md, the skills/rules budget
// scan) resolve against the facts root — resolveFactsRoot(), below (the
// worktree/checkout --show-toplevel) — never against the bare cwd a
// subcommand happens to run from (#3017, #3431). Telemetry alone anchors to
// the main checkout, via resolveRepoRoot().
//
// Entry contract (#5379, gh-api-module-pattern's cli-wrapper-contract.md):
// `run(argv, deps)` returns the exit code; cwd, env, stdin, stdout, stderr,
// homeDir and the verify `git`/`gh` runners come through `deps` (realDeps in
// production), so tests call it in-process.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wtDetect = require('./lib/hooks/worktree-detect');
const { readRunState } = require('./lib/hooks/context');
const { injectedGhDeps, pickInjected } = require('./lib/repo-resolve');
const { resolveAgainst } = require('./lib/health-core/io');

// The plugin payload root — the directory with `skills/` directly beneath it
// (this repo: `plugin/`; an installed consumer: `${CLAUDE_PLUGIN_ROOT}`).
// Resolved from this script's own location, never from `process.cwd()`, so
// `render --section procedure:<name>` finds the real skill files regardless
// of which directory it's invoked from (#2546).
const PLUGIN_ROOT = path.join(__dirname, '..');

const { gatherFacts } = require('./lib/wrap-up/facts');
const { buildWorklist } = require('./lib/wrap-up/engine-plan');
const { initState, recordResult, amendResult } = require('./lib/wrap-up/engine-record');
const {
  renderTrace, renderConsoleSections, renderConsoleSectionsMulti, strictCheck, worklistRows, resolveProcedureHeadPath,
} = require('./lib/wrap-up/engine-render');
const {
  runVerify, renderVerifyTable, resolveArchivedRunDir, defaultGit, defaultGh,
} = require('./lib/wrap-up/engine-verify');
const { writeVerifyResults } = require('./lib/wrap-up/verify-results');
const { resolveLedgerPath, flipLedgerRow, parseLedgerTable, TERMINAL_STATUSES } = require('./lib/wrap-up/ledger-write');
const { ledgerRowCells } = require('./lib/wrap-up/ledger-cells');
const { headerField } = require('./lib/stage-item/ledger');
const { sddRulingRatifyAction, SDD_RULING_RATIFY_ACTIONS } = require('./lib/console/sdd-ruling');
const { appendEntry, formatEntry } = require('./lib/log-decision/append');
const { drainPath } = require('./lib/learned-skills/layout');
const { writeFileAtomic } = require('./lib/atomic-write');
const { validateFields, writeExpectations } = require('./lib/verify-expectations/write');

const USAGE = [
  'usage: wrap-up-engine.js plan --run-dir <dir> --base <sha> [--ceremony <profile>] [--skill-budget n] [--doc-budget n] [--signals <json>] [--dry-run]',
  '       wrap-up-engine.js record --run-dir <dir> [--dry-run]   (payload JSON on stdin)',
  '       wrap-up-engine.js record --run-dir <dir> --batch <file> [--dry-run]   (JSON array of payloads, one file)',
  '       wrap-up-engine.js amend --run-dir <dir>   (payload JSON on stdin)',
  '       wrap-up-engine.js render --run-dir <dir> [--strict] [--section trace|console] [--start-at n]',
  '       wrap-up-engine.js render --section procedure:<name>   (no --run-dir, no --spec-state, no --strict)',
  '       wrap-up-engine.js render --section console --spec-state <id>=<path> [--spec-state <id>=<path> ...] [--start-at n] [--strict]   (no --run-dir)',
  '       wrap-up-engine.js verify --run-dir <dir> --base <ref>',
  '       wrap-up-engine.js finish-console --run-dir <dir> --approve-all [--ledger <path>]   (JSON {memory?,upstream?,issues?,ledger?} on stdin)',
  '',
  'plan/record: --dry-run skips only the telemetry append; engine-state.json and decisions.md are still written, so it is no preview.',
  '',
].join('\n');

function usage(d) {
  d.stderr(USAGE);
  return 2;
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
    // null, so every existing `if (!args.runDir) return usage(d);` check below
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
// happens to execute from. `env` is the injected environment (deps.env).
function resolveRepoRoot(cwd, env) {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    if (!commonDir) return cwd;
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    return path.dirname(abs);
  } catch {
    return cwd;
  }
}

// #3431: the common-dir root above is the MAIN checkout even from a linked
// worktree, so it is right for telemetry but wrong for repo facts — those must
// read the worktree being built. --show-toplevel is that worktree's (or the
// checkout's) top-level, and is the same for a subdirectory cwd (#3017).
function resolveFactsRoot(cwd, env) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return top || cwd;
  } catch {
    return cwd;
  }
}

// #3017: every caller of this function may pass a raw, possibly-subdirectory
// d.cwd() as-is — it resolves the repo root itself via resolveRepoRoot
// before joining anything, so a subdirectory cwd and the checkout root
// produce the identical telemetry path. runRecord/runRecordBatch's own
// `const cwd = d.cwd()` sites are correct unconverted for exactly this
// reason: they feed only this function, never a raw filesystem join.
function resolveTelemetryPath(cwd, env) {
  return path.join(resolveRepoRoot(cwd, env), '.claude-tweaks', 'wrap-up-outcomes.tsv');
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

// ---- verbs ------------------------------------------------------------
//
// Every verb is `runX(args, d) → exit code`. `args.runDir` is the --run-dir
// flag as given (messages print it); `args.runDirPath` is the same path
// resolved against d.cwd() (set by `run` once the anchoring check passes),
// which every fs and library call reads.

function runPlan(args, d) {
  if (!args.runDir || !args.base) return usage(d);

  let signals = {};
  if (args.signals) {
    try {
      signals = JSON.parse(args.signals);
    } catch (e) {
      d.stderr(`wrap-up-engine.js plan: --signals is not valid JSON: ${e.message}\n`);
      return 2;
    }
  }

  const cwd = d.cwd();
  // #3017: gatherFacts() resolves filesystem facts (docs/journeys/,
  // CLAUDE.md) as paths under the cwd it's given — the raw process cwd is
  // wrong whenever the shell sits in a subdirectory of the checkout (e.g. an
  // app in `<worktree>/web`), since those paths live at the repo root, not
  // the subdirectory. The facts root is the --show-toplevel of cwd, which
  // covers both the subdirectory and the linked-worktree cases (#3431: not the
  // common-dir root, which is the main checkout). Pass that, never the bare
  // cwd, into every repo-fact read.
  const factsRoot = resolveFactsRoot(cwd, d.env);
  const facts = gatherFacts({ cwd: factsRoot, base: args.base, env: d.env });
  const journeyFrontmatter = buildJourneyFrontmatter(factsRoot, facts.journeyFiles);

  const budgets = {};
  if (args.skillBudget !== null) budgets['skill-budget'] = Number(args.skillBudget);
  if (args.docBudget !== null) budgets['doc-budget'] = Number(args.docBudget);

  const ceremonyProfile = args.ceremony || 'standard';
  const worklist = buildWorklist({ facts, signals, ceremonyProfile, budgets, journeyFrontmatter });

  fs.mkdirSync(args.runDirPath, { recursive: true });

  // initState has no dryRun parameter of its own (unlike recordResult) — a
  // --dry-run plan skips telemetry by passing telemetryPath: null, which
  // appendTelemetry() already treats as "skip the append silently".
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd, d.env);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  initState({ runDir: args.runDirPath, worklist, now: new Date(), telemetryPath });

  d.stdout(`${JSON.stringify(worklist, null, 2)}\n`);
  return 0;
}

// Shared by runRecord/runAmend: a run dir with no engine-state.json means
// plan never ran (or the run dir was wiped) — a malformed invocation, not a
// bad payload, so it must exit 2 like render's identical check, not fall
// through to recordResult's/amendResult's readEngineState() throwing inside
// the generic catch below (which would misreport it as exit 1). Returns
// null when the precondition holds; 2 (having already written the error)
// otherwise. `runDirPath` is read, `runDir` (the flag as given) is printed.
function requireEngineState(runDirPath, runDir, verb, d) {
  if (fs.existsSync(path.join(runDirPath, 'engine-state.json'))) return null;
  d.stderr(`wrap-up-engine.js ${verb}: no engine-state.json in ${runDir} — run plan first\n`);
  return 2;
}

// Shared by runRecord/runAmend/runFinishConsole: read stdin and parse it as
// JSON. Invocation shape (--run-dir) was already fine by this point; the
// payload wasn't, so this is exit 1, not 2 — the model retries with a fixed
// payload rather than re-reading usage. Returns `{ payload }`, or `{ code: 1 }`
// (having already written the error) on a parse failure. A falsy payload
// (`null`, `false`, `0`) is returned as parsed; each caller then exits 0 with
// no output.
function parseStdinPayload(verb, d) {
  const raw = d.stdin();
  try {
    return { payload: JSON.parse(raw) };
  } catch (e) {
    d.stderr(`wrap-up-engine.js ${verb}: stdin is not valid JSON: ${e.message}\n`);
    return { code: 1 };
  }
}

// Shared by runRecord/runAmend: print decisions.md's last line — the
// SCANNED/AMENDED line the underlying recordResult/amendResult call just
// appended. The printed bytes are a contract: skills read this line.
function printLastDecisionLine(runDirPath, d) {
  const decisionLines = fs.readFileSync(path.join(runDirPath, 'decisions.md'), 'utf8').trim().split('\n');
  d.stdout(`${decisionLines[decisionLines.length - 1]}\n`);
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
function runRecordBatch(args, d) {
  let raw;
  try {
    raw = fs.readFileSync(resolveAgainst(d.cwd(), args.batch), 'utf8');
  } catch (e) {
    d.stderr(`wrap-up-engine.js record --batch: could not read ${args.batch}: ${e.message}\n`);
    return 1;
  }
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    d.stderr(`wrap-up-engine.js record --batch: ${args.batch} is not valid JSON: ${e.message}\n`);
    return 1;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    d.stderr(`wrap-up-engine.js record --batch: ${args.batch} must be a non-empty JSON array of payloads\n`);
    return 1;
  }

  const cwd = d.cwd();
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd, d.env);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  for (let i = 0; i < entries.length; i += 1) {
    try {
      recordResult({
        runDir: args.runDirPath, payload: entries[i], now: new Date(), dryRun: args.dryRun, telemetryPath,
      });
    } catch (e) {
      d.stderr(`wrap-up-engine.js record --batch: entry ${i} (of ${entries.length}) failed: ${e.message}\n`);
      return 1;
    }
    printLastDecisionLine(args.runDirPath, d);
  }
  return 0;
}

function runRecord(args, d) {
  if (!args.runDir) return usage(d);
  const missing = requireEngineState(args.runDirPath, args.runDir, 'record', d);
  if (missing !== null) return missing;

  if (args.batch) return runRecordBatch(args, d);

  const parsed = parseStdinPayload('record', d);
  if (parsed.code !== undefined) return parsed.code;
  const { payload } = parsed;
  if (!payload) return 0;

  const cwd = d.cwd();
  const telemetryPath = args.dryRun ? null : resolveTelemetryPath(cwd, d.env);
  if (telemetryPath) fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });

  try {
    recordResult({ runDir: args.runDirPath, payload, now: new Date(), dryRun: args.dryRun, telemetryPath });
  } catch (e) {
    d.stderr(`wrap-up-engine.js record: ${e.message}\n`);
    return 1;
  }

  printLastDecisionLine(args.runDirPath, d);
  return 0;
}

function runAmend(args, d) {
  if (!args.runDir) return usage(d);
  const missing = requireEngineState(args.runDirPath, args.runDir, 'amend', d);
  if (missing !== null) return missing;

  const parsed = parseStdinPayload('amend', d);
  if (parsed.code !== undefined) return parsed.code;
  const { payload } = parsed;
  if (!payload) return 0;

  try {
    amendResult({ runDir: args.runDirPath, payload, now: new Date() });
  } catch (e) {
    d.stderr(`wrap-up-engine.js amend: ${e.message}\n`);
    return 1;
  }

  printLastDecisionLine(args.runDirPath, d);
  return 0;
}

function runRender(args, d) {
  const section = args.section || 'trace';
  const procedureName = section.startsWith('procedure:') ? section.slice('procedure:'.length) : null;
  if (section !== 'trace' && section !== 'console' && procedureName === null) {
    d.stderr(`wrap-up-engine.js render: --section must be 'trace', 'console', or 'procedure:<name>'\n`);
    return 2;
  }

  // #2546: `procedure:<name>` emits a registered split-file's operative-head
  // excerpt verbatim — no engine-state.json, no --run-dir, no --strict. A
  // caller that currently reads one of the four split files whole can read
  // this excerpt instead, lowering per-run read volume without requiring a
  // pipeline run to exist at all.
  if (procedureName !== null) {
    if (procedureName === '') {
      d.stderr(`wrap-up-engine.js render: --section procedure:<name> requires a name\n`);
      return 2;
    }
    if (args.runDir || args.specStates.length > 0 || args.strict) return usage(d);
    const relPath = resolveProcedureHeadPath(procedureName);
    if (!relPath) {
      d.stderr(`wrap-up-engine.js render: unknown procedure '${procedureName}'\n`);
      return 2;
    }
    const fullPath = path.join(PLUGIN_ROOT, relPath);
    let markdown;
    try {
      markdown = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      d.stderr(`wrap-up-engine.js render: could not read procedure '${procedureName}' at ${fullPath}: ${e.message}\n`);
      return 2;
    }
    d.stdout(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    return 0;
  }

  if (args.specStates.length > 0) {
    if (section !== 'console') return usage(d); // AC9: --spec-state only valid with --section console
    if (args.runDir) return usage(d); // AC8: --spec-state and --run-dir are mutually exclusive

    const specStates = [];
    for (const raw of args.specStates) {
      const eq = raw.indexOf('=');
      if (eq === -1) return usage(d); // AC13: value must be id=path

      const specId = raw.slice(0, eq);
      const p = raw.slice(eq + 1);
      let state;
      try {
        state = JSON.parse(fs.readFileSync(resolveAgainst(d.cwd(), p), 'utf8'));
      } catch (e) {
        // AC12: name the failing path, exit 2, never an uncaught exception.
        d.stderr(`wrap-up-engine.js render: could not read spec state from ${p}: ${e.message}\n`);
        return 2;
      }
      // Valid JSON that isn't a state object (e.g. a file containing just
      // `null`) parses without throwing above but would otherwise blow up as
      // an uncaught TypeError inside renderConsoleSectionsMulti — treat it
      // as the same failure-to-read case, same message format, exit 2.
      if (state === null || typeof state !== 'object' || state.results === null || typeof state.results !== 'object') {
        d.stderr(`wrap-up-engine.js render: could not read spec state from ${p}: parsed value is not a valid engine-state object\n`);
        return 2;
      }
      specStates.push({ specId, state });
    }

    const { markdown } = renderConsoleSectionsMulti(specStates, { startAt: args.startAt !== null ? Number(args.startAt) : 1 });
    d.stdout(`${markdown}\n`);

    let code = 0;
    if (args.strict) {
      const incomplete = specStates
        .map(({ specId, state }) => ({ specId, missing: strictCheck(state).missing }))
        .filter((entry) => entry.missing.length > 0);
      if (incomplete.length > 0) {
        for (const entry of incomplete) {
          d.stderr(`wrap-up-engine.js render: spec ${entry.specId} incomplete — missing: ${entry.missing.join(', ')}\n`);
        }
        code = 2;
      }
    }
    return code;
  }

  if (!args.runDir) return usage(d);

  // #3856: after cleanup archives the run, the given path is gone; resolve the
  // archived copy the same way verify does. Null (neither location) keeps the
  // given path, so the error below still names it.
  const resolvedDir = resolveArchivedRunDir(args.runDirPath, resolveRepoRoot(d.cwd(), d.env)) || args.runDirPath;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(resolvedDir, 'engine-state.json'), 'utf8'));
  } catch (e) {
    d.stderr(`wrap-up-engine.js render: could not read engine-state.json from ${args.runDir}: ${e.message}\n`);
    return 2;
  }

  // The drain's outcome for this run's own learned-skills PR; absent or
  // unparseable renders exactly as before.
  let drain;
  try {
    drain = JSON.parse(fs.readFileSync(drainPath(resolvedDir), 'utf8'));
  } catch (e) {
    drain = undefined;
  }

  const output = section === 'trace'
    ? renderTrace(state, { drain })
    : renderConsoleSections(state, { startAt: args.startAt !== null ? Number(args.startAt) : 1, drain }).markdown;

  // Print first, so the hole is visible even when --strict is about to make
  // it fatal.
  d.stdout(`${output}\n`);

  const check = strictCheck(state);

  // #2688: `render --section console` renders only 'findings' results, so a
  // run dir where `plan` ran but `record` was never invoked for any open row
  // produces nothing to print — the CLI used to say so nowhere, on either
  // path (empty stdout + silent exit 0, or empty stdout + a bare exit 2 under
  // --strict). Detect that specific precondition — every open row still
  // missing from `results` — and name it, rather than let the absence of
  // output stand for the absence of a diagnostic. A run where `record` ran
  // (even producing zero findings) is unaffected: at least one open row's id
  // is present in `results` by then, so `neverRecorded` is false.
  if (section === 'console') {
    const rows = worklistRows(state.worklist) || [];
    const openRows = rows.filter((row) => row.gate !== 'closed');
    const neverRecorded = openRows.length > 0 && openRows.every((row) => check.missing.includes(row.id));
    if (neverRecorded) {
      d.stderr(
        `wrap-up-engine.js render: no recorded results in ${args.runDir} — `
        + `\`record\` was never run for any open row (ran \`plan\` only). `
        + 'Run `record` for each open row before rendering the console section.\n',
      );
    }
  }

  let code = 0;
  if (args.strict) {
    if (!check.ok) code = 2;
  }
  return code;
}

function runVerifyVerb(args, d) {
  if (!args.runDir || !args.base) return usage(d);
  // #3017: already correct — repoRoot and cwd are threaded through
  // separately on purpose. Each check function (engine-verify.js's CHECKS)
  // picks whichever one its own fact needs: repoRoot for anything resolved
  // against the checkout (archived-run lookups), the raw cwd for a check
  // that legitimately runs relative to wherever the caller invoked from
  // (e.g. a `gh` call, which works from any subdirectory). #3431 audit: the
  // --base diff checks (carrier-commit, reference-repairs) already run git
  // with the raw cwd, which resolves the worktree's own HEAD; repoRoot feeds
  // only main-checkout-anchored lookups (archived runs, policy.yml), so no
  // facts-root change belongs here.
  const cwd = d.cwd();
  const repoRoot = resolveRepoRoot(cwd, d.env);
  const resolvedDir = resolveArchivedRunDir(args.runDirPath, repoRoot);
  // Every git and gh child the checks start goes through d.git/d.gh with the
  // injected process context; gateDeps carries the same env, stderr and home
  // directory to the origin gate.
  const ctx = pickInjected(d);
  const { rows, exitCode } = runVerify({
    runDir: resolvedDir, originalRunDir: args.runDirPath, base: args.base, repoRoot, cwd,
    deps: { git: (a, c) => d.git(a, c, ctx), gh: (a, c) => d.gh(a, c, ctx), gateDeps: injectedGhDeps(ctx) },
  });
  d.stdout(`${renderVerifyTable(rows)}\n`);
  // #3783: persist the rows beside the run's other artifacts. Only into
  // resolvedDir -- the dir that was actually verified (the archived copy when
  // the original is gone). Never args.runDir: writeVerifyResults' lock
  // bootstrap would recreate a missing parent, resurrecting a stale original.
  // A write failure is reported, never the verdict.
  if (resolvedDir !== null) {
    try {
      writeVerifyResults({ runDir: resolvedDir, rows, base: args.base });
    } catch (e) {
      d.stderr(`wrap-up-engine.js verify: could not write verify.json in ${resolvedDir}: ${e.message}\n`);
    }
  }
  // The script entry assigns this to process.exitCode, never process.exit():
  // exiting right after a large write can truncate stdout on a pipe (see
  // MEMORY.md's async-write-vs-process-exit-race incident).
  return exitCode;
}

// finish-console: `issues` participates only when the payload names it
// (non-null); an absent or null key must neither validate nor overwrite a
// stored issues array.
function optionalIssuesField(payload) {
  return payload.issues != null ? { issues: payload.issues } : {};
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
// Payload shape (all arrays optional; memory/upstream default to [] and
// overwrite the stored array, while `issues` is written only when the key is
// present and non-null, so an absent/null key leaves a stored issues array untouched):
//   { "memory": [{ "file": "...", "indexFile": "..." }, ...],
//     "upstream": [{ "url": "..." }, ...],
//     "issues": [3394, ...],
//     "ledger": [{ "item": 3, "status": "deferred", "resolution": "..." }, ...] }
//
// Atomicity (Gotchas, record #2544; pre-flight, record #3684): payload
// validation, ledger resolution and every row flip are checked before any
// write — a refusal there names the failing ledger row (or the reason the
// ledger could not be resolved or read) and writes none of the three
// artifacts. Only a write failure (an I/O fault mid-call) can leave earlier
// steps landed: verify-expectations.json first, then the decision log, then
// the ledger, in that fixed order. The three writes are NOT transactional
// across each other, and a re-run after a step-2 or step-3 write failure is
// not idempotent: the decision log is append-only, so it appends the
// Approve-all header and outcome lines again. This is a documented best-effort
// posture, not a bug: building real cross-file-format transactionality for
// three unrelated artifacts is out of scope for a bookkeeping-consolidation
// CLI — the exit code and stderr message are the recovery contract.
function validateFinishConsolePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'stdin JSON must be an object with optional "memory"/"upstream"/"issues"/"ledger" array fields';
  }
  const memory = payload.memory ?? [];
  const upstream = payload.upstream ?? [];
  const ledger = payload.ledger ?? [];
  // memory/upstream/issues shape is the writer library's own check — one rule
  // for both writers of verify-expectations.json (#2764).
  const fieldsError = validateFields({ memory, upstream, ...optionalIssuesField(payload) });
  if (fieldsError) return fieldsError;
  if (!Array.isArray(ledger)) return '"ledger" must be an array';
  for (const [i, l] of ledger.entries()) {
    if (!l || !Number.isInteger(l.item) || l.item <= 0) return `ledger[${i}].item must be a positive integer`;
    if (!TERMINAL_STATUSES.includes(l.status)) return `ledger[${i}].status must be one of ${TERMINAL_STATUSES.join(', ')}`;
    if (l.status !== 'observation' && !String(l.resolution || '').trim()) return `ledger[${i}].resolution is required for status '${l.status}'`;
    // #3942: ratifying a deferral ruling files a record; its row goes deferred only
    // with that record's number — an uncreated record leaves the row open instead.
    if (l.status === 'deferred' && /^ratified\b/i.test(String(l.resolution).trim()) && !/→\s*#\d+/.test(l.resolution)) {
      return `ledger[${i}]: a ratified deferral needs its record number (ratified → #{n}) — leave the row open when the record was not created`;
    }
  }
  return null;
}

// #3942 backstop: an `accepted` entry may close an SDD ruling's row only when its ratify
// action is `accept` (a settled `Defers: no`). A deferral's ratify files a record (row
// `deferred`, `ratified → #{n}`); a ruling with no ratify action leaves the row open.
// stage-item.js --ledger names the pairing twice — the staged file's `Ledger: {ref}#{n}`
// header and the row's `(staged/{name})` Item suffix. The Item suffix decides when present
// (it lives in the ledger the caller resolved, and an empty or unreadable file has no header
// to read); only a row whose Item names no file falls back to the header's number, and then
// every ruling carrying that number must be `accept` — list order never picks one. A row
// naming a staged ruling that is gone reads as unreadable. Returns the refusal or null.
function rulingAcceptError(runDir, ledgerText, ledgerUpdates) {
  if (!ledgerUpdates.some((l) => l.status === 'accepted')) return null;
  const base = path.resolve(runDir);
  const stagedDir = path.join(base, 'staged');
  let names = [];
  try { names = fs.readdirSync(stagedDir).filter((n) => /^sdd-ruling-.*\.md$/.test(n)); } catch { /* no staged/ — no rulings */ }
  // IL-161: the same contained read the on-PR console's gate uses (console-execute.js), so a
  // symlinked `staged/sdd-ruling-*.md` that leaves the run dir reads as unreadable here too, never
  // as ruling text. Loaded lazily: this runs only for an `accepted` entry on finish-console.
  const { readInsideRunDir } = require('./lib/reconcile/console-execute');
  const rulings = names.map((name) => {
    const read = readInsideRunDir(base, `staged/${name}`);
    const text = read.error ? null : read.text;
    const m = text === null ? null : /#(\d+)$/.exec(headerField(text, 'Ledger') || '');
    return { name, text, row: m ? Number(m[1]) : null };
  });
  const { rows } = parseLedgerTable(ledgerText);
  for (const [i, l] of ledgerUpdates.entries()) {
    if (l.status !== 'accepted') continue;
    const row = rows.get(String(l.item));
    const named = row ? /\(staged\/(sdd-ruling-[^()\s]+\.md)\)$/.exec(ledgerRowCells(row)[2] || '') : null;
    const matched = named
      ? [rulings.find((r) => r.name === named[1]) || { name: named[1], text: null }]
      : rulings.filter((r) => r.row === l.item);
    for (const ruling of matched) {
      const action = sddRulingRatifyAction(ruling.text);
      if (action === SDD_RULING_RATIFY_ACTIONS.ACCEPT) continue;
      return action === SDD_RULING_RATIFY_ACTIONS.FILE_RECORD
        ? `ledger[${i}]: ${ruling.name} is not a settled \`Defers: no\` ruling — its ratify files a record (deferred, ratified → #{n}), never accepted`
        : `ledger[${i}]: ${ruling.name} is not ratifiable (empty, blank, or unreadable) — its row stays open, never accepted`;
    }
  }
  return null;
}

function runFinishConsole(args, d) {
  if (!args.runDir || !args.approveAll) return usage(d);

  const parsed = parseStdinPayload('finish-console', d);
  if (parsed.code !== undefined) return parsed.code;
  const { payload } = parsed;
  if (!payload) return 0;
  const validationError = validateFinishConsolePayload(payload);
  if (validationError) {
    d.stderr(`wrap-up-engine.js finish-console: ${validationError}\n`);
    return 1;
  }
  const memory = payload.memory ?? [];
  const upstream = payload.upstream ?? [];
  const ledgerUpdates = payload.ledger ?? [];
  const issuesField = optionalIssuesField(payload);
  const issuesNote = issuesField.issues ? `, issues: [${issuesField.issues.join(', ')}]` : '';

  // Pre-flight (#3684): resolve the ledger and apply every row flip in memory
  // before step 1 writes anything, so a row the flip refuses stops the call
  // with nothing written. Step 3 writes the text computed here.
  let ledgerFlip = null;
  if (ledgerUpdates.length > 0) {
    // #3017: d.cwd() here is an intentional fallback, not a repo-facts
    // read — readRunState's own worktree field is already the right root
    // when present (the run's worktree, which may differ from the main
    // checkout), and the raw cwd is the correct substitute only for the rare
    // case that field is absent. Overriding it with resolveRepoRoot's main
    // checkout would resolve the ledger against the wrong worktree.
    const worktree = readRunState(args.runDirPath)?.worktree || d.cwd();
    // The docs/plans fallback's base lookup runs pack.js's git and policy
    // reads under the injected env, and its `gh repo view` probe through the
    // one d.gh seam (verify's runner options: 5000 ms timeout, piped stderr).
    // pack.js stays lazily loaded: only that fallback needs it.
    const ctx = pickInjected(d);
    const resolveBase = (wt) => {
      const { resolveWorktreeBase, defaultDeps } = require('./lib/wrap-up/pack');
      return resolveWorktreeBase(wt, { ...defaultDeps(wt, { env: d.env }), ghSync: (a, o = {}) => d.gh(a, o.cwd, ctx) });
    };
    const resolved = resolveLedgerPath({
      runDir: args.runDirPath, worktree, explicit: args.ledger ? resolveAgainst(d.cwd(), args.ledger) : null,
      env: d.env, deps: { resolveBase },
    });
    if (!resolved.ok) {
      const detail = resolved.reason === 'ambiguous'
        ? `${resolved.candidates.length} candidate ledgers found, cannot pick one — pass --ledger <path> explicitly:\n${resolved.candidates.map((c) => `  ${c}`).join('\n')}`
        : resolved.reason === 'rejected'
          ? `--ledger ${args.ledger} rejected (${resolved.detail})`
          : resolved.reason === 'unattributable'
            ? `cannot attribute docs/plans ledgers to this run (${resolved.detail}) — pass --ledger <path> explicitly`
            : 'no ledger found';
      d.stderr(`wrap-up-engine.js finish-console: ledger pre-flight failed: ${detail} — nothing written\n`);
      return 1;
    }
    let text;
    try {
      text = fs.readFileSync(resolved.path, 'utf8');
    } catch (e) {
      d.stderr(`wrap-up-engine.js finish-console: ledger pre-flight failed: could not read ${resolved.path}: ${e.message} — nothing written\n`);
      return 1;
    }
    for (const [i, l] of ledgerUpdates.entries()) {
      try {
        text = flipLedgerRow(text, l);
      } catch (e) {
        d.stderr(`wrap-up-engine.js finish-console: ledger pre-flight failed at ledger[${i}]: ${e.message} — nothing written\n`);
        return 1;
      }
    }
    // Every flip above succeeded, so the table parses; a flip never changes an Item cell.
    const rulingError = rulingAcceptError(args.runDirPath, text, ledgerUpdates);
    if (rulingError) {
      d.stderr(`wrap-up-engine.js finish-console: ${rulingError} — nothing written\n`);
      return 1;
    }
    ledgerFlip = { path: resolved.path, text };
  }

  // Step 1: verify-expectations.json (read-modify-write — preserve every
  // field this verb doesn't itself own, same discipline
  // review-console.md's step 11 documents for oversightExempt/issues).
  try {
    writeExpectations({ runDir: args.runDirPath, fields: { memory, upstream, ...issuesField } });
  } catch (e) {
    d.stderr(`wrap-up-engine.js finish-console: step 1 (verify-expectations.json) failed: ${e.message}\n`);
    return 1;
  }

  // Step 2: decision log — one terminal header, then one line per outcome.
  const now = new Date();
  try {
    const header = formatEntry({
      status: 'AUTO', now, step: 'Review Console',
      text: `Approved via finish-console --approve-all. ${memory.length} memory, ${upstream.length} upstream, ${ledgerUpdates.length} ledger update(s)${issuesNote}`,
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
    appendEntry({ runDir: args.runDirPath, section: '/wrap-up', entry: [header, ...lines].join('\n') });
  } catch (e) {
    d.stderr(`wrap-up-engine.js finish-console: step 2 (decision log) failed: ${e.message} — step 1 (verify-expectations.json) already completed\n`);
    return 1;
  }

  // Step 3: ledger write — the pre-flight above already flipped every row, so
  // this is the one I/O call. Skipped entirely (not an error) when the payload
  // named no ledger updates.
  if (ledgerFlip) {
    try {
      writeFileAtomic(ledgerFlip.path, ledgerFlip.text);
    } catch (e) {
      d.stderr(`wrap-up-engine.js finish-console: step 3 (ledger flips) failed to write ${ledgerFlip.path}: ${e.message} — steps 1-2 already completed\n`);
      return 1;
    }
  }

  d.stdout(`finish-console: approved — ${memory.length} memory, ${upstream.length} upstream, ${ledgerUpdates.length} ledger update(s) written${issuesNote}.\n`);
  return 0;
}

const realDeps = {
  cwd: () => process.cwd(),
  get env() { return process.env; },
  homeDir: () => os.homedir(),
  stdin: () => {
    try {
      return fs.readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  // verify's runners: (args, cwd, ctx) with ctx = { env, stderr, homeDir }.
  git: defaultGit,
  gh: defaultGh,
};

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const verb = argv[0];
  const args = parseArgs(argv.slice(1));

  // #790/[IL-127]: reject an unanchored --run-dir before any verb reads or
  // creates anything there. Existence-independent — plan's own
  // fs.mkdirSync(args.runDirPath) means the target often doesn't exist yet, and
  // isAnchoredUnderRoot already walks up to whichever ancestor does.
  if (args.runDir) {
    // #3017: intentionally the raw cwd, not a repo-facts read — this check
    // is about run-dir anchoring ([IL-127], the main checkout vs. a linked
    // worktree), a different root entirely from the repo-facts root
    // resolveRepoRoot resolves elsewhere in this file. mainCheckoutRoot
    // already does its own worktree-aware resolution from wherever cwd is.
    // The injected d.cwd(), never process.cwd(): a guard bolted onto a seamed
    // CLI is where the seam gets holed.
    const cwd = d.cwd();
    const mainRoot = wtDetect.mainCheckoutRoot(cwd);
    if (!mainRoot) {
      // Distinct from the anchoring-rejection case below: no git repo could
      // be determined at all (not a repo, an unreadable ancestor, an
      // unparseable .git file) — misdiagnosing this as a worktree-shadow
      // rejection would send a reader hunting for the wrong problem.
      d.stderr(`wrap-up-engine.js: ${wtDetect.unanchoredRunDirNoRepoMessage(cwd)}\n`);
      return 2;
    }
    // The guard compares one absolute, normalized value against the main checkout root, while fs
    // access below keeps resolveAgainst's unnormalized join, so a trailing slash or a `..` after a
    // symlink reaches the kernel as typed (.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md).
    if (!wtDetect.isAnchoredUnderRoot(path.resolve(cwd, args.runDir), mainRoot)) {
      d.stderr(`wrap-up-engine.js: ${wtDetect.unanchoredRunDirShadowMessage(args.runDir, mainRoot)}\n`);
      return 2;
    }
    args.runDirPath = resolveAgainst(cwd, args.runDir);
  }

  if (verb === 'plan') return runPlan(args, d);
  if (verb === 'record') return runRecord(args, d);
  if (verb === 'amend') return runAmend(args, d);
  if (verb === 'render') return runRender(args, d);
  if (verb === 'verify') return runVerifyVerb(args, d);
  if (verb === 'finish-console') return runFinishConsole(args, d);

  return usage(d);
}

module.exports = { run, realDeps, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
