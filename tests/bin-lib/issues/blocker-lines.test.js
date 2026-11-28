'use strict';
// #6374 Task 1: the one module that defines the three `Blocked by` line forms.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LOCAL_BLOCKER_LINE_RE, LOCAL_BLOCKER_ASSUMPTION_RE, FOREIGN_BLOCKER_LINE_RE, SYMBOLIC_BLOCKER_LINE_RE,
  isBlockerLine, symbolicBlockerRef, symbolicBlockers, symbolicBlockerRefs, hasSymbolicBlocker,
} = require('../../../plugin/bin/lib/issues/blocker-lines');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { SYMBOLIC_LINE, SYMBOLIC_REF, symbolicBody } = require('../../helpers/symbolic-blocker-fixture');
const { parseDependencies, parseDependencyAssumptions } = require('../../../plugin/bin/lib/issues/record');
const { parseCrossRepoDependencies } = require('../../../plugin/bin/lib/issues/cross-repo-refs');
const { parseParts, planFiling, TABLE_HEADER } = require('../../../plugin/bin/lib/design-session/parts');
const { readyRestorable } = require('../../../plugin/bin/lib/issues/ambiguity-resolve');

// Does this source define a `Blocked by` regex of its own? Read over the comment-stripped text (the
// shared stripper keeps literals and blanks comments), so a comment quoting a regex never counts.
// Two shapes: a regex literal whose body reaches `Blocked by` (it follows an operator or opener, so a
// division never reads as one), and a `RegExp(` call, with or without `new`, whose string argument
// reaches it on the same line. Neither requires a `^`: an unanchored pattern is still a second grammar.
// Recall limits: a pattern assembled from a constant (`new RegExp(PREFIX + x)`) or from two string
// pieces split before `Blocked by` is not seen.
const REGEX_LITERAL = /(?:^|[=>(:,[!&|?{};]|\breturn)\s*\/(?![/*])(?:[^/\n\\[]|\\.|\[(?:[^\]\\\n]|\\.)*\])*[Bb]locked by/;
const REGEXP_CALL = /(?:new\s+)?RegExp\(\s*[`'"][^\n]*?[Bb]locked by/;
const blockedByRegexScan = (raw) => {
  const code = stripComments(raw);
  return { verdict: stripperVerdict(raw, code), defines: REGEX_LITERAL.test(code) || REGEXP_CALL.test(code) };
};
const definesBlockedByRegex = (raw) => blockedByRegexScan(raw).defines;

test('the literal detector flags a regex literal and a RegExp string, never a comment', () => {
  assert.equal(definesBlockedByRegex('const A = /^\\s*Blocked by #(\\d+)/gm;'), true);
  assert.equal(definesBlockedByRegex('const B = /^(?:- )?Blocked by: x/m;'), true);
  assert.equal(definesBlockedByRegex("const C = new RegExp(`^[ ]*Blocked by: ${x}`, 'm');"), true);
  assert.equal(definesBlockedByRegex('// Blocked by lines are parsed in blocker-lines.js'), false);
});

test('the literal detector also flags a RegExp call without new, an unanchored pattern and a lower-case one', () => {
  assert.equal(definesBlockedByRegex("const D = RegExp('^Blocked by');"), true, 'RegExp( without new');
  assert.equal(definesBlockedByRegex("const E = new RegExp('Blocked by');"), true, 'new RegExp, no ^');
  assert.equal(definesBlockedByRegex('const F = /Blocked by #(\\d+)/gm;'), true, 'a literal, no ^');
  assert.equal(definesBlockedByRegex('const G = /blocked by\\b[^\\n#]*#\\d+/i;'), true, 'lower-case, as ranking.js writes it');
  assert.equal(definesBlockedByRegex('const H = (x) => /Blocked by/.test(x);'), true, 'after an opening paren');
  assert.equal(definesBlockedByRegex('function f(x) { return /Blocked by/.test(x); }'), true, 'after return');
  assert.equal(definesBlockedByRegex('const I = /[/]x Blocked by/;'), true, 'a slash inside a class does not end the literal');
});

test('the literal detector reads stripped text: a comment quoting a regex never counts, a comment opener in a literal never hides one', () => {
  assert.equal(definesBlockedByRegex('// the old form was /^Blocked by #(\\d+)/gm\nconst A = 1;'), false, 'a line comment quoting a literal');
  assert.equal(definesBlockedByRegex('/* was /^Blocked by x/ and RegExp("Blocked by") */\nconst A = 1;'), false, 'a block comment quoting both shapes');
  assert.equal(definesBlockedByRegex("const s = '/*'; const R = /^Blocked by/;"), true, "a '/*' string does not open a comment");
  assert.equal(definesBlockedByRegex('// see staged/** here\nconst R = /Blocked by/;'), true, 'a glob in a comment does not hide the next line');
  assert.equal(definesBlockedByRegex("const t = 'Blocked by #7 is open'; const half = a / b;"), false, 'a message string and a division');
  assert.equal(definesBlockedByRegex("const t = x / 2; const m = 'Blocked by';"), false, 'a division before a string');
});

test('a comment-stripper mis-parse is a verdict, never a clean scan', () => {
  const planted = 'if (b) /"/.test(b); const c = "//"; const R = /Blocked by/;';
  assert.equal(blockedByRegexScan(planted).verdict, 'misparsed', STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.equal(blockedByRegexScan('const R = 1;').verdict, 'ok');
});

// Every plugin/bin source file, walked by hand: the plan's grammar check (AC1.2). Only blocker-lines.js
// defines the line grammar; ranking.js's PROSE_DEP_RE is the one classified exception (the unwired-prose
// detector, deliberately wider than the grammar, not a grammar of a `Blocked by` line).
const BIN = path.join(__dirname, '../../../plugin/bin');
const BLOCKED_BY_REGEX_FILES = ['lib/issues/blocker-lines.js', 'lib/issues/ranking.js'];
function binSources(dir = BIN, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) binSources(abs, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

test('AC1.2: only blocker-lines.js and ranking.js\'s PROSE_DEP_RE define a Blocked by regex under plugin/bin', () => {
  const files = binSources();
  assert.ok(files.length > 150, `only ${files.length} plugin/bin files walked: the walk stopped seeing the tree`);
  const defining = [];
  const offenders = [];
  for (const abs of files) {
    const rel = path.relative(BIN, abs).split(path.sep).join('/');
    const r = blockedByRegexScan(readText(abs));
    if (r.verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[r.verdict]}`);
    if (r.defines) defining.push(rel);
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(defining.sort(), BLOCKED_BY_REGEX_FILES, 'a new Blocked by regex belongs in blocker-lines.js; a listed file that no longer defines one leaves this list');
});

test('AC1.1: the three line regexes equal the ones they replace, and the old modules import them', () => {
  assert.equal(LOCAL_BLOCKER_LINE_RE.source, '^Blocked by #(\\d+)\\b');
  assert.equal(LOCAL_BLOCKER_LINE_RE.flags, 'gm');
  assert.equal(LOCAL_BLOCKER_ASSUMPTION_RE.source, '^Blocked by #(\\d+):[ \\t]*(.+)$');
  assert.equal(LOCAL_BLOCKER_ASSUMPTION_RE.flags, 'gm');
  assert.equal(FOREIGN_BLOCKER_LINE_RE.source, '^Blocked by ([A-Za-z0-9][A-Za-z0-9-]*\\/[A-Za-z0-9._-]+)#(\\d+)\\b');
  assert.equal(FOREIGN_BLOCKER_LINE_RE.flags, 'gm');
  assert.equal(SYMBOLIC_BLOCKER_LINE_RE.flags, 'gm');
  // the old modules import them: each requires blocker-lines and defines no `Blocked by` regex literal
  const lib = path.join(__dirname, '../../../plugin/bin/lib');
  for (const f of ['issues/record-dependencies.js', 'issues/cross-repo-refs.js', 'issues/plan-line.js', 'issues/ambiguity-resolve.js', 'design-session/parts.js']) {
    const text = readText(path.join(lib, f));
    assert.match(text, /require\('(?:\.\.\/issues|\.)\/blocker-lines'\)/, `${f} requires blocker-lines`);
    const scan = blockedByRegexScan(text);
    assert.equal(scan.verdict, 'ok', `${f}: ${STRIPPER_VERDICT_MESSAGES[scan.verdict]}`);
    assert.equal(scan.defines, false, `${f} defines no Blocked by regex of its own`);
  }
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
