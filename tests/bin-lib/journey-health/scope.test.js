const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseJourneyFiles, listJourneys, domainChurn, selectTarget, journeyFileExists,
  missingJourneyFiles, deletedFileSignature, currentDeletedFileSignature,
} = require('../../../plugin/bin/lib/journey-health/scope');
const { buildValidateFindingsUpdate } = require('../../../plugin/bin/lib/journey-health/cache');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-scope-')); }

function writeJourney(root, name, filesFrontmatter) {
  const dir = path.join(root, 'docs', 'journeys');
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = filesFrontmatter.length
    ? `---\nfiles:\n${filesFrontmatter.map((f) => `  - ${f}`).join('\n')}\n---\n`
    : '';
  fs.writeFileSync(path.join(dir, `${name}.md`), `${frontmatter}\n# ${name}\n`, 'utf8');
  for (const relPath of filesFrontmatter) {
    const filePath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8');
  }
}

test('parseJourneyFiles returns [] when there is no frontmatter', () => {
  assert.deepStrictEqual(parseJourneyFiles('# Checkout\n\n## Steps\n'), []);
});

test('parseJourneyFiles parses a files: list', () => {
  const content = '---\nfiles:\n  - src/checkout/Cart.tsx\n  - src/checkout/Payment.tsx\n---\n\n# Checkout\n';
  assert.deepStrictEqual(parseJourneyFiles(content), ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
});

test('listJourneys returns [] when docs/journeys does not exist', () => {
  const root = tmp();
  assert.deepStrictEqual(listJourneys(root), []);
});

test('listJourneys finds and parses journey files, sorted by id', () => {
  const root = tmp();
  writeJourney(root, 'signup-flow', ['src/signup/Form.tsx']);
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const journeys = listJourneys(root);
  assert.strictEqual(journeys.length, 2);
  assert.strictEqual(journeys[0].id, 'checkout-flow');
  assert.strictEqual(journeys[1].id, 'signup-flow');
  assert.deepStrictEqual(journeys[0].filesFrontmatter, ['src/checkout/Cart.tsx']);
});

test('domainChurn returns 0 when relPaths is empty', () => {
  const root = tmp();
  assert.strictEqual(domainChurn(root, [], 0), 0);
});

test('domainChurn returns 0 when git is unavailable or the path has no history', () => {
  const root = tmp();
  assert.strictEqual(domainChurn(root, ['src/nonexistent.ts'], 0), 0);
});

test('selectTarget returns null when there are no journeys', () => {
  const root = tmp();
  assert.strictEqual(selectTarget(root, {}, { now: Date.now(), tier: 'light' }), null);
});

test('selectTarget force-picks a journey unaudited past STALE_DAYS_LIGHT on the light tier', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now - 31 * 86400000 } };
  const result = selectTarget(root, cursors, { now, tier: 'light' });
  assert.strictEqual(result.id, 'checkout-flow');
  assert.strictEqual(result.why, 'stale');
});

test('selectTarget does not force-pick a light-stale journey on the deep tier (independent thresholds)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const now = Date.now();
  // 31 days is past the light threshold (30) but well under the deep threshold (90),
  // and there is no churn signal, so the deep-tier pick must be null.
  const cursors = { 'checkout-flow': { lastDeepAuditMs: now - 31 * 86400000 } };
  const result = selectTarget(root, cursors, { now, tier: 'deep', signals: {} });
  assert.strictEqual(result, null);
});

test('selectTarget picks the highest-churn journey via the signals injection hook', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  writeJourney(root, 'signup-flow', ['src/signup/Form.tsx']);
  const now = Date.now();
  const cursors = {
    'checkout-flow': { lastLightAuditMs: now - 1 * 86400000 },
    'signup-flow': { lastLightAuditMs: now - 1 * 86400000 },
  };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: { 'checkout-flow': 5, 'signup-flow': 2 } });
  assert.strictEqual(result.id, 'checkout-flow');
  assert.strictEqual(result.why, 'hotspot');
  assert.strictEqual(result.churnCount, 5);
});

