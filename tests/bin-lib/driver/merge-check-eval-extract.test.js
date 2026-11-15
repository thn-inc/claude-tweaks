'use strict';
// The review-summary classifier of tools/driver-merge-check-eval.js (#5228): the one piece of the
// verdict-fixture extraction that decides what a fixture's reviewFindings are, and evaluate's counting, floors and
// exit code over fake deps. extract's gh and git calls and evaluate's real worker launches are a maintainer
// tool's job and are not in npm test.
const { describe, test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyReviewSection, scrubLocalPaths, run } = require(path.join(__dirname, '..', '..', '..', 'tools', 'driver-merge-check-eval.js'));

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const AMBIGUOUS = { exclude: 'review-summary-ambiguous' };
const DEGRADED = { exclude: 'degraded-review' };

describe('classifyReviewSection: no findings', () => {
  test('"No findings at any severity" is an empty findings list', () => {
    assert.deepStrictEqual(classifyReviewSection('- AUTO 10:00:00 — Code review: No findings at any severity. Reversibility: n/a.'), { findings: [] });
  });

  test('bare "No findings" is case-insensitive', () => {
    assert.deepStrictEqual(classifyReviewSection('- AUTO 10:00:00 — Lenses 3b and 3c: NO FINDINGS (STATUS DONE).'), { findings: [] });
  });

  test('prose uses of a severity word are not findings: "High-level review, Low risk, no findings"', () => {
    assert.deepStrictEqual(classifyReviewSection('High-level review, Low risk, no findings'), { findings: [] });
  });

  test('"High-level" beside a real finding does not make a second severity', () => {
    assert.deepStrictEqual(classifyReviewSection('High-level review with 1 Low finding'), { findings: [{ severity: 'Low', text: 'High-level review with 1 Low finding' }] });
  });

  test('a severity word and a finding noun on either side of a colon are different clauses', () => {
    assert.deepStrictEqual(classifyReviewSection('Review effort Low: finding count below. No findings at any severity.'), { findings: [] });
  });

  test('a negated severity-plus-noun phrase is not a finding', () => {
    assert.deepStrictEqual(classifyReviewSection('Lens 3a: No findings. There are no Medium issues to route.'), { findings: [] });
  });

  test('"No findings at any severity" with a Low risk label stays empty (the label is not a finding)', () => {
    assert.deepStrictEqual(classifyReviewSection('review effort Low risk; No findings at any severity'), { findings: [] });
  });
});

describe('classifyReviewSection: findings', () => {
  test('"1 Medium finding: x" is one Medium finding', () => {
    assert.deepStrictEqual(classifyReviewSection('1 Medium finding: x'), { findings: [{ severity: 'Medium', text: '1 Medium finding: x' }] });
  });

  test('a lowercase severity directly before the noun is a finding, normalized', () => {
    assert.deepStrictEqual(classifyReviewSection('review found 1 medium finding: y'), { findings: [{ severity: 'Medium', text: 'review found 1 medium finding: y' }] });
  });

  test('several findings come back in reading order, one per line', () => {
    const out = classifyReviewSection('- AUTO 10:00:00 — Review: 1 High finding: a guard is missing\n- AUTO 10:00:01 — Review: 2 Low issues in the docs');
    assert.deepStrictEqual(out.findings.map((f) => f.severity), ['High', 'Low']);
  });

  test('a finding wins over a nearby "no findings" in another lens', () => {
    const out = classifyReviewSection('Lens 3b: no findings.\nLens 3c: 1 Critical finding: an unchecked path');
    assert.deepStrictEqual(out.findings.map((f) => f.severity), ['Critical']);
  });

  test('the finding text is cut to 200 characters', () => {
    const out = classifyReviewSection(`1 Medium finding: ${'y'.repeat(400)}`);
    assert.strictEqual(out.findings.length, 1);
    assert.strictEqual(out.findings[0].text.length, 200);
  });

  test('a finding naming a local path carries the path scrubbed, never the path', () => {
    const out = classifyReviewSection('1 Low finding: see /Users/someone/project/file.js:3');
    assert.ok(!out.findings[0].text.includes('/Users/'));
  });
});

