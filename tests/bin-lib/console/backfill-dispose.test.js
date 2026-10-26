// tests/bin-lib/console/backfill-dispose.test.js — the Review Console backlog
// backfill's disposition table as code (#3950): which action, outcome and source
// each work item gets, the proposals and digest entries it carries, and the batch
// planner that dedups them against existing records and the digest.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DIGEST_REASONS, areaFor, disposeItem, planBatch,
} = require('../../../plugin/bin/lib/console/backfill-dispose');
const { consoleWorkItems } = require('../../../plugin/bin/lib/console/backfill');
const { BACKFILL_OUTCOMES, BACKFILL_SOURCES } = require('../../../plugin/bin/lib/console/backfill-apply');
const { findingFingerprint } = require('../../../plugin/bin/lib/console/finding-filing');
const { extractFingerprint } = require('../../../plugin/bin/lib/issues/record');
const { fingerprintFromBasis } = require('../../../plugin/bin/lib/health-core/fingerprint');
const { materialityFingerprint, parseMaterialityFingerprints } = require('../../../plugin/bin/lib/health-core/materiality-digest');
const { readText } = require('../../helpers/read-skill');

const MAIN_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONSOLE_DIR = '/x/pipelines/2026-10-24T090000-spec-12';
const RUN_ID = '2026-10-24T090000-spec-12';

const findingItem = (over = {}) => ({
  itemId: 'bf:0000000000000001',
  itemHash: 'h1',
  kind: 'finding',
  section: 'Low-confidence findings',
  consoleDir: CONSOLE_DIR,
  storedIndices: [0],
  finding: { lens: '3a', path: 'plugin/skills/review/SKILL.md', line: 9, reporterSeverity: 'medium', kind: 'unconfirmed' },
  claimText: 'The guard runs after the read',
  context: '- STAGED 10:00:00 — whatever',
  ...over,
});
const noClaimItem = (over = {}) => ({
  itemId: 'bf:0000000000000002',
  itemHash: 'h2',
  kind: 'no-claim',
  section: 'Low-confidence findings',
  consoleDir: CONSOLE_DIR,
  storedIndices: [1],
  noClaimReason: 'no-path',
  context: '- STAGED 10:00:00 — a line with nothing to cite',
  ...over,
});
const stagedItem = (staged, over = {}) => ({
  itemId: 'bf:0000000000000003',
  itemHash: 'h3',
  kind: 'staged-kind',
  section: staged.section,
  consoleDir: CONSOLE_DIR,
  storedIndices: [2],
  staged,
  ...over,
});

const EVIDENCE = { path: 'plugin/skills/review/SKILL.md', line: 12, quote: 'guard(x); read(x);' };
const confirmed = (severity = 'medium') => ({ outcome: 'confirmed', severity, evidence: EVIDENCE, reason: 'confirmed by tiebreak', recommendation: null });
const dropV = { outcome: 'drop', severity: 'medium', evidence: EVIDENCE, reason: 'refuted by tiebreak', recommendation: null };
const consoleV = { outcome: 'console', severity: 'medium', evidence: null, reason: 'verdict:cant-tell', recommendation: 'drop' };
const digestV = { outcome: 'digest', severity: 'low', evidence: null, reason: 'verdict:cant-tell', recommendation: null };

// The fingerprint a fingerprint-less filing is minted (a crash between filing and apply re-runs into a dedup hit).
const backfillFingerprint = (itemId) => fingerprintFromBasis('consolebackfill', [itemId]);

const files = (map) => (_dir, name) => (Object.hasOwn(map, name) ? map[name] : null);
const dispose = (item, verdict, readStaged) => disposeItem({
  item, verdict, runId: RUN_ID, mainSha: MAIN_SHA, readStaged,
});

test('the outcomes and sources a disposition uses are the apply step\'s', () => {
  const samples = [
    dispose(findingItem(), confirmed()),
    dispose(findingItem(), dropV),
    dispose(findingItem(), digestV),
    dispose(noClaimItem()),
  ];
  for (const d of samples) {
    assert.ok(BACKFILL_OUTCOMES.includes(d.outcome), d.outcome);
    assert.ok(BACKFILL_SOURCES.includes(d.source), d.source);
  }
});

test('disposition: finding confirmed at medium or higher files the confirmed proposal', () => {
  for (const severity of ['critical', 'high', 'medium']) {
    const d = dispose(findingItem(), confirmed(severity));
    assert.deepStrictEqual([d.action, d.outcome, d.source], ['file', 'filed', 'tiebreak'], severity);
    assert.ok(d.proposal.title.startsWith('Review finding (confirmed): '), d.proposal.title);
    assert.ok(d.proposal.text.includes(`The tiebreak confirmed it on ${MAIN_SHA}: ${EVIDENCE.path}:${EVIDENCE.line} \`${EVIDENCE.quote}\`.`), d.proposal.text);
    assert.strictEqual(d.proposal.fingerprint, findingFingerprint({ lens: '3a', path: 'plugin/skills/review/SKILL.md', claim: 'The guard runs after the read' }));
    assert.strictEqual(extractFingerprint(d.proposal.text), d.proposal.fingerprint);
    assert.strictEqual(d.ref, undefined, 'a new filing has no ref yet');
    assert.strictEqual(d.itemId, 'bf:0000000000000001');
  }
});

test('disposition: finding confirmed at low or info digests with the confirmed-low reason', () => {
  for (const severity of ['low', 'info']) {
    const d = dispose(findingItem(), confirmed(severity));
    assert.deepStrictEqual([d.action, d.outcome, d.source], ['digest', 'digested', 'tiebreak'], severity);
    assert.strictEqual(d.digest.entry.deferReason, DIGEST_REASONS.CONFIRMED_LOW);
    assert.strictEqual(DIGEST_REASONS.CONFIRMED_LOW, 'console-backfill-confirmed-low');
    assert.ok(d.digest.line.includes('Defer-reason: console-backfill-confirmed-low'), d.digest.line);
  }
});

test('disposition: finding dropped by the tiebreak carries the evidence as its ref', () => {
  const d = dispose(findingItem(), dropV);
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['drop', 'dropped', 'tiebreak']);
  assert.strictEqual(d.ref, 'plugin/skills/review/SKILL.md:12 "guard(x); read(x);"');
  assert.strictEqual(d.proposal, undefined);
  assert.strictEqual(d.digest, undefined);
});

test('a drop whose evidence has no line cites it as unknown, never null', () => {
  const d = dispose(findingItem(), { ...dropV, evidence: { ...EVIDENCE, line: null } });
  assert.strictEqual(d.ref, 'plugin/skills/review/SKILL.md:unknown "guard(x); read(x);"');
});

test('disposition: finding the tiebreak left to the console files a can\'t-tell proposal', () => {
  const d = dispose(findingItem(), consoleV);
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['file', 'filed', 'tiebreak']);
  assert.ok(d.proposal.title.startsWith("Review finding (can't-tell): "), d.proposal.title);
  assert.match(d.proposal.text, /can't-tell \(verdict:cant-tell\)/);
  assert.match(d.proposal.text, /Recommendation: drop/);
  assert.strictEqual(extractFingerprint(d.proposal.text), d.proposal.fingerprint);
});

test('disposition: finding the tiebreak digested uses the can\'t-tell digest reason', () => {
  const d = dispose(findingItem(), digestV);
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['digest', 'digested', 'tiebreak']);
  assert.strictEqual(d.digest.entry.deferReason, 'tiebreak-cant-tell');
  assert.strictEqual(DIGEST_REASONS.CANT_TELL, 'tiebreak-cant-tell');
  assert.ok(d.digest.line.includes('Defer-reason: tiebreak-cant-tell'), d.digest.line);
});

