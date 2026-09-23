// bin/lib/issues/labels.js
// Pure: validate + shape a label bootstrap payload. Throws on GitHub's 100-char
// description cap so a too-long description fails at construction time, not
// silently as a 422 on first `gh label create` (see commit 54ab897, which hit
// and fixed this exact bug once for the claim-mirror label, now bot:in-progress).
// #1873: color is a third required field, validated the same fail-loud way —
// GitHub's own label colors are 6 hex digits, no leading `#`; a missing or
// malformed one fails here rather than as a 422 on `gh label create`.
'use strict';

const COLOR_RE = /^[0-9a-fA-F]{6}$/;

function ensureLabelPayload(name, description, color) {
  if (typeof description !== 'string') {
    throw new Error(`label "${name}": description must be a string (got ${typeof description})`);
  }
  if (description.length > 100) {
    throw new Error(`label "${name}": description must be <= 100 chars (got ${description.length}): "${description}"`);
  }
  if (typeof color !== 'string' || color.length === 0) {
    throw new Error(`label "${name}": color is required (six hex digits, no leading #)`);
  }
  if (!COLOR_RE.test(color)) {
    throw new Error(`label "${name}": color must be six hex digits with no leading # (got "${color}")`);
  }
  return { name, description, color: color.toUpperCase() };
}

module.exports = { ensureLabelPayload };
