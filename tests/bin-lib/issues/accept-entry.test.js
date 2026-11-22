'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PACKET_MARKER, WITHHELD_TEXT, NOT_RUN_REASON } = require('../../../plugin/bin/lib/wrap-up/packet-contract');
const { renderPacket } = require('../../../plugin/bin/lib/wrap-up/packet-render');
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

// A packet body exactly as packet-render.js writes it, from facts.
const fact = (id, status, extra = {}) => ({ id, kind: id.split(':', 1)[0], status, source: 'fixture', ...extra });
const rendered = (facts, options) => renderPacket(
  { schemaVersion: 1, record: 4613, partial: [], surface: null, allowedHosts: ['http://localhost:3000'], refused: [], facts },
  { schemaVersion: 1, claims: [] },
  options,
).markdown;

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

test('a rendered not-run recording, for every reason, reads as no recording', () => {
  for (const reason of Object.values(NOT_RUN_REASON)) {
    for (const extra of [{}, { failure: 'ffmpeg exited 1', captions: ['sign-in'] }]) {
      const body = rendered([fact('recording:walkthrough', 'not-run', { reason, ...extra })]);
      const result = stateOf(body);
      assert.equal(result.recording, false, `${reason} ${JSON.stringify(extra)}\n${sectionOf(body, 'Recording')}`);
    }
  }
  const recorded = rendered([fact('recording:walkthrough', 'passed', {
    text: 'Walkthrough', url_or_path: '.claude-tweaks/r/walkthrough.gif', exposure: 'local-only',
  })]);
  assert.equal(stateOf(recorded).recording, true);
  // One made beside one that failed is still a recording.
  const mixed = rendered([
    fact('recording:a', 'passed', { text: 'Walkthrough', url_or_path: '.claude-tweaks/r/a.gif', exposure: 'local-only' }),
    fact('recording:b', 'not-run', { reason: NOT_RUN_REASON.ENCODER_FAILED }),
  ]);
  assert.equal(stateOf(mixed).recording, true);
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
  for (const deploy of [[WITHHELD_TEXT], [WITHHELD_TEXT, 'ref: aaa1111']]) {
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
  ref: 'bbb2222', text: 'target: dev', devBaseUrl: 'https://dev.example.com', recordingUrl: 'https://dev.example.com/rec',
});
const stalePacket = () => packet({
  recording: ['- Walkthrough: <https://old.example.com/old.gif>'],
  testGuide: ['- Open the page: <http://localhost:3000/x>', '- Then <http://localhost:3000/y?z=1>'],
  deploy: ['target: local', 'ref: aaa1111'],
});

test('AC2.3: stale fields refreshed in place', () => {
  const { body, refreshed, unverified } = refreshPacket(stalePacket(), SOURCE);
  assert.deepEqual(refreshed, [...REFRESHABLE_FIELDS]);
  assert.deepEqual(unverified, []);
  const deploy = sectionOf(body, 'Deploy status');
  assert.match(deploy, /^ref: bbb2222$/m);
  assert.match(deploy, /^target: dev$/m);
  assert.doesNotMatch(deploy, /ref: aaa1111|target: local/);
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
    deploy: ['target: local', 'ref: aaa1111'],
  });
  const { body } = refreshPacket(before, SOURCE);
  assert.match(sectionOf(body, 'What changed'), /<http:\/\/localhost:3000\/notes>/);
});

test('a source without devBaseUrl or recordingUrl leaves those fields unverified', () => {
  const { body, refreshed, unverified } = refreshPacket(stalePacket(), { ref: 'bbb2222', text: 'target: dev' });
  assert.deepEqual(refreshed, ['deploy-status']);
  assert.deepEqual(unverified, ['test-guide-base-url', 'recording-link']);
  assert.match(sectionOf(body, 'Test guide'), /localhost:3000/);
});

test('a source line spelling its own ref is replaced by the one ref line', () => {
  const { body } = refreshPacket(stalePacket(), { ref: 'bbb2222', text: 'target: dev\nref: zzz' });
  const deploy = sectionOf(body, 'Deploy status');
  assert.equal(deploy.match(/^ref: /gm).length, 1);
  assert.match(deploy, /^ref: bbb2222$/m);
});

const waitingPacket = () => packet({
  whatChanged: [`- Kept as written: <http://localhost:3000/a>${UNVERIFIED_SUFFIX}`],
  testGuide: [`- Open: <https://dev.example.com/x>${UNVERIFIED_SUFFIX}`, `- Then: <https://dev.example.com/y>${UNVERIFIED_SUFFIX}`],
  deploy: ['target: dev, not confirmed live', 'ref: aaa1111'],
});

