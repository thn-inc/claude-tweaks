'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findingId, parseTiebreakReply, resolveTiebreak, VERDICTS, SEVERITIES,
  FINDINGS_ARTIFACT, buildFindingsArtifact, readFindingsArtifact, checkTiebreakCoverage, checkRunTiebreakCoverage,
} = require('../../plugin/bin/lib/tiebreak');
const { formatEntry } = require('../../plugin/bin/lib/log-decision/append');

const WELL_FORMED = [
  'Verdict: confirmed',
  'Evidence: plugin/bin/foo.js:42 `const x = readSync(fd);`',
  'Severity: High',
  'Recommendation: file — the read is unguarded',
  'STATUS: DONE',
].join('\n');

test('findingId is stable and claim-sensitive (AC7.1)', () => {
  const base = { lens: 'correctness', path: 'plugin/bin/foo.js', line: 42, claim: 'reads fd without a guard' };
  const id = findingId(base);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(findingId({ ...base }), id);
  assert.equal(findingId({ ...base, claim: '  reads fd   without\na guard ' }), id);
  assert.notEqual(findingId({ ...base, claim: 'writes fd without a guard' }), id);
  assert.notEqual(findingId({ ...base, lens: 'security' }), id);
  assert.notEqual(findingId({ ...base, line: 43 }), id);
});

test('exports the verdict and severity sets', () => {
  assert.deepEqual(VERDICTS, ['confirmed', 'refuted', 'cant-tell']);
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low', 'info']);
});

test('parses a well-formed reply (AC1.1)', () => {
  assert.deepEqual(parseTiebreakReply(WELL_FORMED), {
    parse: 'ok',
    verdict: 'confirmed',
    evidence: { path: 'plugin/bin/foo.js', line: 42, quote: 'const x = readSync(fd);' },
    severity: 'high',
    recommendation: 'file',
    recommendationReason: 'the read is unguarded',
    status: 'DONE',
  });
});

test('parses reason separators, quote wrappers, and out-of-set severity', () => {
  const r = parseTiebreakReply([
    'verdict: REFUTED',
    'evidence: a/b.js:7 "return null;"',
    'severity: catastrophic',
    'recommendation: drop: guarded two lines up',
    'status: done',
  ].join('\n'));
  assert.equal(r.parse, 'ok');
  assert.equal(r.verdict, 'refuted');
  assert.deepEqual(r.evidence, { path: 'a/b.js', line: 7, quote: 'return null;' });
  assert.equal(r.severity, null);
  assert.equal(r.recommendation, 'drop');
  assert.equal(r.recommendationReason, 'guarded two lines up');
  assert.equal(r.status, 'DONE');
  const dash = parseTiebreakReply('Verdict: cant-tell\nRecommendation: drop - no evidence\nSTATUS: DONE');
  assert.equal(dash.recommendationReason, 'no evidence');
  assert.equal(dash.evidence, null);
});

test('could-not-parse: empty reply (AC6.1)', () => {
  for (const text of ['', '   \n\n', null, undefined]) {
    const r = parseTiebreakReply(text);
    assert.equal(r.parse, 'could-not-parse');
    assert.equal(r.verdict, null);
  }
});

test('could-not-parse: no Verdict line (AC6.1)', () => {
  const r = parseTiebreakReply('Evidence: a.js:1 x\nSeverity: low\nSTATUS: DONE');
  assert.equal(r.parse, 'could-not-parse');
  assert.equal(r.verdict, null);
});

test('could-not-parse: Verdict value outside the set (AC6.1)', () => {
  for (const v of ['maybe', 'confirmed-ish', '']) {
    const r = parseTiebreakReply(`Verdict: ${v}\nSTATUS: DONE`);
    assert.equal(r.parse, 'could-not-parse');
    assert.equal(r.verdict, null);
  }
});

test('could-not-parse: no trailing STATUS line (AC6.1)', () => {
  const missing = parseTiebreakReply('Verdict: confirmed\nSeverity: low');
  assert.equal(missing.parse, 'could-not-parse');
  assert.equal(missing.verdict, null);
  const narrated = parseTiebreakReply(`${WELL_FORMED}\nHope that helps.`);
  assert.equal(narrated.parse, 'could-not-parse');
  assert.equal(narrated.verdict, null);
});

test('non-DONE status parses ok (AC6.1)', () => {
  const r = parseTiebreakReply('Verdict: cant-tell\nSTATUS: BLOCKED');
  assert.equal(r.parse, 'ok');
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.verdict, 'cant-tell');
});

