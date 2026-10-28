'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { originWithTwoClones } = require('../../helpers/git-fixtures');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { run, parseArgs } = require('../../../plugin/bin/pre-review-catchup');
const { OUTCOMES, FETCH_TIMEOUT_MS, formatLine } = require('../../../plugin/bin/lib/worktree/pre-review-catchup');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { run: logDecision } = require('../../../plugin/bin/log-decision');

const roots = [];
test.after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const FIVE_LINES = ['l1', 'l2', 'l3', 'l4', 'l5'];

// `work` is the build checkout on branch `feat` (cut from `main`, which already carries
// a.txt and b.txt); `other` pushes upstream commits to origin's `main`.
function fixture() {
  const f = originWithTwoClones('ct-precatchup-');
  roots.push(f.root);
  const { work, other } = f;
  const write = (dir, name, lines, msg) => {
    fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
    f.run(dir, ['add', name]);
    f.run(dir, ['commit', '-q', '-m', msg]);
  };
  write(work, 'a.txt', FIVE_LINES, 'a');
  write(work, 'b.txt', FIVE_LINES, 'b');
  f.run(work, ['push', '-q', 'origin', 'main']);
  f.run(other, ['pull', '-q', 'origin', 'main']);
  f.run(work, ['checkout', '-q', '-b', 'feat']);
  // Replace line `n` (1-based) of a file with `value`, commit it.
  const editLine = (dir, name, n, value, msg) => {
    const lines = [...FIVE_LINES];
    lines[n - 1] = value;
    write(dir, name, lines, msg);
  };
  const pushUpstream = () => f.run(other, ['push', '-q', 'origin', 'main']);
  return { ...f, editLine, pushUpstream, head: () => f.run(work, ['rev-parse', 'HEAD']).trim() };
}

// A fake-.git anchored run dir under the fixture root, the shape resolveTarget accepts
// when mainRoot is the fixture root.
function withRunDir(f) {
  fs.mkdirSync(path.join(f.root, '.git'), { recursive: true });
  const runDir = path.join(f.root, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  return runDir;
}

function invoke(f, args, over = {}) {
  const out = []; const err = [];
  const code = run(args, {
    cwd: () => f.work,
    mainRoot: f.root,
    git: f.gitIn(f.work),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  });
  return { code, err: err.join(''), json: out.length ? JSON.parse(out.join('')) : null };
}

// A git seam that delegates to the real one but throws when `trap(args)` matches.
function trapGit(f, trap, stderr) {
  const real = f.gitIn(f.work);
  return (args) => {
    if (trap(args)) throw Object.assign(new Error(`git ${args[0]} failed`), { stderr });
    return real(args);
  };
}

const decisionsOf = (runDir) => fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
const MAIN = ['--integration-branch', 'main'];

test('AC1.1: overlapping upstream commit is merged before review', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'merged');
  f.run(f.work, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  assert.deepEqual(r.json.overlapFiles, ['a.txt']);
  assert.equal(r.json.overlapCommits, 1);
  assert.equal(r.json.upstreamCommits, 1);
  assert.equal(r.json.after, f.head());
  assert.match(r.json.line, /^- AUTO \d{2}:\d{2}:\d{2} — Pre-review catch-up: worktree branch advanced from [0-9a-f]{9} to [0-9a-f]{9} \(1 commit\(s\) from origin\/main; 1 touching 1 file\(s\) this branch changed: a\.txt\) — re-run the suite before the whole-branch review\. Reversibility: med \(merge commit on top of the build's own commits\)\.$/);
});

test('overlapCommits counts only the upstream commits that touch an overlap file', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream a');
  f.run(f.other, ['commit', '-q', '--allow-empty', '-m', 'upstream empty']);
  f.editLine(f.other, 'b.txt', 5, 'O5', 'upstream b');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.json.outcome, 'merged');
  assert.equal(r.json.upstreamCommits, 3);
  assert.equal(r.json.overlapCommits, 1);
  assert.deepEqual(r.json.overlapFiles, ['a.txt']);
});

