'use strict';
// #6374 Task 1: the one module that defines the three `Blocked by` line forms.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCAL_BLOCKER_LINE_RE, LOCAL_BLOCKER_ASSUMPTION_RE, FOREIGN_BLOCKER_LINE_RE, SYMBOLIC_BLOCKER_LINE_RE,
  isBlockerLine, symbolicBlockerRef, symbolicBlockers, symbolicBlockerRefs, hasSymbolicBlocker,
} = require('../../../plugin/bin/lib/issues/blocker-lines');
const { SYMBOLIC_LINE, SYMBOLIC_REF, symbolicBody } = require('../../helpers/symbolic-blocker-fixture');
const { parseDependencies, parseDependencyAssumptions } = require('../../../plugin/bin/lib/issues/record');
const { parseCrossRepoDependencies } = require('../../../plugin/bin/lib/issues/cross-repo-refs');
const { parseParts, planFiling, TABLE_HEADER } = require('../../../plugin/bin/lib/design-session/parts');
const { readyRestorable } = require('../../../plugin/bin/lib/issues/ambiguity-resolve');

test('AC1.1: the three line regexes equal the ones they replace, and the old modules import them', () => {
  assert.equal(LOCAL_BLOCKER_LINE_RE.source, '^Blocked by #(\\d+)\\b');
  assert.equal(LOCAL_BLOCKER_LINE_RE.flags, 'gm');
  assert.equal(LOCAL_BLOCKER_ASSUMPTION_RE.source, '^Blocked by #(\\d+):[ \\t]*(.+)$');
  assert.equal(LOCAL_BLOCKER_ASSUMPTION_RE.flags, 'gm');
  assert.equal(FOREIGN_BLOCKER_LINE_RE.source, '^Blocked by ([A-Za-z0-9][A-Za-z0-9-]*\\/[A-Za-z0-9._-]+)#(\\d+)\\b');
  assert.equal(FOREIGN_BLOCKER_LINE_RE.flags, 'gm');
  assert.equal(SYMBOLIC_BLOCKER_LINE_RE.flags, 'gm');
  // the importing parsers behave as before
  assert.deepEqual(parseDependencies('Blocked by #7\nBlocked by #9: needs the api'), [7, 9]);
  assert.deepEqual(parseDependencyAssumptions('Blocked by #9: needs the api'), [{ number: 9, assumption: 'needs the api' }]);
  assert.deepEqual(parseCrossRepoDependencies('Blocked by a/b#7'), ['a/b#7']);
});

test('symbolicBlockers reads the part and repository, bullets and indent allowed', () => {
  assert.deepEqual(symbolicBlockers('- Blocked by: Skill steps (left for Thn-Inc/Other)'), [{ part: 'Skill steps', repository: 'Thn-Inc/Other' }]);
  assert.deepEqual(symbolicBlockers('  * Blocked by: Skill steps (left for thn-inc/other)  '), [{ part: 'Skill steps', repository: 'thn-inc/other' }]);
});

test('symbolicBlockers dedupes one blocker spelled twice, case-insensitively on the repository', () => {
  const body = 'Blocked by: Skill steps (left for Thn-Inc/Other)\n- Blocked by: Skill steps (left for thn-inc/other)';
  assert.deepEqual(symbolicBlockers(body), [{ part: 'Skill steps', repository: 'Thn-Inc/Other' }]);
  assert.equal(symbolicBlockers('Blocked by: A (left for x/y)\nBlocked by: B (left for x/y)').length, 2);
});

test('symbolicBlockers ignores a code span, a fence and the Original request', () => {
  assert.deepEqual(symbolicBlockers(`Text \`${SYMBOLIC_LINE}\` more`), []);
  assert.deepEqual(symbolicBlockers(`\`\`\`\n${SYMBOLIC_LINE}\n\`\`\`\n`), []);
  assert.deepEqual(symbolicBlockers(`## Deliverables\n\nx\n\n## Original request\n\n${SYMBOLIC_LINE}\n`), []);
  assert.deepEqual(symbolicBlockers(undefined), []);
  assert.deepEqual(symbolicBlockers(''), []);
  assert.equal(hasSymbolicBlocker(symbolicBody()), true);
  assert.equal(hasSymbolicBlocker('Blocked by #7'), false);
});

test('symbolicBlockerRefs names the blocker as parts.js writes it', () => {
  assert.deepEqual(symbolicBlockerRefs(SYMBOLIC_LINE), [SYMBOLIC_REF]);
  const repo = 'thn-inc/claude-tweaks';
  const other = 'thn-inc/other';
  const row = (n, name, repository, waits, issue) => `| ${n} | ${name} | S | ${repository} | ${waits} | ${issue} |`;
  const design = [
    '# Design', '',
    '## Frame', '', 'Status: done', '', 'Problem: orders are filed by hand', 'Measure: weekly orders filed — for 4 weeks', '',
    '## Approaches', '', 'Status: done', '', 'Chosen: A — file from the parts table', '',
    '## Builder check', '', 'Status: done', '',
    '## Parts', '', 'Status: done', '',
    `| ${TABLE_HEADER.join(' | ')} |`, `|${TABLE_HEADER.map(() => '---').join('|')}|`,
    row(1, 'Docs', repo, 'Skill steps', `${repo}#7004`),
    row(2, 'Skill steps', other, '—', `left for ${other}`),
    '',
  ].join('\n');
  const { writeBack } = planFiling(parseParts(design).parts, other);
  assert.equal(writeBack.length, 1);
  assert.equal(writeBack[0].line, `Blocked by: ${symbolicBlockerRef({ part: 'Skill steps', repository: other })}`);
});

test('isBlockerLine accepts all three forms and rejects prose', () => {
  assert.equal(isBlockerLine('Blocked by #7'), true);
  assert.equal(isBlockerLine('Blocked by a/b#7'), true);
  assert.equal(isBlockerLine(SYMBOLIC_LINE), true);
  assert.equal(isBlockerLine('Blocked by nothing'), false);
  assert.equal(isBlockerLine('Blocked by #7x'), false);
  assert.equal(isBlockerLine('See Blocked by #7'), false);
  assert.equal(isBlockerLine(undefined), false);
});

test('readyRestorable keeps its verdict: a symbolic blocker holds ready off, a quoted one does not', () => {
  assert.equal(readyRestorable(symbolicBody()), false);
  assert.equal(readyRestorable(symbolicBody().replace(SYMBOLIC_LINE, `\`${SYMBOLIC_LINE}\``)), true);
});