test('a defaulted medium reporter severity files a can\'t-tell', () => {
  // Task 1 defaults an unknown reporter severity to medium; a console verdict then files.
  const d = dispose(findingItem({ finding: { ...findingItem().finding, reporterSeverity: 'medium' } }), { ...consoleV, severity: 'medium' });
  assert.strictEqual(d.action, 'file');
  assert.strictEqual(d.outcome, 'filed');
});

test('a finding with no line files without printing "null" as a location', () => {
  const d = dispose(findingItem({ finding: { ...findingItem().finding, line: null } }), consoleV);
  assert.doesNotMatch(d.proposal.text, /:null/);
});

test('no composed finding body cites a line as :unknown', () => {
  const item = findingItem({ finding: { ...findingItem().finding, line: null } });
  for (const v of [consoleV, confirmed()]) assert.doesNotMatch(dispose(item, v).proposal.text, /:unknown\b/);
});

test('disposition: no-claim item digests with the no-claim reason, naming why', () => {
  const d = dispose(noClaimItem({ noClaimReason: 'claim-empty' }));
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['digest', 'digested', 'digest']);
  assert.strictEqual(d.digest.entry.deferReason, DIGEST_REASONS.NO_CLAIM);
  assert.match(d.digest.entry.finding, /claim-empty/);
});

test('AC4.1b: a no-claim item routes to the digest with the no-claim reason', () => {
  const d = dispose(noClaimItem());
  assert.ok(d.digest.line.includes('Defer-reason: console-backfill-no-claim'), d.digest.line);
  assert.strictEqual(DIGEST_REASONS.NO_CLAIM, 'console-backfill-no-claim');
  assert.ok(d.digest.line.includes(RUN_ID), 'the provenance is the run id');
});

test('AC4.2: a no-claim item is neither dropped nor left pending', () => {
  for (const reason of ['no-path', 'claim-empty', 'source-line-not-found', 'staged-file-absent']) {
    const d = dispose(noClaimItem({ noClaimReason: reason }));
    assert.strictEqual(d.outcome, 'digested', reason);
    assert.notStrictEqual(d.action, 'drop', reason);
  }
});

test('disposition: staged shadow-dup-duplicate dismisses, naming the anchor', () => {
  const d = dispose(stagedItem({ name: 'reflect-1.md.shadow-dup-2', section: 'Dismissed duplicates', outcome: 'shadow-dup-duplicate' }));
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['dismiss', 'dismissed', 'staged-kind']);
  assert.strictEqual(d.ref, 'duplicate of staged/reflect-1.md');
});

test('disposition: staged shadow-dup-divergent files the reconcile proposal quoting copy and anchor', () => {
  const rs = files({ 'x-1.md.shadow-dup': 'COPY BODY\n', 'x-1.md': 'ANCHOR BODY\n' });
  const d = dispose(stagedItem({ name: 'x-1.md.shadow-dup', section: 'Queue writes', outcome: 'shadow-dup-divergent' }), undefined, rs);
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['file', 'filed', 'staged-kind']);
  assert.strictEqual(d.proposal.title, 'Reconcile staged copy x-1.md.shadow-dup');
  assert.match(d.proposal.text, /COPY BODY/);
  assert.match(d.proposal.text, /ANCHOR BODY/);
  assert.ok(d.proposal.text.startsWith('Title: Reconcile staged copy x-1.md.shadow-dup\n'));
  assert.strictEqual(d.proposal.fingerprint, backfillFingerprint(d.itemId), 'the shadow-dup record gets a fingerprint minted from the item id');
  assert.strictEqual(extractFingerprint(d.proposal.text), d.proposal.fingerprint, 'and carries it as its work-fingerprint marker');
});

test('disposition: staged shadow-dup-collision files the reconcile proposal', () => {
  const rs = files({ 'x-1.md.shadow-dup': 'COPY BODY\n' });
  const d = dispose(stagedItem({ name: 'x-1.md.shadow-dup', section: 'Queue writes', outcome: 'shadow-dup-collision' }), undefined, rs);
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['file', 'filed', 'staged-kind']);
  assert.match(d.proposal.text, /COPY BODY/);
  assert.match(d.proposal.text, /anchor `staged\/x-1\.md` was missing or unreadable/);
});

test('disposition: a Queue writes item with no reason and a Title: header files the staged text as written', () => {
  const text = 'Title: Do the thing\nType: task\nLabels: needs:definition\nDefer-reason: needs-human-decision\n\n## Current State\n\nx\n';
  const d = dispose(stagedItem({ name: 'leftover-3.md', section: 'Queue writes' }), undefined, files({ 'leftover-3.md': text }));
  assert.deepStrictEqual([d.action, d.outcome, d.source], ['file', 'filed', 'staged-kind']);
  assert.ok(d.proposal.text.startsWith(text), 'the staged text is kept as written; only the marker is appended');
  assert.strictEqual(d.proposal.title, 'Do the thing');
  assert.strictEqual(d.proposal.fingerprint, backfillFingerprint(d.itemId));
  assert.strictEqual(extractFingerprint(d.proposal.text), d.proposal.fingerprint);
  assert.strictEqual(d.proposal.text.slice(text.length).trim().split('\n').length, 2, 'the marker block is the only addition');
});

test('a Queue writes proposal never gains or loses an auto:* or bot:* label by being filed, and keeps its other labels', () => {
  const text = 'Title: T\nType: task\nLabels: needs:definition, auto:merge, Bot:parked, size:low\nDefer-reason: needs-human-decision\n\nbody mentions Labels: auto:build in prose\n';
  const d = dispose(stagedItem({ name: 'leftover-9.md', section: 'Queue writes' }), undefined, files({ 'leftover-9.md': text }));
  const header = d.proposal.text.split('\n\n')[0];
  assert.match(header, /^Labels: needs:definition, size:low$/m);
  assert.doesNotMatch(header, /auto:|bot:/i);
  assert.ok(d.proposal.text.includes('body mentions Labels: auto:build in prose'), 'the body is untouched');
  const only = dispose(stagedItem({ name: 'leftover-9.md', section: 'Queue writes' }), undefined, files({ 'leftover-9.md': 'Title: T\nLabels: auto:merge\n\nb\n' }));
  assert.doesNotMatch(only.proposal.text.split('\n\n')[0], /Labels:/, 'a header left with no label drops the line');
});

test('a Queue writes proposal carrying a work-fingerprint marker keeps it for dedup', () => {
  const text = 'Title: T\nType: task\nLabels: needs:definition\n\nbody\n<!-- work-fingerprint: tidy-abcd1234 -->\n';
  const d = dispose(stagedItem({ name: 'tidy-1.md', section: 'Queue writes' }), undefined, files({ 'tidy-1.md': text }));
  assert.strictEqual(d.proposal.fingerprint, 'tidy-abcd1234');
});

