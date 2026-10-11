'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #413: Console execution — reconciler executes answered consoles, live
// accelerator, consoleAutoResolve. Prose-as-implementation, same convention
// as the other pr-first sub-issues' test files — pin the key claims against
// the actual file text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const EXEC = read('plugin', 'skills', '_shared', 'console-execution.md');
const REVIEW_CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');
const REVIEW_CONSOLE_INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');
const DISPATCH_SKILL = read('plugin', 'skills', 'dispatch', 'SKILL.md');
const SCAN_PROCEDURES = read('plugin', 'skills', 'tidy', 'scan-procedures.md');
const AUTONOMY_CEILING = read('plugin', 'skills', '_shared', 'autonomy-ceiling.md');
const CONTEXT_JS = read('plugin', 'bin', 'lib', 'hooks', 'context.js');
const INDEX_JS = read('plugin', 'bin', 'lib', 'reconcile', 'index.js');

test('detection is Node-only, gh-CLI-only, and execution always happens in an agent session', () => {
  assert.match(EXEC, /Detection is pure Node \(`bin\/lib\/reconcile\/console-execute\.js`\)/);
  assert.match(EXEC, /it never executes, only reports/);
  assert.match(EXEC, /\*\*Execution always happens in an invoking agent session\*\*, never\s*\n?\s*in Node/);
  assert.match(EXEC, /gh-CLI-only.*no MCP fallback in Node/s);
});

test('the pre-execution claim is check-then-act with a 30-minute reclaim window', () => {
  assert.match(EXEC, /writes `console\.json\.executingAt`/);
  assert.match(EXEC, /younger than 30 minutes/);
  assert.match(EXEC, /reclaimable: overwrite it and proceed/);
});

test('write order is reply comment first, then the resolved marker, then executedAt', () => {
  assert.match(EXEC, /\*\*Reply comment first, then the resolved marker edit\*\* on the console comment itself — never the\s*\n?\s*reverse/);
  assert.match(EXEC, /<!-- claude-tweaks-console-resolved -->/);
});

