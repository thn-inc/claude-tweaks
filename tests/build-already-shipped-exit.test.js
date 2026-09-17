'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2502: reproduces the #2028/PR#2234 shape -- a record whose materialized
// spec's every deliverable and acceptance criterion is already satisfied on
// the base branch (PR #2234, merged 2026-09-12, closed #2028's deliverables
// via a non-closing `refs #2028` mention) used to have no documented exit:
// build committed a "verified already implemented, no code changes" doc,
// opened a bookkeeping-only draft PR (#2497), and the pipeline ran all the
// way to `pending-review` for a human to close by hand. These pin the
// documented `already-shipped` exit added across build/SKILL.md,
// dispatch/task-prompt.md, and dispatch/two-call-gate.md.

test('#2502: build/SKILL.md Spec Step 2 gains an Already-shipped assessment, distinct from the #1829 Premise-check routing', () => {
  const t = read('plugin/skills/build/SKILL.md');
  assert.match(t, /\*\*Already-shipped assessment \(#2502\)\.\*\*/);
  const section = t.slice(t.indexOf('**Already-shipped assessment (#2502).**'));
  assert.match(section, /zero implementation diff required/);
  assert.match(section, /Report `OUTCOME: already-shipped`/);
  assert.match(section, /do \*\*not\*\* invoke Settle/);
  assert.match(section, /Stage a Close proposal/);
  assert.match(section, /shipped-candidate\.js/);
  assert.match(section, /Close any draft PR the pr-early lifecycle already opened/);
  assert.match(section, /\*\*Release the record's claim\*\* now/);
  assert.match(section, /\*\*Do not commit a "verified already implemented, no code changes" bookkeeping doc\*\*/);
  // Must be reachable before a plan is searched for, on both the plan-exists
  // and no-plan-exists branches -- placed ahead of the plan search entirely.
  const planSearchIdx = t.indexOf('Search `docs/superpowers/plans/` for a plan matching this spec');
  const assessmentIdx = t.indexOf('**Already-shipped assessment (#2502).**');
  assert.ok(assessmentIdx > -1 && planSearchIdx > -1 && assessmentIdx < planSearchIdx, 'assessment must run before the plan search');
});

test('#2502: dispatch/task-prompt.md adds already-shipped to the first-call OUTCOME vocabulary and documents the second-call gate distinctly from failure', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(t, /OUTCOME: \{build-test-ok \| build-test-failed \| build-test-blocked \| already-shipped\}/);
  assert.match(t, /An `OUTCOME` of `already-shipped` \(#2502\) is a \*\*third, distinct\*\* case, neither success nor failure/);
  assert.match(t, /Take `two-call-gate\.md` §7's terminal path for it, never section 5's/);
  assert.match(t, /never invokes Settle's failure classification, retry counting, or failure comment/);
});

test('#2502: two-call-gate.md gains §7, a non-failure terminal path for already-shipped that still tears down the worktree', () => {
  const t = read('plugin/skills/dispatch/two-call-gate.md');
  assert.match(t, /^## 7\. Terminal path when the first call reports `already-shipped`$/m);
  const section7 = t.slice(t.indexOf('## 7. Terminal path'));
  assert.match(section7, /This is \*\*not\*\* a failure/);
  assert.match(section7, /staged a Close proposal for the record/);
  assert.match(section7, /closed any draft PR the pr-early lifecycle opened for this run/);
  assert.match(section7, /released the record's claim/);
  assert.match(section7, /PIPELINE_RUN_DIR="\{run-dir\}" CLAIM_RUN_ID="\{RUN_ID\}" \/claude-tweaks:wrap-up \{target\} cleanup-only/);
  assert.match(section7, /never `pending-review`/);
  // §2's gate must route already-shipped to §7, not §5.
  const gateSection = t.slice(t.indexOf('## 2. The gate'), t.indexOf('## 5. Terminal path'));
  assert.match(gateSection, /An `OUTCOME` of `already-shipped` \(#2502\) is never dispatched to the second call either.*go to section 7 instead of section 5/);
});

test('#2502: dispatch/reporting.md documents the no-op report shape for already-shipped groups', () => {
  const t = read('plugin/skills/dispatch/reporting.md');
  assert.match(t, /already-shipped` groups report as a no-op, never `pending-review` \(#2502\)/);
  assert.match(t, /no `PushNotification`/);
});
