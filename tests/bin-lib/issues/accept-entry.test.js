'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PACKET_MARKER, WITHHELD_TEXT } = require('../../../plugin/bin/lib/wrap-up/packet-contract');
const {
  automaticLabelAction,
  PACKET_STATES,
  packetStateOf,
  REFRESHABLE_FIELDS,
  refreshPacket,
  verdictLabelEdits,
} = require('../../../plugin/bin/lib/issues/accept-entry');

const UNVERIFIED_SUFFIX = ' (link unverified: deploy not confirmed live)';

// A packet body in the renderer's shape: the marker, then each section as a blank
// line, its `### ` heading and its body lines. `null` leaves a section out.
function packet({
  whatChanged = ['- Changed the widget', 'A human note added after posting.'],
  recording = ['not recorded'],
  testGuide = ['- Open the page: <http://localhost:3000/x>'],
  triedToBreak = ['- neg-1 passed', 'Another human line.'],
  deploy = ['target: local'],
} = {}) {
  const sections = [
    ['What changed', whatChanged],
    ['Recording', recording],
    ['Test guide', testGuide],
    ['Tried to break', triedToBreak],
    ['Deploy status', deploy],
  ];
  const lines = [PACKET_MARKER, '', '## Acceptance packet for #7'];
  for (const [heading, body] of sections) {
    if (body !== null) lines.push('', `### ${heading}`, ...body);
  }
  return `${lines.join('\n')}\n`;
}

const found = (body) => ({ status: 'found', body });
const stateOf = (body, labels = []) => packetStateOf({ packet: found(body), labels });

// The text of one `### {heading}` section, heading excluded, up to the next `### ` heading.
function sectionOf(body, heading) {
  const start = body.indexOf(`### ${heading}\n`);
  assert.notEqual(start, -1, `no ${heading} section`);
  const from = start + `### ${heading}\n`.length;
  const next = body.indexOf('\n### ', from);
  return body.slice(from, next === -1 ? body.length : next);
}

// --- automaticLabelAction ---

test('AC4.1: no label of either vocabulary → apply-pending', () => {
  assert.equal(automaticLabelAction([]), 'apply-pending');
  assert.equal(automaticLabelAction(['ready']), 'apply-pending');
});

test('AC4.2: a pending label already present → none', () => {
  assert.equal(automaticLabelAction(['accept:pending']), 'none');
  assert.equal(automaticLabelAction(['demo:pending']), 'none');
});

test('AC4.3: any verdict label of either vocabulary → none', () => {
  for (const label of ['accept:approved', 'accept:changes-requested', 'demo:approved', 'demo:changes-requested']) {
    assert.equal(automaticLabelAction([label]), 'none', label);
  }
});

test('AC4.3 mixed vocab: demo:pending beside accept:approved → none', () => {
  assert.equal(automaticLabelAction(['demo:pending', 'accept:approved']), 'none');
});

// --- packetStateOf ---

test('PACKET_STATES is the frozen closed list', () => {
  assert.deepEqual(PACKET_STATES, ['awaiting-local', 'waiting-for-deploy', 'live-on-dev', 'already-decided', 'no-packet', 'unhandled']);
  assert.ok(Object.isFrozen(PACKET_STATES));
});

test('AC4b.1 decided: a verdict label wins over the packet', () => {
  const result = stateOf(packet({ deploy: ['target: dev, confirmed live'] }), ['accept:approved']);
  assert.equal(result.state, 'already-decided');
  assert.equal(result.verdict, 'approved');
  assert.equal(result.message, null);
  const changes = packetStateOf({ packet: { status: 'none' }, labels: ['demo:changes-requested'] });
  assert.equal(changes.state, 'already-decided');
  assert.equal(changes.verdict, 'changes-requested');
});

test('AC4b.1 re-acceptance: changes-requested beside a pending label falls through to the packet', () => {
  for (const changes of ['demo:changes-requested', 'accept:changes-requested']) {
    for (const pending of ['demo:pending', 'accept:pending']) {
      const name = `${changes}+${pending}`;
      assert.deepEqual(stateOf(packet({ deploy: ['target: dev, confirmed live'] }), [changes, pending]),
        { state: 'live-on-dev', recording: false, verdict: null, message: null }, name);
      assert.equal(packetStateOf({ packet: { status: 'none' }, labels: [changes, pending] }).state, 'no-packet', name);
    }
  }
});

test('AC4b.1 decided: changes-requested with no pending label → already-decided', () => {
  for (const changes of ['demo:changes-requested', 'accept:changes-requested']) {
    const result = stateOf(packet({ deploy: ['target: local'] }), [changes]);
    assert.equal(result.state, 'already-decided', changes);
    assert.equal(result.verdict, 'changes-requested', changes);
  }
});