test('a refresh to a confirmed-live deploy drops the unverified suffix and round-trips to live-on-dev', () => {
  const before = waitingPacket();
  assert.equal(stateOf(before).state, 'waiting-for-deploy');
  const { body } = refreshPacket(before, { ref: 'bbb2222', text: 'target: dev, confirmed live' });
  assert.doesNotMatch(sectionOf(body, 'Test guide'), /link unverified/);
  assert.match(sectionOf(body, 'Test guide'), /^- Open: <https:\/\/dev\.example\.com\/x>$/m);
  assert.equal(sectionOf(body, 'What changed'), sectionOf(before, 'What changed'));
  assert.equal(stateOf(body).state, 'live-on-dev');
});

test('a refresh to a deploy still not confirmed live keeps the unverified suffix', () => {
  const { body } = refreshPacket(waitingPacket(), { ref: 'bbb2222', text: 'target: dev, not confirmed live' });
  assert.equal(sectionOf(body, 'Test guide').split('link unverified').length - 1, 2);
  assert.equal(stateOf(body).state, 'waiting-for-deploy');
});

test('equal refs → unchanged, both lists empty', () => {
  const before = stalePacket();
  const result = refreshPacket(before, { ...SOURCE, ref: 'aaa1111' });
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
  const result = refreshPacket(before, { ref: 'bbb2222', text: 'target: dev' });
  assert.equal(result.body, before);
  assert.deepEqual(result.refreshed, []);
  assert.deepEqual(result.unverified, [...REFRESHABLE_FIELDS]);
});

test('a ref line outside the producer grammar is no stored ref: unverified, never stale', () => {
  for (const line of ['ref: `aaa1111`', 'ref: AAA1111', `ref: ${WITHHELD_TEXT}`, 'ref: aaa', `ref: ${'a'.repeat(65)}`]) {
    const before = packet({ deploy: ['target: dev, confirmed live', line] });
    const result = refreshPacket(before, { ref: 'bbb2222', text: 'target: dev, confirmed live' });
    assert.equal(result.body, before, line);
    assert.deepEqual(result.refreshed, [], line);
    assert.deepEqual(result.unverified, [...REFRESHABLE_FIELDS], line);
  }
});

test('a stored short sha and the full sha it prefixes are the same commit', () => {
  const full = `aaa1111${'0'.repeat(33)}`;
  for (const [stored, ref] of [['aaa1111', full], [full, 'aaa1111']]) {
    const before = packet({ deploy: ['target: dev, confirmed live', `ref: ${stored}`] });
    assert.deepEqual(refreshPacket(before, { ref, text: 'target: dev, confirmed live' }), { body: before, refreshed: [], unverified: [] }, stored);
  }
});

test('two different shas of different lengths are different commits', () => {
  const before = packet({ deploy: ['target: dev, not confirmed live', 'ref: aaa1111'] });
  const result = refreshPacket(before, { ref: `bbb2222${'0'.repeat(33)}`, text: 'target: dev, confirmed live' });
  assert.deepEqual(result.refreshed, ['deploy-status']);
  assert.match(result.body, new RegExp(`^ref: bbb2222${'0'.repeat(33)}$`, 'm'));
});

test('refresh preserves CRLF line endings outside and inside the refreshed section', () => {
  const before = stalePacket().replace(/\n/g, '\r\n');
  const { body } = refreshPacket(before, SOURCE);
  assert.ok(!/[^\r]\n/.test(body), 'a bare LF was introduced');
  assert.match(body, /ref: bbb2222\r\n/);
});

const devDeploy = (ref) => fact('deploy:status', 'passed', { target: 'dev', live: false, text: 'target: dev, not confirmed live', ref });
const FRESH = Object.freeze({ ref: 'bbb2222', text: 'target: dev, confirmed live' });

test('a refresh keeps the poster footer and text a human appended below the packet byte-identical', () => {
  const human = '\n\nA reviewer note added below the packet.\nSecond line.\n';
  const before = `${rendered([devDeploy('aaa1111')], { poster: 'the bot' })}${human}`;
  const tail = before.slice(before.indexOf('\n---\n'));
  assert.match(tail, /_Posted by the bot\. Resolve with `\/claude-tweaks:accept`\._/);
  const { body, refreshed } = refreshPacket(before, FRESH);
  assert.deepEqual(refreshed, ['deploy-status']);
  assert.equal(body.slice(body.indexOf('\n---\n')), tail);
  assert.equal(body.slice(0, body.indexOf('### Deploy status')), before.slice(0, before.indexOf('### Deploy status')));
  assert.deepEqual(sectionOf(body, 'Deploy status').split('\n---\n')[0].split('\n').filter(Boolean), ['target: dev, confirmed live', 'ref: bbb2222']);
});

