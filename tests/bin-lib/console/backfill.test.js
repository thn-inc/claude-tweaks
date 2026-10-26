// tests/bin-lib/console/backfill.test.js — the Review Console backlog backfill's
// work list (#3950): which closed runs are walked (acknowledged consoles
// included), how a legacy decisions.md line splits into one item per finding,
// and the content-derived ids the apply step joins on.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  STAGED_FINDING_RE, enumerateRuns, splitDecisionLine, backfillItemId, itemHashOf, consoleWorkItems, buildWorkList, summarize,
} = require('../../../plugin/bin/lib/console/backfill');
const { digestTextOf } = require('../../../plugin/bin/lib/console/staged-digest-text');
const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
const { writeRunState } = require('../../../plugin/bin/lib/hooks/context');
const { scanUnresolvedConsoles } = require('../../../plugin/bin/lib/hooks/session-residue');
const { runIdOf } = require('../../../plugin/bin/lib/console/resolve');
const { readText } = require('../../helpers/read-skill');

const MAIN_SHA = '0123456789abcdef0123456789abcdef01234567';

const tmpDirs = [];
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });

// A git-initialised root, so wtDetect.mainCheckoutRoot resolves to the fixture.
function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backfill-'));
  tmpDirs.push(root);
  execFileSync('git', ['init', '-q', root]);
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(pipelines, { recursive: true });
  return { root, pipelines };
}

// A closed run: run-state.json written by the real close-run writer.
function mkClosedRun(pipelines, name) {
  const dir = path.join(pipelines, name);
  fs.mkdirSync(dir, { recursive: true });
  const r = closeRunState(dir, { explicit: true });
  assert.strictEqual(r.status, 'closed');
  return dir;
}
function mkLiveRun(pipelines, name) {
  const dir = path.join(pipelines, name);
  fs.mkdirSync(dir, { recursive: true });
  writeRunState(dir, { status: 'active' });
  return dir;
}
function mkArchived(pipelines, name) {
  const dir = path.join(pipelines, 'archive', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function mkConsole(dir, items, extra = {}) {
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true, items, ...extra }));
}
function mkDecisions(dir, lines) {
  fs.writeFileSync(path.join(dir, 'decisions.md'), `# Decisions\n\n${lines.join('\n')}\n`);
}
function mkStaged(dir, name, text) {
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staged', name), text);
}

const sha8 = (line) => crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
const newId = (line) => `decision:${line.slice(2, 60)}#${sha8(line)}`;
const oldId = (line) => `decision:${line.slice(2, 60)}`;
const LOW = 'Low-confidence findings';
const KEEP = (id, section = LOW) => ({ id, section, resolution: 'keep-staged', reason: 'unconfirmed finding — never auto-applied' });
const PENDING = (id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' });

// Real lines, verbatim from archived decisions.md files: BUNDLED from
// archive/2026-10-16T162759-record-3013, COMPOSE_SUBJECT from
// archive/2026-10-16T191151-record-3028, CLAIMLESS the #3772 resolve.js line,
// and the four claim-recovery lines (ruling R5) from other archived runs.
const BUNDLED = '- STAGED 19:29:13 — Step 3 reproduction: lens 3f findings not reproduced (single agent): classify.test.js:81 tests normalizeEntry directly (internal coupling); pr-check-gate-conformance.test.js:77 prose-regex extraction called brittle (note: deepEqual against FAILING_CONCLUSIONS fails loudly on an empty extraction). Staged to Review Console as low-confidence. Reversibility: high.';
const CLAIMLESS = '- STAGED 14:54:55 — log-decision: Reproduction: lens "3c" finding plugin/bin/lib/console/resolve.js:134 not reproduced (present in only one of two reproduction agents). Staged to Review Console as low-confidence. Reversibility: high.';
const COMPOSE_SUBJECT = '- STAGED 22:19:09 — 3: Reproduction: lens 3f findings tests/bin-lib/compose-subject.test.js:454 / tests/bin-lib/compose-subject.test.js:454 share a location but not substance per categorise-reproduction (both describe the realDeps.runner source-line pin); both staged as low-confidence. Direct-verification override not applied: same item as ledger item 4, already triaged leave by the whole-branch review (plan-mandated pin, fails loudly on revert). Reversibility: high.';
const PREFLIGHT = '- STAGED 12:53:49 — Step 3 reproduction: Reproduction: lens 3f finding plugin/bin/preflight-records.js (loadFromRecordsJson) not reproduced — no test pins that the --records-json path skips deps.remoteUrl(). Staged to Review Console as low-confidence. Reversibility: high.';
const EXTRACT = '- STAGED 23:43:03 — log-decision: Reproduction: lens 3b finding plugin/bin/lib/verify/extract.js:572 (a jest log concatenated with a pytest run reads accounted: summaryDialect ignores pytest FAILED/banner lines, probed by the agent returning 0) not reproduced. Staged to Review Console as low-confidence. Open choice: treat pytest markers as a third ambiguous dialect (null) vs accept — multi-runner logs are not a documented check shape. Reversibility: high.';
const EXCLUSIONS = '- STAGED 21:02:21 — log-decision: Reproduction: lens "3c" finding plugin/bin/lib/dispatch/exclusions.js:15 (readExclusions silently degrades malformed JSON to [] with no logging) not reproduced (agent A: no findings). Staged to Review Console as low-confidence. Reversibility: high.';
const PR_CHECK = '- STAGED 15:01:08 — log-decision: Reproduction: lens "3f" findings tests/pr-check-gate-conformance.test.js:106 (low, classifyRollup loop overlaps tests/bin-lib/pr-checks/classify.test.js:79-88) and plugin/skills/_shared/pr-check-gate.md:15 (info, new StatusContext sentence in the shared gate not pinned) not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
// Synthetic lines.
const SINGLE = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/residue.js:40 not reproduced (single agent): the missing split ignores ids that carry a slash. Staged to Review Console as low-confidence. Reversibility: high.';
const MIXED = '- STAGED 10:30:00 — Reproduction: lens "3c" findings plugin/bin/a.js:1 (single agent) / plugin/bin/b.js:2 the writer skips its atomic rename step. Staged to Review Console as low-confidence.';

test('AC2.1: an acknowledged console holding keep-staged items is walked', () => {
  const { pipelines } = fixtureRoot();
  const run = mkClosedRun(pipelines, '2026-10-20T100000-spec-1');
  mkDecisions(run, [SINGLE]);
  mkConsole(run, [KEEP(newId(SINGLE))], { residueAcknowledgedAt: '2026-10-21T00:00:00.000Z' });
  const wl = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.strictEqual(wl.mainSha, MAIN_SHA);
  assert.strictEqual(wl.runs[0].runDir, run);
  assert.strictEqual(wl.runs[0].items.length, 1);
});

test('AC2.2: scanUnresolvedConsoles skips that same console', () => {
  const { root, pipelines } = fixtureRoot();
  const run = mkClosedRun(pipelines, '2026-10-20T100000-spec-1');
  mkDecisions(run, [SINGLE]);
  mkConsole(run, [KEEP(newId(SINGLE))]);
  assert.strictEqual(scanUnresolvedConsoles(root, { limit: Infinity, window: Infinity }).runs.length, 1, 'precondition: the scan resolves to this fixture');
  mkConsole(run, [KEEP(newId(SINGLE))], { residueAcknowledgedAt: '2026-10-21T00:00:00.000Z' });
  assert.strictEqual(scanUnresolvedConsoles(root, { limit: Infinity, window: Infinity }).runs.length, 0);
  assert.strictEqual(buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0].items.length, 1);
});

