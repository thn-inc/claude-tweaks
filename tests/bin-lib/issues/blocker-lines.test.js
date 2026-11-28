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
// `sites` are the stripped source lines that define one (each shape matches within one line).
const blockedByRegexScan = (raw) => {
  const code = stripComments(raw);
  const sites = code.split('\n').filter((line) => REGEX_LITERAL.test(line) || REGEXP_CALL.test(line));
  return { verdict: stripperVerdict(raw, code), defines: sites.length > 0, sites: sites.map((s) => s.trim()) };
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
const BLOCKER_LINES_FILE = 'lib/issues/blocker-lines.js';
const RANKING_FILE = 'lib/issues/ranking.js';
const PROSE_DEP_RE_SITE = 'const PROSE_DEP_RE = /blocked by\\b[^\\n#]*#\\d+/i;';
// ranking.js is excluded for that one line, never as a file: a second grammar planted beside it, or
// an edit to the regex itself, is a problem even though the file stays on the list.
const rankingExceptionProblems = (raw) => {
  const { sites } = blockedByRegexScan(raw);
  if (sites.length !== 1) return [`expected exactly one Blocked by regex site, found ${sites.length}: ${JSON.stringify(sites)}`];
  return sites[0] === PROSE_DEP_RE_SITE ? [] : [`the one site is not PROSE_DEP_RE: ${sites[0]}`];
};
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
  const problems = [];
  for (const abs of files) {
    const rel = path.relative(BIN, abs).split(path.sep).join('/');
    const raw = readText(abs);
    const r = blockedByRegexScan(raw);
    if (r.verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[r.verdict]}`);
    if (r.defines) defining.push(rel);
    if (rel === RANKING_FILE) problems.push(...rankingExceptionProblems(raw));
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(defining.sort(), [BLOCKER_LINES_FILE, RANKING_FILE], 'a new Blocked by regex belongs in blocker-lines.js; a listed file that no longer defines one leaves this list');
  assert.deepEqual(problems, [], "ranking.js defines PROSE_DEP_RE and nothing else");
});

test('AC1.2: the ranking.js exception covers PROSE_DEP_RE alone, so a second grammar beside it goes red', () => {
  const real = readText(path.join(BIN, RANKING_FILE));
  assert.deepEqual(rankingExceptionProblems(real), [], 'control: the live file passes');
  assert.ok(real.includes(PROSE_DEP_RE_SITE), 'the pinned site is the live line');
  // The file-level exception this replaces classified by path, so each planted file still "defines one".
  const second = real + '\nconst SECOND = /^Blocked by #(\\d+)\\b/gm;\n';
  assert.equal(blockedByRegexScan(second).defines, true, 'the old file-level check could not tell the difference');
  assert.match(rankingExceptionProblems(second)[0], /found 2/);
  const viaCtor = real + "\nconst THIRD = new RegExp('^Blocked by: ' + x);\n";
  assert.match(rankingExceptionProblems(viaCtor)[0], /found 2/);
  const edited = real.replace(PROSE_DEP_RE_SITE, () => 'const PROSE_DEP_RE = /^Blocked by #(\\d+)/im;');
  assert.notEqual(edited, real);
  assert.match(rankingExceptionProblems(edited)[0], /not PROSE_DEP_RE/);
  const gone = real.replace(PROSE_DEP_RE_SITE, () => '');
  assert.notEqual(gone, real);
  assert.match(rankingExceptionProblems(gone)[0], /found 0/, 'a removed exception leaves the list too');
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

test('the owner/name pattern is defined once: parts.js imports REPO from blocker-lines.js', () => {
  const { REPO } = require('../../../plugin/bin/lib/issues/blocker-lines');
  assert.equal(typeof REPO, 'string');
  assert.equal(REPO, '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+');
  const text = readText(path.join(__dirname, '../../../plugin/bin/lib/design-session/parts.js'));
  const code = stripComments(text);
  assert.equal(stripperVerdict(text, code), 'ok');
  assert.match(code, /const \{[^}]*\bREPO\b[^}]*\} = require\('\.\.\/issues\/blocker-lines'\)/, 'parts.js imports REPO');
  assert.doesNotMatch(code, /(?:const|let|var)\s+REPO\s*=/, 'parts.js does not redefine REPO');
  assert.doesNotMatch(code, /\[A-Za-z0-9_\.-\]\+\\\\\/\[A-Za-z0-9_\.-\]\+/, 'parts.js holds no second copy of the pattern');
  assert.equal(blockedByRegexScan(text).defines, false, 'importing REPO adds no Blocked by regex site to parts.js');
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
