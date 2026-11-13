'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluateGrantGate } = require('../../../plugin/bin/lib/issues/grant-gate.js');

// Fixture: an agent-filed, clean-trust, low-risk record — every gate clear.
// Individual tests mutate one dimension at a time (record labels/facets, policy,
// or grantCheck) to isolate exactly one failing key per #269 AC2 ("a single
// combined scenario cannot attribute the refusal" — IL-105).
function baseRecord(overrides) {
  return {
    number: 201,
    labels: ['by:code-health', 'ready', 'risk:low', 'size:low'],
    body: 'Surface: backend\n\n## Current State\n...\n\n## Deliverables\n- [ ] x\n\n## Acceptance Criteria\n1. x\n\n### Key Files\n\n- bin/lib/foo.js\n',
    keyFiles: ['bin/lib/foo.js'],
    ...overrides,
  };
}

function basePolicy(overrides) {
  return {
    ceiling: 'unattended',
    grantOriginationEnabled: true,
    sensitivePaths: [],
    ...overrides,
  };
}

const cleanVerdict = new Map([['producer:code-health|low', { verdict: 'clean', kind: 'producer', dispositioned: 9, coverage: 0.9 }]]);

const clearGrantCheck = { clear: true, rationale: 'well-scoped, low-risk change' };

test('AC1: all keys satisfied grants auto:build + auto:merge', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.autoMerge, true);
  assert.equal(result.failedKey, null);
});

test('phase 1 (no grantCheck passed) reports needsGrantCheck when gates 1-3 clear', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
  });
  assert.equal(result.grant, false);
  assert.equal(result.needsGrantCheck, true);
  assert.equal(result.failedKey, null);
});

test('AC2 key 1: ceiling trusted (not unattended) refuses, named in failedKey', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ ceiling: 'trusted' }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.autoMerge, false);
  assert.equal(result.failedKey, 'ceiling');
});

test('AC2 key 2: grant-origination opt-in unset refuses even at unattended', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ grantOriginationEnabled: false }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'grant-origination-opt-in');
});

test('needs:definition refuses unconditionally, before trust/origin are consulted', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:definition'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'needs-definition');
});

test('needs:definition refuses even with no trustVerdicts/grantCheck passed at all', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:definition'] }),
    policy: basePolicy(),
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'needs-definition');
  assert.equal(result.needsGrantCheck, undefined);
});

test('needs:decision (a different needs:* label) refuses under a new needs-label failedKey, not needs-definition', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:decision'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'needs-label');
  assert.match(result.reason, /needs:decision/);
});

test('needs:decision refuses even with no trustVerdicts/grantCheck passed at all (same posture as needs:definition)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:decision'] }),
    policy: basePolicy(),
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'needs-label');
  assert.equal(result.needsGrantCheck, undefined);
});

test('a record carrying both needs:definition and needs:decision denies under needs-definition (checked first)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:definition', 'needs:decision'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.failedKey, 'needs-definition');
});

test('AC2 key 3: no cell at all for this class refuses (distinct from a present insufficient-evidence row)', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: new Map(), // no closed records for this class yet — no cell
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'trust');
  assert.match(result.reason, /no-cell/);
});

test('AC2 key 3c: a present row whose own verdict is insufficient-evidence refuses, and names that exact string', () => {
  const thin = new Map([['producer:code-health|low', { verdict: 'insufficient-evidence', kind: 'producer' }]]);
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: thin,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'trust');
  assert.match(result.reason, /insufficient-evidence/);
});

test('AC2 key 3b: class trust mixed refuses, names the actual verdict string', () => {
  const mixed = new Map([['producer:code-health|low', { verdict: 'mixed', kind: 'producer' }]]);
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: mixed,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'trust');
  assert.match(result.reason, /mixed/);
});

test('AC2 key 4: record with no by:* label refuses (origin gate)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['ready', 'risk:low', 'size:low'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['human:human|low', { verdict: 'clean', kind: 'human' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'origin');
});

