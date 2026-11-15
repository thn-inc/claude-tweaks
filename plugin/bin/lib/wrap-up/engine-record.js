// bin/lib/wrap-up/engine-record.js — wrap-up curation engine: state
// initialization, judgment-payload validation, uniform SCANNED decision
// lines, and outcome telemetry.
//
// Three entry points:
//   initState({ runDir, worklist, now, telemetryPath }) — called once by
//     `plan`. Writes engine-state.json (worklist + empty results map), then
//     immediately pre-resolves every CLOSED row: result 'na', a SCANNED line,
//     and a telemetry line.
//   recordResult({ runDir, payload, now, dryRun, telemetryPath }) — called
//     once per OPEN row with the model's judgment payload. Validates,
//     appends one SCANNED line and one telemetry line (unless dryRun), and
//     updates engine-state.json.
//   amendResult({ runDir, payload, now, telemetryPath }) — corrects a row
//     already present in state.results (typically written by recordResult).
//     Re-runs the same validation, overwrites the stored result, and appends
//     an AMENDED decisions.md line instead of a second SCANNED line. Never
//     re-appends telemetry — the original recordResult call already counted
//     the row once.
//
// FORBIDDEN_VOCABULARY (imported from engine-render.js, not redefined here)
// is checked against payload.detail and every payload.findings[].summary
// before a row is ever written — a record-time pre-flight in front of
// engine-render.js's own render-time defense-in-depth check of the same
// pattern list, so a violation is rejected (retryable) instead of landing in
// engine-state.json/decisions.md and only surfacing later at render time.
//
// IL-01 discipline: stored results are built by picking named fields off the
// payload into a fresh object alongside derived fields (target from
// REGISTRY, rowId) — never `{ ...payload }`. A payload cannot smuggle extra
// keys or override a derived field this way.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { FORBIDDEN_VOCABULARY } = require('./engine-render');

const STATE_FILE = 'engine-state.json';
const DECISIONS_FILE = 'decisions.md';

// ---- time helpers -----------------------------------------------------

function toDate(now) {
  if (now instanceof Date) return now;
  if (typeof now === 'string' && now) return new Date(now);
  return new Date();
}

function isoTime(now) {
  return toDate(now).toISOString();
}

function dateOnly(now) {
  return isoTime(now).slice(0, 10);
}

// ---- state file I/O ----------------------------------------------------

function statePath(runDir) {
  return path.join(runDir, STATE_FILE);
}

function readEngineState(runDir) {
  return JSON.parse(fs.readFileSync(statePath(runDir), 'utf8'));
}

function writeEngineState(runDir, state) {
  fs.writeFileSync(statePath(runDir), `${JSON.stringify(state, null, 2)}\n`);
}

function worklistRows(worklist) {
  return worklist && Array.isArray(worklist.rows) ? worklist.rows : worklist;
}

// ---- decisions.md (append-only audit log) ------------------------------

function appendDecisionLine(runDir, line) {
  fs.appendFileSync(path.join(runDir, DECISIONS_FILE), `${line}\n`);
}

// ---- SCANNED line rendering ---------------------------------------------

function formatReadPaths(read) {
  if (!read || read.length === 0) return 'none';
  return read.map((r) => r.path).join(', ');
}

function formatResultText(result, findings) {
  if (result === 'na') return 'n/a';
  if (result === 'clean') return 'clean';
  if (result === 'findings') {
    const applied = (findings || []).filter((f) => f.action === 'applied').length;
    const staged = (findings || []).filter((f) => f.action === 'staged').length;
    return `${applied} applied, ${staged} staged`;
  }
  return String(result);
}

function hasAppliedFinding(findings) {
  return (findings || []).some((f) => f.action === 'applied');
}

