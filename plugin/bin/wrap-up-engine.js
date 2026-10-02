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

const { gatherFacts } = require('./lib/wrap-up/facts');
const { buildWorklist } = require('./lib/wrap-up/engine-plan');
const { initState, recordResult, amendResult } = require('./lib/wrap-up/engine-record');
const {
  renderTrace, renderConsoleSections, renderConsoleSectionsMulti, strictCheck, worklistRows,
} = require('./lib/wrap-up/engine-render');
const { runVerify, renderVerifyTable, resolveArchivedRunDir } = require('./lib/wrap-up/engine-verify');

const USAGE = [
  'usage: wrap-up-engine.js plan --run-dir <dir> --base <sha> [--ceremony <profile>] [--skill-budget n] [--doc-budget n] [--signals <json>] [--dry-run]',
  '       wrap-up-engine.js record --run-dir <dir> [--dry-run]   (payload JSON on stdin)',
  '       wrap-up-engine.js amend --run-dir <dir>   (payload JSON on stdin)',
  '       wrap-up-engine.js render --run-dir <dir> [--strict] [--section trace|console] [--start-at n]',
  '       wrap-up-engine.js render --section console --spec-state <id>=<path> [--spec-state <id>=<path> ...] [--start-at n] [--strict]   (no --run-dir)',
  '       wrap-up-engine.js verify --run-dir <dir> --base <ref>',
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

function runRecord(args) {
  if (!args.runDir) { usageExit(); return; }
  if (!requireEngineState(args.runDir, 'record')) return;

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
  if (section !== 'trace' && section !== 'console') {
    process.stderr.write(`wrap-up-engine.js render: --section must be 'trace' or 'console'\n`);
    process.exitCode = 2;
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

  const check = strictCheck(state);

  // #2688: `render --section console` renders only 'findings' results, so a
  // run dir where `plan` ran but `record` was never invoked for any open row
  // produces nothing to print — the CLI used to say so nowhere, on either
  // path (empty stdout + silent exit 0, or empty stdout + a bare exit 2 under
  // --strict). Detect that specific precondition — every open row still
  // missing from `results` — and name it, rather than let the absence of
  // output stand for the absence of a diagnostic. A run where `record` ran
  // (even producing zero findings) is unaffected: at least one open row's id
  // is present in `results` by then, so `missingOpenRows` is empty.
  if (section === 'console') {
    const rows = worklistRows(state.worklist) || [];
    const openRows = rows.filter((row) => row.gate !== 'closed');
    const missingOpenRows = openRows.filter((row) => check.missing.includes(row.id));
    if (openRows.length > 0 && missingOpenRows.length === openRows.length) {
      process.stderr.write(
        `wrap-up-engine.js render: no recorded results in ${args.runDir} — `
        + `\`record\` was never run for any open row (ran \`plan\` only). `
        + 'Run `record` for each open row before rendering the console section.\n',
      );
    }
  }

  if (args.strict) {
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

  usageExit();
}

main();
