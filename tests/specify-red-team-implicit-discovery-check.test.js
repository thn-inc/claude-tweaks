// tests/specify-red-team-implicit-discovery-check.test.js
//
// Pins #4006's wrap-up skill update: red-team.md must carry a deterministic
// implicit-discovery trust check before persona dispatch, requiring a record
// whose tool discovers a verdict-deciding file at a conventional path to state
// the missing-file, outside-checkout-symlink and dangling-symlink outcomes.
// Review lens 3b, not shaping, caught #4006's discovered declaration being
// trusted through a symlink; this pin keeps the shaping-time check from
// silently dropping out of the file.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RED_TEAM = readText(path.join(ROOT, 'plugin/skills/specify/red-team.md'));

const HEADING = '## Implicit-discovery trust check (deterministic, runs before persona dispatch)';

function section(text) {
  const start = text.indexOf(HEADING);
  if (start === -1) return '';
  const next = text.indexOf('\n## ', start + HEADING.length);
  return text.slice(start, next === -1 ? undefined : next);
}

function assertCheckStated(text) {
  const body = section(text);
  assert.ok(body, `heading not found: ${HEADING}`);
  for (const [label, pattern] of [
    ['missing file', /\*\*Missing file\*\*/],
    ['outside-checkout symlink', /\*\*Symlink resolving outside the checkout\*\*: say that it is refused, never read/],
    ['dangling symlink', /\*\*Dangling symlink\*\*/],
  ]) {
    assert.match(body, pattern, `the check must name the ${label} case`);
  }
  assert.match(body, /decide a verify, skip, or trust verdict/, 'the trigger must be a verdict-deciding file');
  assert.match(body, /A missing case is a `critical` finding/, 'a missing case must be critical');
  assert.match(body, /## Open Questions/, 'a missing case must land as an Open Questions row');
}

test('red-team.md states the implicit-discovery trust check and its three cases', () => {
  assertCheckStated(RED_TEAM);
});

test('the implicit-discovery check runs after the other deterministic checks and before Parallel dispatch', () => {
  const failClosedIdx = RED_TEAM.indexOf('## Fail-closed guard detection');
  const checkIdx = RED_TEAM.indexOf(HEADING);
  const parallelIdx = RED_TEAM.indexOf('## Parallel dispatch');
  assert.ok(failClosedIdx !== -1 && checkIdx !== -1 && parallelIdx !== -1, 'all three headings must exist');
  assert.ok(failClosedIdx < checkIdx && checkIdx < parallelIdx, 'the check must sit between fail-closed detection and Parallel dispatch');
});

test('go-red control: the assertion throws when the section or one of its cases is dropped', () => {
  const mutate = (from, to) => {
    const out = RED_TEAM.replace(from, to);
    assert.notEqual(out, RED_TEAM, `control mutation must change the text: ${from}`);
    return out;
  };
  assert.throws(() => assertCheckStated(mutate(HEADING, '## Removed')), { message: /heading not found/ });
  assert.throws(() => assertCheckStated(mutate('**Symlink resolving outside the checkout**', '**Removed**')),
    { message: /must name the outside-checkout symlink case/ });
  assert.throws(() => assertCheckStated(mutate('**Dangling symlink**', '**Removed**')),
    { message: /must name the dangling symlink case/ });
});
