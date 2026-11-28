// bin/lib/issues/record-fingerprint.js
// Pure: fingerprint handling — one of record.js's four split boundaries
// (#2805). The dual-write HTML-comment/plain-text markers, the extractor that
// reads either back, and the check-before-create + record-after-create pair
// that enforces specify's idempotency discipline mechanically instead of by
// prose convention alone. No network.
'use strict';

// Fingerprint markers: FP_RE_WORK is the current marker written by
// recordPayload() (record-payload.js); FP_RE_LEGACY is the pre-work-record
// marker of all three health producers, read only — nothing writes it any more
// (skills/_shared/work-record.md).
// Removal condition: remove FP_RE_LEGACY and its branch in extractFingerprint
// once no issue, open or closed, carries a code-health-fingerprint,
// harness-health-fingerprint or journey-health-fingerprint marker. The check is
//   gh issue list --state all --limit 100000 --json number,body -q '[.[] | select(.body | test("(code|harness|journey)-health-fingerprint:"))] | length'
// and a result of 0 means the condition is met. The command checks only the
// repository it runs in; a 0 is necessary but not sufficient, because the reader
// also serves consumer repos this check cannot see, so removal also needs a
// release note plus a sunset window (or a sweep step that rewrites old markers
// to `work-fingerprint`). The removal reaches past this file: grep FP_RE_LEGACY
// and `-health-fingerprint` repo-wide first, since re-exports, skill prose and
// tests pinning that prose name them too.
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
// which appears first in the body (the legacy marker is still read until the
// removal condition above holds). The plain-text companion (FP_RE_WORK_PLAIN,
// #1700) is checked last, as a fallback only — it exists specifically for the
// case where an MCP-fetched body has had every HTML-comment span stripped, so
// neither HTML-comment regex can match, but the plain-text line survives
// untouched.
function extractFingerprint(body) {
  if (typeof body !== 'string' || !body) return null;
  const work = FP_RE_WORK.exec(body);
  if (work) return work[1];
  const legacy = FP_RE_LEGACY.exec(body);
  if (legacy) return legacy[1];
  const plain = FP_RE_WORK_PLAIN.exec(body);
  return plain ? plain[1] : null;
}

// body -> every fingerprint marker in body order (work and legacy HTML-comment markers and the
// plain-text companion lines alike), deduped with the first occurrence keeping its position; [] for a
// non-string or empty body. A bundle record (#6283) carries one marker per member finding, so a map that
// dedups against existing records must read all of them; extractFingerprint above stays first-wins for
// the places that attach ONE fingerprint to a record. Defused text spells none of the three forms.
function extractFingerprints(body) {
  if (typeof body !== 'string' || !body) return [];
  const hits = [];
  for (const re of [FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN]) {
    for (const m of body.matchAll(new RegExp(re.source, `${re.flags}g`))) hits.push([m.index, m[1]]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  return [...new Set(hits.map((h) => h[1]))];
}

// Producer-supplied text quoted into a record body must not spell a fingerprint marker.
// A fence does not stop extractFingerprint above, which takes the FIRST marker in the proposal:
// a quoted `<!-- work-fingerprint: X -->` (or a `work-fingerprint: X` line, the form read once the
// transport strips HTML comments) would hijack the planned fingerprint and dedup against the wrong
// key. So a quoting composer defuses every producer-supplied value before it interpolates it:
// `<!--` becomes `<! --` (which also disarms the legacy `<!-- *-health-fingerprint: -->` markers)
// and `work-fingerprint:` becomes `work-fingerprint :`, anywhere, any case. A fingerprint is
// computed from the raw values, so the key stays stable.
const defuse = (s) => String(s).replace(/<!--/g, '<! --').replace(/work-fingerprint:/gi, (m) => `${m.slice(0, -1)} :`);

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
  FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN, extractFingerprint, extractFingerprints, defuse, checkFingerprint, recordFingerprint,
};
