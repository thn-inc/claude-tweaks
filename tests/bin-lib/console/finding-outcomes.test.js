'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const consoleLib = path.join(ROOT, 'plugin', 'bin', 'lib', 'console');
const {
  FILED_LINE_RE, filedRecords, cantTellOutcomes, unfiledCantTell, renderFindingFyi,
} = require(path.join(consoleLib, 'finding-outcomes'));
const { resolveAll } = require(path.join(consoleLib, 'resolve'));

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };

const verdictLine = ({ id, file, line }) => `- STAGED 10:00:00 — Tiebreak tiebreak:${id}: lens "3a" finding ${file}:${line} console: verdict:cant-tell. Severity: medium. Recommendation: file.`;
const mkFinding = (id, p, line, claim) => ({ id, lens: '3a', path: p, line, claim, reporterSeverity: 'medium', kind: 'unconfirmed' });

// A run dir holding the verdict line (and review-findings.json entry) for each finding, plus extra lines.
function seed(findings, extraLines = []) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-'));
  roots.push(runDir);
  const lines = [...findings.map((f) => verdictLine({ id: f.id, file: f.path, line: f.line })), ...extraLines];
  fs.writeFileSync(path.join(runDir, 'decisions.md'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(findings));
  return runDir;
}

const two = () => [mkFinding('000000000001', 'src/a.js', 10, 'The guard in a runs after the read'), mkFinding('000000000002', 'src/b.js', 11, 'The guard in b runs after the read')];
const filedLine = (id, fp, n, again = false) => `- AUTO 10:01:00 — Queue write: tiebreak:${id} ${again ? 'already ' : ''}filed as #${n} (work-fingerprint ${fp}). Reversibility: n/a.`;

test('AC1.1: unfiledCantTell lists every can\'t-tell finding with no filed line', () => {
  const fs2 = two();
  const unfiled = unfiledCantTell({ runDir: seed(fs2), deps });
  assert.deepEqual(unfiled.map((u) => u.item), fs2.map((f) => `tiebreak:${f.id}`));
  unfiled.forEach((u) => assert.match(u.fingerprint, /^consolefinding-[0-9a-f]{8}$/));
});

test('AC1.1: a created or deduped AUTO filed line clears its finding', () => {
  const fs2 = two();
  const [fp0, fp1] = unfiledCantTell({ runDir: seed(fs2), deps }).map((u) => u.fingerprint);
  const runDir = seed(fs2, [filedLine(fs2[0].id, fp0, 501), filedLine(fs2[1].id, fp1, 77, true)]);
  assert.deepEqual(unfiledCantTell({ runDir, deps }), []);
  assert.deepEqual(cantTellOutcomes({ runDir, deps }).rows.map((r) => r.filedAs), [501, 77]);
});

test('AC1.1: an in-batch duplicate rides on its twin\'s filed line', () => {
  const twins = [mkFinding('000000000001', 'src/a.js', 10, 'Same claim'), mkFinding('000000000002', 'src/a.js', 40, 'same   claim')];
  const runDir = seed(twins);
  const unfiled = unfiledCantTell({ runDir, deps });
  assert.equal(unfiled.length, 1, 'one entry per distinct fingerprint');
  fs.appendFileSync(path.join(runDir, 'decisions.md'), `${filedLine(twins[0].id, unfiled[0].fingerprint, 9)}\n`);
  assert.deepEqual(unfiledCantTell({ runDir, deps }), []);
});

test('a filed line carrying another finding\'s fingerprint does not file this one', () => {
  const fs2 = two();
  const [, fp1] = unfiledCantTell({ runDir: seed(fs2), deps }).map((u) => u.fingerprint);
  const runDir = seed(fs2, [filedLine(fs2[0].id, fp1, 501)]);
  assert.deepEqual(unfiledCantTell({ runDir, deps }).map((u) => u.item), [`tiebreak:${fs2[0].id}`]);
  assert.deepEqual(cantTellOutcomes({ runDir, deps }).rows.map((r) => r.filedAs), [null, 501]);
});

