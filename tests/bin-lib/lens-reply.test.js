'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { stripComments, stripperVerdict } = require('../helpers/strip-comments');
const { readText } = require('../helpers/read-skill');

const ROOT = path.resolve(__dirname, '..', '..');

// Inline status-line patterns in a source file, in any spelling: a status word
// inside a regex literal's body, any `RegExp` call (a string could become a
// pattern), or a literal holding a `WORD|WORD` alternation or a `'WORD', 'WORD'`
// list. Prose that names the words with ` / ` between them is not a pattern.
// Literal bodies are found by diffing the comment-stripped text against its
// `literals: 'blank'` twin; a body whose opening delimiter is `/` is a regex.
const WORD = '(?:DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED|DONE)';
const WORD_RE = new RegExp(`\\b${WORD}\\b`, 'g');
const ALTERNATION_RE = new RegExp(`\\b${WORD}\\b\\s*\\\\*\\|\\s*\\b${WORD}\\b`);
const WORD_LIST_RE = new RegExp(`['"\`]${WORD}['"\`]\\s*,\\s*['"\`]${WORD}['"\`]`);

function inlineStatusPatterns(raw) {
  const kept = stripComments(raw);
  const blank = stripComments(raw, { literals: 'blank' });
  assert.equal(stripperVerdict(raw, kept), 'ok');
  assert.equal(stripperVerdict(raw, blank), 'ok');
  const offenders = [];
  if (/\bRegExp\b/.test(blank)) offenders.push('RegExp call');
  if (ALTERNATION_RE.test(kept)) offenders.push('status-word alternation');
  if (WORD_LIST_RE.test(kept)) offenders.push('status-word list');
  for (const m of kept.matchAll(WORD_RE)) {
    if (blank[m.index] === kept[m.index]) continue; // code, not a literal body
    let j = m.index - 1;
    while (j >= 0 && blank[j] === ' ' && kept[j] !== '\n') j -= 1;
    if (blank[j] === '/') offenders.push(`regex literal holding ${m[0]}`);
  }
  return offenders;
}

test('AC9.1: the inline-status-pattern matcher catches every spelling (go-red self-test)', () => {
  const planted = [
    'const A = /^(?:-\\s*)?(?:STATUS:\\s+)?(BLOCKED)\\b/;',
    "const B = new RegExp('^STATUS: (DONE)$');",
    "const C = 'DONE|BLOCKED';",
    "const D = ['DONE', 'BLOCKED'];",
    'const E = /^STATUS: (?:DONE_WITH_CONCERNS)$/;',
  ];
  for (const src of planted) assert.notDeepStrictEqual(inlineStatusPatterns(src), [], src);
  const clean = "const m = 'write STATUS: DONE (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED)'; // DONE|BLOCKED\nconst r = a / b;";
  assert.deepStrictEqual(inlineStatusPatterns(clean), []);
});

test('AC9.1: the hook and the parser share one status-line module (subagent-stop.js keeps no pattern of its own)', () => {
  const sl = require('../../plugin/bin/lib/status-line');
  assert.ok(sl.CANONICAL_RE.test('STATUS: DONE'));
  assert.ok(!sl.CANONICAL_RE.test('STATUS: DONE.'));
  assert.ok(sl.LENIENT_RE.test('- **Status:** BLOCKED'));
  const raw = readText(path.join(ROOT, 'plugin/bin/lib/hooks/subagent-stop.js'));
  const src = stripComments(raw);
  assert.equal(stripperVerdict(raw, src), 'ok');
  assert.match(src, /require\(['"]\.\.\/status-line['"]\)/);
  assert.deepStrictEqual(inlineStatusPatterns(raw), []);
});

// ---- parseLensReply (#5598) ----

// Required per call so a load failure fails these tests, not AC9.1 above.
const lensReply = () => require('../../plugin/bin/lib/lens-reply');
const parseLensReply = (text) => lensReply().parseLensReply(text);

const HEADER = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n';

function result(overrides) {
  return {
    parse: 'ok', findings: [], noFindings: false, overflow: 0, skipped: 0, status: 'ok', statusWord: 'DONE',
    ...overrides,
  };
}

const PLAIN = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n| low | src/b.ts:20 | Dead branch | never true |\n\nSTATUS: DONE\n`;
const PLAIN_FINDINGS = [
  { severity: 'high', path: 'src/a.ts', line: 10, text: 'Null deref', evidence: '`x.y` unguarded' },
  { severity: 'low', path: 'src/b.ts', line: 20, text: 'Dead branch', evidence: 'never true' },
];

test('AC1.1: a plain table', () => {
  assert.deepStrictEqual(parseLensReply(PLAIN), result({ findings: PLAIN_FINDINGS }));
});

test('AC1.2: Evidence holding a || b in backticks stays one cell', () => {
  const reply = `${HEADER}| medium | src/c.ts:5 | Wrong default | uses \`a || b\` here |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'medium', path: 'src/c.ts', line: 5, text: 'Wrong default', evidence: 'uses `a || b` here' }],
  }));
});

test('AC1.3: an escaped pipe', () => {
  const reply = `${HEADER}| low | src/d.ts:7 | a \\| b | seen |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'low', path: 'src/d.ts', line: 7, text: 'a | b', evidence: 'seen' }],
  }));
});

