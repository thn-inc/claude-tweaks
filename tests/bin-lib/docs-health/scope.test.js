const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { listDocs, extractDomainPaths, domainChurn, selectTarget } = require('../../../plugin/bin/lib/docs-health/scope');
const { listTargets } = require('../../../plugin/bin/lib/harness-health/scope');
const { listJourneys } = require('../../../plugin/bin/lib/journey-health/scope');
const { STALE_DAYS } = require('../../../plugin/bin/lib/docs-health/score');
const { cleanGitEnv, initRepo, writeIdentity } = require('../../helpers/git-fixtures');

function tmp() { return scratchDir('docs-health-scope-'); }

function initGitRepo(root) {
  initRepo(root, { name: 'Test', email: 'test@test.com' });
}

function commit(root, msg) {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', msg]);
}

// ── listDocs ────────────────────────────────────────────────────────────

test('listDocs returns [] when docs/ does not exist', () => {
  const root = tmp();
  assert.deepStrictEqual(listDocs(root), []);
});

test('listDocs recursively lists .md files under docs/, sorted by id, tagged kind: doc', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0007-foo.md'), '# foo');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');
  const docs = listDocs(root);
  assert.deepStrictEqual(docs.map((d) => d.id), ['decisions/0007-foo', 'guides/setup']);
  assert.strictEqual(docs[0].kind, 'doc');
  assert.strictEqual(docs[0].path, path.join(root, 'docs', 'decisions', '0007-foo.md'));
});

test('listDocs ignores non-.md files', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'notes.txt'), 'ignore me');
  fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# readme');
  assert.deepStrictEqual(listDocs(root).map((d) => d.id), ['readme']);
});

test('listDocs excludes docs/superpowers/** entirely', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'superpowers', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'superpowers', 'specs', '2026-01-01-foo-design.md'), '# design doc');
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0001-bar.md'), '# bar');
  assert.deepStrictEqual(listDocs(root).map((d) => d.id), ['decisions/0001-bar']);
});

// The archive exclusion must match the FULL path docs/superpowers, never a
// name substring: docs/plans/ (live ephemeral pipeline state) and
// docs/superpowers/plans/ (the historical archive, docs/decisions/0007-*) are
// near-identically named and have been confused before in this repo.
test('listDocs excludes both archive subdirs but keeps the near-identically-named docs/plans/', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'superpowers', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'superpowers', 'plans', '2026-07-20-fix-review-findings.md'), '# archived plan');
  fs.writeFileSync(path.join(root, 'docs', 'superpowers', 'specs', '2026-01-01-foo-design.md'), '# archived design doc');
  fs.writeFileSync(path.join(root, 'docs', 'plans', '2026-07-08-worktree-brief.md'), '# live pipeline state');
  fs.writeFileSync(path.join(root, 'docs', 'specs', 'api.md'), '# live spec');

  assert.deepStrictEqual(
    listDocs(root).map((d) => d.id),
    ['plans/2026-07-08-worktree-brief', 'specs/api'],
    'only docs/superpowers/** is excluded — top-level docs/plans/ and docs/specs/ stay in scope',
  );
});

test('listDocs never overlaps with harness-health\'s own target list', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth skill');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '# api errors rule');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# project');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');

  const docsHealthPaths = new Set(listDocs(root).map((d) => d.path));
  const harnessHealthPaths = new Set(listTargets(root).map((t) => t.path));
  const overlap = [...docsHealthPaths].filter((p) => harnessHealthPaths.has(p));
  assert.deepStrictEqual(overlap, [], 'docs-health and harness-health target lists must never overlap');
});

test('listDocs excludes docs/journeys/** entirely', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'journeys'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'journeys', 'signup-flow.md'), '# journey');
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0001-bar.md'), '# bar');
  assert.deepStrictEqual(listDocs(root).map((d) => d.id), ['decisions/0001-bar']);
});

test('listDocs never overlaps with journey-health\'s own target list', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'journeys'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'journeys', 'signup-flow.md'), '# journey');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');

  const docsHealthPaths = new Set(listDocs(root).map((d) => d.path));
  const journeyHealthPaths = new Set(listJourneys(root).map((t) => t.path));
  const overlap = [...docsHealthPaths].filter((p) => journeyHealthPaths.has(p));
  assert.deepStrictEqual(overlap, [], 'docs-health and journey-health target lists must never overlap');
});

