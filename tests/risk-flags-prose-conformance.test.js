// tests/risk-flags-prose-conformance.test.js — pins #4618's /specify wiring for the
// record flag line: shaping-mode-stamping.md's `### Risk flags` section (the one
// canonical procedure), its Compose-then-write-once ordering, shaping-mode.md's
// born-ready paragraph (Reading B: an explicit single-record run still settles an
// already-shaped record; every batch path leaves it untouched, AC6),
// record-creation-subissues.md's per-unit deltas, and spec-template.md's metadata
// lines. Reads the live skill files — this pins prose we just wrote, not a
// third-party fact (skill-prose-conformance-tests' live-vs-fixture distinction),
// mirroring tests/plan-audit-check-g-prose.test.js. One assertion function per
// concern; every pin has a go-red control that runs the same function against text
// with that one literal removed, and a pin scoped to a section, item or paragraph
// also has a scoping control: the literal moved to the end of its file must still
// fail. The prose scans match the quoted house command form
// (`node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" settle …`).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'plugin', 'skills');
const SHAPING = 'plugin/skills/specify/shaping-mode-stamping.md';
const SHAPING_MODE = 'plugin/skills/specify/shaping-mode.md';
const SUBISSUES = 'plugin/skills/specify/record-creation-subissues.md';
const TEMPLATE = 'plugin/skills/specify/spec-template.md';
const REFINE = 'plugin/skills/backlog/refine-mode.md';
const read = (rel) => readText(path.join(ROOT, rel));

const LIVE = {
  stamping: read(SHAPING), shapingMode: read(SHAPING_MODE), subissues: read(SUBISSUES), template: read(TEMPLATE),
  handoff: read('plugin/skills/specify/mechanical-handoff.md'),
};

const REMOVAL = 'Risk flag {slug} removed by the maintainer during shaping';
const SETTLE_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" settle';
const CLASSIFY_CALL = '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" classify';
const NOOP_ANCHOR = 'never report it `already shaped, no-op`';
// A closing `"`, `'` or backtick may sit between the script name and the verb.
const VERB_RE = /risk-flags\.js["'`]?\s+(classify|settle|confirm)/g;

// Region helpers. A region that cannot be found yields '' so its pins fail by name.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? '' : text.slice(start, end);
}
const lineStarting = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) || '';
const riskSection = (stamping) => between(stamping, '\n### Risk flags\n', '\n### Stamp scoring and stage labels\n');
const riskItem = (stamping, n) => lineStarting(riskSection(stamping), `${n}. `);
const batchParagraph = (stamping) => lineStarting(riskSection(stamping), '**On a comma-list or range batch,**');
const composeSection = (stamping) => between(stamping, '\n### Compose-then-write-once\n', '\n**Split across two files');
// The slice tests/specify-shaping-noop-check.test.js takes, whitespace-flattened the same way.
const bornReady = (shapingMode) => between(shapingMode.replace(/\s+/g, ' '), "Absorb the record's existing content", '**Feedback-filing deliverable check.**');
const subissuesParagraph = (subissues) => lineStarting(subissues, '**Risk flags**');
const checkParagraph = (stamping) => lineStarting(composeSection(stamping), '`--check` (#2827)');
const localCommitLine = (stamping) => lineStarting(composeSection(stamping), 'then commit — a local record is a tracked file');
const templateHead = (template) => between(template, '# Record Body Template', '\n## Overview\n');
const templateParagraph = (template) => lineStarting(templateHead(template), '`Risk-flags:` and `Risk-flags-unconfirmed:`');

// [label, file key, region(texts), literal]
function missing(pins, texts) {
  const out = [];
  for (const [label, , region, literal] of pins) {
    if (!region(texts).includes(literal)) out.push(`${label}: ${literal}`);
  }
  return out;
}
function fail(concern, failures) {
  assert.deepStrictEqual(failures, [], `${concern}: ${failures.join('; ')}`);
}

