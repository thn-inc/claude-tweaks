'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderPacket } = require('../../../plugin/bin/lib/wrap-up/packet-render');
const { packetStateOf, refreshPacket } = require('../../../plugin/bin/lib/issues/accept-entry');
const {
  PARK_REASON, decideAcceptanceRoute, decideSeries, writeParkDeployStatus, parkStateOf, isParkedForLocalAcceptance,
} = require('../../../plugin/bin/lib/accept/park');
const { evaluateTripwire, tripwireLines } = require('../../../plugin/bin/lib/accept/tripwire');

const deployFact = (target, text, extra = {}) => ({ id: 'deploy:status', kind: 'deploy', status: 'passed', source: 'deploy', text, target, live: null, ...extra });
const rendered = (facts) => renderPacket(
  { schemaVersion: 1, record: 4615, partial: [], surface: null, allowedHosts: ['http://localhost:3000'], refused: [], facts },
  { schemaVersion: 1, claims: [] },
).markdown;

const PACKET = rendered([deployFact('local', 'target: local')]);
const HEAD = 'abc1234';
const BASE = 'b'.repeat(40);
const parked = () => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE }).body;
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
  const { body, changed } = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE });
  assert.equal(changed, true);
  assert.deepEqual(parkStateOf(body), { parked: true, target: 'local', reason: PARK_REASON, headSha: HEAD, baseSha: BASE });
  assert.equal(packetStateOf({ packet: found(body), labels: ['accept:pending'] }).state, 'awaiting-local');
});

test('parkStateOf: no park fields, no section, null body', () => {
  assert.deepEqual(parkStateOf(PACKET), { parked: false, target: 'local', reason: null, headSha: null, baseSha: null });
  const none = { parked: false, target: null, reason: null, headSha: null, baseSha: null };
  assert.deepEqual(parkStateOf(null), none);
  assert.deepEqual(parkStateOf(42), none);
  assert.deepEqual(parkStateOf('no sections here'), none);
});

test('park write keeps an existing ref: line and is idempotent', () => {
  const body = rendered([deployFact('dev', 'target: dev, not confirmed live', { ref: 'deadbeef' })]);
  assert.match(body, /ref: deadbeef/);
  const first = writeParkDeployStatus(body, { headSha: HEAD, baseSha: BASE });
  assert.equal(first.changed, true);
  assert.match(first.body, /^target: local$/m);
  assert.doesNotMatch(first.body, /target: dev/);
  assert.match(first.body, /^ref: deadbeef$/m);
  assert.equal(first.body.match(/^target:/gm).length, 1);
  const second = writeParkDeployStatus(first.body, { headSha: HEAD, baseSha: BASE });
  assert.equal(second.changed, false);
  assert.equal(second.body, first.body);
});

test('a second park at a new head replaces park-head and leaves one of each line', () => {
  const next = writeParkDeployStatus(parked(), { headSha: 'fedcba9876', baseSha: BASE }).body;
  assert.equal(parkStateOf(next).headSha, 'fedcba9876');
  for (const key of ['target', 'reason', 'park-head', 'park-base']) assert.equal(next.match(new RegExp(`^${key}:`, 'gm')).length, 1, key);
});

test('lines outside Deploy status are untouched; a same-named line elsewhere is not read', () => {
  const lines = ['x', '### What changed', 'target: dev', 'reason: other', '', '### Deploy status', 'target: dev', '', '---', 'footer'];
  const out = writeParkDeployStatus(lines.join('\n'), { headSha: HEAD, baseSha: BASE }).body.split('\n');
  assert.deepEqual(out.slice(0, 5), lines.slice(0, 5));
  assert.deepEqual(out.slice(-3), ['', '---', 'footer']);
  assert.equal(parkStateOf(lines.join('\n')).target, 'dev');
});

test('CRLF bodies keep their line endings', () => {
  const crlf = PACKET.replace(/\n/g, '\r\n');
  const out = writeParkDeployStatus(crlf, { headSha: HEAD, baseSha: BASE }).body;
  assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(parkStateOf(out).parked, true);
});

