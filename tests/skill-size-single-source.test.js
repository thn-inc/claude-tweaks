// tests/skill-size-single-source.test.js — the durable anti-scatter guard (#3311).
//
// plugin/bin/lib/skill-audit/budgets.js is the one place in tests/ or plugin/bin/
// that may define a skill-size number (decision 0024). This test fails when any
// other file there (a) declares a size-limit constant — a CEILING/BUDGET name
// carrying BYTE(S)/CHAR(S) — assigned a number, or (b) compares a measure taken
// from a plugin/skills path against a numeric literal of 1024 or more (or an
// `N * 1024` expression). A skill path reaches a comparison through variables
// (`const p = path.join(ROOT, 'plugin', 'skills', …)`, then `read(p)`, then
// `bytes`), so references are tainted forward line by line, including into
// multi-line object literals and `for…of` bindings. Taint also seeds from a
// call to a skill-audit measurement export (`composedBytesReport`,
// `measureSkills`, …), so a size read through that API — with no literal
// skill path in sight — taints its result the same way. A comparison operand
// naming a plain identifier declared with a numeric literal of 1024 or more
// (or `N * 1024`) — `const maxBytes = 40960;` — resolves as that number too,
// so a lowercase, non-CEILING/BUDGET-named variable cannot launder a size
// limit past the guard. A size comparison whose operand is a named value the
// scanner still cannot resolve (an UPPER_CASE constant, or a name containing
// ceiling/budget/cap) is reported as `unclassified` — distinct from a
// violation, and never silently passed.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SINGLE_SOURCE = 'plugin/bin/lib/skill-audit/budgets.js';
// Named exceptions — each is a size number about something other than a shipped skill file.
const ALLOWLIST = new Map([
  ['tests/claude-md-budget.test.js', "CLAUDE.md's own line/byte budget — a different artifact from a shipped skill file"],
  ['tests/design-wrapper-review-surface-gate-prose.test.js', 'a 35 KB check proving a fixture discriminates, not a ceiling on a real file'],
]);
// The rail's own names (budgets.js) are the single source, never an unresolved operand.
const RAIL_NAMES = new Set(['RAIL_BYTES', 'RAIL_LINES', 'RAIL_TOKENS', 'DESCRIPTION_MAX_CHARS']);

const RULE_A = /\b(?:const|let|var)\s+([A-Z0-9_]*(?:CEILING|BUDGET)[A-Z0-9_]*_(?:BYTES|CHARS)|[A-Z0-9_]*_(?:BYTE|CHAR)S?_(?:CEILING|BUDGET)[A-Z0-9_]*)\s*=\s*([^;\n]*)/;
const SKILL_PATH = /plugin\/skills\b|['"`]skills\/|['"]skills['"]/;
const MEASURE_API = /\b(?:measuredTextBytes|measuredBytes|measureSkills|measureSubFiles|measureComposed|composedBytesReport|measureDescriptions|totalBytes|totalDescriptionChars|auditCorpus|auditText|bloatReport)\s*\(/;
// Bare size-named identifiers count too (`size`, `fileSize`, `skillBytes`): a
// helper like `const size = byteSize(…skills…)` hides the measuring call from the
// comparison line.
const SIZE_MEASURE = /\bBuffer\.byteLength\b|\bmeasuredBytes\b|\.bytes\b|\.size\b|\.max\b|\bbytes\b|\.length\b|\bsize\b|\b[a-z][\w$]*(?:Size|Bytes)\b/;
const COMPARISON = /(<=|>=|<|>)\s*(\(?\s*\d[\d_]*(?:\s*\*\s*1024)?\s*\)?|[A-Za-z_$][\w$.]*(?:\[[^\]]*\])?)/g;
const NUMERIC = /^\(?\s*(\d[\d_]*)(\s*\*\s*1024)?\s*\)?$/;
// A plain (not ALL_CAPS, not ceiling/budget/cap-named) identifier declared
// with a numeric literal of 1024 or more (or `N * 1024`) is itself a
// size-limit value, even though its own name gives no hint — `const
// maxBytes = 40960` reads the same as the literal everywhere it is later
// compared against a tainted size. Resolved forward, line by line, the same
// direction taint already propagates.
const NUM_LITERAL_DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\(?\s*\d[\d_]*(?:\s*\*\s*1024)?\s*\)?)\s*;?\s*$/;

function escapeName(name) {
  return name.replace(/\$/g, '\\$');
}

// A NUMERIC match is "large" when it carries the `* 1024` multiplier, or its
// bare value is already >= 1024 — the one rule both size-literal checks below apply.
function isLargeNumeric(match) {
  return Boolean(match[2]) || Number(match[1].replace(/_/g, '')) >= 1024;
}

