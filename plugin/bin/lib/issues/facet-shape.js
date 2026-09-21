// bin/lib/issues/facet-shape.js
// Single source of truth for the facet-default shape shared by both work-record
// drivers: record.js's parseRecordFacets (GitHub, derived from labels) and
// local-store.js's defaultFacets (local-files, derived from frontmatter). Each
// driver adds its own extra keys on top of sharedFacetDefaults() — parent/
// blockedBy/type/unsynced/closed/closedAt are local-files-only and have no
// analog in the label-derived shape, so they stay declared in local-store.js.
// The same holds in the other direction: shapedHeadless is GitHub-only (the
// headless `next` shaping unit is github-issues-only), so it stays declared in
// record.js and the local-files shape carries no meaningless default for it.
// Add a new shared facet key here, not independently in either driver.
//
// isParentIssue is shared: the GitHub driver derives it from the parent-issue
// label, the local driver from the is-parent-issue: frontmatter line — each
// with a permanent pre-rename legacy fallback (the [IL-85] branches in
// record.js and local-store.js).
//
// breaking (the Compatibility axis, #2251) is shared too: presence-only, like
// solutionUnjustified — true when the record's contract-change label/line is
// present, false otherwise, never undefined.
'use strict';

// Returns a fresh object every call — grants/bot are nested objects, and two
// independent callers must never end up sharing (and mutating) the same one.
function sharedFacetDefaults() {
  return {
    origin: null,
    risk: null,
    size: null,
    ceremony: null,
    solutionUnjustified: false,
    breaking: false,
    needsDefinition: false,
    priority: null,
    stage: 'backlog',
    grants: { build: false, merge: false },
    bot: { inProgress: false, blocked: false, parked: false },
    acceptance: null,
    isParentIssue: false,
    notPlanned: false,
  };
}

module.exports = { sharedFacetDefaults };
