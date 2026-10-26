'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { listTestFiles } = require('../tools/run-tests');
const { readText } = require('./helpers/read-skill');

// Wall-clock timing budgets live in perf/ (run by `npm run test:perf`), never in
// tests/ (`npm test`): a budget flakes under load, and a flaky failure trains readers
// to dismiss real ones (docs/plugin-structure.md, issue #107). This scan fails any
// budget under tests/**/*.test.js (#3412, #3491). A budget is a `<`, `<=`, `>` or `>=`
// comparison whose one side is a wall-clock reading (performance.now, Date.now,
// process.hrtime[.bigint]), directly or through a name or helper derived from one in
// the same test body, and whose other side is a numeric literal or constant. The scan
// covers every test file `npm test` runs. Each budget in it must be pinned on ALLOWLIST
// by its comparison text, with a reason.
//
// Known limits. (1) A duration measured inside the code under test is not seen: a
// helper that times its own work and returns a plain number hands the test a value
// that is not wall-clock-derived here. (2) Blank mode can erase live code when the
// stripper misreads a regex after `)` or `}`. stripperVerdict is given the same
// blank-mode text the matcher scans and catches that only when the text stops
// compiling; a misread that still compiles goes unseen. (3) A budget whose bound is
// not a literal or a numeric `const` in the file (`cond ? 500 : 200`, an imported
// TIMEOUT_MS) is not seen. (4) A busy-wait condition (`while (Date.now() - t < 50)`)
// is a budget by this definition and is flagged; pin it. (5) Taint is coarse: an
// object or array holding a timing taints its name, and a name tainted in one test()
// of a describe(...) block taints the sibling tests in that block, so a timing-free
// comparison can be flagged; pin it with a reason. The scan's floor is
// MOVED_TO_PERF: the moved budgets' texts must still match in perf/, so a dead or
// blinded matcher fails there.

const ROOT = path.join(__dirname, '..');
const PLUGIN_STRUCTURE = path.join(ROOT, 'docs', 'plugin-structure.md');

const WALL_CLOCK = /\b(?:performance\s*\.\s*now|Date\s*\.\s*now|process\s*\.\s*hrtime(?:\s*\.\s*bigint)?)\s*\(/;
// A call whose result carries its arguments' timing through: numeric wrappers, and the
// wall-clock reads themselves. Any other call is opaque: its arguments are ignored.
const TRANSPARENT_CALLEES = new Set([
  'Number', 'BigInt', 'parseInt', 'parseFloat', 'round', 'floor', 'ceil', 'abs', 'trunc', 'max', 'min',
  'now', 'hrtime', 'bigint',
]);
// `if (...)` and friends look like calls but are not: their conditions must stay visible.
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'typeof', 'void', 'await', 'yield', 'function', 'with',
]);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

function isOpaqueCall(text, openIndex) {
  let j = openIndex - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0 || !/[\w$)\]]/.test(text[j])) return false;
  let k = j;
  while (k >= 0 && /[\w$]/.test(text[k])) k--;
  const callee = text.slice(k + 1, j + 1);
  return !TRANSPARENT_CALLEES.has(callee) && !CONTROL_KEYWORDS.has(callee);
}

// `expr` with the argument list of each outermost opaque call blanked, so a call's
// result is timing-free unless its callee is transparent: `gitChurn(root, Date.now())`
// is not a timing, `Number(t1 - t0)` and `ms(t)` (a tainted helper) are.
function blankOpaqueArgs(expr) {
  const out = expr.split('');
  const open = [];
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (OPEN.has(ch)) {
      open.push({ index: i, opaque: ch === '(' && isOpaqueCall(expr, i) });
    } else if (CLOSE.has(ch)) {
      const frame = open.pop();
      if (frame && frame.opaque && !open.some((f) => f.opaque)) {
        for (let k = frame.index + 1; k < i; k++) if (out[k] !== '\n') out[k] = ' ';
      }
    }
  }
  return out.join('');
}

// Identifiers in `text`, excluding property names after a `.`.
function identifiersOf(text) {
  const ids = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(text))) {
    if (!/\.\s*$/.test(text.slice(0, m.index))) ids.push(m[0]);
  }
  return ids;
}

