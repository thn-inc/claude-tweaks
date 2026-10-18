'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

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

// #3367: two-call-gate.md section 5 makes the first-call teardown a direct
// /claude-tweaks:wrap-up {target} cleanup-only call (#1766). The retired form
// routed it through /flow. The " cleanup-only" lookahead exempts section 5's
// own rationale, which names the rejected /flow form on purpose; the quoted
// "{target}" parked-run resume command in settle-parked.md is a different literal.
const STALE_TEARDOWN = /\/claude-tweaks:flow \{target\} wrap-up(?! cleanup-only)/;
// Absence assertions scan whitespace-collapsed text: a line wrap inside the retired
// phrase must not let it slip past a literal-space match (skill-prose-conformance-tests, IL-66).
const collapse = (s) => s.replace(/\s+/g, ' ');

test('AC1.1/AC1.2: sequential-execution.md names the direct wrap-up cleanup-only call as the first-call teardown (#3367)', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  const at = t.indexOf('Where that teardown falls');
  assert.notStrictEqual(at, -1, 'teardown paragraph anchor "Where that teardown falls" is present');
  const para = t.slice(at);
  assert.match(para.slice(0, para.indexOf('\n')), /`\/claude-tweaks:wrap-up \{target\} cleanup-only`[^\n]*`two-call-gate\.md` section 5/);
  assert.ok(!collapse(t).includes('/claude-tweaks:flow {target} wrap-up'), 'no /flow-routed teardown remains');
});

test('AC2: no file under plugin/skills/dispatch/ describes the first-call teardown as /claude-tweaks:flow {target} wrap-up (#3367)', () => {
  const dir = path.join(ROOT, 'plugin', 'skills', 'dispatch');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .filter((f) => STALE_TEARDOWN.test(collapse(readText(path.join(dir, f)))));
  assert.deepStrictEqual(offenders, []);
});

test('AC2 control: the collapsed matcher catches a line-wrapped retired phrase and exempts the cleanup-only form (#3367)', () => {
  assert.ok(STALE_TEARDOWN.test(collapse('routes through `/claude-tweaks:flow {target}\n  wrap-up` call')));
  assert.ok(!STALE_TEARDOWN.test(collapse('the rejected /claude-tweaks:flow {target} wrap-up cleanup-only form')));
});
