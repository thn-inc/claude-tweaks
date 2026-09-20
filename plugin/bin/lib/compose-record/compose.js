// Composition + spec-shaped-body validation for bin/compose-record.js. Reuses the existing
// recordPayload composer (bin/lib/issues/record.js) for body assembly (fingerprint marker,
// Defer-reason prefix, label derivation) and adds the one check that composer does not make:
// _shared/work-record.md's spec-shaped-body structural check, today only ever applied by
// hand — specify/shaping-mode.md's Read-back verification and capture/SKILL.md's Shaped-body
// branch both restate this same three-section-plus-placeholder-marker check in prose.
'use strict';

const { recordPayload } = require('../issues/record');

const REQUIRED_SECTIONS = ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'];
const PLACEHOLDER_MARKERS = ['TBD', 'TODO', '<!-- ambiguity:'];

// Everything from the `## Original request` heading to end of body is a verbatim copy of the
// record's original title/body (shaping-mode.md's preservation rule). Markers inside it are the
// original capture's own text, never unresolved authored placeholders, so the placeholder gate
// tests only the text before it — mirrors materialize-format.js's ORIGINAL_REQUEST_RE (#1240).
const ORIGINAL_REQUEST_RE = /^## Original request[ \t]*$/m;

// body -> { [headingText]: contentString } — content is every line between one line-anchored
// "## {Heading}" line and the next (or end of string), trimmed. A "## " appearing mid-line
// (not at the start of a line) is never treated as a heading.
function splitSections(body) {
  const lines = String(body || '').split('\n');
  const raw = {};
  let current = null;
  for (const line of lines) {
    const m = /^## (.+)$/.exec(line);
    if (m) {
      current = m[1].trim();
      if (!(current in raw)) raw[current] = [];
      continue;
    }
    if (current !== null) raw[current].push(line);
  }
  const out = {};
  for (const [heading, contentLines] of Object.entries(raw)) out[heading] = contentLines.join('\n').trim();
  return out;
}

// body -> { ok, gaps: string[] } — gaps names every failing check at once (never just the
// first), matching materialize.md's Materialization hard gate's own all-at-once reporting
// convention. Reused verbatim from _shared/work-record.md's Spec-shaped body section.
function validateShaped(body) {
  const text = String(body || '');
  const sections = splitSections(text);
  const gaps = [];
  for (const name of REQUIRED_SECTIONS) {
    if (!(name in sections)) gaps.push(`missing section: ## ${name}`);
    else if (!sections[name]) gaps.push(`empty section: ## ${name}`);
  }
  const originalRequestAt = text.search(ORIGINAL_REQUEST_RE);
  const authored = originalRequestAt === -1 ? text : text.slice(0, originalRequestAt);
  for (const marker of PLACEHOLDER_MARKERS) {
    if (authored.includes(marker)) gaps.push(`unresolved placeholder marker: ${marker}`);
  }
  return { ok: gaps.length === 0, gaps };
}

// payload -> { title, body, labels, type } — thin wrapper; recordPayload's own validation
// errors (bad title/type/tier/deferReason, conflicting ready+parked) propagate unchanged.
function composeBody(payload) {
  return recordPayload(payload || {});
}

module.exports = { composeBody, validateShaped, splitSections, REQUIRED_SECTIONS, PLACEHOLDER_MARKERS };