test('AC3: a human-filed record refuses even with every other key satisfied (own scenario)', () => {
  // Every other key deliberately clear: ceiling unattended + opt-in, trust
  // clean for the human:human class, grant-check clear, no floors — only the
  // by:* origin is missing.
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['ready', 'risk:low', 'size:low'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['human:human|low', { verdict: 'clean', kind: 'human' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'origin');
});

test('AC2 key 5: grant-check flagging refuses', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: { clear: false, rationale: 'body proposes an irreversible external action' },
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'grant-check');
  assert.match(result.reason, /irreversible/);
});

test('AC2 key 6: merge-sensitive-paths match on the record\'s Key Files refuses', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ keyFiles: ['bin/hooks.js'] }),
    policy: basePolicy({ sensitivePaths: ['bin/hooks.js'] }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'merge-sensitive-paths');
});

test('AC2 key 7 / #366 AC11: risk:high refuses via the oversight floor', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:high', 'size:low'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'oversight-floor');
});

test('#366 AC12: risk:medium + size:high now refuses too (old check never read size)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:medium', 'size:high'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'oversight-floor');
});

test('#366: riskFloor/sizeFloor default to \'high\' when policy omits them (medium tier still grants)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:medium', 'size:medium'] }),
    policy: basePolicy(), // no riskFloor/sizeFloor keys at all
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.failedKey, null);
});

test('#969 AC1: shaped:headless + risk:medium denies with shaped-headless-floor', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:medium', 'size:low', 'shaped:headless'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'shaped-headless-floor');
  assert.equal(result.snapshot.risk, 'medium');
  assert.equal(result.snapshot.size, 'low');
  assert.equal(result.snapshot.floorReason, 'risk');
});

test('#969 AC1: shaped:headless + size:medium denies with shaped-headless-floor', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:medium', 'shaped:headless'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'shaped-headless-floor');
  assert.equal(result.snapshot.risk, 'low');
  assert.equal(result.snapshot.size, 'medium');
  assert.equal(result.snapshot.floorReason, 'size');
});

test('#969 AC2: shaped:headless + risk:low + size:low is not denied by this rule (later gates still apply)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'shaped:headless'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.failedKey, null);
});

test('#969 AC3: no shaped:headless, same facets as the medium-risk case above, still grants (human-shaped path byte-identical)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:medium', 'size:low'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.failedKey, null);
});

test('#969 AC4: shaped:headless + risk:high denies with oversight-floor, not shaped-headless-floor (existing key wins deny-fast)', () => {
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:high', 'size:low', 'shaped:headless'] }),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|elevated', { verdict: 'clean', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'oversight-floor');
});

test('AC2 key 8: fleet daily grant cap spent refuses', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ dailyGrantCap: 3, grantsIssuedToday: 3 }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'daily-grant-cap');
});

test('AC4: cap check with no cap key configured passes (optional-when-absent)', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ grantsIssuedToday: 9999 }), // no dailyGrantCap set at all
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.failedKey, null);
});

test('cap under the configured limit still grants', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ dailyGrantCap: 3, grantsIssuedToday: 2 }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
});

test('gate order: ceiling failure short-circuits before trust/origin/grant-check are even consulted', () => {
  // Every other key deliberately broken too — only the ceiling failure should
  // be attributed, proving evaluation order and short-circuit.
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['ready', 'risk:high', 'size:low'] }), // no by:*, risk:high
    policy: basePolicy({ ceiling: 'supervised', grantOriginationEnabled: false }),
    trustVerdicts: new Map(), // no-cell
    grantCheck: { clear: false },
  });
  assert.equal(result.failedKey, 'ceiling');
});

// --- #311: global merge-lane circuit breaker (policy.mergeLaneBreakerTripped) ---