test('selectTarget passes opts.env to the churn lookup (a fresh journey is a hotspot only through the injected GIT_DIR)', () => {
  const repo = tmp();
  writeJourney(repo, 'checkout-flow', ['src/checkout/Cart.tsx']);
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'test']);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'first']);
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const other = tmp();
  writeJourney(other, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now - 86400000 } };
  const env = { ...process.env, GIT_DIR: path.join(repo, '.git') };
  const picked = selectTarget(root, cursors, { now, tier: 'light', env });
  assert.ok(picked !== null, 'the commit visible only through env must register as churn');
  assert.strictEqual(picked.why, 'hotspot');
  assert.strictEqual(selectTarget(other, cursors, { now, tier: 'light' }), null, 'without env the non-repo root has no churn');
});

test('selectTarget returns null when no candidate is stale and none has churn', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now - 1 * 86400000 } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result, null);
});

test('selectTarget force-picks a journey with a missing declared file on the light tier, ahead of staleness', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();
  // Not stale (audited "now"), no churn signal — would otherwise return null.
  const cursors = { 'checkout-flow': { lastLightAuditMs: now } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.id, 'checkout-flow');
  assert.strictEqual(result.why, 'deleted-file');
  assert.deepStrictEqual(result.missingFiles, ['src/checkout/Cart.tsx']);
});

test('selectTarget does not force-pick a missing-file journey on the deep tier', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastDeepAuditMs: now } };
  const result = selectTarget(root, cursors, { now, tier: 'deep', signals: {} });
  assert.strictEqual(result, null);
});

test('selectTarget respects alreadyPicked so Phase 0 does not repeat the same deleted-file journey within a batch', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  writeJourney(root, 'signup-flow', ['src/signup/Form.tsx']);
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now }, 'signup-flow': { lastLightAuditMs: now } };
  const alreadyPicked = new Set(['checkout-flow']);
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {}, alreadyPicked });
  assert.strictEqual(result, null);
});

// ─── Phase 0 acknowledgement, so a broken journey can't pin rotation (#131) ──
// Phase 0 used to ignore cursors entirely, so a journey with a genuinely
// deleted `files:` entry was force-picked on EVERY run forever — 16 of 17
// journeys never audited across ~9 days of daily firings on the reporting
// repo. The pick is now suppressed once the audit that followed it has
// recorded that exact missing set on the journey's cursor.

test('deletedFileSignature is null for an empty missing set and order-independent otherwise', () => {
  assert.strictEqual(deletedFileSignature([]), null);
  assert.strictEqual(deletedFileSignature(null), null);
  assert.strictEqual(
    deletedFileSignature(['src/b.tsx', 'src/a.tsx']),
    deletedFileSignature(['src/a.tsx', 'src/b.tsx']),
    'frontmatter reordering alone must not read as a changed missing set',
  );
  assert.notStrictEqual(deletedFileSignature(['src/a.tsx']), deletedFileSignature(['src/a.tsx', 'src/b.tsx']));
});

test('missingJourneyFiles / currentDeletedFileSignature report only what is actually gone', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
  assert.strictEqual(currentDeletedFileSignature(root, 'checkout-flow'), null);
  fs.rmSync(path.join(root, 'src/checkout/Payment.tsx'));
  assert.deepStrictEqual(
    missingJourneyFiles(root, ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']),
    ['src/checkout/Payment.tsx'],
  );
  assert.strictEqual(currentDeletedFileSignature(root, 'checkout-flow'), 'src/checkout/Payment.tsx');
  assert.strictEqual(currentDeletedFileSignature(root, 'no-such-journey'), null);
});

test('a Phase 0 pick carries the deletedFileSig the audit is expected to record', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();
  const result = selectTarget(root, { 'checkout-flow': { lastLightAuditMs: now } }, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.why, 'deleted-file');
  assert.strictEqual(result.deletedFileSig, 'src/checkout/Cart.tsx');
});

test('selectTarget does not re-force-pick a journey whose cursor already records this exact missing set (#131)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now, deletedFileSig: 'src/checkout/Cart.tsx' } };
  // Pre-fix this returned the same 'deleted-file' pick on every call, forever.
  assert.strictEqual(selectTarget(root, cursors, { now, tier: 'light', signals: {} }), null);
});

