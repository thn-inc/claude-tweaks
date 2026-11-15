'use strict';
// The review-summary classifier of tools/driver-merge-check-eval.js (#5228): the one piece of the
// verdict-fixture extraction that decides what a fixture's reviewFindings are. The harness itself
// (extract's gh and git calls, evaluate's worker launches) is a maintainer tool and is not in npm test.
const { describe, test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { classifyReviewSection, scrubLocalPaths } = require(path.join(__dirname, '..', '..', '..', 'tools', 'driver-merge-check-eval.js'));

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

describe("the committed verdict fixtures", () => {
  const file = path.join(__dirname, "fixtures", "merge-check-verdicts.json");
  const raw = require("node:fs").readFileSync(file, "utf8");
  const fixtures = JSON.parse(raw);

  test("meet the AC9 floor and carry the documented shape", () => {
    assert.ok(fixtures.entries.length >= 30, "at least 30 entries");
    assert.ok(fixtures.entries.filter((e) => e.verdict !== "auto-merge").length >= 10, "at least 10 non-auto-merge entries");
    assert.deepStrictEqual(Object.keys(fixtures), ["extractedAt", "divergence", "policy", "excluded", "entries"]);
    for (const e of fixtures.entries) {
      assert.deepStrictEqual(Object.keys(e), ["record", "verdict", "mergeSha", "title", "body", "blastRadius", "reviewFindings"]);
      assert.ok(["auto-merge", "needs-human"].includes(e.verdict));
      assert.match(e.mergeSha, /^[0-9a-f]{40}$/);
    }
  });

  test("carry no local filesystem path and no rationale text", () => {
    const os = require("node:os");
    for (const needle of ["/Users/", os.tmpdir(), "/var/folders/", "/private/var/"]) assert.ok(!raw.includes(needle), "leaked " + needle);
    assert.ok(!/rationale/i.test(Object.keys(fixtures.entries[0]).join(" ")));
  });
});