test('AC1.4: a bold severity', () => {
  const reply = `${HEADER}| **HIGH** | src/e.ts:3 | Race | two writers |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'high', path: 'src/e.ts', line: 3, text: 'Race', evidence: 'two writers' }],
  }));
});

test('AC1.5: No findings.', () => {
  assert.deepStrictEqual(parseLensReply('No findings.\n\nSTATUS: DONE'), result({ noFindings: true }));
});

test('AC1.6 + AC10.1 (parser half): a +3 more row', () => {
  const reply = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n| +3 more | | | |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({ findings: [PLAIN_FINDINGS[0]], overflow: 3 }));
});

test('AC1.7: narration before the table', () => {
  const reply = `I reviewed the diff.\n\n${PLAIN}`;
  assert.deepStrictEqual(parseLensReply(reply), result({ findings: PLAIN_FINDINGS }));
});

test('AC1.8: a status line that is not last', () => {
  const reply = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n\nSTATUS: DONE\n\nLet me know if you need more.`;
  assert.deepStrictEqual(parseLensReply(reply), result({ findings: [PLAIN_FINDINGS[0]], status: 'misplaced' }));
});

test('AC1.9: no status line', () => {
  const reply = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [PLAIN_FINDINGS[0]], status: 'missing', statusWord: null,
  }));
});

test('AC1.10: a BLOCKED reply with a reason', () => {
  assert.deepStrictEqual(parseLensReply('cannot read src/x.ts\n\nSTATUS: BLOCKED'), result({
    parse: 'unparseable', statusWord: 'BLOCKED',
  }));
});

test('AC1.11: an empty string', () => {
  const empty = {
    parse: 'unparseable', findings: [], noFindings: false, overflow: 0, skipped: 0, status: 'missing', statusWord: null,
  };
  assert.deepStrictEqual(parseLensReply(''), empty);
  assert.deepStrictEqual(parseLensReply(null), empty);
});

test('No findings. variants', () => {
  for (const line of ['"No findings."', '`No findings.`', '**No findings.**']) {
    assert.deepStrictEqual(parseLensReply(`${line}\n\nSTATUS: DONE`), result({ noFindings: true }), line);
  }
  for (const line of ['No findings', 'no findings.']) {
    assert.deepStrictEqual(parseLensReply(`${line}\n\nSTATUS: DONE`), result({ parse: 'unparseable' }), line);
  }
});

test('AC1.12: a Path:Line cell reading general', () => {
  const reply = `${HEADER}| info | general | No tests for the new flag | none added |\n\nSTATUS: DONE`;
  const got = parseLensReply(reply);
  assert.deepStrictEqual(got, result({
    findings: [{ severity: 'info', path: 'general', text: 'No tests for the new flag', evidence: 'none added' }],
  }));
  assert.ok(!('line' in got.findings[0]));
});

test('AC1.13: a five-column table with a Suggested resolution header', () => {
  const reply = '| Severity | Path:Line | Finding | Evidence | Suggested resolution |\n|---|---|---|---|---|\n'
    + '| high | src/f.ts:9 | Leak | fd never closed | close it in finally |\n\nSTATUS: DONE';
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'high', path: 'src/f.ts', line: 9, text: 'Leak', evidence: 'fd never closed' }],
  }));
});

test('AC1.14: a row with three cells', () => {
  const reply = `${HEADER}| medium | src/g.ts:12 | Off by one |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'medium', path: 'src/g.ts', line: 12, text: 'Off by one', evidence: '' }],
  }));
});

test('a table with no header row takes its cells in brief order', () => {
  const reply = '| high | src/a.ts:10 | Null deref | `x.y` unguarded |\n\nSTATUS: DONE';
  assert.deepStrictEqual(parseLensReply(reply), result({ findings: [PLAIN_FINDINGS[0]] }));
});

test('an unescaped pipe outside backticks joins the surplus cells onto Evidence', () => {
  const reply = `${HEADER}| low | src/h.ts:4 | Two defaults | 3000 | 5000 |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'low', path: 'src/h.ts', line: 4, text: 'Two defaults', evidence: '3000 | 5000' }],
  }));
});

