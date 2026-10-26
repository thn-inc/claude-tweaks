'use strict';
// Record #4171: the auto-merge short-circuit renders no Review Console, so a can't-tell
// Low-confidence/Contested finding was never filed before the merge closed the record and
// reconcile archived the run. This pins the prose that lists those findings, then files them
// or refuses the short-circuit (before acceptance labeling), and the FYI that names them.
//
// Live-corpus read (skill-prose-conformance-tests). Go-red proof [IL-105]: the order helper
// the pin uses also runs against the file text with the new paragraph removed.
// Whitespace collapsed on haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { FILED_LINE_RE, filedRecords } = require('../plugin/bin/lib/console/finding-outcomes');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const SHORT_CIRCUIT = collapse(readText(path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md')));
const CONSOLE = collapse(readText(path.join(ROOT, 'plugin/skills/wrap-up/review-console.md')));
const CEILING = collapse(readText(path.join(ROOT, 'plugin/skills/_shared/autonomy-ceiling.md')));
const SETTLE = collapse(readText(path.join(ROOT, 'plugin/skills/dispatch/settle-and-merge.md')));

const HEAD = "Can't-tell findings — before acceptance labeling";
const AFTER_BACKSTOP = 'never passes through shell quoting';
const BEFORE_LABELING = '**Both layers pass — acceptance labeling runs first';
const REFUSAL = "#{n} has {k} can't-tell finding(s) ({ids}) — {consoleAutoResolve not granted at {ceiling} | filing failed: {reason}}; short-circuit refused, Review Console renders normally";

// Every anchor an order comparison reads must be present first: indexOf's -1 would otherwise pass a
// `head > anchor` check vacuously.
function assertOrdered(text, { head, after, before, needles }) {
  for (const anchor of [after, before]) assert.ok(text.indexOf(anchor) >= 0, `anchor not found: ${anchor}`);
  const at = text.indexOf(head);
  assert.ok(at >= 0, `the paragraph is absent: ${head}`);
  assert.ok(at > text.indexOf(after), `the paragraph must follow ${after}`);
  assert.ok(at < text.indexOf(before), `the paragraph must precede ${before}`);
  const para = text.slice(at, text.indexOf(before));
  for (const needle of needles) assert.ok(para.includes(needle), `the paragraph must carry ${needle}`);
}

function assertShortCircuitOrder(text) {
  assertOrdered(text, {
    head: HEAD, after: AFTER_BACKSTOP, before: BEFORE_LABELING,
    needles: ['--list', 'consoleAutoResolve', "Can't-tell filings", 'short-circuit refused, Review Console renders normally', '"Any layer fails"', '— then continue below'],
  });
}

// The dispatch bundle Auto-merge gate is the other console-less merge: it applies the same step,
// per spec dir, before its own acceptance labeling, and falls through to its console on a refusal.
const GATE_HEAD = "Both layers pass — can't-tell findings before acceptance labeling (#4171)";
const GATE_AFTER = 'its log write was merely skipped';
const GATE_LABELING = '**Both layers pass — acceptance labeling runs first, for every member of the group.**';

function assertBundleGateOrder(text) {
  assertOrdered(text, {
    head: GATE_HEAD, after: GATE_AFTER, before: GATE_LABELING,
    needles: ["`wrap-up/auto-merge-short-circuit.md`'s \"Can't-tell findings\" step", '`{run-dir}/spec-{N}` in manifest order', 'consoleAutoResolve', '"Any layer fails"'],
  });
}

test('AC1.1: the short-circuit lists, then files or refuses, before acceptance labeling', () => {
  assert.doesNotThrow(() => assertShortCircuitOrder(SHORT_CIRCUIT));
});

test('AC1.1 go-red: the order helper throws once the paragraph is removed', () => {
  const start = SHORT_CIRCUIT.indexOf('**' + HEAD);
  assert.ok(start >= 0, 'paragraph opener not found');
  const removed = SHORT_CIRCUIT.slice(0, start) + SHORT_CIRCUIT.slice(SHORT_CIRCUIT.indexOf(BEFORE_LABELING));
  assert.throws(() => assertShortCircuitOrder(removed), /absent/);
});

