'use strict';
// tests/flow-express-entry-prose.test.js — #4025: pins /flow's express entry. SKILL.md Step 2
// lists a 2.9 route after Step 2.8's claim and before Step 3's Manifesto, citing
// express-entry.md; that file states the entry conditions (one record in a run dir Step 2.8
// minted, no step list, auto mode, the worktree strategy, an eligible gate verdict), the worktree adopt-or-create plus an
// un-dispatched record-worktree bind, the procedure from step 2, Step 3 on escalation, and the
// short `## Flow: Express lane` note on every other outcome. All of it is new prose in this
// change, so every go-red control mutates the live text in memory (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FLOW = path.join(__dirname, '..', 'plugin', 'skills', 'flow');
const SKILL = path.join(FLOW, 'SKILL.md');
const ENTRY = path.join(FLOW, 'express-entry.md');

// The text between two anchors; both must resolve, so a lost end anchor cannot widen the region.
function between(text, start, end) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `start anchor not found: ${start}`);
  const e = text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `end anchor not found: ${end}`);
  return text.slice(s, e);
}
const STEP3 = '### Step 3: Pipeline Config Manifesto';
const step2 = (text) => between(text, '### Step 2: Pre-flight Checks', STEP3);

const missingFactsOf = (facts) => (text) => facts.filter(([re]) => !re.test(text)).map(([, name]) => name);

// Strip one fact's match from the live region; the predicate must report exactly that fact.
function assertEachFactGoesRed(text, facts) {
  const missing = missingFactsOf(facts);
  for (const [re, name] of facts) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `anchor for "${name}" not found — the proof cannot discriminate`);
    assert.deepEqual(missing(doctored), [name], `removing only "${name}" must turn exactly that fact red`);
  }
}

const STEP2_FACTS = [
  [/^- 2\.9 — Express route\./m, '2.9 bullet'],
  [/read `express-entry\.md` in this skill's directory and follow it before Step 3/, 'cites express-entry.md before Step 3'],
  [/every `\/claude-tweaks:dispatch` call passes one, so a dispatched call never enters it/, 'a dispatched call never enters it'],
  [/, mode `auto` and the `worktree` strategy/, 'auto mode only'],
  // M1: the cheap policy read is the first condition, so a lane-off project reads nothing more.
  [/`express-lane` resolves `true` \(checked first: `resolve-policy\.js --values express-lane`\), one record reference/, 'the express-lane policy is the first condition'],
];

test('SKILL.md Step 2 lists the 2.9 express route citing express-entry.md', () => {
  assert.deepEqual(missingFactsOf(STEP2_FACTS)(step2(readText(SKILL))), []);
});

test('go-red control: each Step 2 express fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(step2(readText(SKILL)), STEP2_FACTS);
});

const B28 = '- 2.8 — Claim the targets.';
const B29 = '- 2.9 — Express route.';
// 2.8's bullet, then 2.9's, then Step 3's heading, each present.
function requireOrder(text) {
  let last = -1;
  for (const marker of [B28, B29, STEP3]) {
    const idx = text.indexOf(marker);
    assert.notEqual(idx, -1, `marker not found: ${marker}`);
    assert.ok(idx > last, `"${marker}" is out of order`);
    last = idx;
  }
}

test('SKILL.md: the 2.9 bullet follows 2.8 and precedes Step 3', () => {
  requireOrder(readText(SKILL));
});

test('go-red control: the 2.9 line moved above 2.8 breaks the order check', () => {
  const text = readText(SKILL);
  const lines = text.split('\n');
  const i29 = lines.findIndex((l) => l.startsWith(B29));
  assert.notEqual(i29, -1);
  const line29 = lines[i29];
  const without = lines.filter((_, i) => i !== i29);
  const i28 = without.findIndex((l) => l.startsWith(B28));
  const permuted = [...without.slice(0, i28), line29, ...without.slice(i28)].join('\n');
  assert.notEqual(permuted, text);
  assert.throws(() => requireOrder(permuted), /out of order/);
});

const ENTRY_FACTS = [
  [/names exactly one record reference/, 'one record'],
  [/`\$PIPELINE_RUN_DIR` was unset on entry, so Step 2\.8 minted the run dir and claimed under it/, 'a run dir Step 2.8 minted'],
  [/An explicit step list never enters the lane — every `\/claude-tweaks:dispatch` call passes one/, 'no explicit step list'],
  [/Step 1\.3 resolved `worktree`/, 'the worktree strategy'],
  [/Step 1\.1 resolved mode `auto`[^\n]*`confirm`, `hybrid` and `interactive`[^\n]*take the normal path/, 'auto mode only; confirm, hybrid and interactive take the normal path'],
  [/express-lane\.js" gate --issue \{n\} --run "\$PIPELINE_RUN_DIR"` exits 0 and its one verdict carries `eligible: true`/, 'an eligible gate verdict'],
  [/or any non-zero exit \([^)]*\), is not eligible: continue at Step 3/, 'a non-zero gate exit → Step 3'],
  [/per `_shared\/worktree-setup\.md`'s Adopt-or-create/, 'worktree adopt-or-create'],
  [/then its Post-creation catch-up, unconditionally/, 'post-creation catch-up'],
  [/hooks\.js" record-worktree --run "\$PIPELINE_RUN_DIR" "\{worktree\}"`/, 'record-worktree --run'],
  [/Never `--dispatch`: this run is not dispatch-bound/, 'bound without --dispatch'],
  [/A failure in step 1 or 2[^\n]*is outcome `blocked`[^\n]*never continues at Step 3 on an unbound worktree/, 'a worktree or bind failure is blocked, never Step 3'],
  [/Run `_shared\/express-lane\.md`'s Procedure from step 2/, 'the procedure from step 2'],
  [/when Step 1 detected `pre-authorize-merge`, step 7 appends `,merge-authorization=pre-authorized` to step 5's `configSet`/, 'M11: a typed pre-authorize-merge reaches config.yml'],
  [/\*\*`express-escalated`\*\* — continue at Step 3, unchanged/, 'escalation → Step 3'],
  [/reads the run dir as case 3/, 'the adoption pack reads case 3'],
  [/render the note below and end the run: no Manifesto, no Pipeline Summary/, 'other outcomes → the note, then end'],
  [/^## Flow: Express lane$/m, 'the note heading'],
  [/^#\{n\} — \{outcome\}$/m, 'the note names the outcome'],
  [/^PR: \{PR link \| none\}$/m, 'the note names the PR link'],
  [/^Run dir: \{run-dir\}$/m, 'the note names the run dir'],
];

test('express-entry.md states the entry conditions, the worktree bind, escalation and the note', () => {
  assert.deepEqual(missingFactsOf(ENTRY_FACTS)(readText(ENTRY)), []);
});

test('go-red control: each express-entry fact stripped reports exactly itself', () => {
  assertEachFactGoesRed(readText(ENTRY), ENTRY_FACTS);
});