const item3 = (t) => riskItem(t.stamping, 3);
const SHAPING_PINS = [
  ['Risk flags step 1', 'stamping', (t) => riskItem(t.stamping, 1), CLASSIFY_CALL],
  ['Risk flags step 1', 'stamping', (t) => riskItem(t.stamping, 1), 'you may add, never drop'],
  ['Risk flags step 1', 'stamping', (t) => riskItem(t.stamping, 1), '`_shared/untrusted-record-content.md`'],
  ['Risk flags step 3', 'stamping', item3, SETTLE_CALL],
  ['Risk flags step 3', 'stamping', item3, '--answers-file'],
  ['Risk flags step 3', 'stamping', item3, '--prior-body-file'],
  ['Risk flags step 3', 'stamping', item3, '--add'],
  ['Risk flags step 3', 'stamping', item3, 'multiSelect: true'],
  ['Risk flags step 3', 'stamping', item3, 'one `AskUserQuestion`'],
  ['Risk flags step 3', 'stamping', item3, 'confirmed or not'],
  ['Risk flags step 3', 'stamping', item3, '`kept`'],
  ['Risk flags step 3', 'stamping', item3, '`entry.status` is `unknown`'],
  ['Risk flags step 3', 'stamping', item3, 'more than four flags'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), REMOVAL],
];
function assertShaping(texts) { fail('interactive Risk flags prose', missing(SHAPING_PINS, texts)); }

const HEADLESS_PINS = [
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), 'Headless means no human is reachable'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), '`/claude-tweaks:specify --chained`'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), 'a dispatch-bound or Routine run'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), "bare drain's entry path"],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), 'errors, times out or is auto-answered'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), 'The fail direction is always keep'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), '`_shared/auto-mode-contract.md`'],
  ['Risk flags step 3', 'stamping', item3, 'errors, times out or is auto-answered takes step 4'],
  ['Risk flags step 4', 'stamping', (t) => riskItem(t.stamping, 4), SETTLE_CALL],
  ['Risk flags step 4', 'stamping', (t) => riskItem(t.stamping, 4), '--headless'],
  ['Risk flags step 4', 'stamping', (t) => riskItem(t.stamping, 4), 'removes nothing'],
];
function assertHeadless(texts) { fail('headless Risk flags prose', missing(HEADLESS_PINS, texts)); }

const REFUSED_PINS = [
  ['Risk flags step 3', 'stamping', item3, 'When `refused` is not `null`'],
  ['Risk flags step 3', 'stamping', item3, 'must be repaired first'],
  ['Risk flags step 3', 'stamping', item3, '`refused.reason`'],
  ['Risk flags step 3', 'stamping', item3, '`malformed`'],
  ['Risk flags step 3', 'stamping', item3, '`unknown-slug`'],
  ['Risk flags step 3', 'stamping', item3, 'A `null` reason'],
  ['Risk flags step 3', 'stamping', item3, 'Never log a removal for a `refused` run'],
];
function assertRefusedShaping(texts) { fail('refused-settle prose', missing(REFUSED_PINS, texts)); }

const LOGGING_PINS = [
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), '`logged: true`'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), '`logged: false`'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'no run dir'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'nothing to log'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), '`_shared/github-write-transport.md`'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'under `local-files`'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), "body's `## Gotchas`"],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'after the create'],
  // Final review finding 3: a removal is logged only after the record write lands.
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'only once the record write has landed'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'never for a `refused` run or a failed write'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), '"${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" log-removals --run "$PIPELINE_RUN_DIR" --site specify --removed {removed}'],
  ['Risk flags step 3', 'stamping', item3, 'logs nothing: a removal is logged in step 5, once the record write lands'],
  ['Compose --check paragraph', 'stamping', (t) => checkParagraph(t.stamping), 'Once `gh issue edit` succeeds, `### Risk flags` step 5 logs the removals; a failed edit logs none'],
  ['Compose local-files commit line', 'stamping', (t) => localCommitLine(t.stamping), 'once `writeRecord` succeeds, run `### Risk flags` step 5'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'never for a unit whose create failed'],
];
// Neither writing verb takes --run any more, so a `--run` in step 3 is a log ahead of the write.
const loggingShapeFailures = (texts) => (item3(texts).includes('--run') ? ['Risk flags step 3: settle passes no --run'] : []);
function assertLogging(texts) { fail('removal-logging prose', [...missing(LOGGING_PINS, texts), ...loggingShapeFailures(texts)]); }

