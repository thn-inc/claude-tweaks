'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
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

// One entry per assertion: the live check and the frozen control both iterate this list, so the control
// proves each pattern individually rejects the pre-change text (assertNameKillRule alone throws at the
// first failing pattern and would leave the rest unproven).
const NAME_KILL_PATTERNS = [
  [/Never kill a process by image or name/, 'the region must forbid killing a process by image or name'],
  ...NAME_KILL_LITERALS.map((literal) => [
    new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `the region must name ${literal} as a forbidden form`,
  ]),
  [/-sTCP:LISTEN/, 'the region must give the own-port-listener alternative (lsof … -sTCP:LISTEN)'],
];

function assertNameKillRule(region) {
  for (const [pattern, message] of NAME_KILL_PATTERNS) assert.match(region, pattern, message);
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

// express-prompt.md's no-stash paragraph before #4548, verbatim: the template as it stood, with no
// name-kill rule anywhere in it.
const PRE_CHANGE_EXPRESS =
  'Never run `git stash` in any form -- bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` or\n' +
  '`store`; only the read-only `git stash list` and `git stash show` are allowed. The stash stack is\n' +
  "shared repo-wide across every worktree of this checkout, so any of them can pop, drop or clobber\n" +
  "a sibling worktree's in-flight work. To compare against a baseline without mutating the tree, use\n" +
  '`git show <rev>:<path>`; to set your own work aside, make a temporary WIP commit instead.\n';

test('#4548: the pre-change express template (no-stash paragraph alone) fails the same helper', () => {
  assert.throws(() => assertNameKillRule(flat(PRE_CHANGE_EXPRESS)), (err) => /by image or name/.test(err.message), 'the helper must go red on the missing rule, not on something else');
  // The throw above stops at the first failing pattern, so prove every pattern rejects the frozen text on its own.
  const frozen = flat(PRE_CHANGE_EXPRESS);
  for (const [pattern, message] of NAME_KILL_PATTERNS) {
    assert.throws(() => assert.match(frozen, pattern, message), (err) => err.message.includes(message), `the frozen express template must fail: ${message}`);
  }
  // The frozen control must itself be the real no-stash paragraph, or the throw above proves nothing.
  assert.ok(flat(EXPRESS_PROMPT).includes(flat(PRE_CHANGE_EXPRESS).trim()), 'PRE_CHANGE_EXPRESS has drifted from the live no-stash paragraph');
});

// ---- Dev-server teardowns kill the listener, never every connection to the port ----
//
// `lsof -ti tcp:{port}` lists every process with a socket on the port, clients included — the browser a
// check is driving among them — so `| xargs kill` took the client down with the server.
const SKILLS_ROOT = path.join(ROOT, 'plugin', 'skills');

function filesContaining(root, literal) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md') && readText(full).includes(literal)) {
        hits.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return hits.sort();
}

test('#4548: no skill file uses the client-matching lsof -ti tcp: kill', () => {
  assert.deepStrictEqual(filesContaining(SKILLS_ROOT, 'lsof -ti tcp:'), []);
});

test('#4548: the lsof -ti tcp: corpus walk finds a planted offender', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4548-'));
  try {
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'offender.md'), 'Stop it with `lsof -ti tcp:3000 | xargs kill`.\n');
    fs.writeFileSync(path.join(dir, 'clean.md'), 'Nothing to see here.\n');
    assert.deepStrictEqual(filesContaining(dir, 'lsof -ti tcp:'), ['nested/offender.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Each site's line as it read before #4548 replaced it (3a2b73cf5): the frozen control the
// listener-scoped check below must reject.
const PRE_CHANGE_TEARDOWN_LINES = [
  "- **Standalone** (no run dir): the calling skill stops the server before it returns, and notes that it was started for automation. `ephemeral-server.txt` is never written on this path (Step 4 above writes it only \"when a pipeline run dir exists\"), so cleanup stops the server it itself started by PID: on POSIX, `lsof -ti tcp:{port} | xargs kill` — the same port-based mechanism Section D's rule in `wrap-up/cleanup-procedures-execution.md` uses when no lease exists, which is always the case here; on win32, where `lsof` does not exist, `taskkill /PID {pid} /T /F` against the PID this same procedure recorded when it started the server — the same tree kill Section D's win32 branch uses, since a leader-only stop leaves shell-spawned children holding their ports on this platform too.",
  "4. **Clean up.** If `SERVER_STARTED` is `true`, stop the ephemeral server now (`lsof -ti tcp:{port} | xargs kill`) — this is a standalone invocation with no `/wrap-up` to do it later, per `_shared/dev-url-detection.md`'s \"Standalone\" cleanup rule. (`SERVER_STARTED` is never `true` when sub-step 0 satisfied or resolved the deep tier via QA evidence, since sub-step 1 never ran on that path — this cleanup correctly no-ops.)",
  "   - **POSIX:** `kill {pid}` — with a port-isolation lease (#1795), the recorded port is known and the PID kill alone is sufficient; the `lsof -ti tcp:{port} | xargs kill` fallback for a stale PID is a no-lease/POSIX-only path (see `dev-url-detection.md`'s Step 0.5). When the trailing `detached:` token reads `detached:yes`, also kill the process group (`kill -- -{pid}`, the negative-pid form) so a detached dev command's own children don't outlive their leader — never do this when the field reads `detached:no`, since a non-detached server shares its process group with whatever spawned it and a group kill there could take down the caller's own shell.",
];

test('#4548: the three teardown sites use the listener-scoped form', () => {
  const form = '`lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill`';
  const carriesForm = (text) => flat(text).includes(form);
  const sites = [
    ['plugin', 'skills', '_shared', 'dev-url-detection.md'],
    ['plugin', 'skills', 'journey-health', 'deep-tier.md'],
    ['plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md'],
  ];
  assert.strictEqual(PRE_CHANGE_TEARDOWN_LINES.length, sites.length);
  sites.forEach((rel, k) => {
    assert.ok(carriesForm(read(...rel)), `${rel.slice(2).join('/')} must carry ${form}`);
    assert.ok(!carriesForm(PRE_CHANGE_TEARDOWN_LINES[k]), `the frozen pre-change line for ${rel.slice(2).join('/')} must not carry ${form}`);
    assert.ok(PRE_CHANGE_TEARDOWN_LINES[k].includes('`lsof -ti tcp:{port} | xargs kill`'), `frozen line ${k} lost its replaced bytes`);
  });
});
