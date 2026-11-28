const { fingerprintFromBasis } = require('../health-core/fingerprint');

// Normalize a stable anchor ("relfile#NearestSymbol").
// Rules:
//   1. Trim surrounding whitespace.
//   2. Split on the first '#'. Normalize each side independently.
//   3. Path side: lowercase; strip any trailing :line(:col) artifact.
//   4. Symbol side: strip any trailing :line(:col) artifact; trim whitespace.
//      Do NOT lowercase the symbol — symbol names are case-sensitive identifiers.
//   5. Re-join with '#'. If there is no '#', treat the whole string as the path side.
function normalizeAnchor(anchor) {
  const s = String(anchor).trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx === -1) {
    // No symbol — normalize the whole thing as a path.
    return s.replace(/:\d+(:\d+)?$/, '').replace(/\s+/g, '').toLowerCase();
  }
  const pathPart = s.slice(0, hashIdx).replace(/:\d+(:\d+)?$/, '').replace(/\s+/g, '').toLowerCase();
  const symbolPart = s.slice(hashIdx + 1).replace(/:\d+(:\d+)?$/, '').trim();
  return `${pathPart}#${symbolPart}`;
}

// Stable id from criterion + areaId + normalized anchor (LLM-judge finding).
// Uses the shared health-core primitive (same one harness-health,
// journey-health, and docs-health use) so a future change to the id
// format lands in one place and propagates to code-health automatically,
// instead of code-health's inline copy silently drifting out of sync.
function fingerprint({ criterion, areaId, anchor }) {
  return fingerprintFromBasis('codehealth', [criterion, areaId, normalizeAnchor(anchor || '')]);
}

module.exports = { fingerprint, normalizeAnchor };
