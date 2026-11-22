'use strict';

// Pure: the floor-check predicate for the in-run initiative budget. Decides whether one
// proposed initiative fix may be APPLIED during a run instead of staged for the Wrap-Up
// Review Console. See skills/_shared/initiative-budget.md for the contract and
// docs/superpowers/specs/2026-08-07-earned-autonomy-tier-design.md (Phase 4) for the design.
//
// The scope is deliberately narrower than "trivia the agent noticed". It covers exactly one
// thing: a reference that THIS RUN'S OWN CHANGE broke. That is what makes the carve-out
// coherent against _shared/auto-mode-contract.md's "code modifications outside the skill's
// documented scope" row -- the row exists to stop a skill expanding scope to make its own work
// succeed, and repairing a pointer the skill itself invalidated is finishing the work, not
// expanding it. A gap the agent merely NOTICED is still filed, never fixed.

const { CEILINGS } = require('./autonomy');
const { isSensitivePath } = require('./blast-radius');

const CEILINGS_ALLOWING_INITIATIVE = new Set(['trusted', 'unattended']);

// Allowlist, not a denylist. A kind this module has not been taught denies -- the same
// inversion [IL-101] forced on autonomy.js's provenance check, for the same reason: a
// denylist grants to every case it was never told about.
const REPAIRABLE_KINDS = new Set(['pointer-repair']);

const DEFAULT_BUDGET = Object.freeze({
  maxFixes: 3,
  maxFilesPerFix: 2,
  maxLinesPerFix: 20,
});

// A pointer repair inside a test can make a failing test pass by retargeting its assertion,
// which is the one shape that turns "repair" into "silence the check". Tests are excluded
// outright rather than judged.
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

function isTestPath(p) {
  return typeof p === 'string' && TEST_PATH_RE.test(p);
}

/**
 * @param {object} input
 * @param {string} input.ceiling            resolved autonomy ceiling (autonomy.js resolveCeiling)
 * @param {object} input.fix                { kind, files: string[], changedLines: number, brokenBy: string }
 * @param {string[]} input.changedFiles     paths this run changed (the causal set)
 * @param {number} input.spent              initiative fixes already applied this run
 * @param {string[]} input.sensitivePaths   merge-sensitive globs; any match denies. Required: anything
 *                                          but an array of strings (undefined, a comma-separated string) holds
 * @param {object} [input.budget]           overrides for DEFAULT_BUDGET
 * @returns {{allowed: boolean, reason: string, hold: boolean}}
 */
