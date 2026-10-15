// bin/lib/issues/record-payload.js
// Pure: record-payload/specShapedBody composition — one of record.js's four
// split boundaries (#2805). recordPayload (facet values -> emitted labels +
// body), specShapedBody (the shared Current State/Deliverables/Acceptance
// Criteria/Release Note composer every born-ready producer uses), the
// body-metadata-line readers that round-trip what specShapedBody writes
// (Verified-as-of/Premise-check/Template), the generic markdown-section
// extractor shared by compose-subject.js/decomposition-crossref.js/
// grouping.js, and the backtick-fence helpers used when composing a body
// that wraps arbitrary content. No network.
'use strict';

const { ORIGINS, TYPES, TIERS, CEREMONY_TIERS, PRIORITIES, LABELS } = require('./record-vocabulary');

// The closed Defer-reason: vocabulary — the code twin of
// skills/_shared/deferral-gate.md's "Defer-reason: vocabulary" section
// (tests/deferral-gate-conformance.test.js pins the two lists equal). Order is
// the contract's order. Frozen: consumers compare against it, never extend it.
const DEFER_REASONS = Object.freeze([
  'tangential',
  'needs-human-decision',
  'pre-existing-outside-diff',
  'genuinely-larger',
  'blocked-external',
  'blocked-dependency',
]);

// Matches a Defer-reason: line on ANY line of the body (the /m flag) — the
// suppression check is "no line matching", per deferral-gate.md's hard gate;
// the first line of the body is where the insert path and producers put it
// (deferral-gate.md's "Where the reason lives").
const DEFER_REASON_LINE_RE = /^Defer-reason: (\S+)[ \t]*$/m;

// Freshness stamp (#117): the commit each health-sweep skill actually read at
// filing time, threaded through specShapedBody's verifiedAsOf param as a
// plain body-metadata line — same convention as Origin:/Defer-reason:, never
// YAML frontmatter. A full or abbreviated git sha, hex only. Line-anchored
// (/m) so prose elsewhere in the body mentioning a commit never matches.
const VERIFIED_AS_OF_RE = /^Verified-as-of: ([0-9a-f]{7,40})[ \t]*$/mi;
const SHA_SHAPE_RE = /^[0-9a-f]{7,40}$/i;
// #1840: same body-metadata-line convention as Verified-as-of — a harness-health
// template-conformance/best-practice finding's Proposed block is a snapshot of
// the origin template at filing time, not a promise it still matches the
// installed template at build time. `{path}` is repo-relative
// (skills/init/claude-md-template.md); `{version}` is the plugin.json version
// string (dots, no spaces).
const TEMPLATE_STAMP_RE = /^Template: (\S+) @ (\S+)[ \t]*$/m;
// #1837 review finding: the write side (below) only type-checked
// templateStamp, unlike its sibling verifiedAsOf's SHA_SHAPE_RE — an
// unconstrained string spliced raw into `Template: {templateStamp}` could
// carry embedded newlines, including a spoofed `## Original request`
// heading that neutralizes materialize.js's placeholder gate for
// everything after it. This mirrors TEMPLATE_STAMP_RE's own reader shape
// (`\S+ @ \S+`, no whitespace in either token) rather than inventing a
// separate rule — a value this regex rejects was already going to fail to
// round-trip through extractTemplateStamp unparsed, so this is a
// correctness fix as much as a hardening one.
const TEMPLATE_STAMP_VALUE_RE = /^\S+ @ \S+$/;

// #1829: an optional body-metadata line naming a mechanical command whose
// exit code answers whether the record's stated premise still holds at the
// checkout being materialized (e.g. `wc -l CLAUDE.md`-shaped budget claims)
// — same plain-line convention as Verified-as-of/Origin:/Defer-reason:,
// never YAML frontmatter. The command text is everything after the colon,
// trimmed; single-line only (materialize.js runs it as-is via the shell).
const PREMISE_CHECK_RE = /^Premise-check: (.+)$/m;

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join('|')} (got "${value}")`);
  }
}

// Returns a backtick fence at least one character longer than the longest run
// of backticks found inside `text`, so a fenced code block wrapping arbitrary
// finding content (a docs/skill/rule/CLAUDE.md excerpt) can never be closed
// early by a ``` sequence already present in that content — GitHub's
// fence-matching rule only treats a run of >= the opening fence's length as
// a closer.
function fenceFor(text) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fencedBlock(text) {
  const fence = fenceFor(text);
  return `${fence}\n${text}\n${fence}`;
}

