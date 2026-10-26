'use strict';
// #4184: refine 5a validates each story at its resolved_url, citing qa-prompts.md's rewrite step, never the raw story.url.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const QA_PROMPTS = 'plugin/skills/test/qa-prompts.md';
const REFINE = 'plugin/skills/stories/refine.md';
const REWRITE_STEP = "Resolve each story's dispatch URL against `APP_URL`";
const QA_CITE = "`qa-prompts.md` in the `/claude-tweaks:test` skill's directory";

function read(rel) {
  return readText(path.join(__dirname, '..', rel));
}

function between(text, startLiteral, endLiteral) {
  const start = text.indexOf(startLiteral);
  if (start === -1) throw new Error(`start literal not found: ${startLiteral}`);
  const end = text.indexOf(endLiteral, start + startLiteral.length);
  if (end === -1) throw new Error(`end literal not found after start: ${endLiteral}`);
  return text.slice(start, end);
}

// Each mutation must fail the one assertion it targets (matched by its message), not any assertion.
function expectRed(assertFn, original, mutated, message) {
  assert.notEqual(mutated, original, `mutation is not a no-op: ${message}`);
  assert.throws(() => assertFn(mutated), { message }, `reverting did not fail "${message}"`);
}

const without = (text, literal) => text.split(literal).join('');

function assertQaPromptsSource(text) {
  assert.ok(text.includes(REWRITE_STEP), 'qa-prompts.md names the rewrite step');
  assert.match(text, /compute `resolved_url`/, 'qa-prompts.md computes resolved_url');
}

function assertRefine5a(section) {
  assert.ok(!section.includes('<story.url>'), 'refine 5a never uses a raw <story.url>');
  assert.ok(section.includes(REWRITE_STEP), 'refine 5a cites the qa-prompts rewrite step by name');
  assert.ok(section.includes(QA_CITE), 'refine 5a names qa-prompts.md');
  assert.ok(section.includes('`resolved_url`'), 'refine 5a names resolved_url');
  assert.ok(section.includes('open <resolved_url>'), 'refine 5a opens resolved_url');
  assert.ok(section.includes('goto <resolved_url>'), 'refine 5a re-navigates to resolved_url');
}

function assertRefine5b(section) {
  assert.ok(section.includes("Re-open the story's `resolved_url`"), 'refine 5b re-opens resolved_url');
  assert.ok(!section.includes("Re-open the story's URL"), 'refine 5b never re-opens the raw story URL');
}

// Matches single-quoted messages only, so an assertion message containing an apostrophe is skipped here;
// the coverage deepEqual below then fails loudly on the mismatch, so keep messages apostrophe-free.
function declaredMessages() {
  const source = readText(__filename);
  return [...source.matchAll(/^\s+assert\.(?:ok|match)\(.*, '([^']+)'\);$/gm)].map((m) => m[1]);
}

test('AC1, AC2: refine 5a and 5b cite the qa-prompts.md resolved_url rewrite by name and open resolved_url', () => {
  const refine = read(REFINE);
  assertQaPromptsSource(read(QA_PROMPTS));
  assertRefine5a(between(refine, '## 5a.', '## 5b.'));
  assertRefine5b(between(refine, '## 5b.', '## 5c.'));
});

test('AC3: every refine and qa-prompts assertion goes red on its own prose, matched by its own message', () => {
  const qa = read(QA_PROMPTS);
  const refine = read(REFINE);
  const s5a = between(refine, '## 5a.', '## 5b.');
  const s5b = between(refine, '## 5b.', '## 5c.');
  const table = [
    ['qa-prompts.md names the rewrite step', assertQaPromptsSource, qa, (t) => without(t, REWRITE_STEP)],
    ['qa-prompts.md computes resolved_url', assertQaPromptsSource, qa, (t) => without(t, 'compute `resolved_url`')],
    ['refine 5a never uses a raw <story.url>', assertRefine5a, s5a, (t) => `${t}\n\`playwright-cli open <story.url>\`\n`],
    ['refine 5a cites the qa-prompts rewrite step by name', assertRefine5a, s5a, (t) => without(t, REWRITE_STEP)],
    ['refine 5a names qa-prompts.md', assertRefine5a, s5a, (t) => without(t, QA_CITE)],
    ['refine 5a names resolved_url', assertRefine5a, s5a, (t) => without(t, '`resolved_url`')],
    ['refine 5a opens resolved_url', assertRefine5a, s5a, (t) => without(t, 'open <resolved_url>')],
    ['refine 5a re-navigates to resolved_url', assertRefine5a, s5a, (t) => without(t, 'goto <resolved_url>')],
    ['refine 5b re-opens resolved_url', assertRefine5b, s5b, (t) => without(t, "Re-open the story's `resolved_url`")],
    ['refine 5b never re-opens the raw story URL', assertRefine5b, s5b, (t) => `${t}\nRe-open the story's URL in a fresh session.\n`],
  ];
  const asserted = [...new Set(table.map(([message]) => message))];
  assert.deepEqual(asserted.sort(), [...new Set(declaredMessages())].sort(), 'the table covers exactly the assertions the helpers declare');
  for (const [message, assertFn, original, mutate] of table) {
    expectRed(assertFn, original, mutate(original), message);
  }
});