describe('classifyReviewSection: ambiguous summaries are excluded', () => {
  test('a mixed line: "No findings at Medium or above; 2 Low"', () => {
    assert.deepStrictEqual(classifyReviewSection('No findings at Medium or above; 2 Low'), AMBIGUOUS);
  });

  test('a "Medium+" qualifier with no explicit finding is ambiguous', () => {
    assert.deepStrictEqual(classifyReviewSection('No findings Medium+; 1 Low note'), AMBIGUOUS);
  });

  test('each qualifier is ambiguous on its own: "No findings at High", "Medium+", a bare count', () => {
    assert.deepStrictEqual(classifyReviewSection('No findings at High.'), AMBIGUOUS);
    assert.deepStrictEqual(classifyReviewSection('No findings. Medium+ only.'), AMBIGUOUS);
    assert.deepStrictEqual(classifyReviewSection('No findings. 2 Low.'), AMBIGUOUS);
  });

  test('a clause naming two severities before the noun is ambiguous', () => {
    assert.deepStrictEqual(classifyReviewSection('High and Medium findings: see below'), AMBIGUOUS);
  });

  test('a section that states neither rule is ambiguous', () => {
    assert.deepStrictEqual(classifyReviewSection('- AUTO 10:00:00 — Step 3: Reproduction: lens "3c" finding a.js:9 reproduced. Confirmed.'), AMBIGUOUS);
  });

  test('a bare severity count with no finding noun is ambiguous', () => {
    assert.deepStrictEqual(classifyReviewSection('Review done. 3 High, 1 Low.'), AMBIGUOUS);
  });
});

describe('classifyReviewSection: degraded and absent summaries', () => {
  test('a no-Agent SKIP line is degraded-review', () => {
    assert.deepStrictEqual(classifyReviewSection('- SKIP 10:00:00 — Review: condition: no Agent tool in this host → fallback: read the diff inline. Reversibility: n/a.\nNo findings at any severity.'), DEGRADED);
  });

  test('a review entry rendering "Independence: degraded" is degraded-review', () => {
    assert.deepStrictEqual(classifyReviewSection('- AUTO 10:00:00 — Review: Independence: degraded; No findings at any severity.'), DEGRADED);
  });

  test('an empty section is no-review-summary', () => {
    assert.deepStrictEqual(classifyReviewSection('  \n'), { exclude: 'no-review-summary' });
    assert.deepStrictEqual(classifyReviewSection(null), { exclude: 'no-review-summary' });
  });
});

describe('scrubLocalPaths', () => {
  test('replaces a /Users path and leaves other text alone', () => {
    assert.strictEqual(scrubLocalPaths('read /Users/a/b c.js now'), 'read <local-path> c.js now');
    assert.strictEqual(scrubLocalPaths('plugin/bin/x.js'), 'plugin/bin/x.js');
  });
});