test('AC3.1: a bundled line yields one work item per finding', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T162759-record-3013');
  mkDecisions(run, [BUNDLED]);
  mkConsole(run, [KEEP(newId(BUNDLED))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => i.kind), ['finding', 'finding']);
  assert.deepStrictEqual(items.map((i) => i.finding.path), ['classify.test.js', 'pr-check-gate-conformance.test.js']);
  assert.deepStrictEqual(items.map((i) => i.finding.line), [81, 77]);
  assert.deepStrictEqual(items.map((i) => i.finding.lens), ['3f', '3f']);
  assert.notStrictEqual(items[0].itemId, items[1].itemId);
  assert.match(items[0].itemId, /^bf:[0-9a-f]{16}$/);
  assert.strictEqual(items[0].bundleLine, BUNDLED);
  assert.match(items[0].claimText, /tests normalizeEntry directly/);
});

test('AC3.2: two lines sharing their first 58 characters yield distinct ids', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-2');
  const a = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced (single agent): the alpha reader drops a trailing newline. Staged to Review Console as low-confidence.';
  const b = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/beta.js:20 not reproduced (single agent): the beta writer skips its atomic rename step. Staged to Review Console as low-confidence.';
  assert.strictEqual(a.slice(2, 60), b.slice(2, 60), 'precondition: one old-shape id covers both lines');
  mkDecisions(run, [a, b]);
  mkConsole(run, [KEEP(oldId(a)), KEEP(oldId(b))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.strictEqual(items.length, 2);
  assert.notStrictEqual(items[0].itemId, items[1].itemId);
});

test('AC3.2b: a repeated location in one line yields distinct ids', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T191151-record-3028');
  mkDecisions(run, [COMPOSE_SUBJECT]);
  mkConsole(run, [KEEP(newId(COMPOSE_SUBJECT))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => [i.kind, i.noClaimReason]), [['no-claim', 'claim-empty'], ['finding', undefined]]);
  assert.strictEqual(`${items[1].finding.path}:${items[1].finding.line}`, 'tests/bin-lib/compose-subject.test.js:454');
  assert.notStrictEqual(items[0].itemId, items[1].itemId);
});

test('a mixed line yields one finding item and one no-claim item, each with its own id', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-3');
  mkDecisions(run, [MIXED]);
  mkConsole(run, [KEEP(newId(MIXED))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => i.kind), ['no-claim', 'finding']);
  assert.strictEqual(items[0].noClaimReason, 'claim-empty');
  assert.strictEqual(items[0].itemId, backfillItemId({ runId: runIdOf(run), sourceKey: MIXED, findingKey: '3c|plugin/bin/a.js:1@0' }));
  assert.strictEqual(items[1].claimText, 'the writer skips its atomic rename step.');
  assert.ok(items.every((i) => i.kind !== 'finding' || i.claimText !== ''));
  // Leading punctuation left by a dropped parenthetical is stripped.
  assert.strictEqual(splitDecisionLine(SINGLE).findings[0].claim, 'the missing split ignores ids that carry a slash.');
});

test('R5a: text after an opening parenthetical is kept in the claim', () => {
  const [f] = splitDecisionLine(PREFLIGHT).findings;
  assert.strictEqual(f.path, 'plugin/bin/preflight-records.js');
  assert.strictEqual(f.line, null);
  assert.ok(f.claim.includes('no test pins that the --records-json path skips deps.remoteUrl()'), f.claim);
});

test('R5b: a parenthetical is dropped only when reproduction meta leaves fewer than 3 words', () => {
  const [extract] = splitDecisionLine(EXTRACT).findings;
  assert.ok(extract.claim.startsWith('(a jest log concatenated with a pytest run'), extract.claim);
  assert.ok(!/\bagent\b/.test(extract.claim), extract.claim);
  const [excl] = splitDecisionLine(EXCLUSIONS).findings;
  // R17 rule 4 unwraps a claim that is one parenthetical (and drops its lone trailing ` .`).
  assert.strictEqual(excl.claim, 'readExclusions silently degrades malformed JSON to [] with no logging');
  assert.deepStrictEqual(splitDecisionLine(CLAIMLESS), { findings: [], noClaim: 'claim-empty' });
});

test('R5c: low-confidence is never severity low', () => {
  const { findings } = splitDecisionLine(COMPOSE_SUBJECT);
  assert.strictEqual(findings[1].severity, null);
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T191151-record-3028');
  mkDecisions(run, [COMPOSE_SUBJECT]);
  mkConsole(run, [KEEP(newId(COMPOSE_SUBJECT))]);
  assert.strictEqual(buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0].items[1].finding.reporterSeverity, 'medium');
});

test('R5d: a location inside a parenthetical or a continuing range is not a split point', () => {
  const { findings } = splitDecisionLine(PR_CHECK);
  assert.deepStrictEqual(findings.map((f) => [f.path, f.line, f.severity]), [
    ['tests/pr-check-gate-conformance.test.js', 106, 'low'], ['plugin/skills/_shared/pr-check-gate.md', 15, 'info'],
  ]);
  assert.ok(findings[0].claim.includes('classify.test.js:79-88'), findings[0].claim);
  const range = '- STAGED 10:00:00 — Reproduction: lens "3f" finding tests/a.test.js:12 duplicates the loop that already overlaps tests/b.test.js:79-88 entirely. Staged to Review Console as low-confidence.';
  const split = splitDecisionLine(range).findings;
  assert.strictEqual(split.length, 1);
  assert.ok(split[0].claim.includes('tests/b.test.js:79-88'), split[0].claim);
});

test('AC4.1: a finding with no recoverable claim is a no-claim item', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-19T000000-spec-4');
  mkDecisions(run, [CLAIMLESS]);
  mkConsole(run, [KEEP(newId(CLAIMLESS))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].kind, 'no-claim');
  assert.strictEqual(items[0].noClaimReason, 'claim-empty');
  assert.deepStrictEqual(splitDecisionLine(CLAIMLESS), { findings: [], noClaim: 'claim-empty' });
});

test('no-claim reasons are distinguishable', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-19T000000-spec-5');
  const noPath = '- STAGED 10:00:00 — Reproduction: lens "3c" finding in the console template not reproduced (single agent): the merge row omits its reason column entirely. Staged to Review Console as low-confidence.';
  mkDecisions(run, [noPath]);
  mkConsole(run, [KEEP(newId(noPath)), KEEP('decision:STAGED 09:00:00 — no such line was ever logged here at all'), PENDING('review-unconfirmed-9.md')]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => [i.kind, i.noClaimReason]), [
    ['no-claim', 'no-path'], ['no-claim', 'source-line-not-found'], ['no-claim', 'staged-file-absent'],
  ]);
});

test('work items: a duplicated old-shape id group becomes one bundle', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-6');
  const a = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced (single agent): the alpha reader drops a trailing newline. Staged to Review Console as low-confidence.';
  const b = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/beta.js:20 not reproduced (single agent): the beta writer skips its atomic rename step. Staged to Review Console as low-confidence.';
  mkDecisions(run, [a, b]);
  mkConsole(run, [KEEP(oldId(a)), KEEP(oldId(a)), KEEP(oldId(a))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.strictEqual(items.length, 2);
  for (const it of items) assert.deepStrictEqual(it.storedIndices, [0, 1, 2]);
  assert.strictEqual(items[0].itemHash, items[1].itemHash);
  assert.match(items[0].itemHash, /^[0-9a-f]{64}$/);
});

test('ids are deterministic', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T162759-record-3013');
  mkDecisions(run, [BUNDLED, CLAIMLESS]);
  mkStaged(run, 'zz-1.md', 'zz');
  mkConsole(run, [KEEP(newId(BUNDLED)), KEEP(newId(CLAIMLESS)), PENDING('zz-1.md')]);
  const first = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.deepStrictEqual(buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }), first);
  assert.strictEqual(first.runs[0].items[0].itemId, backfillItemId({ runId: runIdOf(run), sourceKey: BUNDLED, findingKey: '3f|classify.test.js:81@0' }));
});

