'use strict';
// #1545: for an `auto`-mode run, derive the wrap-up ceremony-profile DEFAULT
// from the diff actually produced, rather than leaving the header-fold
// default (`flow/manifesto.md`'s Ceremony profile computation, always
// `standard` unless every materialized record already carried a
// `ceremony: fast-lane` header) as the only signal. Evidence: Dispatch hub
// run #9, 2026-08-26 — a +75/-2 test-only diff still ran the full `standard`
// wrap-up ceremony, ~8 of the firing's 43 minutes on ceremony nothing acted
// on.
//
// Pure — no git/fs I/O of its own. `wrap-up/SKILL.md`'s "Diff-derived
// ceremony default" step supplies `files` (parsed `git diff --numstat`
// output, `blast-radius-cli.js`'s `parseNumstat` shape: `{path, additions,
// deletions}[]`) and the run's current `ceremony-profile` value.
const { classifyDiffFiles, blastRadiusSummary } = require('../issues/blast-radius');

// Docs-only surface: every changed file is markdown. Deliberately broader
// than `docs/**` alone — a materialized `work/{n}-spec.md` file (itself
// markdown) is exactly the kind of accompanying file the #1545 evidence diff
// carried alongside its one test file, and both must count as low-surface.
function isDocsPath(path) {
  return /\.md$/i.test(path);
}

// files: [{path, additions, deletions}] (blast-radius-cli.js's parseNumstat
// shape). Returns the fact set both this module's own derivation and any
// future caller needing the same classification can read directly, rather
// than re-deriving it.
function computeDiffFacts(files) {
  const classified = classifyDiffFiles(files || []);
  const summary = blastRadiusSummary(classified);
  const docsFiles = classified.filter((f) => !f.isTest && isDocsPath(f.path));
  const implFiles = classified.filter((f) => !f.isTest && !isDocsPath(f.path));
  const fileCount = classified.length;
  return {
    fileCount,
    testFiles: summary.testFiles,
    docsFiles: docsFiles.length,
    implFiles: implFiles.length,
    totalLines: summary.testLines + summary.implLines,
    // Pure single-category flags, informational (the log line names which
    // one fired) — neither is the actual gate below, since the #1545
    // evidence diff itself was a MIX (one test file plus its own
    // materialized work/{n}-spec.md doc) that is strictly neither.
    testOnly: fileCount > 0 && implFiles.length === 0 && docsFiles.length === 0,
    docsOnly: fileCount > 0 && implFiles.length === 0 && summary.testFiles === 0,
    // The actual gate: zero production/implementation files touched, in any
    // mix of test and/or docs files. This is what the Gotcha's own
    // discrimination test targets — a test file PLUS a small amount of
    // production code (implFiles.length >= 1) must stay disqualified, but a
    // test file plus an accompanying docs/spec file (implFiles.length === 0)
    // must not be — the exact #1545 evidence shape.
    lowSurface: fileCount > 0 && implFiles.length === 0,
  };
}

// The gotcha this issue names explicitly: never DOWNGRADE a profile already
// set to `standard` by an upstream decision (project policy, a prior review
// finding) — this only ever supplies the default when nothing has decided
// yet. In practice that means: never touch an already-`fast-lane` current
// value (nothing to narrow further), and only ever move `standard` ->
// `fast-lane`, never the reverse — the escape hatch
// (`wrap-up/SKILL.md`'s Ceremony escape hatch) is the only path back up.
function deriveCeremonyProfile(files, current) {
  if (current === 'fast-lane') return 'fast-lane';
  const facts = computeDiffFacts(files);
  return facts.lowSurface ? 'fast-lane' : current;
}

// #1932: the gate is the run's MODE, not the presence of a human. In `auto`
// mode the Manifesto renders as a read-only FYI (`flow/manifesto.md`'s
// auto-mode variant never calls AskUserQuestion), so nobody could have
// adjusted `ceremony-profile` and the derivation applies whether or not a
// person is watching. `confirm`/`hybrid`/`interactive` presented the lever
// as a real question, so its value may be a human's answer — never touched.
// A standalone wrap-up has no config.yml and therefore no mode: never derives.
function shouldDerive({ mode, ceremonyProfile } = {}) {
  return mode === 'auto' && ceremonyProfile === 'standard';
}

module.exports = { computeDiffFacts, deriveCeremonyProfile, isDocsPath, shouldDerive };
