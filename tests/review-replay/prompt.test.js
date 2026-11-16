'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadTemplate, disciplineLines, fillFinding, buildPrompt, CHUNK_HEADER_RE } =
  require('../../tools/review-replay/prompt.js');

const TIEBREAK = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'review', 'step3-tiebreak.md'), 'utf8');
const CORE = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md'), 'utf8');

const DISCIPLINE = { readOnly: 'READ-ONLY REVIEW: test line one', shell: 'SHELL DISCIPLINE: test line two' };
const CTX = { treeRoot: path.join(path.sep, 'tmp', 'tree'), base: 'bbbb', head: 'cccc', discipline: DISCIPLINE };
const F1 = { id: '0123456789ab', lens: 'correctness', path: 'src/a.js', line: 12, claim: 'First claim.', severity: 'high', kind: 'unconfirmed' };
const F2 = { id: 'abcdef012345', lens: 'tests', path: 'src/b.js', line: 3, claim: 'Second claim.', severity: 'low', kind: 'contested',
  positions: [{ claim: 'Side one', severity: 'high' }, { claim: 'Side two', severity: 'low' }] };

test('single-finding prompt carries claim, severity, absolute Location and diff scope, and no SCRATCH or [Use: line', () => {
  const prompt = buildPrompt(loadTemplate(TIEBREAK), [F1], CTX);
  assert.match(prompt, /^Finding: First claim\.$/m);
  assert.match(prompt, /^Severity: high$/m);
  assert.ok(prompt.includes('Location: ' + path.join(CTX.treeRoot, 'src/a.js') + ':12'));
  assert.match(prompt, /^Diff scope: bbbb\.\.\.cccc$/m);
  assert.ok(!/^Positions:/m.test(prompt));
  assert.ok(!prompt.includes('SCRATCH:'));
  assert.ok(!prompt.includes('[Use:'));
  assert.ok(!prompt.includes('{claim text}'));
  assert.ok(prompt.includes('Reply with exactly these lines, then your status line:'));
  assert.ok(prompt.includes('Verdict: confirmed | refuted | cant-tell'));
});

test('a contested finding keeps Positions with one line per position', () => {
  const lines = fillFinding(loadTemplate(TIEBREAK).block, F2, CTX);
  const at = lines.indexOf('Positions:');
  assert.notEqual(at, -1);
  assert.deepEqual(lines.slice(at + 1), ['- Side one (high)', '- Side two (low)']);
});

test('AC5.1: editing a copy of step3-tiebreak.md changes the prompt', () => {
  const sentence = 'Extra sentence the replay must carry.';
  const edited = TIEBREAK.replace(
    'Recommendation file means the finding is worth a fix or a work record;',
    sentence + ' Recommendation file means the finding is worth a fix or a work record;');
  assert.notEqual(edited, TIEBREAK);
  assert.ok(buildPrompt(loadTemplate(edited), [F1], CTX).includes(sentence));
  assert.ok(!buildPrompt(loadTemplate(TIEBREAK), [F1], CTX).includes(sentence));
});

test('a missing ## Dispatch fence throws naming step3-tiebreak.md', () => {
  const noHeading = TIEBREAK.replace('## Dispatch', '## Elsewhere');
  assert.throws(() => loadTemplate(noHeading), /^Error: step3-tiebreak\.md: /);
  const noFence = TIEBREAK.replace(/```/g, '~~~');
  assert.throws(() => loadTemplate(noFence), /step3-tiebreak\.md: no fenced template/);
});

test('a template without its placeholders throws', () => {
  const t = loadTemplate(TIEBREAK);
  assert.throws(() => fillFinding(t.block.filter((l) => !l.startsWith('Location:')), F1, CTX), /Location/);
  const noShell = { block: t.block, rest: t.rest.filter((l) => !l.startsWith('[... SHELL')) };
  assert.throws(() => buildPrompt(noShell, [F1], CTX), /SHELL DISCIPLINE/);
});

test('CRLF template builds the same prompt as LF', () => {
  const crlf = TIEBREAK.replace(/\n/g, '\r\n');
  assert.equal(buildPrompt(loadTemplate(crlf), [F1], CTX), buildPrompt(loadTemplate(TIEBREAK), [F1], CTX));
  assert.equal(buildPrompt(loadTemplate(crlf), [F1, F2], CTX), buildPrompt(loadTemplate(TIEBREAK), [F1, F2], CTX));
});

test('chunk prompt lists every finding under its ### Finding header in input order and keeps the rules once', () => {
  const prompt = buildPrompt(loadTemplate(TIEBREAK), [F2, F1], CTX);
  const lines = prompt.split('\n');
  const headers = lines.filter((l) => CHUNK_HEADER_RE.test(l));
  assert.deepEqual(headers, ['### Finding abcdef012345', '### Finding 0123456789ab']);
  assert.ok(prompt.startsWith('2 findings follow, each under its own "### Finding {id}" header. Judge each one on its own'));
  assert.ok(prompt.indexOf('Second claim.') < prompt.indexOf('First claim.'));
  const count = (s) => prompt.split(s).length - 1;
  assert.equal(count('You are the independent tiebreak judge'), 1);
  assert.equal(count('Verdict: confirmed | refuted | cant-tell'), 1);
  assert.equal(count('For each finding, write its "### Finding {id}" header'), 1);
  assert.ok(!prompt.includes('Reply with exactly these lines, then your status line:'));
  assert.ok(!prompt.includes('SCRATCH:'));
});

test('CHUNK_HEADER_RE matches 12-hex ids only', () => {
  assert.ok(CHUNK_HEADER_RE.test('### Finding 0123456789ab'));
  assert.ok(CHUNK_HEADER_RE.test('## Finding 0123456789ab  '));
  assert.ok(!CHUNK_HEADER_RE.test('### Finding 0123456789a'));
  assert.ok(!CHUNK_HEADER_RE.test('### Finding 0123456789AB'));
});

test('disciplineLines reads both lines from the live subagent-dispatch-core.md and returns null when either is missing', () => {
  const d = disciplineLines(CORE);
  assert.ok(d.readOnly.startsWith('READ-ONLY REVIEW: never run the project'));
  assert.ok(d.shell.startsWith('SHELL DISCIPLINE: run one plain Bash command per call'));
  assert.ok(!d.readOnly.startsWith('`') && !d.readOnly.endsWith('`'));
  assert.ok(!d.shell.endsWith('`'));
  assert.equal(disciplineLines(CORE.replace('`SHELL DISCIPLINE:', 'SHELL DISCIPLINE:')), null);
  assert.equal(disciplineLines(CORE.replace('`READ-ONLY REVIEW:', 'READ-ONLY REVIEW:')), null);
  assert.deepEqual(disciplineLines(CORE.replace(/\n/g, '\r\n')), d);
});

test('buildPrompt places the passed ctx.discipline lines verbatim', () => {
  const prompt = buildPrompt(loadTemplate(TIEBREAK), [F1], CTX);
  assert.ok(prompt.split('\n').includes(DISCIPLINE.readOnly));
  assert.ok(prompt.split('\n').includes(DISCIPLINE.shell));
  assert.ok(!prompt.includes('[... READ-ONLY'));
});
