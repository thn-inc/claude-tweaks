'use strict';
// #2821: one shared "Try it" walkthrough block, defined once in
// _shared/try-it.md and cited (never restated) by every surface that shows it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));

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
    .map((f) => path.relative(SKILLS, f).split(path.sep).join('/'));
  assert.deepEqual(owners, ['_shared/try-it.md']);
});

// The paragraph that owns a rule, not any mention of its words — a mention elsewhere
// in the same section would otherwise satisfy an ordering or content check.
function paragraphAt(doc, opener) {
  const start = doc.indexOf(opener);
  assert.ok(start >= 0, `missing paragraph opening ${opener}`);
  const end = doc.indexOf('\n\n', start);
  return { start, text: doc.slice(start, end < 0 ? undefined : end) };
}

function firstFence(doc) {
  const m = /```markdown\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(m, 'no ```markdown template fence');
  return m[1];
}

// The text from one marker up to (not including) a later one, or to the end
// of the doc when no end marker is given.
function between(doc, start, end) {
  const from = doc.indexOf(start);
  assert.ok(from >= 0, `missing start marker ${start}`);
  if (end === undefined) return doc.slice(from);
  const to = doc.indexOf(end, from);
  assert.ok(to >= 0, `missing end marker ${end} after ${start}`);
  return doc.slice(from, to);
}

