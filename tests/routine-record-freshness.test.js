'use strict';

// Fixtures here are real git repositories, not mocks. The defect under test
// (#190) is entirely about what git reports for a checkout that is behind its
// branch of record, so a stubbed git would only prove the stub agrees with the
// code that calls it `[IL-62]`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  readRoutineRecordsAtRef,
  compareRoutineRecords,
  freshnessNote,
  kernelFreshness,
  SIGNIFICANT_FIELDS,
} = require('../plugin/bin/lib/routine-template-parser.js');

const RECORD_DIR = '.claude-tweaks/routines';

// Hermetic: the developer's own global/system git config, hooks, and commit
// signing must not reach these repos or the suite passes or fails by accident
// of whoever ran it.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRecord(root, filename, fields) {
  const dir = path.join(root, RECORD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`)
    .join('\n');
  fs.writeFileSync(path.join(dir, filename), `${body}\n`);
}

// Built once, then copied per test. Every git invocation costs a process spawn,
// and rebuilding this fixture inside each test made the suite take ~175s alone.
let FIXTURE;
let CASE_SEQ = 0;

// Builds the exact shape #190 describes: a checkout one commit behind the branch
// where records are committed, holding an older copy of one record and unaware of
// another that exists only upstream.
function buildFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-freshness-'));
  const remote = path.join(tmp, 'remote.git');
  const authoring = path.join(tmp, 'pristine-authoring');
  const stale = path.join(tmp, 'pristine-stale');

  git(tmp, 'init', '--bare', '--initial-branch=main', remote);
  git(tmp, 'clone', '--quiet', remote, authoring);

  writeRecord(authoring, 'proj-code-health-daily.yml', {
    routine_id: 'trig_aaa',
    template: 'code-health',
    template_version: 2,
    created_at: '2026-01-01T00:00:00Z',
    schedule: '0 3 * * *',
  });
  git(authoring, 'add', '-A');
  git(authoring, 'commit', '-q', '-m', 'Add code-health record at template v2');
  git(authoring, 'push', '-q', 'origin', 'main');

  // The stale checkout is cloned here — before the upstream commit below — so it
  // is behind by construction rather than by rewinding history.
  git(tmp, 'clone', '--quiet', remote, stale);

  writeRecord(authoring, 'proj-code-health-daily.yml', {
    routine_id: 'trig_aaa',
    template: 'code-health',
    template_version: 4,
    created_at: '2026-02-01T00:00:00Z',
    schedule: '0 3 * * *',
    branch: 'dev',
  });
  writeRecord(authoring, 'proj-tidy-weekly.yml', {
    routine_id: 'trig_bbb',
    template: 'tidy',
    template_version: 1,
    created_at: '2026-02-01T00:00:00Z',
    schedule: '0 4 * * 1',
    branch: 'dev',
  });
  git(authoring, 'add', '-A');
  git(authoring, 'commit', '-q', '-m', 'Bump code-health to v4, add tidy record');
  git(authoring, 'push', '-q', 'origin', 'main');

  return { tmp, remote, authoring, stale };
}

// A fresh empty directory for one test's own filesystem state. Numbered under
// the shared fixture root so `after()`'s single rmSync collects every one.
function caseDir() {
  const dir = path.join(FIXTURE.tmp, `case-${CASE_SEQ++}`);
  fs.mkdirSync(dir);
  return dir;
}

// Copies the pristine fixture so each test gets an independent, mutable pair of
// checkouts. `remote.git` stays put and both clones reference it by absolute
// path, so a filesystem copy of a clone remains a working repo.
function useFixture() {
  const dir = caseDir();
  const stale = path.join(dir, 'stale');
  const authoring = path.join(dir, 'authoring');
  fs.cpSync(FIXTURE.stale, stale, { recursive: true });
  fs.cpSync(FIXTURE.authoring, authoring, { recursive: true });
  return { remote: FIXTURE.remote, stale, authoring };
}

before(() => {
  FIXTURE = buildFixture();
});

after(() => {
  if (FIXTURE) fs.rmSync(FIXTURE.tmp, { recursive: true, force: true });
});

test('readRoutineRecordsAtRef reads records from a ref without touching the working tree', () => {
  const { stale } = useFixture();
  git(stale, 'fetch', '--quiet', 'origin', 'main');
  const upstream = readRoutineRecordsAtRef({ cwd: stale, ref: 'origin/main' });
  assert.equal(upstream.length, 2);
  assert.deepEqual(upstream.map((r) => r.filename), [
    'proj-code-health-daily.yml',
    'proj-tidy-weekly.yml',
  ]);
  assert.equal(upstream[0].template_version, 4);
  assert.equal(upstream[0].branch, 'dev');

  // The working tree is untouched and still holds the old copy.
  const localText = fs.readFileSync(path.join(stale, RECORD_DIR, 'proj-code-health-daily.yml'), 'utf8');
  assert.match(localText, /template_version: 2/);
  assert.equal(fs.existsSync(path.join(stale, RECORD_DIR, 'proj-tidy-weekly.yml')), false);
});

test('readRoutineRecordsAtRef returns null for a ref that does not resolve', () => {
  const { stale } = useFixture();
  assert.equal(readRoutineRecordsAtRef({ cwd: stale, ref: 'origin/no-such-branch' }), null);
  assert.equal(readRoutineRecordsAtRef({ cwd: stale, ref: '' }), null);
});

test('a stale checkout reports the upstream record set, including one it cannot see locally', () => {
  const { stale } = useFixture();
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });

  assert.equal(r.verified, true, 'comparison should be verified against a reachable remote');
  assert.equal(r.reason, null);
  assert.equal(r.ref, 'origin/main');
  assert.equal(r.behind, 1, 'the fixture checkout is exactly one commit behind');

  // The union is the whole point: a working-tree-only read sees one record.
  assert.equal(r.local.length, 1);
  assert.equal(r.upstream.length, 2);
  assert.equal(r.records.length, 2);

  // This is the record CREATE Step 3's idempotency check would have missed,
  // minting a duplicate live routine with no delete action to undo it.
  assert.deepEqual(r.onlyUpstream, ['proj-tidy-weekly.yml']);
  assert.deepEqual(r.onlyLocal, []);

  assert.equal(r.differing.length, 1);
  const drift = r.differing[0];
  assert.equal(drift.filename, 'proj-code-health-daily.yml');
  assert.deepEqual(drift.fields.slice().sort(), ['branch', 'template_version']);
  assert.equal(drift.local.template_version, 2);
  assert.equal(drift.upstream.template_version, 4);
  assert.equal(drift.authority, 'upstream', 'a behind checkout defers to the branch of record');
});

test('an up-to-date checkout reports no divergence and defers to the local copy', () => {
  const { stale } = useFixture();
  git(stale, 'pull', '-q', 'origin', 'main');
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });
  assert.equal(r.verified, true);
  assert.equal(r.behind, 0);
  assert.deepEqual(r.onlyUpstream, []);
  assert.deepEqual(r.differing, []);
  assert.equal(r.records.every((rec) => rec.authority === 'local'), true);
});

test('an uncommitted local edit keeps the working copy authoritative even when behind', () => {
  const { stale } = useFixture();
  writeRecord(stale, 'proj-code-health-daily.yml', {
    routine_id: 'trig_aaa',
    template: 'code-health',
    template_version: 2,
    created_at: '2026-01-01T00:00:00Z',
    schedule: '30 5 * * *',
  });
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });
  const rec = r.records.find((x) => x.filename === 'proj-code-health-daily.yml');
  assert.equal(rec.uncommitted, true);
  assert.equal(rec.authority, 'local', 'a deliberate in-progress edit must not be overridden by freshness');
  // The upstream-only record is unaffected by the local edit.
  assert.deepEqual(r.onlyUpstream, ['proj-tidy-weekly.yml']);
});

test('AC1.1: an uncommitted edit to a non-ASCII record name counts as dirty', () => {
  // A dedicated remote (the shared one is read by every other test). The record
  // must exist on BOTH sides, behind upstream, so authority falls to the dirty
  // check alone: local-only would be 'local' regardless and prove nothing.
  const dir = caseDir();
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', '--quiet', remote, repo);
  // Explicit, so a global core.quotepath=false cannot make this pass vacuously.
  git(repo, 'config', 'core.quotepath', 'true');

  const base = { routine_id: 'trig_ddd', template: 'code-health', template_version: 1, created_at: '2026-03-01T00:00:00Z' };
  writeRecord(repo, 'café.yml', { ...base, schedule: '0 6 * * *' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Add café record');
  git(repo, 'push', '-q', 'origin', 'main');
  writeRecord(repo, 'café.yml', { ...base, schedule: '0 7 * * *' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Move café record schedule');
  git(repo, 'push', '-q', 'origin', 'main');
  // Behind by one commit, with origin/main still pointing at the newer one.
  git(repo, 'reset', '-q', '--hard', 'HEAD~1');

  // The premise the fixture rests on: git really does C-quote this name.
  assert.match(git(repo, 'ls-files', '--', RECORD_DIR), /caf\\303\\251\.yml/);

  writeRecord(repo, 'café.yml', { ...base, schedule: '30 5 * * *' });
  const r = compareRoutineRecords({ cwd: repo, branch: 'main' });
  assert.equal(r.verified, true);
  assert.equal(r.behind, 1);
  const rec = r.records.find((x) => x.filename === 'café.yml');
  assert.ok(rec, 'the non-ASCII record is in the union');
  assert.equal(rec.uncommitted, true);
  assert.equal(rec.authority, 'local', 'the working copy wins over a behind checkout, as for an ASCII name');
});

test('a renamed record counts its destination as dirty, never the rename source (origPath)', () => {
  const dir = caseDir();
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', '--quiet', remote, repo);
  git(repo, 'config', 'core.quotepath', 'true');
  const base = { routine_id: 'trig_eee', template: 'code-health', template_version: 1, created_at: '2026-03-01T00:00:00Z', schedule: '0 6 * * *' };
  // The rename source lives in a subdirectory and shares its basename with a
  // committed-clean top-level record: the dirty set is keyed by basename, so
  // counting the porcelain `origPath` would flag `same-name.yml` uncommitted.
  fs.mkdirSync(path.join(repo, RECORD_DIR, 'sub'), { recursive: true });
  writeRecord(repo, 'same-name.yml', base);
  writeRecord(repo, path.join('sub', 'same-name.yml'), { ...base, routine_id: 'trig_fff' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Add records');
  git(repo, 'push', '-q', 'origin', 'main');
  // Staged rename: porcelain -z emits "R  new\0old\0".
  git(repo, 'mv', path.join(RECORD_DIR, 'sub', 'same-name.yml'), path.join(RECORD_DIR, 'new-name.yml'));
  assert.match(git(repo, 'status', '--porcelain'), /^R /, 'fixture precondition: git reports a rename');
  const r = compareRoutineRecords({ cwd: repo, branch: 'main' });
  const byName = Object.fromEntries(r.records.map((x) => [x.filename, x]));
  assert.equal(byName['new-name.yml'].uncommitted, true, 'the rename destination is the dirty one');
  assert.equal(byName['same-name.yml'].uncommitted, false, 'the rename source (origPath) is not what is dirty');
});

test('a model-only difference between local and upstream is reported as a significant field', () => {
  // A dedicated remote, not the shared FIXTURE one: the shared bare repo is
  // read by every other test in this file via `origin/main`, and pushing a
  // `model` field onto it here would leak into their comparisons too.
  const dir = caseDir();
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', '--quiet', remote, repo);

  const baseFields = {
    routine_id: 'trig_ccc',
    template: 'code-health',
    template_version: 1,
    created_at: '2026-03-01T00:00:00Z',
    schedule: '0 6 * * *',
  };
  writeRecord(repo, 'proj-code-health-nightly.yml', { ...baseFields, model: 'claude-sonnet-5' });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Add code-health record with model');
  git(repo, 'push', '-q', 'origin', 'main');

  // Overwrite the working copy only, uncommitted: same significant fields,
  // `model` alone diverges from what was just pushed.
  writeRecord(repo, 'proj-code-health-nightly.yml', { ...baseFields, model: 'claude-opus-5' });

  const r = compareRoutineRecords({ cwd: repo, branch: 'main' });
  assert.equal(r.verified, true);
  const drift = r.differing.find((d) => d.filename === 'proj-code-health-nightly.yml');
  assert.ok(drift, 'a model-only edit must be reported as a divergent record');
  assert.deepEqual(drift.fields, ['model']);
  assert.equal(drift.local.model, 'claude-opus-5');
  assert.equal(drift.upstream.model, 'claude-sonnet-5');
});

test('a model field present locally but absent upstream counts as a significant difference (create/update transition)', () => {
  const { stale } = useFixture();
  // Matches origin/main's second commit on every other significant field
  // (template_version: 4, schedule unchanged, branch: 'dev') so `model` is
  // isolated as the only source of divergence. Upstream's committed copy has
  // no `model` key at all — it predates Task 1's rename — which is exactly
  // the create/update transition this test demonstrates: presence vs.
  // absence must count as changed, not compare equal, and must not throw.
  writeRecord(stale, 'proj-code-health-daily.yml', {
    routine_id: 'trig_aaa',
    template: 'code-health',
    template_version: 4,
    created_at: '2026-02-01T00:00:00Z',
    schedule: '0 3 * * *',
    branch: 'dev',
    model: 'claude-sonnet-5',
  });
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });
  assert.equal(r.verified, true);
  const drift = r.differing.find((d) => d.filename === 'proj-code-health-daily.yml');
  assert.ok(drift, 'presence vs. absence of model must be reported as a divergent record, not silently equal');
  assert.deepEqual(drift.fields, ['model']);
  assert.equal(drift.local.model, 'claude-sonnet-5');
  assert.equal(drift.upstream.model, undefined, "upstream's fixture record predates the model field entirely");
});

test('created_at alone is not divergence', () => {
  const { authoring } = useFixture();
  // Same significant fields as upstream, different timestamp only.
  writeRecord(authoring, 'proj-tidy-weekly.yml', {
    routine_id: 'trig_bbb',
    template: 'tidy',
    template_version: 1,
    created_at: '2026-09-09T09:09:09Z',
    schedule: '0 4 * * 1',
    branch: 'dev',
  });
  const r = compareRoutineRecords({ cwd: authoring, branch: 'main' });
  assert.equal(r.verified, true);
  assert.deepEqual(
    r.differing.map((d) => d.filename),
    [],
    'UPDATE Step 7 rewrites created_at on every run — counting it would make every record differ'
  );
});

test('fails open with no remote: unverified, local records still returned, no throw', () => {
  const { stale } = useFixture();
  git(stale, 'remote', 'remove', 'origin');
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'no-remote');
  assert.equal(r.local.length, 1, 'the working-tree read must still happen');
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].presence, 'local-only');
  assert.match(freshnessNote(r), /no `origin` remote/);
});

test('fails open when the remote is unreachable (the offline case)', () => {
  const { stale } = useFixture();
  git(stale, 'remote', 'set-url', 'origin', path.join(FIXTURE.tmp, 'definitely-not-here.git'));
  const r = compareRoutineRecords({ cwd: stale, branch: 'main' });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'fetch-failed');
  assert.equal(r.local.length, 1);
  assert.match(freshnessNote(r), /offline, unreachable, or no such branch/);
});

test('fails open when no integration branch resolved', () => {
  const { stale } = useFixture();
  const r = compareRoutineRecords({ cwd: stale, branch: undefined });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'branch-unresolved');
  assert.equal(r.ref, null);
  assert.match(freshnessNote(r), /no integration branch resolved/);
});

test('freshnessNote is null exactly when the comparison was verified', () => {
  const { stale } = useFixture();
  assert.equal(freshnessNote(compareRoutineRecords({ cwd: stale, branch: 'main' })), null);
});

test('a project with no records directory at all is handled, not thrown on', () => {
  const dir = caseDir();
  git(dir, 'init', '--quiet', '--initial-branch=main', dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# empty\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  const r = compareRoutineRecords({ cwd: dir, branch: 'main' });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'no-remote');
  assert.deepEqual(r.local, []);
  assert.deepEqual(r.records, []);
});

// --- Kernel freshness (#529) -------------------------------------------------

test('kernelFreshness: missing kernel_version is kernel-stale', () => {
  assert.equal(kernelFreshness(undefined, 1), 'kernel-stale');
  assert.equal(kernelFreshness(null, 1), 'kernel-stale');
  assert.equal(kernelFreshness(null, 0), 'kernel-stale');
});
test('kernelFreshness: behind the schema literal is kernel-stale', () => {
  assert.equal(kernelFreshness(1, 2), 'kernel-stale');
});
test('kernelFreshness: equal or ahead is fresh', () => {
  assert.equal(kernelFreshness(2, 2), 'fresh');
  assert.equal(kernelFreshness(3, 2), 'fresh');
});
test('kernel_version is a significant field for record comparison', () => {
  assert.ok(SIGNIFICANT_FIELDS.includes('kernel_version'));
});