const BATCH_QUESTION_PINS = [
  ['Risk flags batch paragraph', 'stamping', (t) => batchParagraph(t.stamping), 'one batch table and one `AskUserQuestion`'],
  ['Risk flags batch paragraph', 'stamping', (t) => batchParagraph(t.stamping), 'held per record'],
  ['Risk flags batch paragraph', 'stamping', (t) => batchParagraph(t.stamping), 'per-record loop'],
];
function assertBatchQuestion(texts) { fail('batch flag-question prose', missing(BATCH_QUESTION_PINS, texts)); }

const COMPOSE_SETTLE = 'run `### Risk flags` (above) on it';
function orderFailures(stamping) {
  const out = [];
  const meta = stamping.indexOf('\n### Metadata block\n');
  const risk = stamping.indexOf('\n### Risk flags\n');
  const stamp = stamping.indexOf('\n### Stamp scoring and stage labels\n');
  if (risk === -1 || meta === -1 || !(meta < risk)) out.push('order: ### Risk flags after ### Metadata block');
  if (risk === -1 || stamp === -1 || !(risk < stamp)) out.push('order: ### Risk flags before ### Stamp scoring');
  const compose = composeSection(stamping);
  const fence = between(compose, '```\n', '\n```');
  const flagLine = fence.indexOf('Risk-flags: {value}');
  const current = fence.indexOf('## Current State');
  if (flagLine === -1 || current === -1 || !(flagLine < current)) out.push('order: assembly lists Risk-flags: above ## Current State');
  if (!fence.includes('Risk-flags-unconfirmed: true')) out.push('assembly: Risk-flags-unconfirmed: true');
  const settle = compose.indexOf(COMPOSE_SETTLE);
  const check = compose.indexOf('compose-record.js" --check');
  if (settle === -1 || check === -1 || !(settle < check)) out.push('order: Risk flags settle before compose-record.js --check');
  return out;
}
function assertOrder(stamping) { fail('Risk flags ordering', orderFailures(stamping)); }

const DECOMPOSITION_PINS = [
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), "`shaping-mode-stamping.md`'s `### Risk flags`"],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'pre-pass'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'before the first create'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'one `AskUserQuestion`'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'held per unit'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), '`settle` runs inside this per-sub-issue loop'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'before the create call'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), '--prior-body-file'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'after the create'],
];
function decompositionFailures(subissues) {
  const out = missing(DECOMPOSITION_PINS, { subissues });
  const premise = subissues.indexOf('\n**Premise verification (#1769)**');
  const risk = subissues.indexOf('\n**Risk flags**');
  const ceremony = subissues.indexOf('\n**Ceremony**');
  // The create fence's call itself; earlier prose names `gh issue create` in passing.
  const create = subissues.indexOf('SUB_ISSUE_URL=$(gh issue create');
  if (risk === -1 || premise === -1 || !(premise < risk)) out.push('order: **Risk flags** after **Premise verification**');
  if (risk === -1 || ceremony === -1 || !(risk < ceremony)) out.push('order: **Risk flags** before **Ceremony**');
  if (risk === -1 || create === -1 || !(risk < create)) out.push('order: **Risk flags** before the create call');
  return out;
}
function assertDecomposition(subissues) { fail('decomposition Risk flags prose', decompositionFailures(subissues)); }

const NOOP_LITERALS = [
  'an explicit single-record invocation',
  'a range with equal bounds',
  '`#N --chained`',
  "`shaping-mode-stamping.md`'s `### Risk flags`",
  'reports `shaped`',
  'stays `already shaped, no-op`',
];
function noopFailures(shapingMode) {
  const para = bornReady(shapingMode);
  const anchor = para.indexOf(NOOP_ANCHOR);
  const out = [];
  if (anchor === -1) out.push(`born-ready paragraph: ${NOOP_ANCHOR}`);
  for (const literal of NOOP_LITERALS) {
    const at = para.indexOf(literal, anchor === -1 ? 0 : anchor);
    if (at === -1) out.push(`born-ready paragraph, after the no-op sentence: ${literal}`);
  }
  return out;
}
function assertSingleRecordNoop(shapingMode) { fail('Reading B prose', noopFailures(shapingMode)); }

