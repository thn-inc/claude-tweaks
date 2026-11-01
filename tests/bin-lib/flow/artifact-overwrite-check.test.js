'use strict';
// tests/bin-lib/flow/artifact-overwrite-check.test.js — refs #2014
//
// Pins bin/lib/flow/artifact-overwrite-check.js's checkArtifactOverwrite:
// the multi-spec artifact-overwrite completion check (#786) extended to
// distinguish an append-only shared-journey edit from a real overwrite.
// Unit tests pin the small parsers directly; the synthetic-repo tests below
// build real git history (add-then-append, a same-spec self-correction, a
// shared "list reflow" edit, and a genuine cross-spec overwrite) and run the
// real algorithm against real `git log`/`git diff`/`git blame` output —
// proving the gate fires only on the overwrite shape, not merely that the
// parsers agree with themselves.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'artifact-overwrite-check.js');
const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'check-artifact-overwrite.js');
const {
  checkArtifactOverwrite,
  extractRefs,
  parseHunks,
  isListReflow,
  parseNameStatusLog,
  normalizeStepMarkup,
  isStepMarkupReformat,
  isStepRenumber,
  isReferencePreservingOriginLine,
  computeSpecWindows,
  attributeByWindow,
  ArtifactOverwriteCheckError,
} = require(MOD);
const { manifestInit, transitionSpec, readManifest } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'manifest.js'));

const FIXTURE_TIMEOUT_MS = 30000;

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artifact-overwrite-')));
  const git = (...a) => execFileSync('git', a, {
    cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  return { dir, git, base };
}

function write(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(fx, message) {
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', message);
  return fx.git('rev-parse', 'HEAD').trim();
}

const T0 = '2026-01-01T10:00:00.000Z'; // spec 10 first transition
const T1 = '2026-01-01T12:00:00.000Z'; // spec 11 first transition
function commitAt(fx, message, iso, committerIso = iso) {
  fx.git('add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: fx.dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: committerIso },
  });
  return fx.git('rev-parse', 'HEAD').trim();
}
// Real writer: manifestInit + transitionSpec with a pinned clock.
function manifestRun(transitions /* [[id, status, phase, iso], ...] */, ids = [10, 11]) {
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artifact-manifest-')));
  manifestInit({ runDir, specs: ids, parent: 'p/' });
  for (const [specId, status, phase, iso] of transitions) transitionSpec({ runDir, specId, status, phase, now: new Date(iso) });
  return { runDir, manifest: readManifest(runDir) };
}
const SEQUENTIAL = [[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'], [11, 'running', 'build', T1], [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z']];
// A parallel wave: both members move to running, then spec 10 keeps transitioning after spec 11 started.
const INTERLEAVED = [[10, 'running', 'build', T0], [11, 'running', 'build', T1], [10, 'running', 'test', '2026-01-01T12:30:00.000Z'], [10, 'complete', 'wrap-up', '2026-01-01T13:00:00.000Z'], [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z']];
const STORY = 'stories/x-10.yaml';
const STORY_V1 = 'name: x\nsteps:\n  locator: old-a\n  other: keep\n';
const STORY_V2 = 'name: x\nsteps:\n  locator: new-a\n  other: keep\n';

// --- Unit tests: the small parsers ---

test('extractRefs: matches a standalone "refs #N" trailer line', () => {
  const refs = extractRefs('Some subject\n\nBody text.\n\nrefs #2014');
  assert.deepStrictEqual([...refs], [2014]);
});

test('extractRefs: matches "refs #N" embedded inline in parens at end of subject (real repo shape)', () => {
  const refs = extractRefs('Fix manifesto.md mode markers (refs #1991)\n\nBody.');
  assert.deepStrictEqual([...refs], [1991]);
});

test('extractRefs: matches multiple comma-joined refs', () => {
  const refs = extractRefs('Consolidated close (refs #1988, #1989)');
  assert.deepStrictEqual([...refs].sort((a, b) => a - b), [1988, 1989]);
});

test('extractRefs: no trailer -> empty set', () => {
  assert.strictEqual(extractRefs('Just a subject, no trailer.').size, 0);
});

test('parseHunks + isListReflow: a list entry replaced by >= as many list entries is a reflow', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -56 +68,2 @@ files:',
    '-- Related specs: #1987, #1990.',
    '+- Step 6 added during build of #1989.',
    '+- Related specs: #1987, #1990, #1991.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(hunks.length, 1);
  assert.strictEqual(hunks[0].deletedLines.length, 1);
  assert.strictEqual(hunks[0].deletedLines[0].lineNo, 56);
  assert.ok(isListReflow(hunks[0]));
});

test('parseHunks + isListReflow: deleting a non-list content line is not a reflow', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -4 +4 @@',
    '-First content.',
    '+Something else entirely.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(hunks[0].deletedLines.length, 1);
  assert.strictEqual(isListReflow(hunks[0]), false);
});

test('parseHunks + isListReflow: a list shrinking (fewer entries added than removed) is not a reflow', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -10,2 +10 @@',
    '-- Entry A',
    '-- Entry B',
    '+- Entry A',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isListReflow(hunks[0]), false);
});

