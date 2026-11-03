// tests/dispatch-shipped-candidate-prose.test.js
//
// Pins record #1984's prose wiring: queue-pull-script.md must classify
// shipped candidates (title-only first pass, capped files-based upgrade
// second pass, staged Close proposal) after the #1224 open-PR exclusion and
// before the #1579 cross-PR overlap report; SKILL.md must state the
// False-positive posture and the accepted false negative, and report the
// exclusion the same non-gating way as its siblings. The mechanical half
// (the strong/weak/none tiering, the timeline-mentions extension) is pinned
// separately in tests/bin-lib/issues/shipped-candidate.test.js and
// tests/bin-lib/issues/linked-prs.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { readExclusions } = require('../plugin/bin/lib/dispatch/exclusions');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const QUEUE_PULL = read('plugin/skills/dispatch/queue-pull-script.md');
const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

test('queue-pull-script.md classifies shipped candidates after the #1224 exclusion and before the #1579 report', () => {
  const openPrIdx = QUEUE_PULL.indexOf('#1224: open-linked-PR exclusion');
  const shippedIdx = QUEUE_PULL.indexOf('#1984: shipped-candidate classification');
  const crossPrIdx = QUEUE_PULL.indexOf('#1579: cross-PR root-cause overlap report');
  assert.ok(openPrIdx !== -1 && shippedIdx !== -1 && crossPrIdx !== -1);
  assert.ok(openPrIdx < shippedIdx, 'shipped-candidate classification runs after the open-PR exclusion');
  assert.ok(shippedIdx < crossPrIdx, 'shipped-candidate classification runs before the cross-PR overlap report');
  assert.match(QUEUE_PULL, /classifyShipped/);
});

test('queue-pull-script.md caps the live gh pr view files probe at 5 per pull', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section.slice(0, 4000), /\.slice\(0, 5\)/);
  assert.match(section.slice(0, 4000), /gh pr view "\$PR" --json files/);
});

test('queue-pull-script.md excludes strong-tier candidates from DISPATCH_GROUPS and logs AUTO, weak stays eligible with its own log line', () => {
  assert.match(QUEUE_PULL, /excluded, shipped by merged PR/);
  assert.match(QUEUE_PULL, /without a closing keyword; dispatching anyway/);
});

test('queue-pull-script.md stages a Close proposal for a strong exclusion rather than closing directly', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section, /stage-item\.js/);
  assert.match(section, /## Close \(GitHub\)/);
  assert.doesNotMatch(section.slice(0, section.indexOf('stage-item.js')), /gh issue close \$/);
});

test('SKILL.md states the two-independent-signal false-positive posture and the accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /False-positive posture \(#1984\)/);
  assert.match(DISPATCH_SKILL, /two independent signals, never one alone/);
  assert.match(DISPATCH_SKILL, /residual false negative/);
});