test('empty quote is not usable evidence: no quote at all (AC1.1)', () => {
  const r = parseTiebreakReply('Verdict: confirmed\nEvidence: a.js:1\nSTATUS: DONE');
  assert.equal(r.parse, 'ok');
  assert.equal(r.evidence, null);
});

test('empty quote is not usable evidence: empty wrapper (AC1.1)', () => {
  for (const quote of ['""', '``']) {
    const r = parseTiebreakReply(`Verdict: confirmed\nEvidence: a.js:1 ${quote}\nSTATUS: DONE`);
    assert.equal(r.parse, 'ok');
    assert.equal(r.evidence, null);
  }
});

test('evidence line below 1 is not usable evidence (AC1.1)', () => {
  const r = parseTiebreakReply('Verdict: confirmed\nEvidence: a.js:0 `return null;`\nSTATUS: DONE');
  assert.equal(r.parse, 'ok');
  assert.equal(r.evidence, null);
});

test('disagreeing Verdict lines are could-not-parse', () => {
  const r = parseTiebreakReply('Verdict: confirmed\nVerdict: refuted\nSTATUS: DONE');
  assert.equal(r.parse, 'could-not-parse');
  assert.equal(r.verdict, null);
});

test('agreeing duplicate Verdict lines stay ok', () => {
  const r = parseTiebreakReply('Verdict: confirmed\nVerdict: confirmed\nSTATUS: DONE');
  assert.equal(r.parse, 'ok');
  assert.equal(r.verdict, 'confirmed');
});

// ---- resolveTiebreak (#3945 Task 2) ----

const FILE_LINES = Array.from({ length: 40 }, (_, i) => `// filler line ${i + 1}`);
FILE_LINES[19] = 'const x = readSync(fd);'; // line 20
const reader = () => FILE_LINES.join('\n');
const NOW = new Date(2026, 9, 22, 9, 5, 7);
const FINDING = { lens: '3a', path: 'plugin/bin/foo.js', line: 20, claim: 'unguarded read', reporterSeverity: 'high', kind: 'unconfirmed' };

function reply({ verdict = 'confirmed', evidence = 'plugin/bin/foo.js:20 `const x = readSync(fd);`', severity, rec, status = 'DONE' } = {}) {
  return [
    `Verdict: ${verdict}`,
    evidence === null ? null : `Evidence: ${evidence}`,
    severity ? `Severity: ${severity}` : null,
    rec ? `Recommendation: ${rec}` : null,
    `STATUS: ${status}`,
  ].filter((l) => l !== null).join('\n');
}
const resolve = (finding, text, extra = {}) => resolveTiebreak(finding, text, { readFile: reader, now: NOW, ...extra });
const isCantTell = (r) => r.outcome === 'digest' || r.outcome === 'console';

test('confirmed with verified evidence → confirmed at the lower severity (AC2.1)', () => {
  const r = resolve(FINDING, reply({ severity: 'medium' }));
  assert.equal(r.outcome, 'confirmed');
  assert.equal(r.severity, 'medium');
  assert.equal(r.parse, 'ok');
  assert.equal(r.id, findingId(FINDING));
  assert.deepEqual(r.evidence, { path: 'plugin/bin/foo.js', line: 20, quote: 'const x = readSync(fd);' });
  assert.equal(r.listInConsole, false);
  assert.equal(r.logLine, `AUTO 09:05:07 — Reproduction: lens "3a" finding plugin/bin/foo.js:20 confirmed by tiebreak:${r.id}. Confirmed. Reversibility: high.`);
  assert.equal(resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ severity: 'critical' })).severity, 'low');
});

test('refuted with verified evidence → drop at every severity; listInConsole only at high/critical (AC3.1)', () => {
  for (const sev of SEVERITIES) {
    const r = resolve({ ...FINDING, reporterSeverity: sev }, reply({ verdict: 'refuted', severity: sev }));
    assert.equal(r.outcome, 'drop', sev);
    assert.equal(r.severity, sev);
    assert.equal(r.listInConsole, sev === 'high' || sev === 'critical', sev);
    assert.match(r.logLine, /^AUTO 09:05:07 — Tiebreak tiebreak:[0-9a-f]{12}: lens "3a" finding plugin\/bin\/foo\.js:20 dropped: refuted by tiebreak\. Evidence: plugin\/bin\/foo\.js:20 "const x = readSync\(fd\);"\. Severity: \w+\. Reversibility: high\.$/);
  }
});

test('cant-tell paths: verdict cant-tell (AC4.1)', () => {
  const r = resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null }));
  assert.ok(isCantTell(r));
  assert.equal(r.reason, 'verdict:cant-tell');
  assert.equal(r.parse, 'ok');
});