function isWallClockDerived(expr, tainted) {
  const text = blankOpaqueArgs(expr);
  return WALL_CLOCK.test(text) || identifiersOf(text).some((id) => tainted.has(id));
}

// A numeric budget: numeric literals and names in `numeric` (budget constants), with
// only operators and parentheses between them, and at least one literal.
function isNumericBudget(expr, numeric) {
  const reduced = expr.replace(
    /\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?|[A-Za-z_$][\w$]*/g,
    (tok) => (/^\d/.test(tok) || numeric.has(tok) ? '0' : tok),
  );
  return /^[\d\s()+\-*/%.]+$/.test(reduced) && /\d/.test(reduced);
}

// Assignments in `text`: `NAME = expr`, `NAME += expr`, and `const|let|var NAME = expr`
// with a comma list (`const A = 4, B = 3`) binding each name. An expression ends at a
// depth-0 `,`, `;`, a newline after it has begun (a newline while it is still empty,
// as in `const e =\n  Date.now() - t;`, does not end it) or an unmatched closer, and
// scanning resumes there, so text inside an expression is never read as an assignment
// of its own. `keyword` is the declaration keyword (null for a plain assignment). A
// property assignment (`o.x = …`) is skipped: `x` is not a binding.
function assignments(text) {
  const found = [];
  const re = /(?:\b(const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*[+\-*]?=(?![=>])/g;
  let decl = null; // declaration keyword a depth-0 comma continues
  let m;
  while ((m = re.exec(text))) {
    if (/\.\s*$/.test(text.slice(0, m.index))) continue;
    const keyword = m[1] || decl;
    let depth = 0;
    let k = re.lastIndex;
    for (; k < text.length; k++) {
      const ch = text[k];
      if (OPEN.has(ch)) depth++;
      else if (CLOSE.has(ch)) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (ch === ',' || ch === ';')) break;
      else if (depth === 0 && ch === '\n' && /\S/.test(text.slice(re.lastIndex, k))) break;
    }
    found.push({ name: m[2], expr: text.slice(re.lastIndex, k), keyword });
    decl = text[k] === ',' ? keyword : null;
    re.lastIndex = k;
  }
  return found;
}

// Adds every name bound to a wall-clock value (directly or through a chain) to
// `tainted`, and every `const NAME = <numeric>` to `numeric`, to a fixpoint.
function grow(text, tainted, numeric) {
  const bindings = assignments(text);
  for (const b of bindings) {
    if (b.keyword === 'const' && isNumericBudget(b.expr, numeric)) numeric.add(b.name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of bindings) {
      if (!tainted.has(b.name) && isWallClockDerived(b.expr, tainted)) {
        tainted.add(b.name);
        changed = true;
      }
    }
  }
}

// Depth-0 statements of blanked text, split at a depth-0 `;` or newline (a newline
// after a trailing `=` does not split: `const MAX =\n  500;` is one statement). Each
// top-level test(...) or describe(...) call is one statement: the "same test body" scope.
function topLevelStatements(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  const close = (end) => {
    if (s.slice(start, end).trim()) out.push({ text: s.slice(start, end), offset: start });
    start = end + 1;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ';') close(i);
    else if (depth === 0 && ch === '\n' && !/=\s*$/.test(s.slice(start, i))) close(i);
  }
  close(s.length);
  return out;
}

// `<`, `<=`, `>`, `>=` in `text`: not a shift (`<<`, `>>`, `>>>`) and not an arrow's `=>`.
function comparisonOperators(text) {
  const ops = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '<' && ch !== '>') continue;
    if (text[i + 1] === ch || text[i - 1] === ch) continue;
    if (ch === '>' && text[i - 1] === '=') continue;
    ops.push({ start: i, end: text[i + 1] === '=' ? i + 2 : i + 1 });
  }
  return ops;
}

// Does the character at `l` end a left operand, scanning backwards at depth 0?
function leftBoundary(s, l) {
  const ch = s[l];
  const prev = s[l - 1] || ' ';
  if (ch === ',' || ch === ';' || ch === '?' || ch === ':') return true;
  if ((ch === '&' || ch === '|') && prev === ch) return true;
  if (ch === '>' && prev === '=') return true; // the `>` of an arrow
  return ch === '=' && !'=!<>'.includes(prev) && !'=>'.includes(s[l + 1] || ' ');
}