const BORN_READY_BATCH = ['a comma list', 'a range with `A < B`', 'bare drain', '`--budget`', '`next`', '`--source sweep`', 'moves on untouched'];
const ITEM6_BATCH = ['a comma-list or range element', 'a bare-drain shape', '`--budget`', '`next`', '`--source sweep`', 'never run it on an exit-0 record'];
function batchExclusionFailures(shapingMode, stamping) {
  const out = [];
  const para = bornReady(shapingMode);
  const anchor = para.indexOf(NOOP_ANCHOR);
  for (const literal of BORN_READY_BATCH) {
    if (anchor === -1 || para.indexOf(literal, anchor) === -1) out.push(`born-ready paragraph batch exclusion: ${literal}`);
  }
  const item6 = riskItem(stamping, 6);
  for (const literal of ITEM6_BATCH) {
    if (!item6.includes(literal)) out.push(`Risk flags step 6 batch exclusion: ${literal}`);
  }
  return out;
}
function assertBatchExclusion(shapingMode, stamping) { fail('AC6 batch exclusion prose', batchExclusionFailures(shapingMode, stamping)); }

// Every plugin/skills/**/*.md file, walked by hand (withFileTypes, not recursive readdir).
function walkSkills() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push({ rel: path.relative(ROOT, full).split(path.sep).join('/'), text: readText(full) });
    }
  };
  walk(SKILLS_ROOT);
  return out;
}
// classify writes nothing, so refine may read `entry` with it, and refine's human batch writes
// through confirm, which runs no classifier and adds nothing; settle classifies and widens, so
// it stays under specify/ (AC6: no batch path reclassifies a record).
const REFINE_VERBS = new Set(['classify', 'confirm']);
// refine-mode.md's Step 3.7 stub and the lazy sub-file it reads (#4618 Task 11 fix round 1).
const REFINE_FILES = new Set([REFINE, 'plugin/skills/backlog/refine-risk-flags.md']);
function batchClassifyFailures(files) {
  const out = [];
  let specifySettle = 0;
  let specifyClassify = 0;
  for (const { rel, text } of files) {
    for (const m of text.matchAll(VERB_RE)) {
      const verb = m[1];
      if (rel.startsWith('plugin/skills/specify/')) {
        if (verb === 'settle') specifySettle++;
        if (verb === 'classify') specifyClassify++;
        continue;
      }
      if (REFINE_FILES.has(rel) && REFINE_VERBS.has(verb)) continue;
      out.push(`${rel}: risk-flags.js ${verb}`);
    }
  }
  if (files.length < 100) out.push(`walked only ${files.length} skill files: the walk broke`);
  if (specifySettle < 1) out.push('matched no settle call under specify/: the matcher stopped matching');
  if (specifyClassify < 1) out.push('matched no classify call under specify/: the matcher stopped matching');
  return out;
}
function assertNoBatchClassify(files) { fail('risk-flags.js verbs outside specify/', batchClassifyFailures(files)); }

