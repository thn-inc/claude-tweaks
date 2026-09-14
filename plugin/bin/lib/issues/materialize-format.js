// bin/lib/issues/materialize-format.js
// Pure: the shape gate, the Surface/Design-intent/Ui-stack/Design-seed lift,
// and the pinned-header composition documented in skills/flow/materialize.md. No
// network — bin/materialize.js does the gh/local-store fetch and the file
// write; this module is what both that CLI and its tests import so the
// header format has exactly one implementation instead of a copy per caller.
'use strict';

const REQUIRED_SECTIONS = ['## Current State', '## Deliverables', '## Acceptance Criteria', '## Release Note'];
const PLACEHOLDER_RE = /\bTBD\b|\bTODO\b|<!--\s*ambiguity:/;

// Everything from the `## Original request` heading to end of body is a
// verbatim copy of the record's original title/body (shaping-mode.md's
// preservation rule — always the terminal section, and it may contain the
// original body's own nested `## ` headings). Markers inside it are the
// original capture's own text, never unresolved authored placeholders, so
// the placeholder gate tests only the text before it (refs #1240).
const ORIGINAL_REQUEST_RE = /^## Original request[ \t]*$/m;

// #1839: a fenced block or inline code span quotes content rather than
// authoring it — a Deliverables fence quoting the exact CLAUDE.md line
// being replaced (harness-health drift records do this by construction) is
// not an unresolved placeholder just because the quoted text contains the
// marker word. Removes, in order: fenced blocks (``` or ~~~, any info
// string, an unclosed fence run to end of text — the safer direction, since
// a truncated fence is quoted content, not authored prose) and, from what's
// left, inline code spans (backtick runs of any length, matched by exact
// opening/closing length per CommonMark, so a single backtick inside a
// double-backtick span is never mis-cut).
function stripCodeSpans(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      // j is the closing fence line, or lines.length when unclosed (runs to
      // end of text). Either way, everything from the opening fence through
      // the close (or end) is quoted, not authored — drop it, keeping one
      // blank line so a section whose only content is a fenced block is
      // still detected as non-empty by sectionText (which reads the
      // unstripped body anyway, but this keeps stripCodeSpans' own output
      // shape sane for any other caller).
      out.push('');
      i = j < lines.length ? j + 1 : lines.length;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  // Inline code spans: an opening backtick run, non-greedy content, a
  // closing run of the exact same length (the backreference enforces this).
  return out.join('\n').replace(/(`+)([\s\S]*?)\1/g, '');
}

// body -> the text of section `## {name}` up to the next `## ` heading (or
// end of body). null when the heading itself is absent.
function sectionText(body, name) {
  const heading = `## ${name}`;
  const start = body.indexOf(heading);
  if (start === -1) return null;
  const afterHeading = start + heading.length;
  const nextHeadingRel = body.slice(afterHeading).search(/\n## /);
  const end = nextHeadingRel === -1 ? body.length : afterHeading + nextHeadingRel;
  return body.slice(afterHeading, end).trim();
}

// body -> { ok: true } | { ok: false, missing: string[] }. `missing` names
// every failing section by its plain name ("Current State", not "## Current
// State") plus, when present, the string 'unresolved-placeholder' — the same
// gate materialize.md's "Materialization hard gate" describes: every
// section present and non-empty, no TBD/TODO/<!-- ambiguity: marker anywhere
// outside the verbatim-preserved `## Original request` section.
function shapeGate(body) {
  const text = typeof body === 'string' ? body : '';
  const missing = [];
  for (const heading of REQUIRED_SECTIONS) {
    const name = heading.replace('## ', '');
    const section = sectionText(text, name);
    if (section === null || section.length === 0) missing.push(name);
  }
  const originalRequestAt = text.search(ORIGINAL_REQUEST_RE);
  const authored = originalRequestAt === -1 ? text : text.slice(0, originalRequestAt);
  if (PLACEHOLDER_RE.test(stripCodeSpans(authored))) missing.push('unresolved-placeholder');
  return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
}

// body -> { surface?, designIntent?, uiStack?, designSeed? } — read from the leading
// metadata block (every line before the first blank line). Legacy `Surface:
// frontend` reads as `web`; `Surface: mixed` is retired and passed through
// unchanged (materialize.md: a record still declaring it needs re-shaping,
// not a value this module silently rewrites).
function liftMetadata(body) {
  const text = typeof body === 'string' ? body : '';
  const blankAt = text.indexOf('\n\n');
  const block = blankAt === -1 ? text : text.slice(0, blankAt);
  const out = {};
  // [ \t]* (not \s*) before every capture group deliberately: \s matches
  // \n, so a greedy \s* on a bare "Field:" line (no value) would consume
  // the newline and let (\S+)/(.+)$ capture the FOLLOWING line's content
  // instead of correctly failing to match. Same-line-only whitespace keeps
  // a bare line a no-match, never a misread of the next field (refs #357).
  const surfaceMatch = /^Surface:[ \t]*(\S+)/m.exec(block);
  if (surfaceMatch) out.surface = surfaceMatch[1] === 'frontend' ? 'web' : surfaceMatch[1];
  const intentMatch = /^Design-intent:[ \t]*(\S+)/m.exec(block);
  if (intentMatch) out.designIntent = intentMatch[1];
  const uiStackMatch = /^Ui-stack:[ \t]*(.+)$/m.exec(block);
  if (uiStackMatch) out.uiStack = uiStackMatch[1].trim();
  const seedMatch = /^Design-seed:[ \t]*(\S+)/m.exec(block);
  if (seedMatch) out.designSeed = seedMatch[1];
  return out;
}

// Double-quote a scalar for the YAML-shaped header when it contains a
// character that would change its meaning to a real YAML parser (`:`
// starts a mapping, `#` starts a comment) or leading/trailing whitespace
// that YAML would strip. `ui-stack` is this header's one free-form field —
// every other optional field is a closed enum or opaque token with no such
// risk, so this is not called for them (refs #357).
function yamlSafeScalar(value) {
  if (/[:#]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

// fields -> the YAML frontmatter block (including the --- delimiters), per
// materialize.md's "The pinned header format". `ceremony` and `grants` are
// always emitted (never omitted, even when grants is empty); every other
// field is omitted when its value is null/undefined/empty.
function composeHeader({ record, origin, risk, size, ceremony, grants, fingerprint, blockedBy, surface, designIntent, uiStack, designSeed, parkedAtShaping }) {
  const lines = ['---', `record: ${record}`, `origin: ${origin}`];
  if (risk) lines.push(`risk: ${risk}`);
  if (size) lines.push(`size: ${size}`);
  lines.push(`ceremony: ${ceremony}`);
  const grantList = [];
  if (grants && grants.build) grantList.push('build');
  if (grants && grants.merge) grantList.push('merge');
  lines.push(`grants: [${grantList.join(', ')}]`);
  if (fingerprint) lines.push(`fingerprint: ${fingerprint}`);
  if (Array.isArray(blockedBy) && blockedBy.length) lines.push(`blocked-by: [${blockedBy.join(', ')}]`);
  if (surface) lines.push(`surface: ${surface}`);
  if (designIntent) lines.push(`design-intent: ${designIntent}`);
  if (uiStack) lines.push(`ui-stack: ${yamlSafeScalar(uiStack)}`);
  if (designSeed) lines.push(`design-seed: ${designSeed}`);
  if (parkedAtShaping) lines.push('parked-at-shaping: true');
  lines.push('---');
  return lines.join('\n');
}

// { header, n, title, body } -> the full materialized file text.
function composeFile({ header, n, title, body }) {
  return `${header}\n# ${n}: ${title}\n\n${body}\n`;
}

module.exports = {
  REQUIRED_SECTIONS, sectionText, shapeGate, liftMetadata, composeHeader, composeFile, stripCodeSpans,
};