test('AC4b.1 decided: approved beside a pending label → already-decided', () => {
  for (const approved of ['demo:approved', 'accept:approved']) {
    for (const pending of ['demo:pending', 'accept:pending']) {
      const result = stateOf(packet({ deploy: ['target: local'] }), [approved, pending]);
      assert.equal(result.state, 'already-decided', `${approved}+${pending}`);
      assert.equal(result.verdict, 'approved', `${approved}+${pending}`);
    }
  }
});

test('AC4b.1 no packet: status none → no-packet', () => {
  const result = packetStateOf({ packet: { status: 'none' }, labels: ['accept:pending'] });
  assert.deepEqual(result, { state: 'no-packet', recording: false, verdict: null, message: null });
});

test('AC4b.1 local: target: local → awaiting-local', () => {
  assert.equal(stateOf(packet({ deploy: ['target: local'] })).state, 'awaiting-local');
});

test('AC4b.1 local: no target token in Deploy status, or no section → awaiting-local', () => {
  assert.equal(stateOf(packet({ deploy: ['nothing stated'] })).state, 'awaiting-local');
  assert.equal(stateOf(packet({ deploy: null })).state, 'awaiting-local');
});

test('AC4b.1 waiting: target: dev with an unverified Test-guide link → waiting-for-deploy', () => {
  const body = packet({ deploy: ['target: dev'], testGuide: [`- Open: <https://dev.example.com/x>${UNVERIFIED_SUFFIX}`] });
  assert.equal(stateOf(body).state, 'waiting-for-deploy');
});

test('AC4b.1 waiting: the unverified suffix beats a confirmed-live deploy text', () => {
  const body = packet({ deploy: ['target: dev, confirmed live'], testGuide: [`- Open: <https://dev.example.com/x>${UNVERIFIED_SUFFIX}`] });
  assert.equal(stateOf(body).state, 'waiting-for-deploy');
});

test('AC4b.1 live: target: dev, confirmed live with no unverified link → live-on-dev', () => {
  const body = packet({ deploy: ['target: dev, confirmed live'], testGuide: ['- Open: <https://dev.example.com/x>'] });
  assert.equal(stateOf(body).state, 'live-on-dev');
});

test('AC4b.1 commands-only waiting: target: dev, not confirmed live with no links → waiting-for-deploy', () => {
  const body = packet({ deploy: ['target: dev, not confirmed live'], testGuide: ['- `npm run migrate`'] });
  assert.equal(stateOf(body).state, 'waiting-for-deploy');
});

test('AC4b.1 commands-only live: target: dev, confirmed live with no links → live-on-dev', () => {
  const body = packet({ deploy: ['target: dev, confirmed live'], testGuide: ['- `npm run migrate`'] });
  assert.equal(stateOf(body).state, 'live-on-dev');
});

test('AC4b.1 bare target: dev decides by whether a Test-guide link exists', () => {
  assert.equal(stateOf(packet({ deploy: ['target: dev'], testGuide: ['- Open: <https://dev.example.com/x>'] })).state, 'live-on-dev');
  assert.equal(stateOf(packet({ deploy: ['target: dev'], testGuide: ['- `npm run migrate`'] })).state, 'waiting-for-deploy');
});

test('AC4b.1 no recording: Recording "not recorded" or absent → recording: false alongside its state', () => {
  const none = stateOf(packet({ recording: ['not recorded'], deploy: ['target: local'] }));
  assert.equal(none.state, 'awaiting-local');
  assert.equal(none.recording, false);
  assert.equal(stateOf(packet({ recording: null })).recording, false);
  const recorded = stateOf(packet({ recording: ['- Walkthrough <https://dev.example.com/rec.gif>'] }));
  assert.equal(recorded.recording, true);
});

test('AC4b.2: unhandled state prints one line and stops', () => {
  const cases = [
    stateOf(packet({ deploy: ['target: staging'] })),
    packetStateOf({ packet: { status: 'unreadable', body: '<!-- acceptance-packet: v2 -->\nx' }, labels: [] }),
  ];
  for (const result of cases) {
    assert.equal(result.state, 'unhandled');
    assert.match(result.message, /^accept: unhandled packet state \(.+\) — stopping$/);
    assert.ok(!result.message.includes('\n'), result.message);
  }
});

test('a withheld Deploy status body is unhandled, not awaiting-local', () => {
  for (const deploy of [[WITHHELD_TEXT], [WITHHELD_TEXT, 'ref: aaa']]) {
    const result = stateOf(packet({ deploy }));
    assert.equal(result.state, 'unhandled', deploy.join(' / '));
    assert.match(result.message, /^accept: unhandled packet state \(.+\) — stopping$/);
    assert.ok(!result.message.includes('\n'));
  }
});