test('staged finding file parses lens, path, line and claim', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-20T000000-spec-3351');
  const text = '# Unconfirmed finding\n\nFinding: no test pins the degraded-field envelope for an empty records list\nSeverity: low\nLens: 3c\nTarget: tests/bin-lib/preflight-records/preflight-records.test.js\n';
  mkStaged(run, 'review-unconfirmed-1.md', text);
  mkConsole(run, [KEEP('review-unconfirmed-1.md')]);
  const [item] = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0].items;
  assert.ok(STAGED_FINDING_RE.test('review-unconfirmed-1.md'));
  assert.strictEqual(item.kind, 'finding');
  assert.deepStrictEqual(item.finding, { lens: '3c', path: 'tests/bin-lib/preflight-records/preflight-records.test.js', line: null, reporterSeverity: 'low', kind: 'unconfirmed' });
  assert.strictEqual(item.claimText, 'no test pins the degraded-field envelope for an empty records list');
  assert.deepStrictEqual(item.stagedFinding, { title: null, body: text.trim(), severity: 'low' });
  assert.deepStrictEqual(item.storedIndices, [0]);
});

test('staged-kind items carry classifyStagedItem\'s result', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-20T000000-spec-7');
  mkStaged(run, 'reflect-1.md', '**Category:** observation\n\nThe ledger grew.\n');
  mkStaged(run, 'zz-1.md', 'zz\n');
  mkStaged(run, 'x-1.md', 'same bytes\n');
  mkStaged(run, 'x-1.md.shadow-dup', 'same bytes\n');
  mkConsole(run, [PENDING('reflect-1.md'), PENDING('zz-1.md'), PENDING('x-1.md.shadow-dup'), PENDING('docs:CLAUDE.md')]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => i.kind), ['staged-kind', 'staged-kind', 'staged-kind', 'staged-kind']);
  assert.deepStrictEqual(items[0].staged, { name: 'reflect-1.md', section: 'Skill updates' });
  assert.strictEqual(items[1].staged.reason, 'unmapped-prefix');
  assert.strictEqual(items[2].staged.outcome, 'shadow-dup-duplicate');
  assert.deepStrictEqual(items[3].staged, { name: 'docs:CLAUDE.md', section: 'Pending review', reason: 'engine-row' });
});

test('a tiebreak: item takes its finding from the verdict line and its claim from review-findings.json', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-22T000000-spec-8');
  const verdict = '- STAGED 12:00:00 — Tiebreak tiebreak:abcdef012345: lens "3c" finding plugin/x.js:12 console: verdict:cant-tell. Severity: high. Recommendation: file.';
  mkDecisions(run, [verdict]);
  fs.writeFileSync(path.join(run, 'review-findings.json'), JSON.stringify([{ id: 'abcdef012345', lens: '3c', path: 'plugin/x.js', line: 12, claim: 'the guard reads a stale value' }]));
  mkConsole(run, [KEEP('tiebreak:abcdef012345'), KEEP('tiebreak:000000000000')]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items[0].finding, { lens: '3c', path: 'plugin/x.js', line: 12, reporterSeverity: 'high', kind: 'unconfirmed' });
  assert.strictEqual(items[0].claimText, 'the guard reads a stale value');
  assert.strictEqual(items[1].kind, 'no-claim');
});

test('a bf: item persisted by an earlier apply re-splits to its own finding', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T162759-record-3013');
  mkDecisions(run, [BUNDLED]);
  mkConsole(run, [KEEP(newId(BUNDLED))]);
  const [, second] = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0].items;
  const stored = [{ id: 'docs:x', section: 'Documentation updates', resolution: 'approve', reason: 'r' }, { ...KEEP(second.itemId), backfillSource: BUNDLED }];
  mkConsole(run, stored);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].itemId, second.itemId);
  assert.strictEqual(items[0].finding.path, 'pr-check-gate-conformance.test.js');
  assert.deepStrictEqual(items[0].storedIndices, [1]);
  assert.strictEqual(items[0].itemHash, itemHashOf([stored[1]]));
});

test('a bf: item with no backfillSource is a source-line-not-found no-claim item', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-15');
  mkConsole(run, [KEEP('bf:0123456789abcdef')]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => [i.itemId, i.kind, i.noClaimReason]), [['bf:0123456789abcdef', 'no-claim', 'source-line-not-found']]);
});

test('old-shape matching skips tiebreak verdict lines and lines naming a staged file that exists', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-16');
  const named = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced, see staged/review-unconfirmed-1.md for the alpha reader claim.';
  const plain = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced (single agent): the alpha reader drops a trailing newline.';
  const verdict = '- STAGED 12:00:00 — Tiebreak tiebreak:abcdef012345: lens "3c" finding plugin/x.js:12 console: verdict:cant-tell. Severity: high. Recommendation: file.';
  assert.strictEqual(named.slice(2, 60), plain.slice(2, 60), 'precondition: one old-shape id covers both lines');
  mkDecisions(run, [named, plain, verdict]);
  mkStaged(run, 'review-unconfirmed-1.md', 'Finding: the alpha reader drops a trailing newline\nTarget: plugin/bin/lib/console/alpha.js:10\n');
  mkConsole(run, [KEEP(oldId(plain)), KEEP(oldId(verdict))]);
  const { items } = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA }).runs[0];
  assert.deepStrictEqual(items.map((i) => [i.kind, i.bundleLine || i.noClaimReason]), [['finding', plain], ['no-claim', 'source-line-not-found']]);
});

test('a review-findings.json that exists but cannot be parsed makes its console unreadable', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-16T000000-spec-17');
  mkDecisions(run, [SINGLE]);
  mkConsole(run, [KEEP(newId(SINGLE))]);
  fs.writeFileSync(path.join(run, 'review-findings.json'), '{bad');
  const wl = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.deepStrictEqual(wl.unreadable, [path.join(run, 'review-findings.json')]);
  assert.deepStrictEqual(wl.runs[0].items, []);
});

test('live runs are reported and skipped', () => {
  const { pipelines } = fixtureRoot();
  const run = mkLiveRun(pipelines, '2026-10-23T000000-spec-9');
  mkDecisions(run, [SINGLE]);
  mkConsole(run, [KEEP(newId(SINGLE))]);
  const wl = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.deepStrictEqual(wl.live, [{ runDir: run, status: 'active' }]);
  assert.deepStrictEqual(wl.runs, []);
});

test('an archive twin stands in for a non-clean top-level copy', () => {
  const { pipelines } = fixtureRoot();
  const top = mkLiveRun(pipelines, '2026-10-23T000000-spec-10');
  const twin = mkArchived(pipelines, '2026-10-23T000000-spec-10');
  mkDecisions(twin, [SINGLE]);
  mkConsole(twin, [KEEP(newId(SINGLE))]);
  const wl = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.deepStrictEqual(wl.runs.map((r) => r.runDir), [twin]);
  assert.strictEqual(wl.runs[0].items.length, 1);
  assert.deepStrictEqual(enumerateRuns(pipelines), { closed: [twin], live: [{ runDir: top, status: 'active' }] });
});

test('unreadable console.json emits no items', () => {
  const { pipelines } = fixtureRoot();
  const a = mkArchived(pipelines, '2026-10-01T000000-spec-11');
  const b = mkArchived(pipelines, '2026-10-02T000000-spec-12');
  fs.writeFileSync(path.join(a, 'console.json'), '{not json');
  fs.writeFileSync(path.join(b, 'console.json'), 'null');
  const c = mkArchived(pipelines, '2026-10-03T000000-spec-18');
  fs.mkdirSync(path.join(c, 'console.json')); // present but not a file: unreadable, never "no console"
  const wl = buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA });
  assert.deepStrictEqual(wl.unreadable.sort(), [path.join(a, 'console.json'), path.join(b, 'console.json'), path.join(c, 'console.json')]);
  assert.strictEqual(wl.runs.reduce((n, r) => n + r.items.length, 0), 0);
});

