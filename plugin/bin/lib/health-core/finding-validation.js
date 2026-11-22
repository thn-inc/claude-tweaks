'use strict';

// Shared building blocks for every health producer's validate-finding.js
// (harness-health, journey-health, docs-health; ci-health's calls only
// requireNonEmptyStrings) — the required-non-empty-
// string-field loop and the optional relatedSections array-of-non-empty-
// strings shape check were byte-identical across all three files, down to
// the error-message template string, with zero require() calls tying them
// together. Callers push (or spread) the returned error strings onto their
// own `errors` array.

// obj + list of field names -> array of error strings, one per missing/blank
// field. Empty array when every field is present as a non-empty string.
function requireNonEmptyStrings(obj, fields) {
  const errors = [];
  for (const field of fields) {
    const v = obj[field];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`${field}: required non-empty string (got ${JSON.stringify(v)})`);
    }
  }
  return errors;
}

// obj.relatedSections, when present, must be an array of non-empty strings —
// sibling occurrences of the same root cause bundled into one issue. Absent
// is valid (an opt-in field); anything else is a shape error. Returns [] or
// a single-element error array, matching requireNonEmptyStrings' array
// return shape so callers can spread either result the same way.
function validateRelatedSections(obj) {
  if (obj.relatedSections === undefined) return [];
  const isValidArray = Array.isArray(obj.relatedSections)
    && obj.relatedSections.every((s) => typeof s === 'string' && s.trim() !== '');
  return isValidArray
    ? []
    : [`relatedSections: when present, must be an array of non-empty strings (got ${JSON.stringify(obj.relatedSections)})`];
}

module.exports = { requireNonEmptyStrings, validateRelatedSections };
