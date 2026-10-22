'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// Wall-clock timing budgets live in perf/ (run by `npm run test:perf`), never in
// tests/ (`npm test`): a budget flakes under load, and a flaky failure trains readers
// to dismiss real ones (docs/plugin-structure.md, issue #107). This scan fails any
// budget under tests/**/*.test.js (#3412, #3491). A budget is a `<`, `<=`, `>` or `>=`
// comparison whose one side is a wall-clock reading (performance.now, Date.now,
// process.hrtime[.bigint]), directly or through a name or helper derived from one in
// the same test body, and whose other side is a numeric literal or constant. Every
// file with such a comparison must sit on ALLOWLIST with a reason.
//
// Known limits. (1) A duration measured inside the code under test is not seen: a
// helper that times its own work and returns a plain number hands the test a value
// that is not wall-clock-derived here. (2) Blank mode can erase live code when the
// stripper misreads a regex after `)` or `}`. stripperVerdict catches that only when
// the stripped text stops compiling; a misread that still compiles goes unseen. The
// exact per-file counts are this scan's floor: a dead or blinded matcher drifts every
// count, and the live-tree test fails on the drift.

const ROOT = path.join(__dirname, '..');
const TESTS_ROOT = path.join(ROOT, 'tests');
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
// depth-0 `,`, `;`, newline or unmatched closer, and scanning resumes there, so text
// inside an expression is never read as an assignment of its own. `keyword` is the
// declaration keyword (null for a plain assignment). A property assignment (`o.x = …`)
// is skipped: `x` is not a binding.
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
      } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) break;
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

// Depth-0 statements of blanked text, split at a depth-0 `;` or newline. Each
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
    else if (depth === 0 && (ch === ';' || ch === '\n')) close(i);
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
function findBudgetAssertions(src) {
  const s = stripComments(src, { literals: 'blank' });
  const fileTainted = new Set();
  const fileNumeric = new Set();
  const statements = topLevelStatements(s);
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
      const line = s.slice(0, st.offset + op.start).split('\n').length;
      const text = src.slice(st.offset + from, st.offset + to).replace(/\s+/g, ' ').trim();
      hits.push({ line, text });
    }
  }
  return hits;
}

// files: { relPosixPath: source }. allowlist: { relPosixPath: { count, reason } }.
// -> one offender line per budget in an un-allow-listed file, per file whose budget
// count differs from its entry's count, per entry with no reason, per entry whose file
// is absent, and per file the stripper cannot judge. [] means conformant.
function evaluate(files, allowlist) {
  const offenders = [];
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      offenders.push(`${rel}: allowlist entry has no reason`);
    }
  }
  for (const rel of Object.keys(allowlist)) {
    if (!(rel in files)) offenders.push(`${rel}: allowlist entry has no matching file under tests/`);
  }
  for (const [rel, src] of Object.entries(files)) {
    const verdict = stripperVerdict(src);
    if (verdict !== 'ok') {
      offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
      continue;
    }
    const hits = findBudgetAssertions(src);
    const allowed = allowlist[rel];
    if (!allowed) {
      for (const hit of hits) {
        offenders.push(
          `${rel}:${hit.line}: ${hit.text} — a wall-clock budget under tests/ flakes under load; ` +
            'move it to perf/ (run by npm run test:perf), or allow-list this file with a reason. ' +
            'See docs/plugin-structure.md.',
        );
      }
    } else if (hits.length !== allowed.count) {
      const lines = hits.map((h) => h.line).join(', ');
      offenders.push(
        `${rel}: ${hits.length} wall-clock budget(s) at line(s) ${lines || 'none'}, ` +
          `allow-listed ${allowed.count}; update its ALLOWLIST count and reason.`,
      );
    }
  }
  return offenders;
}