// R14a: a no-claim item that stands for a located finding keeps the location. I1: an id is keyed by
// location only (`{lens}|{path}:{line}@{occurrence}`), so the ids below — generated by the I1
// derivation — fail here on any drift, and no claim-heuristic change can move them.
const LOCATED = '- STAGED 01:25:25 — Reproduction: lens "3a" finding plugin/skills/_shared/materiality-floor.md:94 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
const MULTI = '- STAGED 00:58:05 — log-decision: Reproduction: lens "3f" findings plugin/bin/lib/worktree/remote-branch-collision.js:168 and plugin/skills/build/adopted-branch-collision.md:12 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
const MIXED_CLAIMS = '- STAGED 10:30:00 — Reproduction: lens "3c" findings plugin/bin/a.js:1 (single agent) / plugin/bin/b.js:2 the writer skips its atomic rename step. Staged to Review Console as low-confidence.';
const PRE_CHANGE_IDS = {
  LOCATED: ['bf:a6ec4d971097debf'],
  CLAIMLESS: ['bf:a272e71726bef8b9'],
  MULTI: ['bf:df35b8ac365d9c6e'],
  MIXED_CLAIMS: ['bf:3b393a2c39ffb39f', 'bf:abfbd9af8a3114b3'],
  SINGLE: ['bf:a84254b5bd346744'],
};

function itemsForLine(line) {
  const RUN = '2026-10-24T090000-record-1';
  return consoleWorkItems({
    consoleDir: `/x/${RUN}`,
    consoleJson: { items: [KEEP(newId(line))] },
    decisions: `# D\n\n${line}\n`,
    readStaged: () => null,
    runId: RUN,
  });
}

test('R14a: item ids are byte-identical to the pinned derivation', () => {
  const lines = { LOCATED, CLAIMLESS, MULTI, MIXED_CLAIMS, SINGLE };
  for (const [name, line] of Object.entries(lines)) {
    assert.deepStrictEqual(itemsForLine(line).map((i) => i.itemId), PRE_CHANGE_IDS[name], name);
  }
});

test('I1: a split id is keyed by location only — never by claim emptiness or the split-point index', () => {
  const RUN = '2026-10-24T090000-record-1';
  const key = (line, findingKey) => backfillItemId({ runId: RUN, sourceKey: line, findingKey });
  // A line whose every claim is empty is one item, keyed as its first finding would be with a claim.
  assert.deepStrictEqual(itemsForLine(LOCATED).map((i) => i.itemId), [key(LOCATED, '3a|plugin/skills/_shared/materiality-floor.md:94@0')]);
  // A claim-empty member and a claimed member are keyed alike.
  assert.deepStrictEqual(itemsForLine(MIXED_CLAIMS).map((i) => i.itemId), [key(MIXED_CLAIMS, '3c|plugin/bin/a.js:1@0'), key(MIXED_CLAIMS, '3c|plugin/bin/b.js:2@0')]);
  // A repeated path:line is told apart by its occurrence in the line.
  assert.deepStrictEqual(itemsForLine(COMPOSE_SUBJECT).map((i) => i.itemId), [
    key(COMPOSE_SUBJECT, '3f|tests/bin-lib/compose-subject.test.js:454@0'), key(COMPOSE_SUBJECT, '3f|tests/bin-lib/compose-subject.test.js:454@1'),
  ]);
  // A line with no path is keyed by the line alone.
  const noPath = '- STAGED 10:00:00 — Reproduction: lens "3c" finding in the console template not reproduced (single agent): the merge row omits its reason column entirely. Staged to Review Console as low-confidence.';
  assert.deepStrictEqual(itemsForLine(noPath).map((i) => i.itemId), [key(noPath, '')]);
});

test('I1: a legacy persisted sibling with no backfillFinding whose re-split misses is split-drift, routed to the tiebreak', () => {
  const RUN = '2026-10-24T090000-record-1';
  const legacy = (backfillSource) => consoleWorkItems({
    consoleDir: `/x/${RUN}`, consoleJson: { items: [{ ...KEEP('bf:0123456789abcdef'), backfillSource }] }, decisions: '', readStaged: () => null, runId: RUN,
  });
  const [drift] = legacy(BUNDLED);
  assert.deepStrictEqual([drift.itemId, drift.kind, drift.noClaimReason], ['bf:0123456789abcdef', 'finding', 'split-drift']);
  assert.deepStrictEqual(drift.finding, { lens: '3f', path: 'classify.test.js', line: 81, reporterSeverity: 'medium', kind: 'unconfirmed' }, 'the line\'s first location');
  assert.ok(drift.claimText.includes('tests normalizeEntry directly') && drift.claimText.includes('prose-regex extraction called brittle'), drift.claimText);
  assert.ok(!/STAGED|19:29:13/.test(drift.claimText), 'the log prefix is not claim text');
  assert.strictEqual(drift.bundleLine, BUNDLED);
  // A line naming no location at all cannot be judged: a no-claim split-drift item, still never source-line-not-found.
  const noPath = '- STAGED 10:00:00 — Reproduction: lens "3c" finding in the console template not reproduced (single agent): the merge row omits its reason column entirely.';
  assert.deepStrictEqual(legacy(noPath).map((i) => [i.kind, i.noClaimReason]), [['no-claim', 'split-drift']]);
});

test('R14a: a claim-empty no-claim item keeps the location its decision line names', () => {
  const [one] = itemsForLine(LOCATED);
  assert.strictEqual(one.kind, 'no-claim');
  assert.strictEqual(one.noClaimReason, 'claim-empty');
  assert.deepStrictEqual(one.finding, { lens: '3a', path: 'plugin/skills/_shared/materiality-floor.md', line: 94 });
  assert.strictEqual(one.claimText, undefined, 'a no-claim item carries no claim');

  const [multi] = itemsForLine(MULTI);
  assert.deepStrictEqual(multi.locations.map((l) => [l.path, l.line]), [['plugin/bin/lib/worktree/remote-branch-collision.js', 168], ['plugin/skills/build/adopted-branch-collision.md', 12]]);
  assert.deepStrictEqual(multi.finding, multi.locations[0]);

  const [empty, claimed] = itemsForLine(MIXED_CLAIMS);
  assert.deepStrictEqual([empty.kind, claimed.kind], ['no-claim', 'finding']);
  assert.deepStrictEqual(empty.finding, { lens: '3c', path: 'plugin/bin/a.js', line: 1 }, 'the claim-empty member of a mixed line keeps its own location');
});

test('R14a: a line with no path stays locationless', () => {
  const noPath = '- STAGED 10:00:00 — Reproduction: lens "3c" finding in the console template not reproduced (single agent): the merge row omits its reason column entirely. Staged to Review Console as low-confidence.';
  const [item] = itemsForLine(noPath);
  assert.strictEqual(item.noClaimReason, 'no-path');
  assert.strictEqual(item.finding, undefined);
});

