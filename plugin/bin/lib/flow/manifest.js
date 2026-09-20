// bin/lib/flow/manifest.js — reads/writes a multi-spec run's manifest.yml
// (schema documented in skills/flow/multispec-run-dir-layout.md)
// and couples every status write to the `## Flow: Running ...` progress
// banner (#690). This is a targeted parser/serializer for that one fixed
// shape — `{ multispec: { parent, baseSha?, specs: [{id, status, subdir,
// startedAt?}] } }` — not a general YAML implementation: the plugin ships
// zero runtime npm deps (see bin/lib/policy.js's own header for the same
// constraint), and manifest.yml is entirely machine-owned (no hand-editing
// convention to preserve, unlike policy.yml).
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

const VALID_STATUSES = ['pending', 'running', 'complete', 'failed', 'not-run'];

function coerceId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && String(n) === String(raw).trim() ? n : String(raw).trim();
}

// manifest.yml is machine-owned — no value ever contains '#' — so a naive
// split-on-first-'#' is safe here (policy.yml is hand-edited and must
// tolerate '#' inside a value's natural text; this file is not that case).
function stripComment(line) {
  const idx = line.indexOf('#');
  return (idx === -1 ? line : line.slice(0, idx)).replace(/\s+$/, '');
}

// Parses the fixed manifest.yml shape. Returns null when the file doesn't
// match (missing `multispec:` root, or no `parent:` value) rather than
// throwing — callers treat "doesn't parse" and "doesn't exist" the same way.
function parseManifestYaml(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map(stripComment);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] !== 'multispec:') return null;
  i++;
  const multispec = { parent: null, specs: [] };
  let current = null;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const listMatch = raw.match(/^ {4}- id: (.+)$/);
    if (listMatch) {
      current = { id: coerceId(listMatch[1]) };
      multispec.specs.push(current);
      continue;
    }
    const phasesHeader = raw.match(/^ {6}phases:\s*$/);
    if (phasesHeader && current) {
      current.phases = [];
      continue;
    }
    const phaseItem = raw.match(/^ {8}- phase: (.+)$/);
    if (phaseItem && current && Array.isArray(current.phases)) {
      current.phases.push({ phase: phaseItem[1].trim() });
      continue;
    }
    const phaseField = raw.match(/^ {10}(\w+): (.*)$/);
    if (phaseField && current && Array.isArray(current.phases) && current.phases.length) {
      current.phases[current.phases.length - 1][phaseField[1]] = phaseField[2].trim();
      continue;
    }
    const fieldMatch = raw.match(/^ {6}(\w+): (.*)$/);
    if (fieldMatch && current) {
      current[fieldMatch[1]] = fieldMatch[2].trim();
      continue;
    }
    const topMatch = raw.match(/^ {2}(\w+): (.*)$/);
    if (topMatch && topMatch[1] !== 'specs') {
      multispec[topMatch[1]] = topMatch[2].trim();
      continue;
    }
    // '  specs:' line itself, or anything else unrecognized — ignore.
  }
  return multispec.parent ? { multispec } : null;
}

