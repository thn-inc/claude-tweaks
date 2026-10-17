'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateMaturation, extractPendingGrantedAt, partitionGrantComments } = require('../../../plugin/bin/lib/issues/grant-maturation.js');

const NOW = new Date('2026-08-23T12:00:00Z');

test('evaluateMaturation: already-mature when auto:merge is present, regardless of pending', () => {
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: true, pendingSince: null, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, true);
  assert.strictEqual(result.state, 'already-mature');
});

test('evaluateMaturation: not-pending when neither label is present', () => {
  const result = evaluateMaturation({ hasPendingLabel: false, hasMergeLabel: false, pendingSince: null, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, false);
  assert.strictEqual(result.state, 'not-pending');
});

test('evaluateMaturation: unknown-age when pending but no discoverable grant timestamp', () => {
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince: null, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, false);
  assert.strictEqual(result.state, 'unknown-age');
});

test('evaluateMaturation: within-veto-window when pending age is under the window', () => {
  const pendingSince = new Date('2026-08-23T10:00:00Z'); // 2h before NOW
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, false);
  assert.strictEqual(result.state, 'within-veto-window');
  assert.strictEqual(result.ageHours, 2);
});

test('evaluateMaturation: matured when pending age is past the window', () => {
  const pendingSince = new Date('2026-08-22T11:00:00Z'); // 25h before NOW
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, true);
  assert.strictEqual(result.state, 'matured');
  assert.strictEqual(result.ageHours, 25);
});

test('evaluateMaturation: matures exactly at the window boundary (>=, not >)', () => {
  const pendingSince = new Date('2026-08-22T12:00:00Z'); // exactly 24h before NOW
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: 24, now: NOW });
  assert.strictEqual(result.mature, true);
  assert.strictEqual(result.state, 'matured');
});

test('evaluateMaturation: defaults vetoWindowHours to 24 when absent or invalid', () => {
  const pendingSince = new Date('2026-08-22T11:00:00Z'); // 25h before NOW
  const withUndefined = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, now: NOW });
  assert.strictEqual(withUndefined.mature, true);
  const withNaN = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: NaN, now: NOW });
  assert.strictEqual(withNaN.mature, true);
});

test('evaluateMaturation: does not treat an empty-string-derived 0 as a valid veto window', () => {
  const pendingSince = new Date('2026-08-23T11:59:00Z'); // 1 minute before NOW
  // Number('') === 0 — the exact resolver-failure hazard: a finite, non-NaN
  // value that must still hit the 24h fallback, not be honored as a real window.
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: Number(''), now: NOW });
  assert.strictEqual(result.mature, false);
  assert.strictEqual(result.state, 'within-veto-window');
  assert.strictEqual(result.windowHours, 24);
});

test('evaluateMaturation: does not treat a negative vetoWindowHours as valid', () => {
  const pendingSince = new Date('2026-08-23T11:59:00Z'); // 1 minute before NOW
  const result = evaluateMaturation({ hasPendingLabel: true, hasMergeLabel: false, pendingSince, vetoWindowHours: -5, now: NOW });
  assert.strictEqual(result.mature, false);
  assert.strictEqual(result.state, 'within-veto-window');
  assert.strictEqual(result.windowHours, 24);
});

test('extractPendingGrantedAt: null for non-array, empty array, or no marker', () => {
  assert.strictEqual(extractPendingGrantedAt(undefined), null);
  assert.strictEqual(extractPendingGrantedAt([]), null);
  assert.strictEqual(extractPendingGrantedAt(['no marker here']), null);
});

test('extractPendingGrantedAt: extracts the date from a pending marker', () => {
  const body = 'Machine-granted by /claude-tweaks:backlog grant (headless).\n\n<!-- grant-mode-audit: date=2026-08-22T11:00:00Z auto-merge=pending -->';
  const result = extractPendingGrantedAt([body]);
  assert.ok(result instanceof Date);
  assert.strictEqual(result.toISOString(), '2026-08-22T11:00:00.000Z');
});

test('extractPendingGrantedAt: ignores true/false markers, only reads pending', () => {
  const bodies = [
    '<!-- grant-mode-audit: date=2026-08-20T00:00:00Z auto-merge=true -->',
    '<!-- grant-mode-audit: date=2026-08-21T00:00:00Z auto-merge=false -->',
  ];
  assert.strictEqual(extractPendingGrantedAt(bodies), null);
});