// R17: a claim is never the producer's own note. Verbatim real lines from the acceptance run's
// decisions.md files (the ones the earlier cleaning left boilerplate, ledger-row refs or location
// fragments in).
const R17_LEDGER_ONLY = '- STAGED 11:23:36 — log-decision: Reproduction: lens "3a" finding plugin/bin/lib/hooks/teardown-run.js:312 not reproduced. Staged to Review Console as low-confidence (ledger row 11). Reversibility: high. Reversibility: high.';
const R17_RESIDUE = '- STAGED 06:21:45 — log-decision: Reproduction: lens "3c" findings plugin/bin/lib/reconcile/ledger-residue.js:316 / :335 / :411 / :185 / :221 and plugin/bin/lib/reconcile/index.js:429 not reproduced (failure causes are reduced to a reason code; network-failure is quiet for non-network gh errors; no try/catch around the ledgerResidue call, matching prune-remote). Staged to Review Console as low-confidence. Reversibility: high. Reversibility: high.';
const R17_COLON = '- STAGED 13:49:40 — Step 3 reproduction: lens "3b" finding plugin/skills/release/bookkeeping.md:28 not reproduced. Staged to Review Console as low-confidence: Shipped-comment check unfiltered — already listed exempt in PR #3385 inventory; no action. Reversibility: high.';
const R17_PAREN_ONLY = '- STAGED 00:57:58 — log-decision: Reproduction: lens "3b" finding plugin/skills/build/adopted-branch-collision-check.md:44 not reproduced. Staged to Review Console as low-confidence (records parse of empty string yields [0]; already ledger row 6, deferred). Reversibility: high.';
const R17_DOC_RULE = '- STAGED 23:02:56 — Step 3 lens 3f: Reproduction: lens "3f" finding docs/plugin-structure.md:169 (docs rule has no test) not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
const R17_RANGE = '- STAGED 13:49:40 — Step 3 reproduction: lens "3f" finding tests/comment-trust-conformance.test.js:125-133 not reproduced. Staged to Review Console as low-confidence: states-the-fixed-facts pin uses generic tokens (missing/viewer) and has no go-red control — both agents, lines ±2, substance near. Reversibility: high.';
const R17_SLASH = '- STAGED 13:49:40 — Step 3 reproduction: lens "3a+3b" finding plugin/skills/tidy/scan-procedures.md:122/127 not reproduced. Staged to Review Console as low-confidence: unrelated prose trims — mandated by tests/release-lifecycle-byte-budget.test.js (net-zero-or-shrink); build ruling T4; no action. Reversibility: high.';
const R17_AND = '- STAGED 00:58:04 — log-decision: Reproduction: lens "3c" findings plugin/bin/lib/worktree/remote-branch-collision.js:179 and :134 not reproduced. Staged to Review Console as low-confidence (findPrsForBranch parsed JSON not array-checked; widened --json field list degrades stop-card PR context on an old gh, already ledger row 12). Reversibility: high.';
const R17_SLASH_COLON = '- STAGED 00:58:00 — log-decision: Reproduction: lens "3b" findings plugin/bin/lib/worktree/remote-branch-collision.js:146 / :147 share a location but not substance by score; both staged. Staged to Review Console as low-confidence (closingIssuesReferences matched on number only, repository not compared; needs write access to exploit). Reversibility: high.';
const R17_LIST = '- STAGED 02:06:13 — log-decision: Reproduction: lens 3f findings tests/ledger-pipe-escape-rule-conformance.test.js:27 / :29 / :31 (citer list hard-coded to three writers, cite check is substring co-occurrence), tests/bin-lib/wrap-up/pack.test.js:832 (second parseLedger case also passes pre-change; the pre-change run in a scratch copy confirmed only the Item-pipe case fails), plugin/bin/lib/wrap-up/ledger-write.js:114-115 (no raw-pipe-in-Resolution or CLI-level legacy-row refusal test) share locations across the pair but not substance; staged to Review Console as low-confidence. Reversibility: high.';
const R17_LOWER = '- STAGED 22:55:22 — log-decision: Reproduction: lens "3b" finding plugin/bin/lib/health-core/materiality-digest.js:83 not reproduced (string input trusted, low). Direct read: local-files single-writer string is trusted by design; staged to Review Console as low-confidence. Reversibility: high.';
const R17_DASH = '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:39 (older gh builds reject an unknown --json field, no version fallback) not reproduced. Staged to Review Console as low-confidence — not elevated: the reviewing pass did not verify which gh version introduced closingIssuesReferences. Reversibility: high.';
const R17_LEDGER_IN_PAREN = '- STAGED 22:18:43 — Reproduction: lens "3f" finding tests/bin-lib/compose-subject.test.js:366 not reproduced (three hand-built deps literals carry the two policy-reader stubs; a future literal without them throws a TypeError). Staged to Review Console as low-confidence — SDD ruling already recorded (ledger row 4: explicit deps over a silent fallback). Info-severity rows dropped below the floor: AC3.1/neither-flag test overlap, provenance-bearing test titles, GIT_TIMEOUT_MS wording vs gh-api-module-pattern (ledgered as a review/skill row instead). Reversibility: high.';
const R17_CASE_REF = '- STAGED 13:49:40 — Step 3 reproduction: lens "3f" finding plugin/bin/lib/issues/comment-trust.js:72 not reproduced. Staged to Review Console as low-confidence: untrustedJqNote() prints "()" for an empty-string authorAssociation and "null" for a missing url where the JS prints "no association"/"unknown" (GitHub never sends an empty association; url case = ledger row 14). Reversibility: high.';

test('R17: a line whose only claim text is the staging note and a ledger-row ref is claim-empty', () => {
  assert.deepStrictEqual(splitDecisionLine(R17_LEDGER_ONLY), { findings: [], noClaim: 'claim-empty' });
});

test('R17: a leading location-continuation list is not a claim, and the next finding keeps its own', () => {
  const { findings } = splitDecisionLine(R17_RESIDUE);
  assert.deepStrictEqual(findings.map((f) => [f.path, f.line, f.claim === '' ? 'empty' : 'claim']), [
    ['plugin/bin/lib/reconcile/ledger-residue.js', 316, 'empty'], ['plugin/bin/lib/reconcile/index.js', 429, 'claim'],
  ]);
  assert.ok(findings[1].claim.startsWith('failure causes are reduced to a reason code'), findings[1].claim);
  const [empty, claimed] = itemsForLine(R17_RESIDUE);
  assert.deepStrictEqual([empty.kind, empty.noClaimReason, claimed.kind], ['no-claim', 'claim-empty', 'finding']);
});

test('R17: the staging note is removed in every punctuation and case, keeping the text after it', () => {
  assert.strictEqual(splitDecisionLine(R17_COLON).findings[0].claim, 'Shipped-comment check unfiltered — already listed exempt in PR #3385 inventory; no action.');
  assert.ok(splitDecisionLine(R17_RANGE).findings[0].claim.startsWith('states-the-fixed-facts pin uses generic tokens'));
  assert.ok(splitDecisionLine(R17_DASH).findings[0].claim.endsWith('not elevated: the reviewing pass did not verify which gh version introduced closingIssuesReferences.'));
  // Lowercase, mid-sentence, after a `;`.
  assert.strictEqual(splitDecisionLine(R17_LOWER).findings[0].claim, '(string input trusted, low). Direct read: local-files single-writer string is trusted by design');
  // `both staged as low-confidence`.
  for (const f of splitDecisionLine(COMPOSE_SUBJECT).findings) assert.ok(!/staged as low-confidence/i.test(f.claim), f.claim);
  assert.ok(splitDecisionLine(COMPOSE_SUBJECT).findings[1].claim.includes('Direct-verification override not applied'));
});

test('R17: a claim that is exactly one parenthetical is unwrapped, with no note or ledger-row text', () => {
  const [f] = splitDecisionLine(R17_PAREN_ONLY).findings;
  assert.strictEqual(f.claim, 'records parse of empty string yields [0]; deferred');
  assert.ok(!/Staged to Review Console/i.test(f.claim) && !/ledger row/i.test(f.claim), f.claim);
  assert.strictEqual(splitDecisionLine(R17_DOC_RULE).findings[0].claim, 'docs rule has no test');
  assert.strictEqual(splitDecisionLine(R17_AND).findings[0].claim, 'findPrsForBranch parsed JSON not array-checked; widened --json field list degrades stop-card PR context on an old gh');
});

test('R17: a ledger-row ref inside a longer parenthetical is removed and the rest kept', () => {
  const [f] = splitDecisionLine(R17_LEDGER_IN_PAREN).findings;
  assert.ok(f.claim.includes('SDD ruling already recorded (explicit deps over a silent fallback)'), f.claim);
  assert.ok(!/ledger row/i.test(f.claim), f.claim);
  const [g] = splitDecisionLine(R17_CASE_REF).findings;
  assert.ok(g.claim.endsWith('(GitHub never sends an empty association).'), g.claim);
});