// ── extractDomainPaths / domainChurn ────────────────────────────────────

test('extractDomainPaths finds backtick-quoted file paths', () => {
  const content = 'See `src/api/user.js` for the pattern, also `bin/docs-health.js`.';
  assert.deepStrictEqual(extractDomainPaths(content).sort(), ['bin/docs-health.js', 'src/api/user.js']);
});

test('extractDomainPaths ignores backtick-quoted strings with no slash', () => {
  const content = 'Run `npm test` and see `SKILL.md`.';
  assert.deepStrictEqual(extractDomainPaths(content), []);
});

test('domainChurn returns 0 when git is unavailable or paths do not exist', () => {
  const root = tmp();
  assert.strictEqual(domainChurn(root, ['src/nope.js'], 0), 0);
});

test('domainChurn(root, paths, 0) counts a commit from well in the past, not just one made in the same instant as the query (regression: git --since=@0 and --since=1970-01-01 are both silently mishandled)', () => {
  // sinceMs=0 is the value rotation.js's selectByStaleThenChurn passes for any
  // never-before-audited doc (lastAuditedMs is null -> sinceMs = 0). The fix
  // must mean "since the beginning of git history," not "since whenever this
  // process happens to run." A backdated commit (via GIT_AUTHOR_DATE /
  // GIT_COMMITTER_DATE) proves this deterministically, without relying on
  // wall-clock sleep or how fast the test happens to execute: two known-bad
  // implementations both pass a naive "commit immediately before querying"
  // check yet fail this one --
  //   - new Date(0).toISOString().slice(0, 10) ("1970-01-01", no time-of-day)
  //     is parsed by git as local midnight and underflows to a pre-epoch
  //     boundary in positive-UTC-offset timezones, silently matching nothing.
  //   - git's numeric `--since=@<seconds>` epoch-literal syntax, for small
  //     second counts, is parsed by git's fuzzy approxidate grammar as an
  //     ambiguous *relative* offset from "now" rather than an absolute
  //     timestamp -- so `--since=@0` silently degrades to "since right now"
  //     once any wall-clock time at all has elapsed since the commit.
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), '', 'utf8');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  const backdated = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes in the past
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_DATE: backdated, GIT_COMMITTER_DATE: backdated },
  });

  const count = domainChurn(root, ['src/b.ts'], 0);
  assert.ok(count > 0, `expected the backdated commit to be counted since sinceMs=0, got ${count}`);
});

// ── selectTarget ─────────────────────────────────────────────────────────

test('selectTarget returns null when there are no docs at all', () => {
  const root = tmp();
  assert.strictEqual(selectTarget(root, {}), null);
});

test('selectTarget force-picks a never-audited doc as stale', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# readme');
  const result = selectTarget(root, {}, { now: 1000000 });
  assert.strictEqual(result.id, 'readme');
  assert.strictEqual(result.why, 'stale');
});

test('selectTarget does not force-pick a doc audited within STALE_DAYS', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# readme');
  const now = Date.now();
  const cursors = { 'doc:readme': { lastAuditedMs: now - (STALE_DAYS - 1) * 86400000 } };
  const result = selectTarget(root, cursors, { now, signals: {} });
  assert.strictEqual(result, null, 'no churn signal and not stale yet -> nothing due');
});

test('selectTarget picks the highest-churn non-stale doc via injected signals', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'low.md'), '# low churn');
  fs.writeFileSync(path.join(root, 'docs', 'high.md'), '# high churn');
  const now = Date.now();
  const recentAudit = now - (STALE_DAYS - 1) * 86400000;
  const cursors = {
    ['doc:low.md'.replace('.md', '')]: { lastAuditedMs: recentAudit },
    ['doc:high.md'.replace('.md', '')]: { lastAuditedMs: recentAudit },
  };
  const result = selectTarget(root, cursors, {
    now,
    signals: { 'doc:low': 1, 'doc:high': 5 },
  });
  assert.strictEqual(result.id, 'high');
  assert.strictEqual(result.why, 'hotspot');
  assert.strictEqual(result.churnCount, 5);
});