test('extractPendingGrantedAt: returns the latest when multiple pending markers exist', () => {
  const bodies = [
    '<!-- grant-mode-audit: date=2026-08-20T00:00:00Z auto-merge=pending -->',
    '<!-- grant-mode-audit: date=2026-08-22T00:00:00Z auto-merge=pending -->',
  ];
  const result = extractPendingGrantedAt(bodies);
  assert.strictEqual(result.toISOString(), '2026-08-22T00:00:00.000Z');
});

// --- partitionGrantComments (#3358): the trust boundary for the pending-grant timestamp ---

const MARKER = (date) => `<!-- grant-mode-audit: date=${date} auto-merge=pending -->`;
const NOTE = (ref, login, assoc) => `skipped marker comment ${ref} by ${login} (${assoc}) — not an owner, member, or collaborator`;

test('partitionGrantComments: trusted bodies are returned, in order, for every trusted association', () => {
  const { bodies, skippedUntrusted } = partitionGrantComments([
    { body: 'a', authorAssociation: 'OWNER' },
    { body: 'b', author_association: 'MEMBER' },
    { body: 'c', authorAssociation: 'COLLABORATOR' },
  ]);
  assert.deepStrictEqual(bodies, ['a', 'b', 'c']);
  assert.deepStrictEqual(skippedUntrusted, []);
});

test('partitionGrantComments: an untrusted marker comment is dropped from bodies and named; a backdated one cannot mature a grant', () => {
  const { bodies, skippedUntrusted } = partitionGrantComments([
    { body: MARKER('2020-01-01T00:00:00Z'), url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' },
  ]);
  assert.deepStrictEqual(bodies, []);
  assert.strictEqual(extractPendingGrantedAt(bodies), null);
  assert.deepStrictEqual(skippedUntrusted, [NOTE('https://x/c1', 'eve', 'NONE')]);
});

test('partitionGrantComments: two consecutive untrusted marker comments are BOTH named (the /g lastIndex hazard)', () => {
  const { skippedUntrusted } = partitionGrantComments([
    { body: MARKER('2020-01-01T00:00:00Z'), url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' },
    { body: MARKER('2020-01-02T00:00:00Z'), url: 'https://x/c2', author: { login: 'mallory' }, authorAssociation: 'CONTRIBUTOR' },
  ]);
  assert.deepStrictEqual(skippedUntrusted, [NOTE('https://x/c1', 'eve', 'NONE'), NOTE('https://x/c2', 'mallory', 'CONTRIBUTOR')]);
});

test('partitionGrantComments: an untrusted non-marker comment is silent; a missing association fails closed and is named', () => {
  const { bodies, skippedUntrusted } = partitionGrantComments([
    { body: 'just chatting', url: 'https://x/c3', author: { login: 'eve' }, authorAssociation: 'NONE' },
    { body: MARKER('2020-01-01T00:00:00Z'), url: 'https://x/c4', author: { login: 'eve' } },
  ]);
  assert.deepStrictEqual(bodies, []);
  assert.deepStrictEqual(skippedUntrusted, [NOTE('https://x/c4', 'eve', 'no association')]);
});

test('partitionGrantComments: non-array, null entries, and bare strings never throw and trust nothing', () => {
  assert.deepStrictEqual(partitionGrantComments(undefined), { bodies: [], skippedUntrusted: [] });
  assert.deepStrictEqual(partitionGrantComments([null, 'a plain string', { authorAssociation: 'NONE' }]), { bodies: [], skippedUntrusted: [] });
});

test('partitionGrantComments: a bare string carrying the pending-grant marker is untrusted and named as unknown; a plain string stays silent', () => {
  const { bodies, skippedUntrusted } = partitionGrantComments([MARKER('2020-01-01T00:00:00Z'), 'a plain string']);
  assert.deepStrictEqual(bodies, []);
  assert.strictEqual(extractPendingGrantedAt(bodies), null);
  assert.deepStrictEqual(skippedUntrusted, [NOTE('unknown', 'unknown', 'no association')]);
});
