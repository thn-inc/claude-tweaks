'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CHECK_HEADER, PROPOSED_ACTION, classifyCheckResult, checkBody, checkReleaseNoteLine,
  bodySha, labelNames, scanRecords, summaryLine,
} = require('../../../plugin/bin/lib/release-note-repair/detect');
const F = require('./fixtures');

const gapsStderr = (...gaps) => `${CHECK_HEADER}\n${gaps.map((g) => `  - ${g}`).join('\n')}\n`;

test('classifyCheckResult: exit 0 is conforming', () => {
  assert.equal(classifyCheckResult({ code: 0, stderr: '' }).verdict, 'conforming');
});

test('classifyCheckResult: exactly one Release Note gap (missing or empty) is release-note-only', () => {
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note') }).verdict, 'release-note-only');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('empty section: ## Release Note') }).verdict, 'release-note-only');
});

test('classifyCheckResult: any other gap, alone or alongside the Release Note one, is other-gaps', () => {
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note', 'missing section: ## Acceptance Criteria') }).verdict, 'other-gaps');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Acceptance Criteria') }).verdict, 'other-gaps');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note', 'unresolved placeholder marker: TBD') }).verdict, 'other-gaps');
});

test('classifyCheckResult: an exit other than 0/4, or an unparseable exit-4 stderr, is a scan error, never a match', () => {
  for (const code of [2, 5, 1, null, undefined]) {
    assert.equal(classifyCheckResult({ code, stderr: gapsStderr('missing section: ## Release Note') }).verdict, 'scan-error', `code ${code}`);
  }
  assert.equal(classifyCheckResult({ code: 4, stderr: '  - missing section: ## Release Note\n' }).verdict, 'scan-error', 'no header');
  assert.equal(classifyCheckResult({ code: 4, stderr: `${CHECK_HEADER}\n` }).verdict, 'scan-error', 'header, zero gaps');
});

test('checkBody runs the real compose-record.js --check contract', () => {
  assert.equal(checkBody(F.MISSING_RN).verdict, 'release-note-only');
  assert.equal(checkBody(F.EMPTY_RN).verdict, 'release-note-only');
  assert.equal(checkBody(F.MISSING_RN_AND_AC).verdict, 'other-gaps');
  assert.equal(checkBody(F.CONFORMING).verdict, 'conforming');
  assert.equal(checkBody(F.MISSING_RN_WITH_TBD).verdict, 'other-gaps');
});

test('checkBody: a checker that exits 2 or throws is a scan error', () => {
  const two = checkBody(F.MISSING_RN, { checkCli: () => ({ code: 2, stderr: 'compose-record.js: could not read body file\n' }) });
  assert.equal(two.verdict, 'scan-error');
  assert.equal(two.code, 2);
  const threw = checkBody(F.MISSING_RN, { checkCli: () => { throw new Error('boom'); } });
  assert.equal(threw.verdict, 'scan-error');
  assert.equal(threw.code, null);
  assert.match(threw.stderr, /boom/);
});

test('checkReleaseNoteLine: a plain verb-first sentence passes; one trailing newline is stripped', () => {
  assert.deepEqual(checkReleaseNoteLine('Made widget lookups faster.\n'), { ok: true, line: 'Made widget lookups faster.', violations: [] });
  assert.equal(checkReleaseNoteLine('Improved internal test coverage for the release composer').ok, true);
  assert.equal(checkReleaseNoteLine('Added and/or removed nothing.').ok, true, '"and/or." is not path-shaped');
  assert.equal(checkReleaseNoteLine('Fixed: capitalized words are not a conventional prefix').ok, true);
});

test('checkReleaseNoteLine: every Deliverable 2 bound is checked', () => {
  const v = (s) => checkReleaseNoteLine(s).violations;
  assert.deepEqual(v(''), ['empty']);
  assert.deepEqual(v('First line.\nSecond line.'), ['multi-line']);
  assert.deepEqual(v('Fixed the crash from #2573.'), ['record-ref']);
  assert.deepEqual(v('Updated plugin/bin/compose-record.js to be faster.'), ['path']);
  assert.deepEqual(v('Added a `--check` flag.'), ['backtick']);
  assert.deepEqual(v('fix(tidy)!: repair release notes'), ['conventional-prefix']);
  assert.deepEqual(v('feat: repair release notes'), ['conventional-prefix']);
});