test('#311 AC1: mergeLaneBreakerTripped forces autoMerge false while grant stays true, and the snapshot records it', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ mergeLaneBreakerTripped: true }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.autoMerge, false);
  assert.equal(result.failedKey, null);
  assert.equal(result.snapshot.mergeLaneBreakerTripped, true);
});

test('#311 AC5: while tripped, auto:build origination (grant:true) is unaffected — the breaker gates autoMerge only', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ mergeLaneBreakerTripped: true }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
  assert.equal(result.failedKey, null);
});

test('#311: mergeLaneBreakerTripped absent/false preserves today\'s behavior — no snapshot key, autoMerge follows permittedGrants', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.autoMerge, true);
  assert.equal('mergeLaneBreakerTripped' in result.snapshot, false);
});

test('#311: a tripped breaker never routes through deny() — a record that would otherwise be refused still refuses on its own failedKey, not the breaker', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy({ ceiling: 'trusted', mergeLaneBreakerTripped: true }),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, false);
  assert.equal(result.autoMerge, false);
  assert.equal(result.failedKey, 'ceiling', 'the breaker must never be attributed as the reason a record failed an earlier, unrelated gate');
});

test('re-authorization (bot:blocked) path is unaffected by this module — it is a caller-level distinction', () => {
  // grant-gate itself doesn't special-case bot:blocked records; the mode's own
  // prose treats a passing gate result on a bot:blocked record as
  // "re-authorize" rather than "first grant" (auto:merge withheld regardless
  // of autoMerge, per refine-headless.md). Confirm the gate's own output shape does
  // not vary by bot state so that distinction is safe to layer on top.
  const result = evaluateGrantGate({
    record: baseRecord({ labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'bot:blocked'] }),
    policy: basePolicy(),
    trustVerdicts: cleanVerdict,
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.grant, true);
});

test('AC2 key 3b: a bare mixed row keeps the plain reason — no empty parentheses, no rate segment', () => {
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|low', { verdict: 'mixed', kind: 'producer' }]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.reason, 'class producer:code-health|low verdict is mixed — only a clean class earns a machine-originated grant');
  assert.doesNotMatch(result.reason, /\(\)/);
  assert.doesNotMatch(result.reason, /follow-up rate/);
});

test('AC7.1: a mixed row\'s deny reason names the rate and the threshold', () => {
  const row = { key: 'producer:code-health|low', kind: 'producer', verdict: 'mixed', mixedReasons: ['follow-up-rate'], followUpRecords: 1, total: 3, followUpRate: 1 / 3, followUpRateMaxPercent: 30, changesRequested: 0, negativeEvidence: 0 };
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|low', row]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.failedKey, 'trust');
  assert.match(result.reason, /33\.4%/);
  assert.match(result.reason, /30%/);
  assert.match(result.reason, /mixed/);
});

test('AC7.1: a mixed row pinned only by negative evidence still names the rate and the threshold', () => {
  const row = { key: 'producer:code-health|low', kind: 'producer', verdict: 'mixed', mixedReasons: ['negative-evidence'], followUpRecords: 0, total: 3, followUpRate: 0, followUpRateMaxPercent: 30, changesRequested: 0, negativeEvidence: 1 };
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|low', row]]),
    grantCheck: clearGrantCheck,
  });
  assert.match(result.reason, /1 negative/);
  assert.match(result.reason, /follow-up rate 0% \(max 30%\)/);
});

test('AC7.1: a non-mixed verdict keeps today\'s reason text', () => {
  const row = { key: 'producer:code-health|low', kind: 'producer', verdict: 'insufficient-evidence', followUpRecords: 0, total: 1, followUpRateMaxPercent: 30 };
  const result = evaluateGrantGate({
    record: baseRecord(),
    policy: basePolicy(),
    trustVerdicts: new Map([['producer:code-health|low', row]]),
    grantCheck: clearGrantCheck,
  });
  assert.equal(result.reason, 'class producer:code-health|low verdict is insufficient-evidence — only a clean class earns a machine-originated grant');
});
