'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

test('sequential-execution.md documents the N-session drain shape once, naming the five controls, the same-worktree prohibition, and the load caveat (#1927 AC3)', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  assert.strictEqual((t.match(/^## Running more than one session$/gm) || []).length, 1);
  const section = t.slice(t.indexOf('## Running more than one session'));
  for (const control of ['_shared/issue-claims.md', 'sibling-session-check.md', 'worktree-reap.js', 'bin/lib/ports/registry.js', 'github-rate-limit.md']) {
    assert.ok(section.includes(control), `names ${control}`);
  }
  assert.match(section, /same worktree/);
  assert.match(section, /CLAUDE\.md.*Commands/);
  assert.match(section, /not a concurrency mechanism/);
  assert.match(section, /CLAUDE_TWEAKS_LEASE/);
});

test('the lease token is documented where port-services is (#1927 AC4)', () => {
  assert.match(read('plugin/skills/_shared/policy-schema.md'), /CLAUDE_TWEAKS_LEASE/);
  assert.match(read('plugin/skills/init/claude-md-template.md'), /CLAUDE_TWEAKS_LEASE/);
  const step = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  assert.match(step, /test_\$\{CLAUDE_TWEAKS_LEASE\}/);
  assert.match(step, /test_db/);
  assert.match(read('docs/hooks.md'), /CLAUDE_TWEAKS_LEASE/);
  assert.ok(Buffer.byteLength(read('plugin/skills/_shared/policy-schema.md'), 'utf8') <= CEILING_BYTES);
});