test('cant-tell paths: confirmed or refuted with no Evidence (AC4.1)', () => {
  for (const verdict of ['confirmed', 'refuted']) {
    const r = resolve(FINDING, reply({ verdict, evidence: null }));
    assert.ok(isCantTell(r), verdict);
    assert.equal(r.reason, 'no-evidence');
  }
});

test('cant-tell paths: malformed reply (AC4.1)', () => {
  for (const text of ['', 'I think it is real.', 'Verdict: confirmed\nEvidence: plugin/bin/foo.js:20 `const x = readSync(fd);`']) {
    const r = resolve(FINDING, text);
    assert.ok(isCantTell(r), text);
    assert.equal(r.reason, 'could-not-parse');
    assert.equal(r.evidence, null);
  }
});

test('cant-tell paths: a STATUS other than DONE (AC4.1)', () => {
  for (const status of ['BLOCKED', 'NEEDS_CONTEXT', 'DONE_WITH_CONCERNS']) {
    for (const verdict of ['confirmed', 'refuted']) {
      const r = resolve(FINDING, reply({ verdict, status }));
      assert.ok(isCantTell(r), `${verdict}/${status}`);
      assert.equal(r.reason, `status:${status}`);
    }
  }
});

test("can't-tell threshold: low gives digest (AC5.1)", () => {
  const r = resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null, severity: 'info' }));
  assert.equal(r.outcome, 'digest');
  assert.equal(r.listInConsole, false);
  assert.match(r.logLine, /^AUTO 09:05:07 — Tiebreak tiebreak:[0-9a-f]{12}: lens "3a" finding plugin\/bin\/foo\.js:20 digested: verdict:cant-tell\. Severity: low\. Reversibility: high\.$/);
});

test("can't-tell threshold: medium gives console carrying the recommendation (AC5.1)", () => {
  const r = resolve({ ...FINDING, reporterSeverity: 'medium' }, reply({ verdict: 'cant-tell', evidence: null, severity: 'low', rec: 'file — unclear' }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'medium');
  assert.equal(r.recommendation, 'file');
  assert.match(r.logLine, /^STAGED 09:05:07 — Tiebreak tiebreak:[0-9a-f]{12}: lens "3a" finding plugin\/bin\/foo\.js:20 console: verdict:cant-tell\. Severity: medium\. Recommendation: file\. Reversibility: high\.$/);
});

test("can't-tell threshold: console without a recommendation says none (AC5.1)", () => {
  const r = resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.recommendation, null);
  assert.match(r.logLine, /Recommendation: none\. Reversibility: high\.$/);
});

test("can't-tell threshold: the higher of reporter and tiebreak severity wins (AC5.1)", () => {
  const r = resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null, severity: 'high' }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'high');
});

