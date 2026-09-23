'use strict';
// tests/stories-caption-expand-only.test.js — #2758: the caption field is documented as optional
// and QA-ignored in both the schema doc and the runtime mapper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storiesSkill = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const qaAgent = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'agents', 'qa-agent.md'), 'utf8').replace(/\r\n/g, '\n');
const storyExamples = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'story-examples.md'), 'utf8').replace(/\r\n/g, '\n');

test('stories/SKILL.md documents caption as optional and walkthrough-only', () => {
  assert.match(storiesSkill, /caption/);
  assert.match(storiesSkill, /caption[\s\S]{0,200}(optional|walkthrough)/i);
});

test('qa-agent.md states caption is never read at runtime', () => {
  assert.match(qaAgent, /caption[\s\S]{0,200}(never read|ignored|walkthrough-only)/i);
});

test('story-examples.md gains a worked example carrying caption', () => {
  assert.match(storyExamples, /caption:/);
});