function serializeManifestYaml(manifest) {
  const m = manifest.multispec;
  const lines = ['multispec:', `  parent: ${m.parent}`];
  if (m.baseSha) lines.push(`  baseSha: ${m.baseSha}`);
  lines.push('  specs:');
  for (const spec of m.specs) {
    lines.push(`    - id: ${spec.id}`);
    lines.push(`      status: ${spec.status}`);
    if (spec.subdir) lines.push(`      subdir: ${spec.subdir}`);
    if (spec.startedAt) lines.push(`      startedAt: ${spec.startedAt}`);
    if (spec.phase) lines.push(`      phase: ${spec.phase}`);
    if (Array.isArray(spec.phases) && spec.phases.length) {
      lines.push('      phases:');
      for (const p of spec.phases) {
        lines.push(`        - phase: ${p.phase}`);
        lines.push(`          status: ${p.status}`);
        lines.push(`          at: ${p.at}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

function manifestPath(runDir) {
  return path.join(runDir, 'manifest.yml');
}

function readManifest(runDir) {
  let text;
  try { text = fs.readFileSync(manifestPath(runDir), 'utf8'); } catch { return null; }
  return parseManifestYaml(text);
}

// Write via bin/lib/atomic-write.js's writeFileAtomic (#1653) — same pattern
// as bin/lib/hooks/context.js's writeRunState, for the same reason:
// fs.renameSync is atomic on every platform Node supports (same dir, same
// filesystem), so a crash mid-write during a long multi-spec run (the exact
// scenario #690 exists to survive) leaves the previous manifest.yml intact
// instead of a torn/partial file.
function writeManifest(runDir, manifest) {
  const finalPath = manifestPath(runDir);
  try {
    writeFileAtomic(finalPath, serializeManifestYaml(manifest));
    return true;
  } catch {
    return false;
  }
}

// ms -> compact elapsed text: "45s", "12m34s", "1h05m". Never negative or NaN.
function formatElapsedMs(ms) {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSec = Math.round(safe / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// The one function that mutates a spec's manifest.yml status. This is the
// whole point of #690: there is no separate "just write the status" export,
// so nothing calling into this module can write a phase transition without
// also getting back the banner text for it — the two cannot drift apart the
// way free-text narration did.
//
// { runDir, specId, status, phase, now? } ->
//   { ok:true, banner, summaryLine, position, total, manifest } |
//   { ok:false, reason: 'invalid-status'|'missing-phase'|'no-manifest'|'unknown-spec'|'write-failed' }
// `phase` is persisted as spec.phase (latest) and appended to spec.phases[]
// (append-only transition log) on every successful call.
//
// `now` is an injectable clock (Date or ISO string) — defaults to the real
// clock; tests pin it to compute a deterministic elapsed value.
function transitionSpec({ runDir, specId, status, phase, now = new Date() }) {
  if (!VALID_STATUSES.includes(status)) return { ok: false, reason: 'invalid-status' };
  if (!phase) return { ok: false, reason: 'missing-phase' };
  const manifest = readManifest(runDir);
  if (!manifest) return { ok: false, reason: 'no-manifest' };
  // specs[].id is a number or a string (see coerceId) and specId arrives as
  // either — match on text so a CLI '159' finds a parsed 159.
  const wantId = String(specId).trim();
  const index = manifest.multispec.specs.findIndex((s) => String(s.id) === wantId);
  if (index === -1) return { ok: false, reason: 'unknown-spec' };
  const spec = manifest.multispec.specs[index];
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  if (status === 'running' && !spec.startedAt) spec.startedAt = nowIso;
  spec.status = status;

  // #1928: persist the phase and log the transition — the timing derivation
  // (bin/lib/timing/derive.js) reads phases[] as the manifest-side boundary
  // source. Append-only: a re-entered phase adds another entry.
  spec.phase = phase;
  if (!Array.isArray(spec.phases)) spec.phases = [];
  spec.phases.push({ phase, status, at: nowIso });

  const total = manifest.multispec.specs.length;
  const position = index + 1;
  const banner = `## Flow: Running ${phase} (${position}/${total}) — spec #${spec.id}`;

  let summaryLine = null;
  if (status === 'complete' || status === 'failed') {
    const elapsed = spec.startedAt ? formatElapsedMs(nowDate - new Date(spec.startedAt)) : 'n/a';
    // Outcome is always "deferred" here, not a placeholder for something
    // else: multi-spec.md's "Shared worktree" section finishes the run's
    // single branch exactly once, after every spec completes and the
    // consolidated Review Console runs — never per-spec, in any mode. A
    // per-spec complete/failed transition therefore never itself knows
    // "merged" or "pr" at the moment it fires. If a future strategy gives
    // each spec its own worktree, this is the line to revisit.
    summaryLine = `spec #${spec.id}: ${status} — deferred (${elapsed})`;
  }

  if (!writeManifest(runDir, manifest)) return { ok: false, reason: 'write-failed' };
  return { ok: true, banner, summaryLine, position, total, manifest };
}

// specs (manifest.multispec.specs) -> string[] of one line per spec, in
// manifest order: 'Fixes #{id}' for status:'complete', 'Refs #{id} — not
// run/failed: {reason}' for any other status. #2015: a bundle PR's `Fixes`
// block is composed once at run start (pr-early-run-lifecycle.md's Step 3),
// before any spec has run, so it always lists every spec as if it would
// complete — this is what the pre-merge refresh (that file's "Pre-merge
// title/description refresh" section) calls to correct the block against
// actual outcomes before the PR is marked ready, so a `not-run`/`failed`
// spec's issue is never closed by the merge commit.
function composeFixesBlock(specs) {
  return (specs || []).map((spec) => {
    if (spec.status === 'complete') return `Fixes #${spec.id}`;
    const reason = spec.status === 'not-run'
      ? 'not run'
      : spec.status === 'failed'
        ? (spec.phase ? `failed at ${spec.phase}` : 'failed')
        : spec.status; // pending/running — defensive; the refresh runs post-gate
    return `Refs #${spec.id} — not run/failed: ${reason}`;
  });
}

module.exports = {
  VALID_STATUSES,
  parseManifestYaml,
  serializeManifestYaml,
  readManifest,
  writeManifest,
  formatElapsedMs,
  transitionSpec,
  composeFixesBlock,
};