test("can't-tell threshold: absent tiebreak severity uses the reporter's (AC5.1)", () => {
  const low = resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(low.outcome, 'digest');
  assert.equal(low.severity, 'low');
  const high = resolve({ ...FINDING, reporterSeverity: 'high' }, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(high.outcome, 'console');
  assert.equal(high.severity, 'high');
});

test("can't-tell threshold: neither severity known gives medium and console (AC5.1)", () => {
  const r = resolve({ ...FINDING, reporterSeverity: undefined }, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'medium');
});

test("can't-tell threshold: a contested finding uses its higher position (AC5.1)", () => {
  const contested = { ...FINDING, kind: 'contested', reporterSeverity: 'low', positions: [{ severity: 'low' }, { severity: 'critical' }, { severity: 'bogus' }] };
  const r = resolve(contested, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'critical');
});

test("can't-tell threshold: an unknown severity string counts as unknown (AC5.1)", () => {
  const r = resolve({ ...FINDING, reporterSeverity: 'catastrophic' }, reply({ verdict: 'cant-tell', evidence: null, severity: 'catastrophic' }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'medium');
});

test("confirmed with the tiebreak severity absent uses the reporter's (AC5.1)", () => {
  assert.equal(resolve({ ...FINDING, reporterSeverity: 'low' }, reply()).severity, 'low');
});

test('confirmed with neither severity known gives medium (AC5.1)', () => {
  assert.equal(resolve({ ...FINDING, reporterSeverity: null }, reply()).severity, 'medium');
});

test('drop with a low tiebreak and high reporter is listed in the console (AC5.1)', () => {
  const r = resolve({ ...FINDING, reporterSeverity: 'high' }, reply({ verdict: 'refuted', severity: 'low' }));
  assert.equal(r.outcome, 'drop');
  assert.equal(r.severity, 'high');
  assert.equal(r.listInConsole, true);
});

test('a contradicting Recommendation is carried and never changes the outcome (AC5.1)', () => {
  const r = resolve(FINDING, reply({ verdict: 'refuted', rec: 'file — still real' }));
  assert.equal(r.outcome, 'drop');
  assert.equal(r.recommendation, 'file');
});

test('parse signals are distinguishable (AC6.1)', () => {
  const unparsed = resolve(FINDING, 'garbage');
  const legit = resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(unparsed.parse, 'could-not-parse');
  assert.equal(legit.parse, 'ok');
  assert.equal(unparsed.reason, 'could-not-parse');
  assert.notEqual(unparsed.reason, legit.reason);
  const status = resolve(FINDING, reply({ status: 'BLOCKED' }));
  assert.equal(status.parse, 'ok');
  assert.equal(status.reason, 'status:BLOCKED');
  const noEv = resolve(FINDING, reply({ evidence: null }));
  assert.equal(noEv.parse, 'ok');
  assert.equal(noEv.reason, 'no-evidence');
  assert.notEqual(status.reason, unparsed.reason);
  assert.notEqual(noEv.reason, unparsed.reason);
});

test('evidence verification: a fabricated quote is unverified (AC10.1)', () => {
  for (const verdict of ['confirmed', 'refuted']) {
    const r = resolve(FINDING, reply({ verdict, evidence: 'plugin/bin/foo.js:20 `const y = writeSync(fd);`' }));
    assert.ok(isCantTell(r), verdict);
    assert.equal(r.reason, 'evidence-unverified');
    assert.equal(r.evidence, null);
  }
});

test('evidence verification: a quote in the file but outside ±5 lines is unverified (AC10.1)', () => {
  const near = { ...FINDING, line: 25 }; // quote on line 20, 5 away
  for (const verdict of ['confirmed', 'refuted']) {
    assert.equal(resolve({ ...FINDING, line: 26 }, reply({ verdict })).reason, 'evidence-unverified', verdict);
    assert.equal(resolve({ ...FINDING, line: 27 }, reply({ verdict })).reason, 'evidence-unverified', verdict);
    assert.notEqual(resolve(near, reply({ verdict })).reason, 'evidence-unverified', verdict);
  }
});

test('evidence verification: a whitespace-only difference verifies (AC10.1)', () => {
  const ok = resolve(FINDING, reply({ evidence: 'plugin/bin/foo.js:20 `const    x   =\treadSync(fd);`' }));
  assert.equal(ok.outcome, 'confirmed');
  const notWhitespaceOnly = resolve(FINDING, reply({ evidence: 'plugin/bin/foo.js:20 `const x = readSync( fd );`' }));
  assert.equal(notWhitespaceOnly.reason, 'evidence-unverified');
});

test('evidence verification: a quote spanning adjacent lines verifies (AC10.1)', () => {
  const r = resolve(FINDING, reply({ evidence: 'plugin/bin/foo.js:20 `const x = readSync(fd); // filler line 21`' }));
  assert.equal(r.outcome, 'confirmed');
});

test('evidence verification: no reader → confirmed and refuted both give cant-tell (AC10.1)', () => {
  for (const verdict of ['confirmed', 'refuted']) {
    const r = resolveTiebreak(FINDING, reply({ verdict }), { now: NOW });
    assert.ok(isCantTell(r), verdict);
    assert.equal(r.reason, 'evidence-unverified');
  }
});

test('evidence verification: a throwing reader or a cited line outside the file is unverified (AC10.1)', () => {
  const boom = resolve(FINDING, reply(), { readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(boom.reason, 'evidence-unverified');
  const past = resolve(FINDING, reply({ evidence: 'plugin/bin/foo.js:99 `const x = readSync(fd);`' }));
  assert.equal(past.reason, 'evidence-unverified');
});

test('evidence verification: an evidence path mismatch is unverified (AC10.1)', () => {
  const r = resolve(FINDING, reply({ evidence: 'plugin/bin/bar.js:20 `const x = readSync(fd);`' }));
  assert.ok(isCantTell(r));
  assert.equal(r.reason, 'evidence-path-mismatch');
});

test('line forms: a range uses its first line, an absent line is cant-tell (AC9.1)', () => {
  const range = resolve({ ...FINDING, line: '20-24' }, reply());
  assert.equal(range.outcome, 'confirmed');
  assert.match(range.logLine, /finding plugin\/bin\/foo\.js:20 confirmed/);
  assert.equal(resolve({ ...FINDING, line: '20' }, reply()).outcome, 'confirmed');
  for (const line of [undefined, null, '', 'abc', 0, '-3']) {
    const r = resolve({ ...FINDING, line }, reply());
    assert.ok(isCantTell(r), String(line));
    assert.equal(r.reason, 'no-line');
  }
});

test('no non-confirmed line contains the word "Confirmed" (AC2.1)', () => {
  const lines = [...FILE_LINES];
  lines[19] = 'const Confirmed = true;';
  const rd = () => lines.join('\n');
  const evidence = 'plugin/bin/foo.js:20 `const Confirmed = true;`';
  const results = [
    resolve(FINDING, reply({ verdict: 'refuted', evidence }), { readFile: rd }),
    resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null })),
    resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null })),
    resolve({ ...FINDING, lens: 'Confirmed' }, reply({ status: 'BLOCKED' })),
  ];
  assert.deepEqual(results.map((r) => r.outcome), ['drop', 'digest', 'console', 'console']);
  for (const r of results) assert.doesNotMatch(r.logLine, /\bConfirmed\b/, r.outcome);
  assert.match(results[0].logLine, /const confirmed = true;/);
});

