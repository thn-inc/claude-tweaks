#!/usr/bin/env node
// bin/phase-timing.js — render a run's per-phase timing (#1928) and, given
// a transcript, its per-phase tokens (#1929).
//
//   node bin/phase-timing.js --run <dir> [--json] [--markdown]
//        [--transcript <path> ...] [--auto-transcript]
//
// Reads {run-dir}/events.jsonl (per-line JSON; a malformed line is skipped,
// a missing file is an empty run), {run-dir}/manifest.yml (optional) and
// {run-dir}/run-state.json (optional: pr.mergedAt; worktree + sessionId for
// --auto-transcript), writes {run-dir}/timing.json, and prints the markdown
// table (--markdown) or the JSON object (--json); with neither it prints the
// path it wrote. Exit 0 in every derivable case — missing events degrade per
// row to `unattributed`; a missing or unreadable transcript degrades to
// blank token columns plus one `tokens: transcript not found (...)` line.
// `--run ""` (present but empty — the canonical skill snippet's unset-
// $PIPELINE_RUN_DIR idiom, matching verify.js's own treatment of it) prints
// "no run directory" to stderr, writes nothing, and returns 0. Exit 2 only
// on a genuinely malformed invocation: a MISSING --run flag, a --run that
// is not a directory, an events.jsonl that exists but cannot be read, or a
// --transcript flag with no value.
//
// --transcript is repeatable (dispatch's two Task calls have two agent
// transcripts; the orchestrator passes both). --auto-transcript is the
// single-session case: it locates {home}/.claude/projects/{slug}/{sessionId}
// .jsonl from run-state.json's worktree + sessionId (bin/lib/timing/
// transcript.js), picks the newest candidate, and notes any it ignored.
'use strict';
const fs = require('fs');
const path = require('path');
const { derivePhases, joinTokens, countGuardEvents } = require('./lib/timing/derive');
const { locateTranscripts, readUsage } = require('./lib/timing/transcript');
const { readManifest } = require('./lib/flow/manifest');

const USAGE = 'usage: phase-timing.js --run <dir> [--json] [--markdown] [--transcript <path> ...] [--auto-transcript]\n';

function parseArgs(argv) {
  const o = { run: null, json: false, markdown: false, transcripts: [], autoTranscript: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') { o.run = argv[i + 1]; i++; if (o.run === undefined) return null; continue; }
    if (a === '--transcript') { const v = argv[i + 1]; i++; if (v === undefined) return null; o.transcripts.push(v); continue; }
    if (a === '--auto-transcript') { o.autoTranscript = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--markdown') { o.markdown = true; continue; }
    return null;
  }
  if (o.run === null) return null; // flag never supplied — malformed
  return o;
}

function readEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, events: [] };
    return { ok: false, error: err.message };
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* per-row skip, never fatal */ }
  }
  return { ok: true, events };
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function verifyCell(verify) {
  if (!verify.length) return '—';
  const counts = new Map();
  for (const v of verify) counts.set(v.mode || 'unknown', (counts.get(v.mode || 'unknown') || 0) + 1);
  return [...counts].map(([m, n]) => `${m} ×${n}`).join(', ');
}

function kb(bytes) { return (bytes / 1024).toFixed(1); }

// A phase, `tokens.unattributed`, or `tokens.totals` all share the same
// { tokens: {input, output, ...}, procedureBytes, toolRoundTrips } shape —
// this renders the three trailing token columns for any of them.
function tokenCols(bucket) {
  return ` ${bucket.tokens.input}/${bucket.tokens.output} | ${kb(bucket.procedureBytes)} | ${bucket.toolRoundTrips} |`;
}

function extraCols(bucket, blank) {
  return blank ? ' — | — | — |' : tokenCols(bucket);
}

// out: derivePhases result; tokens: joinTokens result or null (no transcript
// requested); notes: lines printed before the table.
function renderMarkdown(out, tokens = null, guard = null, notes = []) {
  const withTokens = tokens !== null;
  const lines = [];
  for (const n of notes) lines.push(n);
  lines.push(withTokens ? '| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |' : '| Phase | Minutes | Verify |');
  lines.push(withTokens ? '|---|---|---|---|---|---|' : '|---|---|---|');
  const rows = withTokens ? tokens.phases : out.phases;
  const blank = withTokens && tokens.totals.rows === 0;
  for (const p of rows) {
    const minutes = p.ownMinutes !== p.minutes ? `${p.minutes} (own ${p.ownMinutes})` : String(p.minutes);
    const verify = p.source === 'unattributed' ? 'unattributed' : verifyCell(p.verify);
    const extra = withTokens ? extraCols(p, blank) : '';
    lines.push(`| ${p.phase} | ${minutes} | ${verify} |${extra}`);
  }
  if (withTokens && tokens.unattributed.rows > 0) {
    lines.push(`| unattributed | — | — |${tokenCols(tokens.unattributed)}`);
  }
  if (out.totals.minutes > 0 || out.totals.verifyRuns > 0 || (tokens && tokens.totals.rows > 0)) {
    const verifyTot = `${out.totals.verifyRuns} run(s)${out.totals.verifyModes.length ? ` (${out.totals.verifyModes.join(', ')})` : ''}`;
    const extra = withTokens ? extraCols(tokens.totals, blank) : '';
    lines.push(`| total | ${out.totals.minutes} | ${verifyTot} |${extra}`);
  }
  if (guard) {
    lines.push('', `Guard denials: ${guard.gateDenial} gate · ${guard.wdAmbiguous} wd-ambiguous · ${guard.wdDeny} wd-deny`);
    lines.push('Tokens (in/out) sum the transcript\'s raw input_tokens/output_tokens; cache reads and creation are separate fields in timing.json.');
  }
  return lines.join('\n') + '\n';
}