test('parseNameStatusLog: parses `git log -z --name-status` NUL output, non-ASCII paths included', () => {
  const sha1 = 'a'.repeat(40);
  const sha2 = 'b'.repeat(40);
  const out = `${sha1}\0\nA\0docs/journeys/café.md\0${sha2}\0\nM\0docs/journeys/café.md\0A\0stories/x.yaml\0`;
  assert.deepStrictEqual(parseNameStatusLog(out), [
    { commit: sha1, entries: [{ status: 'A', path: 'docs/journeys/café.md' }] },
    { commit: sha2, entries: [{ status: 'M', path: 'docs/journeys/café.md' }, { status: 'A', path: 'stories/x.yaml' }] },
  ]);
});

test('parseNameStatusLog: skips non-A/M statuses along with their path(s), two paths for R/C', () => {
  const sha = 'c'.repeat(40);
  const out = `${sha}\0\nR100\0old.md\0new.md\0C75\0src.md\0copy.md\0D\0gone.md\0M\0kept.md\0`;
  assert.deepStrictEqual(parseNameStatusLog(out), [
    { commit: sha, entries: [{ status: 'M', path: 'kept.md' }] },
  ]);
});

test('parseNameStatusLog: empty output yields no commits', () => {
  assert.deepStrictEqual(parseNameStatusLog(''), []);
});

test('a journey with a non-ASCII name is walked through real -z git output', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/café.md', '# Demo\n\n## Step 1\nFirst content.\n\n## Step 2\nSecond content.\n');
  commit(fx, 'Add café journey (refs #10)');
  write(fx.dir, 'docs/journeys/café.md', '# Demo\n\n## Step 1\nReplaced without attribution.\n\n## Step 2\nSecond content.\n');
  commit(fx, 'Clobber step 1 (refs #12)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites[0].path, 'docs/journeys/café.md');
});

test('normalizeStepMarkup: list-step and header-step forms normalize equal', () => {
  assert.strictEqual(
    normalizeStepMarkup('1. **Read the banner** — A session starts.'),
    normalizeStepMarkup('### 1. Read the banner — A session starts.'),
  );
  assert.strictEqual(
    normalizeStepMarkup('1. **Read the banner** — A session starts.'),
    normalizeStepMarkup('### 1. **Read the banner** — A session starts.'),
  );
  assert.strictEqual(
    normalizeStepMarkup('   - **Action:** Do it.'),
    normalizeStepMarkup('- **Action:** Do it.'),
  );
});

test('normalizeStepMarkup: a non-numbered heading is left as a heading', () => {
  assert.notStrictEqual(normalizeStepMarkup('### Origin'), normalizeStepMarkup('## Origin'));
});

test('parseHunks + isStepMarkupReformat: list steps converted to ### headers with flush sub-bullets is a reformat', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -3,9 +3,9 @@',
    '-1. **Read the banner** — A session starts.',
    '-   - **Action:** Do it.',
    '-   - **Should feel:** Calm.',
    '-   - **Red flags:** None.',
    '-',
    '-2. **Read the footer** — A session ends.',
    '-   - **Action:** Stop.',
    '-   - **Should feel:** Done.',
    '-   - **Red flags:** Some.',
    '+### 1. Read the banner — A session starts.',
    '+- **Action:** Do it.',
    '+- **Should feel:** Calm.',
    '+- **Red flags:** None.',
    '+',
    '+### 2. Read the footer — A session ends.',
    '+- **Action:** Stop.',
    '+- **Should feel:** Done.',
    '+- **Red flags:** Some.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(hunks.length, 1);
  assert.strictEqual(isStepMarkupReformat(hunks[0]), true);
});

test('isStepMarkupReformat: a conversion that also changes one word in a step body is not a reformat', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -3 +3 @@',
    '-1. **Read the banner** — A session starts.',
    '+### 1. Read the banner — A session ends.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepMarkupReformat(hunks[0]), false);
});

test('isStepMarkupReformat: a deletion-only hunk is not a reformat', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -3 +2,0 @@',
    '-1. **Read the banner** — A session starts.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepMarkupReformat(hunks[0]), false);
});

test('parseHunks + isStepMarkupReformat: a conversion that also deletes a `---` frontmatter delimiter is not a reformat', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -1,2 +1 @@',
    '----',
    '-1. **Read the banner** — A session starts.',
    '+### 1. Read the banner — A session starts.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.deepStrictEqual(hunks[0].deletedLines.map((d) => d.content), ['---', '1. **Read the banner** — A session starts.']);
  assert.strictEqual(isStepMarkupReformat(hunks[0]), false);
});

// --- Synthetic-repo tests: the real algorithm against real git history ---

test('add-then-append history (0 deletions) passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content.\n');
  commit(fx, 'Add demo journey step 1 (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content.\n\n## Step 2\nSecond content.\n');
  commit(fx, 'Add demo journey step 2 (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true);
  assert.deepStrictEqual(result.overwrites, []);
});

