// Composition + spec-shaped-body validation for bin/compose-record.js. Reuses the existing
// recordPayload composer (bin/lib/issues/record.js) for body assembly (fingerprint marker,
// Defer-reason prefix, label derivation) and adds _shared/work-record.md's spec-shaped-body
// structural check — decided by the Materialization gate's own shapeGate (one checker, #2827);
// this file only formats the gap strings.
'use strict';

const { recordPayload } = require('../issues/record');
const { headingLine, fencedLineMask } = require('../issues/record-payload');
const {
  REQUIRED_SECTIONS: GATE_SECTIONS, PLACEHOLDER_PATTERNS, authoredRegion, sectionText, shapeGate, stripCodeSpans,
  liftMetadata, describeDesignIntentError,
} = require('../issues/materialize-format');

// Derived from the gate's own lists — never a locally declared copy (#2827). Exported under
// the historical names REQUIRED_SECTIONS / PLACEHOLDER_MARKERS.
const SECTION_NAMES = GATE_SECTIONS.map((h) => h.slice(3));
const MARKER_NAMES = PLACEHOLDER_PATTERNS.map((p) => p.marker);

// body -> { [headingText]: contentString } — content is every line between one line-anchored
// "## {Heading}" line and the next (or end of string), trimmed. A "## " appearing mid-line
// (not at the start of a line) is never treated as a heading, and neither is a heading line
// inside a fenced block (quoted content). One rule with sectionText/findSection: headingLine
// decides what a heading line is, fencedLineMask which lines are fenced (#4561).
function splitSections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const fenced = fencedLineMask(lines);
  const raw = {};
  let current = null;
  lines.forEach((line, idx) => {
    const h = fenced[idx] ? null : headingLine(line);
    if (h !== null && h.level === 2) {
      current = h.text;
      if (!(current in raw)) raw[current] = [];
      return;
    }
    if (current !== null) raw[current].push(line);
  });
  const out = {};
  for (const [heading, contentLines] of Object.entries(raw)) out[heading] = contentLines.join('\n').trim();
  return out;
}

// body -> { ok, gaps: string[] } — ok is shapeGate's verdict plus the Design-intent: line check
// (#3018: materialization rejects an invalid line, so a record must not be written ready with
// one); gaps names every failing check at once (never just the first), in REQUIRED_SECTIONS
// order, then marker order, then the Design-intent line.
function validateShaped(body) {
  const text = String(body || '');
  const gate = shapeGate(text);
  const intentError = liftMetadata(text).designIntentError;
  if (gate.ok && !intentError) return { ok: true, gaps: [] };
  const gaps = [];
  for (const name of SECTION_NAMES) {
    if (!gate.missing.includes(name)) continue;
    gaps.push(sectionText(text, name) === null ? `missing section: ## ${name}` : `empty section: ## ${name}`);
  }
  if (gate.missing.includes('unresolved-placeholder')) {
    const authored = stripCodeSpans(authoredRegion(text));
    for (const { marker, re } of PLACEHOLDER_PATTERNS) {
      if (re.test(authored)) gaps.push(`unresolved placeholder marker: ${marker}`);
    }
  }
  if (intentError) gaps.push(`invalid Design-intent: line ("${intentError.raw}") — ${describeDesignIntentError(intentError)}`);
  return { ok: false, gaps };
}

// payload -> { title, body, labels, type } — thin wrapper; recordPayload's own validation
// errors (bad title/type/tier/deferReason, conflicting ready+parked) propagate unchanged.
function composeBody(payload) {
  return recordPayload(payload || {});
}

module.exports = {
  composeBody, validateShaped, splitSections, REQUIRED_SECTIONS: SECTION_NAMES, PLACEHOLDER_MARKERS: MARKER_NAMES,
};
