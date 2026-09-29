'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RepairError, applyReleaseNote, onlyReleaseNoteAdded, prepareRepair, verifyWritten,
} = require('../../../plugin/bin/lib/release-note-repair/apply');
const { bodySha, checkBody } = require('../../../plugin/bin/lib/release-note-repair/detect');
const F = require('./fixtures');

test('applyReleaseNote inserts the section right after Acceptance Criteria, before the next heading', () => {
  assert.deepEqual(applyReleaseNote(F.MISSING_RN, F.LINE), { body: F.REPAIRED, mode: 'inserted' });
});

test('applyReleaseNote fills an empty section in place', () => {
  assert.deepEqual(applyReleaseNote(F.EMPTY_RN, F.LINE), { body: F.REPAIRED, mode: 'filled' });
});

test('applyReleaseNote appends when Acceptance Criteria is last (footer kept above) and passes the gate', () => {
  const out = applyReleaseNote(F.AC_LAST_WITH_FOOTER, F.LINE);
  assert.equal(out.body, `${F.AC_LAST_WITH_FOOTER}\n## Release Note\n\n${F.LINE}\n`);
  assert.equal(checkBody(out.body).verdict, 'conforming');
});

test('applyReleaseNote terminates a body with no trailing newline before appending', () => {
  const noEol = F.join(F.CS, F.DEL, F.AC).trimEnd();
  assert.equal(applyReleaseNote(noEol, F.LINE).body, `${noEol}\n\n## Release Note\n\n${F.LINE}\n`);
});

test('applyReleaseNote keeps a CRLF body CRLF', () => {
  const crlf = F.MISSING_RN.replace(/\n/g, '\r\n');
  const out = applyReleaseNote(crlf, F.LINE);
  assert.equal(out.body, F.REPAIRED.replace(/\n/g, '\r\n'));
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.equal(onlyReleaseNoteAdded(crlf, out.body, F.LINE), true);
});

test('applyReleaseNote never fills a Release Note heading inside the verbatim Original request section', () => {
  const body = `${F.join(F.CS, F.DEL, F.AC)}\n## Original request\n\nSee thread.\n\n## Release Note\n`;
  assert.equal(checkBody(body).verdict, 'release-note-only', 'the gate reads the empty original-request heading');
  const out = applyReleaseNote(body, F.LINE);
  assert.equal(out.mode, 'inserted');
  assert.equal(out.body, `${F.join(F.CS, F.DEL, F.AC)}\n## Release Note\n\n${F.LINE}\n\n## Original request\n\nSee thread.\n\n## Release Note\n`);
  assert.equal(checkBody(out.body).verdict, 'conforming');
});

test('applyReleaseNote throws RepairError with no line-anchored AC heading, or a non-empty Release Note', () => {
  assert.throws(() => applyReleaseNote(F.MIDLINE_AC, F.LINE), RepairError);
  assert.throws(() => applyReleaseNote(F.MISSING_RN_AND_AC, F.LINE), RepairError);
  assert.throws(() => applyReleaseNote(F.CONFORMING, F.LINE), RepairError);
});

test('applyReleaseNote skips a `## `-looking line inside a closed fenced code block when finding the section boundary', () => {
  const out = applyReleaseNote(F.MISSING_RN_WITH_FENCE, F.LINE);
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN_WITH_FENCE, out.body, F.LINE), true);
  const fenceClose = out.body.indexOf('```\n', out.body.indexOf('## Example heading'));
  const rnAt = out.body.indexOf('## Release Note');
  assert.ok(rnAt > fenceClose, 'Release Note must land after the fence closes, never inside it');
});

test('applyReleaseNote fills the real empty Release Note heading, never a fenced look-alike ahead of it', () => {
  const fencedLookalike = '```markdown\n## Release Note\n\nAn example note.\n```\n';
  const body = [F.EMPTY_RN.split('## Release Note\n')[0], fencedLookalike, '\n## Release Note\n', F.EMPTY_RN.split('## Release Note\n')[1]].join('');
  const out = applyReleaseNote(body, F.LINE);
  assert.equal(out.mode, 'filled');
  assert.equal(onlyReleaseNoteAdded(body, out.body, F.LINE), true);
  assert.ok(out.body.includes(fencedLookalike), 'the fenced example stays byte-identical');
});

test('applyReleaseNote refuses an unterminated fenced code block preceding the insert point', () => {
  assert.throws(() => applyReleaseNote(F.UNTERMINATED_FENCE_BODY, F.LINE), RepairError);
});