test('same-spec self-correction (deletes a line it added earlier) passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content.\n');
  commit(fx, 'Add demo journey step 1 (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content, fixed.\n');
  commit(fx, 'Fix step 1 typo (refs #10)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('shared bookkeeping list reflow (a different spec reformats a running list) passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '## Step 1',
    'First content.',
    '',
    '## Origin',
    '- Created during build of #10.',
    '- Related specs: #11, #12.',
    '',
  ].join('\n'));
  commit(fx, 'Add demo journey (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '## Step 1',
    'First content.',
    '',
    '## Step 2',
    'Second content.',
    '',
    '## Origin',
    '- Created during build of #10.',
    '- Step 2 added during build of #11.',
    '- Related specs: #12.',
    '',
  ].join('\n'));
  commit(fx, 'Add demo journey step 2 (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('cross-spec overwrite (a later spec deletes an earlier spec\'s own step content) still HARD-GATEs', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content.\n\n## Step 2\nSecond content.\n');
  commit(fx, 'Add demo journey steps 1-2 (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nReplaced without attribution.\n\n## Step 2\nSecond content.\n');
  commit(fx, 'Unrelated cleanup that happens to clobber step 1 (refs #12)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].path, 'docs/journeys/demo.md');
});

test('a path with no add-then-modify shape in range is ignored (modify-only, no add)', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\nOriginal.\n');
  execFileSync('git', ['-C', fx.dir, 'add', '-A']);
  execFileSync('git', ['-C', fx.dir, 'commit', '-q', '-m', 'pre-range add (not part of the walked range)']);
  const rangeBase = execFileSync('git', ['-C', fx.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\nChanged, but never added within range.\n');
  commit(fx, 'Modify only, refs #99');

  const result = checkArtifactOverwrite({ base: rangeBase, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true);
});

test('the top-level walk guards the interpolated {base}..{head} range with --end-of-options', () => {
  const calls = [];
  const fakeGit = (args) => {
    calls.push(args);
    return ''; // empty name-status log — clean, no A/M events
  };
  const result = checkArtifactOverwrite({ base: 'main', head: 'HEAD', git: fakeGit, cwd: '/fake' });
  assert.strictEqual(result.clean, true);
  assert.strictEqual(calls.length, 1);
  const rangeIdx = calls[0].indexOf('main..HEAD');
  assert.ok(rangeIdx > 0, 'range token should be present');
  assert.strictEqual(calls[0][rangeIdx - 1], '--end-of-options', 'the range token must be immediately preceded by --end-of-options');
});

test('a git-command failure (e.g. an unresolvable --base) throws ArtifactOverwriteCheckError, not a raw Error', () => {
  const fx = repo();
  assert.throws(
    () => checkArtifactOverwrite({ base: 'not-a-real-ref-anywhere', paths: ['docs/journeys/'], cwd: fx.dir }),
    ArtifactOverwriteCheckError,
  );
});

test('paths: [] falls back to the default scope (docs/journeys/, stories/) rather than matching every path', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', '# Demo\n\n## Step 1\nFirst content.\n');
  commit(fx, 'Add demo journey step 1 (refs #10)');
  // Outside the default scope, but deliberately carrying the full overwrite
  // shape (added under #11, then a *different* spec deletes its non-list
  // content): widening to "match every path" would report it, so this test
  // goes red the moment the empty-array guard is lost.
  write(fx.dir, 'src/unrelated.js', 'module.exports = 1;\n');
  commit(fx, 'Add unrelated source file (refs #11)');
  write(fx.dir, 'src/unrelated.js', 'module.exports = 2;\n');
  commit(fx, 'Rewrite unrelated source file (refs #12)');

  const withEmptyArray = checkArtifactOverwrite({ base: fx.base, paths: [], cwd: fx.dir });
  const withUnset = checkArtifactOverwrite({ base: fx.base, cwd: fx.dir });
  assert.deepStrictEqual(withEmptyArray, withUnset, 'an empty paths array must behave identically to paths being unset');
  assert.strictEqual(withEmptyArray.clean, true, 'the src/ overwrite is outside the default scope and must not be walked');
});

test('the real #1988-#1997 journey history in this repo passes with no manual ruling (AC1)', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  let head;
  try {
    head = execFileSync('git', ['-C', repoRoot, 'cat-file', '-t', 'b247a02d3'], { encoding: 'utf8' }).trim();
  } catch {
    head = null;
  }
  if (head !== 'commit') {
    // The specific historical commits this AC names are not reachable in
    // whatever checkout is running the suite (a shallow clone, or a fork
    // whose history was rewritten) — skip rather than fail on an
    // environment precondition this test doesn't control.
    return;
  }
  const result = checkArtifactOverwrite({
    base: '4c6e76733',
    head: 'b247a02d3',
    paths: ['docs/journeys/compose-a-per-run-context-bundle-1988.md'],
    cwd: repoRoot,
  });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

// Commit A: two list-form journey steps (the pre-#3341 shape of
// docs/journeys/*.md). Shared by the step-markup fixtures below.
const LIST_FORM_STEPS = [
  '# Demo',
  '',
  '1. **Read the banner** — A session starts.',
  '   - **Action:** Do it.',
  '   - **Should feel:** Calm.',
  '   - **Red flags:** None.',
  '',
  '2. **Read the footer** — A session ends.',
  '   - **Action:** Stop.',
  '   - **Should feel:** Done.',
  '   - **Red flags:** Some.',
  '',
].join('\n');

test('cross-spec step-markup conversion with zero content change passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', LIST_FORM_STEPS);
  commit(fx, 'Add demo journey steps (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '### 1. Read the banner — A session starts.',
    '- **Action:** Do it.',
    '- **Should feel:** Calm.',
    '- **Red flags:** None.',
    '',
    '### 2. Read the footer — A session ends.',
    '- **Action:** Stop.',
    '- **Should feel:** Done.',
    '- **Red flags:** Some.',
    '',
  ].join('\n'));
  commit(fx, 'Convert demo journey steps to canonical headers (refs #12)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('cross-spec step-markup conversion that also drops a step still HARD-GATEs (exit 1 naming the commit)', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', LIST_FORM_STEPS);
  commit(fx, 'Add demo journey steps (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '### 1. Read the banner — A session starts.',
    '- **Action:** Do it.',
    '- **Should feel:** Calm.',
    '- **Red flags:** None.',
    '',
  ].join('\n'));
  const commitB = commit(fx, 'Convert step 1 and drop step 2 (refs #12)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].commit, commitB);

  const spawned = spawnSync('node', [CLI, '--base', fx.base, '--path', 'docs/journeys/'], { cwd: fx.dir, encoding: 'utf8' });
  assert.strictEqual(spawned.status, 1, spawned.stderr);
  assert.strictEqual(JSON.parse(spawned.stdout).overwrites[0].commit, commitB);
});

