// tests/deferred-closure-fixes-2686.test.js
//
// Pins the two prose sites #2686 (extended by #3136 to cover single-record
// runs) changed so the dual-marker `Fixes #{n}` block never contradicts a
// spec's own logged decision to withhold its closing keyword:
//
// - plugin/skills/_shared/pr-early-run-lifecycle.md — defines the one
//   `deferred-closure: spec #{n} closing keyword withheld ({reason})`
//   decisions.md entry shape a later run can check against reliably, for
//   both a bundle run's per-spec subdirectory and a single-record run's
//   own top-level decisions.md.
// - plugin/skills/_shared/pr-checklist-refresh.md — the "Pre-merge
//   title/description refresh" section's Fixes-block rewrite step, which
//   must read that entry (via `readDeferredClosures` for a bundle run,
//   `readSingleRecordDeferredClosure` for a single-record run) before
//   calling `composeFixesBlock`, and must be able to emit a
//   `Refs #{m} — deferred: {reason}` line even for a `complete` spec.
//
// The underlying behavior (composeFixesBlock's deferredClosures override,
// readDeferredClosures's/readSingleRecordDeferredClosure's parsing) is
// pinned by unit tests in tests/bin-lib/flow/manifest.test.js; this suite
// pins only the prose that documents and wires that behavior into the
// pipeline.
//
// Matching is done against whitespace-normalized text so an assertion never
// depends on exactly where a prose line happens to wrap ([IL-80] applies —
// this suite reads live production prose because the exact wording asserted
// IS the contract this record exists to fix).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const PR_EARLY_PATH = path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const PR_CHECKLIST_REFRESH_PATH = path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'pr-checklist-refresh.md');

function read(p) { return readText(p); }
function norm(s) { return s.replace(/\s+/g, ' '); }

test('#2686/#3136: pr-early-run-lifecycle.md defines the deferred-closure decisions.md entry shape for both run shapes', () => {
  const text = norm(read(PR_EARLY_PATH));
  const section = text.split('**Deferred-closure decisions')[1];
  assert.ok(section, 'the "Deferred-closure decisions" paragraph must exist');
  const window = section.slice(0, 2000);
  assert.match(window, /deferred-closure: spec #\{n\} closing keyword withheld \(\{reason\}\)/,
    'must define the one canonical decisions.md entry text');
  assert.match(window, /readDeferredClosures/,
    'must name the bundle-run reader helper that recognizes this shape');
  assert.match(window, /readSingleRecordDeferredClosure/,
    'must name the single-record-run reader helper that recognizes this shape (#3136)');
  assert.match(window, /run's own top-level `decisions\.md`/,
    'must state a single-record run logs to its own top-level decisions.md, not a spec-{id}/ subdirectory');
});

test('#2686/#3136: pr-checklist-refresh.md Fixes-block rewrite reads deferred-closure entries before composing, for both run shapes', () => {
  const text = norm(read(PR_CHECKLIST_REFRESH_PATH));
  const section = text.split('## Pre-merge title/description refresh')[1];
  assert.ok(section, 'the Pre-merge title/description refresh section must exist');
  assert.match(section, /readDeferredClosures/,
    'the rewrite step must name the readDeferredClosures helper it calls for a bundle run');
  assert.match(section, /readSingleRecordDeferredClosure/,
    'the rewrite step must name the readSingleRecordDeferredClosure helper it calls for a single-record run (#3136)');
  assert.match(section, /Refs #\{m\} — deferred: \{reason\}/,
    'the rewrite step must describe emitting a deferred Refs line');
  assert.match(section, /even when `complete`/,
    'must state the deferred-closure check overrides a complete status');
  assert.match(section, /readManifest.*returns `null`/,
    'must branch on readManifest returning null to detect a single-record run');
});
