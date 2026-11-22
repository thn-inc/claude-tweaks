// guard-refusals probed-shape detectors linearity budget (#5590) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// tools/guard-refusals/shapes.js's git-text-late-var, quoted-backslash-space, equals-word and
// unterminated-quote detectors read one Bash call's text, which nothing bounds. Each case here is an
// input built from one detector's own alphabet, run through that detector alone, with its verdict and
// a 1000 ms budget. leadingAssignmentsEnd() is a hand scan because a regex over a run of `NAME=value;`
// statements can split a blank run every way.
// Found when written (2026-11-16): git-text-late-var first called staticNames(), which rescans the
// line once per assignment: 116 s and 221 s on the first two cases. It reads fixed windows now, and
// every case measured under 250 ms.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { DETECTORS } = require('../tools/guard-refusals/shapes');

const BUDGET_MS = 1000;
const detector = (id) => DETECTORS.find((d) => d.id === id).test;

const CASES = [
  { id: 'git-text-late-var', what: "'A=1; ' x 40000 after a git command, then a reference", text: `git x; ${'A=1; '.repeat(40000)}echo $A`, expect: true },
  { id: 'git-text-late-var', what: "a leading run of 'A=1; ' x 40000", text: `${'A=1; '.repeat(40000)}git log "$A"`, expect: false },
  { id: 'git-text-late-var', what: '200000 newlines after a leading assignment', text: `A=1${'\n'.repeat(200000)}git log "$A"`, expect: false },
  { id: 'git-text-late-var', what: '200000 spaces after a late value', text: `pwd; A=1${' '.repeat(200000)}; git log "$A"`, expect: true },
  { id: 'git-text-late-var', what: 'an assignment name of 200000 characters', text: `pwd; ${'A'.repeat(200000)}=1; git log`, expect: false },
  // Many lines: each line assigns and references the name again.
  { id: 'git-text-late-var', what: "'F=\"a\"\\ngrep git \"$F\"\\n' x 20000 after a command", text: `pwd\n${'F="a"\ngrep git "$F"\n'.repeat(20000)}`, expect: true },
  { id: 'equals-word', what: "' =1' x 60000 inside quotes", text: `grep "${' =1'.repeat(60000)}" f`, expect: false },
  { id: 'equals-word', what: "' =a' x 60000 in a heredoc body", text: `cat <<'EOF'\n${' =a'.repeat(60000)}\nEOF`, expect: false },
  { id: 'quoted-backslash-space', what: "'a\\\\ ' x 80000 outside quotes", text: `ls ${'a\\ '.repeat(80000)}`, expect: false },
  { id: 'quoted-backslash-space', what: "'a\\\\\\\\b' x 40000 inside quotes", text: `grep "${'a\\\\b'.repeat(40000)}" f`, expect: false },
  { id: 'unterminated-quote', what: 'a quote left open over 200000 characters', text: `grep "${'a'.repeat(200000)}`, expect: true },
  { id: 'unterminated-quote', what: '100000 quote pairs', text: '""'.repeat(100000), expect: false },
  { id: 'unterminated-quote', what: "'it''s\\n' x 40000 lines", text: "echo 'it''s'\n".repeat(40000), expect: false },
];

for (const { id, what, text, expect } of CASES) {
  test(`${id} stays linear: ${what}`, () => {
    const run = detector(id);
    const start = performance.now();
    const got = run(text);
    const elapsed = performance.now() - start;
    assert.strictEqual(got, expect, what);
    assert.ok(elapsed < BUDGET_MS, `${what}: took ${elapsed.toFixed(0)}ms`);
  });
}
