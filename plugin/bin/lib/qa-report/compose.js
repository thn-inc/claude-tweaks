// plugin/bin/lib/qa-report/compose.js — the QA run's report.json composer (#3328).
// Pure: per-story results in, the Phase 5 `report.json` schema out
// (plugin/skills/test/qa-reporting.md). Every aggregate — summary, findings,
// caveats, recovered_locators, page_inventories, timing — is derived from the
// stories array, so the counts cannot disagree with it the way a hand-written
// report.json can. Readers: verify/qa-stamp.js (composeQaStamp) and
// journey-health/qa-evidence.js. Returns {report} or {error}; never throws on
// malformed input.
'use strict';

const STATUSES = new Set(['PASS', 'PASS_WITH_CAVEATS', 'FAIL', 'SKIPPED']);
const CATEGORIES = new Set(['stale-selector', 'code-bug', 'ux-issue', 'flaky-env', 'story-bug']);

const SEVERITY = {
  'stale-selector': 'Low',
  'code-bug': 'High',
  'ux-issue': 'Medium',
  'flaky-env': 'Low',
  'story-bug': 'Medium',
};

// First match wins, case-insensitive. `story-bug` is a judgment, reachable only
// through a story's own `category`. Rule 1 allows up to 120 non-newline chars
// between the word-bounded noun and "not found" — the repo's own locator
// syntax (`Locator role:button "Submit" not found`, `locator testid:x not found`)
// sits between them, and the word boundaries keep `allocator not found` out.
const CLASSIFY_RULES = [
  ['stale-selector', [/\b(?:locator|element)\b[^\n]{0,120}?\bnot found\b/i]],
  ['flaky-env', [/timeout/i, /navigation failed/i, /net::/i]],
  ['code-bug', [/assertion/i, /expected/i, /verify failed/i]],
];

function classifyFailure(error) {
  if (typeof error !== 'string') return 'code-bug';
  for (const [category, patterns] of CLASSIFY_RULES) {
    if (patterns.some((re) => re.test(error))) return category;
  }
  return 'code-bug';
}

