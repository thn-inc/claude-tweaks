'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #1851: a docs-health record's `**Doc:**` field and title now render a
// resolvable repo-relative path (docs/{id}.md), with the bare registry id
// kept in a separate `**Id:**` field for --target round-tripping and the
// fingerprint basis. These pins ensure the two prose consumers — the
// filing skill and flow's own Named-location drift note — state the
// exemption, so a builder reads "ls it" rather than "grep for it".

const ROOT = path.join(__dirname, '..');
const SKILL = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'docs-health', 'SKILL.md'), 'utf8');
const MATERIALIZE = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'flow', 'materialize.md'), 'utf8');

test('docs-health/SKILL.md Step 6 states the Doc:/Id: field split', () => {
  assert.match(SKILL, /`\*\*Doc:\*\*` field is a repo-relative path/);
  assert.match(SKILL, /`\*\*Id:\*\*` alongside it carries the registry id/);
  assert.match(SKILL, /#1851/);
});

test("flow/materialize.md's Named-location drift note exempts a docs-health record's Doc: path from the grep-to-verify rule", () => {
  assert.match(MATERIALIZE, /a `by:docs-health` record's `\*\*Doc:\*\*` field \(#1851\)/);
  assert.match(MATERIALIZE, /needs only an `ls`, not a grep/);
});
