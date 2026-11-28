'use strict';
const { STALE_DAYS_DEEP } = require('./score');

const REGRESSION_CATEGORIES = new Set(['code-bug', 'ux-issue']);
const SEVERITY_MAP = { Low: 'low', Medium: 'med', High: 'high' };

// Decide whether a QA report.json's evidence for `storyIds` (all the stories
// belonging to one journey) satisfies the deep tier, surfaces a
// regression-suspected finding, or is inconclusive (caller falls through to
// live verification). Pure — no I/O; the caller (SKILL.md's Step 3.5) does
// the Glob/Read of the report file and the journey<->story cross-reference.
//
// Returns one of:
//   { verdict: 'satisfied' }
//   { verdict: 'regression', finding: {category, section, description, reason, confidence, severity, recommendation} }
//   { verdict: 'inconclusive', reason: string }
function evaluateQaEvidence(storyIds, report, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();

  if (!storyIds || storyIds.length === 0) {
    return { verdict: 'inconclusive', reason: 'journey has no associated stories' };
  }
  if (!report || !report.timestamp) {
    return { verdict: 'inconclusive', reason: 'no QA report available' };
  }
  const ageDays = (now - new Date(report.timestamp).getTime()) / 86400000;
  if (!(ageDays <= STALE_DAYS_DEEP)) {
    return { verdict: 'inconclusive', reason: `QA report is ${Math.round(ageDays)} days old, past the ${STALE_DAYS_DEEP}-day window` };
  }

  const storiesById = new Map((report.stories || []).map((s) => [s.id, s]));
  for (const id of storyIds) {
    const story = storiesById.get(id);
    if (!story || story.status === 'SKIPPED') {
      return { verdict: 'inconclusive', reason: `story "${id}" is absent from the report or was skipped` };
    }
  }

  const failed = storyIds.map((id) => storiesById.get(id)).filter((s) => s.status === 'FAIL');
  // 'ux-issue' findings only ever attach to a PASS_WITH_CAVEATS story (per
  // qa-reporting.md's "Caveat-to-finding conversion" rule) — never to a FAIL.
  // Checking `failed` alone made that REGRESSION_CATEGORIES entry permanently
  // unreachable, so caveated stories are checked too. A PASS_WITH_CAVEATS
  // story doesn't affect the satisfied/inconclusive fallback below, though —
  // only a caveat that actually lands on a regression category short-circuits
  // to 'regression'; a caveated story with no matching finding is still a
  // pass, not evidence of a problem.
  const caveated = storyIds.map((id) => storiesById.get(id)).filter((s) => s.status === 'PASS_WITH_CAVEATS');

  // A story can have multiple findings entries (e.g. an early non-regression
  // stale-selector auto-recovery plus a later genuine code-bug) per
  // qa-reporting.md's schema, so this groups by story_id into arrays rather
  // than keying a Map 1:1 — a 1:1 Map would let a later non-regression entry
  // silently overwrite an earlier regression entry for the same story.
  const findingsByStoryId = new Map();
  for (const f of report.findings || []) {
    if (!findingsByStoryId.has(f.story_id)) findingsByStoryId.set(f.story_id, []);
    findingsByStoryId.get(f.story_id).push(f);
  }
  for (const story of [...failed, ...caveated]) {
    const entries = findingsByStoryId.get(story.id) || [];
    const findingEntry = entries.find((f) => REGRESSION_CATEGORIES.has(f.category));
    if (findingEntry) {
      return {
        verdict: 'regression',
        finding: {
          category: 'regression-suspected',
          section: 'live-check',
          description: findingEntry.finding,
          reason: `QA run ${report.timestamp} recorded this failure for story "${story.id}": ${findingEntry.finding}`,
          confidence: 'high',
          severity: SEVERITY_MAP[findingEntry.severity] || 'med',
          recommendation: 'File as a product bug — QA evidence surfaced this, not journey-health\'s own live verification',
        },
      };
    }
  }

  if (failed.length === 0) {
    return { verdict: 'satisfied' };
  }

  return { verdict: 'inconclusive', reason: 'failing story(ies) attributed to QA tooling (stale-selector/flaky-env/story-bug), not journey drift' };
}

module.exports = { evaluateQaEvidence };