test('overlapCommits counts commits, not files: two upstream commits on one overlap file', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream a 1');
  f.editLine(f.other, 'a.txt', 4, 'O4', 'upstream a 2');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.json.outcome, 'merged');
  assert.equal(r.json.upstreamCommits, 2);
  assert.equal(r.json.overlapCommits, 2);
  assert.deepEqual(r.json.overlapFiles, ['a.txt']);
});

test('AC1.2: the merged tree is what the review sees (reviewBase)', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.json.outcome, 'merged');
  assert.equal(r.json.reviewBase, f.run(f.work, ['rev-parse', 'origin/main']).trim());
  const changed = f.run(f.work, ['diff', '--name-only', r.json.reviewBase, 'HEAD']).trim().split('\n');
  assert.deepEqual(changed, ['a.txt']);
});

test('AC2.1: no overlap runs no merge and logs the check', () => {
  const f = fixture();
  const runDir = withRunDir(f);
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'b.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const before = f.head();
  const r = invoke(f, [...MAIN, '--run', runDir]);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'no-overlap');
  assert.equal(r.json.logged, true);
  assert.equal(r.json.upstreamCommits, 1);
  assert.equal(r.json.branchFileCount, 1);
  assert.equal(r.json.reviewBase, r.json.mergeBase);
  assert.equal(f.head(), before);
  const text = decisionsOf(runDir);
  assert.match(text, /SCANNED/);
  assert.match(text, /Pre-review catch-up:/);
  assert.match(text, /none touching the 1 file\(s\)/);
  assert.ok(text.indexOf('## /build') !== -1 && text.indexOf('## /build') < text.indexOf('- SCANNED'));
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

test('AC2.1: zero upstream commits is still a logged no-overlap', () => {
  const f = fixture();
  const runDir = withRunDir(f);
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const r = invoke(f, [...MAIN, '--run', runDir]);
  assert.equal(r.json.outcome, 'no-overlap');
  assert.equal(r.json.upstreamCommits, 0);
  assert.equal(r.json.logged, true);
  assert.match(decisionsOf(runDir), /^- SCANNED /m);
});

test('AC3.1: conflicting catch-up stops with the merge in progress', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 3, 'FEAT', 'feat edit');
  f.editLine(f.other, 'a.txt', 3, 'UPSTREAM', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'conflict');
  assert.deepEqual(r.json.conflictFiles, ['a.txt']);
  assert.equal(r.json.reviewBase, null);
  f.run(f.work, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  assert.match(r.json.line, /^- SCANNED /);
  assert.match(r.json.line, /conflicted on a\.txt — merge left in progress/);
});

// The resume path a HARD-GATE conflict stop sets up: the tree is mid-merge, so the
// unmerged paths show as uncommitted changes. That must stay `conflict`, never `dirty-tree`.
function conflictedFixture() {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 3, 'FEAT', 'feat edit');
  f.editLine(f.other, 'a.txt', 3, 'UPSTREAM', 'upstream edit');
  f.pushUpstream();
  assert.equal(invoke(f, MAIN).json.outcome, 'conflict');
  return f;
}

