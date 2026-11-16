'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderPacket } = require('../../../plugin/bin/lib/wrap-up/packet-render');
const { packetStateOf, refreshPacket } = require('../../../plugin/bin/lib/issues/accept-entry');
const {
  PARK_REASON, decideAcceptanceRoute, decideSeries, writeParkDeployStatus, parkStateOf, isParkedForLocalAcceptance,
} = require('../../../plugin/bin/lib/accept/park');

const deployFact = (target, text, extra = {}) => ({ id: 'deploy:status', kind: 'deploy', status: 'passed', source: 'deploy', text, target, live: null, ...extra });
const rendered = (facts) => renderPacket(
  { schemaVersion: 1, record: 4615, partial: [], surface: null, allowedHosts: ['http://localhost:3000'], refused: [], facts },
  { schemaVersion: 1, claims: [] },
).markdown;

const PACKET = rendered([deployFact('local', 'target: local')]);
const HEAD = 'abc1234';
const parked = () => writeParkDeployStatus(PACKET, { headSha: HEAD }).body;
const found = (body) => ({ status: 'found', body });

test('PARK_REASON is the one reason string', () => {
  assert.equal(PARK_REASON, 'awaiting-local-acceptance');
});

test('AC2a.1: control mode off never consults the resolver', () => {
  const off = { consulted: false, park: false, target: null, reason: null };
  assert.deepEqual(decideAcceptanceRoute({ controlMode: false, keptRiskFlags: ['auth'] }), off);
  assert.deepEqual(decideAcceptanceRoute({ controlMode: 'on', keptRiskFlags: ['auth'] }), off);
  assert.deepEqual(decideAcceptanceRoute({ keptRiskFlags: ['auth'] }), off);
  assert.deepEqual(decideAcceptanceRoute(), off);
});

test('AC6.1: a dev resolution does not park', () => {
  assert.deepEqual(decideAcceptanceRoute({ controlMode: true, keptRiskFlags: [], policyDefault: 'dev' }),
    { consulted: true, park: false, target: 'dev', reason: 'policy' });
});

test('local resolution parks', () => {
  assert.deepEqual(decideAcceptanceRoute({ controlMode: true, keptRiskFlags: [] }),
    { consulted: true, park: true, target: 'local', reason: 'default' });
});

test('an unreadable input parks (fails closed to local)', () => {
  assert.equal(decideAcceptanceRoute({ controlMode: true }).park, true);
});

test('AC3a.1: in a two-spec series one park does not change the sibling decision', () => {
  const series = decideSeries([
    { record: 1, input: { controlMode: true, keptRiskFlags: ['auth'] } },
    { record: 2, input: { controlMode: true, keptRiskFlags: [], policyDefault: 'dev' } },
  ]);
  assert.equal(series.park, true);
  assert.deepEqual(series.decisions[0], { record: 1, consulted: true, park: true, target: 'local', reason: 'risk-flag' });
  assert.deepEqual(series.decisions[1], { record: 2, consulted: true, park: false, target: 'dev', reason: 'policy' });
});

test('a series with no parking record does not park; a non-array is rejected', () => {
  assert.equal(decideSeries([{ record: 1, input: { controlMode: true, keptRiskFlags: [], policyDefault: 'dev' } }]).park, false);
  assert.equal(decideSeries([]).park, false);
  assert.throws(() => decideSeries(null), TypeError);
});

test('AC3.2: park writes target, reason and head SHA into Deploy status', () => {
  const { body, changed } = writeParkDeployStatus(PACKET, { headSha: HEAD });
  assert.equal(changed, true);
  assert.deepEqual(parkStateOf(body), { parked: true, target: 'local', reason: PARK_REASON, headSha: HEAD });
  assert.equal(packetStateOf({ packet: found(body), labels: ['accept:pending'] }).state, 'awaiting-local');
});

test('parkStateOf: no park fields, no section, null body', () => {
  assert.deepEqual(parkStateOf(PACKET), { parked: false, target: 'local', reason: null, headSha: null });
  const none = { parked: false, target: null, reason: null, headSha: null };
  assert.deepEqual(parkStateOf(null), none);
  assert.deepEqual(parkStateOf(42), none);
  assert.deepEqual(parkStateOf('no sections here'), none);
});

test('park write keeps an existing ref: line and is idempotent', () => {
  const body = rendered([deployFact('dev', 'target: dev, not confirmed live', { ref: 'deadbeef' })]);
  assert.match(body, /ref: deadbeef/);
  const first = writeParkDeployStatus(body, { headSha: HEAD });
  assert.equal(first.changed, true);
  assert.match(first.body, /^target: local$/m);
  assert.doesNotMatch(first.body, /target: dev/);
  assert.match(first.body, /^ref: deadbeef$/m);
  assert.equal(first.body.match(/^target:/gm).length, 1);
  const second = writeParkDeployStatus(first.body, { headSha: HEAD });
  assert.equal(second.changed, false);
  assert.equal(second.body, first.body);
});

test('a second park at a new head replaces park-head and leaves one of each line', () => {
  const next = writeParkDeployStatus(parked(), { headSha: 'fedcba9876' }).body;
  assert.equal(parkStateOf(next).headSha, 'fedcba9876');
  for (const key of ['target', 'reason', 'park-head']) assert.equal(next.match(new RegExp(`^${key}:`, 'gm')).length, 1, key);
});