test('R17: a claim never starts with a bare line ref, a separator or `and`', () => {
  for (const line of [R17_RANGE, R17_SLASH, R17_AND, R17_SLASH_COLON, R17_LIST]) {
    for (const f of splitDecisionLine(line).findings) assert.ok(f.claim === '' || /^[A-Za-z(]/.test(f.claim), f.claim);
  }
  assert.ok(splitDecisionLine(R17_SLASH).findings[0].claim.startsWith('unrelated prose trims'));
  assert.ok(splitDecisionLine(R17_SLASH_COLON).findings[0].claim.startsWith('share a location but not substance'));
  assert.ok(splitDecisionLine(R17_LIST).findings[0].claim.startsWith('citer list hard-coded'));
  assert.ok(splitDecisionLine(R17_AND).findings[0].claim.startsWith('findPrsForBranch'));
});

// Ids derived by the I1 (location-keyed) backfill.js for these lines under the run id of itemsForLine.
// A claim change never moves an id; a line whose every finding became claim-empty is one no-claim
// item keyed by its first location, exactly as CLAIMLESS is.
const R17_PRE_CHANGE_IDS = [
  [R17_RESIDUE, ['bf:0623be9cd62e5148', 'bf:991d165a715ace18']],
  [R17_PAREN_ONLY, ['bf:17843a99190bc07d']],
  [R17_SLASH_COLON, ['bf:944ee1270fc9d869']],
  [R17_AND, ['bf:c7753b2e8ce5dd37']],
  [R17_DOC_RULE, ['bf:d7ecbb8652708c0b']],
  [R17_RANGE, ['bf:d33c6dd161b22818']],
  [R17_SLASH, ['bf:62e0c8aee171e4c9']],
  [R17_COLON, ['bf:fd0574e08ca84155']],
  // Minor 2 made `ledger-write.js:114-115` (set off by `), `) a finding of its own: one id added, the other two unmoved.
  [R17_LIST, ['bf:5b19edfcb6933609', 'bf:d396a083d40135eb', 'bf:193d16d921e074e3']],
];

test('R17: item ids are byte-identical to the pinned derivation', () => {
  for (const [line, ids] of R17_PRE_CHANGE_IDS) assert.deepStrictEqual(itemsForLine(line).map((i) => i.itemId), ids, line.slice(0, 60));
  const RUN = '2026-10-24T090000-record-1';
  assert.deepStrictEqual(itemsForLine(R17_LEDGER_ONLY).map((i) => [i.kind, i.noClaimReason, i.itemId]), [['no-claim', 'claim-empty', backfillItemId({ runId: RUN, sourceKey: R17_LEDGER_ONLY, findingKey: '3a|plugin/bin/lib/hooks/teardown-run.js:312@0' })]]);
});

// R17 round 2: a trailing clause outside parentheses that only points at the ledger is meta.
const R17_LEDGER_TAIL = '- STAGED 13:49:40 — Step 3 reproduction: lens "3f" finding plugin/bin/hooks.js:1211 not reproduced. Staged to Review Console as low-confidence: resolve-console success stdout path (renderExecutedLines) has no CLI-level test — ledger row 8. Reversibility: high.';
const R17_LEDGER_SAME_AS = '- STAGED 13:49:40 — Step 3 reproduction: lens "3b" finding plugin/bin/lib/wrap-up/engine-verify.js:786 not reproduced. Staged to Review Console as low-confidence: untrusted pointer on a non-PR run not named — same as ledger row 4 (observation). Reversibility: high.';

test('R17: a trailing ledger-row clause outside parentheses is removed from the claim', () => {
  assert.strictEqual(splitDecisionLine(R17_LEDGER_TAIL).findings[0].claim, 'resolve-console success stdout path (renderExecutedLines) has no CLI-level test');
  assert.strictEqual(splitDecisionLine(R17_LEDGER_SAME_AS).findings[0].claim, 'untrusted pointer on a non-PR run not named');
  // The clause is only dropped at the end: one inside the claim's own sentence stays.
  const mid = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/a.js:1 not reproduced: the writer repeats ledger row 4 in its own header before it writes anything. Staged to Review Console as low-confidence.';
  assert.ok(splitDecisionLine(mid).findings[0].claim.includes('ledger row 4'));
});

// R17 round 3: the strips remove meta, never claim text.
const r3Line = (claim) => `- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/a.js:10 ${claim} Staged to Review Console as low-confidence. Reversibility: high.`;

test('R17: a ledger-row mention inside the claim\'s own sentence is kept', () => {
  for (const claim of [
    'the resolver corrupts ledger row 4',
    'the writer breaks the parse of ledger row 4.',
    'the writer drops the ledger row 4 (this drops data silently when the cell has a pipe)',
  ]) {
    const [item, ...rest] = itemsForLine(r3Line(claim));
    assert.deepStrictEqual([item.kind, rest.length], ['finding', 0], claim);
    assert.strictEqual(item.claimText, claim, claim);
  }
  // Set off by a sentence boundary, the clause is still meta.
  assert.strictEqual(splitDecisionLine(r3Line('the writer drops the cell. same as ledger row 4 (observation).')).findings[0].claim, 'the writer drops the cell.');
});

test('R17: a leading slash before a letter and a bare number in prose are claim text, not fragments', () => {
  assert.strictEqual(splitDecisionLine(r3Line('/claude-tweaks:flow is invoked with the spec number before any build starts')).findings[0].claim, '/claude-tweaks:flow is invoked with the spec number before any build starts');
  assert.strictEqual(splitDecisionLine(r3Line('-1 is returned when the guard finds no match')).findings[0].claim, '-1 is returned when the guard finds no match');
  // A ref glued to the path token (the location sits inside a parenthetical, so only the path is split) is its tail.
  const glued = '- STAGED 23:18:47 — log-decision: Reproduction: lens 3a/3f cosmetic findings (record.js:803 stale signature summary, harness-health/issue-payload.js:17 nodePath alias, harness issue-payload.test.js:500 comment misattributes the premiseCheck guard, code-health anchor path:line / String(undefined) edge) not reproduced. Staged to Review Console as low-confidence. Artifact: ledger row 23. Reversibility: high.';
  assert.ok(splitDecisionLine(glued).findings[0].claim.startsWith('nodePath alias, harness issue-payload.test.js:500'), splitDecisionLine(glued).findings[0].claim);
  // The fragments the earlier rules strip still go.
  assert.strictEqual(splitDecisionLine(r3Line('/127 . the guard finds no match for the key')).findings[0].claim, 'the guard finds no match for the key');
  assert.strictEqual(splitDecisionLine(r3Line('/:127 / :128 . the guard finds no match for the key')).findings[0].claim, 'the guard finds no match for the key');
});

test('R17: a parenthetical left with only connectives and refs after the ledger strip is dropped', () => {
  const claim = splitDecisionLine(r3Line('the guard skips the pipe (ledger row 3 and 4) when the cell is empty')).findings[0].claim;
  assert.strictEqual(claim, 'the guard skips the pipe when the cell is empty');
  assert.strictEqual(splitDecisionLine(r3Line('the guard skips the pipe (ledger rows 3, 4 or 5) when the cell is empty')).findings[0].claim, 'the guard skips the pipe when the cell is empty');
});

// Final-wave claim-cleaning minors (1, 2, 9, 10). Verbatim real lines where they exist.
const R_NOT_AUTO = '- STAGED 18:44:40 — Reproduction: lens "3a" finding docs/plans/2026-10-20-nested-dispatch-native-rewake-ledger.md:5 not reproduced (reason-not-auto: requires-judgment on divergence/merge-order rows; closest enum value for a merge-order call). Staged to Review Console as low-confidence. Reversibility: high.';
const R_SAME_SUBSTANCE = '- STAGED 23:34:26 — log-decision: Reproduction: lens 3c finding plugin/bin/lib/verify/flaky.js:12 not reproduced (same substance as the confirmed 3a flaky.js:12 finding, resolved Don\'t fix). Staged to Review Console as low-confidence. Reversibility: high.';

test('minor 1: reproduction meta is stripped a whole clause at a time, never a word inside a kept claim', () => {
  const claim = (text) => splitDecisionLine(r3Line(text)).findings[0].claim;
  assert.strictEqual(claim('the parser drops the field (the agent field is reproduced from stdin, verbatim)'), 'the parser drops the field (the agent field is reproduced from stdin, verbatim)');
  assert.strictEqual(claim('the parser drops the field (agent B only, probed by the agent returning 0) silently'), 'the parser drops the field silently');
  assert.strictEqual(claim('the parser drops the field (it never checks the type, probed by the agent returning 0) silently'), 'the parser drops the field (it never checks the type) silently');
  // A producer note is meta as a whole: a line made only of one is claim-empty.
  assert.deepStrictEqual(splitDecisionLine(R_NOT_AUTO), { findings: [], noClaim: 'claim-empty' });
  assert.deepStrictEqual(splitDecisionLine(R_SAME_SUBSTANCE), { findings: [], noClaim: 'claim-empty' });
  // A dropped parenthetical leaves no stray ` .` mid-claim.
  assert.strictEqual(claim('the writer drops the cell (single agent). It never retries the write'), 'the writer drops the cell. It never retries the write');
});

test('minor 2: a range token set off by a list separator starts a finding; one in prose continues the claim', () => {
  const line = '- STAGED 10:00:00 — Reproduction: lens "3f" findings tests/a.test.js:12 duplicates the loop setup, tests/b.test.js:79-88 never closes its temp handle. Staged to Review Console as low-confidence.';
  assert.deepStrictEqual(splitDecisionLine(line).findings.map((f) => [f.path, f.line, f.claim]), [
    ['tests/a.test.js', 12, 'duplicates the loop setup'], ['tests/b.test.js', 79, 'never closes its temp handle.'],
  ]);
  const prose = '- STAGED 10:00:00 — Reproduction: lens "3f" finding tests/a.test.js:12 duplicates the loop that already overlaps tests/b.test.js:79-88 entirely. Staged to Review Console as low-confidence.';
  assert.strictEqual(splitDecisionLine(prose).findings.length, 1);
  assert.deepStrictEqual(splitDecisionLine(R17_LIST).findings.map((f) => `${f.path}:${f.line}`), [
    'tests/ledger-pipe-escape-rule-conformance.test.js:27', 'tests/bin-lib/wrap-up/pack.test.js:832', 'plugin/bin/lib/wrap-up/ledger-write.js:114',
  ]);
});

test('minor 9: a bare number after prose punctuation is claim text, not a location fragment', () => {
  assert.strictEqual(splitDecisionLine(r3Line('not reproduced: -1 is returned when the guard finds no match')).findings[0].claim, '-1 is returned when the guard finds no match');
  assert.strictEqual(splitDecisionLine(r3Line('not reproduced. :3 is an index into the stale table')).findings[0].claim, ':3 is an index into the stale table');
  // Refs after a list separator are still a location list's tail.
  assert.ok(splitDecisionLine(R17_SLASH_COLON).findings[0].claim.startsWith('share a location but not substance'));
});

test('minor 10: removing a ledger-row ref never leaves a fragment inside a parenthetical', () => {
  const claim = (text) => splitDecisionLine(r3Line(text)).findings[0].claim;
  assert.strictEqual(claim('the guard skips the pipe (ledger row 3, but cell empty) when the cell is empty'), 'the guard skips the pipe when the cell is empty');
  assert.strictEqual(claim('the guard skips the pipe (see ledger row 3 and the cell) when the cell is empty'), 'the guard skips the pipe when the cell is empty');
  // At a clause boundary the rest of the parenthetical is kept, as before.
  assert.strictEqual(claim('the guard skips the pipe (cells are never escaped; already ledger row 6, deferred) when empty'), 'the guard skips the pipe (cells are never escaped; deferred) when empty');
});

test('staged-digest-text.js is a leaf: it requires nothing from the backfill modules', () => {
  const source = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'staged-digest-text.js'));
  assert.deepStrictEqual(source.match(/require\([^)]*\)/g) || [], []);
});