// Operands of the comparison at [start, end) in blanked `s`, and the source span
// [from, to) they cover (for the offender text). The left operand stops at a boundary
// or an unmatched opener, the right at a boundary or an unmatched closer; a leading
// return/throw/await/yield is dropped from the left.
function operands(s, start, end) {
  let depth = 0;
  let l = start - 1;
  for (; l >= 0; l--) {
    const ch = s[l];
    if (CLOSE.has(ch)) depth++;
    else if (OPEN.has(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && leftBoundary(s, l)) break;
  }
  depth = 0;
  let r = end;
  for (; r < s.length; r++) {
    const ch = s[r];
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '?' || ch === ':')) break;
    else if (depth === 0 && (ch === '&' || ch === '|') && s[r + 1] === ch) break;
  }
  const left = s.slice(l + 1, start).replace(/^\s*(?:return|throw|await|yield)\b/, '');
  return { left, right: s.slice(end, r), from: l + 1, to: r };
}

// -> [{ line, text }]: one entry per budget comparison in `src`. `line` is the 1-based
// line of the comparison operator; `text` is the source comparison, whitespace-collapsed.
// `stripped` is the blank-mode text of `src`; evaluate passes the same text to
// stripperVerdict, so the misparse check judges exactly what this matcher reads.
function findBudgetAssertions(src, stripped = stripComments(src, { literals: 'blank' })) {
  const fileTainted = new Set();
  const fileNumeric = new Set();
  const statements = topLevelStatements(stripped);
  for (const st of statements) {
    if (/^\s*(?:const|let|var)\b/.test(st.text)) grow(st.text, fileTainted, fileNumeric);
  }
  const hits = [];
  for (const st of statements) {
    const tainted = new Set(fileTainted);
    const numeric = new Set(fileNumeric);
    grow(st.text, tainted, numeric);
    for (const op of comparisonOperators(st.text)) {
      const { left, right, from, to } = operands(st.text, op.start, op.end);
      const leftTiming = isWallClockDerived(left, tainted);
      const rightTiming = isWallClockDerived(right, tainted);
      const flagged =
        (leftTiming && !rightTiming && isNumericBudget(right, numeric)) ||
        (rightTiming && !leftTiming && isNumericBudget(left, numeric));
      if (!flagged) continue;
      const line = stripped.slice(0, st.offset + op.start).split('\n').length;
      const text = src.slice(st.offset + from, st.offset + to).replace(/\s+/g, ' ').trim();
      hits.push({ line, text });
    }
  }
  return hits;
}

function budgetOffender(rel, hit) {
  return (
    `${rel}:${hit.line}: ${hit.text} — a wall-clock budget under tests/ flakes under load; ` +
    'move it to perf/ (run by npm run test:perf), or pin this site in ALLOWLIST with a reason. ' +
    'See docs/plugin-structure.md.'
  );
}

// files: { relPosixPath: source }. allowlist: { relPosixPath: { sites, reason } }, where
// `sites` pins the whitespace-collapsed text of each budget the file may keep (one entry
// per site; a repeated text is pinned once per occurrence).
// -> one offender line per budget not pinned (every budget in a file with no entry), per
// pinned site no longer present, per entry with no reason or no pinned sites, per entry
// whose file is absent, and per file the stripper cannot judge. [] means conformant.
function evaluate(files, allowlist) {
  const offenders = [];
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      offenders.push(`${rel}: allowlist entry has no reason`);
    }
    if (!entry || !Array.isArray(entry.sites) || entry.sites.length === 0 || entry.sites.some((t) => typeof t !== 'string' || t === '')) {
      offenders.push(`${rel}: allowlist entry has no pinned sites (sites: [the budget texts])`);
    }
  }
  for (const rel of Object.keys(allowlist)) {
    if (!(rel in files)) offenders.push(`${rel}: allowlist entry has no matching file under tests/`);
  }
  for (const [rel, src] of Object.entries(files)) {
    const stripped = stripComments(src, { literals: 'blank' });
    const verdict = stripperVerdict(src, stripped);
    if (verdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
      continue;
    }
    const entry = allowlist[rel];
    const unmatched = entry && Array.isArray(entry.sites) ? [...entry.sites] : [];
    for (const hit of findBudgetAssertions(src, stripped)) {
      const at = unmatched.indexOf(hit.text);
      if (at === -1) offenders.push(budgetOffender(rel, hit));
      else unmatched.splice(at, 1);
    }
    for (const text of unmatched) {
      offenders.push(
        `${rel}: allowlist entry pins a site that is no longer present: "${text}"; remove it from ALLOWLIST ` +
          '(delete the entry when none remain).',
      );
    }
  }
  return offenders;
}

