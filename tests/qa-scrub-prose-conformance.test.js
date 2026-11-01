'use strict';
// #4477: pins the prose that wires a story's `secrets:` block through the QA run —
// the schema, the dispatcher's secrets file, the qa-agent's conditional scrub
// call and its FAIL mapping, and the report's per-story outcome. Each pin is one
// assertion function run against the live text and against a control with the
// pinned clause removed, so a green run proves the pin can go red [IL-105].
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const AGENT = read('plugin/agents/qa-agent.md');
const PROMPTS = read('plugin/skills/test/qa-prompts.md');
const REPORTING = read('plugin/skills/test/qa-reporting.md');
const STORIES = read('plugin/skills/stories/SKILL.md');
const EXAMPLES = read('plugin/skills/stories/story-examples.md');

function section(text, heading, nextHeadingRe) {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, `section "${heading}" must exist`);
  const rest = text.slice(at + heading.length);
  const end = rest.search(nextHeadingRe);
  return heading + (end < 0 ? rest : rest.slice(0, end));
}

// Runs `check` on the live text, then on `mutate(live)`, which must throw.
function pinned(live, check, mutate) {
  check(live);
  const mutated = mutate(live);
  assert.notEqual(mutated, live, 'the control mutation must change the text');
  assert.throws(() => check(mutated), 'the pin must go red when its clause is removed');
}

const AGENT_SCRUB = section(AGENT, '### 6.5 Secret scrub', /\n### /);

function checkConditionalCall(text) {
  assert.match(text, /only when[^\n]{0,120}\*\*Secrets file:\*\*/i, 'the call is conditioned on a Secrets file');
  assert.match(text, /qa-scrub\.js/);
  for (const flag of ['--secrets', '--screenshots', '--traces', '--cli-dir', '--since']) {
    assert.ok(text.includes(flag), `the call passes ${flag}`);
  }
}

test('AC4.2: qa-agent invokes the scrub helper only under a Secrets file', () => {
  pinned(AGENT_SCRUB, checkConditionalCall, (t) => t.replace(/only when/gi, 'whenever'));
  assert.match(AGENT, /\*\*Secrets file:\*\*/);
  assert.match(AGENT, /STORY_STARTED_AT/);
});

function checkFailMapping(text) {
  assert.match(text, /exit `?3`?[\s\S]{0,300}\bFAIL\b[\s\S]{0,300}`remaining`/, 'exit 3 → FAIL listing remaining paths');
  assert.match(text, /exit `?1`?[^\n]{0,40}`?2`?[\s\S]{0,300}\bFAIL\b/, 'exit 1/2 → FAIL');
  assert.match(text, /never[^\n]{0,80}secret value/i, 'never print a value');
}

test('AC5.1: qa-agent maps exit 3 and exit 1/2 to FAIL with remaining paths', () => {
  pinned(AGENT_SCRUB, checkFailMapping, (t) => t.replace(/`remaining`/g, 'the list'));
});

function checkPrompts(text) {
  assert.match(text, /\{RUN_DIR\}\/secrets\/\{story\.id\}\.json/, 'the dispatcher writes the secrets file');
  assert.match(text, /\*\*Secrets file:\*\*/, 'the structured template carries the Secrets file field');
  assert.match(text, /\*\*Scrub helper:\*\*[^\n]*bin\/qa-scrub\.js/, 'the structured template carries the helper path');
}

test('qa-prompts writes the secrets file and adds both fields to the structured template', () => {
  pinned(PROMPTS, checkPrompts, (t) => t.split('**Scrub helper:**').join('**Helper:**'));
});

function checkSchema(text) {
  assert.match(text, /`secrets:`/);
  assert.match(text, /secrets:[\s\S]{0,400}pattern:[\s\S]{0,400}locator:/);
  assert.match(text, /`testid`[^\n]{0,200}`text`|`text`[^\n]{0,200}`testid`/, 'the unsupported locator types are named');
}

test('stories schema documents secrets: pattern and locator', () => {
  const schema = section(STORIES, '## Story schema (v2)', /\n## /);
  pinned(schema, checkSchema, (t) => t.split('`secrets:`').join('`hidden:`'));
});

test('story-examples has a reveal-once example', () => {
  pinned(EXAMPLES, (t) => {
    const ex = section(t, '### Example 5: Reveal-once secret', /\n### /);
    assert.match(ex, /secrets:\n\s+- pattern:/);
    assert.match(ex, /- locator:/);
    assert.doesNotMatch(ex, /sk_live|ghp_[A-Za-z0-9]{20}/, 'no real-looking token');
  }, (t) => t.replace('### Example 5: Reveal-once secret', '### Example 5'));
});

function checkReporting(text) {
  const phase4 = section(text, '# QA Phase 4: Collect', /\n## Phase 4\.5/);
  assert.match(phase4, /`scrub`/, 'Phase 4 extracts the scrub object');
  const phase5 = section(text, '## Phase 5: Report', /\n## Phase 5\.5/);
  assert.match(phase5, /"scrub"/, 'the payload carries scrub');
  assert.match(phase5, /## Secret Scrub/, 'the summary renders a Secret Scrub section');
}

test('qa-reporting carries scrub through Phase 4 and Phase 5', () => {
  pinned(REPORTING, checkReporting, (t) => t.split('## Secret Scrub').join('## Scrub'));
});
