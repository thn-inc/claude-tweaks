'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Observed live 2026-08-13: a dispatch-created worktree's /flow invocation created its run
// directory (config.yml/decisions.md/staged/, plus every spec-{N}/ subdirectory) *inside*
// that worktree instead of the main checkout, contradicting _shared/pipeline-run-dir.md's own
// Anchoring section — whose entire purpose is that a worktree removal can never destroy
// pipeline state. Root cause: the actual creation-time path templates in flow/manifesto.md,
// flow/multi-spec.md, and flow/steps-and-gates.md gave a bare relative path with no
// instruction to resolve $RUN_ROOT first, even though materialize.md's /build standalone
// fallback and _shared/run-dir-resolution.md's own bash snippet already did this correctly.
// These guards pin that every run-dir creation site now states the anchoring requirement
// explicitly, so a future edit can't silently drop it again.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const MANIFESTO = read('plugin', 'skills', 'flow', 'manifesto.md');
const FLOW_SKILL = read('plugin', 'skills', 'flow', 'SKILL.md');
const MULTI_SPEC = read('plugin', 'skills', 'flow', 'multi-spec.md');
const STEPS_AND_GATES = read('plugin', 'skills', 'flow', 'steps-and-gates.md');
const AUTO_MODE_CONTRACT = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
const CONTEXT_FLOW = read('plugin', 'skills', 'help', 'context-flow.md');
const MATERIALIZE = read('plugin', 'skills', 'flow', 'materialize.md');

test("manifesto.md's Path conventions anchor the run directory to $RUN_ROOT", () => {
  assert.match(
    MANIFESTO,
    /Run directory: `\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\/`/,
    'a bare relative path here creates the run directory wherever /flow happens to be invoked from — inside a dispatch-created worktree, that traps config.yml/decisions.md/staged/ where a later worktree removal destroys them with no git history to recover from',
  );
});

test("manifesto.md names the concrete dispatch scenario the anchoring requirement protects against", () => {
  assert.match(
    MANIFESTO,
    /`\/claude-tweaks:dispatch` Step 5 enters a group's worktree \*before\*\s+dispatching this Manifesto step/,
    'stating the requirement without naming why it matters invites a future edit to treat it as boilerplate and drop it',
  );
});

test("manifesto.md's on-approval write path also anchors to $RUN_ROOT", () => {
  assert.match(
    MANIFESTO,
    /write the chosen values to `\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\/config\.yml`/,
    'the FYI (auto-mode) path and the approval-gate path are two separate write instructions in this file — fixing only one leaves the other creating an unanchored directory whenever confirm/hybrid mode is used',
  );
});

test("flow/SKILL.md's Step 3 creation line anchors to $RUN_ROOT", () => {
  assert.match(
    FLOW_SKILL,
    /writes `config\.yml` \+ initializes `decisions\.md` in `\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\/`/,
    "this is the operative instruction an agent actually follows when running Step 3 — manifesto.md's own fix is not load-bearing if this restatement still gives a bare relative path",
  );
});

test("steps-and-gates.md's unset-case creation path anchors to $RUN_ROOT", () => {
  assert.match(
    STEPS_AND_GATES,
    /create `\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\/`/,
    'this is a third independent restatement of the same creation path, inside the PIPELINE_RUN_DIR adoption branching logic — an agent reading only this file for the "unset" case must not fall back to a bare relative path',
  );
});

test("multi-spec.md's parent run directory anchors to $RUN_ROOT", () => {
  assert.match(
    MULTI_SPEC,
    /\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-spec-\{N1\}-\{N2\}-\{N3\}\//,
    "a dispatched bundle is exactly the case that was observed broken live — the parent dir and every spec-{N}/ subdirectory must not land inside the dispatch-created worktree",
  );
});

test('auto-mode-contract.md\'s canonical directory-layout diagram anchors to $RUN_ROOT', () => {
  assert.match(
    AUTO_MODE_CONTRACT,
    /\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\//,
    'this file is cited as the canonical description of directory layout — an unanchored diagram here misleads every reader even after the operative creation sites are fixed',
  );
});

test('help/context-flow.md describes the run directory as $RUN_ROOT-anchored', () => {
  assert.match(
    CONTEXT_FLOW,
    /\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-\{spec-slug\}\//,
    'this is the reference doc /help points users at — it must not describe a path that omits the anchoring that actually happens',
  );
});

// #439: materialize.md's own "Sequence, in worktree mode" text (~line 144) was never
// touched by the fix above — it separately instructed scaffolding the WHOLE run dir
// ("create `{run-dir}/work/` inside it [the worktree]") rather than only `work/`,
// reproducing the identical hazard on a fresh (non-adoption) /flow run. Live-reproduced
// during a #424 dispatch retry on 2026-08-14.

test('materialize.md\'s Sequence text no longer instructs scaffolding the whole run dir inside the worktree', () => {
  assert.doesNotMatch(
    MATERIALIZE,
    /create `\{run-dir\}\/work\/` inside it/,
    'this phrasing reads as "scaffold the whole {run-dir}, including the gitignored decisions.md/config.yml/staged/, inside the worktree" — exactly the #424 live-repro hazard',
  );
});

test('materialize.md\'s Sequence text states {run-dir} is anchored at $RUN_ROOT, never scaffolded inside the worktree', () => {
  assert.match(
    MATERIALIZE,
    /`\{run-dir\}` itself is never scaffolded inside the worktree — it is anchored at `\$RUN_ROOT`/,
    'the Sequence paragraph must state the anchoring explicitly, mirroring the Standalone fallback paragraph\'s already-correct wording a few lines below',
  );
});

test('materialize.md\'s Sequence text still scopes worktree-local creation to work/ only', () => {
  assert.match(
    MATERIALIZE,
    /Only `work\/` is created — inside the worktree, at the matching relative path/,
    'work/{n}-spec.md staying inside the worktree is correct and must be preserved — only the framing of the REST of {run-dir} was buggy',
  );
});