// { title, body, type, origin?, risk?, size?, ceremony?, solutionUnjustified?, ready?, parked?, priority?, fingerprint?, deferReason? }
// -> { title, body, labels: string[], type }
// Validates supplied enum values; absence of an optional field never throws.
// The emit side is size-only: `effort` is accepted only to throw on it (below) —
// a caller composing a payload inline from pre-rename facets fails loud instead
// of silently dropping the scoring label. No code path here writes an effort:*
// label. The read side's effort:* fallback (record-vocabulary.js's
// parseRecordFacets) is deliberately one-directional. `framing` is rejected the
// same way — the pre-rename name of `solutionUnjustified` (#677).
function recordPayload({ title, body, type, origin, risk, size, ceremony, solutionUnjustified, ready, parked, priority, fingerprint, effort, framing, deferReason } = {}) {
  if (typeof title !== 'string' || !title) {
    throw new Error(`title must be a non-empty string (got ${typeof title})`);
  }
  if (typeof body !== 'string') {
    throw new Error(`body must be a string (got ${typeof body})`);
  }
  oneOf('type', type, TYPES);

  if (effort !== undefined) {
    throw new Error('recordPayload has no effort parameter — the record facet is size (#217); effort means reasoning depth');
  }

  if (framing !== undefined) {
    throw new Error('recordPayload has no framing parameter — the facet is solutionUnjustified (#677); framing:baked was renamed solution:unjustified');
  }

  if (ready && parked) {
    throw new Error('a record cannot be both ready and parked');
  }

  // deferReason is validation-plus-body-line, never a label: an unknown value
  // throws naming the field (same posture as the effort rejection above); a valid
  // one is inserted as the body's first line unless the body already carries a
  // matching Defer-reason: line (a specShapedBody-composed body, #623), in which
  // case nothing is inserted; a body carrying a *different* value is a caller
  // contradiction and throws.
  let reasonBody = body;
  if (deferReason !== undefined) {
    oneOf('deferReason', deferReason, DEFER_REASONS);
    const existing = DEFER_REASON_LINE_RE.exec(body);
    if (existing) {
      if (existing[1] !== deferReason) {
        throw new Error(`body already carries "Defer-reason: ${existing[1]}" but deferReason is "${deferReason}"`);
      }
    } else {
      reasonBody = `Defer-reason: ${deferReason}\n\n${body}`;
    }
  }

  // Deterministic emission order: by:*, risk:*, size:*, ceremony:*, solution:unjustified, ready, parked, priority:*.
  const labels = [];

  if (origin !== undefined) {
    oneOf('origin', origin, ORIGINS);
    labels.push(`by:${origin}`);
  }
  if (risk !== undefined) {
    oneOf('risk', risk, TIERS);
    labels.push(`risk:${risk}`);
  }
  if (size !== undefined) {
    oneOf('size', size, TIERS);
    labels.push(`size:${size}`);
  }
  if (ceremony !== undefined) {
    oneOf('ceremony', ceremony, CEREMONY_TIERS);
    labels.push(`ceremony:${ceremony}`);
  }
  if (solutionUnjustified) labels.push(LABELS.SOLUTION_UNJUSTIFIED);
  if (ready) labels.push(LABELS.READY);
  if (parked) labels.push(LABELS.PARKED);
  if (priority !== undefined) {
    oneOf('priority', priority, PRIORITIES);
    labels.push(`priority:${priority}`);
  }

  const finalBody = fingerprint
    ? `${reasonBody}\n\n<!-- work-fingerprint: ${fingerprint} -->\nwork-fingerprint: ${fingerprint}`
    : reasonBody;

  return { title, body: finalBody, labels, type };
}

// body -> the git sha the sweep read when it filed this issue, or null when
// absent (a pre-#117 issue, or a body that was never run through
// specShapedBody's verifiedAsOf param). Consumers (e.g. bin/materialize.js)
// diff this against current HEAD to say something actionable about drift —
// see [IL-71]: presence of a fresh stamp bounds drift, it never establishes
// correctness, so a consumer still must not skip verification just because
// this reads recent.
function extractVerifiedAsOf(body) {
  if (typeof body !== 'string' || !body) return null;
  const m = VERIFIED_AS_OF_RE.exec(body);
  return m ? m[1].toLowerCase() : null;
}

// body -> the Premise-check: command string, or null when the line is
// absent — mirrors extractVerifiedAsOf's shape exactly. #1829: materialize.js
// runs this command from the checkout root to answer "does the record's
// Current State claim still hold at base" before a build starts.
function extractPremiseCheck(body) {
  if (typeof body !== 'string' || !body) return null;
  const m = PREMISE_CHECK_RE.exec(body);
  return m ? m[1].trim() : null;
}