test('AC3.1: a re-run on an unresolved conflict is still conflict, not dirty-tree', () => {
  const f = conflictedFixture();
  const before = f.head();
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'conflict');
  assert.deepEqual(r.json.conflictFiles, ['a.txt']);
  assert.equal(r.json.reason, 'merge-in-progress');
  assert.equal(r.json.before, before);
  assert.equal(r.json.reviewBase, null);
  assert.equal(f.head(), before);
  f.run(f.work, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  assert.match(r.json.line, /^- SCANNED /);
  assert.match(r.json.line, /a merge already in progress \(MERGE_HEAD\) has unmerged paths on a\.txt — no new merge/);
  // The guard runs before the fetch: a failing fetch cannot turn a mid-merge tree into fail-open.
  f.run(f.work, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  assert.equal(invoke(f, MAIN).json.outcome, 'conflict');
});

test('AC3.1: a resolved but uncommitted merge is conflict with no conflictFiles', () => {
  const f = conflictedFixture();
  const before = f.head();
  fs.writeFileSync(path.join(f.work, 'a.txt'), `${['l1', 'l2', 'BOTH', 'l4', 'l5'].join('\n')}\n`);
  f.run(f.work, ['add', 'a.txt']);
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'conflict');
  assert.deepEqual(r.json.conflictFiles, []);
  assert.equal(r.json.reason, 'merge-in-progress');
  assert.equal(f.head(), before);
  f.run(f.work, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  assert.match(r.json.line, /has every conflict resolved but is not committed — no new merge; commit it before the whole-branch review/);
});

test('fetch failure fails open with a distinct SKIP line', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.run(f.work, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'fetch-failed');
  assert.ok(r.json.reason && r.json.reason.length <= 200);
  assert.match(r.json.line, /^- SKIP /);
  assert.match(r.json.line, /git fetch origin main failed/);
  assert.match(r.json.line, /fallback: no pre-review catch-up/);
});

test('fetch-failed carries reviewBase from the last-fetched ref, null when it does not resolve', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.run(f.work, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  const r = invoke(f, MAIN);
  assert.equal(r.json.outcome, 'fetch-failed');
  assert.equal(r.json.reviewBase, f.run(f.work, ['merge-base', 'HEAD', 'origin/main']).trim());
  f.run(f.work, ['update-ref', '-d', 'refs/remotes/origin/main']);
  const none = invoke(f, MAIN);
  assert.equal(none.code, 0);
  assert.equal(none.json.outcome, 'fetch-failed');
  assert.equal(none.json.reviewBase, null);
});

test('not-applicable on the integration branch itself', () => {
  const f = fixture();
  f.run(f.work, ['checkout', '-q', 'main']);
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'not-applicable');
  assert.match(r.json.line, /^- SKIP /);
  assert.match(r.json.line, /build branch is the integration branch main/);
});

test("overlap counts a rename's old path", () => {
  const f = fixture();
  f.run(f.work, ['mv', 'a.txt', 'c.txt']);
  f.run(f.work, ['commit', '-q', '-m', 'rename']);
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.ok(['merged', 'conflict'].includes(r.json.outcome), `outcome was ${r.json.outcome}`);
  assert.deepEqual(r.json.overlapFiles, ['a.txt']);
});

test('Filename too long is windows-longpath, not fetch-failed', () => {
  const stderr = 'error: unable to create file x: Filename too long';
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  for (const verb of ['fetch', 'merge']) {
    const r = invoke(f, MAIN, { git: trapGit(f, (a) => a[0] === verb, stderr) });
    assert.equal(r.code, 0, verb);
    assert.equal(r.json.outcome, 'windows-longpath', verb);
    assert.match(r.json.line, /^- SKIP /, verb);
    assert.ok(r.json.line.includes(`git ${verb} failed with Filename too long`), verb);
    assert.ok(!r.json.line.includes('fallback: no pre-review catch-up'), verb);
    assert.match(r.json.line, /_shared\/worktree-setup-windows-longpath\.md/, verb);
  }
});

test('a timed-out or prompting fetch is bounded, non-interactive and lands in fetch-failed', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const fetchOpts = [];
  const fetchArgs = [];
  const real = f.gitIn(f.work);
  const git = (args, opts) => {
    if (args[0] !== 'fetch') return real(args);
    fetchOpts.push(opts);
    fetchArgs.push(args);
    throw Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT', killed: true, stderr: '' });
  };
  const before = f.head();
  const r = invoke(f, MAIN, { git });
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'fetch-failed');
  assert.match(r.json.line, /^- SKIP /);
  assert.match(r.json.reason, /ETIMEDOUT/);
  assert.equal(f.head(), before);
  assert.equal(fetchOpts.length, 1);
  assert.deepEqual(fetchArgs, [['fetch', '--end-of-options', 'origin', 'main']]);
  assert.equal(FETCH_TIMEOUT_MS, 60000);
  assert.equal(fetchOpts[0].timeout, FETCH_TIMEOUT_MS);
  assert.equal(fetchOpts[0].env.GIT_TERMINAL_PROMPT, '0');
});

