'use strict';
// #3005: QA dispatch resolves absolute origins inside navigate steps, not only story.url.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QA_PROMPTS = 'plugin/skills/test/qa-prompts.md';
const BLOCK_START = "**Resolve each story's dispatch URL against `APP_URL`**";
const BLOCK_END = '**Canonical schema.**';

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
}

function between(text, startLiteral, endLiteral) {
  const start = text.indexOf(startLiteral);
  if (start === -1) throw new Error(`start literal not found: ${startLiteral}`);
  const end = text.indexOf(endLiteral, start + startLiteral.length);
  if (end === -1) throw new Error(`end literal not found after start: ${endLiteral}`);
  return text.slice(start, end);
}

function assertQaPromptsBlock(block) {
  assert.match(block, /`navigate`/, 'navigate action is named');
  assert.match(block, /`setup\.steps`/, 'setup.steps is in scope');
  assert.match(block, /`story\.steps`/, 'story.steps is in scope');
  assert.match(block, /`teardown\.steps`/, 'teardown.steps is in scope');
  assert.match(block, /`target`[\s\S]{0,80}`value`|`value`[\s\S]{0,80}`target`/, 'both target and value URL fields are read');
  assert.match(block, /story's own origin/i, 'story own origin is defined');
  assert.match(block, /When `story\.url` is root-relative, the story's own origin is `APP_URL`'s/, 'root-relative story.url origin rule');
  assert.match(block, /navigate[\s\S]*path\/query\/fragment/, 'path/query/fragment preservation applies to navigate steps');
  assert.match(block, /`unresolved-secondary-origin`/, 'skip reason is named');
  assert.match(block, /SKIPPED[\s\S]{0,200}`unresolved-secondary-origin`|`unresolved-secondary-origin`[\s\S]{0,200}SKIPPED/, 'skip reason is tied to SKIPPED');
  assert.match(block, /worktree/i, 'worktree run is covered');
  assert.match(block, /isLinkedWorktree/, 'worktree detection signal is named');
  assert.match(block, /loopback[\s\S]{0,300}qa-procedures\.md|qa-procedures\.md[\s\S]{0,300}loopback/i, 'loopback host set is cited from qa-procedures.md');
  assert.match(block, /Non-loopback origin[\s\S]{0,120}unchanged/i, 'non-loopback origin is dispatched unchanged');
  assert.match(block, /primary-checkout run[\s\S]{0,200}flag/i, 'primary-checkout loopback origin is flagged');
  assert.match(block, /`fill`[\s\S]{0,200}verbatim/, 'fill values are passed verbatim');
  assert.match(block, /`workflow`[\s\S]{0,300}(not parsed|coverage limit)/i, 'legacy workflow stories are a coverage limit');
  assert.match(block, /#3082/, 'secondary-server follow-up is referenced');
  assert.match(block, /http:\/\/127\.0\.0\.1:9999\/app/, 'worked example story url');
  assert.match(block, /http:\/\/127\.0\.0\.1:9999\/reset/, 'worked example rewritten navigate step');
  assert.match(block, /http:\/\/127\.0\.0\.1:4010\/__reset/, 'worked example flagged navigate step');
  assert.match(block, /APP_URL=http:\/\/localhost:54321/, 'worked example APP_URL');
  assert.match(block, /http:\/\/localhost:54321\/reset/, 'worked example resolved URL');
  assert.match(block, /4010[\s\S]{0,300}flagged/i, 'worked example states the 4010 step is flagged');
  assert.match(block, /step origins/i, 'step-origin rewrite-count line');
  assert.match(block, /flag line|flagged origins/i, 'flag line for secondary origins');
  assert.match(block, /story ids/i, 'flag line names affected story ids');
}

const LIVE_BLOCK = () => between(read(QA_PROMPTS), BLOCK_START, BLOCK_END);

test('AC1.1, AC4.1, AC4.2: qa-prompts.md URL-resolution block states the navigate step-origin rule and its worked example', () => {
  assertQaPromptsBlock(LIVE_BLOCK());
});

test('AC3.1: each qa-prompts assertion goes red when its prose is reverted', () => {
  const live = LIVE_BLOCK();
  const literals = [
    '`unresolved-secondary-origin`',
    '`teardown.steps`',
    'path/query/fragment',
    'qa-procedures.md',
    'http://127.0.0.1:4010/__reset',
    'When `story.url` is root-relative',
  ];
  for (const lit of literals) {
    const mutated = live.split(lit).join('');
    assert.notEqual(mutated, live, `literal is not present in the live block: ${lit}`);
    assert.throws(() => assertQaPromptsBlock(mutated), undefined, `reverting ${lit} did not fail assertQaPromptsBlock`);
  }
});

const STORIES_SKILL = 'plugin/skills/stories/SKILL.md';
const QA_AGENT = 'plugin/agents/qa-agent.md';
const SCHEMA_START = '## Story schema (v2)';
const SCHEMA_END = '## Auth Vault';

function assertStoriesSchema(section) {
  assert.match(section, /- action: navigate\n\s+target: /, 'navigate step is in the YAML example');
  assert.match(section, /`navigate`[\s\S]{0,300}`target`/, 'navigate takes its URL from target');
  assert.match(section, /`value`[\s\S]{0,200}(fallback|older)/i, 'value is read as a fallback');
  assert.match(section, /The `url:` field\.[\s\S]*`navigate` step/, 'url paragraph gains the step rule');
  assert.match(section, /`unresolved-secondary-origin`/, 'skip reason is named');
}

function assertAgentNavigateBullet(line) {
  assert.match(line, /goto <target>/, 'navigate maps goto to <target>');
  assert.match(line, /`target`/, 'target field is named');
}

function navigateBullet() {
  const m = read(QA_AGENT).match(/^\s*- `navigate`.*$/m);
  if (!m) throw new Error('navigate bullet not found in qa-agent.md');
  return m[0];
}

test('AC2.1: stories/SKILL.md schema documents action: navigate with target', () => {
  assertStoriesSchema(between(read(STORIES_SKILL), SCHEMA_START, SCHEMA_END));
});

test('AC2.1: qa-agent.md navigate bullet names the target field', () => {
  assertAgentNavigateBullet(navigateBullet());
});

test('AC3.1: stories/qa-agent assertions go red when their prose is reverted', () => {
  const section = between(read(STORIES_SKILL), SCHEMA_START, SCHEMA_END);

  const noStep = section.replace(/- action: navigate\n\s+target: [^\n]*\n/, '');
  assert.notEqual(noStep, section, 'navigate YAML step is present before mutation');
  assert.throws(() => assertStoriesSchema(noStep), undefined, 'removing the navigate YAML step did not fail');

  const noSkip = section.replaceAll('`unresolved-secondary-origin`', '');
  assert.notEqual(noSkip, section, 'skip reason is present before mutation');
  assert.throws(() => assertStoriesSchema(noSkip), undefined, 'removing the skip reason did not fail');

  const line = navigateBullet();
  const reverted = line.replace('<target>', '<url>');
  assert.notEqual(reverted, line, 'navigate bullet names <target> before mutation');
  assert.throws(() => assertAgentNavigateBullet(reverted), undefined, 'reverting the bullet to <url> did not fail');
});
