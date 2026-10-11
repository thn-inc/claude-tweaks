'use strict';
// At the `low` review tier, lenses 3b/3c skip a diff that ships no executable
// content — and an executable snippet inside prose keeps them in scope (#2684).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DISPATCH = fs.readFileSync(
  path.join(__dirname, '..', 'plugin/skills/review/step3-lens-dispatch.md'), 'utf8');

function rule() {
  const m = DISPATCH.match(/^\*\*No executable content \(`low` only\)\.\*\*.*$/m);
  assert.ok(m, 'step3-lens-dispatch.md must carry the "No executable content (`low` only)" paragraph');
  return m[0];
}

test('the rule is scoped to the low tier and to lenses 3b and 3c', () => {
  assert.match(rule(), /At `low`, 3b and 3c are not dispatched/);
});

test('fenced code and inline commands in prose keep both lenses in scope', () => {
  const r = rule();
  assert.match(r, /no changed line sits inside a fenced code block/);
  assert.match(r, /no changed line gives the reader a command to run/);
  assert.match(r, /A single such line keeps both lenses in scope/);
});

test('any source, test, script, or config file keeps both lenses in scope', () => {
  assert.match(rule(), /any changed source, test, script, or config file/);
});

test('the skip is logged in the auto-decision-log SKIP shape', () => {
  assert.match(rule(), /`SKIP \{HH:MM:SS\} — Step 3 lenses 3b, 3c \(skipped\): .* → .*\. Reversibility: n\/a\.`/);
});

test('the rule sits in the lens-scope section, before the low-tier dispatch paragraph', () => {
  const at = DISPATCH.indexOf('**No executable content (`low` only).**');
  assert.ok(at > DISPATCH.indexOf('## Lens scope and dispatch'));
  assert.ok(at < DISPATCH.indexOf('**Low-tier single-read dispatch (`low` only).**'));
});