function suggestedFix(category, storyId, runDir) {
  switch (category) {
    case 'stale-selector': return 'Update locator in story YAML';
    case 'flaky-env': return runDir === null ? 'Re-run: `/test qa`' : `Re-run: \`/test qa retry=${runDir}\``;
    case 'story-bug': return `Regenerate story: \`/stories focus=${storyId}\``;
    case 'ux-issue': return 'Review the observation';
    default: return 'Investigate component behavior';
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const orNull = (v) => (v === undefined ? null : v);

function validate(input) {
  if (!isObject(input)) return 'input-not-object';
  if (!Array.isArray(input.stories)) return 'stories-not-array';
  const seen = new Set();
  for (let i = 0; i < input.stories.length; i += 1) {
    const s = input.stories[i];
    if (!isObject(s)) return `story-not-object: ${i}`;
    if (typeof s.id !== 'string' || s.id === '') return `story-missing-id: ${i}`;
    if (seen.has(s.id)) return `duplicate-story-id: ${s.id}`;
    seen.add(s.id);
    if (!STATUSES.has(s.status)) return `invalid-status: ${s.id} ${s.status}`;
    if (s.category !== undefined && s.category !== null && !CATEGORIES.has(s.category)) {
      return `invalid-category: ${s.id} ${s.category}`;
    }
    // A wrong-typed list would otherwise be dropped by the Array.isArray guards
    // below while the summary still counted the story — fail loud instead.
    for (const key of ['caveats', 'recovered_locators', 'page_inventories']) {
      const list = s[key];
      if (list === undefined || list === null) continue;
      const isValid = key === 'caveats' ? (e) => typeof e === 'string' && e !== '' : isObject;
      if (!Array.isArray(list) || !list.every(isValid)) return `invalid-${key}: ${s.id}`;
    }
  }
  return null;
}

function timingOf(input, stories) {
  const wall = typeof input.wall_clock_seconds === 'number'
    && Number.isFinite(input.wall_clock_seconds) && input.wall_clock_seconds >= 0
    ? input.wall_clock_seconds : null;
  let parallelism = null;
  if (wall !== null && wall > 0) {
    const sum = stories
      .filter((s) => s.status !== 'SKIPPED')
      .reduce((acc, s) => acc + (Number.isFinite(s.elapsed_seconds) ? s.elapsed_seconds : 0), 0);
    parallelism = Math.round((sum / wall) * 10) / 10;
  }
  return { wall_clock_seconds: wall, parallelism_factor: parallelism };
}

function composeQaReport(input, opts) {
  const error = validate(input);
  if (error) return { error };
  const now = (opts && opts.now) || (() => new Date().toISOString());
  const { stories } = input;
  const runDir = orNull(input.run_dir);
  const filters = isObject(input.filters) ? input.filters : {};

  const findings = [];
  const caveats = [];
  const recoveredLocators = [];
  const pageInventories = [];
  for (const s of stories) {
    if (s.status === 'FAIL') {
      const category = s.category ?? classifyFailure(s.error);
      findings.push({
        story_id: s.id,
        category,
        severity: SEVERITY[category],
        finding: typeof s.error === 'string' && s.error !== '' ? s.error : 'Story failed with no error text',
        suggested_fix: suggestedFix(category, s.id, runDir),
        trace: s.trace ?? null,
      });
    }
  }
  for (const s of stories) {
    if (s.status === 'PASS_WITH_CAVEATS' && Array.isArray(s.caveats)) {
      for (const observation of s.caveats) {
        findings.push({
          story_id: s.id,
          category: 'ux-issue',
          severity: SEVERITY['ux-issue'],
          finding: observation,
          suggested_fix: suggestedFix('ux-issue', s.id, runDir),
          trace: null,
        });
        caveats.push({ story_id: s.id, observation });
      }
    }
    if (Array.isArray(s.recovered_locators)) {
      for (const r of s.recovered_locators) {
        recoveredLocators.push({ ...r, story_id: s.id, source_file: orNull(s.source_file) });
      }
    }
    if (Array.isArray(s.page_inventories)) {
      for (const p of s.page_inventories) pageInventories.push({ ...p, story_id: s.id });
    }
  }

  const count = (...statuses) => stories.filter((s) => statuses.includes(s.status)).length;
  return {
    report: {
      run_dir: runDir,
      timestamp: typeof input.timestamp === 'string' && input.timestamp !== '' ? input.timestamp : now(),
      stories_dir: orNull(input.stories_dir),
      filters: {
        tag: orNull(filters.tag),
        priority: orNull(filters.priority),
        retry: orNull(filters.retry),
        journey: orNull(filters.journey),
      },
      summary: {
        total: stories.length,
        passed: count('PASS', 'PASS_WITH_CAVEATS'),
        pass_with_caveats: count('PASS_WITH_CAVEATS'),
        failed: count('FAIL'),
        skipped: count('SKIPPED'),
      },
      timing: timingOf(input, stories),
      findings,
      caveats,
      recovered_locators: recoveredLocators,
      page_inventories: pageInventories,
      stories: stories.map((s) => ({
        id: s.id,
        name: orNull(s.name),
        source_file: orNull(s.source_file),
        status: s.status,
        steps_passed: orNull(s.steps_passed),
        steps_total: orNull(s.steps_total),
        elapsed_seconds: orNull(s.elapsed_seconds),
        error: orNull(s.error),
        caveats: Array.isArray(s.caveats) ? s.caveats : [],
        trace: orNull(s.trace),
        screenshot_dir: orNull(s.screenshot_dir),
      })),
    },
  };
}

module.exports = {
  composeQaReport, classifyFailure, STATUSES, CATEGORIES,
};
