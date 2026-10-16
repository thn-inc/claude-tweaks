'use strict';
// #2821: one shared "Try it" walkthrough block, defined once in
// _shared/try-it.md and cited (never restated) by every surface that shows it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.md') ? [p] : []);
  });
}

const FIELD_LINE = /^- (Precondition|Access): /m;

test('try-it.md defines the five fields in fixed order', () => {
  const doc = read('_shared/try-it.md');
  const fields = ['- Precondition: ', '- Access: ', '- Entry point: ', '- Steps:', '- Expected: '];
  const idx = fields.map((f) => doc.indexOf(f));
  assert.ok(idx.every((i) => i >= 0), `missing a field line: ${JSON.stringify(idx)}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'fields must appear in the fixed order');
  for (const h of ['## Shape', '## End-to-end variant', '## Sources', '## Rules', '## Where it appears']) {
    assert.ok(doc.includes(h), `try-it.md missing ${h}`);
  }
  assert.ok(doc.includes('### Try it — end to end'), 'end-to-end variant heading');
  assert.ok(doc.includes('try-it-{N}.md'), 'session file name');
});

test('try-it.md forbids empty and placeholder blocks and decouples from the oversight floor', () => {
  const doc = read('_shared/try-it.md');
  assert.match(doc, /Never empty, never placeholder/);
  assert.match(doc, /no green QA stories/i);
  assert.match(doc, /never gates the block/);
});

test('the Try it field lines live in exactly one skill file', () => {
  const owners = walk(SKILLS).filter((f) => FIELD_LINE.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SKILLS, f));
  assert.deepEqual(owners, ['_shared/try-it.md']);
});

function firstFence(doc) {
  const m = /```markdown\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(m, 'no ```markdown template fence');
  return m[1];
}

test('single-spec Pipeline Summary carries a mandatory Try it section before Timing', () => {
  const doc = read('flow/summary-template.md');
  const fence = firstFence(doc);
  const tryIt = fence.indexOf('### Try it');
  assert.ok(tryIt >= 0, 'template fence must contain ### Try it');
  assert.ok(tryIt < fence.indexOf('### Timing'), 'Try it renders before Timing');
  assert.ok(doc.includes('_shared/try-it.md'), 'cites the contract');
  assert.match(doc, /try-it-\{number\}\.md/);
  assert.match(doc, /never gates this section/);
  assert.match(doc, /never omit the section/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('multi-spec summary carries one Try it per spec plus the end-to-end section', () => {
  const doc = read('flow/multispec-summary.md');
  const fence = firstFence(doc);
  const perSpec = fence.indexOf('### Try it\n');
  const e2e = fence.indexOf('### Try it — end to end');
  assert.ok(perSpec >= 0 && e2e > perSpec, 'per-spec Try it, then end to end');
  assert.ok(e2e < fence.indexOf('### Timing'), 'both render before Timing');
  assert.match(fence, /#### Spec \{N\}: \{title\}/);
  assert.ok(doc.includes('_shared/try-it.md'), 'cites the contract');
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('verification-brief.md composes Try it before any parent or floor branching', () => {
  const doc = read('wrap-up/verification-brief.md');
  const compose = doc.indexOf('## Try it block (every record, before either branch)');
  assert.ok(compose >= 0, 'compose section missing');
  assert.ok(compose < doc.indexOf('## Parent-Gate Procedure'), 'before the parent branch');
  assert.ok(compose < doc.indexOf('## Oversight-floor gate'), 'before the floor gate');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.match(doc, /TRY_IT=try-it-\{N\}\.md/);
  assert.match(doc, /<!-- run-comment: try-it -->/);
  assert.match(doc, /try-it:\{N\}/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('below the floor: no demo:pending, but the walkthrough still posts', () => {
  const doc = read('wrap-up/verification-brief.md');
  const gate = doc.slice(doc.indexOf('## Oversight-floor gate'), doc.indexOf('## Step 1:'));
  const below = gate.slice(gate.indexOf('**`exceeds: false`**'), gate.indexOf('**`exceeds: true`**'));
  assert.match(below, /no `demo:pending`\s+bootstrap/, 'floor still gates the label');
  assert.match(below, /walkthrough is not skipped/);
  assert.match(below, /\*\*Posting it alone\*\*/);
  assert.match(doc, /Record the exemption \(#2383\)/, '#2383 recording unchanged');
});

test('no-PR runs degrade to the Pipeline Summary, citing the pr-run-comments gate', () => {
  const doc = read('wrap-up/verification-brief.md');
  const alone = doc.slice(doc.indexOf('**Posting it alone**'));
  assert.match(alone, /No `pr` object/);
  assert.match(alone, /Pipeline Summary carries it/);
  assert.match(alone, /_shared\/pr-run-comments\.md/);
});

test('the brief template places Try it between What shipped and Confirmed', () => {
  const doc = read('wrap-up/verification-brief.md');
  const t = doc.slice(doc.indexOf('## Verification Brief\n\n### The ask'));
  const shipped = t.indexOf('### What shipped');
  const tryIt = t.indexOf('{the Try it block');
  const confirmed = t.indexOf('### Confirmed');
  assert.ok(shipped >= 0 && tryIt > shipped && confirmed > tryIt, `${shipped} ${tryIt} ${confirmed}`);
});

test('parent gate: the end-to-end Try it replaces the inline Confirmed walkthrough, and survives the floor', () => {
  const doc = read('wrap-up/verification-brief-parent-gate.md');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.ok(doc.includes('### Try it — end to end'));
  assert.doesNotMatch(doc, /inline inside `### Confirmed`/);
  assert.doesNotMatch(doc, /inline within Confirmed/);
  const evalGate = doc.slice(doc.indexOf('## Evaluate the gate'), doc.indexOf('## Compose the parent brief'));
  const below = evalGate.slice(evalGate.indexOf('**`exceeds: false`**'), evalGate.indexOf('**`exceeds: true`**'));
  assert.match(below, /no `demo:pending`, no brief/, 'floor still gates the label and brief');
  assert.match(below, /end-to-end variant/);
  assert.match(below, /Parent-side entry/);
  const compose = doc.slice(doc.indexOf('## Compose the parent brief'), doc.indexOf('## Apply the gate'));
  assert.match(compose, /### Confirmed/, 'Confirmed survives for verify + already-posted checks');
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('pr-run-comments.md registers the try-it kind, spec-qualified under multi-spec', () => {
  const doc = read('_shared/pr-run-comments.md');
  assert.match(doc, /^\| `try-it` \| `\/claude-tweaks:wrap-up`[^\n]*`<!-- run-comment: try-it -->`[^\n]*`<!-- run-comment: try-it:\{spec\} -->`[^\n]*\|$/m);
  assert.match(doc, /^\| `\/claude-tweaks:wrap-up` \(`verification-brief\.md`'s Try it block\) \| `try-it` \|/m);
});
