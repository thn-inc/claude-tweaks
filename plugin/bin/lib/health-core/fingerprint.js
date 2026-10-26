'use strict';
const crypto = require('crypto');

// Collapse whitespace and lowercase so cosmetic rewording doesn't mint a new id.
function normalizeText(s) {
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Stable id from a prefix + ordered basis array. Each skill's own
// fingerprint.js maps its named finding fields onto a basis array in a
// fixed order and supplies its own id prefix.
function fingerprintFromBasis(prefix, basis) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

// Parametrized per-skill fingerprint wrapper — same shape as
// createCache(skillName)/createDurableState(skillName, opts) in
// cache.js/durable-state.js. `fields` is the caller's basis field order,
// pulled off a findings-shaped object; a `description` field is run through
// normalizeDescription (== normalizeText) first so cosmetic rewording
// doesn't mint a new id. `skillName`'s dashes are stripped for the id
// prefix ('journey-health' -> 'journeyhealth-<hash>'), matching every
// existing per-skill prefix. Docs-health, harness-health, and journey-health
// all use this; code-health's fingerprint.js is intentionally NOT built on
// this factory — it hashes a different basis shape entirely (v1
// lens/areaId/file/signature vs. v2 criterion/areaId/anchor, with its own
// normalizeSignature/normalizeAnchor, not normalizeText).
function createFingerprint(skillName, fields) {
  const prefix = skillName.replace(/-/g, '');
  function normalizeDescription(description) { return normalizeText(description); }
  function fingerprint(obj) {
    const basis = fields.map((field) => (field === 'description' ? normalizeDescription(obj[field]) : obj[field]));
    return fingerprintFromBasis(prefix, basis);
  }
  return { fingerprint, normalizeDescription };
}

// Extracts every `<!-- {prefix}: <id> -->` marker from text, in order. The prefix is
// regex-escaped so it matches literally. Uses matchAll rather than a manual exec loop —
// matchAll clones the regex internally per call, so the 'g' flag's lastIndex state is
// never shared across calls (same convention as issues/record-dependencies.js's
// parseIssueNumbers).
function parseMarkerFingerprints(text, prefix) {
  const escaped = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<!-- ${escaped}: (\\S+?) -->`, 'g');
  return [...String(text || '').matchAll(re)].map((m) => m[1]);
}

module.exports = { normalizeText, fingerprintFromBasis, createFingerprint, parseMarkerFingerprints };
