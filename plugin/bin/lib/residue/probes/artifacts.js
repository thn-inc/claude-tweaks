// bin/lib/residue/probes/artifacts.js — QA artifact retention (#1078).
// Two finding classes, both kind 'artifact', both scope 'observed' (repo
// housekeeping unattributable to the current run — never blast-radius, so
// /wrap-up's --scope blast-radius sweep deliberately never surfaces these;
// /tidy's default --scope repo does):
//   - aged artifact dir: a first-level entry under one of the three
//     .claude-tweaks/artifacts/ roots whose newest contained file (recursive;
//     the dir's own mtime when it contains no files, so empty dirs are not
//     immortal) is older than 30 days. remedy 'auto' — gitignored,
//     declared-transient evidence past its shelf life. Safe to auto-delete
//     because the whole namespace is plugin-owned by construction.
//   - legacy root residue: a project-root screenshots/ or traces/ tree (the
//     pre-#1077 convention). This namespace is NOT plugin-owned — `screenshots/`
//     is an ordinary directory name any project may use for real, tracked
//     content — so the class carries two ownership discriminators:
//       * shape match: the tree looks like the pre-relocation plugin layout —
//         `screenshots/` has a first-level `qa` or `browse` subdirectory;
//         `traces/` has a first-level subdirectory containing a `.zip` at any
//         depth. A tree that does not match is not ours: no finding at all.
//       * untracked proof: `git ls-files -- <root>` returns EMPTY, proving no
//         tracked file lives under it. A null return (git failed, not a repo,
//         or no runner injected) is UNPROVEN, never "untracked".
//     Emission: shape mismatch OR tracked → skip silently, no finding.
//     Shape match, untracked or unproven → remedy 'record', ALWAYS — never
//     'auto'. /tidy auto-applies `remedy: auto` deletions at every tier, and
//     neither discriminator proves plugin ownership: "untracked" proves
//     non-tracked (a user's own gitignored traces/ archive is equally
//     untracked), and the shape heuristics match generic layouts (any
//     subdir-with-a-.zip tree passes the traces/ check). A legacy root is a
//     one-time migration residue per project — it surfaces once for human
//     disposition; auto-deleting an unowned namespace on heuristics is the
//     failure mode, not the saving.
// Per-root ENOENT is clean (a project that has only ever run /browse has no
// traces/ root); any OTHER read failure fails the whole probe loudly — a
// partial scan must never report as a clean sweep (sibling probes' contract).
// The aged-dir scan below is directories-only by design, not by omission:
// every producer under these three roots writes a per-run/session
// subdirectory (`test/qa-procedures.md`'s `RUN_DIR`, `journey-health/SKILL.md`'s
// `screenshots/qa/*/report.json` glob), never a loose first-level file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeFinding } = require('../finding');
const { mainCheckoutRoot } = require('../../hooks/worktree-detect');

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const ARTIFACT_ROOTS = [
  path.join('.claude-tweaks', 'artifacts', 'screenshots', 'qa'),
  path.join('.claude-tweaks', 'artifacts', 'screenshots', 'browse'),
  path.join('.claude-tweaks', 'artifacts', 'traces'),
];
const LEGACY_ROOTS = ['screenshots', 'traces'];
const LEGACY_SHAPE_SUBDIRS = ['qa', 'browse'];
const UNPROVEN_NOTE = '; git could not prove the tree untracked — treat as possibly project-owned content';

// How a read failure is named in the probe-level `reason` — errno when the
// error carries one, the error itself otherwise.
function errLabel(err) {
  return (err && err.code) || err;
}

// Recursive newest file under dir, as `{ mtimeMs, file }` — `file` is the
// winner's path relative to `dir`. Both fields are null when dir contains no
// files at any depth. Throws on ANY read error (including ENOENT — this
// function has no tolerance of its own); the caller turns that into the
// probe-level ran:false.
function newestFileMtimeMs(dir) {
  let newest = { mtimeMs: null, file: null };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = newestFileMtimeMs(p);
      if (child.mtimeMs !== null && (newest.mtimeMs === null || child.mtimeMs > newest.mtimeMs)) {
        newest = { mtimeMs: child.mtimeMs, file: path.join(entry.name, child.file) };
      }
    } else if (entry.isFile()) {
      const m = fs.statSync(p).mtimeMs;
      if (newest.mtimeMs === null || m > newest.mtimeMs) newest = { mtimeMs: m, file: entry.name };
    }
  }
  return newest;
}

// Age basis for a directory: newest contained file, else the dir's own mtime.
// Returns `{ basisMs, file }` — `file` is null on the dir-mtime fallback, which
// is what the evidence string renders as "no files — dir mtime".
function ageBasisMs(dir) {
  const newest = newestFileMtimeMs(dir);
  if (newest.mtimeMs !== null) return { basisMs: newest.mtimeMs, file: newest.file };
  return { basisMs: fs.statSync(dir).mtimeMs, file: null };
}

// Recursive: does `dir` contain a .zip file at any depth, and what's the
// newest file's `{ mtimeMs, file }` under it (file relative to dir) — merges
// what used to be two separate recursive descents of the same subtree
// (containsZip + newestFileMtimeMs) into one (#1177).
function zipAndNewest(dir) {
  let hasZip = false;
  let newest = { mtimeMs: null, file: null };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = zipAndNewest(p);
      if (child.hasZip) hasZip = true;
      if (child.newest.mtimeMs !== null && (newest.mtimeMs === null || child.newest.mtimeMs > newest.mtimeMs)) {
        newest = { mtimeMs: child.newest.mtimeMs, file: path.join(entry.name, child.newest.file) };
      }
    } else if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith('.zip')) hasZip = true;
      const m = fs.statSync(p).mtimeMs;
      if (newest.mtimeMs === null || m > newest.mtimeMs) newest = { mtimeMs: m, file: entry.name };
    }
  }
  return { hasZip, newest };
}