test('disposition: any other staged-kind digests as unmapped, naming the file and why', () => {
  // Queue writes without a Title: header (a reflect finding), a reasoned Queue row, a pending row, an engine row.
  const reflect = dispose(
    stagedItem({ name: 'reflect-1.md', section: 'Queue writes' }),
    undefined,
    files({ 'reflect-1.md': '# Reflect — staged finding 1\n\n**Category:** tangential\n**Files:** plugin/bin/lib/a.js, general\n\n## Finding\n\nThe ledger grew without bound.\n' }),
  );
  assert.deepStrictEqual([reflect.action, reflect.outcome, reflect.source], ['digest', 'digested', 'digest']);
  assert.strictEqual(reflect.digest.entry.deferReason, DIGEST_REASONS.UNMAPPED_KIND);
  assert.strictEqual(DIGEST_REASONS.UNMAPPED_KIND, 'console-backfill-unmapped-kind');
  assert.match(reflect.digest.entry.finding, /^reflect-1\.md \(Queue writes\)/);
  assert.match(reflect.digest.entry.finding, /The ledger grew without bound\./, 'the staged file\'s first body line');
  assert.strictEqual(reflect.digest.entry.area, 'reflect');
  assert.strictEqual(reflect.digest.entry.fileRefs, 'plugin/bin/lib/a.js, general', 'a reflect file\'s **Files:** value');

  const reasoned = dispose(stagedItem({ name: 'premise-satisfied-4.md', section: 'Queue writes', reason: 'premise-satisfied-close-proposal' }), undefined, files({ 'premise-satisfied-4.md': 'Title: X\n\nbody' }));
  assert.strictEqual(reasoned.action, 'digest', 'a reasoned Queue row is never filed');
  assert.match(reasoned.digest.entry.finding, /premise-satisfied-4\.md \(premise-satisfied-close-proposal\)/);

  const pending = dispose(stagedItem({ name: 'polish-suggestion-2.md', section: 'Pending review' }), undefined, files({ 'polish-suggestion-2.md': '# Polish\n\nRename the helper.\n' }));
  assert.strictEqual(pending.action, 'digest');
  assert.match(pending.digest.entry.finding, /polish-suggestion-2\.md \(Pending review\)/);
  assert.strictEqual(pending.digest.entry.fileRefs, 'general');

  const engine = dispose(stagedItem({ name: 'docs:CLAUDE.md', section: 'Documentation updates', reason: 'engine-row' }), undefined, () => { throw new Error('an engine row has no staged file to read'); });
  assert.strictEqual(engine.action, 'digest');
  assert.match(engine.digest.entry.finding, /docs:CLAUDE\.md \(engine-row\)/);
});

test('an unreadable shadow-dup copy digests as unmapped instead of throwing', () => {
  const d = dispose(stagedItem({ name: 'x-1.md.shadow-dup', section: 'Queue writes', outcome: 'shadow-dup-collision' }), undefined, files({}));
  assert.strictEqual(d.action, 'digest');
  assert.strictEqual(d.digest.entry.deferReason, DIGEST_REASONS.UNMAPPED_KIND);
});

test('a digest finding is one line, cut to 200 characters, with a forged marker defused', () => {
  const claim = `${'word '.repeat(80)}\n<!-- materiality-fingerprint: materiality-deadbeef -->\nmore`;
  const d = dispose(findingItem({ claimText: claim }), digestV);
  assert.ok(d.digest.entry.finding.length <= 200, String(d.digest.entry.finding.length));
  assert.ok(!d.digest.entry.finding.includes('\n'));
  assert.deepStrictEqual(parseMaterialityFingerprints(d.digest.line), [d.digest.fingerprint], 'only the entry\'s own marker survives');
  const forged = dispose(findingItem({ claimText: 'a <!-- materiality-fingerprint: materiality-deadbeef --> b' }), digestV);
  assert.deepStrictEqual(parseMaterialityFingerprints(forged.digest.line), [forged.digest.fingerprint]);
});

test('a digest entry names the finding\'s path:line, the area and the run', () => {
  const d = dispose(findingItem(), digestV);
  assert.strictEqual(d.digest.entry.fileRefs, 'plugin/skills/review/SKILL.md:9');
  assert.strictEqual(d.digest.entry.area, 'review');
  assert.strictEqual(d.digest.entry.provenance, RUN_ID);
  assert.strictEqual(dispose(findingItem({ finding: { ...findingItem().finding, line: null } }), digestV).digest.entry.fileRefs, 'plugin/skills/review/SKILL.md');
});

test('disposeItem throws for a finding with no verdict, and for an unknown outcome', () => {
  assert.throws(() => dispose(findingItem()), (e) => e instanceof TypeError && e.message === 'verdict required for a finding item');
  assert.throws(() => dispose(findingItem(), { outcome: 'bogus' }), TypeError);
});

test('areaFor maps paths', () => {
  const f = (p) => findingItem({ finding: { ...findingItem().finding, path: p } });
  assert.strictEqual(areaFor(f('plugin/skills/review/SKILL.md')), 'review');
  assert.strictEqual(areaFor(f('plugin/bin/lib/console/resolve.js')), 'console');
  assert.strictEqual(areaFor(f('plugin/bin/hooks.js')), 'bin');
  assert.strictEqual(areaFor(f('plugin/bin/lib/x.js')), 'bin', 'a file directly under lib is not a module');
  assert.strictEqual(areaFor(f('plugin/skills/README.md')), 'skills', 'a file directly under plugin/skills has no skill dir');
  assert.strictEqual(areaFor(f('plugin/skills/_shared/auto-mode-contract.md')), '_shared');
  assert.strictEqual(areaFor(f('tests/bin-lib/console/x.test.js')), 'tests');
  assert.strictEqual(areaFor(f('docs/skill-authoring.md')), 'docs');
  assert.strictEqual(areaFor(f('./plugin/skills/tidy/digest-sweep.md')), 'tidy', 'a leading ./ is ignored');
  assert.strictEqual(areaFor(noClaimItem()), 'console');
  assert.strictEqual(areaFor(stagedItem({ name: 'reflect-2.md', section: 'Queue writes' })), 'reflect');
  assert.strictEqual(areaFor(stagedItem({ name: 'tidy-2.md', section: 'Queue writes' })), 'console');
});

// ---- R14: what a digest line says ----

// Real staged files, copied verbatim from archived runs (fixtures/staged/).
const fixture = (name) => readText(path.join(__dirname, 'fixtures', 'staged', name));
const stagedDigest = (stagedName, staged, fixtureName) => dispose(
  stagedItem({ name: stagedName, ...staged }),
  undefined,
  () => fixture(fixtureName),
).digest.entry;