// Fix round 1 (review D, B, C, E, F): behaviour clauses a mutation left green before.
const stampingIntro = (stamping) => lineStarting(riskSection(stamping), 'Every record this mode writes carries');
const localFilesParagraph = (stamping) => lineStarting(composeSection(stamping), '**`work-backend: local-files`:**');
const githubParagraph = (stamping) => lineStarting(composeSection(stamping), '**`work-backend: github-issues`:**');
const handoffRow = (handoff) => lineStarting(handoff, '| Risk-flag answers');
const handoffPrompt = (handoff) => between(handoff, '## Dispatch prompt', 'OUTPUT FORMAT (required)');
const bornReadyText = (t) => bornReady(t.shapingMode);
const CLAUSE_PINS = [
  ['born-ready paragraph', 'shapingMode', bornReadyText, 'cmp -s "{tmp-shaped-body}" "{tmp-prior-body}"'],
  ['born-ready paragraph', 'shapingMode', bornReadyText, 'any non-zero exit (1 they differ, 2 a file is missing) counts as changed'],
  ['born-ready paragraph', 'shapingMode', bornReadyText, "it enters Compose-then-write-once after this Risk flags run and skips that section's own `### Risk flags` run"],
  ['Compose github-issues paragraph', 'stamping', (t) => githubParagraph(t.stamping), "a Reading B record from `shaping-mode.md`'s born-ready paragraph was already settled there and skips this run"],
  ['Compose local-files paragraph', 'stamping', (t) => localFilesParagraph(t.stamping), 'skipped for a Reading B record'],
  ['Risk flags step 1', 'stamping', (t) => riskItem(t.stamping, 1), 'classify --body-file "{tmp-shaped-body}" --prior-body-file "{tmp-prior-body}"'],
  ['Risk flags step 2', 'stamping', (t) => riskItem(t.stamping, 2), 'In `auto` this step adds no stop (`_shared/auto-mode-contract.md`), so `auto` takes step 4 too'],
  ['Risk flags step 3', 'stamping', item3, "When its `entry.status` is `unknown`, ask nothing: tell the human the record's flag line is unreadable and must be repaired first, and run step 4's headless `settle`"],
  ['Risk flags intro', 'stamping', (t) => stampingIntro(t.stamping), 'A verb that exits non-zero (1 a body file unreadable, 2 a malformed call or an unreadable or invalid policy, 3 the body file unwritable) writes nothing for this record'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'A verb that exits non-zero creates nothing for that unit'],
  ['Risk flags step 5', 'stamping', (t) => riskItem(t.stamping, 5), 'with `logged: false` (a log write failed), do the same for each slug in `logFailures`'],
  ['Risk flags step 6', 'stamping', (t) => riskItem(t.stamping, 6), 'A headless run also re-marks a still-present confirmed flag unconfirmed, since it cannot tell whether the content changed'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), "runs in the main thread before `mechanical-handoff.md`'s dispatch"],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), "passed through that file's input table"],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'Only a run where no human is reachable takes the headless `settle`'],
  ['Risk flags paragraph', 'subissues', (t) => subissuesParagraph(t.subissues), 'resolves to an existing number is not created, so it is not settled and its held answers are dropped'],
  ['mechanical-handoff.md input row', 'handoff', (t) => handoffRow(t.handoff), 'run in the main thread before this dispatch'],
  ['mechanical-handoff.md input row', 'handoff', (t) => handoffRow(t.handoff), 'the absolute path of its held answers file and its `--add` slugs'],
  ['mechanical-handoff.md input row', 'handoff', (t) => handoffRow(t.handoff), '`--answers-file`'],
  ['mechanical-handoff.md dispatch prompt', 'handoff', (t) => handoffPrompt(t.handoff), '[Risk-flag answers'],
  ['mechanical-handoff.md dispatch prompt', 'handoff', (t) => handoffPrompt(t.handoff), 'run settle with these and never ask'],
];
function clauseFailures(texts) {
  const out = missing(CLAUSE_PINS, texts);
  const local = localFilesParagraph(texts.stamping);
  const risk = local.indexOf('run `### Risk flags`');
  const check = local.indexOf('compose-record.js --check');
  if (risk === -1 || check === -1 || !(risk < check)) out.push('order: local-files paragraph runs ### Risk flags before compose-record.js --check');
  const subagentHeadless = /subagent has no human to ask/.test(subissuesParagraph(texts.subissues));
  if (subagentHeadless) out.push('Risk flags paragraph: a delegated Step 3 must not default to the headless settle');
  return out;
}
function assertClauses(texts) { fail('Risk flags behaviour clauses', clauseFailures(texts)); }

const TEMPLATE_PINS = [
  ['spec-template.md metadata block', 'template', (t) => templateHead(t.template), "Risk-flags: {comma-separated slugs, or none — settled by /specify's Risk flags step, confirmed by /backlog refine}"],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), '`/claude-tweaks:backlog refine` confirms them with its `confirm` verb'],
  ['spec-template.md metadata block', 'template', (t) => templateHead(t.template), 'Risk-flags-unconfirmed: {true — headless-kept flags awaiting a human; omitted otherwise}'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), '`Risk-flags: none`'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), 'all four built-in categories flagged'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), '`Proof(<slug>): <text>`'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), 'never hand-edit'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), 'does not persist'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), '`risk:low|medium|high`'],
  ['spec-template.md flag paragraph', 'template', (t) => templateParagraph(t.template), 'a different axis'],
  ['Risk flags step 6', 'stamping', (t) => riskItem(t.stamping, 6), 'does not persist'],
  ['Risk flags step 6', 'stamping', (t) => riskItem(t.stamping, 6), 'never hand-edit'],
];
function assertTemplate(template, stamping) { fail('template flag-line prose', missing(TEMPLATE_PINS, { template, stamping })); }