test('every verdict line carries tiebreak:{id} (AC7.1)', () => {
  const results = [
    resolve(FINDING, reply()),
    resolve(FINDING, reply({ verdict: 'refuted' })),
    resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null })),
    resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null })),
    resolve(FINDING, 'garbage'),
    resolve({ ...FINDING, line: undefined }, reply()),
  ];
  for (const r of results) {
    assert.ok(r.logLine.includes(`tiebreak:${r.id}`), r.logLine);
  }
  assert.equal(results[0].id, findingId(FINDING));
});

// ---- findings artifact and verdict coverage (#3945 Task 3) ----

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tiebreak-cov-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

const RAW = [
  { lens: 'correctness', path: 'plugin/bin/a.js', line: 10, claim: 'reads fd without a guard', reporterSeverity: 'high', kind: 'unconfirmed' },
  { lens: 'security', path: 'plugin/bin/b.js', line: 7, claim: 'shell string built from input', reporterSeverity: 'medium', kind: 'contested' },
];

function writeFindings(dir, findings) {
  fs.writeFileSync(path.join(dir, FINDINGS_ARTIFACT), JSON.stringify(findings));
}

function verdictFor(f) {
  return `- AUTO 10:00:00 — Tiebreak tiebreak:${findingId(f)}: lens "${f.lens}" finding ${f.path}:${f.line} digested: x.`;
}

test('artifact round-trips (AC7.1)', (t) => {
  const dir = tmpDir(t);
  const built = buildFindingsArtifact(RAW);
  assert.equal(FINDINGS_ARTIFACT, 'review-findings.json');
  assert.deepEqual(built.map((f) => f.id), RAW.map(findingId));
  assert.deepEqual(Object.keys(built[0]).sort(), ['claim', 'id', 'kind', 'lens', 'line', 'path', 'reporterSeverity']);
  writeFindings(dir, built);
  assert.deepEqual(readFindingsArtifact(dir), { present: true, valid: true, findings: built });
  assert.throws(() => buildFindingsArtifact([{ ...RAW[0], lens: undefined }]), TypeError);
  assert.throws(() => buildFindingsArtifact([{ ...RAW[0], path: '' }]), TypeError);
  assert.throws(() => buildFindingsArtifact([{ ...RAW[0], claim: undefined }]), TypeError);
  assert.throws(() => buildFindingsArtifact([{ ...RAW[0], kind: 'other' }]), TypeError);
});

test('kind vocabulary is unconfirmed | contested; single-read is rejected (#3945)', () => {
  assert.equal(buildFindingsArtifact([{ ...RAW[0], kind: 'unconfirmed' }])[0].kind, 'unconfirmed');
  assert.equal(buildFindingsArtifact([{ ...RAW[0], kind: 'contested' }])[0].kind, 'contested');
  assert.throws(() => buildFindingsArtifact([{ ...RAW[0], kind: 'single-read' }]), TypeError);
});

test('coverage returns exactly the uncovered ids (AC7.1)', (t) => {
  const dir = tmpDir(t);
  const built = buildFindingsArtifact(RAW);
  writeFindings(dir, built);
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${verdictFor(RAW[0])}\n`);
  assert.deepEqual(checkTiebreakCoverage(dir), { artifactPresent: true, artifactValid: true, missing: [built[1].id] });
  fs.rmSync(path.join(dir, 'decisions.md'));
  assert.deepEqual(checkTiebreakCoverage(dir).missing, built.map((f) => f.id));
});

test('empty missing when every id has a line (AC7.1)', (t) => {
  const dir = tmpDir(t);
  writeFindings(dir, buildFindingsArtifact(RAW));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${RAW.map(verdictFor).join('\n')}\n`);
  assert.deepEqual(checkTiebreakCoverage(dir), { artifactPresent: true, artifactValid: true, missing: [] });
});

