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
const globalOf = (pattern) => new RegExp(pattern.source, 'g');

const NO_STASH_FACTS = [
  ['in any form', /in any form/],
  ['bare `git stash`/`push`', /bare `git stash`\/`push`/],
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
    // pattern is vacuous and none is satisfied by another fact's text. Every occurrence goes
    // (a function replacement, so `$` in the text is literal), so a second copy cannot mask the strip.
    for (const [label, pattern] of NO_STASH_FACTS) {
      const doctored = paragraph.replaceAll(globalOf(pattern), () => '');
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
      /missing: in any form, bare `git stash`\/`push`, `drop`, `clear`, `pop`, `store`, `save`/,
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
  const assertProfileClaims = (text) => {
    for (const [ac, pattern] of claims) assert.match(text, pattern, `build/dispatch.md lost its ${ac} claim`);
  };
  assertProfileClaims(BUILD_DISPATCH);
  // Go-red controls: mutate each claim and the assertion function itself must throw, naming it.
  const mutations = [
    ['AC9.1', '`low` → Fast, `medium` → Standard, `high` → Capable', '`low` → Standard, `medium` → Standard, `high` → Capable'],
    ['AC9.2', 'No floor raises git-running implementers to Standard (#4559)', ''],
  ];
  for (const [ac, from, to] of mutations) {
    assert.strictEqual(BUILD_DISPATCH.split(from).length, 2, `${ac}: the mutation anchor must occur exactly once`);
    const mutated = BUILD_DISPATCH.replace(from, () => to);
    assert.notStrictEqual(mutated, BUILD_DISPATCH, `${ac}: the mutation changed nothing`);
    assert.throws(() => assertProfileClaims(mutated), (err) => err.message.includes(`lost its ${ac} claim`), `${ac}: the mutated claim must go red`);
  }
});

// ---- #4559: the controller brackets every git-capable dispatch with the stash guard ----
//
// build/dispatch.md's forbid sentence is advisory; the stash-guard paragraph that follows it on the
// same line is what makes /build detect and undo a stash change a dispatched agent made anyway.
// The paragraph runs from its bold label to the next `**` bold label, exactly like the forbid one.
const GUARD_LABEL = '**Stash guard around every dispatch that can run git (#4559):**';
const HANDOFF_TEMPLATE = read('plugin', 'skills', 'build', 'handoff-template.md');
const SESSION_TMP_ROOT = read('plugin', 'skills', '_shared', 'session-tmp-root.md');

function stashGuardParagraph(text) {
  const start = text.indexOf(GUARD_LABEL);
  assert.notStrictEqual(start, -1, `the "${GUARD_LABEL}" label is gone — this guard has lost its anchor`);
  assert.strictEqual(text.indexOf(GUARD_LABEL, start + 1), -1, 'the stash-guard label occurs twice — this guard cannot tell which paragraph is shipped');
  const end = text.indexOf('**', start + GUARD_LABEL.length);
  assert.notStrictEqual(end, -1, 'the stash-guard paragraph is no longer followed by another bold label — this guard has lost its anchor');
  return text.slice(start, end);
}

// The reviewer-restore branch: from the reviewer clause to the next clause (the handoff carry-over).
const REVIEWER_BRANCH_START = 'a reviewer dispatch (task reviewer';
const REVIEWER_BRANCH_END = 'every `restoreFailed` command';
function reviewerBranch(paragraph) {
  const start = paragraph.indexOf(REVIEWER_BRANCH_START);
  if (start === -1) return '';
  const end = paragraph.indexOf(REVIEWER_BRANCH_END, start);
  return end === -1 ? '' : paragraph.slice(start, end);
}

// A fact over the whole paragraph; `strip` removes every occurrence so the go-red control is real.
const paragraphFact = (label, pattern) => ({
  label,
  test: (p) => pattern.test(p),
  strip: (p) => p.replace(globalOf(pattern), ''),
});
// A fact that must hold inside the reviewer-restore branch, not merely somewhere in the paragraph.
const branchFact = (label, pattern) => ({
  label,
  test: (p) => pattern.test(reviewerBranch(p)),
  // Function replacements: a string replacement would read `$&` / `` $` `` in a future branch text as patterns.
  strip: (p) => p.replace(reviewerBranch(p), () => reviewerBranch(p).replace(globalOf(pattern), () => '')),
});