test('an unknown packet status is unhandled, never no-packet', () => {
  const result = packetStateOf({ packet: { status: 'weird' }, labels: [] });
  assert.equal(result.state, 'unhandled');
  assert.match(result.message, /^accept: unhandled packet state \(.+\) — stopping$/);
});

// --- refreshPacket ---

test('REFRESHABLE_FIELDS is the frozen closed list', () => {
  assert.deepEqual(REFRESHABLE_FIELDS, ['deploy-status', 'test-guide-base-url', 'recording-link']);
  assert.ok(Object.isFrozen(REFRESHABLE_FIELDS));
});

const SOURCE = Object.freeze({
  ref: 'bbb', text: 'target: dev', devBaseUrl: 'https://dev.example.com', recordingUrl: 'https://dev.example.com/rec',
});
const stalePacket = () => packet({
  recording: ['- Walkthrough: <https://old.example.com/old.gif>'],
  testGuide: ['- Open the page: <http://localhost:3000/x>', '- Then <http://localhost:3000/y?z=1>'],
  deploy: ['target: local', 'ref: aaa'],
});

test('AC2.3: stale fields refreshed in place', () => {
  const { body, refreshed, unverified } = refreshPacket(stalePacket(), SOURCE);
  assert.deepEqual(refreshed, [...REFRESHABLE_FIELDS]);
  assert.deepEqual(unverified, []);
  const deploy = sectionOf(body, 'Deploy status');
  assert.match(deploy, /^ref: bbb$/m);
  assert.match(deploy, /^target: dev$/m);
  assert.doesNotMatch(deploy, /ref: aaa|target: local/);
  const guide = sectionOf(body, 'Test guide');
  assert.match(guide, /<https:\/\/dev\.example\.com\/x>/);
  assert.match(guide, /<https:\/\/dev\.example\.com\/y\?z=1>/);
  assert.doesNotMatch(guide, /localhost/);
  assert.match(sectionOf(body, 'Recording'), /<https:\/\/dev\.example\.com\/rec>/);
  assert.doesNotMatch(body, /old\.example\.com/);
});

test('refresh keeps human edits', () => {
  const before = stalePacket();
  const { body } = refreshPacket(before, SOURCE);
  const head = (text) => text.slice(0, text.indexOf('### Recording'));
  const middle = (text) => text.slice(text.indexOf('### Tried to break'), text.indexOf('### Deploy status'));
  assert.equal(head(body), head(before));
  assert.equal(middle(body), middle(before));
  assert.match(head(body), /A human note added after posting\./);
  assert.match(middle(body), /Another human line\./);
});

test('refresh rewrites only the three fields: a URL outside Test guide keeps its origin', () => {
  const before = packet({
    whatChanged: ['- See <http://localhost:3000/notes>'],
    testGuide: ['- Open <http://localhost:3000/x>'],
    deploy: ['target: local', 'ref: aaa'],
  });
  const { body } = refreshPacket(before, SOURCE);
  assert.match(sectionOf(body, 'What changed'), /<http:\/\/localhost:3000\/notes>/);
});

test('a source without devBaseUrl or recordingUrl leaves those fields unverified', () => {
  const { body, refreshed, unverified } = refreshPacket(stalePacket(), { ref: 'bbb', text: 'target: dev' });
  assert.deepEqual(refreshed, ['deploy-status']);
  assert.deepEqual(unverified, ['test-guide-base-url', 'recording-link']);
  assert.match(sectionOf(body, 'Test guide'), /localhost:3000/);
});

test('a source line spelling its own ref is replaced by the one ref line', () => {
  const { body } = refreshPacket(stalePacket(), { ref: 'bbb', text: 'target: dev\nref: zzz' });
  const deploy = sectionOf(body, 'Deploy status');
  assert.equal(deploy.match(/^ref: /gm).length, 1);
  assert.match(deploy, /^ref: bbb$/m);
});

const waitingPacket = () => packet({
  whatChanged: [`- Kept as written: <http://localhost:3000/a>${UNVERIFIED_SUFFIX}`],
  testGuide: [`- Open: <https://dev.example.com/x>${UNVERIFIED_SUFFIX}`, `- Then: <https://dev.example.com/y>${UNVERIFIED_SUFFIX}`],
  deploy: ['target: dev, not confirmed live', 'ref: aaa'],
});

