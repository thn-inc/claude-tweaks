// bin/lib/health-core/materiality-digest.js
// Dedup mechanism for _shared/materiality-floor.md's digest (#1279) — the materiality-digest
// analog of digest.js's expandDigestFingerprints/appendDigestEntries for the pre-existing
// drain-rate cap digest. A below-floor finding that a scheduled sweep re-encounters on every
// firing must fold into its existing entry, never append a fresh one — otherwise
// tidy/digest-sweep.md's cluster-promotion threshold (>=3 entries sharing the same {area})
// spuriously fires on repeated firings of one genuinely-low-value finding, inverting the
// contract's whole purpose (reducing issue volume for low-materiality findings).
//
// Pure — no I/O, no gh calls, no network. The routing skill (review/step3-routing.md,
// wrap-up/residue-sweep.md, the four health sweeps, ...) calls isMaterialityDuplicate before
// appending a new entry, and materialityEntryLine to compose the line it appends. Dedup reads
// only trusted fingerprint sources (#3766): a github-issues caller passes comment objects, and
// only OWNER/MEMBER/COLLABORATOR comments (issues/comment-trust.js) can suppress a finding.
'use strict';

const { fingerprintFromBasis, normalizeText } = require('./fingerprint');
const { isTrustedComment, untrustedSkipNote } = require('../issues/comment-trust');

const MATERIALITY_MARKER_PREFIX = 'materiality-fingerprint';

// A bare-string array element is the pre-#3766 contract shape (`.comments[].body`): it has no
// author association to check, so it stays untrusted, but its note names the caller's contract
// violation rather than reading like an ordinary untrusted comment.
const BARE_STRING_SKIP_NOTE = 'skipped bare-string digest element — caller passed comment bodies, not comment objects (no author association to check)';

// { area, finding, fileRefs } -> stable fingerprint string, matching materiality-floor.md's
// Entry format fields. fileRefs is normalized (comma-split, trimmed, sorted, deduped) so the
// same set of files listed in a different order or with incidental whitespace differences
// still produces the same fingerprint; `finding` is run through normalizeText (collapse
// whitespace, lowercase) for the same reason expandDigestFingerprints's sibling module
// normalizes descriptions — cosmetic rewording of the same underlying finding must not mint a
// new id. `area` is compared case-insensitively but NOT normalized beyond that in
// materiality-floor.md's own contract (exact-match grouping key) — trimming/lowercasing here
// only guards against incidental casing/whitespace, never semantic variants.
function materialityFingerprint({ area, finding, fileRefs } = {}) {
  const normalizedFileRefs = [...new Set(
    String(fileRefs || '').split(',').map((f) => f.trim()).filter(Boolean),
  )].sort().join(',');
  return fingerprintFromBasis('materiality', [
    String(area || '').trim().toLowerCase(),
    normalizeText(finding || ''),
    normalizedFileRefs,
  ]);
}

// Extracts every embedded materiality-fingerprint marker from a digest issue's comment/body
// text. Returns every marker regardless of whether that entry has since been promoted or
// expired (a trailing `→ {id}`/`→ expired` marker sits on the same line, after this one) —
// dedup must still recognize a still-active entry as already-present; promoted/expired
// filtering is tidy/digest-sweep.md's own concern at sweep time, not this function's.
// Uses matchAll rather than a manual exec loop — matchAll clones the regex internally per
// call, so the 'g' flag's lastIndex state is never shared across calls (same convention as
// issues/record-dependencies.js's parseIssueNumbers).
function parseMaterialityFingerprints(text) {
  const re = new RegExp(`<!-- ${MATERIALITY_MARKER_PREFIX}: (\\S+?) -->`, 'g');
  return [...String(text || '').matchAll(re)].map((m) => m[1]);
}

// entry: { area, finding, fileRefs, deferReason, provenance }. Composes one Entry-format line
// per materiality-floor.md's `## Entry format` section, with the dedup marker appended —
// mirrors digest.js's digestEntryLine, one marker per line, machine-parseable via
// parseMaterialityFingerprints above.
function materialityEntryLine(entry) {
  const fp = materialityFingerprint(entry);
  const {
    area, finding, fileRefs, deferReason, provenance,
  } = entry || {};
  return `- [${area}] ${finding} — ${fileRefs} — Defer-reason: ${deferReason} — ${provenance} <!-- ${MATERIALITY_MARKER_PREFIX}: ${fp} -->`;
}

// existingTexts: the digest container's already-posted comments (github-issues: an array of
// comment objects — `gh --json comments` elements or REST/MCP comments, each with its body and
// author association) or its current file body (local-files: a string, single-writer and so
// trusted). Returns { texts, skipped }. texts are the bodies a dedup may read: a string passes
// through; for an array, each comment passing isTrustedComment contributes its body. A bare
// string array element has no association, so it is dropped (fail closed). skipped holds one
// note line per dropped element whose body carries a materiality-fingerprint marker (an
// untrustedSkipNote for a comment object, BARE_STRING_SKIP_NOTE for a bare string), so the
// caller can name what it ignored (#3766).
function trustedMaterialityTexts(existingTexts) {
  if (existingTexts === null || existingTexts === undefined) return { texts: [], skipped: [] };
  if (typeof existingTexts === 'string') return { texts: [existingTexts], skipped: [] };
  const texts = [];
  const skipped = [];
  for (const el of [].concat(existingTexts)) {
    if (isTrustedComment(el)) {
      texts.push(el.body);
      continue;
    }
    if (typeof el === 'string') {
      if (parseMaterialityFingerprints(el).length > 0) skipped.push(BARE_STRING_SKIP_NOTE);
      continue;
    }
    if (parseMaterialityFingerprints(el && el.body).length > 0) skipped.push(untrustedSkipNote(el));
  }
  return { texts, skipped };
}

// existingTexts: see trustedMaterialityTexts. entry: the candidate about to be routed. Returns
// true when an entry with the same fingerprint is already present in a trusted text, meaning the
// caller must NOT append a duplicate and must NOT count it a second time toward
// cluster-promotion's >=3 threshold. A marker in an untrusted comment never counts (#3766).
function isMaterialityDuplicate(existingTexts, entry) {
  const fp = materialityFingerprint(entry);
  const seen = new Set();
  for (const text of trustedMaterialityTexts(existingTexts).texts) {
    for (const found of parseMaterialityFingerprints(text)) seen.add(found);
  }
  return seen.has(fp);
}

module.exports = {
  MATERIALITY_MARKER_PREFIX,
  materialityFingerprint,
  parseMaterialityFingerprints,
  materialityEntryLine,
  trustedMaterialityTexts,
  isMaterialityDuplicate,
};