test('R17: a leading em dash left after a location is not part of the claim', () => {
  const line = '- STAGED 10:00:00 — Reproduction: lens "3f" finding tests/a.test.js:12 — argument-hint mirror overlap; reviewer read: do not fix, AC2 needs the token pin. Staged to Review Console as low-confidence.';
  assert.ok(splitDecisionLine(line).findings[0].claim.startsWith('argument-hint mirror overlap'));
});

// R17b: a staged finding file with no `Finding:` line takes its claim from the digest text, not the whole
// file joined. Texts verbatim from real archived staged files.
const R17B_TITLE = "Title: Review of #3642 — low-confidence findings (not reproduced by both agents of a pair)\nKind: review-unconfirmed\n\nReproduction pairs at review-effort `medium` (lenses 3a, 3b, 3c, 3f). 3b and 3c returned no findings from either agent. These findings came from one agent only and entered `unconfirmed`:\n\n| Lens | Severity | Path:Line | Finding |\n|---|---|---|---|\n| 3f (agent A, also 3a agent A) | medium / low | plugin/bin/lib/verify/baseline.js:354 | `sub.startsWith('../')` on a `path.relative` result sits outside the scan's literal `startsWith('..')` regex. Out of the diff. The earlier whole-branch review judged this site a correct whole-segment check (`sub === '..' \\|\\| sub.startsWith('../')`), so no behavior defect. |\n| 3f (agent B) | medium | tests/path-containment-conformance.test.js:48 | `REL_DOT_DOT` does not flag the `startsWith('..' + path.sep)` form. Deliberate scope per the test header and ledger row 6. |\n| 3f (agent B) | low | tests/path-containment-conformance.test.js:101 | The planted go-red control bypasses `listJs` and the path-guard exclusion filter. |\n| 3f (agent A) | low | tests/bin-lib/path-guard/callers-characterization.test.js:276 | `linkedWorktreeOf(gitRepo())` leaks temp dirs. The shared helper does this across the suite. |\n| 3a (agent B) | low | tests/path-containment-conformance.test.js:51 | `scanRelDotDot` has no planted mis-parse self-test for the comment stripper. |\n| 3a (agent A) | low | .claude/skills/bin-source-scan-conformance/SKILL.md:16 | Describes the ban as `startsWith('..')` on a `path.relative` result while the scan flags any literal `startsWith('..')` (already ledger row 7, accepted). |\n\nThe one other single-agent finding, `plugin/bin/lib/hooks/sweep-shadow.js:115` (retyped `startsWith(rootWithSep)` containment copy), was read directly by the reviewing agent and confirmed; it is staged separately as `ledger-record-sweep-shadow-containment.md`.\n";
const R17B_CATEGORY = "# Review — debate deviation (#2821)\n\n**Category:** procedure deviation\n**Severity:** medium\n**Reversibility:** high\n\n## What happened\n\nAt high effort, Cross-Lens Debate (`review/step3-debate-and-refutation.md`) should have sent each\nseverity-contradicting pair to two judges. The reviewer skipped debate instead. It confirmed each\nfinding by reading the source, took the lower severity, and auto-applied the fixes under\n`review-auto-apply-ceiling=medium`. The logged reason (\"the outcome cannot change routing\") was\nwrong for three pairs:\n\n| Pair | Severities | Higher would route | Lower routed |\n|---|---|---|---|\n| `wrap-up/verification-brief-parent-gate.md:256/258`: appended end-to-end variant has no summary slot | 3e high / 3g medium | STAGED | AUTO |\n| `demo/entry-paths.md:217`: duplicate-comment selection | 3a high / 3b medium | STAGED | AUTO |\n| `tests/try-it-contract-conformance.test.js:65`: `between()` slices silently | 3f critical / 3c medium | KEPT-PROMPT | AUTO |\n\nAll three fixes are in `3d958470c`. Each is covered by a test that fails against the old text, and\nthe full suite at `4d802e016` passed (0 fail). Lens 3f's own expected ceiling is medium, which\nthe critical rating exceeded.\n\n## Decision for the human\n\nAccept the applied fixes (recommended: they are small, tested, and visible in PR #3321's diff), or\nask for any of the three to be reverted and handled as a staged change instead.\n";
const R17B_TABLE = "# Low-confidence review finding — #3311 (lens 3c, not reproduced)\n\n| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| medium | tests/skill-size-single-source.test.js:94 | `scanText` throws an uncaught `TypeError` on an empty `for…of` destructuring binding | `forOf[1].match(/[A-Za-z_$][\\w$]*/g)` returns `null` for `for (const [] of …)`, so the `for (const name of null)` loop throws. Agent B reproduced it; agent A did not flag it. |\n\n**Controller note:** the shape (`for (const [] of x)`) is syntactically valid but has no realistic use. If it ever appears, the guard fails loud: a raw `TypeError` turns the test red, so nothing passes silently. The one-line fix is `(forOf[1].match(...) || [])`.\n\n**Recommendation:** Don't fix. This is the calibration filter's \"hypothetical edge case\", and it fails loud rather than silently.\n";