const names = (label) => (err) => err.message.includes(label);

test('AC2.1: the interactive path shows flags in one batch question and settles a remove through the CLI', () => assertShaping(LIVE));
test('AC3.1: the headless path keeps every detected flag with no AskUserQuestion, and the error path joins it', () => assertHeadless(LIVE));
test('AC1.1: the flag line reaches the created record: settle runs before the write and before --check', () => assertOrder(LIVE.stamping));
test('AC1.1: decomposition settles per unit before the create call', () => assertDecomposition(LIVE.subissues));
test('Reading A: a refused settle tells the human the line must be repaired first and logs nothing', () => assertRefusedShaping(LIVE));
test('AC2.1: a removal is logged through settle, else as a record comment or Gotchas bullet', () => assertLogging(LIVE));
test('a comma-list or range batch asks one question for every shaped record\'s flags', () => assertBatchQuestion(LIVE));
test('Reading B: an explicit single-record /specify #N runs the Risk flags step on an already-shaped record', () => assertSingleRecordNoop(LIVE.shapingMode));
test('AC6.1 AC6.2: every batch path leaves an already-shaped record untouched', () => assertBatchExclusion(LIVE.shapingMode, LIVE.stamping));
test('AC6.1 AC6.2: no batch path classifies: settle and confirm appear only under specify/, classify also in refine', () => assertNoBatchClassify(walkSkills()));
test('the template documents both lines and the writer rule', () => assertTemplate(LIVE.template, LIVE.stamping));
test('fix round 1: Reading B settles once, decomposition asks before the handoff, and every behaviour clause is stated', () => assertClauses(LIVE));

// Go-red controls for every literal pin: removed from its file, and (scoped) moved to its end.
const PIN_CONCERNS = [
  ['interactive', SHAPING_PINS, assertShaping],
  ['headless', HEADLESS_PINS, assertHeadless],
  ['refused', REFUSED_PINS, assertRefusedShaping],
  ['logging', LOGGING_PINS, assertLogging],
  ['batch question', BATCH_QUESTION_PINS, assertBatchQuestion],
  ['template', TEMPLATE_PINS, (t) => assertTemplate(t.template, t.stamping)],
  ['clauses', CLAUSE_PINS, assertClauses],
];
const without = (text, literal) => text.split(literal).join('');
const movedToEnd = (text, literal) => `${without(text, literal)}\n\n${literal}\n`;
for (const [concern, pins, assertFn] of PIN_CONCERNS) {
  for (const [label, key, , literal] of pins) {
    test(`go-red (${concern}): removing "${literal}" from ${label} fails, naming it`, () => {
      const mutated = { ...LIVE, [key]: without(LIVE[key], literal) };
      assert.notStrictEqual(mutated[key], LIVE[key]);
      assert.throws(() => assertFn(mutated), names(`${label}: ${literal}`));
    });
    test(`go-red (${concern}): "${literal}" moved out of ${label} to the end of the file still fails`, () => {
      const mutated = { ...LIVE, [key]: movedToEnd(LIVE[key], literal) };
      assert.throws(() => assertFn(mutated), names(`${label}: ${literal}`));
    });
  }
}

test('go-red (logging): step 3 handing settle a --run again fails', () => {
  const step = item3(LIVE);
  const planted = step.replace('--answers-file "{tmp-answers}"`', '--answers-file "{tmp-answers}" --run "$PIPELINE_RUN_DIR"`');
  assert.notStrictEqual(planted, step);
  assert.throws(() => assertLogging({ ...LIVE, stamping: LIVE.stamping.replace(step, planted) }), names('Risk flags step 3: settle passes no --run'));
});

test('go-red (order): ### Risk flags placed after ### Stamp scoring fails', () => {
  const section = riskSection(LIVE.stamping);
  assert.ok(section.length > 0);
  const moved = `${LIVE.stamping.replace(section, '\n')}${section}\n`;
  assert.throws(() => assertOrder(moved), names('order: ### Risk flags before ### Stamp scoring'));
});

