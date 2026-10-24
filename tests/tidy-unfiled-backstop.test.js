'use strict';
// Pins #905's tidy backstop scan for preserved-but-unfiled upstream feedback
// drafts: the scan subsection exists with its find command, its paste-ready
// re-file/discard commands, the clean-scan explicit-zero rule, and the
// [unfiled] tag's Collection routing row.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SCAN = path.join(__dirname, '..', 'plugin', 'skills', 'tidy', 'scan-procedures.md');
const COLLECTION_ROUTING = path.join(__dirname, '..', 'plugin', 'skills', 'tidy', 'collection-routing.md');
const BACKSTOPS = path.join(__dirname, '..', 'plugin', 'skills', 'tidy', 'issue-claims-backstops.md');
const FEEDBACK = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'SKILL.md');
const GRAPH = path.join(__dirname, '..', 'docs', 'skill-graph.md');

const BACKSTOP_HEADING = '### Backstop: preserved but unfiled upstream feedback drafts';

test('issue-claims-backstops.md carries the unfiled-drafts backstop', () => {
  const text = readText(BACKSTOPS);
  assert.ok(text.includes(BACKSTOP_HEADING), 'backstop subsection heading missing');
  assert.ok(
    text.includes('find .claude-tweaks/pipelines -path "*/staged/upstream-unfiled-*.md"'),
    'find enumeration command missing or does not match the live+archived glob shape',
  );
  assert.ok(
    text.includes('/claude-tweaks:feedback re-file the preserved draft at'),
    're-file paste-ready command template missing',
  );
  assert.ok(
    /rm '\{abs path\}'|rm "\{abs path\}"/.test(text),
    'discard paste-ready rm command template missing',
  );
  assert.ok(
    text.includes('0 unfiled upstream drafts'),
    'explicit clean-scan report line missing',
  );
  assert.ok(
    text.includes('run still live'),
    'live non-terminal run annotation missing',
  );
});

test('scan-procedures.md routes [unfiled] to Yours, no mutation staged', () => {
  const routingSection = readText(COLLECTION_ROUTING);
  assert.ok(
    /\[unfiled\]/.test(routingSection),
    '[unfiled] tag missing from the Collection routing table',
  );
});

test('the backstop cites --pre-confirmed as illegitimate for its own command', () => {
  const text = readText(BACKSTOPS);
  const section = text.slice(text.indexOf(BACKSTOP_HEADING));
  assert.ok(
    !section.includes('--pre-confirmed'),
    'the re-file command in this scan must never carry --pre-confirmed (console-callers-only)',
  );
});

test('feedback/SKILL.md Step 1 names a preserved-draft path as a valid gather source', () => {
  const text = readText(FEEDBACK);
  const step1 = text.slice(text.indexOf('### Step 1: Gather'), text.indexOf('### Step 2: Classify the kind'));
  assert.ok(
    step1.includes('preserved') && step1.includes('draft'),
    'Step 1 must state that a free-text preserved-draft path is read and used as the gathered content',
  );
});

test('skill-graph.md documents the tidy -> feedback unfiled-drafts edge', () => {
  const text = readText(GRAPH);
  const feedbackSection = text.slice(text.indexOf('## feedback'), text.indexOf('## flow'));
  assert.ok(
    /`\/tidy`.*unfiled/s.test(feedbackSection) || feedbackSection.includes('upstream-unfiled'),
    'skill-graph.md ## feedback section must document the /tidy backstop-scan edge',
  );
});
