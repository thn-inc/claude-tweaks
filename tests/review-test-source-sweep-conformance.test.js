'use strict';
// Pins #3827: every /claude-tweaks:test invocation that /review itself makes must
// carry `--source review`, the parent signal /test uses to tell a review-driven
// run from a standalone one (plugin/skills/test/SKILL.md, Component-Skill Contract).
//
// The sweep reads the LIVE corpus (plugin/skills/review/*.md) on purpose: the
// convention has to hold for every future addition to the directory, so a frozen
// fixture would prove only the classifier, not the skill. The go-red and
// minimal-pair tests prove the classifier can actually turn red.
//
// Classification rule (each inline `/claude-tweaks:test...` span; fenced blocks skipped):
// 1. Fenced blocks (```` ``` ```` or `~~~`, optionally indented) are skipped. Inline spans
//    are extracted per line with /`([^`\n]+)`/g. A span is a /test span when its content
//    matches /^\/claude-tweaks:test(?:\s|$)/.
// 2. Invocation: the text before the span's opening backtick ends (case-insensitive) with a
//    whole-word invocation verb (run, call, dispatch, execute, trigger, invoke, in their
//    -s/-ing forms, with an optional auto-/re- prefix), then whitespace, then an optional
//    `the `; or with `re-verif(y|ies|ying) with `. A span not directly led by one of these
//    verbs (optionally followed by `the`) is a mention: a description, a table cell naming
//    the skill, a Next Actions suggestion, a parenthetical citation.
// 3. Hand-off (an invocation review itself does not make, so no flag is required):
//    (a) `**STOP**` appears earlier on the same line: review has halted, and whoever
//        resumes runs /test standalone;
//    (b) the nearest preceding heading contains `/claude-tweaks:flow` pipeline, or the
//        line is a table row whose first cell contains (pipeline): $PIPELINE_RUN_DIR is
//        /test's primary parent signal and --source only the standalone fallback.
// 4. Every remaining invocation's span must contain `--source review` as a whole token
//    (followed by whitespace or the end of the span, so `--source reviewer` does not count).
//
// Limits (what the sweep does not see):
// - Fenced blocks are skipped, so the output-template fences in review-summary-template.md
//   (Next Actions suggestions) are not swept.
// - The walk is non-recursive: plugin/skills/review/ has no subdirectories today.
// - Blockquoted fences (`> ` followed by three backticks) are not recognised as fences.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REVIEW_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const TEST_SPAN = /^\/claude-tweaks:test(?:\s|$)/;
const INVOCATION_PRE = /\b(?:auto-|re-?)?(?:run|runs|running|call|calls|calling|dispatch|dispatches|dispatching|execute|executes|executing|trigger|triggers|triggering|invoke|invokes|invoking)\s+(?:the\s+)?$/i;
const REVERIFY_PRE = /\bre-?verif(?:y|ies|ying)\s+with\s+$/i;
const SOURCE_REVIEW = /--source review(?:\s|$)/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function classifySpans(text) {
  const out = [];
  let fence = null;
  let heading = '';
  text.split(/\r?\n/).forEach((lineText, i) => {
    const f = FENCE.exec(lineText);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    if (/^\s{0,3}#{1,6}\s/.test(lineText)) heading = lineText;
    const isRow = /^\s*\|/.test(lineText);
    const firstCell = isRow ? lineText.trim().split('|')[1] : '';
    const re = /`([^`\n]+)`/g;
    let m;
    while ((m = re.exec(lineText)) !== null) {
      if (!TEST_SPAN.test(m[1])) continue;
      const before = lineText.slice(0, m.index);
      let kind;
      let reason;
      if (!INVOCATION_PRE.test(before) && !REVERIFY_PRE.test(before)) {
        kind = 'mention';
        reason = 'no invocation verb before the span';
      } else if (before.includes('**STOP**')) {
        kind = 'handoff';
        reason = 'STOP earlier on the same line';
      } else if (heading.includes('`/claude-tweaks:flow` pipeline')) {
        kind = 'handoff';
        reason = 'under a /flow pipeline heading';
      } else if (isRow && firstCell.includes('(pipeline)')) {
        kind = 'handoff';
        reason = 'pipeline table row';
      } else {
        kind = 'invocation';
        reason = 'invocation verb, no hand-off';
      }
      out.push({ line: i + 1, span: m[1], kind, reason });
    }
  });
  return out;
}

const isOffender = (s) => s.kind === 'invocation' && !SOURCE_REVIEW.test(s.span);

function offendersIn(text) {
  return classifySpans(text).filter(isOffender).map(({ line, span }) => ({ line, span }));
}

function classifyDir(root) {
  return fs.readdirSync(root)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .flatMap((file) => classifySpans(readText(path.join(root, file))).map((s) => ({ file, ...s })));
}

function sweepDir(root) {
  return classifyDir(root).filter(isOffender).map(({ file, line, span }) => ({ file, line, span }));
}

function assertNoOffenders(root) {
  const offenders = sweepDir(root);
  const detail = offenders.map((o) => `  ${o.file}:${o.line} ${o.span}`).join('\n');
  assert.deepStrictEqual(offenders, [], `bare /claude-tweaks:test invocation(s) without --source review:\n${detail}`);
}

test('AC1.1: sweeping plugin/skills/review/*.md finds no invocation without --source review', () => {
  assertNoOffenders(REVIEW_DIR);
});

test('AC1.1 (go-red): appending a bare invocation to a copy of code-mode-steps.md turns the sweep red', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3827-'));
  try {
    for (const f of fs.readdirSync(REVIEW_DIR).filter((n) => n.endsWith('.md'))) {
      fs.copyFileSync(path.join(REVIEW_DIR, f), path.join(tmp, f));
    }
    fs.appendFileSync(path.join(tmp, 'code-mode-steps.md'), '\nThen re-run `/claude-tweaks:test` before proceeding.\n');
    assert.throws(() => assertNoOffenders(tmp), /code-mode-steps\.md/);
    // Relative to the live corpus: the appended line adds exactly one offender on top
    // of whatever the corpus already holds (zero once the sweep is green).
    assert.strictEqual(sweepDir(tmp).length, sweepDir(REVIEW_DIR).length + 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC2.1: Step 1.5\'s gate table names /test without the flag and stays green with no line allowlist', () => {
  const steps = readText(path.join(REVIEW_DIR, 'code-mode-steps.md'));
  const start = steps.indexOf('### Gate:', steps.indexOf('## Step 1.5: Test Gate'));
  const end = steps.indexOf('> **Why this gates review');
  assert.ok(start !== -1, 'Step 1.5 gate table anchor missing');
  assert.ok(end !== -1, 'Why-this-gates-review anchor missing');
  assert.ok(end > start, 'gate table must precede its Why line');
  const slice = steps.slice(start, end);
  const spans = classifySpans(slice);
  assert.ok(spans.length >= 4, `expected >= 4 /test spans in the gate table, got ${spans.length}`);
  assert.deepStrictEqual(offendersIn(slice), []);
  const kinds = new Set(spans.map((s) => s.kind));
  assert.ok(kinds.has('handoff'), 'gate table should carry hand-off spans');
  assert.ok(kinds.has('mention'), 'gate table should carry mention spans');
});

test('the live corpus exercises every branch', () => {
  const all = classifyDir(REVIEW_DIR);
  const count = (kind) => all.filter((s) => s.kind === kind).length;
  assert.ok(count('invocation') >= 10, `invocations ${count('invocation')} < 10`);
  assert.ok(count('handoff') >= 5, `hand-offs ${count('handoff')} < 5`);
  assert.ok(count('mention') >= 10, `mentions ${count('mention')} < 10`);
});

test('minimal pair: a bare verb-led invocation is an offender; --source review clears it', () => {
  assert.strictEqual(offendersIn('Then re-run `/claude-tweaks:test` before proceeding.').length, 1);
  const flagged = 'Then re-run `/claude-tweaks:test --source review` before proceeding.';
  assert.strictEqual(offendersIn(flagged).length, 0);
  assert.strictEqual(classifySpans(flagged).filter((s) => s.kind === 'invocation').length, 1);
});

test('minimal pair: capitalised and gerund verbs, and a qa argument, are still invocations', () => {
  assert.strictEqual(offendersIn('Re-running `/claude-tweaks:test` now.').length, 1);
  assert.strictEqual(offendersIn('Run `/claude-tweaks:test qa` to check.').length, 1);
});

test('minimal pair: a word that merely ends in a verb (overrun) is a mention; re-run is an invocation', () => {
  const overrunText = 'overrun `/claude-tweaks:test`';
  const overrun = classifySpans(overrunText);
  assert.strictEqual(offendersIn(overrunText).length, 0);
  assert.strictEqual(overrun.length, 1);
  assert.strictEqual(overrun[0].kind, 'mention');
  assert.strictEqual(offendersIn('re-run `/claude-tweaks:test`').length, 1);
});

test('minimal pair: an optional "the" and the dispatch verb are still invocations', () => {
  assert.strictEqual(offendersIn('run the `/claude-tweaks:test` gate').length, 1);
  assert.strictEqual(offendersIn('Dispatch `/claude-tweaks:test` now.').length, 1);
});

test('minimal pair: --source reviewer is not --source review', () => {
  assert.strictEqual(offendersIn('re-run `/claude-tweaks:test --source reviewer`').length, 1);
});

test('minimal pair: re-verifies with is an invocation verb', () => {
  assert.strictEqual(offendersIn('re-verifies with `/claude-tweaks:test`').length, 1);
});

test('minimal pair: STOP earlier on the line makes the span a hand-off; without it, an offender', () => {
  const stoppedText = '| failed | **STOP** — fix, then re-run `/claude-tweaks:test` |';
  const stopped = classifySpans(stoppedText);
  assert.strictEqual(offendersIn(stoppedText).length, 0);
  assert.strictEqual(stopped.length, 1);
  assert.strictEqual(stopped[0].kind, 'handoff');
  assert.strictEqual(offendersIn('| failed | fix, then re-run `/claude-tweaks:test` |').length, 1);
});

test('minimal pair: a pipeline table row is a hand-off; without (pipeline), an offender', () => {
  assert.strictEqual(offendersIn('| `TEST_PASSED=true` (pipeline) | re-trigger `/claude-tweaks:test` |').length, 0);
  assert.strictEqual(offendersIn('| `TEST_PASSED=true` | re-trigger `/claude-tweaks:test` |').length, 1);
});

test('minimal pair: a /flow pipeline heading is a hand-off scope; a Standalone heading is not', () => {
  assert.strictEqual(offendersIn('### In `/claude-tweaks:flow` pipeline:\n\nre-trigger `/claude-tweaks:test` once.').length, 0);
  assert.strictEqual(offendersIn('### Standalone:\n\nre-trigger `/claude-tweaks:test` once.').length, 1);
});

test('minimal pair: a descriptive mention is a mention, not an offender', () => {
  const mentionText = 'Verify that `/claude-tweaks:test` has passed.';
  assert.strictEqual(offendersIn(mentionText).length, 0);
  const spans = classifySpans(mentionText);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(spans[0].kind, 'mention');
});

test('a longer skill name is not a /test span', () => {
  assert.strictEqual(classifySpans('re-run `/claude-tweaks:test-foo`').length, 0);
});

test('a fenced block is skipped', () => {
  assert.strictEqual(classifySpans('```\nre-run `/claude-tweaks:test`\n```').length, 0);
});

test('CRLF input is split per line, and the offender is reported on line 2', () => {
  assert.deepStrictEqual(
    offendersIn('intro\r\nThen re-run `/claude-tweaks:test` now.\r\n'),
    [{ line: 2, span: '/claude-tweaks:test' }],
  );
});