test('go-red (order): the assembly fence listing Risk-flags: below ## Current State fails', () => {
  const fence = between(composeSection(LIVE.stamping), '```\n', '\n```');
  const line = fence.split('\n').find((l) => l.startsWith('Risk-flags: {value}'));
  assert.ok(line);
  const reordered = fence.replace(`${line}\n`, '').replace('## Current State\n', `## Current State\n${line}\n`);
  assert.throws(() => assertOrder(LIVE.stamping.replace(fence, reordered)), names('order: assembly lists Risk-flags: above ## Current State'));
});

test('go-red (order): an assembly without the unconfirmed marker fails', () => {
  assert.throws(() => assertOrder(without(LIVE.stamping, 'Risk-flags-unconfirmed: true')), names('assembly: Risk-flags-unconfirmed: true'));
});

test('go-red (order): the Risk flags run placed after compose-record.js --check fails', () => {
  const compose = composeSection(LIVE.stamping);
  const moved = `${without(compose, COMPOSE_SETTLE)}\n${COMPOSE_SETTLE}\n`;
  assert.throws(() => assertOrder(LIVE.stamping.replace(compose, moved)), names('order: Risk flags settle before compose-record.js --check'));
});

test('go-red (decomposition): each pinned literal removed fails, naming it', () => {
  for (const [label, , , literal] of DECOMPOSITION_PINS) {
    assert.throws(() => assertDecomposition(without(LIVE.subissues, literal)), names(`${label}: ${literal}`));
    assert.throws(() => assertDecomposition(movedToEnd(LIVE.subissues, literal)), names(`${label}: ${literal}`));
  }
});

test('go-red (decomposition): the paragraph moved below **Ceremony** or after the create fails', () => {
  const para = subissuesParagraph(LIVE.subissues);
  assert.ok(para.length > 0);
  const stripped = LIVE.subissues.replace(`${para}\n`, '');
  const ceremonyLine = lineStarting(stripped, '**Ceremony**');
  assert.ok(ceremonyLine.length > 0);
  const belowCeremony = stripped.replace(ceremonyLine, `${ceremonyLine}\n\n${para}`);
  assert.throws(() => assertDecomposition(belowCeremony), names('order: **Risk flags** before **Ceremony**'));
  const abovePremise = stripped.replace('\n**Premise verification (#1769)**', `\n${para}\n\n**Premise verification (#1769)**`);
  assert.throws(() => assertDecomposition(abovePremise), names('order: **Risk flags** after **Premise verification**'));
  assert.throws(() => assertDecomposition(`${stripped}\n\n${para}\n`), names('order: **Risk flags** before the create call'));
});

test('go-red (Reading B): each literal removed, or moved ahead of the no-op sentence, fails', () => {
  for (const literal of NOOP_LITERALS) {
    const label = `born-ready paragraph, after the no-op sentence: ${literal}`;
    assert.throws(() => assertSingleRecordNoop(without(LIVE.shapingMode, literal)), names(label));
    const ahead = without(LIVE.shapingMode, literal).replace("Absorb the record's existing content", `Absorb the record's existing content ${literal}`);
    assert.throws(() => assertSingleRecordNoop(ahead), names(label));
  }
});

test('go-red (AC6): deleting the born-ready bare-drain clause fails', () => {
  const para = lineStarting(LIVE.shapingMode, "Absorb the record's existing content");
  const clause = para.match(/,? and bare drain \([^)]*\)/);
  assert.ok(clause, 'the bare-drain clause must be present to delete');
  const mutated = LIVE.shapingMode.replace(para, para.replace(clause[0], ''));
  assert.throws(() => assertBatchExclusion(mutated, LIVE.stamping), names('born-ready paragraph batch exclusion: bare drain'));
});

test('go-red (AC6): deleting each batch literal from either site fails, naming it', () => {
  for (const literal of BORN_READY_BATCH) {
    const para = lineStarting(LIVE.shapingMode, "Absorb the record's existing content");
    const mutated = LIVE.shapingMode.replace(para, without(para, literal));
    assert.throws(() => assertBatchExclusion(mutated, LIVE.stamping), names(`born-ready paragraph batch exclusion: ${literal}`));
  }
  for (const literal of ITEM6_BATCH) {
    const item6 = riskItem(LIVE.stamping, 6);
    const mutated = LIVE.stamping.replace(item6, without(item6, literal));
    assert.throws(() => assertBatchExclusion(LIVE.shapingMode, mutated), names(`Risk flags step 6 batch exclusion: ${literal}`));
  }
});

