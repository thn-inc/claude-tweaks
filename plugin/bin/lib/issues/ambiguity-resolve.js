// bin/lib/issues/ambiguity-resolve.js — pure record-body transform for resolving
// one staged red-team finding (#2699). No network I/O — the CLI wrapper
// (bin/resolve-ambiguity.js) and its caller own fetching/writing the body via
// `gh`/MCP; this module only knows how to edit a body string in memory.
'use strict';

// Matches an inline `<!-- ambiguity: ... -->` marker as written by
// specify/red-team.md's write-back procedure. Non-greedy across the comment
// body so multiple markers in one document are each matched separately.
const AMBIGUITY_MARKER_RE = /<!--\s*ambiguity:[\s\S]*?-->/g;

function countAmbiguityMarkers(body) {
  if (typeof body !== 'string') return 0;
  const matches = body.match(AMBIGUITY_MARKER_RE);
  return matches ? matches.length : 0;
}

// True when a `## Open Questions` heading (spec-template.md's optional
// section, any heading level 2-4) is still present in the body. Step 6
// Self-Review deletes the whole section once every row is resolved ("When all
// rows are resolved, delete the section" — spec-template.md), so a surviving
// heading is itself the signal of an unresolved section; this function never
// tries to distinguish a heading-with-rows from a bare leftover heading,
// matching spec-template.md's own structural check exactly.
function hasOpenQuestionsSection(body) {
  if (typeof body !== 'string') return false;
  return /^#{2,4}[ \t]+Open Questions[ \t]*$/m.test(body);
}

// The exact restore condition spec-template.md's structural check states:
// zero remaining ambiguity markers AND no surviving Open Questions section.
function readyRestorable(body) {
  return countAmbiguityMarkers(body) === 0 && !hasOpenQuestionsSection(body);
}

// Replaces the FIRST verbatim occurrence of `markerText` — either the full
// `<!-- ambiguity: ... -->` comment text or the flagged sentence next to it,
// whichever the caller matched against — with `resolutionText`. Throws when
// `markerText` isn't found verbatim: a near-miss (whitespace/quoting drift
// between what the caller read and what it's replacing) must be a hard stop,
// never a silent no-op that leaves the marker in place while reporting success.
function resolveAmbiguityMarker(body, markerText, resolutionText) {
  if (typeof body !== 'string') {
    throw new Error('resolveAmbiguityMarker: body must be a string');
  }
  if (typeof markerText !== 'string' || markerText === '') {
    throw new Error('resolveAmbiguityMarker: markerText must be a non-empty string');
  }
  if (typeof resolutionText !== 'string') {
    throw new Error('resolveAmbiguityMarker: resolutionText must be a string');
  }
  const idx = body.indexOf(markerText);
  if (idx === -1) {
    throw new Error(`resolveAmbiguityMarker: markerText not found verbatim in body: ${JSON.stringify(markerText)}`);
  }
  const newBody = body.slice(0, idx) + resolutionText + body.slice(idx + markerText.length);
  return {
    body: newBody,
    markersRemaining: countAmbiguityMarkers(newBody),
    openQuestionsRemaining: hasOpenQuestionsSection(newBody),
    readyRestorable: readyRestorable(newBody),
  };
}

module.exports = {
  AMBIGUITY_MARKER_RE,
  countAmbiguityMarkers,
  hasOpenQuestionsSection,
  readyRestorable,
  resolveAmbiguityMarker,
};
