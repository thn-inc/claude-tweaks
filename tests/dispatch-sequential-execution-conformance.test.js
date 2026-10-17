'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

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
});

// EnterWorktree(name:) takes no base ref: under baseRef fresh it branches from
// origin/<default-branch> (main, not develop), under head from the previous
// group's branch -- the dispatching session must base each group's worktree on
// the integration branch explicitly and enter it by path.
test('Step 5 creates each group worktree on origin/{integration-branch} and enters it by path, never EnterWorktree(name:)', () => {
  const skill = read('plugin/skills/dispatch/SKILL.md');
  const step5 = skill.slice(skill.indexOf('### Step 5:'), skill.indexOf('### Step 6:'));
  assert.match(step5, /never `EnterWorktree\(name:\)`/);
  assert.match(step5, /Creating the group's worktree/);
  assert.doesNotMatch(step5, /exactly as a normal `\/claude-tweaks:flow` invocation would/);
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  const section = t.slice(t.indexOf("## Creating the group's worktree"), t.indexOf('## The loop'));
  assert.match(section, /git worktree add \.claude\/worktrees\/\{name\} -b worktree-\{name\} origin\/\{integration-branch\}/);
  assert.match(section, /EnterWorktree\(path: "\.claude\/worktrees\/\{name\}"\)/);
});