test('a lenient status line that is last reads as misplaced', () => {
  const reply = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n\n- **Status:** BLOCKED`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [PLAIN_FINDINGS[0]], status: 'misplaced', statusWord: 'BLOCKED',
  }));
});

test('an unclosed backtick span runs to the end of the row, so a later pipe does not split the cell', () => {
  const reply = `${HEADER}| low | src/u.ts:1 | Stray \` tick | and more |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'low', path: 'src/u.ts', line: 1, text: 'Stray ` tick | and more', evidence: '' }],
  }));
});

test('with two status lines in the window the latest supplies the word', () => {
  const reply = `STATUS: DONE\n${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n- **Status:** BLOCKED`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [PLAIN_FINDINGS[0]], status: 'misplaced', statusWord: 'BLOCKED',
  }));
});

test('a status line buried past the first and last three non-empty lines is missing, whatever the table rows around it', () => {
  const rows = Array.from({ length: 6 }, (_, i) => `| low | src/r${i}.ts:${i + 1} | f${i} | e${i} |`).join('\n');
  const reply = `one\ntwo\nthree\nfour\nfive\nSTATUS: DONE\n${rows}\n`;
  const got = parseLensReply(reply);
  assert.strictEqual(got.findings.length, 6);
  assert.strictEqual(got.status, 'missing');
  assert.strictEqual(got.statusWord, null);
});

test('an extra cell that is empty adds no separator to Evidence', () => {
  const head = '| Severity | Path:Line | Finding |\n|---|---|---|\n';
  const reply = `${head}| low | src/h.ts:4 | Two defaults | y |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(reply), result({
    findings: [{ severity: 'low', path: 'src/h.ts', line: 4, text: 'Two defaults', evidence: 'y' }],
  }));
});

test('AC1.15: rows and No findings. together', () => {
  const reply = `No findings.\n\n${PLAIN}`;
  assert.deepStrictEqual(parseLensReply(reply), result({ findings: PLAIN_FINDINGS }));
});

test('Review Focus 1: CRLF replies parse like LF', () => {
  const crlf = PLAIN.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'));
  assert.deepStrictEqual(parseLensReply(crlf), parseLensReply(PLAIN));
});

test('Review Focus 2: an empty location cell is skipped, not a finding', () => {
  const emptyLoc = '| high |  | x | y |';
  const withGood = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n${emptyLoc}\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(withGood), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }));
  assert.deepStrictEqual(parseLensReply(`${HEADER}${emptyLoc}\n\nSTATUS: DONE`), result({
    parse: 'unparseable', skipped: 1,
  }));
});

test('a row whose path is empty or holds a control character is skipped, not a finding', () => {
  const good = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n`;
  assert.deepStrictEqual(parseLensReply(`${good}| high | :12 | x | y |\n\nSTATUS: DONE`), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }));
  assert.deepStrictEqual(parseLensReply(`${good}| high |  :12 | x | y |\n\nSTATUS: DONE`), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }));
  assert.deepStrictEqual(parseLensReply(`${good}| high | src/x\ry.js:3 | x | y |\n\nSTATUS: DONE`), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }));
  for (const bad of ['\x7f', '\t', '\x01', '\x00', '\u0085', '\u2028', '\u2029']) {
    assert.deepStrictEqual(parseLensReply(`${good}| high | src/x${bad}y.js:3 | x | y |\n\nSTATUS: DONE`), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }), JSON.stringify(bad));
  }
  assert.deepStrictEqual(parseLensReply(`${HEADER}| high | :12 | x | y |\n\nSTATUS: DONE`), result({ parse: 'unparseable', skipped: 1 }));
});

test('a row whose severity is off the scale is counted in skipped; header and separator rows are not', () => {
  assert.deepStrictEqual(parseLensReply('| high | a.js:1 | x | y |\n| Major | b.js:2 | y | z |\n\nSTATUS: DONE'), result({
    findings: [{ severity: 'high', path: 'a.js', line: 1, text: 'x', evidence: 'y' }], skipped: 1,
  }));
  const twoTables = `${HEADER}| high | src/a.ts:10 | Null deref | \`x.y\` unguarded |\n\n${HEADER}| P1 | b.js:2 | y | z |\n\nSTATUS: DONE`;
  assert.deepStrictEqual(parseLensReply(twoTables), result({ findings: [PLAIN_FINDINGS[0]], skipped: 1 }));
});