test('a refresh to a confirmed-live deploy drops the unverified suffix and round-trips to live-on-dev', () => {
  const before = waitingPacket();
  assert.equal(stateOf(before).state, 'waiting-for-deploy');
  const { body } = refreshPacket(before, { ref: 'bbb', text: 'target: dev, confirmed live' });
  assert.doesNotMatch(sectionOf(body, 'Test guide'), /link unverified/);
  assert.match(sectionOf(body, 'Test guide'), /^- Open: <https:\/\/dev\.example\.com\/x>$/m);
  assert.equal(sectionOf(body, 'What changed'), sectionOf(before, 'What changed'));
  assert.equal(stateOf(body).state, 'live-on-dev');
});

test('a refresh to a deploy still not confirmed live keeps the unverified suffix', () => {
  const { body } = refreshPacket(waitingPacket(), { ref: 'bbb', text: 'target: dev, not confirmed live' });
  assert.equal(sectionOf(body, 'Test guide').split('link unverified').length - 1, 2);
  assert.equal(stateOf(body).state, 'waiting-for-deploy');
});

test('equal refs → unchanged, both lists empty', () => {
  const before = stalePacket();
  const result = refreshPacket(before, { ...SOURCE, ref: 'aaa' });
  assert.deepEqual(result, { body: before, refreshed: [], unverified: [] });
});

test('no deploy source → unchanged and unverified', () => {
  const before = stalePacket();
  const result = refreshPacket(before, null);
  assert.equal(result.body, before);
  assert.deepEqual(result.refreshed, []);
  assert.deepEqual(result.unverified, [...REFRESHABLE_FIELDS]);
});

test('pre-change packet without a ref line is unverified, never stale', () => {
  const before = packet({ deploy: ['target: local'] });
  const result = refreshPacket(before, { ref: 'bbb', text: 'target: dev' });
  assert.equal(result.body, before);
  assert.deepEqual(result.refreshed, []);
  assert.deepEqual(result.unverified, [...REFRESHABLE_FIELDS]);
});

test('refresh preserves CRLF line endings outside and inside the refreshed section', () => {
  const before = stalePacket().replace(/\n/g, '\r\n');
  const { body } = refreshPacket(before, SOURCE);
  assert.ok(!/[^\r]\n/.test(body), 'a bare LF was introduced');
  assert.match(body, /ref: bbb\r\n/);
});

// --- verdictLabelEdits ---

test('AC4a.1: demo:pending only, approve → accept:approved added, demo:pending removed', () => {
  assert.deepEqual(verdictLabelEdits(['demo:pending'], 'approved'), { add: ['accept:approved'], remove: ['demo:pending'] });
});

test('absent labels are never removed', () => {
  assert.deepEqual(verdictLabelEdits([], 'changes-requested'), { add: ['accept:changes-requested'], remove: [] });
  assert.deepEqual(
    verdictLabelEdits(['accept:pending', 'accept:approved-batch'], 'approved', { batch: true }),
    { add: ['accept:approved', 'accept:approved-batch'], remove: ['accept:pending'] },
  );
});

test('a batch approve removes the demo:approved-batch twin and keeps accept:approved-batch', () => {
  assert.deepEqual(
    verdictLabelEdits(['accept:pending', 'accept:approved-batch', 'demo:approved-batch'], 'approved', { batch: true }),
    { add: ['accept:approved', 'accept:approved-batch'], remove: ['accept:pending', 'demo:approved-batch'] },
  );
  assert.deepEqual(verdictLabelEdits(['demo:approved-batch'], 'approved', { batch: true }).remove, ['demo:approved-batch']);
});

test('approve removes every prior pending, changes-requested, demo:approved twin and (single) batch marker present', () => {
  const all = [
    'demo:pending', 'accept:pending', 'demo:changes-requested', 'accept:changes-requested',
    'demo:approved', 'accept:approved', 'demo:approved-batch', 'accept:approved-batch', 'ready',
  ];
  assert.deepEqual(verdictLabelEdits(all, 'approved'), {
    add: ['accept:approved'],
    remove: ['demo:pending', 'accept:pending', 'demo:changes-requested', 'accept:changes-requested', 'demo:approved', 'demo:approved-batch', 'accept:approved-batch'],
  });
  assert.deepEqual(verdictLabelEdits(all, 'changes-requested'), {
    add: ['accept:changes-requested'],
    remove: ['demo:pending', 'accept:pending', 'demo:approved', 'accept:approved', 'demo:approved-batch', 'accept:approved-batch', 'demo:changes-requested'],
  });
});

test('skip edits nothing', () => {
  assert.deepEqual(verdictLabelEdits(['demo:pending', 'accept:approved'], 'skip'), { add: [], remove: [] });
});

test('an unknown verdict throws', () => {
  assert.throws(() => verdictLabelEdits([], 'maybe'), TypeError);
});
