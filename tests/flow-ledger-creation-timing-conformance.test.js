'use strict';
// #3036: flow's Step 1.8 created the open-items ledger before the run's
// worktree existed, so under worktree-always a run about to get a NEW
// worktree had no writable location. Creation now happens right after the
// worktree exists; the No-worktree run exception is keyed on strategy/shape.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel)).replace(/\s+/g, ' ');
const OLD_CONDITION = /A run with no worktree at all — `run-state\.json` carries no `worktree` field/;
const SEQUENCING_3289 = /\*\*Sequencing \(#3289\):\*\* run this step right after Step 6 records the draft PR \(or logs its `SKIP`\)/;

test('AC1.1: flow Step 1.8 creates the ledger only when no worktree is ever created or adopted', () => {
  const text = read('flow/SKILL.md');
  assert.match(text, /Create the open items ledger — here only when no new worktree is coming/);
  assert.match(text, /Step 1\.3 resolved `current-branch` \(no worktree is ever created or adopted for this run\)/);
  assert.doesNotMatch(text, /or this session is already inside an isolated worktree/);
  assert.match(text, /Any ledger-bound note Step 2 generates before that point \(2\.5's divergence `ops` entry, 2\.6's shape-check `ops` entries\) is logged to `decisions\.md`/);
  assert.match(text, /only when Create actually wrote the file, never when it already existed/);
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6 \(single-spec\) or `multi-spec\.md`'s "Shared worktree" step 1 \(multi-spec\)/);
});

test('AC1.1: build/worktree-setup.md Step 4.6 creates the ledger after the worktree exists, flow-parented single-spec only', () => {
  const text = read('build/worktree-setup.md');
  assert.match(text, /4\.6\. \*\*Create the open-items ledger \(`\/flow` single-spec runs, #3036\)\*\*/);
  assert.match(text, /only when `\$PIPELINE_RUN_DIR` is already set/);
  assert.match(text, /`MULTISPEC_SHARED_WORKTREE` is not set/);
  assert.match(text, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
  assert.match(text, /Then follow `\/claude-tweaks:ledger` Create's "At a post-worktree creation point" paragraph/);
  const recordAt = text.indexOf('4.5. **Record the assignment**');
  const createAt = text.indexOf('4.6. **Create the open-items ledger');
  assert.notStrictEqual(recordAt, -1, 'Step 4.5 marker must exist');
  assert.notStrictEqual(createAt, -1, 'Step 4.6 marker must exist');
  assert.ok(recordAt < createAt, 'Step 4.6 must follow Step 4.5');
});

test('AC2.1: the No-worktree run exception is keyed on strategy/shape, not the momentary worktree field', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /A run that will \*\*never\*\* have a worktree/);
  assert.match(text, /Keyed on the resolved strategy or run shape, never on `run-state\.json`'s momentary lack of a `worktree` field/);
  assert.doesNotMatch(text, OLD_CONDITION);
});

test('AC3.1: a wrap-up-only run with no worktree still gets its run-dir ledger', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /a wrap-up-only invocation with no build\/test\/review step left to create one/);
  assert.match(text, /\{run-dir\}\/ledger\.md/);
});

test('Gotcha 3: an adopted run dir already holding a pre-#3036 run-dir ledger keeps using it', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /already holding a `\{run-dir\}\/ledger\.md` written under the pre-#3036 rule keeps that file as its ledger/);
});

test('ledger/SKILL.md Create names every creation site and the re-keyed location rule', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6/);
  assert.match(text, /"Shared worktree" step 1/);
  assert.match(text, /for a run that will never have a worktree \(#3036/);
  assert.doesNotMatch(text, /when this run has no worktree \(`run-state\.json` carries no `worktree` field/);
  assert.match(text, /\/claude-tweaks:build/);
  assert.doesNotMatch(text, /or an already-isolated session/);
  assert.match(text, /this run's active ledger already exists \(resuming a pipeline — resolved per `_shared\/ledger-format\.md`'s resolution rule/);
  assert.match(text, /\*\*At a post-worktree creation point\*\*/);
  assert.match(text, /Either way — created now or found — append any ledger-bound note `\/flow` Step 2 held/);
  assert.match(text, /then commit a `docs\/plans\/` ledger by its explicit path/);
});

test('_shared/worktree-setup.md states that a tracked write after Adopt-or-create must be committed', () => {
  const text = read('_shared/worktree-setup.md');
  assert.match(text, /a step that writes a tracked-path file after this gate .* commits it before any later re-check/);
});

test('go-red proof: the pre-#3036 exception sentence fails the AC2.1 negative assertion', () => {
  const old = 'A run with no worktree at all — `run-state.json` carries no `worktree` field, or no `run-state.json` exists yet';
  assert.throws(() => assert.doesNotMatch(old, OLD_CONDITION));
});

test('AC1.1: multi-spec creates one shared ledger at Shared worktree step 1, parent scope', () => {
  const text = read('flow/multi-spec.md');
  const start = text.indexOf('### Shared worktree');
  assert.ok(start !== -1, 'Shared worktree section must exist');
  const end = text.indexOf('2. **Per-record builds skip creation**', start);
  assert.ok(end !== -1, 'Shared worktree step 2 end anchor must exist');
  const section = text.slice(start, end);
  assert.match(section, /Create the open-items ledger here \(#3036\)/);
  assert.match(section, /the parent run dir `\{parent\}\/`, exported later as `\$MULTISPEC_PARENT_DIR`/);
  assert.match(section, /spec-\{N1\}-\{N2\}/);
  assert.match(section, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
  assert.match(section, /then follow `\/claude-tweaks:ledger` Create's "At a post-worktree creation point" paragraph/);
});

test('AC4.1: the QA Ledger Check finds the creation line on both the single-spec and multi-spec paths', () => {
  const text = read('review/code-mode-steps.md');
  const start = text.indexOf('### QA Ledger Check');
  assert.ok(start !== -1);
  const section = text.slice(start, start + 2500);
  assert.match(section, /`build\/worktree-setup\.md` Step 4\.6/);
  assert.match(section, /\$MULTISPEC_PARENT_DIR\/decisions\.md` as well/);
  assert.doesNotMatch(section, /\(`\/flow`'s Step 1\.8 log line,/);
});

test('flow/validation.md holds Step 2.5/2.6 ledger-bound notes until the ledger exists', () => {
  const text = read('flow/validation.md');
  assert.match(text, /Under the `worktree` strategy the open-items ledger does not exist yet at this step/);
  assert.match(text, /appended to the ledger as an `ops` row by whichever step creates it \(`build\/worktree-setup\.md` Step 4\.6, or `multi-spec\.md`'s "Shared worktree" step 1/);
  assert.doesNotMatch(text, /Continued and added ops ledger entry/);
});

test('#3289: Step 4.6 runs after Step 6 records the draft PR, not in numbered order', () => {
  const text = read('build/worktree-setup.md');
  assert.match(text, SEQUENCING_3289);
  assert.match(text, /`checkBookkeepingStampsGate` denies the ledger `Write` until `run-state\.json` carries the `pr` stamp/);
  const step6 = text.slice(text.indexOf('6. **Open the draft PR'), text.indexOf('## Cherry-pick source-branch PR check'));
  assert.match(step6, /then run Step 4\.6 if it is still pending \(#3289\)/);
});

test('go-red proof: the pre-#3289 Step 4.6 text fails the sequencing assertion', () => {
  const old = 'This is the first point a `docs/plans/` write can land under `worktree-always` (the reason `materialize.md` writes the spec after worktree creation), and it precedes every build task.';
  assert.throws(() => assert.match(old, SEQUENCING_3289));
});