function buildScannedLine({ isoTime: time, target, gate, gateReason, read, gapDetection, result, findings }) {
  const n = read ? read.length : 0;
  const paths = formatReadPaths(read);
  const gapText = gapDetection === 'run' ? 'run' : 'not run';
  const resultText = formatResultText(result, findings);
  const reversibility = hasAppliedFinding(findings) ? 'high (separate commit)' : 'N/A';
  return `SCANNED ${time} — ${target}: gate ${gate} (${gateReason}); read ${n} (${paths}); gap detection: ${gapText}. Result: ${resultText}. Reversibility: ${reversibility}.`;
}

// Same shape as buildScannedLine, distinct verb prefix — decisions.md is no
// longer strictly one line per row once a row has been amended; a trailing
// AMENDED line follows the row's original SCANNED line.
function buildAmendedLine(fields) {
  return buildScannedLine(fields).replace(/^SCANNED /, 'AMENDED ');
}

// ---- telemetry -----------------------------------------------------------

function telemetryOutcome(result, findings) {
  if (result === 'na') return 'na';
  if (result === 'clean') return 'clean';
  if (result === 'findings') return hasAppliedFinding(findings) ? 'applied' : 'staged';
  return String(result);
}

// Coupled reader: plugin/bin/lib/calibration/tsv-reader.js parses this exact column shape.
function appendTelemetry(telemetryPath, { now, runId, rowId, gate, findings, result }) {
  // telemetryPath is an explicit param, not defaulted here — the CLI resolves
  // the production path. When absent (e.g. a caller that hasn't wired it up
  // yet), skip the append silently rather than throw or guess a location.
  if (!telemetryPath) return;
  const date = dateOnly(now);
  const count = (findings || []).length;
  const outcome = telemetryOutcome(result, findings);
  const line = `${date}\t${runId}\t${rowId}\t${gate}\t${count}\t${outcome}\n`;
  fs.appendFileSync(telemetryPath, line);
}

// ---- payload validation ---------------------------------------------------

// Record-time pre-flight for engine-render.js's FORBIDDEN_VOCABULARY list
// (imported, never redefined here — see module header). Checks
// payload.detail (when a string) and every payload.findings[].summary
// (findings shape/typing already validated by the caller before this runs).
// Throws the same recordResult:-style Error the other validatePayload checks
// use, naming the offending field and pattern.
function checkForbiddenVocabulary(payload) {
  if (typeof payload.detail === 'string') {
    for (const pattern of FORBIDDEN_VOCABULARY) {
      if (pattern.test(payload.detail)) {
        throw new Error(`recordResult: payload.detail matches forbidden vocabulary pattern ${pattern} (rowId '${payload.rowId}')`);
      }
    }
  }
  if (Array.isArray(payload.findings)) {
    payload.findings.forEach((finding, index) => {
      if (!finding || typeof finding.summary !== 'string') return;
      for (const pattern of FORBIDDEN_VOCABULARY) {
        if (pattern.test(finding.summary)) {
          throw new Error(`recordResult: payload.findings[${index}].summary matches forbidden vocabulary pattern ${pattern} (rowId '${payload.rowId}')`);
        }
      }
    });
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error("recordResult: payload is missing or not an object");
  }
  if (typeof payload.rowId !== 'string' || !payload.rowId) {
    throw new Error("recordResult: payload.rowId is missing or not a string");
  }
  if (payload.result !== 'clean' && payload.result !== 'findings') {
    throw new Error(`recordResult: payload.result must be 'clean' or 'findings' (rowId '${payload.rowId}')`);
  }
  if (payload.gapDetection !== 'run' && payload.gapDetection !== 'not-run') {
    throw new Error(`recordResult: payload.gapDetection must be 'run' or 'not-run' (rowId '${payload.rowId}')`);
  }
  if (payload.read !== undefined && !Array.isArray(payload.read)) {
    throw new Error(`recordResult: payload.read must be an array (rowId '${payload.rowId}')`);
  }
  if (payload.result === 'findings') {
    if (!Array.isArray(payload.findings) || payload.findings.length === 0) {
      throw new Error(`recordResult: payload.findings must be a non-empty array when result is 'findings' (rowId '${payload.rowId}')`);
    }
    // Each entry drives formatResultText/hasAppliedFinding/telemetryOutcome,
    // all of which filter on f.action — an unvalidated model judgment output
    // with a malformed or missing 'action' would silently render as 0
    // applied/0 staged in the permanent decisions.md audit line while
    // findings.length still counts it. Validate every entry.
    payload.findings.forEach((finding, index) => {
      if (!finding || typeof finding !== 'object') {
        throw new Error(`recordResult: payload.findings[${index}] must be an object (rowId '${payload.rowId}')`);
      }
      if (finding.action !== 'applied' && finding.action !== 'staged') {
        throw new Error(`recordResult: payload.findings[${index}].action must be 'applied' or 'staged' (rowId '${payload.rowId}')`);
      }
      if (typeof finding.kind !== 'string' || !finding.kind) {
        throw new Error(`recordResult: payload.findings[${index}].kind must be a non-empty string (rowId '${payload.rowId}')`);
      }
      if (typeof finding.summary !== 'string' || !finding.summary) {
        throw new Error(`recordResult: payload.findings[${index}].summary must be a non-empty string (rowId '${payload.rowId}')`);
      }
      // #5290: an applied Skills-row edit has a commit, on the run branch or from learned-skills-pr.js
      // land. One without it never left capture's patch file, so no land or stage delivered it.
      if (payload.rowId === 'skills' && finding.action === 'applied' && (typeof finding.commit !== 'string' || !finding.commit.trim())) {
        throw new Error(`recordResult: payload.findings[${index}] is an applied skills-row finding with no commit — run learned-skills-pr.js land or stage first, then rewrite the payload from its output (rowId '${payload.rowId}')`);
      }
    });
  } else if (payload.findings !== undefined && !Array.isArray(payload.findings)) {
    throw new Error(`recordResult: payload.findings must be an array (rowId '${payload.rowId}')`);
  }

  checkForbiddenVocabulary(payload);
}

