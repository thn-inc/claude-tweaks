'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #1967: the #1864 review call ran `git stash` / `git stash pop` to compare
// against a baseline and popped a SIBLING worktree's WIP stash — the stash
// stack is repository-wide, shared by every linked worktree of the same main
// checkout. `plugin/bin/lib/hooks/pre-tool-use.js`'s `checkGitStashWarn` gate
// is pinned by tests/hooks-pre-tool-use.test.js, but the actual prose that
// stops a dispatched agent from reaching for stash in the first place — both
// `task-prompt.md` Task() calls and `build/dispatch.md`'s implementer
// instruction — had no test reading it at all. A future edit could drop the
// instruction from either template and nothing would fail. This file is that
// guard.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const BUILD_DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const EXPRESS_PROMPT = read('plugin', 'skills', 'dispatch', 'express-prompt.md');

// Mirrors dispatch-worktree-anchoring.test.js's own region split — each of
// the two Task() calls is checked independently, since a whole-file
// (both-calls-concatenated) check would false-pass if only one call
// regressed while the other still carried the instruction.
function firstCallRegion(text) {
  const start = text.indexOf('## First call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## First call" heading — this guard has lost its anchor');
  const end = text.indexOf('## Second call', start);
  assert.notStrictEqual(end, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  return text.slice(start, end);
}

function secondCallRegion(text) {
  const start = text.indexOf('## Second call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  const end = text.indexOf('None of Templates A/B/C', start);
  assert.notStrictEqual(end, -1, 'the second call is no longer followed by its template note — this guard has lost its anchor');
  return text.slice(start, end);
}

// #4559: the express call carries the same forwarded rule as the two task-prompt calls.
function expressCallRegion(text) {
  const start = text.indexOf('## Express call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/express-prompt.md no longer has a "## Express call" heading — this guard has lost its anchor');
  const end = text.indexOf('## Post-merge sample review call', start);
  assert.notStrictEqual(end, -1, 'skills/dispatch/express-prompt.md no longer has a "## Post-merge sample review call" heading — this guard has lost its anchor');
  return text.slice(start, end);
}

const REGIONS = [
  ['skills/dispatch/task-prompt.md (first call)', firstCallRegion(TASK_PROMPT)],
  ['skills/dispatch/task-prompt.md (second call)', secondCallRegion(TASK_PROMPT)],
  ['skills/dispatch/express-prompt.md (express call)', expressCallRegion(EXPRESS_PROMPT)],
];

const BUILD_NAME = 'skills/build/dispatch.md';

// The forwarded no-stash paragraph. In a dispatch prompt it runs from `Never run `git stash``
// to the next blank line; in build/dispatch.md it is the bold-labelled sentence, which runs from
// the `**Forbid `git stash`` label to the next `**` bold label (after the label's own closing).
function noStashParagraph(region) {
  const labelStart = region.indexOf('**Forbid `git stash`');
  if (labelStart !== -1) {
    const labelEnd = region.indexOf(':**', labelStart);
    assert.notStrictEqual(labelEnd, -1, 'the "Forbid `git stash`" bold label lost its closing `:**` — this guard has lost its anchor');
    const end = region.indexOf('**', labelEnd + 3);
    assert.notStrictEqual(end, -1, 'the "Forbid `git stash`" paragraph is no longer followed by another bold label — this guard has lost its anchor');
    return region.slice(labelStart, end);
  }
  const start = region.indexOf('Never run `git stash`');
  assert.notStrictEqual(start, -1, 'no "Never run `git stash`" paragraph in this region — this guard has lost its anchor');
  const blank = region.slice(start).search(/\r?\n\r?\n/);
  assert.notStrictEqual(blank, -1, 'the "Never run `git stash`" paragraph is not followed by a blank line — this guard has lost its anchor');
  return region.slice(start, start + blank);
}

// Every stack-mutating form must be named (#4559): the two-command wording left `drop`/`clear`
// (which destroy the shared stack) and `store`/`save` unmentioned. One fact per entry so a
// control can strip exactly one and see exactly that one reported missing.
const NO_STASH_FACTS = [
  ['in any form', /in any form/],
  ['`drop`', /`drop`/],
  ['`clear`', /`clear`/],
  ['`pop`', /`pop`/],
  ['`store`', /`store`/],
  ['`save`', /`save`/],
  ['git show <rev>:<path>', /git show <rev>:<path>/],
];

function missingNoStashFacts(paragraph) {
  return NO_STASH_FACTS.filter(([, pattern]) => !pattern.test(paragraph)).map(([label]) => label);
}

function assertNoStashRule(name, paragraph) {
  const missing = missingNoStashFacts(paragraph);
  assert.deepStrictEqual(
    missing,
    [],
    `${name}: the forwarded no-stash rule must forbid git stash in any form and name every ` +
      `stack-mutating subcommand (#4559) — missing: ${missing.join(', ')}`,
  );
}

// The two-command wording the dispatch prompts carried before #4559, frozen verbatim.
const OLD_PROMPT_PARAGRAPH =
  'Never run `git stash` or `git stash pop` -- the stash stack is shared repo-wide across every ' +
  "worktree of this checkout, so it can pop or clobber a sibling worktree's in-flight work. To " +
  'compare against a baseline without mutating the tree, use `git show <rev>:<path>`; to set your ' +
  'own work aside, make a temporary WIP commit instead.';

// build/dispatch.md's forbid sentence before #4559, frozen verbatim (ends before the next label).
const OLD_BUILD_PARAGRAPH =
  '**Forbid `git stash` in every per-task implementer dispatch:** in the same invocation ' +
  'instruction, also direct `/superpowers:subagent-driven-development` to instruct each per-task ' +
  'implementer to never run `git stash` or `git stash pop` — the stash stack is shared repo-wide ' +
  "across every worktree of this checkout, so it can pop or clobber a sibling worktree's in-flight " +
  "work (`_shared/subagent-dispatch-core.md`'s no-stash rule, cited rather than restated) — and to " +
  'compare against a baseline via `git show <rev>:<path>` or set its own work aside with a ' +
  'temporary WIP commit instead. ';

for (const [name, region] of REGIONS) {
  test(`${name}: forbids git stash and names the non-mutating alternative`, () => {
    assert.match(
      region,
      /Never run `git stash`/,
      `${name} must tell the dispatched agent never to run \`git stash\` — the stash stack is ` +
        'shared repo-wide across every worktree of this checkout, so it can pop or clobber a ' +
        "sibling worktree's in-flight work (#1967, #1864).",
    );
    assert.match(
      region,
      /git show <rev>:<path>/,
      `${name} must point at \`git show <rev>:<path>\` as the non-mutating way to compare ` +
        'against a baseline.',
    );
  });
}

// Every dispatch build/dispatch.md composes that can run git must receive the rule (#4559):
// per-task implementers, their fix rounds and re-dispatches, fix-wave / whole-branch-fix
// implementers, and the reviewers. One member per entry so a control can drop exactly one.
const FORWARDED_MEMBERS = [
  ['per-task implementer', /per-task implementer/],
  ['fix round', /fix round/],
  ['NEEDS_CONTEXT/BLOCKED re-dispatch', /NEEDS_CONTEXT\/BLOCKED re-dispatch/],
  ['fix-wave', /fix-wave/],
  ['whole-branch-fix', /whole-branch-fix/],
  ['task reviewer', /task reviewer/],
  ['scoped re-review', /scoped re-review/],
  ['final code reviewer', /final code reviewer/],
];

function assertForwardedToEveryMember(paragraph) {
  const missing = FORWARDED_MEMBERS.filter(([, pattern]) => !pattern.test(paragraph)).map(([label]) => label);
  assert.deepStrictEqual(
    missing,
    [],
    'build/dispatch.md must forward the no-stash rule to every dispatch that can run git (#4559) — ' +
      `missing: ${missing.join(', ')}`,
  );
}

for (const [name, region] of [...REGIONS, [BUILD_NAME, BUILD_DISPATCH]]) {
  test(`AC1.1/AC1.2: ${name} forbids git stash in any form and names drop and clear`, () => {
    const paragraph = noStashParagraph(region);
    assertNoStashRule(name, paragraph);
    // One fact per control: stripping exactly that fact must report exactly that fact, so no
    // pattern is vacuous and none is satisfied by another fact's text.
    for (const [label, pattern] of NO_STASH_FACTS) {
      const doctored = paragraph.replace(pattern, '');
      assert.notStrictEqual(doctored, paragraph, `${name}: pattern for ${label} matched nothing to strip`);
      assert.deepStrictEqual(missingNoStashFacts(doctored), [label], `${name}: stripping ${label} must report exactly it`);
    }
  });

  test(`AC1.3: ${name} reverted to the old two-command wording fails the assertion`, () => {
    const paragraph = noStashParagraph(region);
    const old = region === BUILD_DISPATCH ? OLD_BUILD_PARAGRAPH : OLD_PROMPT_PARAGRAPH;
    const reverted = region.replace(paragraph, old);
    assert.notStrictEqual(reverted, region, `${name}: the revert replaced nothing`);
    assert.throws(
      () => assertNoStashRule(name, noStashParagraph(reverted)),
      /missing: in any form, `drop`, `clear`, `pop`, `store`, `save`/,
    );
  });
}

test('AC11.1: build/dispatch.md forwards the no-stash rule to every dispatch that can run git', () => {
  assert.match(
    BUILD_DISPATCH,
    /Forbid `git stash` in every dispatch that can run git/,
    'build/dispatch.md must direct /superpowers:subagent-driven-development to forbid git ' +
      'stash in every dispatch that can run git (#1967, #4559) — not only per-task implementers: ' +
      "fix rounds, fix-wave implementers and the reviewers are not task-prompt.md's Task() calls " +
      'either, so they never receive the instruction otherwise.',
  );
  assert.match(
    BUILD_DISPATCH,
    /_shared\/subagent-dispatch-core\.md`'s no-stash rule/,
    "build/dispatch.md must cite _shared/subagent-dispatch-core.md's no-stash rule (moved from " +
      'subagent-output-contract.md at #2019) rather than re-restating the mechanism text inline.',
  );
  const paragraph = noStashParagraph(BUILD_DISPATCH);
  assertForwardedToEveryMember(paragraph);
  // Go-red control: deleting one member from the paragraph makes the assertion throw, naming it.
  const doctored = paragraph.replace('whole-branch-fix', '');
  assert.notStrictEqual(doctored, paragraph, 'whole-branch-fix is no longer in the forbid paragraph');
  assert.throws(() => assertForwardedToEveryMember(doctored), /missing: whole-branch-fix/);
});

test('AC9.1/AC9.2: build/dispatch.md keeps low → Fast and records the no-profile-floor decision', () => {
  const claims = [
    ['AC9.1', /`low` → Fast, `medium` → Standard, `high` → Capable/],
    ['AC9.2', /No floor raises git-running implementers to Standard \(#4559\)/],
  ];
  for (const [ac, pattern] of claims) {
    assert.match(BUILD_DISPATCH, pattern, `build/dispatch.md lost its ${ac} claim`);
    // Go-red control: the same text with only that claim removed must not match.
    const stripped = BUILD_DISPATCH.replace(pattern, '');
    assert.notStrictEqual(stripped, BUILD_DISPATCH, `${ac}: the pattern matched nothing to strip`);
    assert.doesNotMatch(stripped, pattern, `${ac}: the pattern still matches after the claim is removed`);
  }
});