test('lines outside Deploy status are untouched; a same-named line elsewhere is not read', () => {
  const lines = ['x', '### What changed', 'target: dev', 'reason: other', '', '### Deploy status', 'target: dev', '', '---', 'footer'];
  const out = writeParkDeployStatus(lines.join('\n'), { headSha: HEAD }).body.split('\n');
  assert.deepEqual(out.slice(0, 5), lines.slice(0, 5));
  assert.deepEqual(out.slice(-3), ['', '---', 'footer']);
  assert.equal(parkStateOf(lines.join('\n')).target, 'dev');
});

test('CRLF bodies keep their line endings', () => {
  const crlf = PACKET.replace(/\n/g, '\r\n');
  const out = writeParkDeployStatus(crlf, { headSha: HEAD }).body;
  assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(parkStateOf(out).parked, true);
});

test('park-head is not read as a deploy ref', () => {
  const body = parked();
  assert.equal(refreshPacket(body, { ref: 'abc1234', text: 'x' }).body, body);
});

test('rejects a bad head sha and a packet with no Deploy status section', () => {
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'HEAD' }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'abc12' }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'ABC1234' }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, {}), TypeError);
  assert.throws(() => writeParkDeployStatus('### What changed\nx\n', { headSha: HEAD }), TypeError);
  assert.throws(() => writeParkDeployStatus(null, { headSha: HEAD }), TypeError);
});

// Each case flips exactly one input from the parked baseline.
const baseline = () => ({ labels: ['accept:pending'], packet: found(parked()) });

test('parked predicate: baseline is parked', () => {
  assert.equal(isParkedForLocalAcceptance(baseline()), 'parked');
  assert.equal(isParkedForLocalAcceptance({ labels: [{ name: 'accept:pending' }], packet: found(parked()) }), 'parked');
});

test('parked predicate: pending label, no park fields in the packet -> not-parked', () => {
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: found(PACKET) }), 'not-parked');
});

test('parked predicate: park fields, no pending label -> not-parked', () => {
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), labels: [] }), 'not-parked');
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), labels: ['accept:approved'] }), 'not-parked');
});

test('parked predicate: demo:pending spelling counts', () => {
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), labels: ['demo:pending'] }), 'parked');
});

test('parked predicate: changes-requested outranks pending', () => {
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), labels: ['accept:changes-requested', 'accept:pending'] }), 'not-parked');
});

test('parked predicate: a wrong target or reason is not-parked', () => {
  const dev = parked().replace('target: local', 'target: dev');
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: found(dev) }), 'not-parked');
  const other = parked().replace(PARK_REASON, 'something-else');
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: found(other) }), 'not-parked');
});

test('parked predicate: no packet -> not-parked; unreadable or malformed -> unknown', () => {
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: { status: 'none' } }), 'not-parked');
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: { status: 'unreadable' } }), 'unknown');
  assert.equal(isParkedForLocalAcceptance({ ...baseline(), packet: { status: 'weird', body: parked() } }), 'unknown');
  assert.equal(isParkedForLocalAcceptance({ labels: ['accept:pending'] }), 'unknown');
  assert.equal(isParkedForLocalAcceptance(), 'unknown');
});

test('a refresh of a parked packet that keeps a ref: line leaves it parked', () => {
  const withRef = rendered([deployFact('dev', 'target: dev, confirmed live', { ref: 'deadbeef' })]);
  const written = writeParkDeployStatus(withRef, { headSha: HEAD }).body;
  const result = refreshPacket(written, { ref: '1234567abc', text: 'target: dev, confirmed live' });
  assert.deepEqual(result.refreshed, []);
  assert.equal(result.body, written);
  assert.equal(isParkedForLocalAcceptance({ labels: ['accept:pending'], packet: found(result.body) }), 'parked');
  assert.equal(packetStateOf({ packet: found(result.body), labels: ['accept:pending'] }).state, 'awaiting-local');
});

test('parked predicate: a found packet without a string body is unknown', () => {
  assert.equal(isParkedForLocalAcceptance({ labels: ['accept:pending'], packet: { status: 'found' } }), 'unknown');
  assert.equal(isParkedForLocalAcceptance({ labels: ['accept:pending'], packet: { status: 'found', body: 7 } }), 'unknown');
});

test('parkStateOf reads the target token as packetStateOf does: `target: local, note` is local', () => {
  const body = parked().replace('target: local', 'target: local, note');
  assert.equal(parkStateOf(body).target, 'local');
  assert.equal(isParkedForLocalAcceptance({ labels: ['accept:pending'], packet: found(body) }), 'parked');
  assert.equal(packetStateOf({ packet: found(body), labels: [] }).state, 'awaiting-local');
});

test('with no target line the park group is separated from the text under it by a blank line', () => {
  const body = '### Deploy status\nsome deploy note\n\n### Next\nx\n';
  const out = writeParkDeployStatus(body, { headSha: HEAD }).body;
  assert.equal(out, `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\n\nsome deploy note\n\n### Next\nx\n`);
  assert.equal(writeParkDeployStatus(out, { headSha: HEAD }).changed, false);
});

test('with an empty Deploy status section no stray blank line is added', () => {
  const out = writeParkDeployStatus('### Deploy status\n', { headSha: HEAD }).body;
  assert.equal(out, `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\n`);
});
