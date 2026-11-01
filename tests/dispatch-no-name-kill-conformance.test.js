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
  const stash = text.indexOf('**Forbid `git stash`');
  const guard = text.indexOf('**Stash guard around every dispatch');
  assert.notStrictEqual(stash, -1, 'the "Forbid `git stash`" label is gone');
  assert.notStrictEqual(guard, -1, 'the "Stash guard around every dispatch" label is gone');
  assert.ok(label > stash && label < guard, 'the no-name-kill forward must sit between the no-stash forbid sentence and the stash-guard paragraph');
  assert.ok(cite > label && cite < guard, "the no-name-kill citation must sit inside the forwarded sentence");
});
