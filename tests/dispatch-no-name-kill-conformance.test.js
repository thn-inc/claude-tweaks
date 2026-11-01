'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #4548: a dispatched agent ran `taskkill /F /IM node.exe` to clear its own dev server and took down every
// sibling session's node processes — the process table is shared machine-wide, not per worktree. The
// PreToolUse hook warns on these shapes after the fact; this file pins the prose that stops a dispatched
// agent from reaching for a name-based kill in the first place: the canonical paragraph in
// `_shared/subagent-dispatch-core.md` (placed beside the no-stash rule) and `build/dispatch.md`'s
// forwarding of it to every dispatch that can run commands.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const flat = (s) => s.replace(/\s+/g, ' ');

const DISPATCH_CORE = read('plugin', 'skills', '_shared', 'subagent-dispatch-core.md');
const BUILD_DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

const STASH_LABEL = '**Never run `git stash` in any form.**';
const NAME_KILL_LABEL = '**Never kill a process by image or name.**';

// The paragraph after the no-stash one must be the no-name-kill one.
function nameKillFollowsStash(text) {
  const paragraphs = text.split(/\r?\n\r?\n/).map(flat);
  const i = paragraphs.findIndex((p) => p.startsWith(STASH_LABEL));
  if (i === -1 || i + 1 >= paragraphs.length) return false;
  return paragraphs[i + 1].startsWith(NAME_KILL_LABEL);
}

function nameKillParagraph(text) {
  const paragraphs = text.split(/\r?\n\r?\n/).map(flat);
  return paragraphs.find((p) => p.startsWith(NAME_KILL_LABEL)) || '';
}

// subagent-dispatch-core.md before #4548: the no-stash paragraph (line 45) verbatim, followed directly by
// the next heading, so the helper has a real "rule absent" shape to go red on.
const PRE_CHANGE_CORE =
  '**Never run `git stash` in any form.** A dispatched agent shares its worktree with the dispatcher and possibly sibling agents, and `git stash` (worse, `--include-untracked`) sweeps *their* in-flight state — staged edits, untracked files it never saw created — into a stash entry nothing else knows exists; an agent that finishes without restoring it has silently deleted sibling work, and the loss surfaces only when the dispatcher next looks for those files. The stash stack is also shared repo-wide across every worktree, so even a restore can collide with another session\'s entries. To compare against a clean baseline, read it without mutating the tree: `git show HEAD:<path>` for file contents, `git diff HEAD -- <path>` for what changed. To set your own work aside, make a WIP commit on the branch instead.\n\n## Foreground Execution Discipline\n';

test('#4548: subagent-dispatch-core.md carries the no-name-kill paragraph right after the no-stash paragraph', () => {
  assert.strictEqual(nameKillFollowsStash(DISPATCH_CORE), true, 'the no-name-kill paragraph must be the paragraph directly after the no-stash one');
  const paragraph = nameKillParagraph(DISPATCH_CORE);
  assert.ok(paragraph.length > 0, 'no paragraph starts with the no-name-kill label');
  for (const literal of [
    '`taskkill /IM`',
    '`pkill`',
    '`killall`',
    '`Stop-Process -Name`',
    '-sTCP:LISTEN',
    'taskkill /PID {pid} /T /F',
    'leave the process running and report it',
  ]) {
    assert.ok(paragraph.includes(literal), `the no-name-kill paragraph must carry ${literal}`);
  }
});

test('#4548: the pre-change core (no-stash paragraph, then the next heading) fails the same helper', () => {
  assert.strictEqual(nameKillFollowsStash(PRE_CHANGE_CORE), false);
  // The frozen control must itself be the real no-stash paragraph, or the false above proves nothing.
  assert.ok(flat(DISPATCH_CORE).includes(flat(PRE_CHANGE_CORE.split('\n\n')[0])), 'PRE_CHANGE_CORE has drifted from the live no-stash paragraph');
});