test('an acknowledged-but-still-broken journey is still reachable through the normal staleness rotation', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();
  const cursors = {
    'checkout-flow': { lastLightAuditMs: now - 31 * 86400000, deletedFileSig: 'src/checkout/Cart.tsx' },
  };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.id, 'checkout-flow');
  assert.strictEqual(result.why, 'stale', 'suppression is only of the force-pick, not of the journey itself');
});

test('selectTarget force-picks again when a second declared file goes missing behind an acknowledged one (#131)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  fs.rmSync(path.join(root, 'src/checkout/Payment.tsx'));
  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: now, deletedFileSig: 'src/checkout/Cart.tsx' } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.why, 'deleted-file', 'a new deletion behind a reported one is a new signal');
  assert.deepStrictEqual(result.missingFiles, ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
  assert.strictEqual(result.deletedFileSig, 'src/checkout/Cart.tsx|src/checkout/Payment.tsx');
});

test('selectTarget force-picks again when the frontmatter is edited to declare a different missing file (#131)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Renamed.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Renamed.tsx'));
  const now = Date.now();
  // The cursor acknowledges the OLD path; the frontmatter now names another
  // one that is also missing — a distinct, unreported finding.
  const cursors = { 'checkout-flow': { lastLightAuditMs: now, deletedFileSig: 'src/checkout/Cart.tsx' } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.why, 'deleted-file');
  assert.strictEqual(result.deletedFileSig, 'src/checkout/Renamed.tsx');
});

test('four daily runs against a permanently broken journey audit all four journeys, not the broken one four times (#131)', () => {
  const root = tmp();
  const ids = ['a-flow', 'b-flow', 'c-flow', 'd-flow'];
  for (const id of ids) writeJourney(root, id, [`src/${id}.tsx`]);
  // a-flow's declared file is deleted and never fixed — the exact shape that
  // pinned the engine: it sorts first, so pre-fix every run re-picked it.
  fs.rmSync(path.join(root, 'src', 'a-flow.tsx'));

  // Drives the real run loop: selectTarget, then the same cursor mutator
  // validate-findings hands to writeDurableState — so this exercises the
  // producer/consumer pair (scope.js reads what cache.js writes), not
  // scope.js's own idea of the cursor shape.
  let state = { cursors: {}, retryQueue: [], runs: [] };
  const audited = [];
  const start = Date.now();
  for (let run = 0; run < ids.length; run++) {
    const now = start + run * 86400000; // one firing per day
    const target = selectTarget(root, state.cursors, { now, tier: 'light', signals: {} });
    assert.ok(target, `run ${run} selected nothing at all`);
    audited.push({ id: target.id, why: target.why });
    state = buildValidateFindingsUpdate(state, {
      target: target.id,
      tier: 'light',
      runRecord: { runId: `run-${run}`, runAt: new Date(now).toISOString(), fingerprints: [] },
      deletedFileSig: currentDeletedFileSignature(root, target.id),
      now,
    });
  }

  assert.deepStrictEqual(audited.map((a) => a.id), ids, 'every journey must get audited across four runs');
  assert.strictEqual(audited[0].why, 'deleted-file', 'the broken journey is still reported — once');
  assert.strictEqual(state.cursors['a-flow'].deletedFileSig, 'src/a-flow.tsx');
  assert.strictEqual(
    state.cursors['b-flow'].deletedFileSig, undefined,
    'a healthy journey records no acknowledgement',
  );
});

