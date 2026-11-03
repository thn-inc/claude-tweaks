// bin/lib/console/reference-repair.js — the staged reference-repair hold rule (#4585, #4636),
// a leaf like sdd-ruling.js: it requires only the two path predicates the initiative budget and
// the merge check share, never resolve.js. resolve.js re-exports REFERENCE_REPAIR_REASONS.
'use strict';

const path = require('path');
const { isTestPath } = require('../issues/initiative-budget');
const { isSensitivePath } = require('../issues/blast-radius');

// `STALE` is written only by `console-resolve.js --set-item` after an approved repair's diff
// stopped applying (the post-execution rewrite); the resolver never returns it.
const REFERENCE_REPAIR_REASONS = Object.freeze({
  HELD: 'reference-repair-held',
  UNCLASSIFIED: 'reference-repair-unclassified',
  UNREADABLE: 'reference-repair-unreadable',
  STALE: 'reference-repair-stale',
});

const DIFF_GIT = 'diff --git ';
// Header lines `git apply` accepts that name no path. `old mode `/`new mode ` are deliberately
// absent: a reference repair edits text and never changes a file's mode, and `git apply` applies a
// mode line (a 100755 file written back as 100644 loses its executable bit), so one holds.
const NEUTRAL_HEADERS = ['index ', 'similarity index ', 'dissimilarity index '];
const HUNK_HEADER_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

