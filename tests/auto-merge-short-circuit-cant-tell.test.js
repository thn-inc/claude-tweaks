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
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const SHORT_CIRCUIT = collapse(readText(path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md')));
const CONSOLE = collapse(readText(path.join(ROOT, 'plugin/skills/wrap-up/review-console.md')));
const CEILING = collapse(readText(path.join(ROOT, 'plugin/skills/_shared/autonomy-ceiling.md')));

const HEAD = "Can't-tell findings — before acceptance labeling";
const AFTER_BACKSTOP = 'never passes through shell quoting';
const BEFORE_LABELING = '**Both layers pass — acceptance labeling runs first';
const REFUSAL = "#{n} has {k} can't-tell finding(s) ({ids}) — {consoleAutoResolve not granted at {ceiling} | filing failed: {reason}}; short-circuit refused, Review Console renders normally";

function assertShortCircuitOrder(text) {
  const head = text.indexOf(HEAD);
  assert.ok(head >= 0, 'the Can\'t-tell findings paragraph is absent');
  assert.ok(head > text.indexOf(AFTER_BACKSTOP), 'the paragraph must follow the Verdict backstop');
  assert.ok(head < text.indexOf(BEFORE_LABELING), 'the paragraph must precede acceptance labeling');
  const para = text.slice(head, text.indexOf(BEFORE_LABELING));
  for (const needle of ['--list', 'consoleAutoResolve', "Can't-tell filings", 'short-circuit refused, Review Console renders normally', '"Any layer fails"']) {
    assert.ok(para.includes(needle), `the paragraph must carry ${needle}`);
  }
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

test('AC1.1: the refusal line never reads as a needs-human verdict', () => {
  assert.ok(SHORT_CIRCUIT.includes(REFUSAL), 'refusal template not found verbatim');
  assert.doesNotMatch(REFUSAL, /needs-human/i);
});

test("AC1.1: the documented filed lines match the guard's reader", () => {
  const templates = [...CONSOLE.matchAll(/'([^']*filed as #\{number\} \(work-fingerprint \{fingerprint\}\))'/g)].map((m) => m[1]);
  const created = templates.find((t) => !/already/.test(t));
  const deduped = templates.find((t) => /already filed as/.test(t));
  assert.ok(created && deduped, 'review-console.md must document both filed-line templates');
  const lines = [created, deduped].map((t) => '- AUTO 10:00:00 — Queue write: ' + t
    .replace('{item}', 'tiebreak:aaaaaaaaaaaa').replace('{number}', '501').replace('{fingerprint}', 'consolefinding-0123abcd'));
  for (const line of lines) assert.match(line, FILED_LINE_RE);
  assert.strictEqual(filedRecords(lines.join('\n')).get('consolefinding-0123abcd'), 501);
});

test('AC2.1: both FYI sentences carry the --fyi sections', () => {
  const needle = 'console-filings.js" --run "$PIPELINE_RUN_DIR" --fyi';
  assert.ok(SHORT_CIRCUIT.split(needle).length - 1 >= 2, 'pr-first and local-merge FYI sentences must both name --fyi');
});

test("autonomy-ceiling names the short-circuit as a can't-tell filing caller", () => {
  const start = CEILING.indexOf('| `consoleAutoResolve`');
  assert.ok(start >= 0, 'consoleAutoResolve row not found');
  const row = CEILING.slice(start, CEILING.indexOf(' |', CEILING.indexOf('deduplicated by `work-fingerprint`', start)));
  assert.ok(row.includes("`wrap-up/auto-merge-short-circuit.md`'s Can't-tell findings"));
});
