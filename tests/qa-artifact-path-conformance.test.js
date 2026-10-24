'use strict';
// tests/qa-artifact-path-conformance.test.js — pins the QA-artifact writer/reader
// path pair (#1077): the /test qa writer's SCREENSHOTS_BASE and the two reader
// globs (journey-health, visual-review browser-review) must share the exact
// .claude-tweaks/artifacts/screenshots/qa prefix. A drift on either side silently
// splits reader from writer — the bug this suite exists to make loud.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const read = (rel) => readText(path.join(__dirname, '..', rel));
const PREFIX = '.claude-tweaks/artifacts/screenshots/qa';

test('qa-procedures SCREENSHOTS_BASE carries the artifacts prefix', () => {
  const md = read('plugin/skills/test/qa-procedures.md');
  assert.ok(md.includes('| SCREENSHOTS_BASE | `' + PREFIX + '` |'),
    'SCREENSHOTS_BASE default must be ' + PREFIX);
  assert.ok(md.includes('RUN_DIR="' + PREFIX + '/'),
    'RUN_DIR construction must build under ' + PREFIX);
});

test('journey-health reader glob matches the writer prefix', () => {
  const md = read('plugin/skills/journey-health/SKILL.md');
  assert.ok(md.includes('`' + PREFIX + '/*/report.json`'),
    'journey-health must glob report.json under ' + PREFIX);
  const withoutPrefixed = md.split(PREFIX).join('');
  assert.ok(!withoutPrefixed.includes('screenshots/qa'),
    'no bare screenshots/qa remains once the prefixed form is removed');
});

test('visual-review browser-review reader glob matches the writer prefix', () => {
  const md = read('plugin/skills/visual-review/browser-review.md');
  assert.ok(md.includes('`' + PREFIX + '/*/report.json`'),
    'browser-review must glob report.json under ' + PREFIX);
  const withoutPrefixed = md.split(PREFIX).join('');
  assert.ok(!withoutPrefixed.includes('screenshots/qa'),
    'no bare screenshots/qa remains once the prefixed form is removed');
});

test('traces base shares the artifacts home', () => {
  const md = read('plugin/skills/test/qa-procedures.md');
  assert.ok(md.includes('| TRACES_BASE | `.claude-tweaks/artifacts/traces` |'),
    'TRACES_BASE default must live under .claude-tweaks/artifacts/');
});
