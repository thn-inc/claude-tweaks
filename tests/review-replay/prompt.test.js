'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadTemplate, disciplineLines, fillFinding, buildPrompt } =
  require('../../tools/review-replay/prompt.js');
const { stripTree } = require('../../tools/review-replay/score.js');
const { toPosix } = require('../../tools/review-replay/schema.js');

const { readText } = require('../helpers/read-skill.js');

const TIEBREAK = readText(path.join(__dirname, '..', '..', 'plugin', 'skills', 'review', 'step3-tiebreak.md'));
const CORE = readText(path.join(__dirname, '..', '..', 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md'));

const DISCIPLINE = { readOnly: 'READ-ONLY REVIEW: test line one', shell: 'SHELL DISCIPLINE: test line two' };
const CTX = { treeRoot: path.join(path.sep, 'tmp', 'tree'), base: 'bbbb', head: 'cccc', discipline: DISCIPLINE };
const F1 = { id: '0123456789ab', lens: 'correctness', path: 'src/a.js', line: 12, claim: 'First claim.', severity: 'high', kind: 'unconfirmed' };
const F2 = { id: 'abcdef012345', lens: 'tests', path: 'src/b.js', line: 3, claim: 'Second claim.', severity: 'low', kind: 'contested',
  positions: [{ claim: 'Side one', severity: 'high' }, { claim: 'Side two', severity: 'low' }] };

test('single-finding prompt carries claim, severity, absolute Location and diff scope, and no SCRATCH or [Use: line', () => {
  const prompt = buildPrompt(loadTemplate(TIEBREAK), [F1], CTX);
  assert.match(prompt, /^Finding: First claim\.$/m);
  assert.match(prompt, /^Severity: high$/m);
  assert.ok(prompt.includes('Location: ' + toPosix(CTX.treeRoot) + '/src/a.js:12'));
  assert.match(prompt, /^Diff scope: bbbb\.\.\.cccc$/m);
  assert.ok(!/^Positions:/m.test(prompt));
  assert.ok(!prompt.includes('SCRATCH:'));
  assert.ok(!prompt.includes('[Use:'));
  assert.ok(!prompt.includes('{claim text}'));
  assert.ok(prompt.includes('Reply with exactly these lines, then your status line:'));
  assert.ok(prompt.includes('Verdict: confirmed | refuted | cant-tell'));
});

test('Location is written with forward slashes for a backslash tree root, and score strips it back to the repo-relative path', () => {
  const ctx = { ...CTX, treeRoot: 'C:\\work\\tree' };
  const loc = buildPrompt(loadTemplate(TIEBREAK), [F1], ctx).split('\n').find((l) => l.startsWith('Location: '));
  assert.equal(loc, 'Location: C:/work/tree/src/a.js:12');
  assert.equal(stripTree(loc, ctx.treeRoot), 'Location: src/a.js:12');
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

test('buildPrompt with no findings throws a named error', () => {
  assert.throws(() => buildPrompt(loadTemplate(TIEBREAK), [], CTX), /^Error: buildPrompt: no findings$/);
});

test('loadTemplate names a missing blank-line boundary and an unclosed fence', () => {
  const noBoundary = TIEBREAK.replace('\n\nReply with exactly', '\nReply with exactly');
  assert.notEqual(noBoundary, TIEBREAK);
  assert.throws(() => loadTemplate(noBoundary), /step3-tiebreak\.md: no blank line before "Reply with exactly"/);
  const start = TIEBREAK.indexOf('## Dispatch');
  const fence = TIEBREAK.indexOf('```', start);
  const closing = TIEBREAK.indexOf('```', fence + 3);
  const unclosed = TIEBREAK.slice(0, closing) + TIEBREAK.slice(closing + 3);
  assert.throws(() => loadTemplate(unclosed), /step3-tiebreak\.md: the template fence under "## Dispatch" is not closed/);
});

test('each missing Finding, Severity or Diff scope placeholder throws naming it', () => {
  for (const name of ['Finding', 'Severity', 'Diff scope']) {
    const block = loadTemplate(TIEBREAK).block.filter((l) => !l.startsWith(name + ': {'));
    assert.throws(() => fillFinding(block, F1, CTX), new RegExp('no "' + name + ': \\{" placeholder'));
  }
});

test('a chunk template missing its Id block or its block-end marker throws naming it', () => {
  const noMarker = TIEBREAK.replace('{… one such block', '{... another line');
  assert.notEqual(noMarker, TIEBREAK);
  assert.throws(() => loadTemplate(noMarker), /the chunk template has no ".* one such block" marker line/);
  const noId = TIEBREAK.replace('\nId: {id}\nFinding: {claim text}', '\nFinding: {claim text}').replace('\nId: {id}\nVerdict', '\nVerdict');
  assert.notEqual(noId, TIEBREAK);
  assert.throws(() => loadTemplate(noId), /the chunk template has no "Id: \{" block line/);
  const t = loadTemplate(TIEBREAK);
  assert.throws(() => buildPrompt({ block: t.block, rest: t.rest }, [F1, F2], CTX), /no chunk template/);
});

test('CRLF template builds the same prompt as LF', () => {
  const crlf = TIEBREAK.replace(/\n/g, '\r\n');
  assert.equal(buildPrompt(loadTemplate(crlf), [F1], CTX), buildPrompt(loadTemplate(TIEBREAK), [F1], CTX));
  assert.equal(buildPrompt(loadTemplate(crlf), [F1, F2], CTX), buildPrompt(loadTemplate(TIEBREAK), [F1, F2], CTX));
});

test('chunk prompt is the production chunk template: the scope once, an Id block per finding in input order, the rules once', () => {
  const prompt = buildPrompt(loadTemplate(TIEBREAK), [F2, F1], CTX);
  const lines = prompt.split('\n');
  assert.equal(lines[0], 'Diff scope: bbbb...cccc');
  assert.deepEqual(lines.filter((l) => /^Id: [0-9a-f]{12}$/.test(l)), ['Id: abcdef012345', 'Id: 0123456789ab']);
  assert.ok(prompt.indexOf('Second claim.') < prompt.indexOf('First claim.'));
  const count = (s) => prompt.split(s).length - 1;
  assert.equal(count('Diff scope:'), 1);
  assert.equal(count('You are the independent tiebreak judge'), 1);
  assert.equal(count('Verdict: confirmed | refuted | cant-tell'), 1);
  assert.equal(count('Reply with one block per finding'), 1);
  assert.ok(!prompt.includes('Reply with exactly these lines, then your status line:'));
  assert.ok(!prompt.includes('SCRATCH:'));
  assert.ok(!prompt.includes('[Use:'));
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