test('split-brain repair keys off the reply comment\'s presence, not console.json alone', () => {
  assert.match(EXEC, /keys\s*\n?\s*"already executed" off the reply comment's presence on the PR, not off `console\.json` alone/);
});

test('staged-file drift check: missing is unexecutable, hash mismatch is unexecutable-stale, neither blocks the rest', () => {
  assert.match(EXEC, /Missing → unexecutable/);
  assert.match(EXEC, /Hash mismatch → unexecutable-stale/);
  assert.match(EXEC, /Neither case blocks the rest\s*\n?\s*of the console/);
});

test('declined items log exactly as an Override-drill decline does today', () => {
  assert.match(EXEC, /An\s*\n?\s*unticked item at Resolve time is declined/);
});

test('the live-session accelerator races chat vs. PR ticks, first answer wins, headless skips entirely', () => {
  assert.match(EXEC, /Two surfaces, one answer: whichever resolves first wins/);
  assert.match(EXEC, /\*\*Headless\*\* firings skip `AskUserQuestion` entirely/);
});

test('a PR-ticks-first race is detected before acting on a chat answer, never double-executed', () => {
  assert.match(EXEC, /before acting on the chat answer, re-check the\s*\n?\s*console comment for the resolved marker/);
});

test('consoleAutoResolve is a per-item loop, not a blanket flag, forward-compatible with #347', () => {
  assert.match(EXEC, /\*\*Per item, not a blanket flag:\*\*/);
  // #1294 added the one narrower exception the per-item loop was originally written ahead
  // of (the isMergeRow/needs-human carve-out) — #347's general floor predicate remains
  // future work, not pre-implemented, which is the claim this test pins.
  assert.match(EXEC, /#347.*is expected to add\s*\n?\s*later/s);
  assert.match(EXEC, /do not generalize it\s*\n?\s*into a broader test or pre-implement #347's predicate here/);
});

test('consoleAutoResolve performs real comment edits, flagged AUTO, and only auto-ticks Resolve when every item is floor-clearing', () => {
  assert.match(EXEC, /\*\*Auto-resolution performs real comment edits\.\*\*/);
  assert.match(EXEC, /The Resolve box is ticked only\s*\n?\s*when every item in the console is floor-clearing/);
});

test('the comment-tick trust boundary matches the merge path\'s — no second authorization layer', () => {
  assert.match(EXEC, /the same boundary the merge path\s*\n?\s*already accepts/);
  assert.match(EXEC, /Do not build a second authorization layer here/);
});

test('entry points name session-start, dispatch, and tidy', () => {
  assert.match(EXEC, /bin\/lib\/hooks\/session-start\.js.*additionalContext/s);
  assert.match(EXEC, /`\/claude-tweaks:dispatch` and `\/claude-tweaks:tidy`/);
});

test('the ctx.ownedRun exemption is stated as sanctioned, not accidental', () => {
  assert.match(EXEC, /Console execution is the sanctioned exception to the hooks dispatcher's ownership-scoped write path/);
});

// --- Wiring into review-console.md / multispec-review-console.md ---

test('review-console.md\'s Console-on-PR section: live sessions ask via AskUserQuestion, headless reports pending-review', () => {
  const section = REVIEW_CONSOLE_INTERACTIVE.slice(
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Console-on-PR'),
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Present the console'),
  );
  assert.match(section, /A live session also asks via `AskUserQuestion`/);
  assert.match(section, /_shared\/console-execution\.md/);
  assert.match(section, /headless skips straight to reporting `pending-review`/);
});

test('multispec-review-console.md\'s Console-on-PR section carries the same live/headless split', () => {
  const section = MULTISPEC_CONSOLE.slice(
    MULTISPEC_CONSOLE.indexOf('## Console-on-PR'),
    MULTISPEC_CONSOLE.indexOf('## Present the consolidated console'),
  );
  assert.match(section, /_shared\/console-execution\.md/);
  assert.match(section, /Live: also ask/);
  assert.match(section, /Headless: report `pending-review`/);
});

// --- Wiring into dispatch/SKILL.md and tidy/scan-procedures.md ---

test('dispatch/SKILL.md Step 2 routes a non-empty console.ready through console-execution.md', () => {
  assert.match(DISPATCH_SKILL, /`console\.ready` array is non-empty, follow `_shared\/console-execution\.md`/);
});

test('tidy/scan-procedures.md Step 4.5 routes a non-empty console.ready through console-execution.md', () => {
  assert.match(SCAN_PROCEDURES, /A non-empty `console\.ready` array names answered consoles.*follow `_shared\/console-execution\.md`/s);
});

// --- autonomy-ceiling.md wiring ---

test('autonomy-ceiling.md names console-execution.md as a second consoleAutoResolve caller', () => {
  assert.match(AUTONOMY_CEILING, /_shared\/console-execution\.md/);
  assert.match(AUTONOMY_CEILING, /Two sanctioned callers/);
});

// --- context.js exemption ---

test('context.js documents the console-execution exemption to ctx.ownedRun write-scoping', () => {
  assert.match(CONTEXT_JS, /Sanctioned exception \(#413\)/);
  assert.match(CONTEXT_JS, /Do not "fix" this by tightening the ownership check/);
});

// --- reconcile/index.js wiring ---

test('reconcile/index.js registers console in ALL_CHECKS and the pr-first dispatch, ordered before reap', () => {
  // #561 near-miss: this used to pin the ALL_CHECKS array literal exactly
  // (byte-for-byte), which broke on red-tip's unrelated insertion even
  // though console's own membership/ordering claim was untouched — the same
  // brittleness reconcile.test.js's own ALL_CHECKS-ordering tests already
  // avoid by indexing into the real array rather than pinning full prose.
  // Parse the array literal's contents (still "pin against actual file
  // text", this file's own stated convention) and assert only the specific
  // membership/ordering claim this test is actually about, so the next
  // unrelated ALL_CHECKS insertion doesn't require touching this file.
  const allChecksMatch = INDEX_JS.match(/const ALL_CHECKS = \[([^\]]+)\];/);
  assert.ok(allChecksMatch, 'ALL_CHECKS array literal must be present and parseable');
  const allChecks = allChecksMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.ok(allChecks.includes('console'), 'console must be registered in ALL_CHECKS');
  assert.ok(allChecks.includes('mirror'), 'mirror must be registered in ALL_CHECKS');
  assert.ok(allChecks.indexOf('mirror') < allChecks.indexOf('console'), 'mirror must precede console in ALL_CHECKS');
  const consoleIdx = INDEX_JS.indexOf("checks.includes('console')");
  const reapIdx = INDEX_JS.lastIndexOf("checks.includes('reap')");
  assert.ok(consoleIdx > 0 && reapIdx > 0 && consoleIdx < reapIdx, 'console must dispatch before reap, same ordering constraint as release/archive');
});

test('reconcile/index.js\'s local-merge skip line includes console alongside mirror/release/archive', () => {
  assert.match(INDEX_JS, /check: 'mirror,release,archive,archive-branches,remote-prune,console'/);
});