test('the real CLI wiring forwards the fetch timeout and no-prompt env to the spawn', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const childProcess = require('child_process');
  const original = childProcess.execFileSync;
  const fetchCalls = [];
  const cwds = [];
  // Records the fetch's argv/options and every call's cwd as the CLI built them, then runs
  // the call for real with the fixture identity env. A call bound anywhere but the injected
  // cwd is refused, never run: it would act on whatever checkout the test process sits in.
  childProcess.execFileSync = (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'fetch') fetchCalls.push({ args, opts });
    cwds.push(opts.cwd);
    if (opts.cwd !== f.work) throw new Error(`git spawned outside the injected cwd: ${opts.cwd}`);
    return original(cmd, args, { ...opts, env: { ...f.env, GIT_TERMINAL_PROMPT: opts.env && opts.env.GIT_TERMINAL_PROMPT } });
  };
  let code; const out = [];
  try {
    // No `git` override: this drives realDeps.git.
    code = run(MAIN, { cwd: () => f.work, mainRoot: f.root, stdout: (s) => out.push(s), stderr: () => {} });
  } finally {
    childProcess.execFileSync = original;
  }
  assert.deepEqual([...new Set(cwds)], [f.work]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.join('')).outcome, 'no-overlap');
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].args, ['fetch', '--end-of-options', 'origin', 'main']);
  assert.equal(fetchCalls[0].opts.timeout, FETCH_TIMEOUT_MS);
  assert.equal(fetchCalls[0].opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(fetchCalls[0].opts.windowsHide, true);
});

test('a failed merge with no unmerged paths is an undecided crash: exit 1, HEAD unchanged', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const before = f.head();
  const r = invoke(f, MAIN, { git: trapGit(f, (a) => a[0] === 'merge', 'fatal: refusing') });
  assert.equal(r.code, 1);
  assert.equal(r.json, null);
  assert.match(r.err, /pre-review-catchup\.js: /);
  assert.equal(f.head(), before);
});

test('a long-path merge failure aborts a partial merge, best effort', () => {
  const stderr = 'error: unable to create file x: Filename too long';
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const real = f.gitIn(f.work);
  const seam = ({ mergeHead, abortThrows }) => {
    const calls = [];
    // MERGE_HEAD exists only once the failed merge has left it behind (`mergeHead`).
    let mergeTried = false;
    const git = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'merge' && args[1] === '--abort') {
        if (abortThrows) throw new Error('abort failed');
        return '';
      }
      if (args[0] === 'merge') { mergeTried = true; throw Object.assign(new Error('git merge failed'), { stderr }); }
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) {
        if (!mergeHead || !mergeTried) throw new Error('no MERGE_HEAD');
        return 'deadbeef\n';
      }
      return real(args);
    };
    return { git, aborted: () => calls.includes('merge --abort') };
  };

  const partial = seam({ mergeHead: true });
  const r1 = invoke(f, MAIN, { git: partial.git });
  assert.equal(r1.json.outcome, 'windows-longpath');
  assert.equal(partial.aborted(), true);

  const clean = seam({ mergeHead: false });
  const r2 = invoke(f, MAIN, { git: clean.git });
  assert.equal(r2.json.outcome, 'windows-longpath');
  assert.equal(clean.aborted(), false);

  const failing = seam({ mergeHead: true, abortThrows: true });
  const r3 = invoke(f, MAIN, { git: failing.git });
  assert.equal(r3.code, 0);
  assert.equal(r3.json.outcome, 'windows-longpath');
  assert.equal(failing.aborted(), true);

  // A fetch long-path failure has no merge to abort.
  const onFetch = seam({ mergeHead: true });
  const guarded = (args, opts) => { if (args[0] === 'fetch') throw Object.assign(new Error('x'), { stderr }); return onFetch.git(args, opts); };
  assert.equal(invoke(f, MAIN, { git: guarded }).json.outcome, 'windows-longpath');
  assert.equal(onFetch.aborted(), false);
});

