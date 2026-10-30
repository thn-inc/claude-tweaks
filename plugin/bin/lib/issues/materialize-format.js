// bin/lib/issues/materialize-format.js
// Pure: the shape gate, the Surface/Design-intent/Ui-stack/Design-seed lift,
// and the pinned-header composition documented in skills/flow/materialize.md. No
// network — bin/materialize.js does the gh/local-store fetch and the file
// write; this module is what both that CLI and its tests import so the
// header format has exactly one implementation instead of a copy per caller.
'use strict';

const { POLICY_KEYS } = require('../policy-schema');
const { fencedLineRanges, findSection } = require('./record-payload');

const REQUIRED_SECTIONS = ['## Current State', '## Deliverables', '## Acceptance Criteria', '## Release Note'];
// The Design-intent enum, read once from the policy schema (never restated here).
const DESIGN_INTENT_VALUES = Object.freeze([...POLICY_KEYS.find((k) => k.key === 'design-intent').values]);
// One entry per placeholder marker; the gate's combined regex is their union, so
// compose.js can name which marker matched without a second implementation (#2827).
const PLACEHOLDER_PATTERNS = [
  { marker: 'TBD', re: /\bTBD\b/ },
  { marker: 'TODO', re: /\bTODO\b/ },
  { marker: '<!-- ambiguity:', re: /<!--\s*ambiguity:/ },
];
const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERNS.map((p) => p.re.source).join('|'));

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
  for (const [start, end] of fencedLineRanges(lines)) {
    while (i < start) out.push(lines[i++]);
    // Everything from the opening fence through the close (or end, when
    // unclosed) is quoted, not authored — drop it, keeping one blank line so a
    // section whose only content is a fenced block is still non-empty for any
    // caller that reads this output.
    out.push('');
    i = end + 1;
  }
  while (i < lines.length) out.push(lines[i++]);
  // Inline code spans: an opening backtick run, non-greedy content, a
  // closing run of the exact same length (the backreference enforces this).
  // #1837 review finding: the unbounded `[\s\S]*?` here has no explicit
  // cap on how far it will scan for a same-length closing run on a
  // pathological backtick-dense body (bounded only by GitHub's ~65KB
  // issue-body ceiling). Direct verification found this specific pattern
  // does not actually blow up quadratically in practice — a backreference
  // search for a shorter run-length is satisfied trivially by any longer
  // run later in the text, so real backtracking depth stays small — but a
  // real inline code span is always a short single-line quote (a command,
  // a path, a literal) anyway, so capping the lazily-matched content at
  // 2000 chars costs nothing for any span an author would actually write
  // and removes the open-ended shape as a defensive measure. A span whose
  // content exceeds the cap degrades to being left as literal text instead
  // of stripped — the same safe direction stripCodeSpans already takes for
  // an unclosed fence (fencedLineRanges, record-payload.js) — never to a longer scan.
  return out.join('\n').replace(/(`+)([\s\S]{0,2000}?)\1/g, '');
}

// body -> the trimmed text of section `## {name}` up to the next `## ` heading, or
// null when the body has no such heading. The heading must be its own line, whole
// name (#4367): an inline-code or blockquote mention, or a `## Release Notes` prefix,
// does not match. Headings inside fenced blocks are quoted content (#4169). Delegates
// to findSection, the same rule extractSection uses.
function sectionText(body, name) {
  return findSection(body, name, { levelPattern: '2', stopPattern: '2', trim: true });
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

// raw string -> { ok: true, values } | { ok: false, invalid, reason }. Splits a
// comma-separated Design-intent list: each value trimmed, empties dropped,
// duplicates removed in first-seen order. Any value outside the enum makes the
// list invalid ('unknown', naming every bad value). Only with no unknown
// values, `none` combined with another intent is invalid ('none-mixed').
function normalizeDesignIntent(raw) {
  const values = [];
  for (const part of String(raw).split(',')) {
    const value = part.trim();
    if (value && !values.includes(value)) values.push(value);
  }
  const invalid = values.filter((v) => !DESIGN_INTENT_VALUES.includes(v));
  if (invalid.length) return { ok: false, invalid, reason: 'unknown' };
  if (values.includes('none') && values.length > 1) return { ok: false, invalid: ['none'], reason: 'none-mixed' };
  return { ok: true, values };
}

// designIntentError (liftMetadata's) -> the reason clause every gate that rejects the
// line names — materialization (bin/materialize.js) and write time (compose-record).
function describeDesignIntentError(err) {
  return err.reason === 'none-mixed'
    ? '"none" cannot be combined with other intents'
    : `unknown value(s) ${err.invalid.join(', ')} (allowed: ${DESIGN_INTENT_VALUES.join(', ')})`;
}

// body -> { surface?, designIntent?, designIntentError?, uiStack?, designSeed? } — read from
// the leading metadata block (every line before the first blank line). Legacy `Surface:
// frontend` reads as `web`; `Surface: mixed` is retired and passed through
// unchanged (materialize.md: a record still declaring it needs re-shaping,
// not a value this module silently rewrites). A Design-intent list that
// normalizes to values sets designIntent (joined ', '); one that fails
// normalizeDesignIntent sets designIntentError instead, naming the raw line value.
function liftMetadata(body) {
  const text = typeof body === 'string' ? body : '';
  // \r?\n\r?\n: a CRLF body (GitHub web-UI edits) ends its metadata block at
  // '\r\n\r\n', which a bare '\n\n' search never finds — the whole body would
  // then be scanned for metadata lines.
  const blankMatch = /\r?\n\r?\n/.exec(text);
  const block = blankMatch ? text.slice(0, blankMatch.index) : text;
  const out = {};
  // [ \t]* (not \s*) before every capture group deliberately: \s matches
  // \n, so a greedy \s* on a bare "Field:" line (no value) would consume
  // the newline and let (\S+)/(.+)$ capture the FOLLOWING line's content
  // instead of correctly failing to match. Same-line-only whitespace keeps
  // a bare line a no-match, never a misread of the next field (refs #357).
  const surfaceMatch = /^Surface:[ \t]*(\S+)/m.exec(block);
  if (surfaceMatch) out.surface = surfaceMatch[1] === 'frontend' ? 'web' : surfaceMatch[1];
  const intentMatch = /^Design-intent:[ \t]*(.+)$/m.exec(block);
  if (intentMatch) {
    const intent = normalizeDesignIntent(intentMatch[1]);
    if (!intent.ok) out.designIntentError = { raw: intentMatch[1].trim(), invalid: intent.invalid, reason: intent.reason };
    else if (intent.values.length) out.designIntent = intent.values.join(', ');
  }
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
  REQUIRED_SECTIONS, PLACEHOLDER_PATTERNS, ORIGINAL_REQUEST_RE, DESIGN_INTENT_VALUES, sectionText, shapeGate, normalizeDesignIntent, describeDesignIntentError, liftMetadata, composeHeader, composeFile, stripCodeSpans,
};
