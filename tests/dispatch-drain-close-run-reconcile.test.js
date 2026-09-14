'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2430: a bare-drain firing never closed the run directory it resolved at
// Step 1, and never re-ran reconcile once its own dispatched groups' PRs had
// merged -- both surfaced later as stale-run/orphaned-worktree notices for a
// future session to discover instead of being cleaned up by the firing that
// produced them.

test('#2430: Step 1 tracks whether $RUN_ID was minted or adopted, for the drain-termination cleanup to read', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const step1 = t.slice(t.indexOf('### Step 1: Resolve'), t.indexOf('### Step 2:'));
  assert.match(step1, /Note which resolution step actually fired \(#2430\)/);
  assert.match(step1, /\*\*minted\*\*/);
  assert.match(step1, /\*\*adopted\*\*/);
  assert.match(step1, /a still-running sibling session minted and still owns/);
});

test('#2430: the drain loop closes a minted run dir at termination, skips (and reports the skip for) an adopted one, and never adds an AskUserQuestion', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const section = t.slice(t.indexOf('At loop termination'), t.indexOf('**`next` (deprecated alias'));
  assert.match(section, /If Step 1 minted `\$RUN_ID`/);
  assert.match(section, /close-run --run "\$RUN_ID"/);
  assert.match(section, /An adopted directory is left alone and the skip is reported/);
  assert.match(section, /never an `AskUserQuestion`/);
});

test('#2430: drain termination re-runs reconcile a second time so merged-PR worktrees from this firing are reaped, not left for a future SessionStart', () => {
  const t = read('plugin/skills/dispatch/SKILL.md');
  const section = t.slice(t.indexOf('At loop termination'), t.indexOf('**`next` (deprecated alias'));
  assert.match(section, /run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" reconcile` a second time/);
  assert.match(section, /reaped now rather than left for a future session's SessionStart hook to discover/);
  // Step 1's own first reconcile call stays as-is -- this is additive, not a replacement.
  const throughStep3 = t.slice(t.indexOf('### Step 1: Resolve'), t.indexOf('### Step 4: Mint'));
  assert.strictEqual((throughStep3.match(/hooks\.js" reconcile/g) || []).length, 2, 'exactly two reconcile call sites: Step 1 and drain termination');
});
