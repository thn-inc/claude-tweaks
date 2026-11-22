// tests/hooks-post-tool-use-design-doc.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const post = require('../plugin/bin/lib/hooks/post-tool-use');

function runWrite(filePath) {
  return post.run({
    env: process.env,
    input: { tool_name: 'Write', tool_input: { file_path: filePath, content: '# Design\n' } },
    runDir: null,
    runState: null,
    cwd: '/tmp',
  });
}

test('warns when a design doc is written under docs/superpowers/specs/ (absolute path)', () => {
  const out = runWrite('/repo/docs/superpowers/specs/2026-07-16-example-design.md');
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage nudge');
  assert.match(out.json.systemMessage, /deferred sub-project/i);
});

test('warns on a relative design-doc path too', () => {
  const out = runWrite('docs/superpowers/specs/2026-07-16-example-design.md');
  assert.match(out.json.systemMessage, /claude-tweaks:capture/);
});

test('does not warn for a non-design-doc write under the same directory', () => {
  const out = runWrite('/repo/docs/superpowers/specs/notes.md');
  assert.deepStrictEqual(out, {});
});

test('does not warn for a design-doc-looking filename outside docs/superpowers/specs/', () => {
  const out = runWrite('/repo/other/2026-07-16-example-design.md');
  assert.deepStrictEqual(out, {});
});

test('does not warn for a Write to an unrelated file', () => {
  const out = runWrite('/repo/src/index.js');
  assert.deepStrictEqual(out, {});
});

test('does not warn when the tool is not Write (e.g. Edit to the same path)', () => {
  const out = post.run({
    env: process.env,
    input: { tool_name: 'Edit', tool_input: { file_path: '/repo/docs/superpowers/specs/2026-07-16-example-design.md' } },
    runDir: null,
    runState: null,
    cwd: '/tmp',
  });
  assert.deepStrictEqual(out, {});
});

test('fires even when a runDir and runState are set (independent of pipeline-run state)', () => {
  const out = post.run({
    env: process.env,
    input: { tool_name: 'Write', tool_input: { file_path: '/repo/docs/superpowers/specs/2026-07-16-example-design.md' } },
    runDir: '/tmp/some-run-dir',
    runState: { status: 'active' },
    cwd: '/tmp',
  });
  assert.match(out.json.systemMessage, /docs\/superpowers\/specs/);
});
