'use strict';
// Pins the load-bearing text of skills/routine-kickoff/SKILL.md (#528) so none
// of it can be silently dropped: the dispatch/tidy manual-execution exclusion,
// the blast-radius note, and the standalone-followability note. Deliberately
// does NOT assert the repo contains zero references to routine-kickoff --
// the kernel migration (#529) wires references in immediately after landing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const skill = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'routine-kickoff', 'SKILL.md'), 'utf8');

test('names dispatch, tidy, and backlog as manual-execution exclusions, with the principle', () => {
  assert.ok(skill.includes('the target is `dispatch`, `tidy`, or `backlog`'));
  assert.ok(skill.includes('report the degraded sandbox and stop'));
  assert.ok(skill.includes(
    'Dispatch claims queue records and triggers builds and merges, tidy\'s '
    + 'standalone-auto mode applies deletions'));
  assert.ok(skill.includes(
    'backlog refine\'s headless posture applies `auto:build`/`auto:merge` labels — '
    + 'machine-granted authorization is the same class of standing effect'));
  assert.ok(skill.includes(
    'any future routine whose skill claims work or writes beyond report-only '
    + 'surfaces gets the same exclusion'));
});

test('has a failure branch for a stale/renamed target skill on the manual-execution path', () => {
  assert.ok(skill.includes('If that file does not exist'));
  assert.ok(skill.includes('never guess at a similarly-named skill'));
});

test('states the hand-maintenance rule for the exclusion list', () => {
  assert.ok(skill.includes('hand-maintained'));
  assert.ok(skill.includes('the pinning test covers only the current names'));
});

test('carries the blast-radius standing constraint', () => {
  assert.ok(skill.includes('**Blast radius.**'));
  assert.ok(skill.includes('no per-routine pin'));
  assert.ok(skill.includes('the only rollback is a fix release'));
  assert.ok(skill.includes('shipped contract under expand-contract discipline'));
});

test('carries the standalone-followability standing constraint', () => {
  assert.ok(skill.includes('**Standalone followability.**'));
  assert.ok(skill.includes('reads this file as raw prose'));
  assert.ok(skill.includes('executable as written by a model with no Skill-tool support'));
});

// The unattended framing lives here, not in the frozen kernel: this file reaches
// every firing at the next release with no re-provisioning, and the framing must
// cite the mode system's gates rather than restate a stop list of its own
// (routine-template-schema.md's Anti-Patterns forbid routine-specific
// mode-signaling in prose). Each clause below is load-bearing: the "ends the
// firing undone" motivation, the authorization scope, the gate carve-out, the
// Next Actions carve-out, and the done/undone report shape.
test('carries the unattended-firing standing constraint, scoped to what the kickoff already covers', () => {
  assert.ok(skill.includes('**Unattended firing.**'));
  assert.ok(skill.includes('ends the firing with that work undone'));
  assert.ok(skill.includes('Work the kickoff line already covers is authorized'));
  assert.ok(skill.includes('This authorizes nothing else'));
  assert.ok(skill.includes("`_shared/auto-mode-contract.md`'s never-silenced list stand at this project's `autonomy` ceiling exactly as written"));
  assert.ok(skill.includes('a firing with no mode signal still falls back to interactive per that contract'));
  assert.ok(skill.includes('report it as blocked and stop, not self-resolve'));
  assert.ok(skill.includes('terminal `## Next Actions` block is a required handoff, not a deferred plan'));
  assert.ok(skill.includes('Close with what was done and what was left undone.'));
  // #1909: the Interaction style directive no longer lives inline in any
  // SKILL.md (moved to the SessionStart hook injection) — this constraint
  // text must not have been merged into or confused with it.
  assert.ok(!skill.includes('> **Interaction style:**'));
});