const STASH_GUARD_FACTS = [
  paragraphFact('AC6.1 snapshot command', /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stash-guard\.js" snapshot --repo/),
  paragraphFact('AC6.1 compare --restore command', /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stash-guard\.js" compare --repo .* --restore/),
  paragraphFact('AC6.1 snapshot immediately before the dispatch', /immediately before (the|each) dispatch/),
  paragraphFact("AC6.1 compare before the task's review", /before (that|the) task's review/),
  paragraphFact('AC11.1 per-task implementer dispatch', /per-task implementer dispatch/),
  paragraphFact('AC11.1 fix round', /fix round/),
  paragraphFact('AC11.1 NEEDS_CONTEXT/BLOCKED re-dispatch', /NEEDS_CONTEXT\/BLOCKED re-dispatch/),
  paragraphFact('AC11.1 fix-wave', /fix-wave/),
  paragraphFact('AC11.1 whole-branch-fix', /whole-branch-fix/),
  paragraphFact('AC11.1 task reviewer', /task reviewer/),
  paragraphFact('AC11.1 scoped re-review', /scoped re-review/),
  paragraphFact('AC11.1 final code reviewer', /final code reviewer/),
  paragraphFact('AC11.2 --task {k} --label', /--task \{k\} --label/),
  paragraphFact('AC11.2 --label fix-wave', /--label fix-wave/),
  paragraphFact('AC11.2 stash-guard-{id}.json', /stash-guard-\{id\}\.json/),
  paragraphFact('AC6.2 AUTO line', /AUTO \{time\} — Stash guard: \{who\} removed stash entr/),
  paragraphFact('AC6.2 FAILED line carries the shell-escaped restoreFailed[].command', /a failed restore is logged as a `FAILED` line carrying its shell-escaped `restoreFailed\[\]\.command` \(also on stderr\)/),
  paragraphFact('exit 0 appends nothing and logged is absent', /nothing was appended and `logged` is absent/),
  paragraphFact('AC6.2 failed restores and added entries go to the handoff', /every `restoreFailed` command and `added` entry also goes into Common Step 7's handoff/),
  paragraphFact('I1 restored entries reach the handoff when logged is false or the build is standalone', /as does every restored entry when `logged` is false or the `\/build` is standalone/),
  paragraphFact('F1 a failed decisions.md append is hand-logged', /hand-logs that restore's `AUTO` line under `\/build` \(step `Stash guard`\) with `log-decision\.js --text-file`/),
  paragraphFact('F2 the reviewer void has a stated reason', /may have changed the tree it was judging/),
  paragraphFact('F3 the retry bound has a stated reason', /keeps a reviewer that keeps disturbing the stash from looping the pipeline/),
  paragraphFact("T5a a reviewer's entries ride its own handoff line", /a reviewer dispatch's own restored and added entries ride its voided-verdict line, not a second slot/),
  paragraphFact('exit 3 restores every removed entry it could', /restored every removed entry it could with `git stash store`/),
  paragraphFact('alreadyPresent clause', /an entry a concurrent guard had already put back is logged as such and not stored twice/),
  paragraphFact('{worktree} is filled', /`\{worktree\}`, the worktree root `\/build` runs in \(the project root under `current-branch`\)/),
  paragraphFact('dirty note is the text between the step prefix and Reversibility', /the text between `Stash guard: ` and ` Reversibility:`/),
  paragraphFact('dirty note qualifier spelled out', /--reversibility "n\/a \(a detection; the controller never discards worktree changes\)"/),
  paragraphFact('dirty note standalone carrier is the handoff', /a standalone `\/build` with no run dir lists the line in the handoff only/),
  paragraphFact('exit 2 SKIP follows the degrade-trace shape', /--status SKIP --section "\/build" --step "Stash guard \(degraded\)" --text "condition: \{id\} \{snapshot\|compare\} exited 2 → fallback: stash change undetected for this dispatch" --reversibility n\/a/),
  paragraphFact('failed snapshot skips that dispatch compare', /after a failed `snapshot`, skip that dispatch's compare/),
  paragraphFact('AC6.2 DONE becomes DONE_WITH_CONCERNS', /a `DONE` result becomes `DONE_WITH_CONCERNS`/),
  paragraphFact('AC6.2 NEEDS_CONTEXT or BLOCKED keeps its status', /a `NEEDS_CONTEXT` or `BLOCKED` result keeps its status/),
  paragraphFact('AC6.2 never popped', /never popped/),
  paragraphFact('AC12.1 verdict is void', /verdict is void/),
  paragraphFact('AC12.2 git status --porcelain', /git status --porcelain/),
  paragraphFact('AC12.2 dispatch the same review again', /dispatch(es)? the (same )?review again/),
  paragraphFact('AC12.3 restore logged and in the handoff', /reviewer's restore is logged like any other and listed in the handoff/),
  branchFact('AC13.1 no stop (reviewer-restore branch)', /no stop/),
  paragraphFact('AC13.2 dirty paths named', /with the dirty paths named/),
  paragraphFact('AC13.2 dirty-tree log line names the dispatch like the CLI ({role} dispatch for task {k})', /Stash guard: \{role\} dispatch for task \{k\} \{left the tree dirty after restore/),
  paragraphFact("M4 a whole-branch reviewer's note is {role} dispatch", /\(a whole-branch reviewer's is `\{role\} dispatch`\)/),
  paragraphFact('AC13.2 --step "Stash guard" --text-file', /--step "Stash guard" --text-file/),
  paragraphFact('AC13.3 verdict stands', /verdict stands/),
  paragraphFact('AC13.4 at most one retry per review', /at most one retry per review/),
  paragraphFact('AC13.4 never a third', /never a third/),
];

// The superseded behaviour: a reviewer-side stash change used to BLOCK the task. It must stay gone.
// The third column is a re-insertion of the retired text, so each ban has its own go-red control.
const STASH_GUARD_FORBIDDEN = [
  ['AC13.1 report the task BLOCKED', /report the task `BLOCKED`/, ' a stash change on a reviewer dispatch means report the task `BLOCKED` naming the stash change;'],
  ['exit-2 SKIP in the pre-ruling shape', /SKIP \{time\} — Stash guard:/, ' log `SKIP {time} — Stash guard: {id} compare exited 2 → fallback: stash change undetected for this dispatch. Reversibility: n/a.`'],
  ['elided --reversibility placeholder', /--reversibility "n\/a \(…\)"/, ' --reversibility "n/a (…)"'],
  ['FAILED line described with the unescaped command shape', /carrying its paste-ready `git stash store -m "<subject>" <sha>`/, ' a failed restore is logged as a `FAILED` line carrying its paste-ready `git stash store -m "<subject>" <sha>` command'],
  ['dirty note names the dispatch without "dispatch"', /Stash guard: \{role\} for task \{k\}/, ' log `AUTO {time} — Stash guard: {role} for task {k} {left the tree dirty after restore}'],
  ['dirty note text taken from after the step prefix', /write the text after `Stash guard: `/, ' write the text after `Stash guard: ` with the Write tool'],
];

function missingStashGuardFacts(paragraph) {
  const missing = STASH_GUARD_FACTS.filter((fact) => !fact.test(paragraph)).map((fact) => fact.label);
  const present = STASH_GUARD_FORBIDDEN.filter(([, pattern]) => pattern.test(paragraph)).map(([label]) => `forbidden: ${label}`);
  // (the re-insertion column is read only by the go-red controls)
  return [...missing, ...present];
}

function assertStashGuardInstruction(paragraph) {
  const problems = missingStashGuardFacts(paragraph);
  assert.deepStrictEqual(
    problems,
    [],
    `build/dispatch.md's stash-guard paragraph must bracket every git-capable dispatch (#4559) — missing: ${problems.join(', ')}`,
  );
}

// The handoff's Stash guard section: a renderer slot for every shape the paragraph can produce.
function handoffStashGuardSection(text) {
  const start = text.indexOf('### Stash guard (if any)');
  assert.notStrictEqual(start, -1, 'handoff-template.md lost its "### Stash guard (if any)" section');
  const end = text.indexOf('\n### ', start + 1);
  assert.notStrictEqual(end, -1, 'the Stash guard section is no longer followed by another section — this guard has lost its anchor');
  return text.slice(start, end);
}

// One pattern per fact, each matching exactly once in the section, so a strip removes exactly that fact.
const HANDOFF_FACTS = [
  ['AC12.3 verdict voided', /verdict voided/],
  ['AC13.2 tree dirty after restore', /tree dirty after restore/],
  ['AC13.3 retry verdict stands', /retry verdict stands/],
  ['failed-restore slot carries {command}', /restore failed; recover with:\n  \{command\}/],
  ['{command} is restoreFailed[].command verbatim', /`\{command\}` is `restoreFailed\[\]\.command` verbatim/],
  ['added-entry slot', /- \{sha\} \{subject\} — left on the stack/],
  ['I1 restored-entry slot', /- \{sha\} \{subject\} — removed by \{who\}; restored via git stash store/],
  ['I1 restored-entry slot is rendered only for a standalone /build or when logged is false', /rendered only for a standalone `\/build` or when `logged` is false/],
  ['I1 {who} is the CLI form', /`\{who\}` is the CLI's own form \(`implementer for task \{k\}`, `\{role\} dispatch for task \{k\}` or `\{role\} dispatch`\)/],
  ['reviewer line names the dispatch like the CLI', /- \{role\} dispatch for task \{k\}:/],
  ["T5b a whole-branch reviewer's line drops for task {k}", /A whole-branch reviewer's line drops `for task \{k\}`/],
  ['reviewer-restore slot fits restored and added entries', /\{change\}, review dispatched again/],
  ['{change} is each restored or added entry', /`\{change\}` is each `\{sha\} \{subject\}` restored or added/],
  ["T5a a reviewer's entries render in its own line only", /a reviewer dispatch's restored and added entries render in its own line only/],
  ['M1 a subject with ! needs history expansion off', /a subject containing `!` must be pasted with history expansion off \(`set \+H` in bash, `setopt nobanghist` in zsh\) or run non-interactively/],
  ["omit rule counts only an implementer or fix dispatch's logged restore as nothing to render", /or every one that changed the stack was an implementer or fix dispatch's restore whose line landed in decisions\.md — a reviewer dispatch's voided-verdict line is always listed/],
];

// A restore command rebuilt from the raw subject breaks on `\ " $` and backtick, which the CLI escapes.
const HANDOFF_FORBIDDEN = [
  ['command rebuilt from the raw subject', /-m "\{subject\}"/, '\n  git stash store -m "{subject}" {sha}'],
  // Decision 2: a reviewer's restore is always listed, so a landed restore must not let the section drop its line.
  ['omit rule that lets a reviewer dispatch\'s landed restore drop its line', /was a restore whose line landed/, '\n(or omit this section: every stash-guard compare exited 0, or every one that changed the stack was a restore whose line landed in decisions.md.)'],
];

function missingHandoffFacts(section) {
  const missing = HANDOFF_FACTS.filter(([, pattern]) => !pattern.test(section)).map(([label]) => label);
  const present = HANDOFF_FORBIDDEN.filter(([, pattern]) => pattern.test(section)).map(([label]) => `forbidden: ${label}`);
  return [...missing, ...present];
}

const FORBID_PARAGRAPH_OLD_BLOCKED_SENTENCE = 'a stash change on a reviewer dispatch means report the task `BLOCKED` naming the stash change; ';

test('AC6.1/AC11/AC12/AC13: the stash-guard paragraph carries every pinned instruction', () => {
  assertStashGuardInstruction(stashGuardParagraph(BUILD_DISPATCH));
});

test('AC6.3: stripping any one pinned fact reports that fact (no pattern is vacuous)', () => {
  const paragraph = stashGuardParagraph(BUILD_DISPATCH);
  for (const fact of STASH_GUARD_FACTS) {
    const doctored = fact.strip(paragraph);
    assert.notStrictEqual(doctored, paragraph, `${fact.label}: the strip matched nothing`);
    assert.ok(
      missingStashGuardFacts(doctored).includes(fact.label),
      `${fact.label}: stripping it must report it missing`,
    );
  }
});

test('AC6.3: each named go-red control makes assertStashGuardInstruction throw with its own fact', () => {
  const paragraph = stashGuardParagraph(BUILD_DISPATCH);
  const controls = [
    ['the snapshot command deleted', 'AC6.1 snapshot command', (p) => p.replace(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stash-guard\.js" snapshot --repo/g, '')],
    ['whole-branch-fix deleted', 'AC11.1 whole-branch-fix', (p) => p.split('whole-branch-fix').join('')],
    ['the verdict-is-void sentence deleted', 'AC12.1 verdict is void', (p) => p.split('verdict is void').join('')],
    ['verdict stands deleted', 'AC13.3 verdict stands', (p) => p.split('verdict stands').join('')],
  ];
  for (const [what, label, doctor] of controls) {
    const doctored = doctor(paragraph);
    assert.notStrictEqual(doctored, paragraph, `${what}: the control changed nothing`);
    assert.deepStrictEqual(missingStashGuardFacts(doctored), [label], `${what}: must report exactly ${label}`);
    assert.throws(() => assertStashGuardInstruction(doctored), (err) => err.message.includes(`missing: ${label}`), `${what}: must throw`);
  }
});

test('AC13.1: the superseded report-the-task-BLOCKED behaviour is absent and re-inserting it goes red', () => {
  const paragraph = stashGuardParagraph(BUILD_DISPATCH);
  assert.doesNotMatch(paragraph, /report the task `BLOCKED`/, 'a reviewer-side stash change no longer blocks the task');
  const reinserted = paragraph.replace('the CLI has already restored the removed entries;', `${FORBID_PARAGRAPH_OLD_BLOCKED_SENTENCE}the CLI has already restored the removed entries;`);
  assert.notStrictEqual(reinserted, paragraph, 'the re-insertion anchor matched nothing');
  assert.throws(() => assertStashGuardInstruction(reinserted), (err) => err.message.includes('forbidden: AC13.1 report the task BLOCKED'));
});

test('AC13.1: "no stop" is pinned inside the reviewer-restore branch, not elsewhere in the paragraph', () => {
  const paragraph = stashGuardParagraph(BUILD_DISPATCH);
  const branch = reviewerBranch(paragraph);
  assert.ok(branch.length > 0, 'the reviewer-restore branch anchors are gone');
  assert.match(branch, /no stop/);
  // The same words elsewhere in the paragraph must not satisfy the pin once the branch loses them.
  const doctored = paragraph.replace(branch, () => branch.replace(/no stop/g, () => 'a halt'));
  assert.notStrictEqual(doctored, paragraph);
  assert.match(doctored, /no new stop/, 'the paragraph keeps its closing "no new stop" sentence outside the branch');
  assert.deepStrictEqual(missingStashGuardFacts(doctored), ['AC13.1 no stop (reviewer-restore branch)']);
});

test("AC12.3/AC13.2/AC13.3: handoff-template.md's Stash guard section has a slot for each reviewer-restore shape", () => {
  const section = handoffStashGuardSection(HANDOFF_TEMPLATE);
  assert.deepStrictEqual(missingHandoffFacts(section), []);
  for (const [label, pattern] of HANDOFF_FACTS) {
    const doctored = section.replaceAll(globalOf(pattern), () => '');
    assert.notStrictEqual(doctored, section, `${label}: the strip matched nothing`);
    assert.deepStrictEqual(missingHandoffFacts(doctored), [label], `${label}: stripping it must report exactly it`);
  }
  for (const [label, pattern, reinsertion] of HANDOFF_FORBIDDEN) {
    assert.doesNotMatch(section, pattern, `${label}: must stay out of the handoff slot`);
    const doctored = section + reinsertion;
    assert.deepStrictEqual(missingHandoffFacts(doctored), [`forbidden: ${label}`], `${label}: re-inserting it must go red`);
  }
});

test('AC6.3: every banned retired form goes red when re-inserted into the stash-guard paragraph', () => {
  const paragraph = stashGuardParagraph(BUILD_DISPATCH);
  for (const [label, pattern, reinsertion] of STASH_GUARD_FORBIDDEN) {
    assert.doesNotMatch(paragraph, pattern, `${label}: the retired form is back in the shipped paragraph`);
    const doctored = paragraph + reinsertion;
    assert.deepStrictEqual(missingStashGuardFacts(doctored), [`forbidden: ${label}`], `${label}: re-inserting it must report exactly it`);
  }
});

test('session-tmp-root.md lists the stash guard as a consumer, snapshot and dirty-tree note files both', () => {
  const pattern = /\*\*Extended \(#4559\):\*\* `skills\/build\/dispatch\.md`'s stash guard \(`stash-guard-\{id\}\.json`, the standalone \/build snapshot path; `stash-guard-\{id\}-note\.txt`, the dirty-tree note's `--text-file`\)\./;
  assert.match(SESSION_TMP_ROOT, pattern);
  // Control: the pre-ruling line (snapshot only) must not satisfy the pin.
  const preRuling = "**Extended (#4559):** `skills/build/dispatch.md`'s stash guard (`stash-guard-{id}.json`, the standalone /build snapshot path).";
  assert.doesNotMatch(preRuling, pattern);
});

test("the stash-guard paragraph starts exactly where the forbid paragraph ends, on the same line of build/dispatch.md", () => {
  const forbid = noStashParagraph(BUILD_DISPATCH);
  const guard = stashGuardParagraph(BUILD_DISPATCH);
  const forbidStart = BUILD_DISPATCH.indexOf(forbid);
  assert.notStrictEqual(forbidStart, -1);
  assert.strictEqual(
    BUILD_DISPATCH.indexOf(guard),
    forbidStart + forbid.length,
    'the stash-guard label must begin where the forbid paragraph ends (the next bold label after the forbid sentence)',
  );
  assert.ok(!forbid.includes('\n') && !guard.includes('\n'), 'the forbid and stash-guard paragraphs must share one line of build/dispatch.md');
  // Control: a newline between them puts the newline inside the forbid paragraph, which the claim rejects.
  const split = BUILD_DISPATCH.replace(GUARD_LABEL, '\n' + GUARD_LABEL);
  assert.notStrictEqual(split, BUILD_DISPATCH);
  assert.ok(noStashParagraph(split).includes('\n'), 'a line break before the stash-guard label must show up in the forbid paragraph');
});

// AC8 (#4559): docs/hooks.md's stash-gate bullet no longer describes `drop` as read-only. The
// bullet is located by its label so an unrelated "read-only" elsewhere in the file cannot satisfy it.
const HOOKS_DOC = read('docs', 'hooks.md');
const STASH_GATE_BULLET = (HOOKS_DOC.split('\n').find((l) => l.startsWith('- **Git-stash worktree-hazard gate')) || '');

function hooksDocStashGateProblems(bullet) {
  const problems = [];
  if (!bullet) return ['the stash-gate bullet is missing'];
  if (!/`drop`/.test(bullet) || !/`clear`/.test(bullet)) problems.push('drop and clear are not both named as warned');
  if (/`drop`[^.;]{0,60}read-only|read-only[^.;]{0,60}`drop`/.test(bullet)) problems.push('drop is described as read-only');
  return problems;
}

test('AC8: docs/hooks.md names drop and clear as warned stash subcommands and never as read-only', () => {
  assert.deepStrictEqual(hooksDocStashGateProblems(STASH_GATE_BULLET), []);
});

test('AC8: reverting the stash-gate bullet to the old read-only wording goes red', () => {
  const reverted = STASH_GATE_BULLET.replace(
    /\(`list`, `show`, `apply`(?:, `create`, `export`)?\)/,
    '(`list`, `show`, `apply`, `drop` and `clear` are read-only)',
  );
  assert.notStrictEqual(reverted, STASH_GATE_BULLET, 'the revert anchor matched nothing');
  assert.deepStrictEqual(hooksDocStashGateProblems(reverted), ['drop is described as read-only']);
  const dropped = STASH_GATE_BULLET.split('`drop`').join('').split('`clear`').join('');
  assert.deepStrictEqual(hooksDocStashGateProblems(dropped), ['drop and clear are not both named as warned']);
});