test('the real #2702/#2727/#2776 journey reformat (d81250829..80e3dad2d) passes with no manual ruling', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  let head;
  try {
    head = execFileSync('git', ['-C', repoRoot, 'cat-file', '-t', '80e3dad2d'], { encoding: 'utf8' }).trim();
  } catch {
    head = null;
  }
  if (head !== 'commit') {
    // Same environment-precondition skip as the AC1 test above: the commit
    // is not reachable in this checkout, so there is nothing to replay.
    return;
  }
  const result = checkArtifactOverwrite({
    base: 'd81250829',
    head: '80e3dad2d',
    paths: ['docs/journeys/', 'stories/'],
    cwd: repoRoot,
  });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
  assert.deepStrictEqual(result.overwrites, []);
});

// Commit A for the step-renumber fixtures: two `### N.` heading-form steps.
const HEADING_STEPS = [
  '# Demo',
  '',
  '### 1. Read the banner — A session starts.',
  '- **Action:** Open it.',
  '',
  '### 2. Read the footer — A session ends.',
  '- **Action:** Close it.',
  '',
].join('\n');

test('AC1.1: inserting a step ahead of two existing ### N. steps (headings renumbered, text unchanged) passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', HEADING_STEPS);
  commit(fx, 'Add demo journey steps (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '### 1. Sign in — A session begins.',
    '- **Action:** Log in.',
    '',
    '### 2. Read the banner — A session starts.',
    '- **Action:** Open it.',
    '',
    '### 3. Read the footer — A session ends.',
    '- **Action:** Close it.',
    '',
  ].join('\n'));
  commit(fx, 'Insert a sign-in step ahead of the existing steps (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('AC2.1: a renumbered heading whose text also changes still reports an overwrite', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', HEADING_STEPS);
  commit(fx, 'Add demo journey steps (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', [
    '# Demo',
    '',
    '### 1. Sign in — A session begins.',
    '- **Action:** Log in.',
    '',
    '### 2. Read the banner — A session starts.',
    '- **Action:** Open it.',
    '',
    '### 3. Read the footer — A session closes.',
    '- **Action:** Close it.',
    '',
  ].join('\n'));
  const commitB = commit(fx, 'Insert a sign-in step and reword the footer step (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].commit, commitB);
});

test('parseHunks + isStepRenumber: a deleted ### N. heading re-added with a different number and the same text is a renumber', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5 +5 @@',
    '-### 3. X',
    '+### 4. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), true);
});

test('isStepRenumber: two deleted headings against one added heading is not a renumber (one added line serves one deletion)', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5,2 +5 @@',
    '-### 2. X',
    '-### 3. X',
    '+### 4. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), false);
});

test('isStepRenumber: a heading re-added as a list-form step is not a renumber (the added line must itself be a heading)', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5 +5 @@',
    '-### 3. X',
    '+4. **X**',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(normalizeStepMarkup(hunks[0].addedLines[0]), '4. X');
  assert.strictEqual(isStepRenumber(hunks[0]), false);
});

test('isStepRenumber: a deleted body line beside the renumbered heading is not a renumber', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5,2 +5 @@',
    '-### 3. X',
    '-Body line.',
    '+### 4. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), false);
});

test('isStepRenumber: a deletion-only hunk is not a renumber', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5 +4,0 @@',
    '-### 3. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), false);
});

test('isStepRenumber: identical heading text needs a real matching, not a first-fit pass (3→5 and 5→4, not 3→4)', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5,2 +5,2 @@',
    '-### 3. X',
    '-### 5. X',
    '+### 4. X',
    '+### 5. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), true);
});