// Shared by recordResult/amendResult: look up payload.rowId in the current
// worklist and throw the "unknown rowId" error, named per the calling verb,
// when it isn't there. Each caller still runs its own closed/already-recorded
// (or never-recorded) checks afterward — those diverge between the two and
// stay inline at the call site.
function lookupRow(state, rowId, verb) {
  const rows = worklistRows(state.worklist);
  const row = rows.find((r) => r.id === rowId);
  if (!row) {
    throw new Error(`${verb}: unknown rowId '${rowId}' (not in the worklist)`);
  }
  return row;
}

// Shared by recordResult/amendResult: the IL-01 field-picking step (module
// header) — pick named fields off the payload into a fresh object alongside
// 'target' (always sourced from the worklist row, never the payload). Never
// `{ ...payload }`.
function pickStoredFields(row, payload) {
  return {
    rowId: payload.rowId,
    target: row.target,
    result: payload.result,
    detail: payload.detail,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
    read: Array.isArray(payload.read) ? payload.read : [],
    gapDetection: payload.gapDetection,
  };
}

// A row's disposition (from REGISTRY, via the worklist row) governs whether
// findings may be auto-applied. 'stage' and 'stage-only' rows — e.g.
// claude-md, memory, upstream — exist precisely because their findings must
// never land without a human seeing them first (claude-md: CLAUDE.md/rules
// edits are ceremony-gated by design). validatePayload alone can't check
// this: disposition lives on the worklist row, not the payload, so this
// runs in recordResult once the row is in hand — after the closed/
// already-recorded checks, before anything is written.
function validateDispositionForRow(payload, row) {
  if (payload.result !== 'findings') return;
  if (row.disposition !== 'stage' && row.disposition !== 'stage-only') return;
  payload.findings.forEach((finding, index) => {
    if (finding.action === 'applied') {
      throw new Error(
        `recordResult: payload.findings[${index}].action cannot be 'applied' — row '${payload.rowId}' has disposition '${row.disposition}'`
      );
    }
  });
}

