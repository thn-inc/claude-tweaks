'use strict';

const { sanitizeCell } = require('../wrap-up/engine-verify');

// Supporting code for the pipeline-smoke-test skill's Step 6 (record #44):
// "never trust the cleanup step's own exit code" as a mechanical guarantee
// rather than prose alone. A cleanup step can claim success (its gh/git call
// returned 0) while the artifact it targeted is still live -- a partial
// GitHub API failure, a race with a concurrent process, or a bug in the
// cleanup call itself. This module is the pass/fail computation over the
// { artifact, claimed, verifiedAbsent } rows the skill's Step 6 produces from
// its own independent re-query -- never from Step 5's own report.

/**
 * rows: [{ artifact: string, claimed: boolean, verifiedAbsent: boolean }]
 *   - claimed: true when Step 5 reported having removed/closed/released this
 *     artifact (its own claim, not evidence).
 *   - verifiedAbsent: true when Step 6's independent re-query confirms the
 *     artifact is actually gone (issue closed, claim released, worktree
 *     removed).
 *
 * Returns { clean: boolean, leaked: [{artifact, claimed, verifiedAbsent}] }.
 * `leaked` lists every row where verifiedAbsent is false, regardless of what
 * was claimed -- a row claiming cleanup but failing verification is exactly
 * the defect class this function exists to catch. A row that was never
 * claimed and never verified absent (never touched by Step 5 at all) also
 * counts as leaked: an artifact this skill created must be accounted for.
 */
function verifyCleanupTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const leaked = list.filter((row) => !row || !row.verifiedAbsent);
  return { clean: leaked.length === 0, leaked };
}

/**
 * Renders the Step 6 report table exactly as the skill documents it:
 * `| Artifact | Cleanup claimed | Verified absent |`.
 */
function renderCleanupTable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const header = '| Artifact | Cleanup claimed | Verified absent |\n|---|---|---|';
  const body = list
    .map((row) => `| ${sanitizeCell(row.artifact)} | ${row.claimed ? 'yes' : 'no'} | ${row.verifiedAbsent ? 'yes' : 'no'} |`)
    .join('\n');
  return list.length ? `${header}\n${body}` : header;
}

module.exports = { verifyCleanupTable, renderCleanupTable };
