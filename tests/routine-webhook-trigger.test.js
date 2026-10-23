const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const webhookTriggerMdPath = path.join(__dirname, '../plugin/skills/routine/webhook-trigger.md');

test('webhook-trigger.md documents a WEBHOOK-TRIGGER mode', () => {
  const content = readText(webhookTriggerMdPath);
  assert.match(content, /## WEBHOOK-TRIGGER `<skill>`/);
});

test('WEBHOOK-TRIGGER mode calls create_webhook_trigger with routine_trigger_id', () => {
  const content = readText(webhookTriggerMdPath);
  const section = content.slice(content.indexOf('## WEBHOOK-TRIGGER'));
  assert.match(section, /create_webhook_trigger/);
  assert.match(section, /routine_trigger_id/);
  assert.match(section, /record\.routine_id/);
});

test('WEBHOOK-TRIGGER mode exposes the filter grammar generically, not one hardcoded shape', () => {
  const content = readText(webhookTriggerMdPath);
  const section = content.slice(content.indexOf('## WEBHOOK-TRIGGER'));
  for (const field of ['author', 'title', 'body', 'base_branch', 'head_branch', 'labels', 'is_draft', 'is_merged']) {
    assert.ok(section.includes(field), `filter grammar field "${field}" missing from WEBHOOK-TRIGGER section`);
  }
  for (const op of ['equals', 'contains', 'starts_with', 'is_one_of', 'is_not_one_of', 'matches_regex']) {
    assert.ok(section.includes(op), `filter operator "${op}" missing from WEBHOOK-TRIGGER section`);
  }
});

test('WEBHOOK-TRIGGER mode surfaces both preconditions', () => {
  const content = readText(webhookTriggerMdPath);
  const section = content.slice(content.indexOf('## WEBHOOK-TRIGGER'));
  assert.match(section, /GitHub App/i);
  assert.match(section, /hourly/i);
  assert.match(section, /dropped, not queued|drop-not-queue|not queued/i);
});

test('WEBHOOK-TRIGGER mode requires an existing routine record', () => {
  const content = readText(webhookTriggerMdPath);
  const section = content.slice(content.indexOf('## WEBHOOK-TRIGGER'));
  assert.match(section, /create <skill>.*first|run.*create.*first/i);
});

const skillMdPath = path.join(__dirname, '../plugin/skills/routine/SKILL.md');

test('SKILL.md Input table documents the webhook-trigger mode', () => {
  const content = readText(skillMdPath);
  assert.match(content, /webhook-trigger\s*<skill>/);
});

test('SKILL.md Workflow table routes webhook-trigger to webhook-trigger.md', () => {
  const content = readText(skillMdPath);
  assert.match(content, /webhook-trigger[\s\S]{0,200}webhook-trigger\.md/);
});

const statusMdPath = path.join(__dirname, '../plugin/skills/routine/status.md');
const fleetMdPath = path.join(__dirname, '../plugin/skills/routine/fleet.md');

test('status.md reports webhook_triggers presence in its per-record verdict', () => {
  const content = readText(statusMdPath);
  assert.match(content, /webhook_triggers/);
});

test('fleet.md surfaces webhook_triggers in its fleet status table', () => {
  const content = readText(fleetMdPath);
  assert.match(content, /webhook_triggers/);
});

test('webhook-trigger.md confirms GitHub event triggers are tool-supported, not web-UI-only', () => {
  const content = readText(webhookTriggerMdPath);
  assert.match(content, /programmatically|via this tool|via `?RemoteTrigger`?/i);
});
