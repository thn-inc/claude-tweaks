'use strict';
// #6101: pins the issue-comment edit row in _shared/github-write-transport.md and shaping mode's gh-absent use of it (planning-answer's pins live in specify-planning-answer-conformance.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const transport = () => readText(path.join(ROOT, 'plugin/skills/_shared/github-write-transport.md'));
const lineStarting = (text, prefix) => {
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `no line starts with ${prefix}`);
  return line;
};

// A literal as a regex that tolerates a hard wrap at any space.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// Every fact must be present in the region, and each must go red when stripped alone.
function pinned(region, patterns, label) {
  const missing = missingFactsOf(patterns)(region);
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(' | ')}`);
  assertEachPatternGoesRed(region, patterns, missingFactsOf(patterns));
}
const f = (s, fact) => [lit(s), fact || s];

test('row: the comment edit maps to update_issue_comment', () => {
  pinned(lineStarting(transport(), '| Edit an existing comment |'), [
    f('`update_issue_comment` (github-mcp-server v1.12.2+, default `issues` toolset)'),
    f("`comment_id` is the comment's numeric `id` from `issue_read` (get_comments mode), which carries no node ID"),
    f('it strips only invisible characters, so the marker survives the prepend'),
    f('A session whose tool list has no `update_issue_comment` treats the edit as unmapped'),
  ], 'row');
});

test('rule: a missing mapped tool refuses like an unmapped step', () => {
  pinned(lineStarting(transport(), '**A write sequence with an unmapped step'), [
    f('or one whose mapped tool the session lacks'),
    f("`specify/planning-answer.md`'s Inputs check is the standing example"),
  ], 'rule');
});

test('stamping: the live-comment resolution names its gh-absent path', () => {
  const text = readText(path.join(ROOT, 'plugin/skills/specify/shaping-mode-stamping.md'));
  const start = text.indexOf('**Resolving live `needs:decision` comments');
  const end = text.indexOf('### Compose-then-write-once');
  assert.ok(start >= 0 && end > start, 'live-comment resolution region not found');
  pinned(text.slice(start, end), [
    f('With `gh` absent, per `_shared/github-write-transport.md`: list the comments with `issue_read` (`get_comments`, paged)'),
    f('`author_association` `OWNER`, `MEMBER` or `COLLABORATOR`'),
    f('printing the skip line for every other marker comment'),
    f('edit each with `update_issue_comment`, passing its numeric `id` and the prepended body'),
    f('A session without that tool fails the edit, and the fail-closed rule below keeps the label'),
  ], 'stamping');
});
