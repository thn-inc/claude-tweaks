'use strict';
// tests/build-sdd-ledger-residue-carryforward.test.js — pins #1135: /build's subagent-strategy
// dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent" branch) directs
// /superpowers:subagent-driven-development to copy surviving SDD deferred-minor / parked / Ruling ledger
// lines (`<workspace>/progress.md`) into the run's own open items ledger before its Finish step
// deletes the plan's SDD workspace — otherwise those lines are structurally lost, since
// /claude-tweaks:wrap-up reads only docs/plans/*-ledger.md, never the deleted SDD workspace.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const ws = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');

test('dispatch.md: Common Step 2 subagent-strategy invocation directs the ledger-residue carry-forward before Finish deletes the workspace', () => {
  assert.match(
    DISPATCH,
    /Carry forward surviving SDD ledger residue before Finish/,
    'the SDD invocation instruction is missing the ledger-residue carry-forward directive'
  );
});

test('dispatch.md: the directive names the source lines (progress.md minor (deferred)/parked/Ruling markers)', () => {
  assert.match(DISPATCH, /<workspace>\/progress\.md` line matching `minor \(deferred\):`, `parked —`, or `Ruling:`/);
});

test('AC1.1 AC2.1: the directive maps deferred-minor → deferred, parked → observation, Ruling → open (three-way, first match wins)', () => {
  assert.match(
    DISPATCH,
    /this build's own open items ledger \(`\/claude-tweaks:ledger`'s Add Item operation\) — phase `build`, status `deferred` for a `minor \(deferred\):` line, `observation` for a `parked —` line, or `open` for a `Ruling:` line/
  );
  assert.doesNotMatch(DISPATCH, /or `observation` for a `parked —` or `Ruling:` line/, 'the pre-#3401 two-way mapping must be gone');
});

test('AC2.2: the classification rule — a first-match Ruling: line is load-bearing — is stated with its reason', () => {
  assert.match(DISPATCH, /whose first marker match is `Ruling:` is load-bearing — every pre-flight, mid-run, breaker, and residual final-review ruling/);
  assert.match(DISPATCH, /SDD writes the bare form only where it decided in lieu of a human, and the residual final-review shape has no pinned prefix to sniff/);
  assert.match(DISPATCH, /a `parked —` line's first match is `parked —`, so the match order already separates the two classes/);
});

test('AC1.1: dispatch.md carries the carry-forward on at least two stage-item.js lines and no hand-rewrite clause', () => {
  assert.ok(DISPATCH.split('\n').filter((l) => l.includes('stage-item.js')).length >= 2);
  assert.ok(!DISPATCH.includes('update the just-appended row'));
});

test('AC2.3: the run-directory branch stages each ruling through one stage-item.js --ledger call', () => {
  assert.match(DISPATCH, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stage-item\.js" --run "\$PIPELINE_RUN_DIR" --id "sdd-ruling-\{N\}" --file "\{tmp\}\.md" --allocate --ledger "\{ledger path\}" --label "SDD ruling" --item 'SDD ruling — \{one-liner\}: ratify or reverse at the Review Console'/);
  assert.match(DISPATCH, /--id "build-deviation-\{N\}" --file "\{tmp\}\.md" --allocate --ledger "\{ledger path\}" --label "SDD ruling" --item 'SDD ruling — \{one-liner\}: apply or decline at the Review Console'/);
  assert.match(DISPATCH, /`Title:`.*?`Kind: sdd-ruling`.*?`Ruling:`.*?`Staged-at:`/);
  // The CLI path states what the call guarantees, not how (the ordering, dedupe bypass, and log literals are ledger.js's, unpinned copies drift).
  assert.match(DISPATCH, ws('it stages the file with its `Ledger:` header filled, appends that row, and logs `STAGED`, so no row ever names a file that was not written'));
  assert.doesNotMatch(cliPath(), /De-duplication on Append/, 'the CLI path no longer restates the dedupe bypass');
});

function cliPath() {
  const start = DISPATCH.indexOf('Then carry it forward with one `stage-item.js --ledger` call');
  const end = DISPATCH.indexOf('**No run directory**');
  assert.ok(start !== -1 && end > start, 'the CLI path / no-run-directory boundary is not in dispatch.md');
  return DISPATCH.slice(start, end);
}

test('I1: the exit-3 guidance branches on the degraded stderr prefix — traced and never retried, else a wrong run dir to re-resolve; exit 2 names a rejected --ledger and an unreadable --file', () => {
  assert.match(DISPATCH, ws('exit 3 with stderr starting `stage-item.js: ledger carry-forward degraded —` is a degraded path whose trace is already in `decisions.md` — never retry the call or log it again'));
  assert.match(DISPATCH, ws('unless a following `stage-item.js: warning: could not log SKIP entry` line says that trace itself failed'));
  assert.match(DISPATCH, ws('any other exit 3 is a wrong run dir (missing, or a worktree shadow per `_shared/pipeline-run-dir.md`\'s Anchoring section) that wrote and logged nothing — re-resolve `$PIPELINE_RUN_DIR` and re-run'));
  assert.match(DISPATCH, ws('exit 2 is a malformed invocation (a missing `--item`, `--label`, or `--allocate`, a rejected `--ledger` — not found, wrong name, or outside the run directory and worktree — or an unreadable `--file`) to fix and re-run'));
});

test('M5: {ledger path} is this build\'s active open items ledger, run-dir or repo-relative', () => {
  assert.match(DISPATCH, ws('`{ledger path}` is this build\'s active open items ledger per `_shared/ledger-format.md`\'s resolution rule: `"$PIPELINE_RUN_DIR/ledger.md"` when that file exists, else the repo-relative `docs/plans/…-ledger.md` path'));
  assert.doesNotMatch(DISPATCH, /`\{ledger path\}` is this build's open items ledger, repo-relative/);
});

test('the no-run-directory branch keeps the row open, stages nothing, and hands the ruling to the Step 7 handoff', () => {
  assert.match(DISPATCH, /\*\*No run directory\*\* \(standalone `\/claude-tweaks:build`, no `\$PIPELINE_RUN_DIR`\): no console will read `staged\/`, so append the ledger row with status `open` and the same Item text minus the staged path, stage nothing, and list each ruling in the Step 7 handoff's `### SDD rulings` section \(`build\/handoff-template\.md`\)/);
  assert.match(DISPATCH, /`Accept` = ratify, `Keep`\/`Defer` = reverse as a follow-up, `Fix anyway` = reverse now/);
  // I2: the by-hand Add Item append keeps its no-dedupe rule and states its Item form explicitly.
  const standalone = DISPATCH.slice(DISPATCH.indexOf('**No run directory**'));
  assert.match(standalone, ws('The Item reads `SDD ruling — {one-liner}: ratify or reverse at the Review Console`, with no staged path, and Add Item\'s De-duplication on Append never skips a ruling row: two rulings sharing the template stem are distinct decisions, so every ruling gets its own row'));
  assert.match(DISPATCH, /a ruling's text states a decision, not a defect, so it does not qualify on its own/);
});

test('dispatch.md: a line carrying two markers is copied once, under its first match', () => {
  assert.match(DISPATCH, /a line matching more than one marker is copied once, under its first match in that order/);
});

test('dispatch.md: the carry-forward states why Ruling: lines matter under SDD 6.3.0+', () => {
  assert.match(
    DISPATCH,
    /SDD 6\.3\.0\+ ledgers its pre-flight, fix-loop breaker and final-review decisions as `Ruling:` lines instead of stopping for the human/
  );
});

test('dispatch.md: the directive fires before workspace deletion, not after', () => {
  assert.match(DISPATCH, /before deleting the plan's workspace \(`rm -rf <workspace>`\), it must copy/);
});

const HANDOFF = read('plugin', 'skills', 'build', 'handoff-template.md');

test('handoff-template.md carries the standalone-build SDD rulings slot dispatch.md points at', () => {
  assert.match(HANDOFF, /### SDD rulings \(standalone build, if any\)/);
  assert.match(HANDOFF, /`Accept` = ratify, `Keep`\/`Defer` = reverse at a standalone `\/claude-tweaks:wrap-up`/);
});

test('SKILL.md Common Step 2 still points the subagent strategy at dispatch.md (the file that composes this directive)', () => {
  assert.match(
    BUILD_SKILL,
    /\*\*subagent\*\* \(default\): read `dispatch\.md` in this skill's directory and follow its full dispatch procedure/
  );
});

const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
const INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');

test('AC5.1: the appendix maps apply on an sdd-ruling-* item to ratify (ledger accepted) and reverse to a born-ready reversal record (ledger deferred, reversed →)', () => {
  assert.ok((APPENDIX.match(/sdd-ruling/g) || []).length >= 2, 'prefix list plus the Resolution-to-step bullet');
  // Wrap-tolerant pins: `\s+` wherever the hard-wrapped bullet may break a line, so a reflow
  // with no wording change stays green (review #3401, lens 3f).
  assert.match(APPENDIX, ws('- `apply` on an `sdd-ruling-*` item — still step 1, but it executes no code change: it writes the item\'s `Ledger:` row back to `accepted`, Resolution `ratified at Review Console — {the ruling\'s own "— why" clause, or "no — why clause on the ruling line" when it carries none}`'));
  assert.match(APPENDIX, ws('never an empty clause: `finish-console` rejects an `accepted` entry with no resolution text before writing anything'));
  assert.match(APPENDIX, ws('through `finish-console`\'s existing `ledger` array'));
  assert.match(APPENDIX, ws('composes a born-ready record proposal exactly as `_shared/ledger-format.md`\'s Phase 3 `Keep` does (`specShapedBody`'));
  assert.match(APPENDIX, ws('`Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`'));
  assert.match(APPENDIX, ws('stages it as `staged/ledger-record-sdd-ruling-{N}.md`, routes it through step 7 in the same pass, and — once step 7 has created the record — writes the row back to `deferred`, Resolution `reversed → #{new record}`'));
  assert.match(APPENDIX, ws('when step 7 declines or fails to create it (`refused-proposals.md`, a `gh` failure), the row stays `open` with the cause logged'));
  assert.match(APPENDIX, ws('never `deferred` without a record number'));
  assert.match(APPENDIX, ws('Outside Approve all, a ratify writes the row directly at step 1 per `_shared/staged-patch.md`\'s Write-back to the ledger'));
  assert.match(APPENDIX, ws('a `reverse` on any path writes it at step 7, as above, never at step 1'));
});

test('AC5.2: the interactive console names ratify/reverse as the Override vocabulary for a ruling row and refuses a bare skip', () => {
  assert.match(INTERACTIVE, /the Override vocabulary for one is `ratify \{#\}` \/ `reverse \{#\}`/);
  assert.match(INTERACTIVE, /A bare `skip \{#\}` on one is refused with a one-line notice naming the two/);
  assert.match(INTERACTIVE, /SDD already decided, so the human confirms or files the reversal, never leaves it undecided/);
});

test('review-console.md step 1 points an sdd-ruling-* write-back at the appendix bullet', () => {
  assert.match(CONSOLE, /an `sdd-ruling-\*` item's write-back follows `review-console-appendix\.md`'s `sdd-ruling-\*` bullet \(ratify → `accepted` here; reverse → `deferred` at step 7, once the reversal record exists\), not the patch table/);
});

test('review #3401 → #3510: the CLI owns the failure branch; the hand-performed rewrite and ordering clauses are gone', () => {
  assert.match(DISPATCH, /so no row ever names a file that was not written/);
  assert.match(DISPATCH, /the carry-forward call below escapes itself, so pass it unescaped/);
  assert.match(DISPATCH, /`--allocate` is required with `--ledger`/);
  assert.doesNotMatch(DISPATCH, /same clobber reason/);
  for (const gone of [
    'ledger first, then the file', 'the same operation, not an Update Item', "rewrite the row's Item text", '(1) append the ledger row',
    // #3510 final review: the CLI-internal literals and orderings are ledger.js's, not dispatch.md's
    'staged write failed for sdd-ruling-{N}', 'STAGED {time} — SDD ruling carried forward', 'numbers the row first',
    'Every degraded path exits 3 with its trace already in', 'header already filled', "the row's Item names the path the call actually wrote",
  ]) {
    assert.ok(!DISPATCH.includes(gone), `stale hand-performed clause still present: ${gone}`);
  }
});

const { DECLINED_NOTE, REVERSED_LABEL, REVERSE_FAILED_NOTE } = require('../plugin/bin/lib/reconcile/console-execute');
const CONSOLE_ON_PR = read('plugin', 'skills', '_shared', 'console-on-pr.md');
const CONSOLE_EXECUTION = read('plugin', 'skills', '_shared', 'console-execution.md');

test('AC1.1 #3513: console-on-pr.md — an sdd-ruling-* row label carries ratify/reverse, and the legend reads unticked = reverse, never a bare decline', () => {
  assert.match(CONSOLE_ON_PR, ws('carries its two dispositions in its label'));
  assert.match(CONSOLE_ON_PR, ws('`— tick = ratify · untick = reverse`'));
  assert.match(CONSOLE_ON_PR, ws('unticked when Resolve console is ticked = **reverse** (a reversal record is filed), never a bare decline'));
  assert.match(CONSOLE_ON_PR, ws("per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet"));
  assert.match(CONSOLE_ON_PR, /\*\*Unticked when Resolve console is ticked\*\* = declined/, 'the general declined rule stays');
});

test('AC1.1 #3513: console-execution.md — an unticked or --decline sdd-ruling-* item routes to reverse, citing the appendix bullet', () => {
  assert.match(CONSOLE_EXECUTION, ws('it routes to **reverse**, never to a plain decline'));
  assert.match(CONSOLE_EXECUTION, ws("per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet"));
  assert.match(CONSOLE_EXECUTION, ws('only once the record exists; when the record is refused or not created, log that cause instead'));
  assert.match(CONSOLE_EXECUTION, ws('never `reversed` without a record number'));
  assert.match(CONSOLE_EXECUTION, ws('Ticked, it is ratify (ledger row → `accepted`, per the same bullet)'));
  assert.match(CONSOLE_EXECUTION, ws('(staged file `staged/sdd-ruling-{N}.md`, or `spec-{N}/staged/sdd-ruling-{N}.md` on a multi-spec bundle, #3401)'));
  assert.match(CONSOLE_EXECUTION, ws('`REFUSED` when `wrap-up/refused-proposals.md` refuses it, else `SKIP`'));
  assert.match(CONSOLE_EXECUTION, ws('a ruling the chat answer ratifies must be passed in `--approve` (an unticked ruling id in neither list is recorded `reversed`'));
  assert.match(CONSOLE_EXECUTION, ws('`reverse {#}` to `--decline`'));
  assert.match(CONSOLE_EXECUTION, ws('`AUTO` line naming `reversed → #{new record}` (or the logged refusal cause) stays the record of which reversal record was filed'));
});

test('AC3.1 #3636: console-execution.md\'s accelerator note labels a reversed ruling with console-execute.js\'s own literals', () => {
  assert.match(CONSOLE_EXECUTION, ws(`records a flagged ruling item (\`console.json\`'s \`isRulingRow: true\`, \`_shared/console-on-pr.md\`) as \`${REVERSED_LABEL}\``));
  assert.match(CONSOLE_EXECUTION, ws(`every other \`--decline\` id as \`${DECLINED_NOTE}\``));
  assert.doesNotMatch(CONSOLE_EXECUTION, /since `console.json` items carry no staged path/);
  // Regression guard only: the positive pins above plus the doesNotMatch are what discriminate.
  const offending = CONSOLE_EXECUTION.split('\n').filter((l) => /no reason given/.test(l) && /ruling/i.test(l));
  assert.deepEqual(offending, [], 'the physical line naming the declined label must not describe a ruling');
});

test('#3636: console-execution.md\'s accelerator routes a refused or uncreated reverse through --reverse-failed, never to reversed', () => {
  assert.match(CONSOLE_EXECUTION, ws(`When the reverse was refused or never created, also pass that ruling's id in \`--reverse-failed\`: the reply then labels it \`${REVERSE_FAILED_NOTE}\` and Resolve stays unticked. Never let such a ruling default to \`${REVERSED_LABEL}\``));
  assert.match(CONSOLE_EXECUTION, ws('(executed / declined / reversed / reverse-failed / unexecutable / unexecutable-stale)'));
});

test('#3636: console-on-pr.md documents the isRulingRow flag on sdd-ruling-* items', () => {
  assert.match(CONSOLE_ON_PR, ws('carries `"isRulingRow": true` on its `console.json` item object'));
  assert.match(CONSOLE_ON_PR, ws('omitted on every other item, never `false`'));
});

const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');

test('AC1.1 #3513: multispec-review-console.md — step 1 ratifies a ruling, Override offers ratify/reverse and refuses skip/modify/revert on one', () => {
  assert.match(MULTISPEC_CONSOLE, ws("an `sdd-ruling-*` file is no patch — Approve all ratifies it: this step writes its `Ledger:` row to `accepted` directly (per `_shared/staged-patch.md`'s Write-back to the ledger, Resolution per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet — this console has no `finish-console` step); reverse is Override's `reverse {#}`"));
  assert.match(MULTISPEC_CONSOLE, ws('ratify/reverse {#} for an SDD ruling row'));
  assert.match(MULTISPEC_CONSOLE, ws("an `sdd-ruling-*` row takes only `ratify {#}`/`reverse {#}` (the appendix bullet); `skip`/`modify`/`revert` on one is refused as `wrap-up/review-console-interactive.md` refuses it"));
  assert.match(MULTISPEC_CONSOLE, ws("`reverse {#}` stages its reversal record under that spec's `spec-{N}/staged/` and creates it at this console's step 2 (queue writes), not the appendix's step 7, then writes the row to `deferred` once the record exists"));
});

const CONSOLE_TEMPLATE = read('plugin', 'skills', 'wrap-up', 'console-template.md');
const MULTISPEC_TEMPLATE = read('plugin', 'skills', 'flow', 'multispec-console-template.md');

test('AC2.1 #3513: review-console-interactive.md names reverse in the Override option description and refuses modify/revert on a ruling row', () => {
  const reverseLines = INTERACTIVE.split('\n').filter((l) => /reverse/.test(l));
  assert.ok(reverseLines.length >= 2, `grep -c reverse must be >= 2, got ${reverseLines.length}`);
  assert.match(INTERACTIVE, ws('ratify/reverse {#} for an SDD ruling row; also the only path that drills Q#/M#/U# individually'));
  assert.match(INTERACTIVE, ws('`modify {#}` and `revert {#}` on a ruling row are refused with the same notice, that verb in place of `skip`'));
});

test('#3513: both Pending review headings name ratify/reverse for an sdd-ruling-* row', () => {
  const heading = '#### Pending review (staged — apply, skip, or modify per item; `ratify`/`reverse` an `sdd-ruling-*` row)';
  assert.ok(CONSOLE_TEMPLATE.includes(heading), 'console-template.md heading');
  assert.ok(MULTISPEC_TEMPLATE.includes(heading), 'multispec-console-template.md heading');
});