test('dirty tree refuses', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  fs.appendFileSync(path.join(f.work, 'a.txt'), 'uncommitted\n');
  const before = f.head();
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'dirty-tree');
  assert.equal(r.json.reason, 'a.txt');
  assert.match(r.json.line, /^- SKIP /);
  assert.equal(f.head(), before);
  assert.throws(() => f.run(f.work, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
});

test('no --run: line is returned, nothing logged', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const r = invoke(f, MAIN);
  assert.equal(r.code, 0);
  assert.equal(r.json.logged, false);
  assert.ok(!('logError' in r.json));
  assert.match(r.json.line, /^- SCANNED /);
});

test('unanchored --run keeps the outcome and reports logError', () => {
  const f = fixture();
  withRunDir(f);
  const shadow = path.join(f.work, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'decisions.md'), 'shadow\n');
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, [...MAIN, '--run', shadow]);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'merged');
  assert.equal(r.json.logged, false);
  assert.equal(typeof r.json.logError, 'string');
  assert.ok(r.json.logError.length > 0);
  assert.match(r.json.line, /^- AUTO /);
  assert.match(r.err, /pre-review-catchup\.js: could not append the decisions\.md entry: /);
  assert.equal(fs.readFileSync(path.join(shadow, 'decisions.md'), 'utf8'), 'shadow\n');
});