function permittedInitiative(input) {
  const { ceiling, fix: rawFix, changedFiles, spent, sensitivePaths, budget } = input || {};
  const limits = { ...DEFAULT_BUDGET, ...(budget && typeof budget === 'object' ? budget : {}) };

  // Every check below is evaluated for every input (so `hold` is independent of which check
  // fails first), which is why each value is normalized up front instead of guarded in place.
  const fix = rawFix && typeof rawFix === 'object' ? rawFix : null;
  const files = fix && Array.isArray(fix.files) ? fix.files : [];
  const fileStrings = files.filter((f) => typeof f === 'string');
  const lines = fix ? fix.changedLines : undefined;
  const linesKnown = Number.isInteger(lines) && lines >= 0;
  const brokenBy = fix ? fix.brokenBy : undefined;
  const brokenByNamed = typeof brokenBy === 'string' && brokenBy.trim() !== '';
  const changed = Array.isArray(changedFiles) ? changedFiles.filter((f) => typeof f === 'string') : [];
  // An unreadable list holds, never reads as "no sensitive paths" (#4636): a comma-separated policy
  // string passed through unparsed, or an omitted argument, must not switch the floor off.
  const sensitiveReadable = Array.isArray(sensitivePaths) && sensitivePaths.every((g) => typeof g === 'string');
  const globs = sensitiveReadable ? sensitivePaths : [];
  // Budget exhaustion is checked before the per-fix caps so the reason a run stops is the
  // budget itself, not whichever cap the next candidate happened to trip.
  const used = Number.isInteger(spent) && spent >= 0 ? spent : 0;
  // A second, case-folded match: a case-insensitive filesystem lands `Docs/A.md` on a sensitive
  // `docs/a.md`, and `isSensitivePath` is case-sensitive. Holds only more.
  const lowerGlobs = globs.map((g) => g.toLowerCase());
  const sensitiveHit = fileStrings.find((f) => isSensitivePath(f, globs) || isSensitivePath(f.toLowerCase(), lowerGlobs));

  // `hold` is what wrap-up/reference-sweep.md Step 4 writes into the finding's `hold` field and
  // the staged file's `Hold:` header. `floor: true` marks a condition no human click at an
  // unattended console may skip; `floor: false` is a clean fix denied only by the ceiling, the
  // budget or a size cap, which a person may still approve. The list order is the order the
  // reported `reason` follows: the first failing check.
  const checks = [
    {
      // The one check whose floor flag depends on the value: `supervised` is a clean denial,
      // an unknown ceiling is not.
      floor: !CEILINGS.includes(ceiling),
      fails: typeof ceiling !== 'string' || !CEILINGS_ALLOWING_INITIATIVE.has(ceiling),
      reason: `autonomy ceiling is ${JSON.stringify(ceiling)} — the initiative budget requires trusted or unattended`,
    },
    { floor: true, fails: !fix, reason: 'no fix supplied' },
    {
      floor: true,
      fails: !fix || typeof fix.kind !== 'string' || !REPAIRABLE_KINDS.has(fix.kind),
      reason: `fix kind ${JSON.stringify(fix && fix.kind)} is not one this budget repairs — only pointer-repair`,
    },
    {
      floor: false,
      fails: used >= limits.maxFixes,
      reason: `initiative budget exhausted (${used}/${limits.maxFixes} applied this run)`,
    },
    { floor: true, fails: files.length === 0, reason: 'fix names no files' },
    {
      floor: true,
      fails: files.some((f) => typeof f !== 'string' || f.trim() === ''),
      reason: 'fix names a malformed file path',
    },
    {
      floor: false,
      fails: files.length > limits.maxFilesPerFix,
      reason: `fix touches ${files.length} files, over the cap of ${limits.maxFilesPerFix}`,
    },
    { floor: true, fails: !linesKnown, reason: 'fix does not report a changed-line count' },
    {
      floor: false,
      fails: linesKnown && lines > limits.maxLinesPerFix,
      reason: `fix changes ${lines} lines, over the cap of ${limits.maxLinesPerFix}`,
    },
    {
      floor: true,
      fails: files.some(isTestPath),
      reason: 'fix touches a test file — retargeting a test assertion is not pointer repair',
    },
    // The causal gate, and the load-bearing half of this check. Without it the budget becomes a
    // licence to edit anything small, which is precisely what the contract row forbids.
    {
      floor: true,
      fails: !brokenByNamed,
      reason: 'fix does not name the change that broke the reference (brokenBy)',
    },
    {
      floor: true,
      fails: brokenByNamed && !changed.includes(brokenBy),
      reason: `brokenBy ${JSON.stringify(brokenBy)} is not among this run's changed files — the reference was not broken by this run`,
    },
    {
      floor: true,
      fails: !sensitiveReadable || sensitiveHit !== undefined,
      reason: sensitiveReadable
        ? `fix touches merge-sensitive path ${JSON.stringify(sensitiveHit)}`
        : 'merge-sensitive-paths unreadable (not a list of glob strings)',
    },
  ];

  const failed = checks.filter((c) => c.fails);
  if (failed.length === 0) {
    return {
      allowed: true,
      reason: `pointer repair in ${files.length} file(s), ${lines} lines, broken by ${brokenBy} (${used + 1}/${limits.maxFixes})`,
      hold: false,
    };
  }
  return { allowed: false, reason: failed[0].reason, hold: failed.some((c) => c.floor) };
}

module.exports = {
  CEILINGS_ALLOWING_INITIATIVE,
  REPAIRABLE_KINDS,
  DEFAULT_BUDGET,
  permittedInitiative,
  isTestPath,
};
