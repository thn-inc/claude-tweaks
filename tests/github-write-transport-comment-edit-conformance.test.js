'use strict';
// #6101: pins the issue-comment edit row in _shared/github-write-transport.md and shaping mode's gh-absent use of it (planning-answer's pins live in specify-planning-answer-conformance.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const transport = () => readText(path.join(ROOT, 'plugin/skills/_shared/github-write-transport.md'));
// lineStartingWith returns '' on a miss, so assert the line exists before pinning it.
const lineStarting = (text, prefix) => {
  const line = lineStartingWith(text, prefix);
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
const f = (s) => [lit(s), s];

test('row: the comment edit maps to update_issue_comment', () => {
  pinned(lineStarting(transport(), '| Edit an existing comment |'), [
    f('`update_issue_comment` (github-mcp-server v1.12.2+, default `issues` toolset)'),
    f("`comment_id` is the comment's numeric `id` from `issue_read` (get_comments mode), which carries no node ID"),
    f('it strips only invisible characters, so the marker survives the prepend'),
    f('A session whose tool list has no `update_issue_comment` treats the edit as unmapped'),
    f('Source: github-mcp-server @9a72d8d, `pkg/github/issues.go:1593` (the tool) and `pkg/github/minimal_types.go:671` (the comment shape), probed for #6101'),
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
    f('keep the set the two commands above select — a `<!-- needs-decision: ` marker, no `**Resolved:**`, and'),
    f('`author_association` `OWNER`, `MEMBER` or `COLLABORATOR`'),
    f('printing the skip line for every other marker comment'),
    f('edit each with `update_issue_comment`, passing its numeric `id` and the prepended body'),
    f('A session without that tool fails the edit, and the fail-closed rule below keeps the label'),
    f('A listing call that fails, or a page loop that stops before a page returns fewer than 100, is a failed read, never an empty set'),
  ], 'stamping');
});

test('marker rule: the comment edit is the one exception to local composition', () => {
  const text = transport();
  const start = text.indexOf('### Marker comments on the MCP path');
  const end = text.indexOf('**Read back after posting');
  assert.ok(start >= 0 && end > start, 'marker section region not found');
  pinned(text.slice(start, end), [
    f('The "Edit an existing comment" row is the one exception'),
    f("an edit must start from the comment's existing body, which exists only on the server"),
    f('an escaped `needs-decision` marker on a just-resolved comment only drops it from find-by-marker lookups'),
  ], 'marker exception');
});

test('stamping: the fail-closed sentence names both comment-edit forms', () => {
  const text = readText(path.join(ROOT, 'plugin/skills/specify/shaping-mode-stamping.md'));
  const start = text.indexOf('**Fail closed on');
  const end = text.indexOf('### Compose-then-write-once');
  assert.ok(start >= 0 && end > start, 'fail-closed region not found');
  pinned(text.slice(start, end), [
    f('any comment edit above (`updateIssueComment` or `update_issue_comment`) fails'),
    f('or the comment listing above failed or was paged short'),
  ], 'fail-closed');
});

test('digest rollover: carried marker edits use update_issue_comment with gh absent', () => {
  const text = readText(path.join(ROOT, 'plugin/skills/tidy/digest-sweep.md'));
  pinned(text, [
    f("With `gh` absent, apply each `edits` entry with `update_issue_comment` (`_shared/github-write-transport.md`'s \"Edit an existing comment\" row)"),
    f("`comment_id` is the entry's numeric `commentId` and `body` is its file's content"),
    f("A session whose tool list has no `update_issue_comment` reports the pending edits and stops at step 3's mismatch"),
  ], 'digest rollover');
  assert.ok(!lit('has no MCP row for a comment edit').test(text), 'digest-sweep.md still says the transport has no MCP row for a comment edit');
});
