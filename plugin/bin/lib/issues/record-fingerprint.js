// bin/lib/issues/record-fingerprint.js
// Pure: fingerprint handling — one of record.js's four split boundaries
// (#2805). The dual-write HTML-comment/plain-text markers, the extractor that
// reads either back, and the check-before-create + record-after-create pair
// that enforces specify's idempotency discipline mechanically instead of by
// prose convention alone. No network.
'use strict';

// Dual-write fingerprint markers: FP_RE_WORK is the current marker written by
// recordPayload() (record-payload.js); FP_RE_LEGACY is the pre-work-record
// marker still present on older issues during the migration window, read
// from all three health producers (skills/_shared/work-record.md).
const FP_RE_WORK = /<!--\s*work-fingerprint:\s*([^\s>]+)\s*-->/;
const FP_RE_LEGACY = /<!--\s*(?:code-health|harness-health|journey-health)-fingerprint:\s*([^\s>]+)\s*-->/;

// Plain-text companion to FP_RE_WORK (#1700): the GitHub MCP server's read path
// (`mcp__github__list_issues`/`issue_read`) sanitizes issue bodies the same way it
// sanitizes PR bodies — every `<!-- ... -->` span is stripped before the tool result
// reaches the caller (see `_shared/pr-early-run-lifecycle.md`'s "Root cause" section,
// which documents this for PR reads; the same bluemonday StrictPolicy strips issue
// reads too). recordPayload's finalBody (record-payload.js) writes this line
// immediately after the HTML-comment marker, unconditionally on every transport (the
// write path is unsanitized either way, so writing both costs nothing) — the same
// dual-marker scheme pr-early-run-lifecycle.md already uses for PR bodies.
// Line-anchored (/m), same convention as record-payload.js's other body-metadata
// regexes.
const FP_RE_WORK_PLAIN = /^work-fingerprint: (\S+)[ \t]*$/m;

// body -> fingerprint string, or null when no marker is present (also null for
// null/undefined/empty body). The new work-fingerprint HTML-comment marker wins
// whenever both it and the legacy HTML-comment marker are present, regardless of
// which appears first in the body (dual-write/migration period). The plain-text
// companion (FP_RE_WORK_PLAIN, #1700) is checked last, as a fallback only — it
// exists specifically for the case where an MCP-fetched body has had every
// HTML-comment span stripped, so neither HTML-comment regex can match, but the
// plain-text line survives untouched.
function extractFingerprint(body) {
  if (typeof body !== 'string' || !body) return null;
  const work = FP_RE_WORK.exec(body);
  if (work) return work[1];
  const legacy = FP_RE_LEGACY.exec(body);
  if (legacy) return legacy[1];
  const plain = FP_RE_WORK_PLAIN.exec(body);
  return plain ? plain[1] : null;
}

// (#2658) `specify/record-creation.md`'s Idempotency (resume path) section
// documents a check-before-create + update-after-create discipline against a
// fingerprint->number map, but names it only as a paragraph of prose — there
// was no literal code the executing agent's create call sites were required
// to run, so the check could be silently skipped under time pressure or
// mid-loop distraction (confirmed mechanism behind #2626/#2627's
// 9-second-apart duplicate). These two pure functions are that mechanical
// enforcement: `checkFingerprint` before every `gh issue create`/`gh issue
// edit` call (both `record-creation.md`'s parent-creation block and
// `record-creation-subissues.md`'s sub-issue-creation block), `recordFingerprint`
// immediately after every successful create, mutating the SAME map object a
// caller keeps re-passing through the rest of its loop — matching the
// "stays live for the whole loop rather than a snapshot" semantics the prose
// already specified. No I/O of their own (map read/write to
// `$SPECIFY_EXISTING_FINGERPRINTS` stays the caller's job, exactly as it
// already was) — pure functions only, so a caller embedding them in a
// `node -e` snippet needs no injected deps to unit test them directly.

// (map, fingerprint) -> the existing record's number when the fingerprint is
// already present in the map, or null when it is genuinely new. `map` is a
// plain `{fingerprint: number}` object (`JSON.parse` of
// `$SPECIFY_EXISTING_FINGERPRINTS`'s content) — never a `Map` instance, so
// the map building code already in record-creation.md/record-creation-
// subissues.md needs no change to keep using it directly.
function checkFingerprint(map, fingerprint) {
  if (!map || typeof map !== 'object' || typeof fingerprint !== 'string' || !fingerprint) return null;
  return Object.prototype.hasOwnProperty.call(map, fingerprint) ? map[fingerprint] : null;
}

// (map, fingerprint, number) -> void. Mutates `map` in place — the same
// object reference `checkFingerprint` above was just given — so a caller
// re-reading its own map after this call sees the just-created record
// without a second file read, and a later `fs.writeFileSync` of that same
// object persists it for the next iteration/process. Never validates
// `number`'s shape beyond requiring a positive integer — a caller passing
// something else is a caller bug, and failing loudly here (rather than
// silently coercing) is safer than writing a corrupt map entry a later
// checkFingerprint call would then wrongly treat as "already exists" under
// some other number.
function recordFingerprint(map, fingerprint, number) {
  if (!map || typeof map !== 'object') throw new TypeError('recordFingerprint: map must be an object');
  if (typeof fingerprint !== 'string' || !fingerprint) throw new TypeError('recordFingerprint: fingerprint must be a non-empty string');
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`recordFingerprint: number must be a positive integer, got ${JSON.stringify(number)}`);
  map[fingerprint] = number;
}

module.exports = {
  FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN, extractFingerprint, checkFingerprint, recordFingerprint,
};