test('selectTarget scores churn on declared files: paths, ignoring incidental backtick paths, when files: is present', () => {
  const root = tmp();
  initGitRepo(root);

  // Backdated initial commit: creates both the doc and its declared
  // dependency well before the audit cursor, so the doc's OWN commit
  // (relDocPath, always included in domainChurn's candidate path set)
  // doesn't itself register as post-cursor churn. domainChurn's --since
  // flag is date-granular, so without backdating, the doc's own
  // same-day creation commit would always count as churn regardless of
  // which domainPaths logic is under test — making the assertion pass
  // whether or not the fix is actually applied.
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'declared.ts'), 'export const a = 1;\n');
  fs.writeFileSync(
    path.join(root, 'docs', 'tracked.md'),
    '---\nfiles:\n  - src/declared.ts\n---\n\n# Tracked\n\nSee `src/unrelated.ts` for background.\n',
  );
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'initial state', '--date', '2020-01-01T00:00:00'], {
    cwd: root,
    env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00' },
  });

  const now = Date.now();
  const recentAudit = now - (STALE_DAYS - 1) * 86400000;
  const cursors = { 'doc:tracked': { lastAuditedMs: recentAudit } };

  // Post-cursor commit touching ONLY the declared dependency, not the
  // doc itself — the only legitimate churn source once the doc's own
  // creation is excluded by backdating above.
  fs.writeFileSync(path.join(root, 'src', 'declared.ts'), 'export const a = 2;\n');
  commit(root, 'update declared.ts');

  const result = selectTarget(root, cursors, { now });
  assert.strictEqual(result.why, 'hotspot');
  assert.strictEqual(result.id, 'tracked');
  assert.ok(result.churnCount >= 1);
});

// ── selectTarget: opts.dir (directory-scoped rotation) ──────────────────

test('selectTarget with opts.dir only considers docs under that subdirectory of docs/', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0007-foo.md'), '# foo');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');

  const result = selectTarget(root, {}, { now: 1000000, dir: 'guides' });
  assert.strictEqual(result.id, 'guides/setup');
});

test('selectTarget with opts.dir matching no docs returns null, same as an empty candidate pool', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', '0007-foo.md'), '# foo');

  const result = selectTarget(root, {}, { now: 1000000, dir: 'guides' });
  assert.strictEqual(result, null);
});

test('selectTarget with opts.dir does not match a sibling directory sharing the same prefix (e.g. "decisions" vs "decisions-archive")', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'decisions-archive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions-archive', '0001-old.md'), '# old');

  const result = selectTarget(root, {}, { now: 1000000, dir: 'decisions' });
  assert.strictEqual(result, null, 'a prefix match on directory name alone must not count as "under decisions/"');
});

test('selectTarget without opts.dir considers every doc under docs/ (no scoping regression)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'setup.md'), '# setup');
  const result = selectTarget(root, {}, { now: 1000000 });
  assert.strictEqual(result.id, 'guides/setup');
});

test('selectTarget passes env to domainChurn (#5381)', () => {
  const clean = cleanGitEnv(process.env);
  const B = tmp();
  const git = (args) => execFileSync('git', ['-C', B, ...args], { env: clean, stdio: 'pipe' });
  git(['init', '-q']);
  writeIdentity(B, { name: 'Test', email: 'test@test.com' });
  fs.mkdirSync(path.join(B, 'src'), { recursive: true });
  fs.writeFileSync(path.join(B, 'src', 'x.ts'), 'export const x = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'add x']);
  // Churn lives only in B; each call gets its own root (domainChurn memoizes
  // on root+paths+since, not env).
  const makeRoot = () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'd.md'), '---\nfiles:\n  - src/x.ts\n---\n\n# d\n');
    return root;
  };
  const now = Date.now();
  const cursors = { 'doc:d': { lastAuditedMs: now - 86400000 } };
  const injected = { ...clean, GIT_DIR: path.join(B, '.git') };
  const withEnv = selectTarget(makeRoot(), cursors, { now, env: injected });
  assert.strictEqual(withEnv.id, 'd');
  assert.strictEqual(withEnv.why, 'hotspot');
  assert.strictEqual(selectTarget(makeRoot(), cursors, { now, env: clean }), null);
});
