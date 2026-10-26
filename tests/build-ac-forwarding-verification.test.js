'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sessionTmpRoot } = require('../plugin/bin/lib/session-tmp');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const WRITE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --file "{sample-path}"';
const RESOLVE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_SAMPLE=sdd-dispatch-sample-{run-id}.txt';
const DELETE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-dispatch-sample.txt --delete';
const SECTION_MARK = '**Standing AC-forwarding verification (#496).**';

// #496: #360's AC-forwarding instruction (dispatch.md's "Forward the spec's
// Acceptance Criteria to per-task review" paragraph) went two real
// occurrences (the #360 batch itself, record #1537) without ever being
// verified live, because SDD's own scratch directory is gitignored and
// swept by its Finish step before /build regains control. These pin the
// standing verification added so a third unverified occurrence can't happen
// silently again.

test('#496: dispatch.md instructs SDD to preserve one composed per-task review prompt under $PIPELINE_RUN_DIR, past its own Finish step', () => {
  const t = read('plugin/skills/build/dispatch.md');
  assert.match(t, /\*\*Standing AC-forwarding verification \(#496\)\.\*\*/);
  const section = t.slice(t.indexOf('**Standing AC-forwarding verification (#496).**'));
  assert.ok(section.includes(RESOLVE_CMD), 'resolves a session-scratch path for the sample');
  assert.ok(!section.includes('eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js"'), 'no eval: a variable set in one Bash call does not survive into the next');
  assert.ok(section.includes('`{run-id}` is `basename "$PIPELINE_RUN_DIR"`'), '{run-id} is defined inline');
  assert.ok(section.includes(WRITE_CMD), 'persists the sample through the sanctioned writer');
  assert.ok(section.includes('never an Edit/Write straight to the run directory'), 'forbids a direct run-dir Edit/Write');
  assert.match(section, /so it survives past SDD's own Finish step/);
  assert.match(section, /Skip this entirely for a single-task plan/);
});

test('#496 wording: dispatch.md never names a nonexistent SDD "Cleanup step"', () => {
  assert.doesNotMatch(read('plugin/skills/build/dispatch.md'), /Cleanup step/);
});

test('#496: the three verification outcomes (present / absent / no-sample) are each logged, never silently skipped', () => {
  const t = read('plugin/skills/build/dispatch.md');
  const section = t.slice(t.indexOf('**Standing AC-forwarding verification (#496).**'));
  assert.match(section, /\*\*Present:\*\* log `AUTO \{time\} — AC-forwarding verified/);
  const present = section.slice(section.indexOf('- **Present:**'), section.indexOf('- **Absent from an existing sample file:**'));
  assert.ok(present.includes(DELETE_CMD), 'the Present bullet deletes the sample through the sanctioned writer');
  assert.match(section, /\*\*Absent from an existing sample file:\*\*/);
  assert.match(section, /file it via `\/claude-tweaks:capture` as its own fix-shaped record/);
  assert.match(section, /\*\*No sample file at all\*\*/);
  assert.match(section, /log-decision\.js --status SKIP --section "\/build"/);
  assert.match(section, /Standalone `\/build` \(no `\$PIPELINE_RUN_DIR`\): skip this verification entirely/);
});

// #3044: the harness refuses an Edit/Write to the run directory from a
// worktree-isolated session, so the sample's write and delete commands in
// dispatch.md must work as written from a worktree cwd. Extract them from the
// live prose and run them.
test('AC1.1/AC2.1 the dispatch.md sample commands run from a worktree cwd and round-trip the sample', { skip: process.platform === 'win32' && 'runs dispatch.md commands through POSIX /bin/sh' }, () => {
  const t = read('plugin/skills/build/dispatch.md');
  const section = t.slice(t.indexOf(SECTION_MARK));
  const cmds = [...section.matchAll(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/write-run-artifact\.js"[^`]*)`/g)].map((m) => m[1]);
  assert.equal(cmds.length, 2, 'exactly the write and the delete command');
  assert.ok(cmds[0].endsWith('--file "{sample-path}"'));
  assert.ok(cmds[1].endsWith('--delete'));
  assert.ok(section.includes(RESOLVE_CMD));

  const runId = '2026-10-18T090000-record-3044';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acfwd-'));
  const sessionId = `acfwd-${path.basename(root)}`;
  const sessionRoot = sessionTmpRoot(sessionId);
  try {
    const main = path.join(root, 'main');
    const runDir = path.join(main, '.claude-tweaks', 'pipelines', runId);
    const worktree = path.join(main, '.claude', 'worktrees', 'dispatch-record-3044');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(path.join(main, '.git'));
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/dispatch-record-3044\n');
    const env = { ...process.env, PIPELINE_RUN_DIR: runDir, CLAUDE_CODE_SESSION_ID: sessionId };
    const plugin = path.join(ROOT, 'plugin');
    const sh = (cmd) => execFileSync('/bin/sh', ['-c', cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, plugin)], { cwd: worktree, env, encoding: 'utf8' });

    // Step 1 of the documented flow: resolve the session-scratch path (no eval) and parse the printed literal.
    const printed = sh(RESOLVE_CMD.replace('{run-id}', path.basename(runDir)));
    const m = printed.match(/^SDD_SAMPLE=("[^"\n]+")$/m);
    assert.ok(m, `resolve prints SDD_SAMPLE="<path>": ${printed}`);
    const samplePath = JSON.parse(m[1]);
    assert.ok(samplePath.endsWith(`sdd-dispatch-sample-${runId}.txt`));

    // Step 2: the Write tool puts the composed prompt at that literal path.
    const excerpt = 'AC-EXCERPT: the forwarded Acceptance Criteria 1.1';
    fs.writeFileSync(samplePath, `reviewer prompt\n${excerpt}\n`);

    // Step 3: persist via the writer, {sample-path} substituted with the literal (a separate shell, no inherited variable).
    const target = path.join(runDir, 'sdd-dispatch-sample.txt');
    sh(cmds[0].replace('{sample-path}', samplePath));
    const persisted = fs.readFileSync(target, 'utf8');
    assert.equal(persisted, fs.readFileSync(samplePath, 'utf8'));
    assert.ok(persisted.includes(excerpt));
    sh(cmds[1]);
    assert.ok(!fs.existsSync(target), 'the delete command removes the sample');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (sessionRoot) fs.rmSync(sessionRoot, { recursive: true, force: true });
  }
});
