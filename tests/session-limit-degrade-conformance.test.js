const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// #1449: review/step3-lens-dispatch.md's reproduction-pair dispatch never said what to
// do when one half of a pair dies to a session/usage limit mid-flight. This pins the
// two-file fix: a degrade-path paragraph in step3-lens-dispatch.md, and a terminal-vs-
// transient classification in the Failed-agent retrieval section — moved from
// subagent-output-contract.md to subagent-dispatch-core.md at #2019.

const ROOT = path.join(__dirname, '..');
// Fixed ancestor SHA — the commit this branch forked from, before either file carried
// the session-limit text. Never a moving ref (HEAD would collapse red into green once
// this change lands) — skill-prose-conformance-tests' "Proving discrimination without
// editing the tree" section.
const BASE_SHA = 'aa813ba825b20e11df35413bbd7ebd3e43c5af9c';

const DISPATCH_PATH = 'plugin/skills/review/step3-lens-dispatch.md';
const CONTRACT_PATH = 'plugin/skills/_shared/subagent-dispatch-core.md';

const dispatchProse = fs.readFileSync(path.join(ROOT, DISPATCH_PATH), 'utf8');
const contractProse = fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8');

// The pinned literal, checked case-insensitively at both revisions below.
const PINNED_LITERAL = /session limit/i;

function readAtRev(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], { cwd: ROOT, encoding: 'utf8' });
}

test('base SHA is a real ancestor of HEAD (precondition for the git-show proof below)', () => {
  // Throws (non-zero exit) if BASE_SHA is not an ancestor — fails loud on a rebase or
  // history rewrite that would otherwise silently invalidate the go-red proof.
  execFileSync('git', ['merge-base', '--is-ancestor', BASE_SHA, 'HEAD'], { cwd: ROOT });
});

test('step3-lens-dispatch.md names the session-limit degrade path (#1449 AC1)', () => {
  assert.match(
    dispatchProse,
    /session limit/i,
    'step3-lens-dispatch.md must name the session/usage-limit termination case for a ' +
      'reproduction-pair partner — without it, a headless run has no documented degrade path.',
  );
  // The paragraph must live in the reproduction-pair dispatch block, adjacent to the
  // existing Failed-agent retrieval citation, not just anywhere in the file.
  assert.match(
    dispatchProse,
    /Failed-agent retrieval[^]{0,500}session limit/i,
    'the session-limit paragraph must immediately follow the existing Failed-agent ' +
      'retrieval citation in the reproduction-pair dispatch block, not live disconnected ' +
      'from it.',
  );
  assert.match(
    dispatchProse,
    /retry (?:that one agent |it )?once/i,
    'the degrade paragraph must state the retry-once step before falling back to a ' +
      'single-read degrade.',
  );
});

test('subagent-output-contract.md classifies the session-limit signature as terminal (#1449 AC1)', () => {
  assert.match(
    contractProse,
    /session[- ]limit/i,
    'subagent-output-contract.md must name the session-limit signature.',
  );
  const start = contractProse.indexOf('## Failed-agent retrieval');
  assert.notStrictEqual(start, -1, 'the contract must keep its Failed-agent retrieval section');
  const nextHeading = contractProse.indexOf('\n## ', start + 1);
  const section = contractProse.slice(start, nextHeading === -1 ? undefined : nextHeading);
  assert.match(
    section,
    /session[- ]limit/i,
    'the session-limit classification must live inside the Failed-agent retrieval section ' +
      'itself, not somewhere else in the file that happens to mention it.',
  );
  assert.match(
    section,
    /terminal[^.]*transient|non-retryable-now/i,
    'the contract must distinguish the session-limit signature from a transient 5xx — ' +
      'that distinction is the whole point of naming it (per the record body).',
  );
});

test('go-red proof: the pinned literal is absent at the pre-change base SHA (#1449 AC2)', () => {
  // CONTRACT_PATH's content (the Failed-agent retrieval section) moved from
  // subagent-output-contract.md to subagent-dispatch-core.md at #2019 — the new file did not
  // exist at BASE_SHA, so the pre-change read has to target the old path where this content
  // actually lived back then.
  const HISTORICAL_PATH = {
    [CONTRACT_PATH]: 'plugin/skills/_shared/subagent-output-contract.md',
  };
  for (const file of [DISPATCH_PATH, CONTRACT_PATH]) {
    const preChangeFile = HISTORICAL_PATH[file] || file;
    assert.doesNotMatch(
      readAtRev(BASE_SHA, preChangeFile),
      PINNED_LITERAL,
      `${preChangeFile} must NOT contain "session limit" (case-insensitive) at the pre-change base ` +
        `${BASE_SHA} — a match here means the literal pre-existed and this pin is vacuous.`,
    );
    assert.match(
      readAtRev('HEAD', file),
      PINNED_LITERAL,
      `${file} must contain "session limit" (case-insensitive) at HEAD.`,
    );
  }
});