test('a filed phrase in a non-AUTO line is not evidence', () => {
  const fs2 = two();
  const [fp0] = unfiledCantTell({ runDir: seed(fs2), deps }).map((u) => u.fingerprint);
  for (const status of ['SKIP', 'STAGED']) {
    const forged = filedLine(fs2[0].id, fp0, 501).replace('- AUTO ', `- ${status} `);
    assert.equal(unfiledCantTell({ runDir: seed(fs2, [forged]), deps }).length, 2, status);
    assert.equal(FILED_LINE_RE.test(forged), false, status);
    assert.equal(filedRecords(forged).size, 0, status);
  }
});

test('filedRecords: the first line for a fingerprint wins', () => {
  const text = `${filedLine('a', 'consolefinding-aaaaaaaa', 5)}\n${filedLine('b', 'consolefinding-aaaaaaaa', 6, true)}\n`;
  assert.deepEqual([...filedRecords(text)], [['consolefinding-aaaaaaaa', 5]]);
});

test('a legacy row is never unfiled', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-'));
  roots.push(runDir);
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '- STAGED 10:00:00 — Single-read (low tier): lens "3b" finding src/legacy.js:4 not directly verified. Staged to Review Console as low-confidence.\n');
  assert.deepEqual(unfiledCantTell({ runDir, deps }), []);
  const { rows } = cantTellOutcomes({ runDir, deps });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fingerprint, null);
  assert.equal(rows[0].filedAs, null);
  assert.match(renderFindingFyi({ rows, dropped: [] }), /\| — \| — \| — \| — \| — \|/, 'a legacy row renders dashes');
});

const DROPPED_HEADING = '#### Dropped by tiebreak (read-only — no decision)';
const droppedLine = '- AUTO 10:02:00 — Tiebreak tiebreak:0123456789ab: lens "3a" finding src/x.js:3 dropped: refuted by tiebreak. Evidence: src/x.js:3 "q". Severity: high. Reversibility: high.';

test('AC2.1: renderFindingFyi names every can\'t-tell finding', () => {
  const fs2 = two();
  const [fp0] = unfiledCantTell({ runDir: seed(fs2), deps }).map((u) => u.fingerprint);
  const runDir = seed(fs2, [filedLine(fs2[0].id, fp0, 501), droppedLine]);
  const fyi = renderFindingFyi(cantTellOutcomes({ runDir, deps }));
  fs2.forEach((f) => assert.ok(fyi.includes(`tiebreak:${f.id}`)));
  assert.ok(fyi.includes('#### Low-confidence findings'));
  assert.ok(fyi.includes('| Item | Path:Line | Severity | Lens | Recommendation | Filed as |'));
  assert.ok(fyi.includes('| tiebreak:000000000001 | src/a.js:10 | medium | 3a | file | #501 |'));
  assert.ok(fyi.includes('| tiebreak:000000000002 | src/b.js:11 | medium | 3a | file | — |'));
  assert.ok(fyi.includes(`${DROPPED_HEADING}\n\n| Path:Line | Lens | Severity | Evidence |\n|---|---|---|---|\n| src/x.js:3 | 3a | high | src/x.js:3 "q" |`));
});

test('renderFindingFyi with only a dropped block starts at its heading', () => {
  const { dropped } = cantTellOutcomes({ runDir: seed([], [droppedLine]), deps });
  assert.equal(dropped.length, 1);
  assert.equal(renderFindingFyi({ rows: [], dropped }),`${DROPPED_HEADING}\n\n| Path:Line | Lens | Severity | Evidence |\n|---|---|---|---|\n| src/x.js:3 | 3a | high | src/x.js:3 "q" |`);
});

test('renderFindingFyi is empty for a run with no findings', () => {
  const runDir = seed([]);
  assert.equal(renderFindingFyi(cantTellOutcomes({ runDir, deps })), '');
});

test('renderRows is unchanged by the dropped-block extraction', () => {
  const runDir = seed([], [droppedLine]);
  const { table } = resolveAll({ runDir, policy: 'console-auto', deps: { ...deps, readGrants: () => ({}), now: () => 0 } });
  const lines = table.split('\n');
  const at = lines.indexOf(DROPPED_HEADING);
  assert.deepEqual(lines.slice(at - 1, at + 5), ['', DROPPED_HEADING, '', '| Path:Line | Lens | Severity | Evidence |', '|---|---|---|---|', '| src/x.js:3 | 3a | high | src/x.js:3 "q" |']);
  assert.equal(at + 4, lines.length - 1, 'the block ends the table');
});