test('fixing the missing file clears the acknowledgement, so a later re-deletion force-picks again (#131)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const now = Date.now();

  let state = {
    cursors: { 'checkout-flow': { lastLightAuditMs: now, deletedFileSig: 'src/checkout/Cart.tsx' } },
    retryQueue: [],
    runs: [],
  };
  // The file comes back; the next audit of this journey must drop the stale
  // acknowledgement rather than leave it banked against a future deletion.
  fs.mkdirSync(path.join(root, 'src/checkout'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/checkout/Cart.tsx'), '', 'utf8');
  state = buildValidateFindingsUpdate(state, {
    target: 'checkout-flow',
    tier: 'light',
    runRecord: { runId: 'run-1', runAt: new Date(now).toISOString(), fingerprints: [] },
    deletedFileSig: currentDeletedFileSignature(root, 'checkout-flow'),
    now,
  });
  assert.strictEqual(state.cursors['checkout-flow'].deletedFileSig, undefined);

  fs.rmSync(path.join(root, 'src/checkout/Cart.tsx'));
  const result = selectTarget(root, state.cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.why, 'deleted-file');
});

// ─── glob-pattern files: entries (#73) ──────────────────────────────────────

test('journeyFileExists treats a literal path as before (existence-checked directly)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src/checkout'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/checkout/Cart.tsx'), '', 'utf8');
  assert.strictEqual(journeyFileExists(root, 'src/checkout/Cart.tsx'), true);
  assert.strictEqual(journeyFileExists(root, 'src/checkout/Missing.tsx'), false);
});

test('journeyFileExists resolves a final-segment glob against real files', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs/research/competitors'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/research/competitors/company-a.md'), '', 'utf8');
  assert.strictEqual(journeyFileExists(root, 'docs/research/competitors/*.md'), true);
});

test('journeyFileExists reports missing when a glob resolves to zero real files', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs/research/competitors'), { recursive: true });
  assert.strictEqual(journeyFileExists(root, 'docs/research/competitors/*.md'), false);
});

test('journeyFileExists reports missing when a glob\'s directory does not exist at all', () => {
  const root = tmp();
  assert.strictEqual(journeyFileExists(root, 'docs/research/competitors/*.md'), false);
});

test('journeyFileExists treats a directory-segment wildcard as unsupported (always present, never false-flags)', () => {
  const root = tmp();
  assert.strictEqual(journeyFileExists(root, 'docs/*/index.md'), true);
});

test('selectTarget does not force-pick a journey whose glob files: entry resolves to real files (#73)', () => {
  const root = tmp();
  const journeysDir = path.join(root, 'docs', 'journeys');
  fs.mkdirSync(journeysDir, { recursive: true });
  fs.writeFileSync(
    path.join(journeysDir, 'competitor-dashboard-research.md'),
    '---\nfiles:\n  - docs/research/competitors/*.md\n---\n\n# Competitor dashboard research\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'docs/research/competitors'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/research/competitors/company-a.md'), '', 'utf8');
  const now = Date.now();
  // Not stale (audited "now"), no churn signal — would otherwise return null;
  // the pre-fix literal existsSync check on the raw glob string would have
  // force-picked this journey as 'deleted-file' every time regardless.
  const cursors = { 'competitor-dashboard-research': { lastLightAuditMs: now } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result, null);
});

test('selectTarget still force-picks a journey whose glob files: entry resolves to zero real files', () => {
  const root = tmp();
  const journeysDir = path.join(root, 'docs', 'journeys');
  fs.mkdirSync(journeysDir, { recursive: true });
  fs.writeFileSync(
    path.join(journeysDir, 'competitor-dashboard-research.md'),
    '---\nfiles:\n  - docs/research/competitors/*.md\n---\n\n# Competitor dashboard research\n',
    'utf8',
  );
  const now = Date.now();
  const cursors = { 'competitor-dashboard-research': { lastLightAuditMs: now } };
  const result = selectTarget(root, cursors, { now, tier: 'light', signals: {} });
  assert.strictEqual(result.id, 'competitor-dashboard-research');
  assert.strictEqual(result.why, 'deleted-file');
});

// ─── caching regression tests ───────────────────────────────────────────────
// Covers the efficiency finding: selectTarget used to unconditionally
// re-list+re-read every journey file (and re-spawn `git log` per candidate in
// Phase 2) on every call, so a --budget > 1 loop redid the full scan from
// scratch on every slot even though nothing on disk changes between
// iterations of the same run.