test('#4548: build/dispatch.md forwards the no-name-kill rule to every dispatch that can run commands', () => {
  const text = flat(BUILD_DISPATCH);
  const label = text.search(/\*\*Forbid name-based process kills in every dispatch that can run commands:\*\*/);
  assert.notStrictEqual(label, -1, 'build/dispatch.md must carry the "Forbid name-based process kills in every dispatch that can run commands" label');
  const cite = text.search(/_shared\/subagent-dispatch-core\.md`'s no-name-kill rule/);
  assert.notStrictEqual(cite, -1, "build/dispatch.md must cite _shared/subagent-dispatch-core.md's no-name-kill rule rather than restate it");
  // The forward sits after the whole stash-guard paragraph, not between it and the no-stash forbid
  // sentence: tests/dispatch-no-stash-conformance.test.js requires those two to be adjacent.
  const guardLabel = '**Stash guard around every dispatch';
  const cherryPickLabel = '**Cherry-pick source-branch PR check';
  const guard = text.indexOf(guardLabel);
  const cherryPick = text.indexOf(cherryPickLabel);
  assert.notStrictEqual(guard, -1, 'the "Stash guard around every dispatch" label is gone');
  assert.notStrictEqual(cherryPick, -1, 'the "Cherry-pick source-branch PR check" label is gone');
  // Each ordering anchor occurs exactly once, so a later duplicate mention cannot shift the window silently.
  assert.strictEqual(text.indexOf(guardLabel, guard + 1), -1, 'the "Stash guard around every dispatch" label occurs twice — the ordering window is ambiguous');
  assert.strictEqual(text.indexOf(cherryPickLabel, cherryPick + 1), -1, 'the "Cherry-pick source-branch PR check" label occurs twice — the ordering window is ambiguous');
  assert.ok(label > guard && label < cherryPick, 'the no-name-kill forward must sit after the stash-guard paragraph and before the cherry-pick check');
  assert.ok(cite > label && cite < cherryPick, 'the no-name-kill citation must sit inside the forwarded sentence');
});

// ---- The three literal prompt templates carry the rule verbatim (agents see only their prompt) ----
//
// Same region split as tests/dispatch-no-stash-conformance.test.js: each Task() prompt is checked on its
// own, since a whole-file check would false-pass if one call regressed while another kept the rule.
const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const EXPRESS_PROMPT = read('plugin', 'skills', 'dispatch', 'express-prompt.md');
const MULTISPEC = read('plugin', 'skills', 'flow', 'multispec-parallel-waves.md');

function between(text, file, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notStrictEqual(start, -1, `${file} no longer has "${startMarker}" — this guard has lost its anchor`);
  const end = text.indexOf(endMarker, start);
  assert.notStrictEqual(end, -1, `${file} no longer has "${endMarker}" after "${startMarker}" — this guard has lost its anchor`);
  return text.slice(start, end);
}

const NAME_KILL_LITERALS = ['`taskkill /IM`', '`pkill`', '`killall`', '`Stop-Process -Name`', '`pgrep`'];

function assertNameKillRule(region) {
  assert.match(region, /Never kill a process by image or name/, 'the region must forbid killing a process by image or name');
  for (const literal of NAME_KILL_LITERALS) {
    assert.ok(region.includes(literal), `the region must name ${literal} as a forbidden form`);
  }
  assert.match(region, /-sTCP:LISTEN/, "the region must give the own-port-listener alternative (lsof … -sTCP:LISTEN)");
}

const NAME_KILL_REGIONS = [
  ['skills/dispatch/task-prompt.md (first call)', between(TASK_PROMPT, 'skills/dispatch/task-prompt.md', '## First call', '## Second call')],
  ['skills/dispatch/task-prompt.md (second call)', between(TASK_PROMPT, 'skills/dispatch/task-prompt.md', '## Second call', 'None of Templates A/B/C')],
  ['skills/dispatch/express-prompt.md (express call)', between(EXPRESS_PROMPT, 'skills/dispatch/express-prompt.md', '## Express call', '## Post-merge sample review call')],
  ['skills/flow/multispec-parallel-waves.md (member prompt)', between(MULTISPEC, 'skills/flow/multispec-parallel-waves.md', '## Member prompt', '## Failure handling')],
];

for (const [name, region] of NAME_KILL_REGIONS) {
  test(`#4548: ${name} forbids name-based process kills`, () => {
    assertNameKillRule(flat(region));
  });
}

// express-prompt.md's no-stash paragraph (lines 85-89) before #4548, verbatim: the template as it stood,
// with no name-kill rule anywhere in it.
const PRE_CHANGE_EXPRESS =
  'Never run `git stash` in any form -- bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` or\n' +
  '`store`; only the read-only `git stash list` and `git stash show` are allowed. The stash stack is\n' +
  "shared repo-wide across every worktree of this checkout, so any of them can pop, drop or clobber\n" +
  "a sibling worktree's in-flight work. To compare against a baseline without mutating the tree, use\n" +
  '`git show <rev>:<path>`; to set your own work aside, make a temporary WIP commit instead.\n';

test('#4548: the pre-change express template (no-stash paragraph alone) fails the same helper', () => {
  assert.throws(() => assertNameKillRule(flat(PRE_CHANGE_EXPRESS)), (err) => /by image or name/.test(err.message), 'the helper must go red on the missing rule, not on something else');
  // The frozen control must itself be the real no-stash paragraph, or the throw above proves nothing.
  assert.ok(flat(EXPRESS_PROMPT).includes(flat(PRE_CHANGE_EXPRESS).trim()), 'PRE_CHANGE_EXPRESS has drifted from the live no-stash paragraph');
});
