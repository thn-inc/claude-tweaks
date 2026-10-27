'use strict';
// Pins #4137: /build Common Step 3 writes a canonical log line naming the
// simplified tree's sha, and /review Step 5 skips re-simplifying when that line
// still names an ancestor of HEAD with no in-scope source change since.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { run } = require('../plugin/bin/log-decision');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const build = readText(path.join(SKILLS, 'build', 'SKILL.md'));
const steps = readText(path.join(SKILLS, 'review', 'code-mode-steps.md'));
const docsSync = readText(path.join(SKILLS, 'build', 'docs-sync.md'));
const docsLensText = readText(path.join(SKILLS, 'review', 'step3-doc-freshness-lens.md'));
const summaryTemplate = readText(path.join(SKILLS, 'review', 'review-summary-template.md'));

// Both anchors must resolve; the end anchor is searched after the start so a
// repeated end string elsewhere in the file cannot pull the slice wider.
function between(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `anchor missing: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `anchor missing: ${end}`);
  return text.slice(from, to);
}

const build3 = between(build, '### Common Step 3: Code Simplification', '### Common Step 4: Handle Blocked Work');
const review5 = between(steps, '## Step 5: Simplify Changed Code', '## Step 6: Visual Review');

const REGIONS = { build3, review5 };

const docsLens = between(docsLensText, '1. Read `docs/REGISTRY.md`', '#### 3i-diagram');
const DOCS_REGIONS = { sync: docsSync, lens: docsLens };

const FACTS = {
  build3: [
    { name: 'AC1.1 writer', re: /--section "\/build" --status SCANNED --step "Common Step 3" --text "simplify: scope simplified at \{sha\}"/ },
    { name: 'AC1.1 writer gate', re: /reports `Verification: pass` \(its changes committed\) or `No simplifications needed`/ },
    { name: 'AC1.1 writer scope', re: /scope it was passed is the branch's whole own-work diff from the integration base/ },
    { name: 'AC1.1 writer no line', re: /a BLOCKED or STAGED Step 3 writes no line/ },
  ],
  review5: [
    { name: 'AC1.1 qualified skill ref', re: /\*\*Skip when `\/claude-tweaks:build` already simplified this tree/ },
    { name: 'AC1.1 selector', re: /`Common Step 3: simplify: scope simplified at \{sha\}`/ },
    { name: 'AC1.1 hex sha', re: /where \{sha\} is 7-40 hex characters/ },
    { name: 'AC1.1 skip trigger', re: /Skip this step when that line exists/ },
    { name: 'AC1.1 listing exit', re: /and both listing commands exit 0/ },
    { name: 'AC1.1 last line', re: /read the last line under `\$PIPELINE_RUN_DIR\/decisions\.md`'s `## \/build` heading/ },
    { name: 'AC1.1 ancestry', re: /`git merge-base --is-ancestor \{sha\} HEAD` exits 0/ },
    { name: 'AC1.1 diff', re: /`git diff --name-only \{sha\}` \(the working tree, so uncommitted fixes count\) or `git ls-files --others --exclude-standard` lists/ },
    { name: 'AC1.1 no fix since', re: /no build fix and no review fix has touched an in-scope source file since/ },
    { name: 'AC1.1 skip log', re: /--section "\/review" --status SKIP --step "Step 5 simplify \(skipped\)"/ },
    { name: 'AC1.1 skip arrow', re: /\{sha\}, no in-scope source file changed since → fallback: \/claude-tweaks:simplify not re-run"/ },
    { name: 'AC1.1 fallback hex or history', re: /a \{sha\} that is not 7-40 hex characters or outside `HEAD`'s history/ },
    { name: 'AC1.1 fallback listing failure', re: /a listing command that exits non-zero/ },
    { name: 'AC1.1 fallback', re: /runs this step as below/ },
  ],
};

const DOCS_FACTS = {
  sync: [
    { name: 'AC2.1 writer', re: /--section "\/build" --status SCANNED --step "Common Step 6\.5" --text "docs sync: \{doc\} assessed at \{sha\}, no stale text"/ },
    { name: 'AC2.1 writer gate', re: /when the read finds nothing the change makes stale and `\$PIPELINE_RUN_DIR` is set/ },
    { name: 'AC2.1 one line per doc', re: /log one line per such doc/ },
    { name: 'AC2.1 text-file', re: /is passed with `--text-file` instead/ },
  ],
  lens: [
    { name: 'AC2.1 qualified skill ref', re: /\*\*Skip a doc `\/claude-tweaks:build` already checked/ },
    { name: 'AC2.1 reader binding', re: /When `\$PIPELINE_RUN_DIR` is set and its `decisions\.md` carries, under `## \/build`, a line with/ },
    { name: 'AC2.1 selector', re: /`Common Step 6\.5: docs sync: \{doc\} assessed at \{sha\}, no stale text`/ },
    { name: 'AC2.1 hex sha', re: /where \{sha\} is 7-40 hex characters/ },
    { name: 'AC2.1 ancestry', re: /`git merge-base --is-ancestor \{sha\} HEAD` exits 0/ },
    { name: 'AC2.1 auto-detect diff', re: /neither `git diff --name-only \{sha\}` \(the working tree\) nor `git ls-files --others --exclude-standard` lists a file matching this entry's Auto-detect patterns/ },
    { name: 'AC2.1 listing exit', re: /with both commands exiting 0/ },
    { name: 'AC2.1 no finding', re: /emit no finding for it/ },
    { name: 'AC2.1 failed check flagged', re: /or whose check failed, is still flagged/ },
    { name: 'AC2.1 skip trace', re: /--section "\/review" --status SKIP --step "Lens 3i doc freshness \(skipped\)" --text "condition: build Common Step 6\.5 assessed \{docs and shas\} with no stale text, matched sources unchanged since → fallback: no 3i finding for them" --reversibility n\/a/ },
    { name: 'AC2.1 skip trace once', re: /one line per review, listing the dropped docs/ },
    { name: 'AC2.1 renumbered flag step', re: /5\. Flag the remaining unupdated docs as informational findings:/ },
  ],
};

function countMatches(text, re) {
  return (text.match(new RegExp(re.source, 'g')) || []).length;
}

// Names of the facts whose regex no longer matches the region.
function missing(region, facts) {
  return facts.filter(({ re }) => !re.test(region)).map(({ name }) => name);
}

const NOW = new Date(2026, 7, 16, 9, 5, 7).getTime();
const DOC = 'plugin/skills/build/SKILL.md';

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every fact in every region matches exactly once.
function assertFactsMatchOnce(factsByRegion, regions) {
  for (const [regionName, facts] of Object.entries(factsByRegion)) {
    const region = regions[regionName];
    assert.deepStrictEqual(missing(region, facts), [], `${regionName}: missing facts`);
    for (const { name, re } of facts) {
      assert.strictEqual(countMatches(region, re), 1, `${name}: expected exactly one match`);
    }
  }
}

// Stripping any one fact from its region makes missing() report exactly that fact.
function assertStrippingReportsFact(factsByRegion, regions) {
  for (const [regionName, facts] of Object.entries(factsByRegion)) {
    const original = regions[regionName];
    for (const { name, re } of facts) {
      const mutated = original.replace(re, '');
      assert.notEqual(mutated, original, `${name}: regex did not match its region`);
      assert.deepStrictEqual(missing(mutated, facts), [name], name);
    }
  }
}

// The writer's log-decision.js command, run through log-decision's own run() against a
// fixture laid out like tests/bin-lib/log-decision/cli.test.js's fixture()/deps(). Returns
// the decisions.md text run() wrote.
function producerLine(regionText, sha, doc) {
  const status = regionText.match(/--status ([A-Z-]+)/)[1];
  const section = regionText.match(/--section "([^"]+)"/)[1];
  const step = regionText.match(/--step "([^"]+)"/)[1];
  const text = regionText.match(/--text "([^"]+)"/)[1].replaceAll('{sha}', sha).replaceAll('{doc}', doc);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsb-'));
  try {
    const main = path.join(root, 'main');
    const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    const code = run(
      ['--run', runDir, '--section', section, '--status', status, '--step', step, '--text', text, '--reversibility', 'n/a'],
      { now: () => NOW, cwd: () => main, mainRoot: main, stdout: () => {}, stderr: () => {} },
    );
    assert.equal(code, 0, 'log-decision run() exits 0');
    return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The reader selector: the region's first backticked string carrying {sha}, with
// {sha} -> ([0-9a-f]{7,40}) and {doc} -> the escaped doc path.
function selectSha(decisionsText, regionText, doc) {
  const selector = regionText.match(/`([^`]*\{sha\}[^`]*)`/)[1];
  const pattern = selector
    .split('{sha}')
    .map((piece) => piece.split('{doc}').map(escapeRe).join(escapeRe(doc)))
    .join('([0-9a-f]{7,40})');
  const re = new RegExp(pattern);
  let sha = null;
  let inBuildSection = false;
  for (const line of decisionsText.split('\n')) {
    if (line.startsWith('## ')) {
      inBuildSection = line === '## /build';
      continue;
    }
    if (!inBuildSection) continue;
    const m = line.match(re);
    if (m) sha = m[1];
  }
  return sha;
}

test('AC1.1: every simplify-pair fact matches exactly once in its region', () => {
  assertFactsMatchOnce(FACTS, REGIONS);
});

test('AC1.1 go-red: stripping each fact reports exactly that fact', () => {
  assertStrippingReportsFact(FACTS, REGIONS);
});

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const SECOND_SHA = 'ffffffffffffffffffffffffffffffffffffffff';

test("AC3.1 twin: review Step 5's selector reads the sha build Common Step 3's command writes", () => {
  const decisions = producerLine(build3, SHA, DOC);
  assert.match(decisions, /^- SCANNED /m, 'the writer logs a scan outcome, not an auto-applied change');
  assert.equal(selectSha(decisions, review5, DOC), SHA);

  const movedUnderReview = decisions.replace('## /build', '## /review');
  assert.equal(selectSha(movedUnderReview, review5, DOC), null);

  const twoWriters = decisions + producerLine(build3, SECOND_SHA, DOC);
  assert.equal(selectSha(twoWriters, review5, DOC), SECOND_SHA);
});

test('AC3.1 twin go-red: rewording the writer text or the reader selector breaks the match', () => {
  const decisions = producerLine(build3, SHA, DOC);
  assert.equal(selectSha(decisions, review5, DOC), SHA, 'baseline matches');

  const rewordedWriter = producerLine(build3.replace('scope simplified', 'scope cleaned'), SHA, DOC);
  assert.equal(selectSha(rewordedWriter, review5, DOC), null, 'reworded writer no longer matches the selector');

  const rewordedReader = review5.replace('scope simplified', 'scope cleaned');
  assert.notEqual(rewordedReader, review5, 'selector reword applied');
  assert.equal(selectSha(decisions, rewordedReader, DOC), null, 'reworded selector no longer matches the writer');
});

test('AC2.1: every docs-pair fact matches exactly once in its region', () => {
  assertFactsMatchOnce(DOCS_FACTS, DOCS_REGIONS);
});

test('AC2.1 go-red: stripping each docs-pair fact reports exactly that fact', () => {
  assertStrippingReportsFact(DOCS_FACTS, DOCS_REGIONS);
});

const SUMMARY_FACTS = [
  { name: 'compact form', re: /Simplification \{none needed \| skipped — \/build simplified at \{sha\}\}/ },
  { name: 'section variants', re: /\{summary of simplifier changes, "No simplifications needed", or "skipped — \/build simplified at \{sha\}"\}/ },
];

test('AC1.1: the review summary template offers the skipped-Step-5 wording in both forms', () => {
  const factsByRegion = { summaryTemplate: SUMMARY_FACTS };
  const regions = { summaryTemplate };
  assertFactsMatchOnce(factsByRegion, regions);
  assertStrippingReportsFact(factsByRegion, regions);
});

const DOC_PLUGIN = 'docs/plugin-structure.md';
const DOC_HOOKS = 'docs/hooks.md';

test("AC3.1 twin: lens 3i's selector reads the sha build Step 6.5's command writes for that doc", () => {
  const decisions = producerLine(docsSync, SHA, DOC_PLUGIN);
  assert.match(decisions, /^- SCANNED /m, 'the writer logs a scan outcome, not an auto-applied change');
  assert.equal(selectSha(decisions, docsLens, DOC_PLUGIN), SHA);

  const otherDoc = producerLine(docsSync, SHA, DOC_HOOKS);
  assert.equal(selectSha(otherDoc, docsLens, DOC_PLUGIN), null);
});

test('AC3.1 twin go-red: rewording the no-stale-text phrase in either region breaks the match', () => {
  const decisions = producerLine(docsSync, SHA, DOC_PLUGIN);
  assert.equal(selectSha(decisions, docsLens, DOC_PLUGIN), SHA, 'baseline matches');

  const rewordedWriter = docsSync.replace('no stale text', 'nothing stale');
  assert.notEqual(rewordedWriter, docsSync, 'writer reword applied');
  assert.equal(selectSha(producerLine(rewordedWriter, SHA, DOC_PLUGIN), docsLens, DOC_PLUGIN), null, 'reworded writer no longer matches the selector');

  const rewordedReader = docsLens.replace('no stale text', 'nothing stale');
  assert.notEqual(rewordedReader, docsLens, 'reader reword applied');
  assert.equal(selectSha(decisions, rewordedReader, DOC_PLUGIN), null, 'reworded selector no longer matches the writer');
});
