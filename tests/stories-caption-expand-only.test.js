'use strict';
// tests/stories-caption-expand-only.test.js — #2758: the caption field is documented as optional
// and QA-ignored in both the schema doc and the runtime mapper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const storiesSkill = readText(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'SKILL.md'));
const qaAgent = readText(path.join(__dirname, '..', 'plugin', 'agents', 'qa-agent.md'));
const storyExamples = readText(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'story-examples.md'));

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
