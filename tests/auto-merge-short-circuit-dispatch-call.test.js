'use strict';
// Conformance suite for record #3711: wrap-up/auto-merge-short-circuit.md's dispatch branch used to
// key on a claim blob's runId (claims/issue-N.json), which a human resuming a dispatched run also
// matched -- so a human-run session was taken for a dispatch Task call and reached the local-merge
// relay. It now keys on run-state.json session identity via bin/lib/dispatch/task-call.js.
//
// Live-corpus read (skill-prose-conformance-tests: a documented convention this project wants
// enforced). Go-red proof [IL-105]: each pattern also runs against a frozen pre-change excerpt.
// Whitespace collapsed on haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const SHORT_CIRCUIT_PATH = path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md');
const RAW = fs.readFileSync(SHORT_CIRCUIT_PATH, 'utf8');
const FLAT = collapse(RAW);
const PLUGIN_DIR = path.join(ROOT, 'plugin').split(path.sep).join('/');

const HEADING = '**Dispatch-call branch — check this before merging anything.**';
const NEXT_OPENER = '**`integration-model: pr-first`:**';

// Frozen pre-change excerpts -- the Dispatch-claim paragraph, the "If the merge conflicts"
// paragraph, and the closing paragraph exactly as they read before #3711.
const PRE_CHANGE = collapse([
  `**Dispatch-claim branch — check this before merging anything.** Read the claim blob at
\`claims/issue-\${ISSUE}.json\` on \`claims-registry\` (per \`_shared/issue-claims.md\`'s "The lock")
and check whether its \`runId\` equals \`basename($PIPELINE_RUN_DIR)\`. A match means this record is
claimed under the very run this session is executing — either \`/claude-tweaks:dispatch\` Step 4
minting \`PIPELINE_RUN_DIR\` before its Task calls, or a human resuming that same claimed run — this
call is (or stands in for) one of dispatch's own Task() calls: cwd-pinned to the worktree it
inherited, with no path to the main checkout. This is what routes a dispatched **singleton**'s
merge decision through this file's own short-circuit rather than \`settle-and-merge.md\`'s
group-scoped Auto-merge gate. No claim, or a claim held under a different run id, means this is a
genuine top-level human-run session — fall through to the interactive path below.`,
  `**If the merge conflicts:** conflict resolution requires judgment a headless
run can't supply — abort the merge (\`git merge --abort\`) and fall back to
rendering the console normally, exactly as an
\`auto:build\`-only record would, logging why the auto-merge path was abandoned.`,
  `This check does not apply to \`MULTISPEC_REVIEW_DEFER=1\` runs — an \`auto:merge\`-granted
record still gets the normal, fully-blocking consolidated Review Console, same as any other spec
in the batch. No dispatch-claim branch or equivalent auto-merge gate exists for the multi-spec
console today — it is exclusively a human-run-batch surface, never a dispatch one (dispatch
Step 5 dispatches groups one at a time). \`skills/dispatch/SKILL.md\`'s own "Auto-merge gate" is
the mechanism a dispatched group actually uses: a singleton via the dispatch-claim branch above,
a bundle via \`settle-and-merge.md\`'s own group-scoped gate directly; this file's own direct-merge
procedure is reachable only by an interactive, human-run single-record \`/flow\` (or, per the
dispatch-claim branch above, a session standing in for one).`,
].join('\n\n'));