// ---- public API -----------------------------------------------------------

function initState({ runDir, worklist, now, telemetryPath }) {
  const rows = worklistRows(worklist);
  const time = isoTime(now);
  const runId = path.basename(runDir);
  const results = {};

  for (const row of rows) {
    if (row.gate !== 'closed') continue;
    results[row.id] = { rowId: row.id, target: row.target, result: 'na', detail: row.gateReason };

    const line = buildScannedLine({
      isoTime: time, target: row.target, gate: row.gate, gateReason: row.gateReason,
      read: [], gapDetection: 'not-run', result: 'na', findings: [],
    });
    appendDecisionLine(runDir, line);

    appendTelemetry(telemetryPath, { now, runId, rowId: row.id, gate: 'closed', findings: [], result: 'na' });
  }

  const state = { version: 1, worklist, results };
  writeEngineState(runDir, state);
  return state;
}

function recordResult({ runDir, payload, now, dryRun, telemetryPath }) {
  validatePayload(payload);

  const state = readEngineState(runDir);
  const row = lookupRow(state, payload.rowId, 'recordResult');

  if (row.gate === 'closed') {
    throw new Error(`recordResult: row '${payload.rowId}' is closed and cannot be recorded (${row.gateReason})`);
  }
  if (state.results[payload.rowId]) {
    throw new Error(`recordResult: row '${payload.rowId}' was already recorded`);
  }

  validateDispositionForRow(payload, row);

  const stored = pickStoredFields(row, payload);
  const { findings, read } = stored;

  const time = isoTime(now);
  const line = buildScannedLine({
    isoTime: time, target: row.target, gate: row.gate, gateReason: row.gateReason,
    read, gapDetection: payload.gapDetection, result: payload.result, findings,
  });
  appendDecisionLine(runDir, line);

  if (!dryRun) {
    appendTelemetry(telemetryPath, {
      now, runId: path.basename(runDir), rowId: payload.rowId, gate: row.gate, findings, result: payload.result,
    });
  }

  state.results[payload.rowId] = stored;
  writeEngineState(runDir, state);

  return stored;
}

// Corrects a row already present in state.results — the amend counterpart to
// recordResult, for when a wrong/forbidden value was already written and
// hand-editing engine-state.json would otherwise be the only fix. Mirrors
// recordResult except: (a) requires the row to already be recorded instead
// of rejecting when it is; (b) has no "already recorded" throw; (c) appends
// an AMENDED decisions.md line instead of a second SCANNED line; (d) never
// re-appends telemetry — the original recordResult call already counted this
// row once, and amending a stored result must not double-count it.
function amendResult({ runDir, payload, now, telemetryPath }) {
  validatePayload(payload);

  const state = readEngineState(runDir);
  const row = lookupRow(state, payload.rowId, 'amendResult');

  if (row.gate === 'closed') {
    throw new Error(`amendResult: row '${payload.rowId}' is closed and cannot be amended (${row.gateReason})`);
  }
  if (!state.results[payload.rowId]) {
    throw new Error(`amendResult: row '${payload.rowId}' was never recorded — nothing to amend`);
  }

  validateDispositionForRow(payload, row);

  // Same IL-01 discipline as recordResult: pick named fields, never spread.
  const stored = pickStoredFields(row, payload);
  const { findings, read } = stored;

  const time = isoTime(now);
  const line = buildAmendedLine({
    isoTime: time, target: row.target, gate: row.gate, gateReason: row.gateReason,
    read, gapDetection: payload.gapDetection, result: payload.result, findings,
  });
  appendDecisionLine(runDir, line);

  // No telemetry append — the original recordResult call already counted
  // this rowId once; `telemetryPath` is accepted for a call-shape parity
  // with recordResult but intentionally unused here.

  state.results[payload.rowId] = stored;
  writeEngineState(runDir, state);

  return stored;
}

module.exports = { initState, recordResult, amendResult, appendTelemetry };
