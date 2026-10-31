// tests/tidy-plan-retention-conformance.test.js
// Pins /tidy Step 4's plan-retention routing (record #4465): a would-be plan Delete is routed by the
// `superpowers-plans-retention` policy value, the 7-day cutoff fails closed toward Keep, a declined
// keep-forever prune is remembered, and the citation check runs before a Prune plan recommendation too.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const { readText } = require('./helpers/read-skill');
const { CUTOFF_DAYS, ARCHIVE_THRESHOLD } = require('../plugin/bin/lib/plan-retention/route');
const probe = require('../plugin/bin/lib/plan-retention/probe');
const store = require('../plugin/bin/lib/declined-learning/store');

const REPO_ROOT = path.join(__dirname, '..');

// Frozen pre-#4594 bytes of the lines the CLI replaced (scan-procedures.md Step 4, at a649a7568), so each
// #4594 pin below is proven able to go red: it matches the live prose and does NOT match these.
const PRE_CHANGE_CUTOFF = "- **Cutoff** (`keep-forever` only). The cutoff is 7 days (ADR-0007's \"last ~week\"), counted from the plan's first-add commit date — `git -C \"{REPO_ROOT}\" log --diff-filter=A --format=%cs -1 -- {plan}`; empty output or a non-zero exit counts as within the cutoff — Keep.";
const PRE_CHANGE_LOOKUP = "  - Before staging a `Prune plan (archive)`, look up a decline — `printf '%s' '{\"description\":\"tidy Prune plan (archive): docs/superpowers/plans/\"}' | node \"${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js\" lookup --source tidy`: a non-null `decline`, or a lookup that exits non-zero, routes them to Keep.";
// The Citation check bullet as it stood before the --cited second pass was added: the control for those pins,
// the pre-change text of the same region.
const PRE_CHANGE_CITATION = "- **Citation check** (`keep-forever` only). Run it on past-cutoff candidates only once their pre-check count reaches 30; below 30 the count can never yield 30 uncited, so a cited plan is a plain Keep, never a Yours row. At 30 or more, a cited candidate renders per `plan-citation-check.md` and does not count toward the 30.";
// The Compute bullet at 382a26559, before the ask/prune-after-wrapup clause and the failed-run clause were added:
// the control for the pins on those two clauses. Unlike PRE_CHANGE_CITATION it carries the `- **Compute.**` anchor,
// so a doesNotMatch against it can only pass because the clause itself is absent.
const PRE_CHANGE_COMPUTE = "- **Compute.** From `{REPO_ROOT}`, run `node \"${CLAUDE_PLUGIN_ROOT}/bin/plan-retention.js\" --retention {value} {plan} …` with every would-be-Delete plan under `docs/superpowers/plans/` as a repo-relative path. It prints one JSON line: each plan's `route` (`delete`, `keep`, `prune-ask` = `Prune plan (ask)`, `prune-archive` = `Prune plan (archive)`) and `firstAdded` (a date or `uncommitted`), plus `citationCheck` and `citationCandidates`. Exit 2 is a malformed call — fix and re-run, never route by hand.";

function read(rel) {
  return readText(path.join(REPO_ROOT, rel));
}