test('bodySha is a stable sha256 hex digest', () => {
  assert.match(bodySha('x'), /^[0-9a-f]{64}$/);
  assert.equal(bodySha(F.MISSING_RN), bodySha(`${F.MISSING_RN}`));
  assert.notEqual(bodySha(F.MISSING_RN), bodySha(`${F.MISSING_RN} `));
});

test('labelNames accepts gh objects and MCP/plain strings', () => {
  assert.deepEqual(labelNames([{ name: 'ready' }, { name: 'auto:build' }]), ['ready', 'auto:build']);
  assert.deepEqual(labelNames(['ready', 'risk:low']), ['ready', 'risk:low']);
  assert.deepEqual(labelNames(undefined), []);
});

const gh = (number, body, extra = {}) => ({
  number, title: `Record ${number}`, state: 'OPEN', labels: [{ name: 'ready' }], body, facets: { stage: 'ready' }, ...extra,
});

test('scanRecords (github-issues): matches only ready, open, Release-Note-only, non-excluded records', () => {
  const pending = { body: `<!-- needs-decision: tidy -->\n## Decision needed\n**Proposed:** ${PROPOSED_ACTION}\n` };
  const resolved = { body: `${pending.body}**Resolved:** keep\n` };
  const records = [
    gh(1, F.MISSING_RN),
    gh(2, F.MISSING_RN_AND_AC),
    gh(3, F.EMPTY_RN),
    gh(4, F.CONFORMING),
    gh(5, F.MISSING_RN, { facets: { stage: null } }),
    gh(6, F.MISSING_RN, { labels: [{ name: 'ready' }, { name: 'needs:decision' }] }),
    gh(7, F.MISSING_RN, { comments: [pending] }),
    gh(8, F.MISSING_RN, { comments: [resolved] }),
    gh(9, F.MISSING_RN, { state: 'CLOSED' }),
    gh(10, F.MISSING_RN_WITH_TBD),
  ];
  const out = scanRecords(records, { driver: 'github-issues' });
  assert.deepEqual(out.map((c) => c.ref), ['#1', '#3', '#8']);
  assert.ok(out.every((c) => c.verdict === 'release-note-only'));
  assert.equal(out[0].sha, bodySha(F.MISSING_RN));
  assert.equal(out[0].deliverables, '1. Cache the widget lookup.');
  assert.equal(out[1].gap, 'empty section: ## Release Note');
});

test('scanRecords: a record with no body field, or a checker failure, is a scan-error candidate', () => {
  const noBody = { number: 11, title: 'x', state: 'OPEN', labels: [{ name: 'ready' }], facets: { stage: 'ready' } };
  const [c] = scanRecords([noBody], { driver: 'github-issues' });
  assert.equal(c.verdict, 'scan-error');
  assert.equal(c.sha, null);
  const [d] = scanRecords([gh(12, F.MISSING_RN)], { driver: 'github-issues', checkCli: () => ({ code: 5, stderr: '' }) });
  assert.equal(d.verdict, 'scan-error');
  assert.equal(d.code, 5);
});

test('scanRecords (local-files): uses path/id, excludes needsDefinition and closed', () => {
  const local = (id, body, facets = {}) => ({ path: `specs/${id}-x.md`, id, title: `L${id}`, body, facets: { stage: 'ready', needsDefinition: false, closed: false, ...facets } });
  const out = scanRecords([
    local(20, F.MISSING_RN),
    local(21, F.MISSING_RN, { needsDefinition: true }),
    local(22, F.MISSING_RN, { closed: true }),
  ], { driver: 'local-files' });
  assert.deepEqual(out.map((c) => [c.ref, c.id]), [['specs/20-x.md', 20]]);
});

test('summaryLine: one Template-A-ready line, or null when nothing matched', () => {
  assert.equal(summaryLine([], '/tmp/c.json'), null);
  const line = summaryLine([{ verdict: 'release-note-only' }, { verdict: 'scan-error' }], '/tmp/c.json');
  assert.equal(line, '—\t[release-note] 1 ready record(s) missing only a Release Note, 1 scan error(s) — Fill Release Note (candidates: /tmp/c.json)');
});