test('same lens+path:line, different claims → two ids, two lines needed (AC7.1)', (t) => {
  const dir = tmpDir(t);
  const a = { ...RAW[0], claim: 'reads fd without a guard' };
  const b = { ...RAW[0], claim: 'never closes the fd' };
  assert.notEqual(findingId(a), findingId(b));
  writeFindings(dir, buildFindingsArtifact([a, b]));
  // The #3772 matcher (console/resolve.js findingKey) keys on lens + first
  // path:line, so it gives both findings the same key — coarser than the id.
  const keyOf = (l) => `${/\blens\s+"?([A-Za-z0-9_-]+)"?/i.exec(l)[1]}|${/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/.exec(l).slice(1, 3).join(':')}`;
  assert.equal(keyOf(verdictFor(a)), keyOf(verdictFor(b)));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${verdictFor(a)}\n`);
  assert.deepEqual(checkTiebreakCoverage(dir).missing, [findingId(b)]);
  fs.appendFileSync(path.join(dir, 'decisions.md'), `${verdictFor(b)}\n`);
  assert.deepEqual(checkTiebreakCoverage(dir).missing, []);
});

test('malformed artifact → artifactValid false (AC8.1)', (t) => {
  const good = buildFindingsArtifact(RAW);
  const bad = {
    'invalid JSON': '{not json',
    'non-array': JSON.stringify({ findings: good }),
    'entry missing id': JSON.stringify([good[0], { lens: 'x', path: 'p', line: 1 }]),
    'entry missing lens': JSON.stringify([{ id: 'abc', path: 'p' }]),
    'entry missing path': JSON.stringify([{ id: 'abc', lens: 'x' }]),
    'non-object entry': JSON.stringify([null]),
  };
  for (const [label, body] of Object.entries(bad)) {
    const dir = tmpDir(t);
    fs.writeFileSync(path.join(dir, FINDINGS_ARTIFACT), body);
    assert.deepEqual(readFindingsArtifact(dir), { present: true, valid: false, findings: null }, label);
    assert.deepEqual(checkTiebreakCoverage(dir), { artifactPresent: true, artifactValid: false, missing: [] }, label);
  }
  // Present but unreadable (a directory in the file's place) is also invalid, never absent.
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, FINDINGS_ARTIFACT));
  assert.deepEqual(readFindingsArtifact(dir), { present: true, valid: false, findings: null });
});

test('absent artifact → artifactPresent false, nothing missing', (t) => {
  const dir = tmpDir(t);
  assert.deepEqual(readFindingsArtifact(dir), { present: false, valid: true, findings: null });
  assert.deepEqual(checkTiebreakCoverage(dir), { artifactPresent: false, artifactValid: true, missing: [] });
});

test('run-level aggregation includes spec-* subdirs', (t) => {
  const run = tmpDir(t);
  const built = buildFindingsArtifact(RAW);
  writeFindings(run, [built[0]]);
  fs.mkdirSync(path.join(run, 'spec-3945'));
  writeFindings(path.join(run, 'spec-3945'), [built[1]]);
  fs.mkdirSync(path.join(run, 'spec-4000'));
  assert.deepEqual(checkRunTiebreakCoverage(run, ['spec-3945', 'spec-4000']), {
    artifactPresent: true, artifactValid: true, missing: [built[0].id, `spec-3945/${built[1].id}`],
  });
  fs.writeFileSync(path.join(run, 'spec-3945', 'decisions.md'), `${verdictFor(RAW[1])}\n`);
  assert.deepEqual(checkRunTiebreakCoverage(run, ['spec-3945']).missing, [built[0].id]);
  fs.writeFileSync(path.join(run, 'spec-4000', FINDINGS_ARTIFACT), 'garbage');
  const r = checkRunTiebreakCoverage(run, ['spec-3945', 'spec-4000']);
  assert.equal(r.artifactValid, false);
  assert.equal(r.artifactPresent, true);
  assert.deepEqual(checkRunTiebreakCoverage(tmpDir(t), ['spec-1']), { artifactPresent: false, artifactValid: true, missing: [] });
});

// ---- final-review fixes (#3945) ----

const WHITESPACE_QUOTES = ['" "', '` `', '"\t"'];

test('a whitespace-only quote is not usable evidence (F1)', () => {
  for (const quote of WHITESPACE_QUOTES) {
    const r = parseTiebreakReply(`Verdict: refuted\nEvidence: plugin/bin/foo.js:20 ${quote}\nSTATUS: DONE`);
    assert.equal(r.parse, 'ok', JSON.stringify(quote));
    assert.equal(r.evidence, null, JSON.stringify(quote));
  }
});

test('a whitespace-only quote never confirms or drops (F1)', () => {
  for (const quote of WHITESPACE_QUOTES) {
    for (const verdict of ['confirmed', 'refuted']) {
      const r = resolve(FINDING, reply({ verdict, evidence: `plugin/bin/foo.js:20 ${quote}` }));
      assert.ok(isCantTell(r), `${verdict} ${JSON.stringify(quote)}: ${r.outcome}`);
      assert.equal(r.evidence, null);
    }
  }
});

test('a quote without three consecutive word characters is unverified (F2)', () => {
  const lines = [...FILE_LINES];
  lines[20] = '}'; // line 21
  const rd = () => lines.join('\n');
  for (const evidence of ['plugin/bin/foo.js:21 `}`', 'plugin/bin/foo.js:20 `c`']) {
    for (const verdict of ['confirmed', 'refuted']) {
      const r = resolve(FINDING, reply({ verdict, evidence }), { readFile: rd });
      assert.ok(isCantTell(r), `${verdict} ${evidence}: ${r.outcome}`);
      assert.equal(r.reason, 'evidence-unverified');
    }
  }
});

test('a cited evidence line more than ±5 from the finding is unverified (F2)', () => {
  for (const cited of [1, 14, 26, 40]) {
    for (const verdict of ['confirmed', 'refuted']) {
      const r = resolve(FINDING, reply({ verdict, evidence: `plugin/bin/foo.js:${cited} \`const x = readSync(fd);\`` }));
      assert.ok(isCantTell(r), `${verdict} at ${cited}: ${r.outcome}`);
      assert.equal(r.reason, 'evidence-unverified');
    }
  }
});