// Single-pass replacement for legacyShapeMatches + ageBasisMs on the same
// `base` — previously two separate fs.readdirSync(base) walks (#1177): one
// top-level readdirSync, computing the shape-match signal and the age basis
// together instead of walking the tree twice. Shape rule per `rel`: for
// 'screenshots', an immediate child directory named per LEGACY_SHAPE_SUBDIRS;
// otherwise, any immediate child directory containing a .zip at any depth
// (zipAndNewest's `hasZip`, exactly matching the retired containsZip's
// semantics — a .zip directly at base's own top level does not count).
function legacyShapeAndAge(rel, base) {
  const entries = fs.readdirSync(base, { withFileTypes: true });
  let shaped = false;
  let newest = { mtimeMs: null, file: null };
  for (const entry of entries) {
    const p = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (rel === 'screenshots' && LEGACY_SHAPE_SUBDIRS.includes(entry.name)) shaped = true;
      const child = zipAndNewest(p);
      if (rel !== 'screenshots' && child.hasZip) shaped = true;
      if (child.newest.mtimeMs !== null && (newest.mtimeMs === null || child.newest.mtimeMs > newest.mtimeMs)) {
        newest = { mtimeMs: child.newest.mtimeMs, file: path.join(entry.name, child.newest.file) };
      }
    } else if (entry.isFile()) {
      const m = fs.statSync(p).mtimeMs;
      if (newest.mtimeMs === null || m > newest.mtimeMs) newest = { mtimeMs: m, file: entry.name };
    }
  }
  const basis = newest.mtimeMs !== null
    ? { basisMs: newest.mtimeMs, file: newest.file }
    : { basisMs: fs.statSync(base).mtimeMs, file: null };
  return { shaped, basis };
}

// 'untracked' (proven empty), 'tracked', or 'unproven'. `run` is the `git`
// wrapper from residue.js — bare git args in, trimmed stdout or null out. The
// explicit `{ cwd: root }` anchors the query at the tree this probe actually
// scanned (the main checkout), not at whatever worktree the CLI was invoked in.
function trackedState({ run, rel, root }) {
  if (typeof run !== 'function') return 'unproven';
  const out = run(['ls-files', '--', rel], { cwd: root }); // git-path-read: not a path list (emptiness only)
  if (out === null || out === undefined) return 'unproven';
  return String(out).trim() === '' ? 'untracked' : 'tracked';
}

function probeArtifacts({ cwd, now = Date.now(), run } = {}) {
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start) || start;
  const findings = [];
  const failed = [];

  for (const rel of ARTIFACT_ROOTS) {
    const base = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // per-root clean — never a probe failure
      failed.push(`${rel} (${errLabel(err)})`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      let basis;
      try {
        basis = ageBasisMs(dir);
      } catch (err) {
        failed.push(`${path.join(rel, entry.name)} (${errLabel(err)})`);
        continue;
      }
      const ageMs = now - basis.basisMs;
      if (ageMs <= THIRTY_DAYS_MS) continue;
      findings.push(makeFinding({
        kind: 'artifact',
        scope: 'observed',
        subject: path.join(rel, entry.name),
        remedy: 'auto',
        evidence: `newest content ${Math.floor(ageMs / DAY_MS)}d old (newest: ${basis.file ?? 'no files — dir mtime'}) — aged past the 30-day retention window`,
      }));
    }
  }

  for (const rel of LEGACY_ROOTS) {
    const base = path.join(root, rel);
    let stat;
    try {
      stat = fs.statSync(base);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      failed.push(`${rel} (${errLabel(err)})`);
      continue;
    }
    if (!stat.isDirectory()) continue;

    let shaped;
    let basis;
    try {
      ({ shaped, basis } = legacyShapeAndAge(rel, base));
    } catch (err) {
      failed.push(`${rel} (${errLabel(err)})`);
      continue;
    }
    if (!shaped) continue; // not the plugin's layout — someone else's directory

    const tracked = trackedState({ run, rel, root });
    if (tracked === 'tracked') continue; // real, version-controlled project content

    const aged = now - basis.basisMs > THIRTY_DAYS_MS;
    const proven = tracked === 'untracked';
    const evidence = aged
      ? 'pre-relocation artifact root, aged past the 30-day window — superseded by .claude-tweaks/artifacts/; surface for human disposition, never auto-deleted (namespace is not plugin-owned)'
      : 'pre-relocation artifact root with content fresher than 30 days — superseded by .claude-tweaks/artifacts/; surface for human disposition, do not auto-delete';
    findings.push(makeFinding({
      kind: 'artifact',
      scope: 'observed',
      subject: rel,
      remedy: 'record',
      evidence: proven ? evidence : `${evidence}${UNPROVEN_NOTE}`,
    }));
  }

  if (failed.length) return { ran: false, reason: `could not read ${failed.join(', ')}`, findings: [] };
  return { ran: true, reason: null, findings };
}

module.exports = { probeArtifacts, THIRTY_DAYS_MS };