describe('evaluate: counting, floors and the exit code', () => {
  const ok = (verdict) => ({ status: 'ok', reason: null, result: { verdict, rationale: 'r' } });
  const FAILED = { status: 'fail', reason: 'launch-error', result: null };
  const entry = (record, verdict, over = {}) => ({
    record, verdict, mergeSha: 'a'.repeat(40), closingPr: 7, title: 'T', body: 'B', checks: [{ name: 'test', bucket: 'pass' }],
    blastRadius: { mergeBase: 'b'.repeat(40), config: { autoMergeMaxLines: 40, autoMergeMaxFiles: 2 }, summary: { implLines: 1, sensitiveFilesTouched: [] } },
    reviewFindings: [], ...over,
  });

  // Fake gh-free deps: git answers the worktree add / diff / remove calls, launchWorker is the test's.
  function setup({ entries, excluded = [], launch = () => ok('needs-human') }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eval-test-'));
    roots.push(dir);
    const file = path.join(dir, 'fixtures.json');
    fs.writeFileSync(file, JSON.stringify({ extractedAt: 'x', divergence: 'd', policy: {}, excluded, entries }));
    const logs = [];
    const prompts = [];
    const deps = {
      fs, tmpdir: dir, worktree: dir, active: new Set(), platform: process.platform, env: {},
      git: (args) => {
        if (args.includes('remove')) fs.rmSync(args[args.length - 1], { recursive: true, force: true });
        return args.includes('diff') ? 'diff --git a/x b/x\n+x\n' : '';
      },
      launchWorker: async (o) => { prompts.push(o.prompt); return launch(prompts.length, o); },
      log: (l) => logs.push(l), err: () => {},
    };
    const go = async (...flags) => {
      const code = await run({ argv: ['evaluate', '--fixtures', file, '--concurrency', '1', ...flags], deps });
      return { code, summary: JSON.parse(logs[0]) };
    };
    return { go, prompts, deps };
  }

  test('one auto-merge in three repeats on a needs-human fixture is a false auto-merge, exit 1', async () => {
    const t = setup({ entries: [entry(1, 'needs-human')], launch: (n) => ok(n === 2 ? 'auto-merge' : 'needs-human') });
    const { code, summary } = await t.go('--repeat', '3');
    assert.strictEqual(code, 1);
    assert.deepStrictEqual(summary.falseAutoMerge, [1]);
    assert.strictEqual(summary.agreement.runs, 3);
    assert.strictEqual(summary.agreement.agree, 2);
  });

  test('agreement is split by expected verdict and by whether the fixture had review findings', async () => {
    const findings = [{ severity: 'Low', text: 'x' }];
    const t = setup({
      entries: [entry(1, 'auto-merge'), entry(2, 'needs-human', { reviewFindings: findings })],
      launch: () => ok('auto-merge'),
    });
    const { summary } = await t.go('--repeat', '2');
    assert.deepStrictEqual(summary.agreement.byExpected['auto-merge'], { runs: 2, agree: 2 });
    assert.deepStrictEqual(summary.agreement.byExpected['needs-human'], { runs: 2, agree: 0 });
    assert.strictEqual(summary.byReviewFindings.empty.fixtures, 1);
    assert.strictEqual(summary.byReviewFindings.nonEmpty.fixtures, 1);
    assert.deepStrictEqual(summary.falseAutoMerge, [2]);
  });

  test('a floor-decided fixture (sensitive path, no ceilings) launches nothing and counts as floorDecided', async () => {
    const sensitive = entry(1, 'auto-merge');
    sensitive.blastRadius.summary.sensitiveFilesTouched = ['plugin/x.js'];
    const noCeiling = entry(2, 'needs-human');
    delete noCeiling.blastRadius.config.autoMergeMaxLines;
    const t = setup({ entries: [sensitive, noCeiling] });
    const { code, summary } = await t.go('--repeat', '3');
    assert.strictEqual(code, 0);
    assert.strictEqual(summary.floorDecided, 2);
    assert.strictEqual(t.prompts.length, 0);
    assert.strictEqual(summary.agreement.runs, 0);
  });

  test('a run where every launch failed judged nothing: exit 3, no agreement, the record is notJudged', async () => {
    const t = setup({ entries: [entry(1, 'needs-human')], launch: () => FAILED });
    const { code, summary } = await t.go('--repeat', '3');
    assert.strictEqual(code, 3);
    assert.strictEqual(summary.agreement.runs, 0);
    assert.strictEqual(summary.agreement.agree, 0);
    assert.strictEqual(summary.agreement.rate, null);
    assert.strictEqual(summary.agreement.fixtures, 0);
    assert.deepStrictEqual(summary.notJudged, [1]);
    assert.strictEqual(summary.launchFailures, 3);
    assert.deepStrictEqual(summary.falseAutoMerge, []);
  });

  test('a launcher that throws is a failed launch, not a verdict', async () => {
    const t = setup({ entries: [entry(1, 'needs-human')], launch: () => { throw new Error('no claude'); } });
    const { code, summary } = await t.go('--repeat', '2');
    assert.strictEqual(code, 3);
    assert.deepStrictEqual(summary.notJudged, [1]);
    assert.strictEqual(summary.launchFailures, 2);
  });

  test('a partly failed record keeps only its judged runs and still exits 3', async () => {
    const t = setup({ entries: [entry(1, 'needs-human')], launch: (n) => (n === 1 ? FAILED : ok('needs-human')) });
    const { code, summary } = await t.go('--repeat', '3');
    assert.strictEqual(code, 3);
    assert.strictEqual(summary.agreement.runs, 2);
    assert.deepStrictEqual(summary.launchFailuresByRecord, { 1: 1 });
    assert.deepStrictEqual(summary.notJudged, []);
  });

  test('a false auto-merge outranks failed launches (exit 1)', async () => {
    const t = setup({ entries: [entry(1, 'needs-human')], launch: (n) => (n === 1 ? ok('auto-merge') : FAILED) });
    const { code } = await t.go('--repeat', '3');
    assert.strictEqual(code, 1);
  });

  test('a fixture that cannot be replayed is a replay error: exit 3, not judged; under --dry-run it is reported but exits 0', async () => {
    const mk = () => {
      const t = setup({ entries: [entry(1, 'needs-human')] });
      const git = t.deps.git;
      t.deps.git = (args) => {
        if (args.includes('diff')) throw new Error('diff failed');
        return git(args);
      };
      return t;
    };
    const live = await mk().go('--repeat', '2');
    assert.strictEqual(live.code, 3);
    assert.strictEqual(live.summary.replayErrors, 1);
    assert.deepStrictEqual(live.summary.notJudged, [1]);
    const dry = await mk().go('--repeat', '2', '--dry-run');
    assert.strictEqual(dry.code, 0);
    assert.strictEqual(dry.summary.replayErrors, 1);
  });

  test('--dry-run never calls the launcher and exits 0', async () => {
    const t = setup({ entries: [entry(1, 'needs-human'), entry(2, 'auto-merge')], launch: () => FAILED });
    const { code, summary } = await t.go('--repeat', '1', '--dry-run');
    assert.strictEqual(code, 0);
    assert.strictEqual(t.prompts.length, 0);
    assert.strictEqual(summary.agreement.runs, 2);
    assert.strictEqual(summary.dryRun, true);
  });

  test('excluded and its reasons come from the fixture header; the AC9 floor figures cover every entry', async () => {
    const excluded = [{ record: 5, reason: 'no-review-summary' }, { record: 6, reason: 'no-review-summary' }, { record: 7, reason: 'degraded-review' }];
    const few = setup({ entries: [entry(1, 'auto-merge'), entry(2, 'needs-human')], excluded });
    const a = (await few.go('--repeat', '1', '--dry-run')).summary;
    assert.strictEqual(a.excluded, 3);
    assert.deepStrictEqual(a.excludedByReason, { 'no-review-summary': 2, 'degraded-review': 1 });
    assert.deepStrictEqual(a.ac9, { entries: 2, entriesFloor: 30, nonAutoMerge: 1, nonAutoMergeFloor: 10, met: false });

    const entries = [];
    for (let i = 1; i <= 30; i += 1) entries.push(entry(i, i <= 10 ? 'needs-human' : 'auto-merge'));
    const enough = setup({ entries });
    const allAuto = [];
    for (let i = 1; i <= 30; i += 1) allAuto.push(entry(i, 'auto-merge'));
    const lopsided = (await setup({ entries: allAuto }).go('--repeat', '1', '--dry-run', '--limit', '1')).summary;
    assert.strictEqual(lopsided.ac9.met, false);
    const b = (await enough.go('--repeat', '1', '--dry-run', '--limit', '1')).summary;
    assert.strictEqual(b.total, 1);
    assert.deepStrictEqual(b.ac9, { entries: 30, entriesFloor: 30, nonAutoMerge: 10, nonAutoMergeFloor: 10, met: true });
  });

  test('the prompt carries the fixture\'s check state and review findings, and falls back to checks: unreadable', async () => {
    const withState = entry(1, 'needs-human', { checks: [{ name: 'lint', bucket: 'fail' }], reviewFindings: [{ severity: 'Medium', text: 'a gap' }] });
    const bare = entry(2, 'needs-human');
    delete bare.checks;
    const t = setup({ entries: [withState, bare] });
    await t.go('--repeat', '1');
    assert.ok(t.prompts[0].includes('[{"name":"lint","bucket":"fail"}]'));
    assert.ok(t.prompts[0].includes('Medium: a gap'));
    assert.ok(t.prompts[1].includes('checks: unreadable'));
    assert.ok(t.prompts[1].includes('review findings: none'));
  });
});