function findRow(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

const SCAN_PROCEDURES = read('plugin/skills/tidy/scan-procedures.md');
const PLAN_CITATION = read('plugin/skills/tidy/plan-citation-check.md');
const STEP6_AUTO = read('plugin/skills/tidy/step-6-auto.md');
const TIDY_SKILL = read('plugin/skills/tidy/SKILL.md');
const STEP6_INTERACTIVE = read('plugin/skills/tidy/step-6-interactive.md');
const APPROVE_MODE = read('plugin/skills/tidy/approve-mode.md');
const POLICY_SCHEMA = read('plugin/skills/_shared/policy-schema.md');
const SKILL_GRAPH = read('docs/skill-graph.md');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

function step4Section() {
  const start = SCAN_PROCEDURES.indexOf('## Step 4: Audit Execution Plans');
  const end = SCAN_PROCEDURES.indexOf('## Step 4.5:');
  assert.notEqual(start, -1, 'scan-procedures.md must carry the Step 4 heading');
  assert.notEqual(end, -1, 'scan-procedures.md must carry the Step 4.5 heading');
  return SCAN_PROCEDURES.slice(start, end);
}

// One claim per call: the pattern matches the live Step 4 AND fails against the frozen pre-change text, so a
// green result proves the regex can go red.
function pinned(pattern, control) {
  assert.match(step4Section(), pattern);
  assert.doesNotMatch(control, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('tidy Step 4 resolves superpowers-plans-retention (#4465)', () => {
  const s = step4Section();
  assert.match(s, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-policy\.js" --values superpowers-plans-retention/);
  assert.match(s, /governs `docs\/superpowers\/plans\/` only; `~\/\.claude\/plans\/`/);
  assert.match(s, /`~\/\.claude\/plans\/` \(native plan-mode scratch\) keeps the table's recommendation as-is/);
});

test('tidy Step 4 routes a would-be plan Delete by the policy value (#4465)', () => {
  const s = step4Section();
  assert.match(s, /`prune-after-wrapup` → Delete, unchanged/);
  assert.match(s, /`ask` → `Prune plan \(ask\)`, regardless of age/);
  assert.match(s, /`keep-forever` \(the default\) → Keep, unless 30 or more plans are past the cutoff and no live decline exists/);
  assert.match(s, /then one `Prune plan \(archive\)` listing them all/);
  assert.match(s, /The 30 counts only uncited would-be-Delete plans/);
  assert.match(s, /a staged archive never lists fewer than 30/);
  assert.match(s, /only a would-be Delete is routed — a Keep row stays Keep under every value/);
});

test('tidy Step 4 states why the 30 threshold exists and why ask skips cutoff, threshold, and decline memory (#4465)', () => {
  const s = step4Section();
  assert.match(s, /30 is where the archive counts as ADR-0007's "large enough to be noise itself"/);
  assert.match(s, /Asking every run is what `ask` means, so it has no cutoff, no threshold, and no decline memory/);
});

test('tidy Step 4 remembers a declined keep-forever prune and fails closed (#4465)', () => {
  const s = step4Section();
  pinned(/the CLI looks up a decline itself before routing to `Prune plan \(archive\)`/, PRE_CHANGE_LOOKUP);
  assert.match(s, /declined-learning\.js" record-decline --source tidy < "\{D\}"/);
  pinned(/a live decline, or a lookup that throws, routes them to Keep/, PRE_CHANGE_LOOKUP);
  assert.match(s, /excludes every row of a `Prune plan \(archive\)` `tidy-prune-plan-\{n\}` item/);
  assert.match(s, /\*\*Decline memory\*\* \(`keep-forever` only — excluding a `Prune plan \(ask\)` item records nothing\)/);
  assert.match(s, /stays live for 180 days \(reconcile's `pruneDeclines` expires it\)/);
});

test('tidy Step 4 keeps the human decline reason off the command line (#4465)', () => {
  const s = step4Section();
  assert.match(s, /The human's reason never touches a command line/);
  assert.match(s, /session-tmp-resolve\.js" D=tidy-plan-decline\.json/);
  assert.doesNotMatch(s, /"reason":"\{why\}"\}' \|/, 'the reason must not be interpolated into a single-quoted printf argument');
});

// Executes the prose's own record payload against the real record-decline CLI, in a sandbox cwd (the store is
// cwd-relative), then reads it back through the same fingerprint and store lookup plan-retention.js makes, so a
// drift between the prose's description, the verb, the CLI's stdin contract and that lookup fails here. The CLI's
// own wiring of the lookup is pinned separately, in tests/bin-lib/plan-retention/cli.test.js's spawned test.
test("tidy Step 4's decline record payload round-trips through the fingerprint and store lookup plan-retention uses (#4594)", () => {
  const s = step4Section();
  const payload = s.match(/`Write` `(\{"description":[^`]*\})`/);
  const record = s.match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/declined-learning\.js" (record-decline) --source (\w+) < "\{D\}"`/);
  assert.ok(payload && record, 'Step 4 carries the record payload and the record command');
  assert.equal(JSON.parse(payload[1].replace('{why}', 'x')).description, probe.DECLINE_DESCRIPTION);
  assert.equal(record[2], probe.DECLINE_SOURCE);

  const cli = path.join(REPO_ROOT, 'plugin', 'bin', 'declined-learning.js');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-plan-decline-'));
  const lookup = () => store.lookupDecline(probe.archiveDeclineFingerprint(), {
    readFile: (p) => fs.readFileSync(path.join(sandbox, p), 'utf8'),
  });

  try {
    assert.equal(lookup(), null);
    const why = 'it\'s "noise", per ADR-0007';
    execFileSync(process.execPath, [cli, record[1], '--source', record[2]], {
      cwd: sandbox,
      input: payload[1].replace('{why}', JSON.stringify(why).slice(1, -1)),
      encoding: 'utf8',
    });
    const entry = lookup();
    assert.ok(entry, 'the recorded decline is found by plan-retention\'s fingerprint');
    assert.equal(entry.reason, why);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('AC4.1/AC4.2/AC5.1: tidy Step 4 cites plan-retention.js and no longer spells out the date command (#4594)', () => {
  const s = step4Section();
  pinned(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-retention\.js" --retention \{value\}/, PRE_CHANGE_CUTOFF + '\n' + PRE_CHANGE_LOOKUP);
  assert.doesNotMatch(s, /--diff-filter=A/);
  assert.match(PRE_CHANGE_CUTOFF, /--diff-filter=A/, 'control: the frozen cutoff line carries the retired command');
  assert.match(s, /The cutoff is 7 days \(ADR-0007's "last ~week"\), counted from the plan's first-add commit date/);
  pinned(/a plan first added 7 or more days before today is past/, PRE_CHANGE_CUTOFF);
  pinned(/`uncommitted` plan counts as within the cutoff/, PRE_CHANGE_CUTOFF);
});

test("tidy Step 4's 7 and 30 match plan-retention's constants (#4594)", () => {
  const s = step4Section();
  assert.equal(CUTOFF_DAYS, 7);
  assert.equal(ARCHIVE_THRESHOLD, 30);
  assert.match(s, /The cutoff is 7 days/);
  assert.match(s, /30 or more plans are past the cutoff/);
});

test('tidy Step 4 states the --cited second pass (#4594)', () => {
  pinned(/re-run[^.]*--cited \{plan\}/, PRE_CHANGE_CITATION);
  pinned(/re-run the same call — every plan again — adding one `--cited \{plan\}`/, PRE_CHANGE_CITATION);
  pinned(/with no cited candidate, the first call's routes stand/, PRE_CHANGE_CITATION);
  pinned(/- \*\*Compute\.\*\*[^\n]*Under `ask` and `prune-after-wrapup`, `citationCheck: true` means apply `plan-citation-check\.md`'s outcome directly — no `--cited` re-run, the CLI rejects it/, PRE_CHANGE_COMPUTE);
  pinned(/- \*\*Compute\.\*\*[^\n]*Any other exit, or stdout that is not one JSON line, is a failed run: Keep every plan\. Never route by hand/, PRE_CHANGE_COMPUTE);
  assert.doesNotMatch(step4Section(), /\*\*Citation check\*\*[^\n]*Under `ask` and `prune-after-wrapup`/, 'the ask/prune-after-wrapup clause belongs in Compute, not under the keep-forever-only Citation check label');
});

test('tidy Step 4 collects the recommendation after retention routing, not before it (#4465)', () => {
  const s = step4Section();
  const collect = s.indexOf('→ Collect each as: `[plan] {filename} — {recommendation}`');
  assert.notEqual(collect, -1, 'Step 4 must keep its Collect line');
  const retention = s.indexOf('**Plan retention (#4465).**');
  assert.notEqual(retention, -1, 'Step 4 must keep its Plan retention paragraph');
  assert.ok(collect > retention, 'the Collect line must sit below the Plan retention paragraph');
  assert.match(s, /the recommendation being the one after Plan retention routing and the citation check/);
});

test('the plan citation check runs before a Prune plan recommendation too (#4465)', () => {
  assert.match(step4Section(), /\*\*Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/);
  assert.match(PLAN_CITATION, /before recommending any plan Delete or `Prune plan`/);
});

test('step-6-auto.md stages Prune plan at every tier (#4465)', () => {
  const row = findRow(STEP6_AUTO, '| **Prune plan**');
  assert.ok(row, 'Prune plan row is present');
  assert.match(row, /\| Stage \| Stage \| Stage/);
  assert.match(row, /`scan-procedures\.md` Step 4's Plan retention/);
  assert.match(row, /tidy-prune-plan-\{n\}/);
});

test('step-6-auto.md auto-deletes plans only under prune-after-wrapup (#4465)', () => {
  assert.doesNotMatch(STEP6_AUTO, /orphaned plans whose related spec is complete,/);
  assert.match(STEP6_AUTO, /— plans whose related spec is complete \(`docs\/superpowers\/plans\/` only under `prune-after-wrapup`; `~\/\.claude\/plans\/` at every value\), orphaned ledger files/);
  assert.match(STEP6_AUTO, /old plans whose spec status is unclear or was never started, and orphan plans with no related spec \(`docs\/superpowers\/plans\/` only under `prune-after-wrapup`; `~\/\.claude\/plans\/` at every value;/);
  assert.match(STEP6_AUTO, /judgment-tier because, unlike a complete spec, a missing or never-started one does not prove the plan's work is over/);
});

test('step-6-auto.md routes orphan plans through the judgment Delete row, not the every-tier Auto row (#4465)', () => {
  const auto = findRow(STEP6_AUTO, '| **Delete** (marked-as-specified design docs');
  const judgment = findRow(STEP6_AUTO, '| **Delete** (any case requiring judgment');
  assert.ok(auto && judgment);
  assert.match(auto, /the plan's related spec is still complete and no repo file cites/);
  assert.doesNotMatch(auto, /orphan plan|no related spec/);
  assert.match(judgment, /orphan plans with no related spec/);
  assert.match(judgment, /\(`plan-citation-check\.md`\) and an orphan still has no related spec/);
  assert.doesNotMatch(judgment, /plan-citation-check\.md`; an orphan/);
  assert.match(judgment, /\| Stage \| Auto-apply \| Auto-apply/);
});

test('SKILL.md Prune plan row says the 30 threshold gates staging, not execution (#4465)', () => {
  const row = findRow(TIDY_SKILL, '| **Prune plan**');
  assert.ok(row);
  assert.match(row, /The 30 threshold gates staging, not execution: an approved archive still executes after `stale — skipped` drops leave fewer than 30/);
  assert.match(row, /When every listed plan drops, run no `git rm` and no commit/);
});

test('plan-citation-check.md and skill-graph.md name the Prune plan execution re-verify as a reader (#4465)', () => {
  assert.match(PLAN_CITATION, /`SKILL\.md`'s `Prune plan` execution re-verify/);
  assert.match(SKILL_GRAPH, /`tidy\/SKILL\.md`'s `Prune plan` execution re-verify are the file's other readers/);
});

test('SKILL.md Step 7.5 verification checklist has a Pruned plans line (#4465)', () => {
  const s = TIDY_SKILL.slice(TIDY_SKILL.indexOf('## Step 7.5: Verify Execution'));
  assert.match(s, /- \[x\] Pruned plans: \{n\} — each listed plan removed \(`git rm`\) and committed, or reported `stale — skipped`/);
});

test('step-6-interactive.md lists prune among the recommendation kinds (#4465)', () => {
  assert.match(STEP6_INTERACTIVE, /every active recommendation from the scans \(delete, prune, defer,/);
});

test('both approval paths record an excluded Prune plan (archive) decline, never an ask one (#4465)', () => {
  const sentence = /An entirely excluded `Prune plan \(archive\)` item records its decline per `scan-procedures\.md` Step 4's Plan retention \(never a `Prune plan \(ask\)` item\)\./;
  assert.match(STEP6_INTERACTIVE, sentence);
  assert.match(APPROVE_MODE, sentence);
});

test('approve-mode.md puts the decline sentence after the paragraph it ends, not mid-paragraph (#4465)', () => {
  const decline = APPROVE_MODE.indexOf('An entirely excluded `Prune plan (archive)` item');
  const tail = APPROVE_MODE.indexOf('precisely because an earlier auto or interactive run left items staged rather than applied.');
  assert.notEqual(decline, -1);
  assert.notEqual(tail, -1);
  assert.ok(decline > tail, 'the decline sentence must follow the "never reached from auto mode" sentence');
});

test('SKILL.md Action Vocabulary defines Prune plan execution and re-verify (#4465)', () => {
  const row = findRow(TIDY_SKILL, '| **Prune plan**');
  assert.ok(row, 'Prune plan Action Vocabulary row is present');
  assert.match(row, /`git rm` each listed plan, one commit/);
  assert.match(row, /`plan-citation-check\.md` still clean, its classification still holds \(related spec still complete; for an orphan, still none; for a very-old plan, its spec still not started\), and `superpowers-plans-retention` still the value that staged it/);
  assert.match(row, /`Prune plan \(archive\)` also re-checks the plan is still past the 7-day cutoff, `Prune plan \(ask\)` that it is still committed/);
  assert.doesNotMatch(row, /still clean, still past the 7-day cutoff/);
  assert.match(row, /`stale — skipped`/);
  assert.match(row, /An entirely excluded `Prune plan \(archive\)` item records its decline per Step 4's Plan retention/);
});

test('policy-schema.md names tidy Step 4 as a superpowers-plans-retention consumer and describes its routing (#4465)', () => {
  const row = findRow(POLICY_SCHEMA, '| `superpowers-plans-retention`');
  assert.ok(row);
  assert.match(row, /`\/claude-tweaks:tidy` Step 4 \(`tidy\/scan-procedures\.md`\)/);
  assert.match(row, /tidy keeps them, staging one bulk prune only once enough uncited plans pass Step 4's Plan retention cutoff and threshold/);
  assert.match(row, /tidy's Approve section/);
  assert.match(row, /tidy deletes Step 4's would-be-Delete plans/);
  assert.doesNotMatch(row, /tidy deletes closed-record plans/);
});

test('tidy Step 4: the cutoff gates keep-forever only; ask stages regardless of age, an uncommitted plan stays Keep (#4465)', () => {
  const s = step4Section();
  assert.match(s, /\*\*Cutoff\*\* \(`keep-forever` only\)/);
  assert.match(s, /An uncommitted plan \([^)]*\) still stays Keep, because `git rm` would fail on it/);
});

test('tidy Step 4: a decline is recorded only for an entirely excluded item; failure degrades open; commands run from REPO_ROOT (#4465)', () => {
  const s = step4Section();
  assert.match(s, /excluding some rows records nothing/);
  assert.match(s, /`\{why\}` JSON-escaped/);
  assert.match(s, /A `record-decline` failure degrades open: log one SKIP note and continue/);
  assert.match(s, /Run both commands from `\{REPO_ROOT\}` — the store path is relative to the working directory/);
});

test('tidy Step 4: under keep-forever the citation check runs on past-cutoff candidates only once they reach 30 (#4465)', () => {
  const s = step4Section();
  assert.match(s, /\*\*Citation check\*\* \(`keep-forever` only\)\. Run it on past-cutoff candidates only once their pre-check count reaches 30/);
  assert.match(s, /a cited plan is a plain Keep, never a Yours row/);
  assert.match(s, /At 30 or more, a cited candidate renders per `plan-citation-check\.md` and does not count toward the 30/);
});

function tidyGraphSection() {
  const start = SKILL_GRAPH.indexOf('\n## tidy\n');
  const end = SKILL_GRAPH.indexOf('\n## visual-review\n');
  assert.ok(start !== -1 && end > start);
  return SKILL_GRAPH.slice(start, end);
}

test('skill-graph.md tidy section names the declined-learning store row (#4465)', () => {
  const row = findRow(tidyGraphSection(), '| `bin/lib/declined-learning/store.js`');
  assert.ok(row, 'tidy section carries the declined-learning store row');
  assert.match(row, /Step 4's Plan retention looks up a `keep-forever` `Prune plan \(archive\)` decline via `bin\/plan-retention\.js`/);
  assert.match(row, /records one via `record-decline --source tidy` when a human excludes that item entirely at Step 6's approval or `--approve`/);
  assert.match(row, /one decline suppresses the archive until reconcile's 180-day `pruneDeclines` expires it/);
});

test('skill-graph.md tidy section carries the plan-retention.js row (#4594)', () => {
  const row = findRow(tidyGraphSection(), '| `bin/plan-retention.js`');
  assert.ok(row, 'tidy section carries the plan-retention.js row');
  assert.match(row, /Step 4's Plan retention/);
});

test('policy-schema.js superpowers-plans-retention summary mentions the tidy bulk prune within the 140-char cap (#4465)', () => {
  const { summary } = POLICY_KEYS.find((k) => k.key === 'superpowers-plans-retention');
  assert.match(summary, /tidy may propose a bulk prune/);
  assert.ok(summary.length <= 140, `${summary.length} chars`);
});