// A side git would quote or cut (a `"`, a backslash, a tab or any other control character) names a
// file differently to `git apply` than it reads here: a C-quoted `"tests/x.test.js"` or a name cut at
// a tab lands on a test file the floor never saw. Git's own diff output quotes such paths, which
// already hold, so no real repair is lost.
const UNREADABLE_SIDE_CHAR_RE = /["\\\u0000-\u001f\u007f]/;

// A side with an empty, `.` or `..` segment can name a file outside the one it appears to.
function validSide(side) {
  if (side === '' || UNREADABLE_SIDE_CHAR_RE.test(side)) return false;
  return side.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// The two sides of a `diff --git` line's remainder `s`, or null. The same-path form is recovered
// from the length because a path may contain spaces. Copied from plugin/bin/lib/review-context/
// build.js's private `diffHeaderPath`, whose module this leaf must not load. A rename or copy
// is the one other readable shape: exactly one ` b/` splits the remainder.
function diffGitSides(s) {
  if (!s.startsWith('a/')) return null;
  let sides = null;
  if (s.length >= 7 && (s.length - 5) % 2 === 0) {
    const p = s.slice(2, 2 + (s.length - 5) / 2);
    if (s === `a/${p} b/${p}`) sides = [p, p];
  }
  if (sides === null) {
    const at = s.indexOf(' b/');
    if (at === -1 || s.indexOf(' b/', at + 1) !== -1) return null;
    sides = [s.slice(2, at), s.slice(at + 3)];
  }
  return sides.every(validSide) ? sides : null;
}

// The paths a staged repair's diff changes, in order of first appearance, or null when anything is
// unreadable or no section is seen. The staged file is checked, not the agent's own account of it,
// because `git apply` is what lands (#4636). Strict by design: every section opens with a
// `diff --git` line, and every path line in it (`---`, `+++`, `rename`, `copy`) must agree with
// that line, else null. That refuses the three proved bypasses, each of which `git apply` accepts
// under a `docs/a.md` header while changing a test file: `---`/`+++` lines naming another path; a
// second section with no `diff --git` line; and `rename from` another path. A traditional patch
// (`---`, `+++` or `@@` before the first section) is refused too. `git apply --numstat` is not a
// sufficient path source, since it lists only the new path of a rename. A mode line is refused too
// (see NEUTRAL_HEADERS). Hunks are consumed by their
// `@@` counts so content that resembles a path line stays content. One forward walk, linear: only
// indexOf/startsWith and the anchored hunk-header regex touch a line.
function stagedDiffPaths(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const paths = [];
  const seen = new Set();
  const add = (p) => { if (!seen.has(p)) { seen.add(p); paths.push(p); } };
  let state = 'pre';
  let sides = null;
  let sawMinus = false;
  let sawPlus = false;
  let sawHunk = false;
  let afterHunk = false;
  let i = 0;
  const openSection = (line) => {
    sides = diffGitSides(line.slice(DIFF_GIT.length));
    if (sides === null) return false;
    add(sides[0]);
    add(sides[1]);
    sawMinus = false; sawPlus = false; sawHunk = false; afterHunk = false;
    state = 'header';
    return true;
  };
  // Consumes the hunk whose `@@` line is lines[i], leaving i past its last line.
  const consumeHunk = () => {
    const m = HUNK_HEADER_RE.exec(lines[i]);
    if (m === null) return false;
    let oldLeft = m[1] === undefined ? 1 : Number(m[1]);
    let newLeft = m[2] === undefined ? 1 : Number(m[2]);
    i += 1;
    while (oldLeft > 0 || newLeft > 0) {
      if (i >= lines.length) return false;
      const line = lines[i];
      const lead = line === '' ? ' ' : line[0];
      if (lead === ' ') { if (oldLeft <= 0 || newLeft <= 0) return false; oldLeft -= 1; newLeft -= 1; }
      else if (lead === '-') { if (oldLeft <= 0) return false; oldLeft -= 1; }
      else if (lead === '+') { if (newLeft <= 0) return false; newLeft -= 1; }
      else if (lead !== '\\') return false;
      i += 1;
    }
    return true;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (state === 'pre') {
      if (line.startsWith(DIFF_GIT)) { if (!openSection(line)) return null; }
      else if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) return null;
      i += 1;
    } else if (state === 'header') {
      const fromSide = sides[0];
      const toSide = sides[1];
      if (line.startsWith(DIFF_GIT)) { if (!openSection(line)) return null; }
      else if (line === '') state = 'between';
      else if (line.startsWith('@@')) {
        if (!sawMinus || !sawPlus || !consumeHunk()) return null;
        sawHunk = true; afterHunk = true; state = 'between';
        continue;
      } else if (line.startsWith('--- ')) {
        if ((line.endsWith('\t') ? line.slice(0, -1) : line) !== `--- a/${fromSide}`) return null;
        sawMinus = true;
      } else if (line.startsWith('+++ ')) {
        if ((line.endsWith('\t') ? line.slice(0, -1) : line) !== `+++ b/${toSide}`) return null;
        sawPlus = true;
      } else if (line === `rename from ${fromSide}` || line === `copy from ${fromSide}`
        || line === `rename to ${toSide}` || line === `copy to ${toSide}`) {
        // agrees with the section's own line
      } else if (!NEUTRAL_HEADERS.some((p) => line.startsWith(p))) return null;
      i += 1;
    } else {
      // between: after a hunk, or after a blank line in a section's header
      if (line.startsWith('\\')) { if (!afterHunk) return null; afterHunk = false; }
      else if (line === '') afterHunk = false;
      else if (line.startsWith('@@')) {
        if (!sawHunk || !consumeHunk()) return null;
        afterHunk = true;
        continue;
      } else if (line.startsWith(DIFF_GIT)) { if (!openSection(line)) return null; }
      else return null;
      i += 1;
    }
  }
  return paths.length > 0 ? paths : null;
}

// `sensitivePaths` as the matcher can use it: the array when it is a list of strings, else null.
function readableGlobs(sensitivePaths) {
  return Array.isArray(sensitivePaths) && sensitivePaths.every((g) => typeof g === 'string') ? sensitivePaths : null;
}

// One entry per parsed path, in parse order, that is a test file or (given a readable list) matches
// a merge-sensitive glob; a path that is both is a test file. Behind the floor, and printed by
// `--check-repair` so a human sees which path hit and why.
function referenceRepairFloorHits(paths, sensitivePaths) {
  if (!Array.isArray(paths)) return [];
  const globs = readableGlobs(sensitivePaths);
  const lowerGlobs = globs === null ? [] : globs.map((g) => g.toLowerCase());
  const hits = [];
  for (const p of paths) {
    if (isTestPath(p)) hits.push({ path: p, why: 'test file' });
    // A second, case-folded match: a case-insensitive filesystem lands `PACKAGE-LOCK.JSON` on the
    // sensitive `package-lock.json`, and `isSensitivePath` is case-sensitive. Holds only more.
    else if (globs !== null && (isSensitivePath(p, globs) || isSensitivePath(p.toLowerCase(), lowerGlobs))) hits.push({ path: p, why: 'merge-sensitive' });
  }
  return hits;
}

// The floor check alone: reads no header. A hit holds; a diff that does not parse, or a
// merge-sensitive list that does not read, is unclassified (a bypass parses to null, which holds
// the same).
function referenceRepairFloorReason(text, sensitivePaths) {
  const paths = stagedDiffPaths(text);
  if (referenceRepairFloorHits(paths, sensitivePaths).length > 0) return REFERENCE_REPAIR_REASONS.HELD;
  if (paths === null || readableGlobs(sensitivePaths) === null) return REFERENCE_REPAIR_REASONS.UNCLASSIFIED;
  return null;
}

// engine-state.json's `references` findings, grouped by the basename of the staged file each names.
function referenceFindingsByFile(engineState) {
  const byFile = new Map();
  const results = engineState && typeof engineState === 'object' ? engineState.results : null;
  const entry = results && typeof results === 'object' ? results.references : null;
  if (!entry || entry.result !== 'findings' || !Array.isArray(entry.findings)) return byFile;
  for (const f of entry.findings) {
    if (!f || typeof f !== 'object' || typeof f.stagePath !== 'string') continue;
    const name = path.basename(f.stagePath);
    if (!byFile.has(name)) byFile.set(name, []);
    byFile.get(name).push(f);
  }
  return byFile;
}

// #4585, #4636: approving a reference repair at `unattended` applies it with no click. The floor's
// verdict is `permittedInitiative`'s `hold`, which the sweep writes into the finding's JSON
// (engine-state.json) and the staged header; a repair approves only when both say no and this
// module's own test-path and merge-sensitive check over the strictly parsed staged diff finds no
// hit, since those paths are the repair itself rather than an agent's account of it. Any
// disagreement, absence or malformed value holds, matching `sddRulingDeferralReason`. The causal
// check stays on the agent-written `hold`, whose `brokenBy` comes from the agent anyway. A
// `Held: {reason}` header line still holds, since files staged before #4636 carry it. The header
// is the lines before the first blank line. A file that could not be read proves nothing.
// `findings` are the `references` findings naming this file; `sensitivePaths` is a list of globs,
// or null when unreadable.
// Prose twin: wrap-up/reference-sweep.md Step 4.
function referenceRepairHoldReason(item, findings, sensitivePaths) {
  if (item.readError || item.text === null) return REFERENCE_REPAIR_REASONS.UNREADABLE;
  const header = [];
  for (const raw of String(item.text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === '') break;
    header.push(line);
  }
  if (header.some((l) => /^held:/i.test(l))) return REFERENCE_REPAIR_REASONS.HELD;
  if (findings.some((f) => f && f.hold === true)) return REFERENCE_REPAIR_REASONS.HELD;
  // A floor hit outranks an unclassifiable header.
  const floor = referenceRepairFloorReason(item.text, sensitivePaths);
  if (floor === REFERENCE_REPAIR_REASONS.HELD) return REFERENCE_REPAIR_REASONS.HELD;
  const holds = header.map((l) => /^hold:(.*)$/i.exec(l)).filter(Boolean).map((m) => m[1].trim().toLowerCase());
  if (holds.length !== 1) return REFERENCE_REPAIR_REASONS.UNCLASSIFIED;
  if (holds[0] === 'yes') return REFERENCE_REPAIR_REASONS.HELD;
  if (holds[0] !== 'no') return REFERENCE_REPAIR_REASONS.UNCLASSIFIED;
  if (floor === REFERENCE_REPAIR_REASONS.UNCLASSIFIED) return REFERENCE_REPAIR_REASONS.UNCLASSIFIED;
  return findings.length === 1 && findings[0].action === 'staged' && findings[0].hold === false
    ? null
    : REFERENCE_REPAIR_REASONS.UNCLASSIFIED;
}

module.exports = {
  REFERENCE_REPAIR_REASONS,
  referenceRepairHoldReason,
  referenceFindingsByFile,
  stagedDiffPaths,
  referenceRepairFloorHits,
  referenceRepairFloorReason,
  readableGlobs,
};
