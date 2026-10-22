'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findingId, parseTiebreakReply, resolveTiebreak, VERDICTS, SEVERITIES } = require('../../plugin/bin/lib/tiebreak');

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