test('the real #4488/#4484 journey step insertion (729a5ae5e..4706f21db) passes with no manual ruling', (t) => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  let head;
  try {
    head = execFileSync('git', ['-C', repoRoot, 'cat-file', '-t', '4706f21db'], { encoding: 'utf8' }).trim();
  } catch {
    head = null;
  }
  if (head !== 'commit') {
    // Same environment-precondition as the replay tests above, but reported as
    // a visible skip: the commit is not reachable in this checkout, so there
    // is nothing to replay, and a silent pass would read as a verified replay.
    t.skip('4706f21db not reachable in this checkout');
    return;
  }
  const result = checkArtifactOverwrite({
    base: '729a5ae5e',
    head: '4706f21db',
    paths: ['docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md'],
    cwd: repoRoot,
  });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

// Commit A for the Origin-line fixtures: one heading-form step and a closing
// `Origin:` line citing #10.
const ORIGIN_JOURNEY = [
  '# Demo',
  '',
  '### 1. Read the banner — A session starts.',
  '- **Action:** Open it.',
  '',
  'Origin: created during build of #10',
  '',
].join('\n');

function originJourneyWithStep2(originLine) {
  return [
    '# Demo',
    '',
    '### 1. Read the banner — A session starts.',
    '- **Action:** Open it.',
    '',
    '### 2. Read the footer — A session ends.',
    '- **Action:** Close it.',
    '',
    originLine,
    '',
  ].join('\n');
}

test('AC3.1: an Origin: line that gains a #N reference and keeps the existing one passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', ORIGIN_JOURNEY);
  commit(fx, 'Add demo journey (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md',
    originJourneyWithStep2('Origin: created during build of #10; step 2 added during build of #11'));
  commit(fx, 'Append a footer step and cite this build in the Origin line (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('AC3.2: an Origin: line rewrite that drops the existing #N reference reports an overwrite', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', ORIGIN_JOURNEY);
  commit(fx, 'Add demo journey (refs #10)');
  write(fx.dir, 'docs/journeys/demo.md', originJourneyWithStep2('Origin: step 2 added during build of #11'));
  const commitB = commit(fx, 'Append a footer step and replace the Origin line (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].commit, commitB);
});

test('parseHunks + isReferencePreservingOriginLine: a rewrite that keeps #10 and adds #11 is reference-preserving', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -6 +6 @@',
    '-Origin: built in #10',
    '+Origin: built in #10 and #11',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), true);
});

test('isReferencePreservingOriginLine: a deleted Origin: line with no added Origin: line is not reference-preserving', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -6 +6 @@',
    '-Origin: built in #10',
    '+Something else.',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: a deleted non-Origin line beside the Origin rewrite is not reference-preserving', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5,2 +5 @@',
    '-Body line.',
    '-Origin: built in #10',
    '+Origin: built in #10 and #11',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: a reference is matched as a whole number (#10 is not kept by #101)', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -6 +6 @@',
    '-Origin: built in #10',
    '+Origin: built in #101',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: two deleted Origin: lines need two added Origin: lines, paired in order', () => {
  const lessAdded = parseHunks([
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6,2 +6 @@',
    '-Origin: built in #10',
    '-Origin: extended in #11',
    '+Origin: built in #10, extended in #11',
  ].join('\n'));
  assert.strictEqual(isReferencePreservingOriginLine(lessAdded[0]), false);

  const swapped = parseHunks([
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6,2 +6,2 @@',
    '-Origin: built in #10',
    '-Origin: extended in #11',
    '+Origin: extended in #11',
    '+Origin: built in #10',
  ].join('\n'));
  assert.strictEqual(isReferencePreservingOriginLine(swapped[0]), false);
});

test('isReferencePreservingOriginLine: a deletion-only hunk is not reference-preserving', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6 +5,0 @@',
    '-Origin: built in #10',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

// The closing `_Origin: ..._` line below is copied verbatim from the real
// docs/journeys/reap-merged-worktrees-at-drain-end-3026.md (its pre-#3630 form):
// the inline italic shape later records extend in place.
const REAL_ITALIC_ORIGIN = "_Origin: record #3026 (reconcile's 18 s budget starved `reap` even under an explicit `--checks` subset), built 2026-10-19._";

test('AC3.1 (real italic shape): a later spec appending "Updated by record #11" to an _Origin:_ line while keeping #3026 passes clean', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', ['# Demo', '', REAL_ITALIC_ORIGIN, ''].join('\n'));
  commit(fx, 'Add demo journey (refs #3026)');
  const extended = REAL_ITALIC_ORIGIN.replace(/\._$/, '. Updated by record #11, built 2026-10-22: a footer step was added._');
  assert.notStrictEqual(extended, REAL_ITALIC_ORIGIN);
  write(fx.dir, 'docs/journeys/demo.md', ['# Demo', '', extended, ''].join('\n'));
  commit(fx, 'Cite this build in the italic Origin line (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('AC3.2 (real italic shape): an _Origin:_ line rewrite that drops #3026 reports an overwrite', () => {
  const fx = repo();
  write(fx.dir, 'docs/journeys/demo.md', ['# Demo', '', REAL_ITALIC_ORIGIN, ''].join('\n'));
  commit(fx, 'Add demo journey (refs #3026)');
  write(fx.dir, 'docs/journeys/demo.md', ['# Demo', '', '_Origin: record #11, built 2026-10-22._', ''].join('\n'));
  const commitB = commit(fx, 'Replace the italic Origin line (refs #11)');

  const result = checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].commit, commitB);
});

test('the real #3630 _Origin:_ line extension (cdf6627d9~1..c31b0e07c) passes with no manual ruling', (t) => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  let head;
  try {
    head = execFileSync('git', ['-C', repoRoot, 'cat-file', '-t', 'c31b0e07c'], { encoding: 'utf8' }).trim();
  } catch {
    head = null;
  }
  if (head !== 'commit') {
    // Same environment-precondition as the #4488/#4484 replay above: the commit
    // is not reachable in this checkout, so there is nothing to replay.
    t.skip('c31b0e07c not reachable in this checkout');
    return;
  }
  // The base is the parent of the commit that added the journey: the check
  // skips a file whose add commit falls outside the range.
  const result = checkArtifactOverwrite({
    base: 'cdf6627d9~1',
    head: 'c31b0e07c',
    paths: ['docs/journeys/reap-merged-worktrees-at-drain-end-3026.md'],
    cwd: repoRoot,
  });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('isReferencePreservingOriginLine: the bold **Origin:** form that keeps its reference and adds one is reference-preserving', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6 +6 @@',
    '-**Origin:** #3026',
    '+**Origin:** #3026, #3630',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), true);
});