test('a parked packet holding a stored ref is not refreshed by a source with another ref', () => {
  // The stored `ref:` is what lets refreshPacket reach its park guard; without one it returns early.
  const body = parked().replace(/^park-base: .*$/m, (line) => `${line}\nref: aaa1111`);
  assert.match(body, /^ref: aaa1111$/m);
  assert.equal(refreshPacket(body, { ref: 'bbb2222', text: 'target: dev' }).body, body);
});

test('rejects a bad head sha and a packet with no Deploy status section', () => {
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'HEAD', baseSha: BASE }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'abc12', baseSha: BASE }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: 'ABC1234', baseSha: BASE }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, {}), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD }), TypeError, 'the base is required');
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: 'BASE' }), TypeError);
  assert.throws(() => writeParkDeployStatus('### What changed\nx\n', { headSha: HEAD, baseSha: BASE }), TypeError);
  assert.throws(() => writeParkDeployStatus(null, { headSha: HEAD, baseSha: BASE }), TypeError);
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
  const written = writeParkDeployStatus(withRef, { headSha: HEAD, baseSha: BASE }).body;
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
  const out = writeParkDeployStatus(body, { headSha: HEAD, baseSha: BASE }).body;
  assert.equal(out, `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\npark-base: ${BASE}\n\nsome deploy note\n\n### Next\nx\n`);
  assert.equal(writeParkDeployStatus(out, { headSha: HEAD, baseSha: BASE }).changed, false);
});

const readersOf = (body) => ({
  park: parkStateOf(body),
  state: packetStateOf({ packet: found(body), labels: ['accept:pending'] }).state,
  predicate: isParkedForLocalAcceptance({ labels: ['accept:pending'], packet: found(body) }),
});

test('both readers agree when a mid-line `target: dev` precedes the target line', () => {
  const body = '### Deploy status\nnote from a human: target: dev\ntarget: dev, confirmed live\n\nref: deadbeef\n';
  const written = writeParkDeployStatus(body, { headSha: HEAD, baseSha: BASE }).body;
  const read = readersOf(written);
  assert.equal(read.park.parked, true);
  assert.equal(read.predicate, 'parked');
  assert.equal(read.state, 'awaiting-local');
  assert.equal(refreshPacket(written, { ref: '1234567abc', text: 'target: dev' }).refreshed.length, 0);
  assert.match(written, /note from a human: target: dev/);
});

test('both readers agree on a `- target: local` line that parkStateOf once missed', () => {
  const body = `### Deploy status\n- target: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\npark-base: ${BASE}\n`;
  const read = readersOf(body);
  assert.equal(read.state, 'awaiting-local');
  assert.equal(read.park.target, 'local');
  assert.equal(read.predicate, 'parked');
});

test('a mid-line target elsewhere in the section is read by both, never by parkStateOf alone', () => {
  const body = `### Deploy status\nsee target: dev\nreason: ${PARK_REASON}\n`;
  assert.equal(parkStateOf(body).target, 'dev');
  assert.equal(packetStateOf({ packet: found(body), labels: [] }).state !== 'awaiting-local', true);
});

test('an empty Deploy status section ending at a --- rule keeps a blank line before the rule', () => {
  const body = '### Deploy status\n---\nfooter\n';
  const out = writeParkDeployStatus(body, { headSha: HEAD, baseSha: BASE }).body;
  assert.equal(out, `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\npark-base: ${BASE}\n\n---\nfooter\n`);
  assert.equal(writeParkDeployStatus(out, { headSha: HEAD, baseSha: BASE }).changed, false);
  assert.equal(parkStateOf(out).parked, true);
});

test('with an empty Deploy status section no stray blank line is added', () => {
  const out = writeParkDeployStatus('### Deploy status\n', { headSha: HEAD, baseSha: BASE }).body;
  assert.equal(out, `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\npark-base: ${BASE}\n`);
});

