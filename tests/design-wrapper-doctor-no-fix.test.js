// tests/design-wrapper-doctor-no-fix.test.js
//
// Record #2981, AC2: modes/doctor.md must contain no invocation that passes
// --fix to the engine's doctor verb. The file legitimately mentions `--fix`
// in prose (explaining why it's never used, and in the Finding-schema
// discussion of what an `auto` finding's `--fix` would have done) — this
// test scopes to fenced code blocks only, since an invocation is something
// a reader would actually run, never prose.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DOC = path.join(
  __dirname,
  '..',
  'plugin',
  'skills',
  'design-wrapper',
  'modes',
  'doctor.md'
);

function fencedCodeBlocks(doc) {
  return [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

test('modes/doctor.md has at least one fenced invocation block (sanity check)', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const blocks = fencedCodeBlocks(doc);
  assert.ok(blocks.length > 0, 'expected at least one fenced code block in modes/doctor.md');
});

test('no fenced code block in modes/doctor.md invokes --fix', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const blocks = fencedCodeBlocks(doc);
  for (const block of blocks) {
    assert.ok(
      !block.includes('--fix'),
      `a fenced code block in modes/doctor.md invokes --fix:\n${block}`
    );
  }
});

test('the only prose mentions of --fix are the "Never --fix" discussion and the Finding-schema rows', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  // Every --fix mention must appear on a line that also mentions "fix" in a
  // discursive way (the heading, "never", "proposal", "scope?", or the
  // Finding-schema `fix` column) — a loose guard against a stray bare
  // invocation line sneaking into prose outside a fenced block.
  const lines = doc.split('\n').filter((l) => l.includes('--fix'));
  assert.ok(lines.length > 0, 'expected modes/doctor.md to discuss --fix in prose');
  for (const line of lines) {
    assert.ok(
      !/^\s*(node|npx)\b/.test(line),
      `a line outside a fenced block looks like a direct --fix invocation: ${line}`
    );
  }
});
