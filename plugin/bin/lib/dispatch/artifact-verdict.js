'use strict';
// The structural half of #296's "re-derive from raw artifacts" guarantee: a
// dispatch group's second Task() call (review,polish,wrap-up) must not trust
// the first call's (build,test) claims -- including claims persisted to files
// (decisions.md, ledger entries, staged proposals) the second call's own
// /wrap-up pass may read. This function is deliberately narrow: it reads
// ONLY the raw artifact it's told to read, and nothing else -- there is no
// code path here that could be swayed by a planted claim elsewhere, because
// there is no code path here that reads anything else.
//
// Two raw artifacts qualify: a TAP test-output file (`rawTestOutputPath`), or
// the runner-written pass stamp (`stampPath`, `{git-dir}/claude-tweaks-verify-pass.json`,
// written by bin/verify.js only on a passing run). A stamp whose suite verdict
// came from the PR's CI job (`source: "ci"`, #4347) reads exactly as a local
// one does; the caller compares the returned `sha` with HEAD.

const fs = require('fs');

const SHA_RE = /^[0-9a-f]{40}$/;

function deriveFromStamp(stampPath) {
  const text = fs.readFileSync(stampPath, 'utf8');
  let stamp;
  try { stamp = JSON.parse(text); } catch {
    throw new Error(`deriveTestVerdict: ${stampPath} is not a parseable pass stamp; refusing to infer a passing verdict`);
  }
  const shapeOk = stamp !== null && typeof stamp === 'object' && !Array.isArray(stamp)
    && typeof stamp.sha === 'string' && SHA_RE.test(stamp.sha)
    && typeof stamp.scope === 'string' && stamp.scope !== '';
  // `source` is written only as "ci", always beside a `ci` record (stamp.js).
  const sourceOk = stamp && (stamp.source === undefined
    || (stamp.source === 'ci' && stamp.ci !== null && typeof stamp.ci === 'object' && !Array.isArray(stamp.ci)));
  if (!shapeOk || !sourceOk) {
    throw new Error(`deriveTestVerdict: ${stampPath} is not a runner-written pass stamp (sha, scope, source); refusing to infer a passing verdict`);
  }
  return {
    passed: true, failCount: 0, source: 'pass-stamp', stampSource: stamp.source === 'ci' ? 'ci' : 'local', sha: stamp.sha, scope: stamp.scope,
  };
}

function deriveTestVerdict({ rawTestOutputPath, stampPath } = {}) {
  if ((rawTestOutputPath === undefined) === (stampPath === undefined)) {
    throw new Error('deriveTestVerdict: name exactly one of rawTestOutputPath or stampPath');
  }
  if (stampPath !== undefined) return deriveFromStamp(stampPath);
  const content = fs.readFileSync(rawTestOutputPath, 'utf8');
  const failMatch = content.match(/^# fail (\d+)$/m);
  // No `# fail N` summary line at all -- empty, truncated, or not TAP output.
  // Defaulting that to failCount 0 would hand a PASSING verdict to whoever
  // supplies the least evidence, which for a module whose whole job is
  // resisting being fooled is the easiest way to fool it. Throw instead, same
  // posture as the missing-file case readFileSync already throws on: an
  // unreadable artifact and an unparseable one are the same failure to the
  // caller, and neither is a pass.
  if (!failMatch) {
    throw new Error(
      `deriveTestVerdict: no "# fail N" summary line in ${rawTestOutputPath} — `
      + 'the artifact is empty, truncated, or not TAP output; refusing to infer a passing verdict',
    );
  }
  const failCount = Number(failMatch[1]);
  return { passed: failCount === 0, failCount, source: 'raw-artifact' };
}

module.exports = { deriveTestVerdict };