function assertPinned(pattern, label) {
  assert.match(FLAT, pattern, `${label}: missing from live prose`);
  assert.doesNotMatch(PRE_CHANGE, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

// The branch paragraph: from its heading to the pr-first sub-branch opener (collapsed).
function branchSlice() {
  const start = FLAT.indexOf(HEADING);
  assert.ok(start > -1, 'Dispatch-call branch heading not found');
  const end = FLAT.indexOf(NEXT_OPENER, start);
  assert.ok(end > -1, 'pr-first sub-branch opener not found after the heading');
  return FLAT.slice(start, end);
}

// Same, from the raw (uncollapsed) text -- the fenced snippet needs its line structure.
function rawBranchSlice() {
  const start = RAW.indexOf(HEADING);
  assert.ok(start > -1, 'Dispatch-call branch heading not found (raw)');
  const end = RAW.indexOf(NEXT_OPENER, start);
  assert.ok(end > -1, 'pr-first sub-branch opener not found after the heading (raw)');
  return RAW.slice(start, end);
}

test('AC4.2: the Dispatch-call branch heading is present', () => {
  assertPinned(/\*\*Dispatch-call branch — check this before merging anything\.\*\*/, 'branch heading');
});

test('AC6.1: the branch names run-state.json, CLAUDE_CODE_SESSION_ID and bin/lib/dispatch/task-call.js', () => {
  const slice = branchSlice();
  for (const needle of ['run-state.json', 'CLAUDE_CODE_SESSION_ID', 'bin/lib/dispatch/task-call.js']) {
    assert.ok(slice.includes(needle), `branch paragraph must name ${needle}`);
    assert.ok(!PRE_CHANGE.includes(needle), `${needle} is already in the pre-change text — cannot go red`);
  }
});

test('AC6.2: a non-true result falls through to the direct-merge path', () => {
  const slice = branchSlice();
  assert.match(slice, /any other output[\s\S]*?genuine top-level, human-run session/i);
  assert.doesNotMatch(PRE_CHANGE, /any other output/i);
});

test('the claim-blob read is gone from the branch paragraph', () => {
  assert.match(PRE_CHANGE, /runId/, 'go-red guard: the pre-change text must carry the runId claim read');
  const slice = branchSlice();
  assert.doesNotMatch(slice, /claims\/issue-/);
  assert.doesNotMatch(slice, /runId/);
});

test('AC7.1: the branch-guard abort takes the console fallback', () => {
  assertPinned(/the branch guard aborts[\s\S]{0,200}?fall back to rendering the console normally/, 'branch-guard abort fallback');
});

test('the closing paragraph no longer says a session standing in for one', () => {
  assert.match(PRE_CHANGE, /a session standing in for one/, 'go-red guard: the pre-change text carries the phrase');
  assert.doesNotMatch(FLAT, /a session standing in for one/);
  assert.doesNotMatch(FLAT, /dispatch-claim branch/i);
});

test('AC4.1: no live dispatch-claim reference survives in plugin/ or docs/skill-graph.md, and flow/SKILL.md drops the pre-existing gap clause', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'plugin'));
  files.push(path.join(ROOT, 'docs/skill-graph.md'));
  const hits = files.filter((f) => /dispatch-claim/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(hits.map((f) => path.relative(ROOT, f)), []);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'plugin/skills/flow/SKILL.md'), 'utf8'), /pre-existing gap/);
});

test('the branch snippet, executed verbatim, answers true only for this run\'s own dispatch Task call', (t) => {
  const slice = rawBranchSlice();
  const fence = /```bash\n([\s\S]*?)\n```/.exec(slice);
  assert.ok(fence, 'a fenced bash block must sit inside the branch paragraph');
  const snippet = fence[1];
  assert.ok(snippet.includes('isDispatchTaskCallForRun'), 'snippet must call isDispatchTaskCallForRun');
  // Run the snippet byte-for-byte: the shell expands ${CLAUDE_PLUGIN_ROOT} from the child's env, the
  // way an agent's would.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-call-snippet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runState = path.join(dir, 'run-state.json');
  const run = (sessionId, overrides = {}) => {
    const env = { ...process.env, PIPELINE_RUN_DIR: dir, CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PLUGIN_ROOT: PLUGIN_DIR, ...overrides };
    if (sessionId === undefined) delete env.CLAUDE_CODE_SESSION_ID;
    return execFileSync('bash', ['-c', snippet], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  };

  fs.writeFileSync(runState, JSON.stringify({ dispatched: true, sessionId: 'S' }));
  assert.strictEqual(run('S'), 'true', 'matching session id on a dispatched run');
  assert.strictEqual(run('T'), 'false', 'a foreign session id (a human resuming)');

  fs.writeFileSync(runState, JSON.stringify({ dispatched: true, sessionId: 'H', dispatchSessionId: 'D' }));
  assert.strictEqual(run('H'), 'false', 'a human resume that re-stamped sessionId (dispatchSessionId stays the dispatcher\'s)');
  assert.strictEqual(run('D'), 'true', 'the dispatching session');
  assert.strictEqual(run(undefined), 'false', 'CLAUDE_CODE_SESSION_ID unset');
  // The prose reads a non-zero exit as human-run: a helper that cannot load must exit non-zero, never print true.
  assert.throws(() => run('D', { CLAUDE_PLUGIN_ROOT: path.join(dir, 'no-such-plugin') }), (e) => e.status !== 0 && !/true/.test(String(e.stdout)));

  fs.rmSync(runState);
  assert.strictEqual(run('S'), 'false', 'no run-state.json');

  fs.writeFileSync(runState, '{not json');
  assert.strictEqual(run('S'), 'false', 'unparseable run-state.json');
});