test('AC2.1: categoriseReproduction over the parser\'s output equals it over a hand-written transcription', () => {
  const c = require('../../plugin/bin/lib/coordination');
  const replyA = `${HEADER}`
    + '| high | src/auth.ts:42 | Missing token expiry check | uses `<` not `<=` |\n'
    + '| medium | src/api.ts:100 | Unhandled promise rejection in fetch | `await fetch(url)` has no catch |\n'
    + '| low | src/util.ts:5 | Dead code branch | `if (false || x)` never true |\n\nSTATUS: DONE';
  const replyB = `${HEADER}`
    + '| high | `src/auth.ts:44` | Missing token expiry check | compares with `<` |\n'
    + '| medium | src/api.ts:100 | Logging leaks the user password | `console.log(req.body)` |\n'
    + '| low | src/other.ts:70 | Magic number timeout | 3000 \\| 5000 hard-coded |\n\nSTATUS: DONE';
  const handA = [
    { severity: 'high', path: 'src/auth.ts', line: 42, text: 'Missing token expiry check', evidence: 'uses `<` not `<=`' },
    { severity: 'medium', path: 'src/api.ts', line: 100, text: 'Unhandled promise rejection in fetch', evidence: '`await fetch(url)` has no catch' },
    { severity: 'low', path: 'src/util.ts', line: 5, text: 'Dead code branch', evidence: '`if (false || x)` never true' },
  ];
  const handB = [
    { severity: 'high', path: 'src/auth.ts', line: 44, text: 'Missing token expiry check', evidence: 'compares with `<`' },
    { severity: 'medium', path: 'src/api.ts', line: 100, text: 'Logging leaks the user password', evidence: '`console.log(req.body)`' },
    { severity: 'low', path: 'src/other.ts', line: 70, text: 'Magic number timeout', evidence: '3000 | 5000 hard-coded' },
  ];
  const fromParser = c.categoriseReproduction(parseLensReply(replyA).findings, parseLensReply(replyB).findings);
  const fromHand = c.categoriseReproduction(handA, handB);
  assert.deepStrictEqual(fromParser, fromHand);
  assert.equal(fromHand.confirmed.length, 1);
});

// AC13: the live output block of step3-lens-dispatch.md is the brief the
// parser reads replies to; its header and severity scale are pinned equal to
// the parser's constants.
const LENS_DOC = path.join(ROOT, 'plugin/skills/review/step3-lens-dispatch.md');

function extractOutputFence(md) {
  const lines = md.split('\n');
  const heading = lines.findIndex((l) => l.startsWith('## Per-lens Calibration + Output template'));
  assert.ok(heading !== -1, 'Output template heading not found');
  let open = -1;
  for (let i = heading + 1; i < lines.length && !lines[i].startsWith('## '); i += 1) {
    if (lines[i] === '```markdown') { open = i; break; }
  }
  assert.ok(open !== -1, 'markdown fence not found under the Output template heading');
  const close = lines.findIndex((l, i) => i > open && l === '```');
  assert.ok(close !== -1, 'markdown fence not closed');
  return lines.slice(open + 1, close).join('\n');
}

function fenceHeaderCells(fence) {
  const row = fence.split('\n').find((l) => l.startsWith('| Severity |'));
  assert.ok(row, 'no | Severity | header row in the fence');
  return row.split('|').slice(1, -1).map((c) => c.trim());
}

function fenceScaleWords(fence) {
  const line = fence.split('\n').find((l) => l.startsWith('Severity scale:'));
  assert.ok(line, 'no Severity scale: line in the fence');
  return line.slice('Severity scale:'.length).split('/').map((w) => w.trim());
}

test('AC13.1: the live lens output block parses, and its header and scale equal the parser\'s constants', () => {
  const { SEVERITIES, BRIEF_HEADER } = lensReply();
  const fence = extractOutputFence(readText(LENS_DOC));
  assert.deepStrictEqual(fenceHeaderCells(fence), [...BRIEF_HEADER]);
  assert.deepStrictEqual(fenceScaleWords(fence), [...SEVERITIES]);
  assert.ok(fence.includes('"+N more"'), 'fence lost the "+N more" sentence');
  assert.ok(fence.includes('`STATUS: {WORD}`'), 'fence lost the `STATUS: {WORD}` line');

  const tableRows = fence.split('\n').filter((l) => l.startsWith('|'));
  assert.equal(tableRows.length, 4, 'header, separator and two example rows');
  const reply = `${tableRows.join('\n')}\n| +3 more | | | |\n\nSTATUS: DONE`;
  const got = parseLensReply(reply);
  assert.equal(got.findings.length, 2);
  assert.equal(got.overflow, 3);
  assert.equal(got.status, 'ok');
  assert.equal(got.parse, 'ok');

  // Go-red control: an added column must fail the header check.
  const widened = fence.replace('| Severity | Path:Line | Finding | Evidence |', '| Severity | Path:Line | Finding | Evidence | Fix |');
  assert.notEqual(widened, fence);
  assert.throws(() => assert.deepStrictEqual(fenceHeaderCells(widened), [...BRIEF_HEADER]), assert.AssertionError);
});