test('#4136: a staged can\'t-tell finding files under its Title: line with its claim and dispositions', () => {
  const [item] = consoleWorkItems({
    consoleDir: CONSOLE_DIR,
    consoleJson: { items: [{ id: 'review-unconfirmed-3.md', section: 'Low-confidence findings', resolution: 'keep-staged', reason: 'r' }] },
    decisions: '',
    readStaged: () => fixture('review-unconfirmed-3880.md'),
    runId: RUN_ID,
  });
  const d = dispose(item, consoleV);
  assert.strictEqual(d.proposal.title, 'decideConsoleExecute skips the sdd-ruling gate when ctx.rulingTexts is absent (fail-open default on an exported pure function)');
  assert.ok(d.proposal.text.includes('`decideConsoleExecute` yields `rulingGateGaps: []` when `ctx.rulingTexts` is absent'), d.proposal.text);
  assert.ok(d.proposal.text.includes('Dispositions: apply'), d.proposal.text);
  assert.doesNotMatch(d.proposal.text, /:unknown\b/);
  assert.doesNotMatch(d.proposal.text, /\(severity /, 'the file states no Severity:');
  assert.strictEqual(d.proposal.fingerprint, findingFingerprint({ lens: '3c', path: 'plugin/bin/lib/reconcile/console-execute.js', claim: item.claimText }));
});

test('R14b: a table-shaped reflect file digests as its first insight, not the table header', () => {
  const e = stagedDigest('reflect-1.md', { section: 'Pending review', reason: 'non-tangential-category:observation' }, 'reflect-table-3877.md');
  assert.ok(e.finding.startsWith('reflect-1.md (non-tangential-category:observation): A prose guard that must fail closed shipped with fail-open edges'), e.finding);
  assert.doesNotMatch(e.finding, /\| # \||Insight \| Causal/);
  assert.ok(e.finding.length <= 200, 'cut at 200 characters');
  assert.strictEqual(e.fileRefs, 'general');
  assert.strictEqual(e.area, 'reflect');
});

test('AC3.2: a legacy reflect observation/convention with no destination digests under reflect-no-destination (#4168)', () => {
  assert.strictEqual(DIGEST_REASONS.REFLECT_NO_DESTINATION, 'reflect-no-destination');
  for (const fixtureName of ['reflect-ledger-3876.md', 'reflect-table-3877.md']) {
    const e = stagedDigest('reflect-1.md', { section: 'Skill updates' }, fixtureName);
    assert.strictEqual(e.deferReason, 'reflect-no-destination', fixtureName);
    assert.ok(e.finding.startsWith('reflect-1.md (Skill updates): '), `${fixtureName}: label and finding text are unchanged (${e.finding})`);
    // The materiality fingerprint omits deferReason: a line already digested under the old reason still dedups.
    assert.strictEqual(
      materialityFingerprint(e),
      materialityFingerprint({ ...e, deferReason: DIGEST_REASONS.UNMAPPED_KIND }),
      fixtureName,
    );
  }
});

test('AC3.2 orthogonal: a reflect file that is not a no-destination observation/convention keeps the unmapped-kind reason (#4168)', () => {
  const reflect = (category, destination) => `# Reflect — staged finding 1\n\n**Category:** ${category}\n${destination}\n## Finding\n\nThe ledger grew.\n`;
  const digestOf = (name, section, text) => dispose(stagedItem({ name, section }), undefined, files({ [name]: text })).digest.entry;
  assert.strictEqual(
    digestOf('reflect-1.md', 'Skill updates', reflect('observation', '**Destination:** decline not worth a record\n')).deferReason,
    DIGEST_REASONS.UNMAPPED_KIND,
    'a destination line that reached the backfill is not the legacy shape',
  );
  assert.strictEqual(digestOf('reflect-1.md', 'Queue writes', reflect('tangential', '')).deferReason, DIGEST_REASONS.UNMAPPED_KIND);
  assert.strictEqual(digestOf('polish-1.md', 'Pending review', reflect('observation', '')).deferReason, DIGEST_REASONS.UNMAPPED_KIND, 'only a reflect- file');
  const unreadable = dispose(stagedItem({ name: 'reflect-1.md', section: 'Skill updates' }), undefined, files({})).digest.entry;
  assert.strictEqual(unreadable.deferReason, DIGEST_REASONS.UNMAPPED_KIND, 'an absent file has no text to judge');
});

test('R14b: an insights table digests as its first data row', () => {
  const e97 = stagedDigest('wrap-up-reflect-insights.md', { section: 'Reflection insights' }, 'wrap-up-reflect-insights-3897.md');
  assert.ok(e97.finding.startsWith('wrap-up-reflect-insights.md (Reflection insights): The plan never consulted `.claude/skills/hooks-js-verb-registration`'), e97.finding);
  assert.doesNotMatch(e97.finding, /\| # \|/);
  const e10 = stagedDigest('wrap-up-reflect-insights.md', { section: 'Reflection insights' }, 'wrap-up-reflect-insights-3810.md');
  assert.ok(e10.finding.startsWith('wrap-up-reflect-insights.md (Reflection insights): Friction: the canonical `verify.js` invocation'), e10.finding);
  assert.doesNotMatch(e10.finding, /Run: 2026|Mode: full/, 'the Run:/Mode: metadata line is skipped');
});

test('R14b: a Ledger:-led reflect file digests as the finding sentence under ## Finding', () => {
  const e = stagedDigest('reflect-1.md', { section: 'Pending review', reason: 'non-tangential-category:convention' }, 'reflect-ledger-3876.md');
  assert.ok(e.finding.startsWith('reflect-1.md (non-tangential-category:convention): `_shared/subagent-dispatch-core.md` line 39 states that'), e.finding);
  assert.doesNotMatch(e.finding, /Ledger:/);
  assert.match(e.fileRefs, /^plugin\/skills\/_shared\/subagent-dispatch-core\.md, /, 'the **Files:** value still names the files');
});

test('R14b: digest text rules on small shapes', () => {
  const text = (body) => dispose(stagedItem({ name: 'tidy-3.md', section: 'Pending review' }), undefined, files({ 'tidy-3.md': body })).digest.entry.finding.replace(/^tidy-3\.md \(Pending review\): ?/, '');
  assert.strictEqual(text('# T\n\n## Finding\n\nfirst line of the paragraph\ncontinues here.\n\nsecond paragraph.\n\n## Other\n\nno\n'), 'first line of the paragraph continues here.', 'the first paragraph under ## Finding');
  assert.strictEqual(text('# T\nLedger: docs/x.md#4\nSource: me\n\nThe real sentence.\n'), 'The real sentence.', 'a Key: value header block is skipped');
  assert.strictEqual(text('**Category:** convention\n\nSource: light\nFiles: a.js\nRun: r\nMode: full\n\nThe real sentence.\n'), 'The real sentence.');
  assert.strictEqual(text('| # | Item | Why |\n|---|------|-----|\n| 1 | Do the thing | — |\n| 2 | Other | y |\n'), 'Do the thing', 'a data row keeps its non-numeric cells');
  assert.strictEqual(text('| a | b |\n|:--|--:|\n| 12 | 3 | x | y |\n'), 'x — y', 'numeric cells are dropped');
  assert.strictEqual(text('Note: a sentence that starts like a key.\n'), 'Note: a sentence that starts like a key.', 'a one-line file keeps its only sentence');
  assert.strictEqual(text('Note: a sentence that starts like a key.'), 'Note: a sentence that starts like a key.', 'with or without the final newline');
  assert.strictEqual(text('Note: a header line\n\nThe body.\n'), 'The body.', 'a Key: value block followed by a blank line and more content is still a header');
  assert.strictEqual(text('---\n\nplain line\n'), 'plain line');
});

test('R14b2: a patch proposal digests as its Finding line, else its Target, and never as a diff line', () => {
  const docs = stagedDigest('docs-1.md', { section: 'Documentation updates' }, 'patch-docs-3520.md');
  assert.ok(docs.finding.startsWith('docs-1.md (Documentation updates): low staleness — Success state still says only a direct file-sharing neighbour'), docs.finding);
  assert.doesNotMatch(docs.finding, /diff --git|@@|```|Target:/);
  // A real file whose header runs straight into the diff with no blank line between.
  const journey = stagedDigest('journey-resolve-a-policy-key-env-layer.md', { section: 'Journey updates' }, 'patch-journey-2567.md');
  assert.ok(journey.finding.includes('moderate staleness/origin-coverage — #2567 added the first environment-variable layer'), journey.finding);
  assert.doesNotMatch(journey.finding, /diff --git|@@|--- a\//);

  const text = (body, name = 'skills-9.md') => dispose(stagedItem({ name, section: 'Skill updates' }), undefined, files({ [name]: body })).digest.entry.finding.replace(new RegExp(`^${name.replace('.', '\\.')} \\(Skill updates\\)(: )?`), '');
  assert.strictEqual(text('Target: docs/REGISTRY.md\nInvariant: the row says opt-in\nStaged-at: 2026-10-15\n\n```diff\ndiff --git a/docs/REGISTRY.md b/docs/REGISTRY.md\n'), 'Target: docs/REGISTRY.md', 'Target is the fallback when there is no Finding');
  assert.strictEqual(text('Target: a.md\nFinding: the real finding\n\n@@ -1 +1 @@\n'), 'the real finding', 'Finding wins over Target');
  for (const diffOnly of ['```diff\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n```\n', '@@ -58,6 +58,7 @@\n-old\n+new\n', 'diff --git a/x b/x\nindex 1a2b..3c4d 100644\n', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n']) {
    assert.strictEqual(text(diffOnly), '', `no diff line becomes digest text: ${diffOnly.split('\n')[0]}`);
  }
  assert.strictEqual(text('An intro sentence.\n\n```diff\ndiff --git a/x b/x\n'), 'An intro sentence.', 'prose before the diff is still used');
  assert.strictEqual(text('An intro sentence.\n\n```diff\n ## Finding\n+an added line\n```\n'), 'An intro sentence.', 'a ## Finding context line inside a diff body is not the section');
});

test('R14b3: a dream proposal digests as its Pattern, not its quoted session lines', () => {
  const e = stagedDigest('dream-proposal-1.md', { section: 'Pending review', reason: 'unmapped-prefix' }, 'dream-proposal-2691.md');
  assert.ok(e.finding.startsWith('dream-proposal-1.md (unmapped-prefix): `Bash` / `cd` — this session is isolated in the worktree'), e.finding);
  assert.doesNotMatch(e.finding, /Session `/);
  const noPattern = dispose(stagedItem({ name: 'dream-proposal-2.md', section: 'Pending review', reason: 'unmapped-prefix' }), undefined, files({
    'dream-proposal-2.md': '# Dream pass — x\n\n## Quoted evidence\n\n- Session `abc` (2026-09-21T18:48:15.289Z):\n  - Command: `ls`\n',
  })).digest.entry.finding;
  assert.doesNotMatch(noPattern, /Session `/, 'a session line is never used as text');
  // Minor 8: nor its indented sub-bullets (they carry commands and local paths).
  assert.strictEqual(noPattern, 'dream-proposal-2.md (unmapped-prefix)');
  // Minor 8: a ## Finding section wins over a **Pattern:** line.
  const both = dispose(stagedItem({ name: 'dream-proposal-3.md', section: 'Pending review', reason: 'unmapped-prefix' }), undefined, files({
    'dream-proposal-3.md': '# Dream pass — x\n\n**Pattern:** the pattern line\n\n## Finding\n\nThe finding paragraph.\n',
  })).digest.entry.finding;
  assert.strictEqual(both, 'dream-proposal-3.md (unmapped-prefix): The finding paragraph.');
});

test('minor 7: a patch proposal digests with its Target as the fileRefs, not general', () => {
  const body = 'Target: docs/REGISTRY.md\nInvariant: the row says opt-in\nStaged-at: 2026-10-15\n\n```diff\ndiff --git a/docs/REGISTRY.md b/docs/REGISTRY.md\n';
  const d = dispose(stagedItem({ name: 'skills-9.md', section: 'Skill updates' }), undefined, files({ 'skills-9.md': body }));
  assert.strictEqual(d.digest.entry.fileRefs, 'docs/REGISTRY.md');
  // Orthogonal: a file with no Target: header keeps `general`.
  assert.strictEqual(dispose(stagedItem({ name: 'tidy-4.md', section: 'Pending review' }), undefined, files({ 'tidy-4.md': '# T\n\nplain line\n' })).digest.entry.fileRefs, 'general');
});

const noClaim = (over = {}) => noClaimItem({
  noClaimReason: 'claim-empty',
  finding: { lens: '3a', path: 'plugin/skills/_shared/materiality-floor.md', line: 94 },
  context: '- STAGED 01:25:25 — Reproduction: lens "3a" finding plugin/skills/_shared/materiality-floor.md:94 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
  ...over,
});

test('R14a: a located no-claim item digests under its file\'s area with path:line', () => {
  const d = dispose(noClaim());
  assert.strictEqual(d.digest.entry.area, '_shared');
  assert.strictEqual(d.digest.entry.fileRefs, 'plugin/skills/_shared/materiality-floor.md:94');
  assert.strictEqual(d.digest.entry.deferReason, DIGEST_REASONS.NO_CLAIM);
  const multi = dispose(noClaim({
    locations: [{ lens: '3f', path: 'plugin/bin/lib/worktree/x.js', line: 168 }, { lens: '3f', path: 'plugin/skills/build/y.md', line: 12 }],
    finding: { lens: '3f', path: 'plugin/bin/lib/worktree/x.js', line: 168 },
  }));
  assert.strictEqual(multi.digest.entry.area, 'worktree');
  assert.strictEqual(multi.digest.entry.fileRefs, 'plugin/bin/lib/worktree/x.js:168, plugin/skills/build/y.md:12');
  const bare = dispose(noClaimItem({ noClaimReason: 'no-path' }));
  assert.strictEqual(bare.digest.entry.area, 'console');
  assert.strictEqual(bare.digest.entry.fileRefs, 'general');
});

test('R14c: a decision-line no-claim digest text drops the log prefix and short step labels', () => {
  const finding = (context) => dispose(noClaim({ context })).digest.entry.finding;
  assert.ok(finding(noClaim().context).startsWith('No claim recoverable (claim-empty): lens "3a" finding plugin/skills/_shared/materiality-floor.md:94 not reproduced.'), finding(noClaim().context));
  assert.ok(!/STAGED|01:25:25/.test(finding(noClaim().context)));
  assert.ok(finding(noClaim().context).endsWith('not reproduced.'), 'the producer\'s closing boilerplate is dropped too');
  assert.strictEqual(
    finding('decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs#a1b2c3d4'),
    'No claim recoverable (claim-empty): full mode (wrap-up): pattern obs',
    'an old-shape console id loses its decision: prefix, its time and its hash',
  );
  assert.ok(finding('- STAGED 06:21:45 — log-decision: Reproduction: lens "3b" findings a.js:3 not reproduced').endsWith(': lens "3b" findings a.js:3 not reproduced'));
  assert.ok(!/log-decision|Reproduction:/.test(finding('- STAGED 06:21:45 — log-decision: Reproduction: lens "3b" findings a.js:3 not reproduced')));
  assert.ok(!/Step 3 reproduction/.test(finding('- STAGED 12:53:49 — Step 3 reproduction: Reproduction: lens 3f finding p.js not reproduced')));
  const longLabel = '- STAGED 10:00:00 — A very long step label of more than forty characters: the rest of the line';
  assert.ok(finding(longLabel).includes('A very long step label of more than forty characters: the rest'), 'a label of 40+ characters is kept');
  assert.ok(!/STAGED/.test(finding(longLabel)));
  assert.ok(finding('decision:- STAGED abc#1234').includes('decision:- STAGED abc#1234'), 'a context without a log prefix is untouched');
});

// ---- planBatch ----

const workList = (...runs) => ({ mainSha: MAIN_SHA, runs: runs.map((items, i) => ({ runDir: `/x/pipelines/archive/run-${i}`, items })) });
const plan = (over) => planBatch({
  workList: workList([]), verdicts: {}, existingIssues: [], digestComments: [], ...over,
});

test('planBatch walks runs in order, stamps each entry with its run dir, and routes by disposition', () => {
  const a = findingItem({ itemId: 'bf:a', itemHash: 'ha' });
  const b = findingItem({ itemId: 'bf:b', itemHash: 'hb', finding: { ...findingItem().finding, path: 'plugin/skills/tidy/SKILL.md' } });
  const c = noClaimItem({ itemId: 'bf:c', itemHash: 'hc' });
  const d = findingItem({ itemId: 'bf:d', itemHash: 'hd', finding: { ...findingItem().finding, path: 'src/z.js' } });
  const out = plan({
    workList: workList([a, c], [b, d]),
    verdicts: { 'bf:a': confirmed(), 'bf:b': dropV, 'bf:d': digestV },
  });
  assert.deepStrictEqual(out.dispositions.map((x) => x.itemId), ['bf:a', 'bf:c', 'bf:b', 'bf:d']);
  assert.deepStrictEqual(out.file.map((x) => x.itemId), ['bf:a']);
  assert.deepStrictEqual(Object.keys(out.file[0]).sort(), ['fingerprint', 'itemId', 'text', 'title']);
  assert.strictEqual(out.digest.lines.length, 2);
  assert.deepStrictEqual(out.digest.duplicates, []);
  assert.deepStrictEqual(out.entries, [
    { runDir: '/x/pipelines/archive/run-0', itemId: 'bf:a', itemHash: 'ha', outcome: 'filed', source: 'tiebreak', ref: null },
    { runDir: '/x/pipelines/archive/run-0', itemId: 'bf:c', itemHash: 'hc', outcome: 'digested', source: 'digest', ref: null },
    { runDir: '/x/pipelines/archive/run-1', itemId: 'bf:b', itemHash: 'hb', outcome: 'dropped', source: 'tiebreak', ref: 'plugin/skills/review/SKILL.md:12 "guard(x); read(x);"' },
    { runDir: '/x/pipelines/archive/run-1', itemId: 'bf:d', itemHash: 'hd', outcome: 'digested', source: 'tiebreak', ref: null },
  ]);
  assert.deepStrictEqual(out.awaitingVerdict, []);
});

test('planBatch uses the work list\'s mainSha and the console\'s run id in what it composes', () => {
  const nested = findingItem({ itemId: 'bf:n', consoleDir: '/x/pipelines/2026-10-24T090000-spec-12/spec-3946' });
  const out = plan({ workList: workList([nested]), verdicts: { 'bf:n': confirmed() } });
  assert.ok(out.file[0].text.includes(MAIN_SHA));
  assert.ok(out.file[0].text.includes('2026-10-24T090000-spec-12/spec-3946'), 'runIdOf names the spec directory');
});

test('planBatch lists a finding with no verdict as awaiting, and does not throw', () => {
  const a = findingItem({ itemId: 'bf:a' });
  const b = noClaimItem({ itemId: 'bf:b' });
  const out = plan({ workList: workList([a, b]), verdicts: {} });
  assert.deepStrictEqual(out.awaitingVerdict, ['bf:a']);
  assert.deepStrictEqual(out.dispositions.map((x) => x.itemId), ['bf:b']);
  assert.deepStrictEqual(out.entries.map((x) => x.itemId), ['bf:b']);
});

test('planBatch settles a no-verdict finding whose record already exists as a reuse, never awaiting (R10a)', () => {
  const a = findingItem({ itemId: 'bf:a', itemHash: 'ha' });
  const fp = findingFingerprint({ lens: '3a', path: a.finding.path, claim: a.claimText });
  const out = plan({
    workList: workList([a]),
    verdicts: {},
    existingIssues: [{ number: 4021, body: `Some record.\n<!-- work-fingerprint: ${fp} -->` }],
  });
  assert.deepStrictEqual(out.awaitingVerdict, []);
  assert.deepStrictEqual(out.file, []);
  assert.deepStrictEqual(out.reuse, [{ itemId: 'bf:a', number: 4021 }]);
  assert.deepStrictEqual(out.entries, [{ runDir: '/x/pipelines/archive/run-0', itemId: 'bf:a', itemHash: 'ha', outcome: 'filed', source: 'tiebreak', ref: '#4021' }]);
  assert.strictEqual(out.dispositions.length, 1, 'it takes a slot');
});

test('planBatch keeps a no-verdict finding awaiting when only an unrelated record exists (R10a, orthogonal)', () => {
  const a = findingItem({ itemId: 'bf:a' });
  const other = findingFingerprint({ lens: '3a', path: 'some/other/file.js', claim: a.claimText });
  const out = plan({
    workList: workList([a]),
    verdicts: {},
    existingIssues: [{ number: 9, body: `<!-- work-fingerprint: ${other} -->` }],
  });
  assert.deepStrictEqual(out.awaitingVerdict, ['bf:a']);
  assert.deepStrictEqual(out.reuse, []);
  assert.deepStrictEqual(out.entries, []);
});

test('planBatch settles a no-verdict finding whose digest line a trusted comment carries as digested, whichever verdict digested it (N2)', () => {
  const a = findingItem({ itemId: 'bf:a', itemHash: 'ha' });
  // The line an earlier, interrupted run posted: a can't-tell digest and a confirmed-low one differ only in Defer-reason.
  for (const verdict of [digestV, confirmed('low')]) {
    const line = plan({ workList: workList([a]), verdicts: { 'bf:a': verdict } }).digest.lines[0];
    assert.ok(line, 'the verdict digests');
    const out = plan({ workList: workList([a]), verdicts: {}, digestComments: [{ body: line, authorAssociation: 'OWNER' }] });
    assert.deepStrictEqual(out.awaitingVerdict, [], line);
    assert.deepStrictEqual(out.digest.duplicates, ['bf:a']);
    assert.deepStrictEqual(out.digest.lines, []);
    assert.deepStrictEqual(out.file, []);
    assert.strictEqual(out.dispositions.length, 1, 'it takes a slot');
    assert.deepStrictEqual(out.entries, [{ runDir: '/x/pipelines/archive/run-0', itemId: 'bf:a', itemHash: 'ha', outcome: 'digested', source: 'tiebreak', ref: null }]);
  }
});

test('planBatch keeps a no-verdict finding awaiting without a trusted matching digest line (N2, orthogonal)', () => {
  const a = findingItem({ itemId: 'bf:a' });
  const line = plan({ workList: workList([a]), verdicts: { 'bf:a': digestV } }).digest.lines[0];
  const awaiting = (digestComments) => plan({ workList: workList([a]), verdicts: {}, digestComments }).awaitingVerdict;
  assert.deepStrictEqual(awaiting([]), ['bf:a'], 'no comment');
  assert.deepStrictEqual(awaiting([{ body: line, authorAssociation: 'NONE' }]), ['bf:a'], 'an untrusted comment never counts');
  const elsewhere = plan({ workList: workList([findingItem({ itemId: 'bf:b', finding: { ...a.finding, line: 40, path: 'src/elsewhere.js' } })]), verdicts: { 'bf:b': digestV } }).digest.lines[0];
  assert.deepStrictEqual(awaiting([{ body: elsewhere, authorAssociation: 'OWNER' }]), ['bf:a'], 'another finding\'s line');
});

// I1: a record or digest line landed before a crashed apply is found by the item's own marker when the
// claim heuristics changed in between, so the claim-keyed fingerprint no longer matches.
test('I1: a record filed under one claim is reused, not twinned, after the item\'s claim changes', () => {
  const before = findingItem({ itemId: 'bf:00000000000000d1', itemHash: 'hd1', claimText: 'The guard runs after the read' });
  const after = { ...before, claimText: 'the guard runs after the read (as a later cleaner leaves it)' };
  const filed = plan({ workList: workList([before]), verdicts: { [before.itemId]: confirmed() } }).file[0];
  assert.ok(filed.text.includes(`work-fingerprint: ${backfillFingerprint(before.itemId)}`), 'the filing carries its item marker');
  assert.strictEqual(extractFingerprint(filed.text), filed.fingerprint, 'the claim fingerprint stays the marker extractFingerprint reads');
  const existingIssues = [{ number: 4120, title: filed.title, body: filed.text.split('\n\n').slice(1).join('\n\n') }];
  assert.notStrictEqual(findingFingerprint({ lens: '3a', path: after.finding.path, claim: after.claimText }), filed.fingerprint, 'precondition: the claim fingerprint moved');
  for (const verdicts of [{ [after.itemId]: confirmed() }, {}]) {
    const out = plan({ workList: workList([after]), verdicts, existingIssues });
    assert.deepStrictEqual(out.file, [], JSON.stringify(verdicts));
    assert.deepStrictEqual(out.reuse, [{ itemId: after.itemId, number: 4120 }]);
    assert.deepStrictEqual(out.entries.map((e) => [e.outcome, e.ref]), [['filed', '#4120']]);
  }
  // Orthogonal: another item's marker never matches.
  const other = { ...after, itemId: 'bf:00000000000000d2' };
  const out = plan({ workList: workList([other]), verdicts: { [other.itemId]: confirmed() }, existingIssues });
  assert.deepStrictEqual(out.reuse, []);
  assert.deepStrictEqual(out.file.map((f) => f.itemId), [other.itemId]);
});

test('I1: a finding digested under one claim is a digest duplicate, not a second line, after the claim changes', () => {
  const before = findingItem({ itemId: 'bf:00000000000000e1', itemHash: 'he1' });
  const after = { ...before, claimText: 'The guard runs after the read, as a later cleaner leaves it' };
  const line = plan({ workList: workList([before]), verdicts: { [before.itemId]: digestV } }).digest.lines[0];
  assert.ok(line.includes(`<!-- consolebackfill-item: ${backfillFingerprint(before.itemId)} -->`), line);
  assert.deepStrictEqual(parseMaterialityFingerprints(line).length, 1, 'still one materiality marker on the line');
  assert.match(line, / — [^ ]+ <!-- materiality-fingerprint: \S+ --> <!-- consolebackfill-item: \S+ -->$/, '{provenance} stays the bare run id; the item marker trails the materiality marker');
  const digestComments = [{ body: line, authorAssociation: 'OWNER', url: 'https://x/issues/1426#issuecomment-1' }];
  for (const verdicts of [{ [after.itemId]: digestV }, {}]) {
    const out = plan({ workList: workList([after]), verdicts, digestComments });
    assert.deepStrictEqual(out.digest.lines, [], JSON.stringify(verdicts));
    assert.deepStrictEqual(out.digest.duplicates, [after.itemId]);
    assert.deepStrictEqual(out.awaitingVerdict, []);
  }
  // Orthogonal: another item, and an untrusted comment, never match.
  const other = { ...after, itemId: 'bf:00000000000000e2' };
  assert.deepStrictEqual(plan({ workList: workList([other]), verdicts: { [other.itemId]: digestV }, digestComments }).digest.duplicates, []);
  assert.deepStrictEqual(plan({ workList: workList([after]), verdicts: {}, digestComments: [{ ...digestComments[0], authorAssociation: 'NONE' }] }).awaitingVerdict, [after.itemId]);
});

test('planBatch accepts the verdicts as a Map too', () => {
  const out = plan({ workList: workList([findingItem({ itemId: 'bf:a' })]), verdicts: new Map([['bf:a', dropV]]) });
  assert.strictEqual(out.dispositions[0].action, 'drop');
});

test('planBatch stops after the limit, counting dispositions only', () => {
  const items = [findingItem({ itemId: 'bf:x' }), ...['1', '2', '3', '4'].map((n) => noClaimItem({ itemId: `bf:n${n}`, itemHash: `h${n}` }))];
  const out = plan({ workList: workList(items.slice(0, 3), items.slice(3)), limit: 3 });
  assert.deepStrictEqual(out.dispositions.map((x) => x.itemId), ['bf:n1', 'bf:n2', 'bf:n3'], 'the awaiting finding takes no slot');
  assert.deepStrictEqual(out.awaitingVerdict, ['bf:x']);
  assert.strictEqual(plan({ workList: workList(items.slice(1)) }).dispositions.length, 4, 'the default limit is 24');
  const many = Array.from({ length: 30 }, (_, i) => noClaimItem({ itemId: `bf:m${i}`, itemHash: `h${i}`, context: `line ${i}` }));
  assert.strictEqual(plan({ workList: workList(many) }).dispositions.length, 24);
});

test('planBatch dedups against an existing record', () => {
  const a = findingItem({ itemId: 'bf:a' });
  const fp = findingFingerprint({ lens: '3a', path: a.finding.path, claim: a.claimText });
  const out = plan({
    workList: workList([a]),
    verdicts: { 'bf:a': confirmed() },
    existingIssues: [{ number: 4021, body: `Some record.\n<!-- work-fingerprint: ${fp} -->` }],
  });
  assert.deepStrictEqual(out.file, []);
  assert.deepStrictEqual(out.reuse, [{ itemId: 'bf:a', number: 4021 }]);
  assert.deepStrictEqual(out.entries, [{ runDir: '/x/pipelines/archive/run-0', itemId: 'bf:a', itemHash: 'h1', outcome: 'filed', source: 'tiebreak', ref: '#4021' }]);
});

test('planBatch points a second item with the same fingerprint at the first', () => {
  const a = findingItem({ itemId: 'bf:a', itemHash: 'ha' });
  const b = findingItem({ itemId: 'bf:b', itemHash: 'hb', finding: { ...a.finding, line: 400 } });
  const out = plan({ workList: workList([a, b]), verdicts: { 'bf:a': confirmed(), 'bf:b': consoleV } });
  assert.deepStrictEqual(out.file.map((x) => x.itemId), ['bf:a']);
  assert.deepStrictEqual(out.reuse, [{ itemId: 'bf:b', number: null, sameAs: 'bf:a' }]);
  assert.strictEqual(out.entries[1].ref, null);
  assert.strictEqual(out.entries[1].outcome, 'filed');
});

test('planBatch dedups a digest entry already posted by a trusted author', () => {
  const item = noClaimItem({ itemId: 'bf:a' });
  const line = plan({ workList: workList([item]) }).digest.lines[0];
  assert.ok(line);
  const url = 'https://github.com/o/r/issues/1426#issuecomment-6383105671';
  const owner = plan({ workList: workList([item]), digestComments: [{ body: line, authorAssociation: 'OWNER', url }] });
  assert.deepStrictEqual(owner.digest.duplicates, ['bf:a']);
  assert.deepStrictEqual(owner.digest.lines, []);
  assert.deepStrictEqual(owner.entries, [{ runDir: '/x/pipelines/archive/run-0', itemId: 'bf:a', itemHash: 'h2', outcome: 'digested', source: 'digest', ref: url }], 'a duplicate settles with the URL of the comment holding its entry (M1)');
  const stranger = plan({ workList: workList([item]), digestComments: [{ body: line, authorAssociation: 'NONE' }] });
  assert.deepStrictEqual(stranger.digest.duplicates, []);
  assert.deepStrictEqual(stranger.digest.lines, [line]);
});

test('planBatch folds two identical digest entries in one batch into one line', () => {
  const a = noClaimItem({ itemId: 'bf:a', itemHash: 'ha' });
  const b = noClaimItem({ itemId: 'bf:b', itemHash: 'hb' });
  const out = plan({ workList: workList([a, b]) });
  assert.strictEqual(out.digest.lines.length, 1);
  assert.deepStrictEqual(out.digest.duplicates, ['bf:b']);
  assert.strictEqual(out.entries.length, 2);
  // M1: the twin's ref is the comment its line is posted in, resolved from `sameAs` as a filing's is.
  assert.deepStrictEqual(out.digest.sameAs, [{ itemId: 'bf:b', sameAs: 'bf:a' }]);
  assert.deepStrictEqual(out.entries.map((e) => e.ref), [null, null]);
});

test('M1: a finding\'s prefiled digest duplicate carries the holding comment\'s URL as its ref', () => {
  const a = findingItem({ itemId: 'bf:a', itemHash: 'ha' });
  const line = plan({ workList: workList([a]), verdicts: { 'bf:a': digestV } }).digest.lines[0];
  const url = 'https://github.com/o/r/issues/1426#issuecomment-2';
  const digestComments = [{ body: 'unrelated', authorAssociation: 'OWNER', url: 'https://github.com/o/r/issues/1426#issuecomment-1' }, { body: line, authorAssociation: 'MEMBER', url }];
  for (const verdicts of [{}, { 'bf:a': digestV }]) {
    const out = plan({ workList: workList([a]), verdicts, digestComments });
    assert.deepStrictEqual(out.entries.map((e) => [e.itemId, e.outcome, e.ref]), [['bf:a', 'digested', url]], JSON.stringify(verdicts));
  }
});

test('planBatch reads staged files through the readStaged it is given', () => {
  const text = 'Title: Queue me\nType: task\nLabels: needs:definition\n\nbody\n';
  const seen = [];
  const out = plan({
    workList: workList([stagedItem({ name: 'leftover-1.md', section: 'Queue writes' })]),
    readStaged: (dir, name) => { seen.push([dir, name]); return text; },
  });
  assert.deepStrictEqual(seen, [[CONSOLE_DIR, 'leftover-1.md']]);
  assert.ok(out.file[0].text.startsWith(text));
  assert.strictEqual(out.file[0].fingerprint, backfillFingerprint('bf:0000000000000003'));
});

test('planBatch dedups a fingerprint-less filing against a record carrying its minted marker', () => {
  const shadow = stagedItem({ name: 'x-1.md.shadow-dup', section: 'Queue writes', outcome: 'shadow-dup-collision' }, { itemId: 'bf:00000000000000a1' });
  const queue = stagedItem({ name: 'leftover-1.md', section: 'Queue writes' }, { itemId: 'bf:00000000000000a2' });
  const rs = files({ 'x-1.md.shadow-dup': 'COPY\n', 'leftover-1.md': 'Title: Queue me\nType: task\n\nbody\n' });
  const first = plan({ workList: workList([shadow, queue]), readStaged: rs });
  assert.strictEqual(first.file.length, 2, 'no record yet: both are new');
  const existing = first.file.map((f, i) => ({ number: 500 + i, body: `Filed earlier.\n\n${f.text.split('\n\n').slice(1).join('\n\n')}` }));
  const again = plan({ workList: workList([shadow, queue]), existingIssues: existing, readStaged: rs });
  assert.deepStrictEqual(again.file, [], 'a crash between filing and apply re-runs into a dedup hit, never a twin');
  assert.deepStrictEqual(again.reuse, [{ itemId: 'bf:00000000000000a1', number: 500 }, { itemId: 'bf:00000000000000a2', number: 501 }]);
  assert.deepStrictEqual(again.entries.map((e) => e.ref), ['#500', '#501']);
});

// R15: a proposal filed before the backfill existed carries no marker, so its minted fingerprint matches
// nothing; the exact title of the record it became is the only join.
const QUEUE_TITLE = 'Reconcile archives a live run when an earlier PR… merged';
const queueProposal = (title = QUEUE_TITLE) => `Title: ${title}\nType: task\nLabels: needs:definition\n\nbody\n`;
const planQueue = (existingIssues, text = queueProposal()) => plan({
  workList: workList([stagedItem({ name: 'reconcile-live-run-archived.md', section: 'Queue writes' }, { itemId: 'bf:00000000000000b1' })]),
  existingIssues,
  readStaged: files({ 'reconcile-live-run-archived.md': text }),
});

test('R15: a minted-fingerprint proposal settles as reuse when an existing record has its exact title', () => {
  const out = planQueue([{ number: 3416, title: QUEUE_TITLE, body: 'Filed 2026-10-17, no marker.' }]);
  assert.deepStrictEqual(out.file, []);
  assert.deepStrictEqual(out.reuse, [{ itemId: 'bf:00000000000000b1', number: 3416 }]);
  assert.deepStrictEqual(out.entries, [{ runDir: '/x/pipelines/archive/run-0', itemId: 'bf:00000000000000b1', itemHash: 'h3', outcome: 'filed', source: 'staged-kind', ref: '#3416' }]);
  const shadow = plan({
    workList: workList([stagedItem({ name: 'x-1.md.shadow-dup', section: 'Queue writes', outcome: 'shadow-dup-collision' })]),
    existingIssues: [{ number: 77, title: 'Reconcile staged copy x-1.md.shadow-dup', body: '' }],
    readStaged: files({ 'x-1.md.shadow-dup': 'COPY\n' }),
  });
  assert.deepStrictEqual(shadow.reuse.map((r) => r.number), [77], 'a shadow-dup reconcile record is title-matched too');
});

test('R15: a different existing title stays a new filing', () => {
  const out = planQueue([{ number: 3416, title: 'Some other record', body: '' }, { number: 3417, title: QUEUE_TITLE.toLowerCase(), body: '' }]);
  assert.deepStrictEqual(out.reuse, []);
  assert.deepStrictEqual(out.file.map((f) => f.itemId), ['bf:00000000000000b1'], 'the match is case-sensitive');
});

test('R15: a whitespace-only difference in the title still matches', () => {
  const out = planQueue([{ number: 3414, title: `  ${QUEUE_TITLE.replace(/ /g, '  ')}\t`, body: '' }], queueProposal(`  ${QUEUE_TITLE}  `));
  assert.deepStrictEqual(out.reuse, [{ itemId: 'bf:00000000000000b1', number: 3414 }]);
  assert.deepStrictEqual(out.file, []);
});

test('R15 control: a proposal with its own marker is never title-matched', () => {
  const marked = `Title: ${QUEUE_TITLE}\nType: task\n\nbody\n<!-- work-fingerprint: tidy-abcd1234 -->\n`;
  const out = planQueue([{ number: 3416, title: QUEUE_TITLE, body: 'other fingerprint <!-- work-fingerprint: tidy-ffffffff -->' }], marked);
  assert.deepStrictEqual(out.reuse, []);
  assert.strictEqual(out.file.length, 1);
  const same = planQueue([{ number: 3416, title: 'unrelated', body: 'x <!-- work-fingerprint: tidy-abcd1234 -->' }], marked);
  assert.deepStrictEqual(same.reuse, [{ itemId: 'bf:00000000000000b1', number: 3416 }], 'its own marker still dedups by fingerprint');
});

test('R15 control: a finding filing is never title-matched, only fingerprint-matched', () => {
  const item = findingItem({ itemId: 'bf:00000000000000c1' });
  const title = dispose(item, consoleV).proposal.title;
  const out = plan({ workList: workList([item]), verdicts: { 'bf:00000000000000c1': consoleV }, existingIssues: [{ number: 9, title, body: 'a different record <!-- work-fingerprint: consolefinding-00000000 -->' }] });
  assert.deepStrictEqual(out.reuse, []);
  assert.deepStrictEqual(out.file.map((f) => f.itemId), ['bf:00000000000000c1']);
});

test('a staged name that climbs out of the staged directory is never read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-dispose-'));
  try {
    fs.mkdirSync(path.join(root, 'staged'));
    fs.writeFileSync(path.join(root, 'secret.md'), 'Title: from outside\nType: task\n\nbody\n');
    for (const name of ['../secret.md', '..', 'a/../../secret.md']) {
      const d = disposeItem({
        item: stagedItem({ name, section: 'Queue writes' }, { consoleDir: root }), runId: RUN_ID, mainSha: MAIN_SHA,
      });
      assert.strictEqual(d.action, 'digest', `${name} routes to the digest as unmapped, unread`);
      assert.strictEqual(d.digest.entry.deferReason, DIGEST_REASONS.UNMAPPED_KIND);
      assert.ok(!d.digest.entry.finding.includes('from outside'), name);
    }
    fs.writeFileSync(path.join(root, 'staged', 'ok-1.md'), 'Title: inside\nType: task\n\nbody\n');
    const inside = disposeItem({ item: stagedItem({ name: 'ok-1.md', section: 'Queue writes' }, { consoleDir: root }), runId: RUN_ID, mainSha: MAIN_SHA });
    assert.strictEqual(inside.action, 'file', 'the default reader still reads a plain staged name');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