const plant = (files, rel, line) => files.map((f) => (f.rel === rel ? { rel, text: `${f.text}\n${line}\n` } : f));
const HOUSE = (verb) => `Run \`node "\${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" ${verb} --body-file "{tmp-body}"\`.`;

test('go-red (AC6): settle planted in a refine-mode copy fails', () => {
  assert.throws(() => assertNoBatchClassify(plant(walkSkills(), REFINE, HOUSE('settle'))), names(`${REFINE}: risk-flags.js settle`));
});

test('go-red (AC6): settle planted in the refine-risk-flags.md sub-file fails too', () => {
  const sub = 'plugin/skills/backlog/refine-risk-flags.md';
  assert.throws(() => assertNoBatchClassify(plant(walkSkills(), sub, HOUSE('settle'))), names(`${sub}: risk-flags.js settle`));
});

test('go-red (AC6): classify or confirm planted in a non-specify skill file other than refine-mode fails', () => {
  const rel = 'plugin/skills/backlog/SKILL.md';
  for (const verb of ['classify', 'confirm']) {
    assert.throws(() => assertNoBatchClassify(plant(walkSkills(), rel, HOUSE(verb))), names(`${rel}: risk-flags.js ${verb}`));
  }
});

test('go-red (AC6): the unquoted command form is caught too', () => {
  const rel = 'plugin/skills/tidy/SKILL.md';
  assert.throws(() => assertNoBatchClassify(plant(walkSkills(), rel, 'node bin/risk-flags.js settle --headless')), names(`${rel}: risk-flags.js settle`));
});

test('go-red (AC6): a backtick- or single-quote-closed script name before the verb is caught too', () => {
  const rel = 'plugin/skills/tidy/SKILL.md';
  assert.throws(() => assertNoBatchClassify(plant(walkSkills(), rel, 'Run `bin/risk-flags.js` settle on the body.')), names(`${rel}: risk-flags.js settle`));
  assert.throws(() => assertNoBatchClassify(plant(walkSkills(), rel, "node 'bin/risk-flags.js' confirm --headless")), names(`${rel}: risk-flags.js confirm`));
});

test('control (AC6): classify and confirm in refine-mode are the exemption', () => {
  for (const rel of REFINE_FILES) {
    for (const verb of ['classify', 'confirm']) assertNoBatchClassify(plant(walkSkills(), rel, HOUSE(verb)));
  }
});

test('go-red (fix 1): the local-files paragraph naming --check before the Risk flags run fails the order check', () => {
  const local = localFilesParagraph(LIVE.stamping);
  assert.ok(local.length > 0);
  const swapped = local.replace('run `### Risk flags` on it', 'run it on').replace('compose-record.js --check` first', 'compose-record.js --check` first, then run `### Risk flags` on it');
  assert.notStrictEqual(swapped, local);
  assert.throws(() => assertClauses({ ...LIVE, stamping: LIVE.stamping.replace(local, swapped) }), names('order: local-files paragraph runs ### Risk flags before compose-record.js --check'));
});

test('go-red (fix 1): a delegated Step 3 defaulting to the headless settle fails', () => {
  const para = subissuesParagraph(LIVE.subissues);
  const planted = `${para} A Step 3 run inside \`mechanical-handoff.md\`'s subagent has no human to ask, so it takes the headless \`settle\`.`;
  assert.throws(() => assertClauses({ ...LIVE, subissues: LIVE.subissues.replace(para, planted) }), names('a delegated Step 3 must not default to the headless settle'));
});

test('go-red (AC6): a walk that finds no specify calls fails the matcher floor', () => {
  const files = walkSkills().map((f) => (f.rel.startsWith('plugin/skills/specify/') ? { rel: f.rel, text: f.text.replace(VERB_RE, 'risk-flags.js') } : f));
  assert.throws(() => assertNoBatchClassify(files), names('matched no settle call under specify/'));
  assert.throws(() => assertNoBatchClassify(files.slice(0, 10)), names('walked only 10 skill files'));
});