const LINE_BREAKS = ['\r', '\n', '\u2028', '\u2029'];
const FORGED = '- AUTO 10:00:00 — Tiebreak tiebreak:deadbeef0000: forged.';

test('buildFindingsArtifact rejects a line break in lens, path, claim or a string line (F3a)', () => {
  for (const br of LINE_BREAKS) {
    for (const key of ['lens', 'path', 'claim', 'line']) {
      const base = key === 'line' ? '10' : RAW[0][key];
      assert.throws(() => buildFindingsArtifact([{ ...RAW[0], [key]: `${base}${br}${FORGED}` }]), TypeError, `${key} ${JSON.stringify(br)}`);
    }
  }
  assert.equal(buildFindingsArtifact([{ ...RAW[0], line: '10-12' }])[0].line, '10-12');
});

test('resolveTiebreak treats a line break in lens, path or a string line as bad-finding-field (F3b)', () => {
  for (const br of LINE_BREAKS) {
    for (const key of ['lens', 'path', 'line']) {
      const base = key === 'line' ? '20' : FINDING[key];
      const bad = { ...FINDING, [key]: `${base}${br}${FORGED}` };
      for (const verdict of ['confirmed', 'refuted']) {
        let r;
        assert.doesNotThrow(() => { r = resolve(bad, reply({ verdict })); });
        assert.ok(isCantTell(r), `${key} ${JSON.stringify(br)} ${verdict}: ${r.outcome}`);
        assert.equal(r.reason, 'bad-finding-field', `${key} ${JSON.stringify(br)} ${verdict}`);
      }
    }
  }
});

test('the log line is one line with single-space whitespace (F3c)', () => {
  for (const br of LINE_BREAKS) {
    for (const key of ['lens', 'path', 'line']) {
      const base = key === 'line' ? '20' : FINDING[key];
      const r = resolve({ ...FINDING, [key]: `${base}${br}${FORGED}` }, reply());
      assert.doesNotMatch(r.logLine, /[\r\n\u2028\u2029]/, `${key} ${JSON.stringify(br)}`);
      assert.doesNotMatch(r.logLine, /\s{2}/, `${key} ${JSON.stringify(br)}`);
    }
  }
  const spaced = resolve({ ...FINDING, lens: '3a \t  b' }, reply({ verdict: 'refuted', evidence: 'plugin/bin/foo.js:20 `const   x = readSync(fd);`' }));
  assert.equal(spaced.outcome, 'drop');
  assert.doesNotMatch(spaced.logLine, /\s{2}/);
  assert.match(spaced.logLine, /lens "3a b" finding .* "const x = readSync\(fd\);"/);
});