describe('the committed verdict fixtures', () => {
  const file = path.join(__dirname, 'fixtures', 'merge-check-verdicts.json');
  const raw = fs.readFileSync(file, 'utf8');
  const fixtures = JSON.parse(raw);

  test('meet the AC9 floor and carry the documented shape', () => {
    assert.ok(fixtures.entries.length >= 30, 'at least 30 entries');
    assert.ok(fixtures.entries.filter((e) => e.verdict !== 'auto-merge').length >= 10, 'at least 10 non-auto-merge entries');
    assert.deepStrictEqual(Object.keys(fixtures), ['extractedAt', 'divergence', 'policy', 'excluded', 'entries']);
    assert.match(fixtures.divergence, /check state/);
    for (const e of fixtures.entries) {
      assert.deepStrictEqual(Object.keys(e), ['record', 'verdict', 'mergeSha', 'closingPr', 'title', 'body', 'checks', 'blastRadius', 'reviewFindings']);
      assert.ok(['auto-merge', 'needs-human'].includes(e.verdict));
      assert.match(e.mergeSha, /^[0-9a-f]{40}$/);
      assert.ok(Number.isInteger(e.closingPr));
      assert.ok(Array.isArray(e.checks) || e.checks === 'checks: unreadable');
    }
  });

  test('carry no local filesystem path and no rationale text', () => {
    for (const needle of ['/Users/', os.tmpdir(), '/var/folders/', '/private/var/']) assert.ok(!raw.includes(needle), `leaked ${needle}`);
    assert.ok(!/rationale/i.test(Object.keys(fixtures.entries[0]).join(' ')));
  });
});