test('isReferencePreservingOriginLine: an italic _Origin:_ rewrite that drops the reference is not reference-preserving', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6 +6 @@',
    '-_Origin: record #10, built 2026-10-19._',
    '+_Origin: record #11, built 2026-10-22._',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: a deleted Origin: line citing no #N is not reference-preserving (nothing to preserve)', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6 +6 @@',
    '-Origin: built here',
    '+Origin: something else',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: blank deleted lines beside the Origin rewrite are ignored', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6,2 +6 @@',
    '-_Origin: record #10_',
    '-',
    '+_Origin: record #10, #11_',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), true);
});

test('isReferencePreservingOriginLine: a hunk deleting only blank lines is not reference-preserving', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6 +5,0 @@',
    '-',
    '+Origin: built in #10',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: a deleted non-Origin line carrying a #N is not reference-preserving even when enough Origin lines are added back', () => {
  // Two Origin: lines are added back, so the added-count check passes and
  // every cited #N is kept; only the deleted-line `Origin:` check rejects the
  // deleted `Built earlier in #9.` line.
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -5,2 +5,2 @@',
    '-Built earlier in #9.',
    '-Origin: built in #10',
    '+Origin: built in #9, #10',
    '+Origin: built in #9, #10, #11',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isReferencePreservingOriginLine: deleted and added Origin: lines pair in order (the second pair drops #11)', () => {
  const diff = [
    '--- a/f.md',
    '+++ b/f.md',
    '@@ -6,2 +6,2 @@',
    '-Origin: built in #10',
    '-Origin: built in #11',
    '+Origin: built in #10, #11',
    '+Origin: other',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isReferencePreservingOriginLine(hunks[0]), false);
});

test('isStepRenumber: a blank deleted line beside the renumbered heading is ignored', () => {
  const diff = [
    '--- a/docs/journeys/demo.md',
    '+++ b/docs/journeys/demo.md',
    '@@ -5,2 +5 @@',
    '-### 3. X',
    '-',
    '+### 4. X',
  ].join('\n');
  const hunks = parseHunks(diff);
  assert.strictEqual(isStepRenumber(hunks[0]), true);
});

// --- Manifest-window attribution (refs #4593) ---

test('AC1.1, AC1.2, AC1.3: untrailered self-edit inside spec 10\'s window is clean with the manifest', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.deepStrictEqual(result, { clean: true, overwrites: [] });
});

test('window attribution reads the author date, not the committer date', () => {
  // The modifying commit is authored in spec 10's window but committed in spec
  // 11's: by author date both commits are spec 10 (clean); by committer date
  // the modify would be spec 11 (an overwrite).
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z', '2026-01-01T12:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.deepStrictEqual(result, { clean: true, overwrites: [] });
});

test('AC2.1, AC2.2: the modifying commit in spec 11\'s window is still one overwrite, reported as a spec mismatch', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); const modifySha = commitAt(fx, 'Review fix: locator', '2026-01-01T12:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].path, STORY);
  assert.strictEqual(result.overwrites[0].commit, modifySha);
  const { reason } = result.overwrites[0];
  assert.match(reason, /#10/);
  assert.match(reason, /#11/);
  assert.match(reason, /by manifest window/);
  assert.doesNotMatch(reason, /unattributable/);
});

test('AC3.1, AC3.2: the untrailered self-edit with no manifest reports an unattributable overwrite', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); const addSha = commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); const modifySha = commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  const { reason } = result.overwrites[0];
  assert.ok(reason.includes('unattributable — no refs trailer and no manifest window'), reason);
  assert.ok(!reason.includes('refs trailer does not match'), reason);
  assert.ok(reason.includes(`deleting commit ${modifySha} and blamed commit ${addSha}`), reason);
  assert.ok(reason.includes('(manifest windows off: no manifest)'), reason);
});

test('AC4.1: a refs #N trailer wins over a different spec\'s manifest window', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Fix locator (refs #10)', '2026-01-01T12:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, true, JSON.stringify(result.overwrites));
});

test('AC5.1: an author date before every spec\'s first transition leaves that commit unattributed', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); const addSha = commitAt(fx, 'Add story', '2026-01-01T09:00:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T10:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  const { reason } = result.overwrites[0];
  assert.ok(reason.includes(`blamed commit ${addSha}`), reason);
  assert.ok(reason.includes('unattributable'), reason);
  assert.ok(!reason.includes('deleting commit'), reason);
});