test('AC1.1: the bundle Auto-merge gate files or refuses can\'t-tell findings before its acceptance labeling', () => {
  assert.doesNotThrow(() => assertBundleGateOrder(SETTLE));
});

test('AC1.1 go-red: the bundle-gate helper throws once the paragraph is removed, moved, or an anchor is gone', () => {
  const start = SETTLE.indexOf('**' + GATE_HEAD);
  assert.ok(start >= 0, 'bundle-gate paragraph opener not found');
  const end = SETTLE.indexOf(GATE_LABELING);
  const removed = SETTLE.slice(0, start) + SETTLE.slice(end);
  assert.throws(() => assertBundleGateOrder(removed), /absent/);
  const afterLabel = end + GATE_LABELING.length;
  const moved = SETTLE.slice(0, start) + SETTLE.slice(end, afterLabel) + ' ' + SETTLE.slice(start, end) + SETTLE.slice(afterLabel);
  assert.throws(() => assertBundleGateOrder(moved), /must precede/);
  assert.throws(() => assertBundleGateOrder(SETTLE.replace(GATE_AFTER, 'x')), /anchor not found/);
});

test('AC1.1: the refusal line never reads as a needs-human verdict', () => {
  assert.ok(SHORT_CIRCUIT.includes(REFUSAL), 'refusal template not found verbatim');
  // The skill file's own backticked line, not this test's constant: text appended after the
  // template (e.g. "— treated as needs-human") would still pass the includes() check above.
  const line = SHORT_CIRCUIT.match(/holds one line, `(#\{n\} has \{k\} can't-tell finding\(s\)[^`]*)`/);
  assert.ok(line, "the refusal's {text-file} line not found");
  assert.doesNotMatch(line[1], /needs-human/i);
});

test("AC1.1: the documented filed lines match the guard's reader", () => {
  const commands = [...CONSOLE.matchAll(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/log-decision\.js"[^`]*?--text '([^']*filed as #\{number\} \(work-fingerprint \{fingerprint\}\))'[^`]*/g)];
  const created = commands.find((m) => !/already/.test(m[1]));
  const deduped = commands.find((m) => /already filed as/.test(m[1]));
  assert.ok(created && deduped, 'review-console.md must spell out a log-decision command for both filed-line templates');
  for (const m of [created, deduped]) {
    for (const flag of ['--run "{item-run-dir}"', '--status AUTO', '--step "Queue write"']) {
      assert.ok(m[0].includes(flag), `a filed-line command is missing ${flag}: ${m[0]}`);
    }
  }
  // Built by the real producer (log-decision.js's formatEntry), not a hand-typed prefix.
  const lines = [created[1], deduped[1]].map((t) => formatEntry({
    status: 'AUTO', now: new Date(2026, 9, 25, 10, 0, 0), step: 'Queue write', reversibility: 'n/a',
    text: t.replace('{item}', 'tiebreak:aaaaaaaaaaaa').replace('{number}', '501').replace('{fingerprint}', 'consolefinding-0123abcd'),
  }));
  for (const line of lines) assert.match(line, FILED_LINE_RE);
  assert.strictEqual(filedRecords(lines.join('\n')).get('consolefinding-0123abcd'), 501);
});

test('AC2.1: both FYI sentences carry the --fyi sections', () => {
  const needle = 'console-filings.js" --run "$PIPELINE_RUN_DIR" --fyi';
  const withSections = `${needle}\` prints — Low-confidence, Contested, Dropped by tiebreak)`;
  const count = (s) => SHORT_CIRCUIT.split(s).length - 1;
  assert.ok(count(needle) >= 2, 'pr-first and local-merge FYI sentences must both name --fyi');
  assert.strictEqual(count(withSections), count(needle), 'every --fyi mention must name the Low-confidence, Contested and Dropped by tiebreak sections');
});

test("autonomy-ceiling names the short-circuit as a can't-tell filing caller", () => {
  const start = CEILING.indexOf('| `consoleAutoResolve`');
  assert.ok(start >= 0, 'consoleAutoResolve row not found');
  const row = CEILING.slice(start, CEILING.indexOf(' |', CEILING.indexOf('deduplicated by `work-fingerprint`', start)));
  assert.ok(row.includes("`wrap-up/auto-merge-short-circuit.md`'s Can't-tell findings"));
});