// body -> { path, version } the harness-health finding's Proposed block was
// snapshotted from, or null when the record carries no Template: line (every
// finding except a template-derived CLAUDE.md/rule template-conformance or
// best-practice finding, and every record filed before #1840). Consumers
// (bin/materialize.js) compare `version` against the installed plugin's own
// version to decide whether the Proposed block needs re-deriving.
function extractTemplateStamp(body) {
  if (typeof body !== 'string' || !body) return null;
  const m = TEMPLATE_STAMP_RE.exec(body);
  return m ? { path: m[1], version: m[2] } : null;
}

const ANY_HEADING_RE = /^#{1,6}[ \t]/;

// body, heading text, options -> the section text under that heading, or ''
// when absent. Shared line-boundary finder behind compose-subject.js's
// Breaking Change/Release Note/Overview extraction, decomposition-crossref.js's
// Gotchas/Prerequisites extraction, and grouping.js's Key Files extraction —
// three independent re-implementations of the same "find a heading, walk
// lines until the next one" loop (#2251 review row 18).
//   levelPattern: the `{...}` regex-quantifier body for this heading's own
//     level (default '2,4' — h2 through h4, decomposition-crossref.js's and
//     grouping.js's shared original range).
//   stopPattern: the level-class that terminates the section (default
//     '1,6' — any heading; compose-subject.js overrides to '2' since its own
//     sections may carry nested subsections that must stay inside them).
//   trim: trim the joined result (default false, decomposition-crossref.js's
//     and grouping.js's original behavior; compose-subject.js overrides true).
// CRLF-normalized before matching — none of the three original
// implementations did this, so a CRLF file (this repo has at least one,
// `[IL-160]`) could silently fail every heading match; this fixes that as a
// side effect rather than as its own goal.
function extractSection(body, heading, { levelPattern = '2,4', stopPattern = '1,6', trim = false } = {}) {
  if (typeof body !== 'string') return '';
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{${levelPattern}}[ \\t]+${escaped}[ \\t]*$`);
  const stopRe = new RegExp(`^#{${stopPattern}}[ \\t]`);
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (stopRe.test(lines[i])) break;
    out.push(lines[i]);
  }
  const joined = out.join('\n');
  return trim ? joined.trim() : joined;
}

