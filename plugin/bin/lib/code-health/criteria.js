'use strict';

// Criteria catalog for code-health v2.
// See the CRITERIA array itself for the current catalog — don't hardcode its
// size or membership here, or in prose elsewhere; both drift.
// Each entry: { id, appliesTo, fragment, confidenceFloor }
//   appliesTo:      'universal' | string[]  (area type strings, e.g. ['frontend','library'])
//   fragment:       path relative to skills/_shared/ for a criteria detail file, or null
//   confidenceFloor:'high' | 'medium' | 'low'  — minimum confidence to FILE a finding for this criterion

const CRITERIA = [
  {
    id: 'architecture-depth',
    appliesTo: 'universal',
    fragment: 'criteria-architecture-depth.md',
    confidenceFloor: 'medium',
  },
  {
    id: 'simplification',
    appliesTo: 'universal',
    fragment: 'criteria-simplification.md',
    confidenceFloor: 'medium',
  },
  {
    id: 'review-quality',
    appliesTo: 'universal',
    fragment: 'criteria-review-quality.md',
    confidenceFloor: 'medium',
  },
  {
    // Area-gated (not universal): load-bearing only where code runs at scale.
    id: 'scalability',
    appliesTo: ['backend', 'data', 'cli', 'infra'],
    fragment: 'criteria-scalability.md',
    confidenceFloor: 'high',
  },
  {
    // Area-gated, but wider than the runtime-only three above: security is a
    // cross-cutting correctness concern, so 'frontend' (client-side authz, XSS,
    // token handling) and 'library' (crypto, input handling) are included too.
    // Only genuinely non-code slices (docs, config) gate it out.
    id: 'security-logic',
    appliesTo: ['backend', 'data', 'cli', 'infra', 'frontend', 'library'],
    fragment: 'criteria-security-logic.md',
    confidenceFloor: 'high',
  },
  {
    id: 'bad-practice',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  {
    id: 'doc-freshness',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  {
    id: 'dead-code',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  {
    id: 'test-quality',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  {
    // Area-gated (not universal): "test-bearing" area types — same set
    // security-logic gates on, since load-bearing tested logic and
    // load-bearing security-relevant logic track the same code shapes. A
    // genuinely non-code slice (docs, config) has no coverage question to
    // ask.
    id: 'missing-tests',
    appliesTo: ['backend', 'data', 'cli', 'infra', 'frontend', 'library'],
    fragment: 'criteria-missing-tests.md',
    confidenceFloor: 'medium',
  },
  {
    // Area-gated (not universal): retries/timeouts/failure modes need a runtime.
    id: 'resilience',
    appliesTo: ['backend', 'data', 'cli', 'infra'],
    fragment: 'criteria-resilience.md',
    confidenceFloor: 'high',
  },
  {
    // Area-gated (not universal): logging/metrics/tracing need a runtime.
    id: 'observability',
    appliesTo: ['backend', 'data', 'cli', 'infra'],
    fragment: 'criteria-observability.md',
    confidenceFloor: 'medium',
  },
  {
    id: 'config-secrets',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'high',
  },
  {
    id: 'dependency-health',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  {
    id: 'input-validation',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'high',
  },
  {
    id: 'naming-clarity',
    appliesTo: 'universal',
    fragment: null,
    confidenceFloor: 'medium',
  },
  // Domain: a11y → frontend
  { id: 'a11y', appliesTo: ['frontend'], confidenceFloor: 'high', fragment: 'criteria-a11y.md' },
  // Domain: i18n → frontend + backend (user-facing apps)
  { id: 'i18n', appliesTo: ['frontend', 'backend'], confidenceFloor: 'medium', fragment: 'criteria-i18n.md' },
  // Domain: api-stability → library + backend
  { id: 'api-stability', appliesTo: ['library', 'backend'], confidenceFloor: 'medium', fragment: 'criteria-api-stability.md' },
  // Domain: migration-safety → data
  { id: 'migration-safety', appliesTo: ['data'], confidenceFloor: 'high', fragment: 'criteria-migration-safety.md' },
  // Domain: iac-security → infra
  { id: 'iac-security', appliesTo: ['infra'], confidenceFloor: 'high', fragment: 'criteria-iac-security.md' },
  // Domain: privacy-pii → user-data areas (frontend, backend, data)
  { id: 'privacy-pii', appliesTo: ['frontend', 'backend', 'data'], confidenceFloor: 'high', fragment: 'criteria-privacy-pii.md' },
  // Domain: concurrency → async/shared-state (backend, cli, data)
  { id: 'concurrency', appliesTo: ['backend', 'cli', 'data'], confidenceFloor: 'medium', fragment: 'criteria-concurrency.md' },
  // Domain: experiment-cleanup → feature-flag/experiment scaffolding whose
  // decision has been made. Area-gated to the surfaces flag idioms actually
  // live in — frontend (client-rendered flags) and backend (server-side
  // gating); pinned directly by code-health's focus=experiment-cleanup
  // (skills/code-health/focus-mode.md), never selected via criteriaForArea.
  { id: 'experiment-cleanup', appliesTo: ['frontend', 'backend'], confidenceFloor: 'medium', fragment: 'criteria-experiment-cleanup.md' },
  // Domain: security-hardening → pre-launch AI-app failure patterns (client
  // secrets, missing per-user ownership checks, unguarded AI endpoints).
  // Area-gated to the surfaces the three checks actually touch (frontend for
  // client-bundle secrets; backend/cli/infra for routes/handlers); pinned
  // directly by code-health's focus=security-hardening
  // (skills/code-health/focus-mode.md), never selected via criteriaForArea.
  { id: 'security-hardening', appliesTo: ['frontend', 'backend', 'cli', 'infra'], confidenceFloor: 'high', fragment: 'criteria-security-hardening.md' },
];

// Build a lookup map once on load for O(1) getCriterion.
const _byId = new Map(CRITERIA.map((c) => [c.id, c]));

// Returns the criterion with the given id, or undefined.
function getCriterion(id) {
  return _byId.get(id);
}

// Returns criteria applicable to the given area types.
// Always includes all universal criteria.
// Adds any domain criteria whose appliesTo array intersects with areaTypes.
// Result is deduplicated (a criterion can only appear once).
function criteriaForArea(areaTypes) {
  const typeSet = new Set(areaTypes || []);
  const seen = new Set();
  const result = [];
  for (const c of CRITERIA) {
    if (seen.has(c.id)) continue;
    if (c.appliesTo === 'universal') {
      seen.add(c.id);
      result.push(c);
    } else if (Array.isArray(c.appliesTo) && c.appliesTo.some((t) => typeSet.has(t))) {
      seen.add(c.id);
      result.push(c);
    }
  }
  return result;
}

module.exports = { CRITERIA, criteriaForArea, getCriterion };