// The exact per-file audit record: each file's budget count, and a reason an author
// judged by reading the site.
const ALLOWLIST = {
  'tests/bin-lib/code-health/candidates-scale-readiness.test.js': { count: 2, reason: 'linearity guards: a 200-slash file and a 20k-dot chain must scan under a generous 1 s bound, catching quadratic backtracking; candidates to move to perf/.' },
  'tests/bin-lib/dream/scan.test.js': { count: 1, reason: 'redaction-latency guard: a 120k-char tool output must redact under 500 ms, catching an uncapped backtracking regex; candidate to move to perf/.' },
  'tests/bin-lib/flow/preflight.test.js': { count: 1, reason: 'parallelism check: three 150 ms probes must finish under 600 ms, a margin a serial run (450 ms of sleeps) nearly fits; candidate to move to perf/.' },
  'tests/bin-lib/gif/palette.test.js': { count: 1, reason: 'quantize-latency guard: a 400x300 frame must quantize and index under a generous 5 s; candidate to move to perf/.' },
  'tests/bin-lib/git-retry.test.js': { count: 1, reason: 'bounded-wait check: an injected fake sleep makes the retry loop instant, so elapsed under 1 s only catches a real sleep leaking through; candidate to move to perf/.' },
  'tests/bin-lib/health-core/premise-self-check.test.js': { count: 1, reason: 'bounded-wait check: a hung `sleep 5` with a 100 ms timeout must return before 4 s, checking the kill path; candidate to move to perf/.' },
  'tests/bin-lib/model-profiles/session-failures.test.js': { count: 2, reason: 'bounded-wait checks: a released lock must be taken before the 2 s timeout, and a never-released lock must degrade near a 50 ms timeout, under 2 s; candidates to move to perf/.' },
  'tests/bin-lib/wrap-up/pack.test.js': { count: 1, reason: 'parallelism check: eight 200 ms probes must finish under 600 ms, where a serial run takes 1.6 s; candidate to move to perf/.' },
  'tests/reconcile.test.js': { count: 2, reason: 'bounded-time checks: a preflight-gated reconcile under 2.5 s and a pre-exhausted budget under 1 s, both doing no real work with generous margins; candidates to move to perf/.' },
};

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
  '});',
].join('\n');

const NOT_FLAGGED = [
  "test('a', () => {",
  '  // elapsed < 200',
  "  assert.ok(true, 'took < 200ms');",
  '  const note = `took < 200`;',
  '  const t0 = Date.now();',
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

test('flags Date.now, process.hrtime.bigint via a helper, a reversed operand, a numeric-const budget, a multi-line assert and a budget inside an if condition', () => {
  assert.deepEqual(findBudgetAssertions(MIXED).map((h) => h.line), [3, 6, 8, 10, 12, 15]);
});

test('does not flag a comment, a message string, template text, a ratio of two timings, a timestamp call argument, a timestamp freshness check, a loop bound, or a same-named untainted variable in another test', () => {
  assert.deepEqual(findBudgetAssertions(NOT_FLAGGED), []);
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

test('evaluate fails a count drift either way, an entry with no reason, an entry for a missing file, and a non-ok stripper verdict', () => {
  const low = evaluate({ 'tests/x.test.js': DIRECT }, { 'tests/x.test.js': { count: 1, reason: 'x' } });
  assert.equal(low.length, 1);
  assert.match(low[0], /^tests\/x\.test\.js: /);

  const high = evaluate({ 'tests/x.test.js': DIRECT }, { 'tests/x.test.js': { count: 3, reason: 'x' } });
  assert.equal(high.length, 1);
  assert.match(high[0], /^tests\/x\.test\.js: /);

  const noReason = evaluate({ 'tests/x.test.js': DIRECT }, { 'tests/x.test.js': { count: 2, reason: '' } });
  assert.equal(noReason.length, 1);
  assert.match(noReason[0], /tests\/x\.test\.js: .*no reason/);

  const missing = evaluate({}, { 'tests/gone.test.js': { count: 1, reason: 'x' } });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /tests\/gone\.test\.js: .*no matching file/);

  const unparseable = evaluate({ 'tests/bad.test.js': 'const a = ;' }, {});
  assert.deepEqual(unparseable, [`tests/bad.test.js: ${STRIPPER_VERDICT_MESSAGES.unparseable}`]);

  const misparsed = evaluate({ 'tests/bad.test.js': "if (x) /'/.test(x); const b = 'p//q';" }, {});
  assert.deepEqual(misparsed, [`tests/bad.test.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

// Every tests/**/*.test.js, keyed by its POSIX path relative to the repo root.
function readTestFiles() {
  const files = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.js')) {
        files[path.relative(ROOT, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
      }
    }
  })(TESTS_ROOT);
  return files;
}

test('AC1.1, AC3.1: every tests/**/*.test.js passes the scan against ALLOWLIST', () => {
  const files = readTestFiles();
  assert.ok('tests/wall-clock-budget-conformance.test.js' in files, 'the walk must reach this file');
  const offenders = evaluate(files, ALLOWLIST);
  assert.deepEqual(offenders, [], `wall-clock budgets under tests/:\n${offenders.join('\n')}`);
});

test('AC2.1: perf/ budgets are real matches but are never scanned', () => {
  assert.ok(!Object.keys(readTestFiles()).some((rel) => rel.startsWith('perf/')));
  const perf = fs.readFileSync(path.join(ROOT, 'perf', 'closing-keyword-linearity.test.js'), 'utf8');
  assert.ok(findBudgetAssertions(perf).length >= 1);
});

test('docs/plugin-structure.md still states the perf/ rule the failure message cites', () => {
  const doc = fs.readFileSync(PLUGIN_STRUCTURE, 'utf8');
  assert.match(doc, /^perf\/\s+→ Wall-clock timing budgets, run via `npm run test:perf`/m);
});