test('applyReleaseNote never places the note inside a list-indented fence whose content is not itself reindented', () => {
  const out = applyReleaseNote(F.MISSING_RN_WITH_INDENTED_FENCE, F.LINE);
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN_WITH_INDENTED_FENCE, out.body, F.LINE), true);
  const fenceClose = out.body.indexOf('```\n', out.body.indexOf('## Example'));
  const rnAt = out.body.indexOf('## Release Note');
  assert.ok(rnAt > fenceClose, 'Release Note must land after the indented fence closes, never inside it');
});

test('applyReleaseNote never mistakes a shorter nested fence for the close of a longer enclosing one', () => {
  const out = applyReleaseNote(F.MISSING_RN_WITH_NESTED_FENCE, F.LINE);
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN_WITH_NESTED_FENCE, out.body, F.LINE), true);
  const outerClose = out.body.indexOf('````\n', out.body.indexOf('## Example'));
  const rnAt = out.body.indexOf('## Release Note');
  assert.ok(rnAt > outerClose, 'Release Note must land after the outer fence closes, never inside the nested block');
});

test('onlyReleaseNoteAdded accepts exactly the section and rejects any other change', () => {
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED, F.LINE), true);
  assert.equal(onlyReleaseNoteAdded(F.EMPTY_RN, F.REPAIRED, F.LINE), true);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED.replace('Use a Map.', 'Use a Set.'), F.LINE), false);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED, 'A different line.'), false);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.MISSING_RN.replace('## Technical', `${F.LINE}\n\n## Technical`), F.LINE), false, 'line with no heading above it');
});

test('prepareRepair: happy path returns the repaired body', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: `${F.LINE}\n` });
  assert.deepEqual(out, { outcome: 'ready', body: F.REPAIRED, mode: 'inserted', line: F.LINE });
});

test('prepareRepair: a body edited since the scan is stale, never repaired', () => {
  const out = prepareRepair({ liveBody: `${F.MISSING_RN}edit\n`, expectSha: bodySha(F.MISSING_RN), line: F.LINE });
  assert.equal(out.outcome, 'stale');
  assert.match(out.reason, /changed since the scan/);
});

test('prepareRepair: a line failing a bound is reported, not weakened', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: 'fix: see #12' });
  assert.deepEqual(out, { outcome: 'bounds', violations: ['record-ref', 'conventional-prefix'] });
});

test('prepareRepair: a live body that is no longer Release-Note-only is stale; a mid-line AC is a failure', () => {
  assert.equal(prepareRepair({ liveBody: F.MISSING_RN_WITH_TBD, expectSha: bodySha(F.MISSING_RN_WITH_TBD), line: F.LINE }).outcome, 'stale');
  const midline = prepareRepair({ liveBody: F.MIDLINE_AC, expectSha: bodySha(F.MIDLINE_AC), line: F.LINE });
  assert.equal(midline.outcome, 'failed');
  assert.match(midline.reason, /Acceptance Criteria/);
});

test('prepareRepair: a checker scan error on the live body is a failure, not stale', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: F.LINE, checkCli: () => ({ code: 2, stderr: 'x' }) });
  assert.equal(out.outcome, 'failed');
});

test('verifyWritten: identical labels and a conforming body carrying the line verify clean', () => {
  const before = { body: F.MISSING_RN, labels: [{ name: 'ready' }, { name: 'auto:build' }] };
  const after = { body: F.REPAIRED, labels: [{ name: 'auto:build' }, { name: 'ready' }] };
  assert.deepEqual(verifyWritten({ before, after, line: F.LINE }), []);
});

test('verifyWritten: a changed label set, a missing line, or a failing body is reported', () => {
  const before = { body: F.MISSING_RN, labels: [{ name: 'ready' }, { name: 'auto:build' }] };
  assert.match(verifyWritten({ before, after: { body: F.REPAIRED, labels: [{ name: 'ready' }] }, line: F.LINE })[0], /label set changed/);
  assert.match(verifyWritten({ before, after: { body: F.REPAIRED, labels: before.labels }, line: 'Other line.' })[0], /does not carry the composed line/);
  assert.ok(verifyWritten({ before, after: { body: F.MISSING_RN, labels: before.labels }, line: F.LINE }).length >= 1);
  assert.deepEqual(verifyWritten({ before, after: {}, line: F.LINE }), ['the post-write read carries no body']);
});

test('verifyWritten: a body that drifted beyond the Release Note section (e.g. Technical Approach rewritten) is reported', () => {
  const before = { body: F.MISSING_RN, labels: [{ name: 'ready' }] };
  const drifted = F.REPAIRED.replace('Use a Map.', 'Use a Set.');
  assert.match(checkBody(drifted).verdict, /conforming/);
  const problems = verifyWritten({ before, after: { body: drifted, labels: before.labels }, line: F.LINE });
  assert.ok(problems.some((p) => /more than the Release Note section changed/.test(p)), problems.join('; '));
});