test('Q2/Q4: a manifest naming a failed spec keeps refs-only behavior for the AC1 history', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const { manifest } = manifestRun([[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'], [11, 'running', 'build', T1], [11, 'failed', 'wrap-up', '2026-01-01T14:00:00.000Z']]);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.ok(result.overwrites[0].reason.includes('(manifest windows off: spec #11 is failed)'), result.overwrites[0].reason);
});

test('Q6: an interleaved (parallel-wave) manifest keeps refs-only behavior for the AC1 history', () => {
  // Under INTERLEAVED windows both commits would fall in spec 10's [T0, T1)
  // window — a clean — if the interleave guard were absent.
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const { manifest } = manifestRun(INTERLEAVED);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.ok(result.overwrites[0].reason.includes('(manifest windows off: spec transitions interleave'), result.overwrites[0].reason);
});

test('Q10: a modifying commit authored in the same second as spec 11\'s first transition stays unattributed', () => {
  // The ordinary lookup would put 12:00:00.000 inside spec 10's window (spec 11
  // starts at 12:00:00.400) — a clean — so this goes red without the Q10 rule.
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T11:00:00Z');
  write(fx.dir, STORY, STORY_V2); const modifySha = commitAt(fx, 'Review fix: locator', '2026-01-01T12:00:00Z');
  const { manifest } = manifestRun([[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'], [11, 'running', 'build', '2026-01-01T12:00:00.400Z'], [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z']]);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  const { reason } = result.overwrites[0];
  assert.ok(reason.includes(`deleting commit ${modifySha}`), reason);
  assert.ok(reason.includes('unattributable'), reason);
});

test('Q8: a complete spec with no recorded transition turns windows off, never throws', () => {
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); commitAt(fx, 'Review fix: locator', '2026-01-01T11:30:00Z');
  const manifest = { multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status: 'complete' }] } };
  let result;
  assert.doesNotThrow(() => { result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest }); });
  assert.strictEqual(result.clean, false);
  assert.ok(result.overwrites[0].reason.includes('(manifest windows off: spec #11 has no recorded transition)'), result.overwrites[0].reason);
});

test('Q5: checkArtifactOverwrite throws ArtifactOverwriteCheckError on an unusable manifest before walking', () => {
  const stub = () => { throw new Error('git must not be called'); };
  const manifest = { multispec: { parent: 'p/', specs: [] } };
  assert.throws(
    () => checkArtifactOverwrite({ base: 'x', git: stub, manifest }),
    (e) => e instanceof ArtifactOverwriteCheckError && /manifest unusable: manifest names no specs/.test(e.message),
  );
});

test('computeSpecWindows: sequential specs tile [start, next start) with an open-ended last window', () => {
  const { windows, off } = computeSpecWindows(manifestRun(SEQUENTIAL).manifest);
  assert.strictEqual(off, null);
  assert.deepStrictEqual(windows, [
    { id: 10, start: Date.parse(T0), end: Date.parse(T1) },
    { id: 11, start: Date.parse(T1), end: Infinity },
  ]);
});

test('computeSpecWindows: phases[].at gives the first transition when startedAt is absent', () => {
  const manifest = { multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', phases: [{ phase: 'build', status: 'running', at: T1 }, { phase: 'test', status: 'running', at: T0 }] }] } };
  const { windows, off } = computeSpecWindows(manifest);
  assert.strictEqual(off, null);
  assert.deepStrictEqual(windows, [{ id: 10, start: Date.parse(T0), end: Infinity }]);
});

test('computeSpecWindows: off for a not-run, failed or pending spec, an interleaved run, and no manifest', () => {
  const notRun = computeSpecWindows(manifestRun([[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:00:00.000Z'], [11, 'not-run', 'build', T1]]).manifest);
  assert.deepStrictEqual(notRun, { windows: null, off: 'spec #11 is not-run' });
  const failed = computeSpecWindows(manifestRun([[10, 'running', 'build', T0], [10, 'complete', 'wrap-up', '2026-01-01T11:00:00.000Z'], [11, 'failed', 'build', T1]]).manifest);
  assert.deepStrictEqual(failed, { windows: null, off: 'spec #11 is failed' });
  const pending = computeSpecWindows(manifestRun([[10, 'running', 'build', T0]]).manifest);
  assert.deepStrictEqual(pending, { windows: null, off: 'spec #11 is pending' });
  const interleaved = computeSpecWindows(manifestRun(INTERLEAVED).manifest);
  assert.deepStrictEqual(interleaved, { windows: null, off: 'spec transitions interleave (spec #10 has a transition at or after spec #11\'s first transition)' });
  const equalStarts = computeSpecWindows({ multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status: 'complete', startedAt: T0 }] } });
  assert.strictEqual(equalStarts.windows, null);
  assert.ok(equalStarts.off.startsWith('spec transitions interleave'), equalStarts.off);
  assert.deepStrictEqual(computeSpecWindows(null), { windows: null, off: 'no manifest' });
});

test('computeSpecWindows (Q8): a spec with no recorded transition turns windows off for any status, never throws', () => {
  const expected = {
    complete: 'spec #11 has no recorded transition',
    running: 'spec #11 has no recorded transition',
    'not-run': 'spec #11 is not-run',
    'wrap-up-done (hand-written)': 'spec #11 is wrap-up-done (hand-written)',
  };
  for (const [status, off] of Object.entries(expected)) {
    const manifest = { multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: T0 }, { id: 11, status, phases: [] }] } };
    let result;
    assert.doesNotThrow(() => { result = computeSpecWindows(manifest); }, status);
    assert.deepStrictEqual(result, { windows: null, off }, status);
  }
  const noAt = { multispec: { parent: 'p/', specs: [{ id: 11, status: 'complete', phases: [{ phase: 'build', status: 'running' }] }] } };
  let result;
  assert.doesNotThrow(() => { result = computeSpecWindows(noAt); });
  assert.deepStrictEqual(result, { windows: null, off: 'spec #11 has no recorded transition' });
});