test('a packet in the earlier adjacent layout (no blank line before ref:) still reads its stored ref', () => {
  const human = '\n\nA reviewer note.\n';
  const current = `${rendered([devDeploy('aaa1111')], { poster: 'the bot' })}${human}`;
  assert.ok(current.includes('target: dev, not confirmed live\n\nref: aaa1111\n'));
  const adjacent = current.replace('target: dev, not confirmed live\n\nref: aaa1111', 'target: dev, not confirmed live\nref: aaa1111');
  assert.notEqual(adjacent, current);
  assert.deepEqual(refreshPacket(adjacent, { ...FRESH, ref: 'aaa1111' }), { body: adjacent, refreshed: [], unverified: [] });
  const { body, refreshed } = refreshPacket(adjacent, FRESH);
  assert.deepEqual(refreshed, ['deploy-status']);
  // Refreshed into the current layout, with the footer and the human tail untouched.
  assert.ok(body.includes('### Deploy status\ntarget: dev, confirmed live\n\nref: bbb2222\n'), body);
  assert.equal(body.slice(body.indexOf('\n---\n')), adjacent.slice(adjacent.indexOf('\n---\n')));
});

test('a refresh with no poster keeps text a human appended after the ref line', () => {
  const human = '\n\nA reviewer note added below the packet.\n';
  const packetText = rendered([devDeploy('aaa1111')]);
  const { body } = refreshPacket(`${packetText}${human}`, FRESH);
  assert.ok(body.endsWith(`ref: bbb2222${human}`), body.slice(-120));
  assert.ok(!body.includes('aaa1111'));
});

test('the Deploy status reader stops at the poster footer', () => {
  const withheld = fact('deploy:status', 'passed', { target: 'dev', text: 'target: dev token=hunter2', ref: 'aaa1111' });
  const body = rendered([withheld], { poster: 'the bot' });
  assert.match(sectionOf(body, 'Deploy status'), new RegExp(`^${WITHHELD_TEXT.replace(/[()]/g, '\\$&')}$`, 'm'));
  assert.equal(stateOf(body).state, 'unhandled');
  // Text below the footer is not deploy content: "confirmed live" there does not make a bare dev target live.
  const bare = `${rendered([fact('deploy:status', 'passed', { target: 'dev', ref: 'aaa1111' })], { poster: 'the bot' })}\n\nconfirmed live, per a human\n`;
  assert.equal(stateOf(bare).state, 'waiting-for-deploy');
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

// --- refreshPacket: hostile source values (review findings) ---

test('a non-http(s) devBaseUrl or recordingUrl is refused, not written as `null` or a foreign scheme', () => {
  assert.throws(() => refreshPacket(stalePacket(), { ...SOURCE, devBaseUrl: 'data:text/plain,x' }), TypeError);
  assert.throws(() => refreshPacket(stalePacket(), { ...SOURCE, recordingUrl: 'javascript:alert(1)' }), TypeError);
});

test('a `$` pattern in a source URL is data, not a replacement token', () => {
  const { body } = refreshPacket(stalePacket(), { ...SOURCE, recordingUrl: 'https://dev.example.com/r?a=$&' });
  assert.match(sectionOf(body, 'Recording'), /<https:\/\/dev\.example\.com\/r\?a=\$&>/);
  assert.doesNotMatch(body, /old\.example\.com/);
});

test('deploy text that ends the section or carries a credential is refused', () => {
  assert.throws(() => refreshPacket(stalePacket(), { ...SOURCE, text: 'target: dev\n---\nfoo' }), TypeError);
  assert.throws(() => refreshPacket(stalePacket(), { ...SOURCE, text: 'target: dev\n### Next' }), TypeError);
  assert.throws(() => refreshPacket(stalePacket(), { ...SOURCE, text: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789' }), TypeError);
});

test('characterization: an unparked packet with a stale ref still refreshes its Deploy status', () => {
  const body = packet({ deploy: ['target: dev, confirmed live', '', 'ref: deadbeef'] });
  const result = refreshPacket(body, { ref: '1234567abc', text: 'target: dev, confirmed live' });
  assert.deepEqual(result.refreshed, ['deploy-status']);
  assert.match(result.body, /^ref: 1234567abc$/m);
  assert.doesNotMatch(result.body, /deadbeef/);
});

test('a packet parked for local acceptance is left alone by a refresh, its Deploy status unverified', () => {
  const body = packet({
    deploy: ['target: local', 'reason: awaiting-local-acceptance', 'park-head: abc1234', '', 'ref: deadbeef'],
  });
  const result = refreshPacket(body, { ref: '1234567abc', text: 'target: dev, confirmed live' });
  assert.equal(result.body, body);
  assert.deepEqual(result.refreshed, []);
  assert.deepEqual(result.unverified, [...REFRESHABLE_FIELDS]);
});

test('a target: local packet without the park reason still refreshes', () => {
  const body = packet({ deploy: ['target: local', 'park-head: abc1234', '', 'ref: deadbeef'] });
  assert.deepEqual(refreshPacket(body, { ref: '1234567abc', text: 'target: dev, confirmed live' }).refreshed, ['deploy-status']);
});