// scanText(text) -> { violations: [{ line, rule, text }], unclassified: [{ line, operand, text }] }
function scanText(text) {
  const violations = [];
  const unclassified = [];
  const tainted = new Set();
  const numericLiterals = new Set();
  let openLiteral = null;
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/(^|[^:'"`])\/\/.*$/, '$1');
    // Rules are read from code only: string and template contents are removed
    // (a path inside a string still taints — SKILL_PATH reads `line`, not `code`).
    const code = line.replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
    const a = code.match(RULE_A);
    if (a && /\d/.test(a[2])) violations.push({ line: n, rule: 'a', text: raw.trim() });
    const numDecl = code.match(NUM_LITERAL_DECL);
    if (numDecl) {
      const val = numDecl[2].match(NUMERIC);
      if (val && isLargeNumeric(val)) numericLiterals.add(numDecl[1]);
    }
    const refsTainted = [...tainted].some((t) => new RegExp(`(^|[^\\w$])${escapeName(t)}([^\\w$]|$)`).test(line));
    const refsSkill = SKILL_PATH.test(line) || MEASURE_API.test(line) || refsTainted;
    if (openLiteral) {
      if (refsSkill) tainted.add(openLiteral);
      if (/^\s*[}\]]/.test(line)) openLiteral = null;
    }
    const decl = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([{[]?)/);
    if (decl) {
      if (refsSkill) tainted.add(decl[1]);
      if (decl[2] && !/[}\]]\s*[;,)]?\s*$/.test(line)) openLiteral = decl[1];
    }
    const forOf = line.match(/\bfor\s*\(\s*(?:const|let|var)\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)\s+of\b/);
    if (forOf && refsSkill) for (const name of (forOf[1].match(/[A-Za-z_$][\w$]*/g) || [])) tainted.add(name);
    if (!refsSkill) return;
    if (!SIZE_MEASURE.test(code)) return;
    let flagged = false;
    for (const m of code.matchAll(COMPARISON)) {
      const op = m[2].trim();
      const num = op.match(NUMERIC);
      if (num) {
        if (isLargeNumeric(num)) flagged = true;
        continue;
      }
      const last = op.split('.').pop().replace(/\[.*$/, '');
      if (RAIL_NAMES.has(last)) continue;
      if (numericLiterals.has(last)) { flagged = true; continue; }
      if (/^[A-Z][A-Z0-9_]*$/.test(last) || /ceiling|budget|cap\b/i.test(last)) {
        unclassified.push({ line: n, operand: op, text: raw.trim() });
      }
    }
    if (flagged) violations.push({ line: n, rule: 'b', text: raw.trim() });
  });
  return { violations, unclassified };
}

function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('AC3.1: no file under tests/ or plugin/bin/ other than budgets.js defines or compares a skill-size number, and none is unclassified', () => {
  const violations = [];
  const unclassified = [];
  for (const abs of [...walkJs(path.join(ROOT, 'tests')), ...walkJs(path.join(ROOT, 'plugin', 'bin'))]) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel === SINGLE_SOURCE || ALLOWLIST.has(rel)) continue;
    const r = scanText(readText(abs));
    for (const v of r.violations) violations.push(`${rel}:${v.line} (rule ${v.rule}): ${v.text}`);
    for (const u of r.unclassified) unclassified.push(`${rel}:${u.line} [${u.operand}]: ${u.text}`);
  }
  assert.deepStrictEqual(violations, [], `skill-size numbers outside ${SINGLE_SOURCE} — move them to budgets.js or delete them:\n${violations.join('\n')}`);
  assert.deepStrictEqual(unclassified, [], `size comparisons the scanner cannot classify — resolve or allowlist with a reason:\n${unclassified.join('\n')}`);
});

test('every allowlist entry names an existing file and carries a reason', () => {
  for (const [rel, reason] of ALLOWLIST) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `allowlisted file is gone: ${rel}`);
    assert.ok(reason.length > 20, `allowlist entry needs a reason: ${rel}`);
  }
});

test('AC3.1: self-test — rule (a) goes red on a size-limit constant', () => {
  assert.equal(scanText('const FOO_CEILING_BYTES = 30 * 1024;').violations[0].rule, 'a');
  assert.equal(scanText('const PR_FIRST_BYTE_CEILING = 31304;').violations[0].rule, 'a');
  assert.deepStrictEqual(scanText("const FOO_CEILING_BYTES = require('./x');").violations, []);
});

