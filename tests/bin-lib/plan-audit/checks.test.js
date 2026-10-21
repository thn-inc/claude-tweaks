'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkA, checkB, checkC, checkD, headroomCheck, looksPassing, isGovernedMdPath, checkPremiseRefs,
} = require('../../../plugin/bin/lib/plan-audit/checks');
const { composedBytesReport } = require('../../../plugin/bin/lib/skill-audit/context-cost');
const { RAIL_BYTES } = require('../../../plugin/bin/lib/skill-audit/budgets');

function makeTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-audit-checks-'));
}

// ── Check A ──────────────────────────────────────────────────────────────

test('checkA fails when a Modify path does not exist', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Modify', path: 'nope.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nope.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes for Create when the parent directory exists, even though the file itself does not', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  try {
    const result = checkA([{ type: 'Create', path: 'plugin/bin/new.js' }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #2745: a lone Create/Test bullet whose parent directory is missing by
// exactly one level (the repo-root-relative directory itself doesn't exist,
// but its own parent — here, the repo root — does) passes on its own: the
// same task creates the new directory as a side effect of writing the file,
// so nothing else in the plan needs to pre-create or reference it. This
// closes the standing "mkdir the new module dir before auditing" workaround.
test('checkA passes a lone Create bullet creating exactly one new directory level (#2745)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/new.js' }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA fails for Create when TWO directory levels are missing and nothing else covers it', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/deeper/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nowhere/deeper/new.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes for an existing Delete path', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'gone.js'), '');
  try {
    const result = checkA([{ type: 'Delete', path: 'gone.js' }], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA treats Test like Create — parent dir suffices for a brand-new test file', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  try {
    const result = checkA([{ type: 'Test', path: 'tests/new.test.js' }], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #1999: Check A gains plan-awareness — a Create:/Test: bullet's missing
// parent, when more than one directory level is missing, is satisfied by
// ANOTHER entry in the same plan (never by itself alone — see this plan's
// own Deviation note on AC1's "first creation" parenthetical). #2745 later
// narrowed this to multi-level gaps specifically: a single missing directory
// level passes on its own (the pinned tests above), since creating the file
// creates that one directory as a side effect; a deeper gap still needs
// cross-reference coverage, preserved by the tests below.
test('checkA passes a Create bullet whose missing parent is created by ANOTHER Create bullet in the same plan (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/FILE.md' },
      { type: 'Create', path: 'newdir/nested/subdir/OTHER.md' },
    ], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA still fails a lone, unsupported Create bullet with a multi-level missing parent (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/nested/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nowhere/nested/new.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes a two-new-level Create bullet supported by another bullet at the same deepest directory (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/FILE.md' },
      { type: 'Test', path: 'newdir/nested/subdir/FILE.test.md' },
    ], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA: a Modify under a plan-created directory still fails — Modify needs the file today (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/A.md' },
      { type: 'Create', path: 'newdir/nested/subdir/OTHER.md' },
      { type: 'Modify', path: 'newdir/nested/subdir/FILE.md' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['newdir/nested/subdir/FILE.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA missingDetail names the nearest existing ancestor for a still-missing parent (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/nested/new.js' }], repo);
    assert.strictEqual(result.missingDetail.length, 1);
    assert.strictEqual(result.missingDetail[0].path, 'nowhere/nested/new.js');
    assert.strictEqual(result.missingDetail[0].nearestExistingAncestor, '.');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Ledger row 4: a Modify: bullet for a path an EARLIER task's Create:
// bullet names passes even though the path doesn't exist on disk yet — a
// module created in Task N and extended in Task N+1 is a normal plan shape
// (#3307's plan had to relabel those bullets Extends: to pass). "Earlier"
// is the bullet's position in the entries array, which — since
// extractFileEntries walks the plan top to bottom and each task's Files:
// section is contiguous — tracks task order.
test('checkA passes a Modify bullet whose path an EARLIER task Create:s (ledger row 4)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'x.js' },
      { type: 'Modify', path: 'x.js' },
    ], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA still fails a Modify bullet whose path only a LATER task Create:s (ledger row 4)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Modify', path: 'x.js' },
      { type: 'Create', path: 'x.js' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['x.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA still fails a Modify bullet whose path no task Create:s (ledger row 4)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'other.js' },
      { type: 'Modify', path: 'x.js' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['x.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #3493: Check A used fs.existsSync as proof that a Create/Test bullet's
// parent is a directory, so a plan creating a file under a path that is
// currently a regular file passed the audit and failed only at write time.
test('AC1.1 (#3493): checkA reports a Create bullet whose parent path is a regular file', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'README.md'), '');
  try {
    const result = checkA([{ type: 'Create', path: 'README.md/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['README.md/new.js']);
    assert.deepStrictEqual(result.missingDetail, [{ path: 'README.md/new.js', nearestExistingAncestor: '.' }]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: checkA reports a Test bullet whose parent path is a regular file', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'tests'), '');
  try {
    const result = checkA([{ type: 'Test', path: 'tests/new.test.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['tests/new.test.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a regular file two levels up is rescued neither by the one-new-level rule nor by a sibling bullet', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'notes.txt'), '');
  try {
    const result = checkA([
      { type: 'Create', path: 'notes.txt/sub/a.js' },
      { type: 'Create', path: 'notes.txt/sub/b.js' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['notes.txt/sub/a.js', 'notes.txt/sub/b.js']);
    assert.deepStrictEqual(result.missingDetail.map((d) => d.nearestExistingAncestor), ['.', '.']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a regular-file parent under a real directory names that directory as the nearest existing ancestor', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'tool.js'), '');
  try {
    const result = checkA([{ type: 'Create', path: 'plugin/bin/tool.js/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missingDetail, [{ path: 'plugin/bin/tool.js/new.js', nearestExistingAncestor: path.join('plugin', 'bin') }]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a parent that is a symlink to a real directory still passes', (t) => {
  const repo = makeTmpRepo();
  try {
    fs.mkdirSync(path.join(repo, 'real'));
    try {
      fs.symlinkSync(path.join(repo, 'real'), path.join(repo, 'linked'), 'dir');
    } catch (err) {
      t.skip(`cannot create a directory symlink here (${err.code})`);
      return;
    }
    const result = checkA([{ type: 'Create', path: 'linked/new.js' }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a Modify bullet under a regular file names the enclosing directory as the nearest existing ancestor', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'tool.js'), '');
  try {
    const result = checkA([{ type: 'Modify', path: 'plugin/bin/tool.js/x.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missingDetail, [{ path: 'plugin/bin/tool.js/x.js', nearestExistingAncestor: path.join('plugin', 'bin') }]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a parent that is a dangling symlink is reported, not accepted', (t) => {
  const repo = makeTmpRepo();
  try {
    try {
      fs.symlinkSync(path.join(repo, 'gone'), path.join(repo, 'dangling'), 'dir');
    } catch (err) {
      t.skip(`cannot create a directory symlink here (${err.code})`);
      return;
    }
    const result = checkA([{ type: 'Create', path: 'dangling/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['dangling/new.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check B ──────────────────────────────────────────────────────────────

test('checkB is a no-op (ok, empty) when the plan declares no Scope keywords', () => {
  const repo = makeTmpRepo();
  try {
    assert.deepStrictEqual(checkB([], [], repo), { ok: true, unplanned: [] });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB flags a matched file absent from the plan', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'unplanned.txt'), 'mentions PLAYWRIGHT_MCP here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unplanned, ['unplanned.txt']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB does not flag a matched file that IS in the plan', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'planned.txt'), 'mentions PLAYWRIGHT_MCP here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], ['planned.txt'], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unplanned, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB is case-insensitive', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'x.txt'), 'lowercase playwright_mcp appears here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB never descends into node_modules or .git (control match)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'x.txt'), 'PLAYWRIGHT_MCP');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'x.txt'), 'PLAYWRIGHT_MCP');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unplanned, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Premise-refs ─────────────────────────────────────────────────────────

test('checkPremiseRefs is a no-op (ok, empty) when the plan declares no Premise-refs', () => {
  const repo = makeTmpRepo();
  try {
    assert.deepStrictEqual(checkPremiseRefs([], repo), { ok: true, unresolved: [] });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkPremiseRefs flags a local path that does not resolve to an existing file', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkPremiseRefs(['db/migrations/nonexistent.sql'], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unresolved, ['db/migrations/nonexistent.sql']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkPremiseRefs does not flag a local path that DOES exist', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'db', 'migrations', 'real.sql'), '-- real');
  try {
    const result = checkPremiseRefs(['db/migrations/real.sql'], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unresolved, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkPremiseRefs never treats a URL as unresolved (no network access — recorded, not fetch-verified)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkPremiseRefs(['https://example.com/does/not/matter'], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unresolved, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check C ──────────────────────────────────────────────────────────────

test('looksPassing: exit code 0 is always a passing signature', () => {
  assert.strictEqual(looksPassing(0, ''), true);
});

test('looksPassing: non-zero exit with failure markers is not a passing signature', () => {
  assert.strictEqual(looksPassing(1, 'FAIL: 1 test failed'), false);
});

test('looksPassing: non-zero exit is not a passing signature even with a stray "PASS" substring alongside a failure marker', () => {
  assert.strictEqual(looksPassing(1, 'PASS suite-a\nFAIL suite-b'), false);
});

test('checkC flags a task whose command already exits 0 despite declaring Expected: FAIL', () => {
  const calls = [];
  const deps = { run: (command, cwd) => { calls.push({ command, cwd }); return { exitCode: 0, output: '# tests 3\n# pass 3\n' }; } };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node --test a.test.js', expected: 'FAIL with "not defined"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].task, '1');
  assert.deepStrictEqual(calls, [{ command: 'node --test a.test.js', cwd: '/repo' }]);
});

test('checkC does not flag a command that errors or cleanly fails pre-dispatch', () => {
  const deps = { run: () => ({ exitCode: 1, output: 'Error: Cannot find module\n' }) };
  const result = checkC(
    [{ taskNumber: '5', title: 'Later task', command: 'node --test e.test.js', expected: 'FAIL with "not defined"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkC with no verification checks passes trivially', () => {
  const result = checkC([], '/repo', { run: () => { throw new Error('must not be called'); } });
  assert.strictEqual(result.ok, true);
});

test('checkC returns an empty warnings array when no unparseable Step 2s are passed', () => {
  const result = checkC([], '/repo', { run: () => { throw new Error('must not be called'); } });
  assert.deepStrictEqual(result.warnings, []);
});

test('checkC surfaces unparseable Step 2s as warnings without affecting ok or findings', () => {
  const unparseableStep2s = [
    { taskNumber: '3', title: 'Add the row', raw: '- [ ] **Step 2: Run it to confirm FAIL**\n\n```bash\nnode --test x.test.js\n```' },
  ];
  const result = checkC([], '/repo', {}, unparseableStep2s);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '3');
  assert.strictEqual(result.warnings[0].title, 'Add the row');
  assert.match(result.warnings[0].raw, /Step 2: Run it to confirm FAIL/);
});

test('checkC: a real finding and an unparseable warning coexist independently', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'PASS\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node -e "process.exit(0)"', expected: 'FAIL' }],
    '/repo', deps,
    [{ taskNumber: '2', title: 'B', raw: 'raw text' }],
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '2');
});

// #1999: Check C's append-to-existing exception.
test('checkC: append-shaped task with a passing pre-run is not a finding — reported under appendShaped (#1999)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'existing.test.js'), '// existing, passes today\n');
  const deps = { run: () => ({ exitCode: 0, output: '# pass 3\n' }) };
  const check = {
    taskNumber: '1', title: 'Append tests', command: 'node --test tests/existing.test.js', expected: 'FAIL',
    step1Text: 'Append cases to `tests/existing.test.js`.',
    taskFileEntries: [{ type: 'Modify', path: 'tests/existing.test.js' }],
    appendMarker: false,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.appendShaped.length, 1);
    assert.strictEqual(result.appendShaped[0].task, '1');
    assert.strictEqual(result.appendShaped[0].path, 'tests/existing.test.js');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: same shape without a matching Modify/Test bullet is still a finding (#1999)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'existing.test.js'), '// existing\n');
  const deps = { run: () => ({ exitCode: 0, output: '# pass 3\n' }) };
  const check = {
    taskNumber: '1', title: 'No Files bullet', command: 'node --test tests/existing.test.js', expected: 'FAIL',
    step1Text: 'Append cases to `tests/existing.test.js`.',
    taskFileEntries: [],
    appendMarker: false,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.findings.length, 1);
    assert.deepStrictEqual(result.appendShaped, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: the explicit "FAIL after Step 1" marker passes without the path heuristic (#1999)', () => {
  const repo = makeTmpRepo();
  const deps = { run: () => ({ exitCode: 0, output: '# pass\n' }) };
  const check = {
    taskNumber: '1', title: 'Marked', command: 'node --test whatever.test.js', expected: 'FAIL after Step 1',
    step1Text: null,
    taskFileEntries: [],
    appendMarker: true,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appendShaped.length, 1);
    assert.strictEqual(result.appendShaped[0].path, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: the existing AC6 non-discriminating fixture still fails (no append shape, no marker) (#1999)', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'PASS\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node -e "process.exit(0)"', expected: 'FAIL with "guard not present"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.appendShaped, []);
});

// ── Check C — VCS-mutation refusal (#2593) ──────────────────────────────────

test('checkC refuses a `git stash` command extracted from prose that only mentions it (#2593) — never executes it, reported as a warning with a vcs-mutation-refusal reason', () => {
  const deps = { run: () => { throw new Error('must not be called — refused commands are never executed'); } };
  const result = checkC(
    [{
      taskNumber: '1',
      title: 'Remove the plan file',
      command: 'git stash push -u -m tag',
      expected: 'FAIL',
    }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
  assert.deepStrictEqual(result.executed, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '1');
  assert.strictEqual(result.warnings[0].command, 'git stash push -u -m tag');
  assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal');
  assert.strictEqual(result.warnings[0].verb, 'git stash');
});

test('checkC refuses every git/gh mutation verb in the refusal list', () => {
  const verbs = [
    'git stash list', 'git commit -am wip', 'git push origin main', 'git reset --hard',
    'git checkout main', 'git switch main', 'git clean -fd', 'git rebase main', 'git merge main',
    'gh issue close 1', 'gh pr merge 1',
  ];
  for (const command of verbs) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `expected a refusal warning for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC refuses a compound command whose mutation verb follows && (#2593 AC4)', () => {
  const deps = { run: () => { throw new Error('must not be called'); } };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'npm test && git commit -am wip', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal');
  assert.strictEqual(result.warnings[0].verb, 'git commit');
});

test('checkC refuses a compound command whose mutation verb follows ; or |', () => {
  for (const command of ['npm test; git push origin main', 'npm test | git commit -am wip']) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC does not refuse a mutation verb appearing only inside a quoted argument', () => {
  const deps = { run: () => ({ exitCode: 1, output: 'Error: not defined\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'node -e "console.log(\'git commit\')"', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.executed.length, 1);
});

test('checkC still executes and records a genuinely non-mutating command exactly as before (regression, AC3/AC6)', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'pass\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'node -e "process.exit(0)"', expected: 'FAIL with "guard not present"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.executed, [{ task: '1', command: 'node -e "process.exit(0)"' }]);
});

test('checkC refuses a git mutation verb behind a leading -C/-c global flag (#2593 class bypass)', () => {
  const commands = [
    'git -C /some/path stash push -u -m tag',
    'git -c user.name=x commit -am wip',
    'git --git-dir=/repo/.git push origin main',
  ];
  for (const command of commands) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `expected a refusal warning for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC refuses a gh mutation verb behind a leading -R/--repo global flag (#2593 class bypass)', () => {
  const commands = ['gh -R owner/repo pr merge 1', 'gh --repo owner/repo issue close 1'];
  for (const command of commands) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `expected a refusal warning for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC a git subcommand not on the refusal list (e.g. git status) still executes normally', () => {
  const calls = [];
  const deps = { run: (command, cwd) => { calls.push({ command, cwd }); return { exitCode: 0, output: 'clean\n' }; } };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'git status', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(result.executed, [{ task: '1', command: 'git status' }]);
});

// ── Headroom ─────────────────────────────────────────────────────────────

test('isGovernedMdPath matches plugin/skills/**/*.md only', () => {
  assert.strictEqual(isGovernedMdPath('plugin/skills/build/SKILL.md'), true);
  assert.strictEqual(isGovernedMdPath('plugin/skills/build/plan-audit.md'), true);
  assert.strictEqual(isGovernedMdPath('docs/plugin-structure.md'), false);
  assert.strictEqual(isGovernedMdPath('plugin/bin/lib/plan-audit/checks.js'), false);
});

function writeFileOfSize(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'x'.repeat(bytes));
}

test('headroomCheck flags a near-ceiling governed file with < 1,024 B headroom (soft flag, ok stays true) — see #553', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/plan-audit.md';
  writeFileOfSize(path.join(repo, rel), RAIL_BYTES - 500);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.breaches.length, 0);
    assert.strictEqual(result.nearCeiling.length, 1);
    assert.strictEqual(result.nearCeiling[0].file, rel);
    assert.strictEqual(result.nearCeiling[0].headroom, 500);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports a breach (ok: false) for a governed file already over the ceiling', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/SKILL.md';
  writeFileOfSize(path.join(repo, rel), RAIL_BYTES + 200);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.breaches.length, 1);
    assert.strictEqual(result.breaches[0].file, rel);
    assert.strictEqual(result.breaches[0].bytes, RAIL_BYTES + 200);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck ignores a non-governed .md file even when near the ceiling', () => {
  const repo = makeTmpRepo();
  const rel = 'docs/plugin-structure.md';
  writeFileOfSize(path.join(repo, rel), RAIL_BYTES + 200);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.nearCeiling, []);
    assert.deepStrictEqual(result.breaches, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck ignores Create entries — nothing to measure yet', () => {
  const repo = makeTmpRepo();
  try {
    const result = headroomCheck([{ type: 'Create', path: 'plugin/skills/build/new.md' }], repo);
    assert.deepStrictEqual(result, {
      ok: true, nearCeiling: [], breaches: [], composed: [], composedNearCeiling: [], composedErrors: [],
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck measures against the Read-limit rail: breach above RAIL_BYTES, near at >= 90% of it, neither below (#3310)', () => {
  const near = Math.ceil(0.9 * RAIL_BYTES);
  const cases = [
    { name: 'over-rail.md', bytes: RAIL_BYTES + 1, breach: true, nearFlag: false },
    { name: 'at-rail.md', bytes: RAIL_BYTES, breach: false, nearFlag: true },
    { name: 'near-edge.md', bytes: near, breach: false, nearFlag: true },
    { name: 'old-ceiling.md', bytes: 51201, breach: false, nearFlag: true },
    { name: 'below-near.md', bytes: near - 1, breach: false, nearFlag: false },
  ];
  for (const c of cases) {
    const repo = makeTmpRepo();
    try {
      const rel = path.join('plugin', 'skills', 'demo', c.name);
      writeFileOfSize(path.join(repo, rel), c.bytes);
      const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
      assert.strictEqual(result.breaches.length, c.breach ? 1 : 0, `${c.name}: breach`);
      assert.strictEqual(result.nearCeiling.length, c.nearFlag ? 1 : 0, `${c.name}: nearCeiling`);
      if (c.nearFlag) assert.strictEqual(result.nearCeiling[0].headroom, RAIL_BYTES - c.bytes);
      assert.strictEqual(result.ok, !c.breach, `${c.name}: ok`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('a clean plan (no missing paths, no scope keywords, no FAIL findings, no headroom issues) passes every check', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/plan-audit.md';
  writeFileOfSize(path.join(repo, rel), 1000);
  try {
    const a = checkA([{ type: 'Modify', path: rel }], repo);
    const b = checkB([], [], repo);
    const c = checkC([], repo);
    const h = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.ok(a.ok && b.ok && c.ok && h.ok);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Headroom — composed rows (#1997, the multi-spec pre-flight [IL-140] lacked) ──

// A synthetic plugin root: one skill file (`plugin/skills/x/SKILL.md`) carrying
// a real compose call site for step "demo", and two marker-bearing sources
// under `plugin/skills/_shared/`. `bBytes` lets the over-ceiling fixture pad
// one source past RAIL_BYTES without duplicating the whole layout.
// `bMarkerBroken` swaps source b for an unclosed `when:` marker (a malformed
// source #1997's `composedErrors` path exists to surface, rather than
// silently drop) — mutually exclusive with `bBytes`.
function writeComposeFixture(repo, { bBytes = null, bMarkerBroken = false } = {}) {
  const skillDir = path.join(repo, 'plugin', 'skills', 'x');
  const sharedDir = path.join(repo, 'plugin', 'skills', '_shared');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: x',
    'description: fixture',
    '---',
    '',
    'Compose call:',
    '',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/b.md"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sharedDir, 'a.md'), [
    '<!-- when: mode=auto -->',
    'Source A body.',
    '<!-- /when -->',
    '',
  ].join('\n'));
  let bContent;
  if (bMarkerBroken) {
    bContent = '<!-- when: mode=auto -->\nSource B body, unclosed marker.\n';
  } else {
    bContent = bBytes === null ? 'Source B body.\n' : `${'x'.repeat(bBytes)}\n`;
  }
  fs.writeFileSync(path.join(sharedDir, 'b.md'), bContent);
}

test('headroomCheck reports a composed row for a call site whose source the plan touches, with over: 0 when small', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    const expectedRows = composedBytesReport(path.join(repo, 'plugin'));
    const demoRow = expectedRows.find((r) => r.step === 'demo');
    assert.ok(demoRow, 'fixture must produce a demo call site');
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.strictEqual(result.composed.length, 1);
    assert.strictEqual(result.composed[0].step, 'demo');
    assert.strictEqual(result.composed[0].max, demoRow.max);
    assert.strictEqual(result.composed[0].ceiling, RAIL_BYTES);
    assert.strictEqual(result.composed[0].over, 0);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports no composed rows when the plan touches neither source of a call site', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/x/SKILL.md' }], repo);
    assert.deepStrictEqual(result.composed, []);
    assert.deepStrictEqual(result.composedNearCeiling, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck fires the same composed row for two specs regardless of which one touches which source (multi-spec pre-flight, IL-140)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    // Two separate spec plans — modeled as two independent headroomCheck calls,
    // each naming only its own single touched source.
    const specA = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    const specB = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/b.md' }], repo);
    assert.strictEqual(specA.composed.length, 1);
    assert.strictEqual(specB.composed.length, 1);
    assert.strictEqual(specA.composed[0].step, 'demo');
    assert.strictEqual(specB.composed[0].step, 'demo');
    assert.strictEqual(specA.composed[0].max, specB.composed[0].max);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck flags an over-ceiling composed row and flips ok to false', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo, { bBytes: RAIL_BYTES + 2000 });
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.strictEqual(result.composed.length, 1);
    assert.strictEqual(result.composed[0].step, 'demo');
    assert.ok(result.composed[0].over > 0, `expected over > 0, got ${result.composed[0].over}`);
    assert.strictEqual(result.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports composedErrors (not composed) for a call site whose touched source is malformed, ok stays true (#1997)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo, { bMarkerBroken: true });
    // The plan touches source a — a healthy source — but the call site's
    // OTHER source (b) carries the unclosed `when:` marker. The intersection
    // test is against the call site's full source list (same rule as the
    // multi-spec IL-140 fixture above), so this call site is in scope even
    // though the malformed file itself isn't the touched one.
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.deepStrictEqual(result.composed, [], 'a call site that could not be measured must not appear in composed');
    assert.strictEqual(result.composedErrors.length, 1);
    assert.strictEqual(result.composedErrors[0].step, 'demo');
    assert.ok(typeof result.composedErrors[0].error === 'string' && result.composedErrors[0].error.length > 0);
    assert.strictEqual(result.ok, true, 'composedErrors is informational-but-visible — it never flips ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck surfaces a composed-bytes report that throws as a composedErrors row, never as a clean result (#1997)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    // A report that crashes (a bug, EACCES, anything that isn't the documented
    // no-corpus case) must not render as "nothing to report": that is the
    // silent-fallback shape IL-146 names. Injected via `deps.report` so the
    // failure is deterministic rather than platform-dependent.
    const result = headroomCheck(
      [{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }],
      repo,
      { report: () => { throw new Error('boom'); } },
    );
    assert.deepStrictEqual(result.composed, []);
    assert.strictEqual(result.composedErrors.length, 1, 'the crash must be visible as an unmeasured row');
    assert.strictEqual(result.composedErrors[0].step, null);
    assert.match(result.composedErrors[0].error, /report failed: boom/);
    assert.strictEqual(result.ok, true, 'composedErrors is informational-but-visible — it never flips ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck yields composed: [] and unchanged per-file results when the repo has no plugin/ dir', () => {
  const repo = makeTmpRepo();
  try {
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/build/plan-audit.md' }], repo);
    assert.deepStrictEqual(result, {
      ok: true, nearCeiling: [], breaches: [], composed: [], composedNearCeiling: [], composedErrors: [],
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check D — control-byte scan (#2000) ─────────────────────────────────

test('checkD flags a raw NUL mid-line with its line, column, and codePoint', () => {
  const text = 'line one\nsecond\0line\n';
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].line, 2);
  assert.strictEqual(result.findings[0].column, 7);
  assert.strictEqual(result.findings[0].codePoint, 'U+0000');
});

test('checkD flags a form feed and an escape byte as findings', () => {
  const text = 'a\x0Cb\x1Bc';
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.findings.map((f) => f.codePoint), ['U+000C', 'U+001B']);
});

test('checkD does not flag tab, LF, or CR', () => {
  const result = checkD('a\tb\nc\rd');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkD does not flag multi-byte UTF-8 text or a literal backslash-zero escape', () => {
  const result = checkD('café 中文 test("\\0")');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkD caps findings at 20 and sets truncated: true beyond that', () => {
  const text = '\0'.repeat(25);
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 20);
  assert.strictEqual(result.truncated, true);
});

// ── Check E (#3099) ──────────────────────────────────────────────────────────
const { checkE } = require('../../../plugin/bin/lib/plan-audit/checks');

const E_SPEC = [
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '',
].join('\n');

function ePlan(testStepLines, extraLines = []) {
  return [
    ...extraLines,
    '### Task 1: Build it',
    '',
    '- [ ] **Step 1: Write the failing test**',
    '',
    ...testStepLines,
    '',
    '- [ ] **Step 3: Write minimal implementation**',
    '',
    'Implementation notes.',
  ].join('\n');
}

test('AC1.1 (#3099): a plan citing AC2.1 and AC2.2 only reports AC2.3 uncovered, with its clause text', () => {
  const result = checkE(E_SPEC, ePlan(["test('AC1.1 AC2.1 AC2.2: rows render', () => {});"]));
  assert.deepStrictEqual(result.uncovered, [{ id: 'AC2.3', clause: 'the total equals the recipient count.' }]);
  assert.deepStrictEqual(result.covered.map((c) => c.id), ['AC1.1', 'AC2.1', 'AC2.2']);
  assert.deepStrictEqual(result.waived, []);
  assert.deepStrictEqual(result.unparsed, []);
});

test('AC2.1 (#3099): the same plan with a Waived AC2.3 line reports AC2.3 under waived, not uncovered', () => {
  const plan = ePlan(["test('AC1.1 AC2.1 AC2.2: rows render', () => {});"], ['Waived AC2.3: counted by the existing totals test', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.waived, [{ id: 'AC2.3', reason: 'counted by the existing totals test' }]);
  assert.deepStrictEqual(result.uncovered, []);
});

test('#3099: a waiver wins even when its line sits inside a test step', () => {
  const result = checkE(E_SPEC, ePlan(['AC1.1 AC2.1 AC2.2', 'Waived AC2.3: out of scope here']));
  assert.deepStrictEqual(result.waived, [{ id: 'AC2.3', reason: 'out of scope here' }]);
  assert.deepStrictEqual(result.uncovered, []);
});

test('#3099: a Waived line whose id matches no parsed clause is reported in orphanWaivers, never silently dropped (whole-branch review finding 3)', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2'], ['Waived AC2.3: counted elsewhere', 'Waived AC9.9: stale id from an old draft', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.waived, [{ id: 'AC2.3', reason: 'counted elsewhere' }]);
  assert.deepStrictEqual(result.orphanWaivers, [{ id: 'AC9.9', reason: 'stale id from an old draft' }]);
  assert.deepStrictEqual(result.uncovered, []);
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section yields a non-empty unparsed, not just an empty uncovered', () => {
  const result = checkE('# 1: X\n\n## Deliverables\n\n- Do it.\n', ePlan(['AC1.1']));
  assert.strictEqual(result.unparsed.length, 1);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered, []);
});

test('AC5.1 (#3099): Check E never sets ok: false — uncovered and unparsed entries both leave ok true', () => {
  assert.strictEqual(checkE(E_SPEC, ePlan(['nothing cited'])).ok, true);
  assert.strictEqual(checkE('no section', ePlan(['nothing cited'])).ok, true);
});

test('#3099: an id cited only outside a test step does not cover the clause', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2']).replace('Implementation notes.', 'Implementation covers AC2.3.');
  assert.deepStrictEqual(checkE(E_SPEC, plan).uncovered.map((u) => u.id), ['AC2.3']);
});

test('#3099: a bare item number (AC2) covers no clause, and AC2.10 does not cover AC2.1', () => {
  const result = checkE(E_SPEC, ePlan(['AC1.1 covers AC2 and AC2.10 only']));
  assert.deepStrictEqual(result.uncovered.map((u) => u.id), ['AC2.1', 'AC2.2', 'AC2.3']);
});

test('#3099: a coverage-map table row naming the id covers the clause', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2'], ['| Clause | Task |', '|---|---|', '| AC2.3 | Task 1 |', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered.find((c) => c.id === 'AC2.3'), { id: 'AC2.3', via: 'coverage-map' });
});

test('#3099: the clause text quoted in a test step covers it (backticks, case, spacing, end punctuation ignored)', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2', '// THE TOTAL   equals the recipient count']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered.find((c) => c.id === 'AC2.3'), { id: 'AC2.3', via: 'quoted-text' });
});

test('#3099: the clause text quoted in a coverage-map table row covers it via quoted-text', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2'], ['| Clause | Task |', '|---|---|', '| the total equals the recipient count | Task 1 |', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered.find((c) => c.id === 'AC2.3'), { id: 'AC2.3', via: 'quoted-text' });
});

test('#3099: a quoted clause under 3 words is never covered via the quoted-text fallback, even as a substring of a longer word (whole-branch review finding 1)', () => {
  const spec = '## Acceptance Criteria\n\n1. The process ends. Last.\n';
  const plan = ePlan(['AC1.1 only — the blast radius is contained']);
  const result = checkE(spec, plan);
  assert.deepStrictEqual(result.covered.map((c) => c.id), ['AC1.1']);
  assert.deepStrictEqual(result.uncovered.map((u) => u.id), ['AC1.2']);
});

test('#3099: an eligible (>=3-word) quoted clause only matches on a word boundary, never straddling a longer word at either end (whole-branch review finding 1)', () => {
  const spec = '## Acceptance Criteria\n\n1. Total rows render.\n';
  const plan = ePlan(['// Subtotal rows rendered correctly']);
  const result = checkE(spec, plan);
  assert.deepStrictEqual(result.uncovered.map((u) => u.id), ['AC1.1']);
});

test('#3099: an item the parser refuses is reported unparsed and never as covered or uncovered', () => {
  const spec = '## Acceptance Criteria\n\n- Fine one.\n- A `broken span here.\n';
  const result = checkE(spec, ePlan(['AC1.1 AC2.1']));
  assert.deepStrictEqual(result.unparsed, [{ item: 2, raw: 'A `broken span here.' }]);
  assert.deepStrictEqual(result.covered.map((c) => c.id), ['AC1.1']);
  assert.deepStrictEqual(result.uncovered, []);
});

const { checkF } = require('../../../plugin/bin/lib/plan-audit/checks');

const F_SPEC = ['## Technical Approach', '', 'Read `src/a.js` and `src/b.js` back; change them only if the model change breaks them.', ''].join('\n');

function fPlan(filesLines, extraLines = []) {
  return [...extraLines, '### Task 1: Build it', '', '**Files:**', ...filesLines, '', '- [ ] **Step 1: Write the failing test**', ''].join('\n');
}

test('AC1.1 (#3602): a plan listing neither Technical Approach path reports both unlisted, and ok stays true', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/other.js`']));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.unlisted, [
    { path: 'src/a.js', section: 'Technical Approach' },
    { path: 'src/b.js', section: 'Technical Approach' },
  ]);
});

test('AC1.2 (#3602): a task listing src/a.js plus a Waived src/b.js line reports neither', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/a.js`'], ['Waived src/b.js: read back by the existing reader test', '']));
  assert.deepStrictEqual(r.unlisted, []);
  assert.deepStrictEqual(r.listed, [{ path: 'src/a.js', via: 'exact' }]);
  assert.deepStrictEqual(r.waived, [{ path: 'src/b.js', reason: 'read back by the existing reader test' }]);
  assert.deepStrictEqual(r.orphanWaivers, []);
});

test('AC2.1 (#3602): a path named only in ## Acceptance Criteria or ## Deliverables is never reported', () => {
  const spec = ['## Deliverables', '', '1. Change `src/d.js`.', '', '## Acceptance Criteria', '', '1. `src/ac.js` works.', '', F_SPEC].join('\n');
  assert.deepStrictEqual(checkF(spec, fPlan(['- Modify: `src/a.js`', '- Modify: `src/b.js`'])).unlisted, []);
});

test('AC4.1 (#3602): an unreadable spec line passes through as unparsed, never as covered, and ok stays true', () => {
  const r = checkF('## Technical Approach\n\nRead `src/a.js and stop.\n', fPlan(['- Modify: `src/other.js`']));
  assert.deepStrictEqual(r.unparsed, [{ section: 'Technical Approach', raw: 'Read `src/a.js and stop.' }]);
  assert.deepStrictEqual(r.listed, []);
  assert.strictEqual(r.ok, true);
});

test('#3602: ./ prefixes and :NN line suffixes on either side still match exactly', () => {
  const r = checkF('## Gotchas\n\n- `./src/a.js:88`\n', fPlan(['- Modify: `./src/a.js:10-20`']));
  assert.deepStrictEqual(r.listed, [{ path: 'src/a.js', via: 'exact' }]);
  assert.deepStrictEqual(r.unlisted, []);
});

test('#3602: a plugin-relative citation matches a Files path on a whole-segment suffix, never mid-segment', () => {
  const r = checkF('## Technical Approach\n\nSee `_shared/x.md` and `lib/y.js`.\n',
    fPlan(['- Modify: `plugin/skills/_shared/x.md`', '- Modify: `plugin/bin/mylib/y.js`']));
  assert.deepStrictEqual(r.listed, [{ path: '_shared/x.md', via: 'suffix' }]);
  assert.deepStrictEqual(r.unlisted, [{ path: 'lib/y.js', section: 'Technical Approach' }]);
});

test('#3602: a path waiver naming no extracted path is an orphan; a Check E AC waiver is never a Check F waiver', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/a.js`'], ['Waived src/b.js: read back', 'Waived src/typo.js: stale', 'Waived AC1.1: a Check E waiver', '']));
  assert.deepStrictEqual(r.orphanWaivers, [{ path: 'src/typo.js', reason: 'stale' }]);
  assert.deepStrictEqual(r.waived, [{ path: 'src/b.js', reason: 'read back' }]);
});

test('#3602: a Key Files path the build only reads is still reported until a task names it or a waiver covers it', () => {
  const r = checkF('## Technical Approach\n\n### Key Files\n\n- `src/read-only.js` — read to confirm the shape\n', fPlan(['- Modify: `src/other.js`']));
  assert.deepStrictEqual(r.unlisted, [{ path: 'src/read-only.js', section: 'Technical Approach' }]);
});

test('#3602: a full-repo-path waiver covers a plugin-relative spec citation on a whole-segment suffix and is not an orphan', () => {
  const r = checkF('## Technical Approach\n\nSee `_shared/x.md`.\n',
    fPlan(['- Modify: `src/other.js`'], ['Waived plugin/skills/_shared/x.md: read back only', '']));
  assert.deepStrictEqual(r.waived, [{ path: '_shared/x.md', reason: 'read back only' }]);
  assert.deepStrictEqual(r.unlisted, []);
  assert.deepStrictEqual(r.orphanWaivers, []);
});

test('#3602: a waiver path that is a suffix OF the spec path does not match — direction matters: it is an orphan and the spec path stays unlisted', () => {
  const r = checkF('## Technical Approach\n\nSee `plugin/skills/_shared/x.md`.\n',
    fPlan(['- Modify: `src/other.js`'], ['Waived _shared/x.md: too short', '']));
  assert.deepStrictEqual(r.waived, []);
  assert.deepStrictEqual(r.unlisted, [{ path: 'plugin/skills/_shared/x.md', section: 'Technical Approach' }]);
  assert.deepStrictEqual(r.orphanWaivers, [{ path: '_shared/x.md', reason: 'too short' }]);
});

test('#3602: a CRLF plan yields exactly the LF result — Files: bullets and waivers are both read', () => {
  const lf = fPlan(['- Modify: `src/a.js`'], ['Waived src/b.js: read back', '']);
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(checkF(F_SPEC, crlf), checkF(F_SPEC, lf));
  assert.deepStrictEqual(checkF(F_SPEC, lf).listed, [{ path: 'src/a.js', via: 'exact' }]);
});

test('#3602: precedence — a path both listed and waived lands in waived, not listed; the first of two waivers for one path wins', () => {
  const r = checkF('## Technical Approach\n\nRead `src/a.js` and `src/b.js`.\n',
    fPlan(['- Modify: `src/a.js`'], ['Waived src/a.js: first reason', 'Waived plugin/src/a.js: second reason', 'Waived src/b.js: only', '']));
  assert.deepStrictEqual(r.waived, [
    { path: 'src/a.js', reason: 'first reason' },
    { path: 'src/b.js', reason: 'only' },
  ]);
  assert.deepStrictEqual(r.listed, []);
  assert.deepStrictEqual(r.orphanWaivers, []);
});
