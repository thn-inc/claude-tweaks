'use strict';
// Conformance suite for record #3762: the local-merge auto-merge procedures ran `hooks.js close-run`
// BEFORE the checks that can fail (branch guard, composer, a predicted conflict), so a failed merge
// parked a run that was already closed -- unprotected, worktree assignment cleared (since #3023
// close-run also nulls run-state.json's `worktree`). The order is now: pre-merge checks (nothing
// mutated) -> close-run -> merge -> push, with a re-protect (`record-worktree`) on the late-failure path.
// #3809 extends this to the human-present multi-run reconciliation (flow/worktree-merge.md): each branch's
// run closes only after that branch's own pre-merge checks.
//
// One SITES entry per procedure; a new site is data only. Live-corpus read (skill-prose-conformance-tests:
// a documented convention this project wants enforced) plus extract-and-run of the two fences whose
// behavior matters. Go-red proof [IL-105]: the ordering check also runs against a frozen pre-change
// excerpt. Whitespace collapsed on haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { readRunState } = require('../plugin/bin/lib/hooks/context');
const { fixtureGit, gitRepo, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const HOOKS = path.join(PLUGIN_DIR, 'bin', 'hooks.js');
const collapse = (s) => s.replace(/\s+/g, ' ');
const posix = (p) => p.split(path.sep).join('/');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-lm-order-'));
process.on('exit', () => fs.rmSync(SCRATCH, { recursive: true, force: true }));
const WORKTREE = path.join(SCRATCH, 'fixture-worktree'); // never created: record-worktree only stamps the path
const SUBJECT_DIR = path.join(SCRATCH, 'subject');
fs.mkdirSync(SUBJECT_DIR, { recursive: true });

// One entry per local-merge auto-merge procedure. `vars` maps each {placeholder} to its fixture value.
// `readsWorktree`: the procedure reads the worktree from run-state.json itself (settle-and-merge takes
// `{group-worktree}` from dispatch context and has no read). `logNeedle`: the literal clause, after the
// re-protect fence, that tells the agent to log a re-stamp that did not print "worktree recorded".
// `worktreeVar`: the placeholder that names the worktree the re-protect fence re-stamps. `preservesOwner`:
// the re-protect runs in another session than the run's owner, so its fence must not re-stamp the run's `sessionId`.
const SITES = [
  {
    label: 'auto-merge-short-circuit.md',
    file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md',
    readsWorktree: true,
    logNeedle: 'log any other line',
    worktreeVar: 'worktree-path',
    vars: {
      'integration-branch': 'main',
      branch: 'feat',
      issue: '1',
      tag: 'fast-lane',
      'subject-dir': posix(SUBJECT_DIR),
      'worktree-path': posix(WORKTREE),
    },
  },
  {
    label: 'settle-and-merge.md',
    file: 'plugin/skills/dispatch/settle-and-merge.md',
    readsWorktree: false,
    logNeedle: 'log any other line',
    worktreeVar: 'group-worktree',
    vars: {
      'integration-branch': 'main',
      branch: 'feat',
      issue: '1',
      'second-issue': '2',
      'subject-dir': posix(SUBJECT_DIR),
      'group-worktree': posix(WORKTREE),
    },
  },
  {
    label: 'local-merge-auto-finish.md',
    file: 'plugin/skills/_shared/local-merge-auto-finish.md',
    readsWorktree: true,
    logNeedle: 'carry it into the `--text`',
    worktreeVar: 'worktree-path',
    vars: {
      'base-branch': 'main',
      'feature-branch': 'feat',
      issue: '1',
      'subject-dir': posix(SUBJECT_DIR),
      'worktree-path': posix(WORKTREE),
    },
  },
  {
    label: 'worktree-merge.md',
    file: 'plugin/skills/flow/worktree-merge.md',
    readsWorktree: true,
    preservesOwner: true,
    logNeedle: 'log any other line',
    worktreeVar: 'worktree-path',
    vars: {
      'base-branch': 'main',
      branch: 'feat',
      issue: '1',
      'second-issue': '2',
      'subject-dir': posix(SUBJECT_DIR),
      'worktree-path': posix(WORKTREE),
    },
  },
];

const PRE_MERGE_NEEDLE = 'git merge-tree --write-tree';
const CLOSE_RUN_NEEDLE = 'bin/hooks.js" close-run --run';
const MERGE_NEEDLE = 'git merge --no-ff';
const REPROTECT_NEEDLE = 'bin/hooks.js" record-worktree --run';
const WORKTREE_READ_NEEDLE = "run-state.json').worktree";

// Bash fence bodies, dedented by the opening fence's indent (a fence inside a numbered list item is indented).
// CRLF is normalized first: a core.autocrlf Windows checkout reads every skill file with \r\n.
const fencesOf = (text) => [...text.replace(/\r\n/g, '\n').matchAll(/^([ \t]*)```bash\n([\s\S]*?)\n[ \t]*```/gm)]
  .map((m) => m[2].split('\n').map((line) => (line.startsWith(m[1]) ? line.slice(m[1].length) : line)).join('\n'));

// The body of the unique ```bash fence containing `needle`.
function extractFence(text, needle) {
  const hits = fencesOf(text).filter((body) => body.includes(needle));
  assert.strictEqual(hits.length, 1, `expected exactly one bash fence containing ${JSON.stringify(needle)}, found ${hits.length}`);
  return hits[0];
}

// Run a fence under bash, substituting {placeholders} from `vars`; ${CLAUDE_PLUGIN_ROOT} and $RUN_DIR
// expand from the child env, the way an agent's shell would.
function runFence(body, { cwd, env = {}, vars = {} }) {
  const script = body.replace(/\{([a-z-]+)\}/g, (whole, name) => (name in vars ? vars[name] : whole));
  const r = spawnSync('bash', ['-c', script], {
    cwd, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Index of `needle` inside the first bash fence that contains it and sits after `from`, in the collapsed
// text (-1 when none): prose may mention the same command inline earlier, so fences are the anchor.
function fenceIndex(text, needle, from = -1) {
  const flat = collapse(text);
  let found = -1;
  for (const body of fencesOf(text)) {
    const at = body.indexOf(needle);
    if (at < 0) continue;
    const flatBody = collapse(body);
    const flatAt = flatBody.indexOf(collapse(needle));
    const start = flat.indexOf(flatBody);
    if (start < 0) continue;
    const idx = start + flatAt;
    if (idx > from && (found < 0 || idx < found)) found = idx;
  }
  return found;
}

function locate(text) {
  const flat = collapse(text);
  const P = fenceIndex(text, PRE_MERGE_NEEDLE);
  const C = flat.indexOf(CLOSE_RUN_NEEDLE);
  const M = fenceIndex(text, MERGE_NEEDLE);
  const R = M < 0 ? -1 : fenceIndex(text, REPROTECT_NEEDLE, M);
  const W = flat.lastIndexOf(WORKTREE_READ_NEEDLE); // the LAST read: an earlier ledger-deletion read is fine
  const closeRuns = flat.split(CLOSE_RUN_NEEDLE).length - 1;
  return { P, C, M, R, W, closeRuns };
}

// Ordering errors; empty when pre-merge checks < close-run < merge < re-protect and no worktree read follows
// close-run. With `readsWorktree`, the read must also exist and precede close-run (it nulls the field).
function checkOrdering(text, { readsWorktree = false } = {}) {
  const { P, C, M, R, W, closeRuns } = locate(text);
  const errors = [];
  if (P < 0) errors.push(`no bash fence containing ${PRE_MERGE_NEEDLE}`);
  if (closeRuns !== 1) errors.push(`expected exactly one ${CLOSE_RUN_NEEDLE}, found ${closeRuns}`);
  if (M < 0) errors.push(`no bash fence containing ${MERGE_NEEDLE}`);
  if (R < 0) errors.push(`no ${REPROTECT_NEEDLE} fence after the merge`);
  if (P >= 0 && C >= 0 && M >= 0 && R >= 0 && !(P < C && C < M && M < R)) {
    errors.push(`order is not pre-merge checks < close-run < merge < re-protect (P=${P} C=${C} M=${M} R=${R})`);
  }
  if (W >= 0 && C >= 0 && W > C) errors.push(`the worktree is read from run-state.json after close-run nulled it (W=${W} C=${C})`);
  if (readsWorktree && !(W >= 0 && C >= 0 && W < C)) errors.push(`the worktree read must exist and precede close-run (W=${W} C=${C})`);
  return errors;
}

// Move the close-run fence ahead of the pre-merge-checks fence: a pure permutation of two whole fences,
// so every marker is still present exactly once and only the order changes.
function closeRunBeforePreMerge(text) {
  const fences = [...text.matchAll(/^[ \t]*```bash\n[\s\S]*?\n[ \t]*```/gm)];
  const only = (needle) => {
    const hits = fences.filter((m) => m[0].includes(needle));
    assert.strictEqual(hits.length, 1, `expected exactly one bash fence containing ${JSON.stringify(needle)}`);
    return hits[0];
  };
  const pre = only(PRE_MERGE_NEEDLE);
  const close = only(CLOSE_RUN_NEEDLE);
  assert.ok(pre.index < close.index, 'the live close-run fence follows the pre-merge checks fence');
  const without = text.slice(0, close.index) + text.slice(close.index + close[0].length);
  return `${without.slice(0, pre.index)}${close[0]}\n\n${without.slice(pre.index)}`;
}

// Frozen pre-change excerpt: the local-merge opener and the merge fence exactly as they read before
// #3762 (short-circuit lines 237-242 and 283-289), close-run ahead of the guard and composer.
const PRE_CHANGE = [
  '**`integration-model: local-merge`:** run the Verdict backstop above first (anything but `{n}=1`,',
  'stop here and fall through). Then, before merging, clear this run\'s worktree',
  'assignment as `flow/worktree-merge.md`\'s reconciliation does',
  '(`node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"`) so',
  'the merge, landing in the main checkout, isn\'t denied as a wrong-checkout',
  'commit.',
  '',
  '```bash',
  'CURRENT=$(git branch --show-current)',
  'if [ "$CURRENT" != "{integration-branch}" ]; then',
  '  echo "Main checkout is on \'$CURRENT\', not \'{integration-branch}\' — a concurrent session switched it. Abort, do not merge." >&2',
  '  exit 1',
  'fi',
  'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag {tag} --range {integration-branch}...{branch} --out-dir "{subject-dir}" || exit 1',
  'git merge --no-ff {branch} -F "{subject-dir}/message.txt"',
  '```',
].join('\n');

test('go-red: the frozen pre-change excerpt fails the ordering check', () => {
  assert.ok(checkOrdering(PRE_CHANGE).length > 0);
});

function git(cwd, ...args) {
  return fixtureGit(['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { encoding: 'utf8' });
}

// Main checkout on `main` with a clean `feat` branch adding b.txt. `conflict` makes both sides edit a.txt line 1.
function makeRepo({ conflict = false } = {}) {
  const dir = gitRepo({ parent: SCRATCH, branch: 'main' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  if (conflict) fs.writeFileSync(path.join(dir, 'a.txt'), 'feat\ntwo\n');
  git(dir, 'add', 'a.txt', 'b.txt');
  git(dir, 'commit', '-q', '-m', 'feat');
  git(dir, 'checkout', '-q', 'main');
  if (conflict) {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'main\ntwo\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'main edit');
  }
  return dir;
}

// A plugin root whose compose-subject.js stub writes <--out-dir>/message.txt and exits $STUB_EXIT.
function stubPluginRoot() {
  const root = fs.mkdtempSync(path.join(SCRATCH, 'stub-plugin-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin', 'compose-subject.js'), [
    "const fs = require('fs'); const path = require('path');",
    "const dir = process.argv[process.argv.indexOf('--out-dir') + 1];",
    "fs.mkdirSync(dir, { recursive: true });",
    "fs.writeFileSync(path.join(dir, 'message.txt'), 'subject\\n');",
    'process.exit(Number(process.env.STUB_EXIT || 0));',
  ].join('\n'));
  return root;
}

function tmpProject() {
  const dir = gitRepo({ parent: SCRATCH });
  const run = path.join(dir, '.claude-tweaks', 'pipelines', '2026-10-20T000000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  return { dir, run };
}

// A run owned by 'owner-session' is closed, then `fence` runs as 'reconciler-session' (the re-protect of a
// run another terminal owns). Returns the run's owner afterwards; the fence must leave it untouched.
function ownerAfterReprotect(fence, { vars, worktreeVar }) {
  const { dir, run } = tmpProject();
  const hook = (env, ...args) => execFileSync(process.execPath, [HOOKS, ...args], {
    cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
  });
  hook({ CLAUDE_CODE_SESSION_ID: 'owner-session' }, 'record-worktree', '--run', run, vars[worktreeVar]);
  hook({ CLAUDE_CODE_SESSION_ID: 'owner-session' }, 'close-run', '--run', run);
  const r = runFence(fence, {
    cwd: dir,
    env: { CLAUDE_PLUGIN_ROOT: posix(PLUGIN_DIR), RUN_DIR: posix(run), CLAUDE_CODE_SESSION_ID: 'reconciler-session' },
    vars: { ...vars, 'run-dir': posix(run) },
  });
  assert.strictEqual(r.code, 0, r.stderr);
  return readRunState(run).sessionId;
}
const REPROTECT_OWNER_CLAUSE = 'env -u CLAUDE_CODE_SESSION_ID ';
function assertKeepsOwner(fence, site) {
  assert.strictEqual(ownerAfterReprotect(fence, site), 'owner-session', "the re-protect re-stamped the reconciler's session as the run's owner");
}

for (const site of SITES) {
  const raw = readText(path.join(ROOT, site.file));
  const { label, vars, readsWorktree, logNeedle, worktreeVar } = site;

  test(`${label}: pre-merge checks, close-run, merge, re-protect appear in that order`, () => {
    assert.deepStrictEqual(checkOrdering(raw, site), []);
  });

  test(`go-red: ${label} with the close-run fence moved ahead of the pre-merge checks fails the ordering check`, () => {
    const permuted = closeRunBeforePreMerge(raw);
    assert.notStrictEqual(permuted, raw, 'the permutation must change the text');
    const { P, C, M, R, closeRuns } = locate(permuted);
    assert.ok(P >= 0 && C >= 0 && M >= 0 && R >= 0 && closeRuns === 1, 'every marker is still present exactly once');
    const errors = checkOrdering(permuted, site);
    assert.ok(errors.some((e) => /order is not/.test(e)), `expected an "order is not" error, got ${JSON.stringify(errors)}`);
  });

  test(`${label}: the worktree read ${readsWorktree ? 'precedes close-run (required)' : 'is not required'}`, () => {
    const { W, C } = locate(raw);
    if (readsWorktree) {
      assert.ok(W >= 0 && W < C, `expected the run-state.json worktree read before close-run (W=${W} C=${C})`);
      const without = raw.split(WORKTREE_READ_NEEDLE).join('');
      assert.notStrictEqual(without, raw);
      const errors = checkOrdering(without, site);
      assert.ok(errors.some((e) => /worktree read must exist/.test(e)), `go-red: a removed read must fail, got ${JSON.stringify(errors)}`);
    } else {
      assert.ok(W < 0 || W < C, 'a worktree read, if present, precedes close-run');
    }
  });

  test(`${label}: a CRLF checkout yields the same fences and ordering`, () => {
    const crlf = raw.replace(/\n/g, '\r\n');
    assert.ok(fencesOf(raw).length > 0, 'expected at least one bash fence');
    assert.deepStrictEqual(fencesOf(crlf), fencesOf(raw));
    assert.deepStrictEqual(checkOrdering(crlf, site), []);
  });

  test(`${label}: the pre-merge checks fence contains no close-run and no git merge --no-ff`, () => {
    const fence = extractFence(raw, PRE_MERGE_NEEDLE);
    assert.ok(!fence.includes(CLOSE_RUN_NEEDLE), 'pre-merge checks must not close the run');
    assert.ok(!fence.includes(MERGE_NEEDLE), 'pre-merge checks must not merge');
  });

  test(`${label}: pre-merge checks fence, run against a fixture repo`, () => {
    const fence = extractFence(raw, PRE_MERGE_NEEDLE);
    const plugin = stubPluginRoot();
    const runDir = fs.mkdtempSync(path.join(SCRATCH, 'run-'));
    const runState = JSON.stringify({ worktree: '/wt', status: 'active' });
    fs.writeFileSync(path.join(runDir, 'run-state.json'), runState);
    const attempt = (repo, { env = {}, overrides = {} } = {}) => {
      fs.rmSync(SUBJECT_DIR, { recursive: true, force: true });
      const r = runFence(fence, {
        cwd: repo,
        env: { CLAUDE_PLUGIN_ROOT: posix(plugin), RUN_DIR: posix(runDir), ...env },
        vars: { ...vars, ...overrides },
      });
      assert.strictEqual(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'), runState, 'run-state.json must be untouched');
      assert.strictEqual(git(repo, 'status', '--porcelain'), '', 'the pre-merge checks must leave the tree untouched');
      return r;
    };

    const clean = attempt(makeRepo());
    assert.strictEqual(clean.code, 0, clean.stderr);
    assert.ok(fs.existsSync(path.join(SUBJECT_DIR, 'message.txt')), 'the composer line ran');

    const other = makeRepo();
    git(other, 'checkout', '-q', '-b', 'other');
    const guarded = attempt(other);
    assert.strictEqual(guarded.code, 1);
    assert.match(guarded.stderr, /Abort, do not merge/);

    assert.notStrictEqual(attempt(makeRepo({ conflict: true })).code, 0, 'a predicted conflict aborts');
    assert.notStrictEqual(attempt(makeRepo(), { env: { STUB_EXIT: '1' } }).code, 0, 'a composer failure aborts');
    const branchVar = 'feature-branch' in vars ? 'feature-branch' : 'branch';
    assert.notStrictEqual(attempt(makeRepo(), { overrides: { [branchVar]: 'nope' } }).code, 0, 'an unknown ref aborts, it does not merge');
  });

  test(`${label}: the re-protect fence restores the worktree assignment after close-run`, () => {
    const fence = extractFence(raw, REPROTECT_NEEDLE);
    const { dir, run } = tmpProject();
    const hook = (...args) => execFileSync(process.execPath, [HOOKS, ...args], {
      cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
    });
    const wt = vars[worktreeVar];
    assert.ok(wt, `SITES entry names no ${worktreeVar} fixture value`);
    hook('record-worktree', '--run', run, wt);
    hook('close-run', '--run', run);
    let state = readRunState(run);
    assert.strictEqual(state.worktree, null, 'close-run clears the worktree assignment');
    assert.strictEqual(state.status, 'clean');

    const r = runFence(fence, { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: posix(PLUGIN_DIR), RUN_DIR: posix(run) }, vars: { ...vars, 'run-dir': posix(run) } });
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /worktree recorded for/);
    state = readRunState(run);
    assert.strictEqual(state.worktree, path.resolve(wt));
    assert.strictEqual(state.status, 'active');

    if (site.preservesOwner) {
      assertKeepsOwner(fence, site);
      assert.ok(fence.includes(REPROTECT_OWNER_CLAUSE), 'the fence unsets CLAUDE_CODE_SESSION_ID');
      const mutated = fence.replace(REPROTECT_OWNER_CLAUSE, '');
      assert.notStrictEqual(mutated, fence);
      assert.throws(() => assertKeepsOwner(mutated, site), /re-stamped the reconciler/, 'go-red: a fence that inherits CLAUDE_CODE_SESSION_ID must fail');
    }
  });

  test(`${label}: the fallback logs a re-stamp that does not print "worktree recorded"`, () => {
    const { R } = locate(raw);
    assert.ok(R > -1, 're-protect fence not found');
    const after = collapse(raw).slice(R, R + 600);
    assert.match(after, /worktree recorded/);
    assert.ok(after.includes(collapse(logNeedle)), `a re-stamp that fails must be logged, not ignored: expected ${JSON.stringify(logNeedle)} within the window`);
  });
}

const KEEPS_RUN = 'keeps its worktree assignment and `active` status';
function skipAbortKeepsRun(text) {
  const flat = collapse(text);
  const errors = [];
  for (const label of ['**Skip this branch** →', '**Abort remaining merges** →']) {
    const at = flat.indexOf(label);
    if (at < 0) { errors.push(`no ${label} bullet`); continue; }
    if (!flat.slice(at, at + 300).includes(KEEPS_RUN)) errors.push(`${label} does not keep its run`);
  }
  return errors;
}

test("AC2.1: worktree-merge.md's Skip and Abort bullets keep the run", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  assert.deepStrictEqual(skipAbortKeepsRun(live), []);
  const flat = collapse(live);
  const skipAt = flat.indexOf('**Skip this branch** →');
  const mutated = flat.slice(0, skipAt) + flat.slice(skipAt).replace(KEEPS_RUN, 'is closed');
  assert.ok(skipAbortKeepsRun(mutated).some((e) => /Skip this branch/.test(e)), 'go-red: a Skip bullet that closes the run must fail');
});

// AC3: every failure that can follow close-run re-protects. The Re-protect section names each trigger, and
// each failure site carries its own re-protect instruction (prose a fence test cannot reach).
const REPROTECT_TRIGGERS = ['branch-guard abort', 'merge failure', 'abandoned or stopped before it lands', 'push failure'];
const REPROTECT_SITES = [
  ['**The branch guard aborted** (stderr ends', "re-protect this branch's run", 200],
  ['**Failed** — if a `MERGE_HEAD` exists', "re-protect this branch's run", 120],
  ['abandoned or stopped before it lands', 're-protect every run closed for it', 200],
  ['**On push failure**', 're-protect every run step 3 closed', 300],
];
function reprotectCoverage(text) {
  const flat = collapse(text);
  const errors = [];
  const start = flat.indexOf('### Re-protect');
  const section = start < 0 ? '' : flat.slice(start, flat.indexOf('### ', start + 4));
  if (start < 0) errors.push('no ### Re-protect section');
  for (const trigger of REPROTECT_TRIGGERS) if (!section.includes(trigger)) errors.push(`Re-protect section does not name: ${trigger}`);
  for (const [label, action, span] of REPROTECT_SITES) {
    const at = flat.indexOf(collapse(label));
    if (at < 0) errors.push(`no failure site ${JSON.stringify(label)}`);
    else if (!flat.slice(at, at + span).includes(action)) errors.push(`${label} does not ${action}`);
  }
  return errors;
}

test("AC3: worktree-merge.md re-protects after every failure that can follow close-run", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  assert.deepStrictEqual(reprotectCoverage(live), []);
  const dropTrigger = live.replace('or a step 6 push failure', 'or a step 6 hiccup');
  assert.ok(reprotectCoverage(dropTrigger).some((e) => /push failure/.test(e)), 'go-red: a trigger dropped from the Re-protect list must fail');
  const dropSite = live.replace("re-protect this branch's run (**Re-protect** below), then stop", 'stop');
  assert.notStrictEqual(dropSite, live);
  assert.ok(reprotectCoverage(dropSite).some((e) => /branch guard aborted/.test(e)), 'go-red: a guard abort with no re-protect must fail');
  const dropFailed = live.replace("Then re-protect this branch's run (**Re-protect** below). A conflict", 'A conflict');
  assert.notStrictEqual(dropFailed, live);
  assert.ok(reprotectCoverage(dropFailed).some((e) => /Failed/.test(e)), 'go-red: a merge failure with no re-protect must fail');
});

// The Skip bullet says a predicted conflict never closed the run (step 3 runs only after step 2's checks pass).
const SKIP_NEVER_CLOSED = 'never closed when step 2 predicted the conflict';
function skipNeverClosed(text) {
  const flat = collapse(text);
  const at = flat.indexOf('**Skip this branch** →');
  return at > -1 && flat.slice(at, at + 250).includes(SKIP_NEVER_CLOSED);
}

test("AC2.1: worktree-merge.md's Skip bullet says a predicted conflict never closed the run", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  assert.ok(skipNeverClosed(live), 'Skip bullet does not say a predicted conflict never closed the run');
  const mutated = live.replace(SKIP_NEVER_CLOSED, 'closed when step 2 predicted the conflict');
  assert.notStrictEqual(mutated, live);
  assert.ok(!skipNeverClosed(mutated), 'go-red: a Skip bullet that drops the clause must fail');
});

// AC3's log call takes its text from a file: the branch name and the hook's output never pass through shell quoting.
function logFenceErrors(text) {
  const flat = collapse(text);
  const at = fenceIndex(text, REPROTECT_NEEDLE, fenceIndex(text, MERGE_NEEDLE));
  const fence = fencesOf(text).find((body) => body.includes('bin/log-decision.js') && flat.indexOf(collapse(body)) > at);
  if (!fence) return ['no log-decision.js fence after the re-protect fence'];
  const errors = [];
  if (!fence.includes('--text-file "{text-file}"')) errors.push('the log fence does not read its text from {text-file}');
  if (/--text '/.test(fence)) errors.push('the log fence single-quotes substituted text');
  return errors;
}

test("AC3: worktree-merge.md logs a failed re-stamp through --text-file", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  assert.deepStrictEqual(logFenceErrors(live), []);
  const quoted = live.replace('--text-file "{text-file}"', "--text 'Re-stamp of {branch}: {output line}'");
  assert.notStrictEqual(quoted, live);
  assert.ok(logFenceErrors(quoted).length > 0, 'go-red: a single-quoted --text fence must fail');
});

test("worktree-merge.md's run-state read takes {run-dir} as an argument, so a quote in the path cannot break it", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  const readLine = extractFence(live, WORKTREE_READ_NEEDLE).split('\n')[0].replace(/\s+# ->.*$/, '');
  const runDir = path.join(SCRATCH, "o'brien run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: '/wt/feat', status: 'active' }));
  const run = (line) => runFence(line, { cwd: SCRATCH, vars: { 'run-dir': posix(runDir) } });
  const r = run(readLine);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '/wt/feat');
  const inlined = readLine.replace("require(process.argv[1]+'/run-state.json')", "require('{run-dir}/run-state.json')").replace(/ "\{run-dir\}"$/, '');
  assert.notStrictEqual(inlined, readLine);
  assert.notStrictEqual(run(inlined).code, 0, 'go-red: a {run-dir} pasted into the script text breaks on a quote in the path');
});

test('no plugin/ file still carries "Not fixed here; there is no"', () => {
  const hits = fs.readdirSync(PLUGIN_DIR, { recursive: true })
    .filter((rel) => String(rel).endsWith('.md'))
    .filter((rel) => collapse(readText(path.join(PLUGIN_DIR, String(rel)))).includes('Not fixed here; there is no'));
  assert.deepStrictEqual(hits, []);
});
