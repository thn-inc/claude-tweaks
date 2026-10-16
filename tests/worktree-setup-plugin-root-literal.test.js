'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #2702: the "too complex to verify" / "value computed at runtime" refusals a
// worktree session hits on ${CLAUDE_PLUGIN_ROOT}/$CLAUDE_CODE_SESSION_ID
// snippets come from the Claude Code harness's own Bash guard, which the
// plugin cannot narrow. The plugin-side mitigation is shipped prose telling
// the agent to resolve both values to literals once and substitute them —
// the model-resolved-placeholder rule docs/skill-authoring.md states for
// maintainers, which never shipped to a runtime agent until now.

const ROOT = path.join(__dirname, '..');
const SETUP = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'worktree-setup.md'));
const ANCHOR = '**Resolve plugin-supplied values to literals once.**';

function catchupSection() {
  const start = SETUP.indexOf('## Post-creation catch-up');
  assert.notStrictEqual(start, -1, '## Post-creation catch-up heading missing');
  const end = SETUP.indexOf('\n## ', start + 1);
  return SETUP.slice(start, end === -1 ? undefined : end);
}

function paragraph() {
  const section = catchupSection();
  const at = section.indexOf(ANCHOR);
  assert.notStrictEqual(at, -1, 'literal-resolution paragraph missing from Post-creation catch-up');
  const end = section.indexOf('\n\n', at);
  return section.slice(at, end === -1 ? undefined : end);
}

test('worktree-setup.md: literal-resolution paragraph sits after the guard note, before the unconditional fetch', () => {
  const section = catchupSection();
  const guard = section.indexOf("harness's Bash-shape guard");
  const anchor = section.indexOf(ANCHOR);
  const fetch = section.indexOf('Unconditionally, before anything else runs');
  assert.ok(guard !== -1 && fetch !== -1, 'catch-up section lost its guard note or fetch anchor');
  assert.ok(guard < anchor && anchor < fetch, `expected guard(${guard}) < paragraph(${anchor}) < fetch(${fetch})`);
});

test('worktree-setup.md: names both values and how each resolves', () => {
  const p = paragraph();
  assert.match(p, /CLAUDE_PLUGIN_ROOT/, 'must name CLAUDE_PLUGIN_ROOT');
  assert.match(p, /CLAUDE_CODE_SESSION_ID/, 'must name CLAUDE_CODE_SESSION_ID');
  assert.match(p, /Base directory for this skill:/, 'plugin root derives from the invoking claude-tweaks skill line');
  assert.match(p, /skills\/\{name\}/, 'must say to drop the trailing skills/{name} segment');
  assert.match(p, /cut before its `skills\/` segment/i, 'no-Skill fallback must cut the read file\'s path at its skills/ segment (depth-independent)');
  assert.doesNotMatch(p, /grandparent/i, 'grandparent is off by one for _shared/ and nested sub-files');
  assert.match(p, /printenv\s+CLAUDE_CODE_SESSION_ID/, 'session id resolves via one plain printenv call');
});

test('worktree-setup.md: says to substitute literally, everywhere, including subagent prompts', () => {
  const p = paragraph();
  assert.match(p, /literal/i, 'must say literal substitution');
  assert.match(p, /every\s+later\s+command/i, 'must cover every later command, not just the next one');
  assert.match(p, /subagent/i, 'must extend to prompts handed to subagents');
  assert.match(p, /first time a later command needs/i, 'must not read as a step to run before the unconditional fetch');
  assert.match(p, /scratch-worktree\.md/, 'must cite the §7 refusal catalog, not restate it');
});

test('worktree-setup.md: prescribes no lookup ladder or cache glob', () => {
  const p = paragraph();
  assert.doesNotMatch(p, /\bfind\b|\bls\s+~|plugins\/cache|\*\*?\//, 'no shell lookup ladder or cache-directory glob (docs/skill-authoring.md Plugin-root references)');
});