test('readFindingsArtifact requires a 12-hex id (F3d)', (t) => {
  const good = buildFindingsArtifact(RAW)[0];
  for (const id of ['deadbeef', 'ABC123DEF456', 'abc123def4567', 'abc123def45\n', ` ${good.id}`, 'tiebreak:abc1']) {
    const dir = tmpDir(t);
    writeFindings(dir, [{ ...good, id }]);
    assert.deepEqual(readFindingsArtifact(dir), { present: true, valid: false, findings: null }, JSON.stringify(id));
  }
  const dir = tmpDir(t);
  writeFindings(dir, [good]);
  assert.equal(readFindingsArtifact(dir).valid, true);
});

test('a cited evidence line within ±5 of the finding verifies (F2)', () => {
  for (const cited of [15, 20, 25]) {
    assert.equal(resolve(FINDING, reply({ evidence: `plugin/bin/foo.js:${cited} \`const x = readSync(fd);\`` })).outcome, 'confirmed', String(cited));
    assert.equal(resolve(FINDING, reply({ verdict: 'refuted', evidence: `plugin/bin/foo.js:${cited} \`const x = readSync(fd);\`` })).outcome, 'drop', String(cited));
  }
});

test('formatEntry renders logStatus/logStep/logText to exactly "- " + logLine for every outcome (F4)', () => {
  const id = findingId(FINDING);
  const cases = [
    ['confirmed', 'AUTO', resolve(FINDING, reply())],
    ['drop', 'AUTO', resolve(FINDING, reply({ verdict: 'refuted' }))],
    ['digest', 'AUTO', resolve({ ...FINDING, reporterSeverity: 'low' }, reply({ verdict: 'cant-tell', evidence: null }))],
    ['console', 'STAGED', resolve(FINDING, reply({ verdict: 'cant-tell', evidence: null, rec: 'file — unclear' }))],
  ];
  for (const [outcome, status, r] of cases) {
    assert.equal(r.outcome, outcome);
    assert.equal(r.logStatus, status, outcome);
    assert.equal(r.logStep, outcome === 'confirmed' ? 'Reproduction' : `Tiebreak tiebreak:${id}`, outcome);
    assert.equal(formatEntry({ status: r.logStatus, now: NOW, step: r.logStep, text: r.logText, reversibility: 'high' }), `- ${r.logLine}`, outcome);
  }
  const confirmed = cases[0][2];
  assert.equal(confirmed.logText, `lens "3a" finding plugin/bin/foo.js:20 confirmed by tiebreak:${id}. Confirmed.`);
  assert.equal(confirmed.logLine, `AUTO 09:05:07 — Reproduction: lens "3a" finding plugin/bin/foo.js:20 confirmed by tiebreak:${id}. Confirmed. Reversibility: high.`);
});

test("a contested finding's higher position severity survives the artifact (F5)", () => {
  const contested = { ...FINDING, kind: 'contested', reporterSeverity: 'low', positions: [{ severity: 'high' }, { severity: 'low' }] };
  const [stored] = buildFindingsArtifact([contested]);
  assert.equal(stored.reporterSeverity, 'high');
  assert.equal(stored.id, findingId(contested));
  const r = resolve(stored, reply({ verdict: 'cant-tell', evidence: null }));
  assert.equal(r.outcome, 'console');
  assert.equal(r.severity, 'high');
  // Without known positions the reporter's own severity is stored unchanged.
  assert.equal(buildFindingsArtifact([{ ...contested, positions: [{ severity: 'bogus' }] }])[0].reporterSeverity, 'low');
  assert.equal(buildFindingsArtifact([{ ...contested, kind: 'unconfirmed' }])[0].reporterSeverity, 'low');
});

test('the exposed log fields are whitespace-collapsed too (F3c, F4)', () => {
  const results = [
    resolve({ ...FINDING, lens: '3a \t  b' }, reply()),
    resolve({ ...FINDING, lens: `3a\n${FORGED}` }, reply()),
    resolve(FINDING, reply({ verdict: 'refuted', evidence: 'plugin/bin/foo.js:20 `const   x = readSync(fd);`' })),
  ];
  for (const r of results) {
    for (const key of ['logStep', 'logText']) {
      assert.equal(typeof r[key], 'string', key);
      assert.doesNotMatch(r[key], /\s{2}|[\r\n\u2028\u2029]/, `${r.outcome} ${key}`);
    }
    assert.equal(formatEntry({ status: r.logStatus, now: NOW, step: r.logStep, text: r.logText, reversibility: 'high' }), `- ${r.logLine}`);
  }
});