test('decideAcceptanceRoute threads the tripwire input', () => {
  const base = { controlMode: true, keptRiskFlags: [], policyDefault: 'dev' };
  assert.deepEqual(decideAcceptanceRoute({ ...base, tripwire: { status: 'ok', newFlags: ['auth'] } }),
    { consulted: true, park: true, target: 'local', reason: 'risk-flag' });
  assert.deepEqual(decideAcceptanceRoute({ ...base, tripwire: { status: 'could-not-run', newFlags: [] } }),
    { consulted: true, park: true, target: 'local', reason: 'tripwire' });
  assert.deepEqual(decideAcceptanceRoute({ ...base, tripwire: { status: 'ok', newFlags: [] } }),
    { consulted: true, park: false, target: 'dev', reason: 'policy' });
  assert.deepEqual(decideAcceptanceRoute({ ...base, controlMode: false, tripwire: { status: 'ok', newFlags: ['auth'] } }),
    { consulted: false, park: false, target: null, reason: null });
});

test('decideSeries spreads each record\'s tripwire input', () => {
  const series = decideSeries([
    { record: 1, input: { controlMode: true, keptRiskFlags: [], policyDefault: 'dev', tripwire: { status: 'ok', newFlags: [] } } },
    { record: 2, input: { controlMode: true, keptRiskFlags: [], policyDefault: 'dev', tripwire: { status: 'ok', newFlags: ['migrations'] } } },
  ]);
  assert.equal(series.park, true);
  assert.deepEqual(series.decisions.map((d) => [d.record, d.park, d.reason]), [[1, false, 'policy'], [2, true, 'risk-flag']]);
});

// ---- tripwire notes (#4619) ----

const NOTE = 'tripwire: the diff crosses migrations (migrations/\\*\\*: migrations/001.sql), which nobody flagged, so this run is local';
const deploySection = (body) => body.split('\n').slice(body.split('\n').indexOf('### Deploy status') + 1);

test('AC6.1: notes render after the park group', () => {
  const { body } = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [NOTE] });
  const section = deploySection(body);
  assert.deepEqual(section.slice(0, 5), ['target: local', `reason: ${PARK_REASON}`, `park-head: ${HEAD}`, `park-base: ${BASE}`, NOTE]);
  const bare = '### Deploy status\nsome deploy note\n\n### Next\nx\n';
  const after = deploySection(writeParkDeployStatus(bare, { headSha: HEAD, baseSha: BASE, notes: [NOTE] }).body);
  assert.deepEqual(after.slice(4, 7), [NOTE, '', 'some deploy note'], 'a blank line separates the group and its notes from what follows');
  assert.deepEqual(parkStateOf(body), { parked: true, target: 'local', reason: PARK_REASON, headSha: HEAD, baseSha: BASE });
});

test('a neutralized target\\: note keeps the park state', () => {
  const note = 'tripwire: classification said target\\: dev, confirmed live';
  const { body } = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [note] });
  assert.equal(parkStateOf(body).target, 'local');
  assert.equal(readersOf(body).state, 'awaiting-local');
});

test('a rewrite replaces old tripwire lines and is idempotent', () => {
  const first = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: ['tripwire: old reason', 'tripwire: second'] }).body;
  const next = writeParkDeployStatus(first, { headSha: HEAD, baseSha: BASE, notes: [NOTE] });
  assert.equal(next.changed, true);
  assert.equal(next.body.match(/^tripwire/gm).length, 1);
  assert.match(next.body, /^tripwire: the diff crosses/m);
  assert.equal(writeParkDeployStatus(next.body, { headSha: HEAD, baseSha: BASE, notes: [NOTE] }).changed, false);
  const cleared = writeParkDeployStatus(next.body, { headSha: HEAD, baseSha: BASE, notes: [] }).body;
  assert.doesNotMatch(cleared, /^tripwire/m);
  assert.equal(cleared, parked());
});

test('a tripwire line outside Deploy status is kept; only the section is rewritten', () => {
  const lines = ['### What changed', 'tripwire: elsewhere', '', '### Deploy status', 'tripwire: old', 'tripwires are fine', ''];
  const out = writeParkDeployStatus(lines.join('\n'), { headSha: HEAD, baseSha: BASE, notes: ['tripwire: new'] }).body;
  assert.match(out, /^tripwire: elsewhere$/m);
  assert.doesNotMatch(out, /tripwire: old/);
  assert.match(out, /^tripwire: new$/m);
});