// { header?, currentState, deliverables, acceptanceCriteria?, openQuestion?, filedBy,
//   provenance?: { origin?, deferReason? }, footer?: string | null, verifiedAsOf?: string }
//   -> body string.
// Additive over the original shape: a call passing none of provenance/footer/openQuestion/
// verifiedAsOf (and a non-empty header) composes byte-identical output — the four health-suite
// builders are the regression oracle (tests/health-filing-parity.test.js). Exactly one
// of acceptanceCriteria/openQuestion must be supplied: openQuestion is the composer's
// needs:definition variant, rendering `## Open Question` in place of Acceptance
// Criteria so a needs-you record never carries placeholder AC. Provenance lines
// (Origin:, then Defer-reason: — validated against DEFER_REASONS) render between
// header and `## Current State`, where provenance.js's line-anchored Origin: parse
// reads them. footer: a string replaces the default health-suite sentence, null omits
// it; exhaust producers pass `_Filed by \`{producer}\` via specShapedBody._` — the
// machine-visible marker _shared/work-record.md's born-shaped matrix rows key on.
// header is the slot for producer-specific leading lines (e.g. `Trigger: {condition}`)
// and may be empty/omitted — the one relaxation from the original, needed because the
// openQuestion variant's canonical call carries no header.
// verifiedAsOf (#117): the git sha the caller itself read the repo at, right before
// composing this body — a plain `Verified-as-of: {sha}` metadata line, rendered before
// Origin:/Defer-reason: (extracted by extractVerifiedAsOf, above). Validated against a
// bare hex-sha shape so an obviously wrong value (a date, a branch name) fails loud here
// rather than filing a stamp nothing can compare against. The caller MUST resolve this
// value itself, at read time — never pass a value this function re-derives or that was
// resolved earlier than the read that produced currentState/deliverables, or a queued
// finding filed later stamps a commit it never actually looked at (worse than no stamp —
// see the Gotchas in issue #117).
// premiseCheck (#1829, optional): a single-line shell command whose exit code answers
// whether the record's Current State claim still holds — rendered as `Premise-check:
// {command}` right after Verified-as-of (extracted by extractPremiseCheck, above). No
// shape validation beyond single-line (a bad command degrades to premise: null with a
// stderr note at materialize time, per that CLI's fail-open posture — never a filing-time
// gate). The filing site is the only place that knows its own command; materialize.js
// never invents one. Security note: this is body text, so nothing here stops an
// untrusted issue body from also carrying this line — materialize.js gates actually
// running it on the issue author's GitHub-attested author_association (trusted only at
// OWNER/MEMBER/COLLABORATOR), never on this string alone. See flow/materialize.md's
// "Author-association gate" paragraph.
// (#2660) `releaseNote` is REQUIRED, not optional, alongside currentState/
// deliverables/filedBy below — deliberately, not an oversight. This composer
// is the shared body-composition path for every "born-ready" producer
// (`_shared/work-record.md`'s Born-ready rule): the four health-sweep
// skills' issue-payload.js files, plus /wrap-up, /reflect, and /review's
// `side-effect:*` producers. `_shared/work-record.md` and
// `bin/lib/compose-record/compose.js`'s own `REQUIRED_SECTIONS` both already
// treat `## Release Note` as a required fourth section (#2580/#2581), but
// this composer was never updated to match — every record it filed was
// missing that section from day one, invisible at filing time AND at
// `/flow`'s materialize-time gate, and caught only much later, at merge
// time, by `bin/compose-subject.js`'s hard refusal (confirmed live on #2587).
// A required parameter here — failing loud at filing time, the same posture
// `currentState`/`deliverables`/`filedBy` already have — closes that gap at
// its cheapest, earliest point instead of leaving it to surface at the most
// expensive one. A genuinely no-op finding still needs a value: pass a
// plain "No user-visible change." rather than omitting the parameter —
// `spec-template.md`'s Release Note guidance treats that phrasing as valid
// content, never as licence to skip the section.
function specShapedBody({
  header, currentState, deliverables, acceptanceCriteria, openQuestion, releaseNote, filedBy, provenance, footer, verifiedAsOf, premiseCheck,
  templateStamp,
} = {}) {
  const isEmpty = (value) => value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  const hasAC = !isEmpty(acceptanceCriteria);
  const hasOQ = !isEmpty(openQuestion);
  if (hasAC === hasOQ) {
    throw new Error('specShapedBody: exactly one of acceptanceCriteria/openQuestion is required');
  }
  const sections = [
    ['currentState', currentState],
    ['deliverables', deliverables],
    ['releaseNote', releaseNote],
    ['filedBy', filedBy],
  ];
  for (const [name, value] of sections) {
    if (isEmpty(value)) {
      throw new Error(`specShapedBody: ${name} is required and must be non-empty`);
    }
  }
  if (!isEmpty(verifiedAsOf) && !SHA_SHAPE_RE.test(verifiedAsOf)) {
    throw new Error(`specShapedBody: verifiedAsOf must be a git commit sha (got "${verifiedAsOf}")`);
  }
  if (!isEmpty(premiseCheck) && /\n/.test(premiseCheck)) {
    throw new Error('specShapedBody: premiseCheck must be a single-line command');
  }
  if (!isEmpty(templateStamp) && typeof templateStamp !== 'string') {
    throw new Error(`specShapedBody: templateStamp must be a string (got ${typeof templateStamp})`);
  }
  if (!isEmpty(templateStamp) && !TEMPLATE_STAMP_VALUE_RE.test(templateStamp)) {
    throw new Error(`specShapedBody: templateStamp must match "{path} @ {version}" with no whitespace in either token (got "${templateStamp}")`);
  }
  const { origin, deferReason } = provenance || {};
  if (deferReason !== undefined) oneOf('deferReason', deferReason, DEFER_REASONS);
  const block = (v) => (Array.isArray(v) ? v.join('\n\n') : v);
  const parts = [];
  if (!isEmpty(header)) parts.push(header);
  if (!isEmpty(verifiedAsOf)) parts.push(`Verified-as-of: ${verifiedAsOf.toLowerCase()}`);
  if (!isEmpty(premiseCheck)) parts.push(`Premise-check: ${premiseCheck}`);
  if (!isEmpty(templateStamp)) parts.push(`Template: ${templateStamp}`);
  if (!isEmpty(origin)) parts.push(`Origin: ${origin}`);
  if (deferReason !== undefined) parts.push(`Defer-reason: ${deferReason}`);
  parts.push('## Current State', block(currentState), '## Deliverables', block(deliverables));
  if (hasOQ) parts.push('## Open Question', block(openQuestion));
  else parts.push('## Acceptance Criteria', block(acceptanceCriteria));
  parts.push('## Release Note', block(releaseNote));
  if (footer === undefined) {
    parts.push(`_Filed by \`${filedBy}\`. Close to resolve; label \`wontfix\` to suppress future reports of this finding._`);
  } else if (footer !== null && !isEmpty(footer)) {
    parts.push(footer);
  }
  return parts.join('\n\n');
}

module.exports = {
  DEFER_REASONS, recordPayload, specShapedBody,
  extractVerifiedAsOf, extractPremiseCheck, extractTemplateStamp,
  fenceFor, fencedBlock, extractSection,
};