// Empty since #3939 moved every pinned budget to perf/. An entry is for a timing that is
// inseparable from a functional assertion: `file: { sites: [comparison texts], reason }`,
// where the reason says why it cannot move. A new, changed or removed pin fails the scan.
const ALLOWLIST = {};

// Fixtures are single-quoted string arrays, never template literals.
const DIRECT = [
  "test('a', () => {",
  '  const start = performance.now();',
  '  run();',
  '  const elapsed = performance.now() - start;',
  '  assert.ok(elapsed < 200);',
  '  assert.ok(performance.now() - start < 300);',
  '});',
].join('\n');

const MIXED = [
  "test('b', () => {",
  '  const t0 = Date.now();',
  '  assert.ok(Date.now() - t0 < 600);',
  '  const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;',
  '  const t = process.hrtime.bigint();',
  '  assert.ok(ms(t) < 50);',
  '  const elapsed = Date.now() - t0;',
  '  assert.ok(200 > elapsed);',
  '  const BUDGET_MS = 200;',
  '  assert.ok(elapsed <= BUDGET_MS);',
  '  assert.ok(',
  '    elapsed < 1000,',
  "    'msg'",
  '  );',
  '  if (Date.now() - t0 > 900) throw new Error(\'slow\');',
  '  const e2 =',
  '    Date.now() - t0;',
  '  assert.ok(e2 < 700);',
  '  assert.ok(elapsed < 1e3);',
  '});',
].join('\n');

// `elapsed` is wall-clock-derived here, so each literal or comment below would be a
// budget if the stripper left it in place: the negatives pass only because they are blanked.
const NOT_FLAGGED = [
  "test('a', () => {",
  '  const t0 = Date.now();',
  '  const elapsed = Date.now() - t0;',
  '  // elapsed < 200',
  "  assert.ok(true, 'elapsed < 200, see log');",
  '  const note = `elapsed < 200`;',
  '  const elapsedMs = Date.now() - t0;',
  '  const baselineMs = Date.now() - t0;',
  '  assert.ok(elapsedMs < MAX_RATIO * baselineMs);',
  "  assert.ok(gitChurn(root, 'pkg', Date.now(), { recursive: false }) >= 1);",
  '  assert.ok(claim.expiresAt > Date.now());',
  '  for (let i = 0; i < 3; i++) {}',
  '});',
  "test('b', () => {",
  '  const start = 5;',
  '  assert.ok(start < 10);',
  '});',
].join('\n');

test('AC1.1: flags a performance.now() budget, direct or through a variable', () => {
  assert.deepEqual(findBudgetAssertions(DIRECT).map((h) => h.line), [5, 6]);
});

test('flags Date.now, process.hrtime.bigint via a helper, a reversed operand, a numeric-const budget, a multi-line assert, a budget inside an if condition, a multi-line assignment and an exponent literal', () => {
  assert.deepEqual(findBudgetAssertions(MIXED).map((h) => h.line), [3, 6, 8, 10, 12, 15, 18, 19]);
});

test('does not flag a comment, a message string, template text, a ratio of two timings, a timestamp call argument, a timestamp freshness check, a loop bound, or a same-named untainted variable in another test', () => {
  assert.deepEqual(findBudgetAssertions(NOT_FLAGGED), []);
});

test('a budget constant wrapped after `=` at the top level is still a numeric budget', () => {
  const wrapped = [
    'const BUDGET_MS =',
    '  200;',
    "test('w', () => {",
    '  const t0 = Date.now();',
    '  assert.ok(Date.now() - t0 <= BUDGET_MS);',
    '});',
  ].join('\n');
  assert.deepEqual(findBudgetAssertions(wrapped).map((h) => h.line), [5]);
});

