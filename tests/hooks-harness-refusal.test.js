'use strict';
// #3304: the Claude Code worktree-isolation refusal text lives in one module,
// and both hook consumers derive from it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict } = require('./helpers/strip-comments');
const {
  REFUSAL_FRAGMENTS,
  HARNESS_ISOLATION_REFUSAL_RE,
} = require('../plugin/bin/lib/hooks/harness-refusal');

const HOOKS_DIR = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks');

test('harness-refusal: the derived regex keeps the pre-#3304 source exactly', () => {
  assert.strictEqual(
    HARNESS_ISOLATION_REFUSAL_RE.source,
    String.raw`This session is isolated in the worktree [\s\S]*?Refusing to run it`,
  );
  assert.strictEqual(HARNESS_ISOLATION_REFUSAL_RE.flags, '');
});

test('harness-refusal: fragments are the three literals in message order', () => {
  assert.deepStrictEqual(
    [...REFUSAL_FRAGMENTS],
    ['This session', ' is isolated in the worktree ', 'Refusing to run it'],
  );
  assert.ok(Object.isFrozen(REFUSAL_FRAGMENTS));
});

test('harness-refusal: post-tool-use-failure re-exports the same RegExp object', () => {
  assert.strictEqual(
    require('../plugin/bin/lib/hooks/post-tool-use-failure').HARNESS_ISOLATION_REFUSAL_RE,
    HARNESS_ISOLATION_REFUSAL_RE,
  );
});

test('harness-refusal: neither hook module spells the refusal text itself (one-place change)', () => {
  for (const file of ['post-tool-use-failure.js', 'bash-prefilter.js']) {
    const raw = fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8');
    const stripped = stripComments(raw);
    assert.strictEqual(stripperVerdict(raw, stripped), 'ok', `${file}: comment stripper must parse cleanly`);
    // Shorter respellings too: a partial copy ('Refusing to run') must not slip through either.
    for (const literal of ['Refusing to run', 'isolated in the worktree', 'This session']) {
      assert.ok(!stripped.includes(literal), `${file} spells "${literal}" in code instead of deriving it`);
    }
    assert.ok(raw.includes("require('./harness-refusal')"), `${file} must require ./harness-refusal`);
  }
});