test('AC3.1: self-test — rule (b) goes red on a skill-path size compared to a literal', () => {
  const fixture = "assert.ok(Buffer.byteLength(read('plugin/skills/x.md'), 'utf8') <= 28 * 1024);";
  assert.equal(scanText(fixture).violations[0].rule, 'b');
  const plain = "assert.ok(Buffer.byteLength(read('plugin/skills/x.md'), 'utf8') <= 40893);";
  assert.equal(scanText(plain).violations[0].rule, 'b');
});

test('AC3.1: self-test — rule (b) resolves a lowercase literal-holding identifier used as the comparison operand', () => {
  const fixture = [
    "const p = path.join(ROOT, 'plugin', 'skills', 'x.md');",
    'const md = readText(p);',
    "const bytes = Buffer.byteLength(md, 'utf8');",
    'const maxBytes = 40960;',
    'assert.ok(bytes <= maxBytes);',
  ].join('\n');
  assert.equal(scanText(fixture).violations[0].rule, 'b');
});

test('AC3.1: self-test — rule (b) catches a tainted .length compared to a literal', () => {
  const fixture = [
    "const p = path.join(ROOT, 'plugin', 'skills', 'x.md');",
    'const md = readText(p);',
    'assert.ok(md.length <= 40960);',
  ].join('\n');
  assert.equal(scanText(fixture).violations[0].rule, 'b');
});

test('self-test: rule (b) catches a bare size-named result of a measuring helper (the shape #3311 first missed)', () => {
  const fixture = [
    'const SCAN_BASELINE = 42466;',
    'const WRAP_UP_LIMIT = WRAP_UP_BASE + 300;',
    "const size = byteSize('plugin', 'skills', 'tidy', 'x.md');",
    'assert.ok(size <= SCAN_BASELINE);',
    'assert.ok(size <= WRAP_UP_LIMIT);',
  ].join('\n');
  const r = scanText(fixture);
  assert.deepStrictEqual(r.violations.map((v) => v.line), [4]);
  assert.deepStrictEqual(r.unclassified.map((u) => u.line), [5]);
});

test('self-test: rule (b) follows a skill path through variables, literals, and for...of bindings', () => {
  const chained = [
    "const p = path.join(ROOT, 'plugin', 'skills', '_shared', 'x.md');",
    'const md = readText(p);',
    "const bytes = Buffer.byteLength(md, 'utf8');",
    'assert.ok(bytes < 8192);',
  ].join('\n');
  assert.deepStrictEqual(scanText(chained).violations.map((v) => v.line), [4]);
  const mapped = [
    'const BUDGETS = {',
    "  'plugin/skills/flow/a.md': 20480,",
    '};',
    'for (const [p, budget] of Object.entries(BUDGETS)) {',
    "  const bytes = Buffer.byteLength(read(p), 'utf8');",
    '  assert.ok(bytes < budget);',
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanText(mapped).unclassified.map((u) => u.line), [6]);
});

test('self-test: rule (b) follows a size read through the skill-audit API', () => {
  const viol = [
    'const rows = composedBytesReport(PLUGIN_ROOT);',
    'for (const row of rows) {',
    '  assert.ok(row.max < 40000);',
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanText(viol).violations.map((v) => v.line), [3]);
  const unclass = [
    'const rows = composedBytesReport(PLUGIN_ROOT);',
    'for (const row of rows) {',
    '  assert.ok(row.max < SOME_LIMIT);',
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanText(unclass).unclassified.map((u) => u.line), [3]);
});

test('self-test: what the scanner must not flag', () => {
  // A fixture path with no skills reference, a comparison inside a message string,
  // a comparison against the rail, and a small literal are all clean.
  assert.deepStrictEqual(scanText("const t = path.join(dir, 'big.md');\nassert.ok(fs.statSync(t).size >= 60000);"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const s = read('plugin/skills/x.md');\nassert.ok(s.includes('a'), 'expected < 8000 bytes');"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const bytes = Buffer.byteLength(read('plugin/skills/x.md'));\nassert.ok(bytes <= RAIL_BYTES);"), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText("const n = measureSkills('plugin/skills');\nassert.ok(n.bytes > 0);"), { violations: [], unclassified: [] });
});

test('self-test: a for...of destructure that binds no names neither throws nor taints', () => {
  // `for (const [] of x)` is valid JS with no bindings; the scanner must skip it, with or without a skill reference.
  const after = ['const bytes = rows.length;', 'assert.ok(bytes < 8192);'];
  const bare = ['for (const [] of x) {', '}', ...after].join('\n');
  const withSkill = ["for (const [] of readAll('plugin/skills/x.md')) {", '}', ...after].join('\n');
  assert.deepStrictEqual(scanText(bare), { violations: [], unclassified: [] });
  assert.deepStrictEqual(scanText(withSkill), { violations: [], unclassified: [] });
});

module.exports = { scanText };