test('a note containing target: is refused', () => {
  for (const note of ['tripwire: target: dev', 'tripwire:\ttarget: dev']) {
    assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [note] }), TypeError, note);
  }
});

test('a note with a newline, an empty note, a non-tripwire note or a non-array is refused', () => {
  for (const note of ['tripwire: a\nb', 'tripwire: a\rb', '', 'other: x', 7, null]) {
    assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [note] }), TypeError, String(note));
  }
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: 'tripwire: x' }), TypeError);
  assert.throws(() => writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: new Set(['tripwire: x']) }), TypeError, 'an iterable that is not an array');
});

test('no notes is byte-identical to today', () => {
  const plain = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE });
  assert.equal(writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [] }).body, plain.body);
  const ref = rendered([deployFact('dev', 'target: dev, not confirmed live', { ref: 'deadbeef' })]);
  assert.equal(writeParkDeployStatus(ref, { headSha: HEAD, baseSha: BASE, notes: [] }).body, writeParkDeployStatus(ref, { headSha: HEAD, baseSha: BASE }).body);
  const bare = '### Deploy status\nsome deploy note\n\n### Next\nx\n';
  assert.equal(writeParkDeployStatus(bare, { headSha: HEAD, baseSha: BASE, notes: [] }).body,
    `### Deploy status\ntarget: local\nreason: ${PARK_REASON}\npark-head: ${HEAD}\npark-base: ${BASE}\n\nsome deploy note\n\n### Next\nx\n`);
});

test('notes keep CRLF line endings', () => {
  const out = writeParkDeployStatus(PACKET.replace(/\n/g, '\r\n'), { headSha: HEAD, baseSha: BASE, notes: [NOTE] }).body;
  assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(out.includes(`park-base: ${BASE}\r\n${NOTE}`));
});

test('AC7: a `tripwire could not run:` note renders, is replaced on a rewrite, and keeps the park state', () => {
  const note = 'tripwire could not run: git diff failed: fatal: bad object';
  const first = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: [note] }).body;
  assert.ok(deploySection(first).includes(note));
  assert.equal(parkStateOf(first).target, 'local');
  assert.equal(parkStateOf(first).reason, PARK_REASON);
  const next = writeParkDeployStatus(first, { headSha: HEAD, baseSha: BASE, notes: [NOTE] }).body;
  assert.doesNotMatch(next, /tripwire could not run/);
  assert.equal(next.match(/^tripwire/gm).length, 1);
  const cleared = writeParkDeployStatus(first, { headSha: HEAD, baseSha: BASE, notes: [] }).body;
  assert.equal(cleared, parked());
});

test('Task 1 output goes straight through the writer: could-not-run, crossing, removal and hostile evidence', () => {
  const globs = { migrations: ['migrations/**'] };
  const base = { changedPaths: [], declaredFlags: [], removedFlags: null, globs, agentClassification: [] };
  const results = [
    evaluateTripwire({ ...base, changedPaths: null, diffError: 'git failed\ntarget: dev, confirmed live' }),
    evaluateTripwire({ ...base, changedPaths: ['migrations/001.sql'] }),
    evaluateTripwire({ ...base, changedPaths: ['migrations/001.sql'], removedFlags: ['migrations'] }),
    evaluateTripwire({ ...base, globs: {}, agentClassification: [{ category: 'auth', evidence: 'login\ntarget: dev `x`' }] }),
  ];
  for (const result of results) {
    const lines = tripwireLines(result, { appendFailure: 'gh failed\ntarget: dev' });
    assert.ok(lines.length > 0);
    const { body } = writeParkDeployStatus(PACKET, { headSha: HEAD, baseSha: BASE, notes: lines });
    const section = deploySection(body);
    assert.deepEqual(section.slice(4, 4 + lines.length), lines);
    assert.deepEqual(parkStateOf(body), { parked: true, target: 'local', reason: PARK_REASON, headSha: HEAD, baseSha: BASE });
    assert.equal(readersOf(body).state, 'awaiting-local');
    const rewritten = writeParkDeployStatus(body, { headSha: HEAD, baseSha: BASE, notes: [] }).body;
    assert.equal(rewritten, parked(), 'every line the tripwire writes is removed on a rewrite');
  }
});