test('AC1.1: evaluate names file:line, the perf/ pointer and docs/plugin-structure.md for an un-allow-listed budget', () => {
  const offenders = evaluate({ 'tests/x.test.js': DIRECT }, {});
  assert.equal(offenders.length, 2);
  for (const line of offenders) {
    assert.match(line, /^tests\/x\.test\.js:(5|6): /);
    assert.match(line, /perf\//);
    assert.match(line, /npm run test:perf/);
    assert.match(line, /docs\/plugin-structure\.md/);
  }
});

// Asserts `line` is the standard budget offender: file:line, the budget text, the perf/
// pointer, `npm run test:perf` and the docs citation.
function assertStandardOffender(line, rel, lineNo, text) {
  assert.ok(line.startsWith(`${rel}:${lineNo}: ${text} `), line);
  assert.match(line, /perf\//);
  assert.match(line, /npm run test:perf/);
  assert.match(line, /docs\/plugin-structure\.md/);
}

test('AC1: an allow-listed file is pinned by site text: a new budget, a swapped budget or a stale pin fails with the standard message', () => {
  const entry = { sites: ['elapsed < 200', 'performance.now() - start < 300'], reason: 'x' };
  const pinned = { 'tests/x.test.js': entry };
  assert.deepEqual(evaluate({ 'tests/x.test.js': DIRECT }, pinned), []);

  // A third budget added to a file that already has an entry: file:line, perf/ pointer, no "raise the count" steer.
  const added = DIRECT.replace('  assert.ok(performance.now() - start < 300);', '  assert.ok(performance.now() - start < 300);\n  assert.ok(elapsed <= 900);');
  const addedOut = evaluate({ 'tests/x.test.js': added }, pinned);
  assert.equal(addedOut.length, 1);
  assertStandardOffender(addedOut[0], 'tests/x.test.js', 7, 'elapsed <= 900');
  assert.ok(!/update its ALLOWLIST/.test(addedOut[0]));

  // Swap: one site removed, a different one added. The count is unchanged, the scan still fails.
  const swapped = DIRECT.replace('elapsed < 200', 'elapsed < 250');
  const swappedOut = evaluate({ 'tests/x.test.js': swapped }, pinned);
  assert.equal(swappedOut.length, 2);
  assertStandardOffender(swappedOut[0], 'tests/x.test.js', 5, 'elapsed < 250');
  assert.match(swappedOut[1], /^tests\/x\.test\.js: .*no longer present: "elapsed < 200"/);

  // Removed: a pinned text that is gone is a stale entry.
  const removed = DIRECT.replace('  assert.ok(elapsed < 200);\n', '');
  const removedOut = evaluate({ 'tests/x.test.js': removed }, pinned);
  assert.equal(removedOut.length, 1);
  assert.match(removedOut[0], /^tests\/x\.test\.js: .*no longer present: "elapsed < 200"/);

  // A pinned text covers one site: a second identical budget is an offender.
  const twice = ["test('a', () => {", '  const elapsed = Date.now() - 1;', '  assert.ok(elapsed < 200);', '  assert.ok(elapsed < 200);', '});'].join('\n');
  const twiceOut = evaluate({ 'tests/x.test.js': twice }, { 'tests/x.test.js': { sites: ['elapsed < 200'], reason: 'x' } });
  assert.equal(twiceOut.length, 1);
  assertStandardOffender(twiceOut[0], 'tests/x.test.js', 4, 'elapsed < 200');
});

test('evaluate fails an entry with no reason, an entry with no pinned sites, an entry for a missing file, and a non-ok stripper verdict', () => {
  const noReason = evaluate({ 'tests/x.test.js': DIRECT }, { 'tests/x.test.js': { sites: ['elapsed < 200', 'performance.now() - start < 300'], reason: '' } });
  assert.equal(noReason.length, 1);
  assert.match(noReason[0], /tests\/x\.test\.js: .*no reason/);

  const countOnly = evaluate({ 'tests/x.test.js': DIRECT }, { 'tests/x.test.js': { count: 2, reason: 'x' } });
  assert.ok(countOnly.some((line) => /^tests\/x\.test\.js: allowlist entry has no pinned sites/.test(line)), countOnly.join('\n'));

  const missing = evaluate({}, { 'tests/gone.test.js': { sites: ['elapsed < 1'], reason: 'x' } });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /tests\/gone\.test\.js: .*no matching file/);

  const unparseable = evaluate({ 'tests/bad.test.js': 'const a = ;' }, {});
  assert.deepEqual(unparseable, [`tests/bad.test.js: ${STRIPPER_VERDICT_MESSAGES.unparseable}`]);

  const misparsed = evaluate({ 'tests/bad.test.js': "if (x) /'/.test(x); const b = 'p//q';" }, {});
  assert.deepEqual(misparsed, [`tests/bad.test.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('evaluate judges the verdict on the same blank-mode text the matcher scans: a regex misread that erases a live budget is an offender, not a clean file', () => {
  // Keep mode compiles this; blank mode reads `/'/.test(s); ... = '` as a string and erases the budget.
  const erased = "if (x) /'/.test(s); assert.ok(performance.now() - t < 200); const q = 'a';";
  assert.deepEqual(evaluate({ 'tests/bad.test.js': erased }, {}), [`tests/bad.test.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

// Every test file `npm test` runs (tools/run-tests.js's DEFAULT_ROOTS), keyed by its
// POSIX path relative to the repo root: the scanned set is the run set by construction.
function readTestFiles() {
  const files = {};
  for (const full of listTestFiles(ROOT)) {
    files[path.relative(ROOT, full).replace(/\\/g, '/')] = readText(full);
  }
  return files;
}

test('AC1.1, AC3.1: every tests/**/*.test.js passes the scan against ALLOWLIST', () => {
  const files = readTestFiles();
  assert.ok('tests/wall-clock-budget-conformance.test.js' in files, 'the walk must reach this file');
  assert.ok(Object.keys(files).some((rel) => rel.startsWith('tools/upstream-drift/tests/')), 'the walk must reach the second root npm test runs');
  const offenders = evaluate(files, ALLOWLIST);
  assert.deepEqual(offenders, [], `wall-clock budgets under tests/:\n${offenders.join('\n')}`);
});

test('AC2.1: perf/ budgets are real matches but are never scanned', () => {
  assert.ok(!Object.keys(readTestFiles()).some((rel) => rel.startsWith('perf/')));
  const perf = readText(path.join(ROOT, 'perf', 'closing-keyword-linearity.test.js'));
  assert.ok(findBudgetAssertions(perf).length >= 1);
});

// Each budget moved out of tests/ by #3939, by its perf/ file and comparison text.
// With ALLOWLIST empty, these are the scan's floor: a blinded matcher drops them.
const MOVED_TO_PERF = {
  'perf/scale-readiness-linearity.test.js': ['elapsed < 1000', 'elapsed < 1000'],
  'perf/dream-redact-latency.test.js': ['Date.now() - started < 500'],
  'perf/gif-quantize-latency.test.js': ['elapsedMs < 5000'],
  'perf/git-retry-bounded-wait.test.js': ['elapsed < 1000'],
  'perf/premise-self-check-timeout.test.js': ['Date.now() - start < 4000'],
  'perf/session-failures-lock-wait.test.js': ['Date.now() - start < 2000', 'Date.now() - start < 2000'],
  'perf/flow-preflight-concurrency.test.js': ['Date.now() - t0 < 600'],
  'perf/wrap-up-pack-concurrency.test.js': ['wall < 600'],
  'perf/reconcile-time-bounds.test.js': ['elapsed < 2500', 'Date.now() - start < 1000'],
};

test('#3939 AC2.1: every budget moved out of tests/ is a real match in its perf/ file', () => {
  for (const [rel, sites] of Object.entries(MOVED_TO_PERF)) {
    const src = readText(path.join(ROOT, rel));
    assert.deepEqual(findBudgetAssertions(src).map((h) => h.text), sites,
      `${rel}: this pins #3939's moved budgets — update MOVED_TO_PERF if you changed the perf file's budget deliberately`);
  }
});

test('docs/plugin-structure.md still states the perf/ rule the failure message cites', () => {
  const doc = readText(PLUGIN_STRUCTURE);
  assert.match(doc, /^perf\/\s+→ Wall-clock timing budgets, run via `npm run test:perf`/m);
});