test('SKILL.md queue definition names the shipped-candidate exclusion, and reports it the same non-gating way as its siblings', () => {
  assert.match(DISPATCH_SKILL, /not already shipped by a `strong`-tier merged-PR mention \(#1984\)/);
  assert.match(DISPATCH_SKILL, /Shipped-candidate exclusion report \(refs #1984\)/);
});

test('the cited modules actually export classifyShipped and the extended fetchLinkedPRs', () => {
  const shipped = require('../plugin/bin/lib/issues/shipped-candidate');
  assert.strictEqual(typeof shipped.classifyShipped, 'function');
  const linkedPrs = require('../plugin/bin/lib/issues/linked-prs');
  assert.strictEqual(typeof linkedPrs.fetchLinkedPRs, 'function');
});

test('#4314: both dispatch files state that a mention from a PR already open when the record was filed is skipped', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section.slice(0, 2000), /#4314/);
  assert.match(section.slice(0, 2000), /opened before the record was created/);
  assert.match(DISPATCH_SKILL, /opened before the record was created/);
  assert.match(DISPATCH_SKILL, /#4314/);
});

test('AC5.2: both classifyShipped call sites pass the release time', () => {
  assert.match(QUEUE_PULL, /classifyShipped\(c, mentions, \{ lastReleasedAt: releases\[c\.number\] \}\)/);
  assert.match(QUEUE_PULL, /classifyShipped\(c, mentions, \{ prFiles, lastReleasedAt: releases\[c\.number\] \}\)/);
  assert.match(QUEUE_PULL, /writeReleaseTimes\(process\.argv\[4\], groups\.flat\(\), linkedPRs\)/);
  assert.match(QUEUE_PULL, /readReleaseTimes\(process\.argv\[5\]\)/);
});

test('#4432: a mention predating the release spends no files probe', () => {
  assert.match(QUEUE_PULL, /result\.tier === 'weak' && !result\.signals\.includes\('predates-claim-release'\)/);
});

test('#4432: SKILL.md states the release rule and its accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /#4432/);
  assert.match(DISPATCH_SKILL, /latest claim release/);
  assert.match(DISPATCH_SKILL, /shaping-only release/);
});

test('both queue-pull files stay under the read-limit rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  assert.ok(Buffer.byteLength(QUEUE_PULL) <= RAIL_BYTES);
  assert.ok(Buffer.byteLength(DISPATCH_SKILL) <= RAIL_BYTES);
});

// Extract-and-run of the second pass (anchored like
// tests/dispatch-named-target-exclusion-fixture.test.js): the real snippet, the
// real classifyShipped and exclusions.js, over files on disk. The unquoted
// heredoc expands ${CLAUDE_PLUGIN_ROOT} into a JS string literal, so the plugin
// root is passed with forward slashes.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');
const SECOND_PASS_START = 'if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_EXCLUSIONS" "$DISPATCH_SHIPPED_PR_FILES" "$DISPATCH_SHIPPED_RELEASES" > "${DISPATCH_GROUPS}.tmp" <<NODE_EVAL_EOF';
const SECOND_PASS_END = '  console.log(JSON.stringify(finalGroups));\nNODE_EVAL_EOF';

function extractSecondPass() {
  const startIdx = QUEUE_PULL.indexOf(SECOND_PASS_START);
  assert.notStrictEqual(startIdx, -1, 'second-pass start anchor not found in queue-pull-script.md');
  const endIdx = QUEUE_PULL.indexOf(SECOND_PASS_END, startIdx);
  assert.notStrictEqual(endIdx, -1, 'second-pass end anchor not found in queue-pull-script.md');
  return QUEUE_PULL.slice(startIdx + 'if '.length, endIdx + SECOND_PASS_END.length);
}

// Records 7 (the #4432 shape) and 8 (same PR shape, no release) each have a
// merged mention whose title matches theirs: strong on title evidence alone.
function runSecondPass({ releases }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-shipped-release-'));
  const files = {
    groups: path.join(scratch, 'dispatch-groups.json'),
    linked: path.join(scratch, 'dispatch-linked-prs.json'),
    exclusions: path.join(scratch, 'dispatch-exclusions.json'),
    prFiles: path.join(scratch, 'dispatch-shipped-pr-files.jsonl'),
    releases: path.join(scratch, 'dispatch-shipped-releases.json'),
  };
  const record = (number) => ({ number, title: 'Add widget export command', body: '', createdAt: '2026-09-20T10:00:00.000Z', labels: ['ready'] });
  const mention = { number: 500, merged: true, title: 'Add widget export command', createdAt: '2026-09-25T10:00:00.000Z', mergedAt: '2026-10-01T10:00:00.000Z' };
  fs.writeFileSync(files.groups, JSON.stringify([[record(7), record(8)]]));
  fs.writeFileSync(files.linked, JSON.stringify({ 7: { mentions: [mention] }, 8: { mentions: [mention] } }));
  fs.writeFileSync(files.exclusions, '[]');
  fs.writeFileSync(files.prFiles, '');
  if (releases !== null) fs.writeFileSync(files.releases, JSON.stringify(releases));
  const run = spawnSync('bash', ['-c', extractSecondPass()], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      DISPATCH_GROUPS: files.groups,
      DISPATCH_LINKED_PRS: files.linked,
      DISPATCH_EXCLUSIONS: files.exclusions,
      DISPATCH_SHIPPED_PR_FILES: files.prFiles,
      DISPATCH_SHIPPED_RELEASES: files.releases,
    },
  });
  const finalGroups = run.status === 0 ? JSON.parse(fs.readFileSync(`${files.groups}.tmp`, 'utf8')) : null;
  return { run, finalGroups, exclusions: readExclusions(files.exclusions) };
}

test('AC1.1: the second pass keeps a downgraded record, excludes the unreleased one, and logs the downgrade', () => {
  const { run, finalGroups, exclusions } = runSecondPass({ releases: { 7: '2026-10-02T13:00:00.000Z' } });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.deepStrictEqual(finalGroups.flat().map((c) => c.number), [7]);
  assert.deepStrictEqual(exclusions.map((e) => e.records[0]), [8]);
  assert.match(run.stderr, /#7 kept: merged PR #500 predates claim release at 2026-10-02T13:00:00\.000Z/);
  assert.match(run.stderr, /#8 excluded, shipped by merged PR #500/);
});

test('AC4.1: a missing release-times file leaves the second pass at the prior behavior', () => {
  const { run, finalGroups, exclusions } = runSecondPass({ releases: null });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.deepStrictEqual(finalGroups, []);
  assert.deepStrictEqual(exclusions.map((e) => e.records[0]).sort(), [7, 8]);
});