// Resolve the transcript list: explicit --transcript paths, plus the
// auto-located one. Returns { paths, notes }.
function resolveTranscripts(o, runState) {
  const paths = [...o.transcripts];
  const notes = [];
  if (o.autoTranscript) {
    const worktree = runState && typeof runState.worktree === 'string' ? runState.worktree : null;
    const sessionId = runState && typeof runState.sessionId === 'string' ? runState.sessionId : null;
    if (!worktree && !sessionId) {
      notes.push('tokens: transcript not found (no worktree or sessionId in run-state.json)');
    } else {
      const found = locateTranscripts({ cwd: worktree, sessionId });
      if (!found.length) notes.push(`tokens: transcript not found (no ${sessionId ? `${sessionId}.jsonl` : '*.jsonl'} under the ${worktree ? 'worktree slug' : 'projects'} directory)`);
      else {
        paths.push(found[0].path);
        if (found.length > 1) notes.push(`tokens: ${found.length - 1} other candidate(s) ignored: ${found.slice(1).map((c) => c.path).join(', ')}`);
      }
    }
  }
  return { paths, notes };
}

async function main(argv) {
  const o = parseArgs(argv);
  if (!o) { process.stderr.write(USAGE); return 2; }
  if (o.run === '') {
    process.stderr.write('timing: no run directory (PIPELINE_RUN_DIR unset)\n');
    return 0;
  }
  const runDir = path.resolve(o.run);
  let stat = null;
  try { stat = fs.statSync(runDir); } catch { /* not a directory, handled below */ }
  if (!stat || !stat.isDirectory()) { process.stderr.write(`phase-timing.js: --run ${o.run} is not a directory\n${USAGE}`); return 2; }
  const events = readEvents(path.join(runDir, 'events.jsonl'));
  if (!events.ok) { process.stderr.write(`phase-timing.js: events.jsonl unreadable (${events.error})\n`); return 2; }
  const runState = readJsonOrNull(path.join(runDir, 'run-state.json'));
  const out = derivePhases({ events: events.events, manifest: readManifest(runDir), runState });

  const wantTokens = o.transcripts.length > 0 || o.autoTranscript;
  const { paths, notes } = wantTokens ? resolveTranscripts(o, runState) : { paths: [], notes: [] };
  const transcripts = [];
  let rows = [];
  for (const p of paths) {
    try {
      const r = await readUsage(p, { worktree: runState && runState.worktree ? runState.worktree : null });
      if (r.length === 0) {
        const note = `transcript had no usage rows (${p})`;
        transcripts.push({ path: p, rows: 0, note });
        notes.push(`tokens: ${note}`);
      } else {
        transcripts.push({ path: p, rows: r.length });
      }
      rows = rows.concat(r);
    } catch (err) {
      const reason = `${err && err.code ? err.code : 'unreadable'}: ${p}`;
      transcripts.push({ path: p, rows: 0, note: `transcript not found (${reason})` });
      notes.push(`tokens: transcript not found (${reason})`);
    }
  }
  const tokens = wantTokens ? joinTokens(out.phases, rows) : null;
  if (tokens) tokens.totals.rows = rows.length;
  const guard = wantTokens ? countGuardEvents(events.events) : null;

  const timing = { runDir, generatedAt: new Date().toISOString(), phases: tokens ? tokens.phases : out.phases, totals: { ...out.totals } };
  if (tokens) {
    timing.unattributed = tokens.unattributed;
    timing.totals.tokens = tokens.totals.tokens;
    timing.totals.procedureBytes = tokens.totals.procedureBytes;
    timing.totals.toolRoundTrips = tokens.totals.toolRoundTrips;
    timing.totals.guard = guard;
    timing.transcripts = transcripts;
    if (notes.length) timing.notes = notes;
  }
  const timingPath = path.join(runDir, 'timing.json');
  fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2) + '\n');
  if (o.markdown) process.stdout.write(renderMarkdown(out, tokens, guard, notes));
  else if (o.json) process.stdout.write(JSON.stringify(timing, null, 2) + '\n');
  else process.stdout.write(`timing: wrote ${timingPath}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    process.stderr.write(`phase-timing.js: ${err && err.message}\n`);
    process.exitCode = 2;
  });
}
module.exports = { main, parseArgs, renderMarkdown };