// The hand-log route for logged:false: `entry` written as `[entry]` and passed to
// log-decision.js --entries must yield exactly `line`, never a re-prefixed copy of it.
test('entry is the parts of line: formatEntry and log-decision --entries reproduce it', () => {
  const NOW = Date.UTC(2026, 9, 28, 7, 8, 9);
  const f = fixture();
  const runDir = withRunDir(f);
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  f.editLine(f.other, 'a.txt', 5, 'O5', 'upstream edit');
  f.pushUpstream();
  const r = invoke(f, MAIN, { now: () => NOW });
  assert.equal(r.json.outcome, 'merged');
  assert.deepEqual(Object.keys(r.json.entry).sort(), ['reversibility', 'section', 'status', 'step', 'text']);
  assert.equal(r.json.entry.section, '/build');
  assert.equal(r.json.entry.step, 'Pre-review catch-up');
  assert.equal(formatEntry({ ...r.json.entry, now: NOW }), r.json.line);
  const file = path.join(f.root, 'entry.json');
  fs.writeFileSync(file, JSON.stringify([r.json.entry]));
  const code = logDecision(['--run', runDir, '--entries', file], {
    cwd: () => f.work, mainRoot: f.root, now: () => NOW, stdout: () => {}, stderr: (s) => assert.fail(s),
  });
  assert.equal(code, 0);
  const text = decisionsOf(runDir);
  assert.ok(text.includes(`\n${r.json.line}\n`), text);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

test('a missing --run dir keeps the outcome and reports logError', () => {
  const f = fixture();
  withRunDir(f);
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const r = invoke(f, [...MAIN, '--run', path.join(f.root, 'no-such-run')]);
  assert.equal(r.code, 0);
  assert.equal(r.json.outcome, 'no-overlap');
  assert.equal(r.json.logged, false);
  assert.match(r.json.logError, /does not exist/);
});

test('a throwing append keeps the outcome and reports logError', () => {
  const f = fixture();
  const runDir = withRunDir(f);
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const r = invoke(f, [...MAIN, '--run', runDir], { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(r.code, 0);
  assert.equal(r.json.logged, false);
  assert.equal(r.json.logError, 'disk full');
  assert.match(r.err, /could not append the decisions\.md entry: disk full/);
});

test('an undecided git failure outside the fetch exits 1', () => {
  const f = fixture();
  f.editLine(f.work, 'a.txt', 1, 'F1', 'feat edit');
  const r = invoke(f, MAIN, { git: trapGit(f, (a) => a[0] === 'merge-base', 'fatal: boom') });
  assert.equal(r.code, 1);
  assert.equal(r.json, null);
  assert.match(r.err, /pre-review-catchup\.js: /);
});

test('usage errors exit 2 and never spawn git', () => {
  const f = fixture();
  const calls = [];
  const git = (args) => { calls.push(args); return ''; };
  const cases = [
    [],
    ['--integration-branch'],
    ['--integration-branch', ''],
    ['--integration-branch', '  '],
    ['--integration-branch', '--run'],
    ['--integration-branch', '-v'],
    ['--integration-branch', '-'],
    // A refspec, not a branch name: `git fetch origin <it>` would create or force-update a local ref.
    ['--integration-branch', 'main:refs/heads/x'],
    ['--integration-branch', '+main:main'],
    ['--integration-branch', 'a..b'],
    [...MAIN, '--run'],
    [...MAIN, '--run', ''],
    [...MAIN, '--bogus'],
  ];
  for (const argv of cases) {
    const r = invoke(f, argv, { git });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /usage: pre-review-catchup\.js/, JSON.stringify(argv));
    assert.equal(r.json, null, JSON.stringify(argv));
  }
  assert.deepEqual(calls, []);
});

test('--help prints the usage with every outcome and exits 0 without git', () => {
  const f = fixture();
  const calls = [];
  const out = [];
  const code = run(['--help'], { cwd: () => f.work, git: (a) => { calls.push(a); return ''; }, stdout: (s) => out.push(s), stderr: () => {} });
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  for (const o of OUTCOMES) assert.ok(out.join('').includes(o), o);
});

test('parseArgs reads both flags and rejects malformed values', () => {
  assert.deepEqual(parseArgs(['--integration-branch', 'main', '--run', '/r']), { integrationBranch: 'main', run: '/r', help: false });
  assert.ok(parseArgs(['--integration-branch']).error);
  assert.ok(parseArgs(['--run']).error);
  assert.ok(parseArgs(['--run', '--help']).error);
});

test('OUTCOMES is the frozen seven-value list and formatLine covers every outcome', () => {
  assert.ok(Object.isFrozen(OUTCOMES));
  assert.deepEqual([...OUTCOMES], ['not-applicable', 'fetch-failed', 'windows-longpath', 'dirty-tree', 'no-overlap', 'merged', 'conflict']);
  const base = {
    integrationBranch: 'main', before: 'a'.repeat(40), after: 'b'.repeat(40), mergeBase: 'c'.repeat(40), reviewBase: null,
    upstreamCommits: 3, branchFileCount: 2, overlapCommits: 2, overlapFiles: ['1', '2', '3', '4', '5', '6'], conflictFiles: ['x'], reason: 'fetch',
  };
  for (const outcome of OUTCOMES) {
    const l = formatLine({ ...base, outcome });
    assert.ok(['AUTO', 'SKIP', 'SCANNED'].includes(l.status), outcome);
    assert.ok(l.text && l.reversibility, outcome);
  }
  assert.match(formatLine({ ...base, outcome: 'merged' }).text, /changed: 1, 2, 3, 4, 5, …\)/);
  assert.ok(formatLine({ ...base, outcome: 'merged' }).text.includes(`from ${'a'.repeat(9)} to ${'b'.repeat(9)}`));
});

test('the CLI shell itself appends through formatEntry and appendEntry', () => {
  const raw = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'pre-review-catchup.js'));
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  assert.equal(verdict, 'ok', STRIPPER_VERDICT_MESSAGES[verdict]);
  assert.match(src, /require\('\.\/lib\/log-decision\/append'\)/);
  assert.match(src, /formatEntry\(/);
  assert.match(src, /appendEntry/);
});
