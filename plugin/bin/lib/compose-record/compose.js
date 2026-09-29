// Composition + spec-shaped-body validation for bin/compose-record.js. Reuses the existing
// recordPayload composer (bin/lib/issues/record.js) for body assembly (fingerprint marker,
// Defer-reason prefix, label derivation) and adds _shared/work-record.md's spec-shaped-body
// structural check — decided by the Materialization gate's own shapeGate (one checker, #2827);
// this file only formats the gap strings.
'use strict';

const { recordPayload } = require('../issues/record');
const {
  REQUIRED_SECTIONS: GATE_SECTIONS, PLACEHOLDER_PATTERNS, sectionText, shapeGate, stripCodeSpans,
} = require('../issues/materialize-format');

// Derived from the gate's own lists — never a locally declared copy (#2827). Exported under
// the historical names REQUIRED_SECTIONS / PLACEHOLDER_MARKERS.
const SECTION_NAMES = GATE_SECTIONS.map((h) => h.replace(/^## /, ''));
const MARKER_NAMES = PLACEHOLDER_PATTERNS.map((p) => p.marker);

// Same exemption boundary shapeGate applies (#1240): markers inside the verbatim
// ## Original request copy are the original capture's own text.
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

// body -> { ok, gaps: string[] } — ok is shapeGate's verdict; gaps names every failing check at
// once (never just the first), in REQUIRED_SECTIONS order then marker order.
function validateShaped(body) {
  const text = String(body || '');
  const gate = shapeGate(text);
  if (gate.ok) return { ok: true, gaps: [] };
  const gaps = [];
  for (const name of SECTION_NAMES) {
    if (!gate.missing.includes(name)) continue;
    gaps.push(sectionText(text, name) === null ? `missing section: ## ${name}` : `empty section: ## ${name}`);
  }
  if (gate.missing.includes('unresolved-placeholder')) {
    const at = text.search(ORIGINAL_REQUEST_RE);
    const authored = stripCodeSpans(at === -1 ? text : text.slice(0, at));
    for (const { marker, re } of PLACEHOLDER_PATTERNS) {
      if (re.test(authored)) gaps.push(`unresolved placeholder marker: ${marker}`);
    }
  }
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