test('listJourneys caches parsed content across calls when the directory is unchanged (regression: a --budget>1 loop must not re-read every file every slot)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  writeJourney(root, 'signup-flow', ['src/signup/Form.tsx']);

  const originalReadFileSync = fs.readFileSync;
  let readCount = 0;
  fs.readFileSync = (...fsArgs) => {
    readCount += 1;
    return originalReadFileSync(...fsArgs);
  };
  try {
    const first = listJourneys(root);
    assert.strictEqual(readCount, 2); // one read per journey file on the cold call
    const second = listJourneys(root);
    assert.strictEqual(readCount, 2); // unchanged directory -> no additional reads
    assert.strictEqual(second, first); // cache hit returns the same array reference
    // Simulate a --budget=5 loop hitting the same unchanged directory 5 times.
    for (let i = 0; i < 3; i++) listJourneys(root);
    assert.strictEqual(readCount, 2);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('listJourneys re-reads a journey after its content changes (cache correctly invalidates, not just wins on staleness)', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  const first = listJourneys(root);
  assert.deepStrictEqual(first[0].filesFrontmatter, ['src/checkout/Cart.tsx']);

  fs.writeFileSync(
    path.join(root, 'docs', 'journeys', 'checkout-flow.md'),
    '---\nfiles:\n  - src/checkout/Cart.tsx\n  - src/checkout/Payment.tsx\n---\n\n# checkout-flow\n',
    'utf8',
  );
  const second = listJourneys(root);
  assert.deepStrictEqual(second[0].filesFrontmatter, ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
});

test('domainChurn caches identical (root, paths, sinceMs) calls instead of re-spawning git', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), '', 'utf8');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init']);

  const first = domainChurn(root, ['src/a.ts'], 0);
  assert.ok(first > 0);

  // Remove .git so a second, uncached call would fall through to the
  // execFileSync catch block and silently return 0 — proves the second call
  // below is served from the cache, not a fresh `git log` subprocess.
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const second = domainChurn(root, ['src/a.ts'], 0);
  assert.strictEqual(second, first);
});

test('domainChurn(root, paths, 0) counts a commit from well in the past, not just one made in the same instant as the query (regression: git --since=@0 and --since=1970-01-01 are both silently mishandled)', () => {
  // sinceMs=0 is the value rotation.js's selectByStaleThenChurn passes for any
  // never-before-audited journey (lastAuditedMs is null -> sinceMs = 0). The
  // fix must mean "since the beginning of git history," not "since whenever
  // this process happens to run." A backdated commit (via GIT_AUTHOR_DATE /
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
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  const backdated = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes in the past
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_DATE: backdated, GIT_COMMITTER_DATE: backdated },
  });

  const count = domainChurn(root, ['src/b.ts'], 0);
  assert.ok(count > 0, `expected the backdated commit to be counted since sinceMs=0, got ${count}`);
});

// Regression: computeScore must UNION the journey file's own path into the
// domainChurn pathspec, not just its declared filesFrontmatter — otherwise a
// journey that's been heavily hand-rewritten, with no change to the files it
// happens to declare, is invisible to the rotation algorithm even though its
// own edit history is a real drift signal (mirrors docs-health/scope.js's
// [relDocPath, ...domainPaths] union).
test('selectTarget registers hotspot churn from a journey\'s own edit history, even when its declared files never changed', () => {
  const root = tmp();
  writeJourney(root, 'checkout-flow', ['src/checkout/Cart.tsx']);
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'first']);

  const sinceMs = Date.now() - 86400000;
  // Only the journey file itself changes — its declared src/checkout/Cart.tsx
  // dependency is never touched again.
  fs.writeFileSync(
    path.join(root, 'docs', 'journeys', 'checkout-flow.md'),
    '---\nfiles:\n  - src/checkout/Cart.tsx\n---\n\n# checkout-flow (rewritten)\nMore narrative detail.\n',
    'utf8',
  );
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'second']);

  const now = Date.now();
  const cursors = { 'checkout-flow': { lastLightAuditMs: sinceMs } };
  const result = selectTarget(root, cursors, { now, tier: 'light' });
  assert.ok(result !== null, 'must pick checkout-flow via its own edit history, not just its declared files');
  assert.strictEqual(result.id, 'checkout-flow');
  assert.strictEqual(result.why, 'hotspot');
  assert.ok(result.churnCount > 0, `expected churnCount > 0 from the journey's own commit, got ${result.churnCount}`);
});