test('computeSpecWindows: throws manifest unusable for no specs, a bad startedAt, and a bad phases[].at', () => {
  // Each fixture differs from a valid one in exactly that one field, so each
  // assertion isolates its own guard.
  const unusable = (re) => (e) => e instanceof ArtifactOverwriteCheckError && re.test(e.message);
  assert.throws(
    () => computeSpecWindows({ multispec: { parent: 'p/', specs: [] } }),
    unusable(/manifest unusable: manifest names no specs/),
  );
  assert.throws(
    () => computeSpecWindows({ multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: 'not-a-date' }] } }),
    unusable(/manifest unusable: spec #10 startedAt is not a valid date \(not-a-date\)/),
  );
  assert.throws(
    () => computeSpecWindows({ multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: T0, phases: [{ phase: 'build', status: 'running', at: 'garbage' }] }] } }),
    unusable(/manifest unusable: spec #10 phases\[0\]\.at is not a valid date \(garbage\)/),
  );
  // Guard order: validation precedes the status off check.
  assert.throws(
    () => computeSpecWindows({ multispec: { parent: 'p/', specs: [{ id: 10, status: 'not-run', startedAt: 'not-a-date' }] } }),
    unusable(/manifest unusable: spec #10 startedAt is not a valid date \(not-a-date\)/),
  );
});

test('attributeByWindow: start is inclusive, the next start exclusive; no match and two matches are both unattributed', () => {
  // Whole-second values: a later window's own start second falls under the Q10
  // rule (pinned separately below), so 200000 is unattributed here.
  const windows = [{ id: 10, start: 100000, end: 200000 }, { id: 11, start: 200000, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(windows, 100000)], [10]);
  assert.deepStrictEqual([...attributeByWindow(windows, 199999)], [10]);
  assert.deepStrictEqual([...attributeByWindow(windows, 201000)], [11]);
  assert.deepStrictEqual([...attributeByWindow(windows, 200000)], []);
  assert.deepStrictEqual([...attributeByWindow(windows, 99999)], []);
  assert.deepStrictEqual([...attributeByWindow(windows, NaN)], []);
  assert.deepStrictEqual([...attributeByWindow(null, 150)], []);
  // Whole seconds, so the 2+ matches rule (not the Q10 rule) decides this.
  const tied = [{ id: 10, start: 100000, end: Infinity }, { id: 11, start: 100000, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(tied, 150000)], []);
});

test('attributeByWindow (Q10): a commit second equal to a later window start\'s whole second is unattributed', () => {
  const windows = [{ id: 10, start: 1000, end: 5400 }, { id: 11, start: 5400, end: Infinity }];
  assert.deepStrictEqual([...attributeByWindow(windows, 5000)], []); // 5.000 s: ordinary lookup says #10
  assert.deepStrictEqual([...attributeByWindow(windows, 4000)], [10]); // previous second: unaffected
  assert.deepStrictEqual([...attributeByWindow(windows, 6000)], [11]); // next second: unaffected
  assert.deepStrictEqual([...attributeByWindow(windows, 1000)], [10]); // earliest window's own start second: no Q10 rule
});

test('AC4.1 (disagreeing direction): a refs #11 trailer wins over spec 10\'s window, so deleting spec 10\'s line is an overwrite', () => {
  // Both commits are authored in spec 10's window. If the trailer were unioned
  // with the window (#11 ∪ #10) the modify would intersect the add's #10 — a
  // false clean on a HARD-GATE.
  const fx = repo();
  write(fx.dir, STORY, STORY_V1); const addSha = commitAt(fx, 'Add story', '2026-01-01T10:30:00Z');
  write(fx.dir, STORY, STORY_V2); const modifySha = commitAt(fx, 'Fix locator (refs #11)', '2026-01-01T11:30:00Z');
  const { manifest } = manifestRun(SEQUENTIAL);
  const result = checkArtifactOverwrite({ base: fx.base, paths: ['stories/'], cwd: fx.dir, manifest });
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.overwrites.length, 1);
  assert.strictEqual(result.overwrites[0].commit, modifySha);
  const { reason } = result.overwrites[0];
  assert.ok(reason.includes(`traces to commit ${addSha}, attributed to #10 (by manifest window)`), reason);
  assert.ok(reason.includes(`${modifySha}'s own #11 (by refs trailer)`), reason);
});

test('computeSpecWindows: windows are sorted by first transition, not by manifest order', () => {
  const manifest = { multispec: { parent: 'p/', specs: [{ id: 11, status: 'complete', startedAt: T1 }, { id: 10, status: 'complete', startedAt: T0 }] } };
  const { windows, off } = computeSpecWindows(manifest);
  assert.strictEqual(off, null);
  assert.deepStrictEqual(windows, [
    { id: 10, start: Date.parse(T0), end: Date.parse(T1) },
    { id: 11, start: Date.parse(T1), end: Infinity },
  ]);
});

test('computeSpecWindows: an empty-string startedAt is absent data, so phases[].at gives the first transition', () => {
  const manifest = { multispec: { parent: 'p/', specs: [{ id: 10, status: 'complete', startedAt: '', phases: [{ phase: 'build', status: 'running', at: T0 }] }] } };
  let result;
  assert.doesNotThrow(() => { result = computeSpecWindows(manifest); });
  assert.deepStrictEqual(result, { windows: [{ id: 10, start: Date.parse(T0), end: Infinity }], off: null });
});
