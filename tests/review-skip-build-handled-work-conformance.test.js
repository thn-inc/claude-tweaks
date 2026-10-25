'use strict';
// Pins #4137: /build Common Step 3 writes a canonical log line naming the
// simplified tree's sha, and /review Step 5 skips re-simplifying when that line
// still names an ancestor of HEAD with no in-scope source change since.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { run } = require('../plugin/bin/log-decision');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const build = readText(path.join(SKILLS, 'build', 'SKILL.md'));
const steps = readText(path.join(SKILLS, 'review', 'code-mode-steps.md'));

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

const FACTS = {
  build3: [
    { name: 'AC1.1 writer', re: /--section "\/build" --status AUTO --step "Common Step 3" --text "simplify: scope simplified at \{sha\}"/ },
    { name: 'AC1.1 writer gate', re: /`STATUS: DONE`/ },
    { name: 'AC1.1 reader pointer', re: /`\/review` Step 5 reads this line/ },
  ],
  review5: [
    { name: 'AC1.1 selector', re: /`Common Step 3: simplify: scope simplified at \{sha\}`/ },
    { name: 'AC1.1 last line', re: /read the last line under `decisions\.md`'s `## \/build` heading/ },
    { name: 'AC1.1 ancestry', re: /`git merge-base --is-ancestor \{sha\} HEAD` exits 0/ },
    { name: 'AC1.1 diff', re: /`git diff --name-only \{sha\} HEAD`/ },
    { name: 'AC1.1 no fix since', re: /no build fix and no review fix has touched an in-scope source file since/ },
    { name: 'AC1.1 skip log', re: /--section "\/review" --status SKIP --step "Step 5 simplify \(skipped\)"/ },
    { name: 'AC1.1 fallback', re: /runs this step as below/ },
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
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The writer's log-decision.js command, run through log-decision's own run() against a
// fixture laid out like tests/bin-lib/log-decision/cli.test.js's fixture()/deps(). Returns
// the decisions.md text run() wrote.
function producerLine(regionText, sha, doc) {
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
      ['--run', runDir, '--section', section, '--status', 'AUTO', '--step', step, '--text', text, '--reversibility', 'n/a'],
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
  let current = null;
  for (const line of decisionsText.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      current = `## ${h[1]}`;
      continue;
    }
    if (current !== '## /build') continue;
    const m = line.match(re);
    if (m) sha = m[1];
  }
  return sha;
}

test('AC1.1: every simplify-pair fact matches exactly once in its region', () => {
  for (const [regionName, facts] of Object.entries(FACTS)) {
    const region = REGIONS[regionName];
    assert.deepStrictEqual(missing(region, facts), [], `${regionName}: missing facts`);
    for (const { name, re } of facts) {
      assert.strictEqual(countMatches(region, re), 1, `${name}: expected exactly one match`);
    }
  }
});

test('AC1.1 go-red: stripping each fact reports exactly that fact', () => {
  for (const [regionName, facts] of Object.entries(FACTS)) {
    const original = REGIONS[regionName];
    for (const { name, re } of facts) {
      const mutated = original.replace(re, '');
      assert.notEqual(mutated, original, `${name}: regex did not match its region`);
      assert.deepStrictEqual(missing(mutated, facts), [name], name);
    }
  }
});

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const SECOND_SHA = 'ffffffffffffffffffffffffffffffffffffffff';

test("AC3.1 twin: review Step 5's selector reads the sha build Common Step 3's command writes", () => {
  const decisions = producerLine(build3, SHA, DOC);
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