function stagedClaim(name, text) {
  const RUN = '2026-10-24T090000-record-1';
  const [item] = consoleWorkItems({
    consoleDir: `/x/${RUN}`, consoleJson: { items: [KEEP(name)] }, decisions: '', readStaged: () => text, runId: RUN,
  });
  return item;
}

test('R17b: a staged file with no Finding: line takes its claim from the digest text', () => {
  for (const [name, text] of [['review-unconfirmed-1.md', R17B_TITLE], ['review-unconfirmed-2.md', R17B_CATEGORY], ['review-unconfirmed-3.md', R17B_TABLE]]) {
    const item = stagedClaim(name, text);
    assert.strictEqual(item.kind, 'finding', name);
    assert.ok(!/^(Title:|\*\*|Ledger:|\|)/.test(item.claimText), item.claimText);
    assert.strictEqual(item.claimText, digestTextOf(text).replace(/\s+/g, ' ').trim(), name);
  }
  assert.ok(stagedClaim('review-unconfirmed-1.md', R17B_TITLE).claimText.startsWith('Reproduction pairs at review-effort'));
  assert.ok(stagedClaim('review-unconfirmed-2.md', R17B_CATEGORY).claimText.startsWith('At high effort, Cross-Lens Debate'));
  assert.ok(stagedClaim('review-unconfirmed-3.md', R17B_TABLE).claimText.startsWith('medium — tests/skill-size-single-source.test.js:94'));
  assert.strictEqual(stagedClaim('review-unconfirmed-2.md', R17B_CATEGORY).stagedFinding.title, null);
  assert.ok(stagedClaim('review-unconfirmed-2.md', R17B_CATEGORY).stagedFinding.body.startsWith('# Review — debate deviation'));
});

test('R17b: the Finding: line still wins, the joined text is the fallback, and the id follows the file name', () => {
  const withFinding = stagedClaim('review-unconfirmed-4.md', `Title: x\nKind: y\n\nFinding: the guard reads a stale value\nTarget: plugin/x.js:3\n`);
  assert.strictEqual(withFinding.claimText, 'the guard reads a stale value');
  assert.deepStrictEqual(withFinding.stagedFinding, { title: 'x', body: 'Finding: the guard reads a stale value\nTarget: plugin/x.js:3', severity: null });
  // Finding: is claim/bookkeeping and stays out of the body; Target: is content and is kept.
  assert.strictEqual(stagedClaim('review-unconfirmed-8.md', 'Finding: the guard reads a stale value\nTarget: plugin/y.js:9\n').stagedFinding.body, 'Target: plugin/y.js:9');
  // digestTextOf yields nothing for a file of headings only: the joined text path is unchanged (here, empty -> claim-empty).
  const headingsOnly = stagedClaim('review-unconfirmed-5.md', '# plugin/x.js:3\n# more\n');
  assert.strictEqual(headingsOnly.kind, 'no-claim');
  assert.strictEqual(headingsOnly.noClaimReason, 'claim-empty');
  assert.strictEqual(stagedClaim('review-unconfirmed-1.md', R17B_TITLE).itemId, backfillItemId({ runId: '2026-10-24T090000-record-1', sourceKey: 'staged/review-unconfirmed-1.md', findingKey: '' }));
});

test('#4136: header lines that carry content stay in the staged body, bookkeeping keys do not', () => {
  const kept = stagedClaim('review-unconfirmed-9.md', 'Target: plugin/x.js:3\nInvariant: the guard runs before the read\nFinding: the guard reads a stale value\nStaged-at: abc1234\n\nProse body.\n');
  assert.strictEqual(kept.stagedFinding.body, 'Target: plugin/x.js:3\nInvariant: the guard runs before the read\n\nProse body.');
  const lenses = stagedClaim('review-unconfirmed-10.md', 'Title: x\nLenses: 3c — direct read confirms the code\nSEVERITY: low\nFinding: the guard reads a stale value\nTarget: plugin/x.js:3\n\nProse body.\n');
  assert.strictEqual(lenses.stagedFinding.title, 'x');
  assert.strictEqual(lenses.stagedFinding.body, 'Lenses: 3c — direct read confirms the code\nTarget: plugin/x.js:3\n\nProse body.');
});

test('minor 12: a staged finding\'s claim and location come from the same table row', () => {
  const table = '# Low-confidence review findings\n\n| Severity | Path | Finding |\n|---|---|---|\n| medium | plugin/skills/review/step3-routing.md | the vacuity bullet calls itself an exception to nothing |\n| low | tests/b.test.js:40 | the helper leaks a temp dir |\n';
  const item = stagedClaim('review-unconfirmed-6.md', table);
  assert.ok(item.claimText.includes('the vacuity bullet calls itself an exception'), item.claimText);
  assert.deepStrictEqual([item.finding.path, item.finding.line], ['plugin/skills/review/step3-routing.md', null], 'row 1\'s location, never row 2\'s');
  // A Finding: line keeps the file's Location: field, even when the claim names another file
  // (verbatim, archive/2026-10-24T093559-record-3740/staged/review-unconfirmed-2.md).
  const located = stagedClaim('review-unconfirmed-2.md', '# Low-confidence finding (single lens agent, not reproduced)\n\n- Lens: 3f Test Quality, reported by one of two reproduction agents\n- Severity: low\n- Location: tests/archive-run-verb.test.js (BUNDLE_GATE / BUNDLE_GROUP constants)\n- Finding: the bundle log-line literals are hand-copied here and again in tests/bin-lib/reconcile/archive-merged.test.js, and the copies here are not tied to the live settle-and-merge.md text.\n');
  assert.deepStrictEqual([located.finding.path, located.finding.line], ['tests/archive-run-verb.test.js', null]);
  const bare = stagedClaim('review-unconfirmed-8.md', 'Finding: the guard reads a stale value\nTarget: plugin/y.js:9\n');
  assert.deepStrictEqual([bare.finding.path, bare.finding.line], ['plugin/y.js', 9]);
});

test('summarize counts kinds', () => {
  const { pipelines } = fixtureRoot();
  const run = mkArchived(pipelines, '2026-10-20T000000-spec-13');
  mkDecisions(run, [SINGLE, CLAIMLESS]);
  mkStaged(run, 'zz-1.md', 'zz\n');
  mkConsole(run, [KEEP(newId(SINGLE)), KEEP(newId(CLAIMLESS)), PENDING('zz-1.md'), PENDING('docs:CLAUDE.md'), { id: 'docs:y', section: 'Documentation updates', resolution: 'approve', reason: 'r' }]);
  mkArchived(pipelines, '2026-10-21T000000-spec-14'); // walked, no console
  assert.deepStrictEqual(summarize(buildWorkList({ pipelinesRoot: pipelines, mainSha: MAIN_SHA })), {
    runs: 1, consoles: 1, items: 4, byKind: { finding: 1, 'no-claim': 1, 'staged-kind': 2 }, findingsMaxFiled: 1,
  });
});