test('single-spec Pipeline Summary carries a mandatory Try it section before Timing', () => {
  const doc = read('flow/summary-template.md');
  const fence = firstFence(doc);
  const tryIt = fence.indexOf('### Try it');
  assert.ok(tryIt >= 0, 'template fence must contain ### Try it');
  assert.ok(tryIt < fence.indexOf('### Timing'), 'Try it renders before Timing');
  assert.ok(doc.includes('_shared/try-it.md'), 'cites the contract');
  assert.match(doc, /try-it-\{number\}\.md/);
  assert.match(fence, /appended `### Try it — end to end` section[^}]*own section/, 'a parent gate\'s appended variant has its own slot');
  assert.match(doc, /never gates this section/);
  assert.match(doc, /never omit the section/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('multi-spec summary carries one Try it per spec plus the end-to-end section', () => {
  const doc = read('flow/multispec-summary.md');
  const fence = firstFence(doc);
  const perSpec = fence.indexOf('### Try it\n');
  const e2e = fence.indexOf('\n### Try it — end to end\n');
  assert.ok(perSpec >= 0 && e2e > perSpec, 'per-spec Try it, then end to end');
  assert.ok(e2e < fence.indexOf('### Timing'), 'both render before Timing');
  assert.match(fence, /#### Spec \{N\}: \{title\}/);
  assert.match(fence.slice(e2e), /#### Parent #\{P\}/, 'a parent gate\'s appended variant renders in the end-to-end section');
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

test('Routing composes the Try it block on every record-holding entry', () => {
  const doc = read('wrap-up/verification-brief.md');
  const routing = between(doc, '## Routing', '## Try it block (every record, before either branch)');
  const entry = paragraphAt(routing, '**Before either branch, on every record-holding entry**');
  assert.match(entry.text, /sub-issue-side\s+entry into the Parent-Gate Procedure/);
  assert.match(entry.text, /compose this record's Try it block/);
  assert.match(entry.text, /Neither the Parent-Gate Procedure nor the Oversight-floor gate gates it/);
});

test('the producer and both summaries name the same session-scoped try-it file', () => {
  for (const rel of ['wrap-up/verification-brief.md', 'flow/summary-template.md', 'flow/multispec-summary.md']) {
    const doc = read(rel);
    // {number} is summary-template.md's name for the record number the others call {N}.
    const names = [...doc.matchAll(/TRY_IT=([^\s)"'`]+)/g), ...doc.matchAll(/session-scoped `([^`]+\.md)`/g)]
      .map((m) => m[1].replace('{number}', '{N}'));
    assert.ok(names.length > 0, `${rel} names no session-scoped try-it file`);
    assert.deepEqual([...new Set(names)], ['try-it-{N}.md'], `${rel}: ${JSON.stringify(names)}`);
  }
});

test('below the floor: no demo:pending, but the walkthrough still posts', () => {
  const doc = read('wrap-up/verification-brief.md');
  const gate = between(doc, '## Oversight-floor gate', '## Step 1:');
  const below = between(gate, '**`exceeds: false`**', '**`exceeds: true`**');
  assert.match(below, /no `demo:pending`\s+bootstrap/, 'floor still gates the label');
  assert.match(below, /walkthrough is not skipped/);
  assert.match(below, /\*\*Posting it alone\*\*/);
  assert.match(doc, /Record the exemption \(#2383\)/, '#2383 recording unchanged');
});

test('no-PR runs degrade to the Pipeline Summary, citing the pr-run-comments gate', () => {
  const doc = read('wrap-up/verification-brief.md');
  const alone = between(doc, '**Posting it alone**');
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
  const evalGate = between(doc, '## Evaluate the gate', '## Compose the parent brief');
  const below = between(evalGate, '**`exceeds: false`**', '**`exceeds: true`**');
  assert.match(below, /no `demo:pending`, no brief/, 'floor still gates the label and brief');
  assert.match(below, /end-to-end variant/);
  assert.match(below, /Parent-side entry/);
  const compose = between(doc, '## Compose the parent brief', '## Apply the gate');
  assert.match(compose, /### Confirmed/, 'Confirmed survives for verify + already-posted checks');
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('parent gate: every sub-issue-side exit returns to the Try it post', () => {
  const doc = read('wrap-up/verification-brief-parent-gate.md');
  const ret = paragraphAt(doc, '**Return to the Try it post');
  for (const exit of ['`incomplete`', '`gated`/`resolved`', '`exceeds: false`', '`exceeds: true`']) {
    assert.ok(ret.text.includes(exit), `Return paragraph must name the ${exit} exit`);
  }
  assert.match(ret.text, /\*\*Posting it alone\*\*/);
  assert.match(ret.text, /fail-open fallback/);
  const evalGate = between(doc, '## Evaluate the gate', '## Compose the parent brief');
  const above = between(evalGate, '**`exceeds: true`**');
  assert.match(above, /"\$TRY_IT"/, 'exceeds: true appends the end-to-end variant too');
});

test('pr-run-comments.md registers the try-it kind, spec-qualified under multi-spec', () => {
  const doc = read('_shared/pr-run-comments.md');
  assert.match(doc, /^\| `try-it` \| `\/claude-tweaks:wrap-up`[^\n]*`<!-- run-comment: try-it -->`[^\n]*`<!-- run-comment: try-it:\{spec\} -->`[^\n]*\|$/m);
  assert.match(doc, /^\| `\/claude-tweaks:wrap-up` \(`verification-brief\.md`'s Try it block\) \| `try-it` \|/m);
});

test('demo Step 2 renders Try it before the design contract and before Prepare', () => {
  const doc = read('demo/SKILL.md');
  const step2 = between(doc, '## Step 2: Per-item walkthrough', '### Verdict');
  const first = paragraphAt(step2, '**Try it first');
  assert.ok(first.start < step2.indexOf('### The design contract'), 'before the design-contract section');
  assert.ok(first.start < step2.indexOf('**Prepare**'), 'before Prepare');
  assert.match(first.text, /before any Prepare\/Validate/);
  assert.match(first.text, /never render it empty/);
  assert.match(first.text, /PR\s+run-comment lookup/, 'names the PR lookup it reads back from');
  assert.match(step2, /Try it\s+block hoisted to the top/, 'the full brief never renders the block twice');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.doesNotMatch(doc, /walkthrough lives inline in `### Confirmed`/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('demo entry paths compose a Try it block on both composer branches', () => {
  const doc = read('demo/entry-paths.md');
  const recall = between(doc, '## No arguments: session-recall', '## `#N` given: single-record lookup');
  const recallTryIt = paragraphAt(recall, '- **Try it**').text;
  assert.ok(recallTryIt.includes('_shared/try-it.md'), 'session-recall composes the block per the contract');
  assert.match(recallTryIt, /omit the Try it block by the same rule/, 'no invented entry point when recall has none');
  const recon = between(doc, '**Found**', '**Not found**');
  assert.ok(between(recon, '- **Try it**').includes('_shared/try-it.md'), 'reconstruction composes the block per the contract');
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('demo #N lookup reads the walkthrough back from the PR before composing one', () => {
  const doc = read('demo/entry-paths.md');
  const lookup = between(doc, '## `#N` given: single-record lookup', '### Full verification pointer');
  assert.match(lookup, /`Verification Brief\s+posted to PR #\{pr-number\}: \{pr-url\}`/, 'names the pr-first pointer line');
  assert.ok(lookup.includes('<!-- run-comment: try-it -->'), 'names the try-it marker');
  assert.ok(lookup.includes('<!-- run-comment: try-it:{n} -->'), 'names the multi-spec try-it marker');
  assert.ok(lookup.includes('<!-- run-comment: brief -->'), 'names the brief marker');
  assert.match(lookup, /closedByPullRequestsReferences/, 'reuses the issue-side closing-PR field');
  assert.match(lookup, /`_shared\/pr-run-comments\.md`'s Find step/, 'reuses the find-by-marker read');
  assert.match(lookup, /race case — take the \*\*first\*\*/, 'agrees with the Find step on an unexplained duplicate');
  assert.match(lookup, /a\s+`Supersedes …` line after it/, 'drops the MCP supersede line with the marker');
  const recon = between(lookup, '**Found**', '**Not found**');
  const tryIt = between(recon, '- **Try it**');
  const prRead = tryIt.indexOf('PR run-comment');
  assert.ok(prRead >= 0 && prRead < tryIt.indexOf('_shared/try-it.md'), 'reads the PR before composing fresh');
});

test('try-it: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(SKILLS, 'wrap-up/verification-brief-parent-gate.md');
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  assert.ok(paragraphAt(text, '**Return to the Try it post').text.includes('`incomplete`'));
});
