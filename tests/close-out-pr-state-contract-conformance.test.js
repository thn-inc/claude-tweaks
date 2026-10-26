// tests/close-out-pr-state-contract-conformance.test.js — #3029: close-out.md
// step 2 must state resolvePrStateByNumber's positional signature and its full
// string-result contract, and say any string result stops the candidate —
// the missing signature is what let a caller misorder the arguments and read
// 'network-failure' as "not DIRTY".
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { serializeMarker } = require('../plugin/bin/lib/dispatch/close-out-marker.js');
const { parseArgs: parseMarkerArgs } = require('../plugin/bin/close-out-marker.js');

function readSkillFile(...segments) {
  return readText(path.join(__dirname, '..', 'plugin', 'skills', ...segments));
}

// Every go-red control mutates one clause, so that clause must occur exactly once in its source text.
function assertOccursOnce(text, clause, message) {
  assert.equal(text.split(clause).length, 2, message);
}

const CLOSE_OUT = readSkillFile('dispatch', 'close-out.md');
const UPDATE = readSkillFile('dispatch', 'close-out-update.md');
const STEP_2_START = CLOSE_OUT.indexOf('2. **Re-check mergeability');
const STEP_2_END = CLOSE_OUT.indexOf('3. **Convert draft to ready');
const STEP_2 = CLOSE_OUT.slice(STEP_2_START, STEP_2_END);

test('close-out step 2 is locatable', () => {
  assert.ok(STEP_2_START >= 0, 'step 2 heading not found — the heading text moved');
  assert.ok(STEP_2_END > STEP_2_START, 'step 3 heading not found after step 2 — the span would be wrong');
});

test('close-out step 2 names the positional signature', () => {
  assert.match(STEP_2, /resolvePrStateByNumber\(repoRoot, number\)/);
});

test('close-out step 2 names every string result the resolver returns', () => {
  for (const s of ['gh-absent', 'network-failure', 'invalid-arguments', 'pr-not-found']) {
    assert.ok(STEP_2.includes(`'${s}'`), `missing '${s}'`);
  }
});

test('close-out step 2 says a string result stops the candidate, never read as not DIRTY', () => {
  assert.match(STEP_2, /string result[\s\S]{0,120}stop[\s\S]{0,120}never read[\s\S]{0,40}not DIRTY/i);
});

// The text of one step-2 clause: from its opening marker up to the next clause's marker.
function routingSpan(step2, from, to) {
  const start = step2.indexOf(from);
  assert.ok(start >= 0, `step 2 clause not found: ${from}`);
  const end = step2.indexOf(to, start + from.length);
  assert.ok(end > start, `step 2 clause end not found: ${to}`);
  return step2.slice(start, end);
}

// STEP_2 with the update-file reference removed from one clause only.
function dropRefIn(step2, from, to) {
  const start = step2.indexOf(from);
  const end = step2.indexOf(to, start + from.length);
  return step2.slice(0, start) + step2.slice(start, end).replace(/close-out-update\.md/g, 'REMOVED') + step2.slice(end);
}

// One numbered step of close-out-update.md: from `\n{n}. **` to `\n{n+1}. **` (or the end).
// Step 0 is the preamble before step 1. Every pin below reads only its own step's span, so a
// clause in one step can never be satisfied by a word that happens to sit in another.
function stepSpan(update, n) {
  const start = n === 0 ? 0 : update.indexOf(`\n${n}. **`);
  assert.ok(start >= 0, `close-out-update.md step ${n} not found`);
  const end = update.indexOf(`\n${n + 1}. **`, start + 1);
  return update.slice(start, end < 0 ? undefined : end);
}

function before(span, a, b) {
  const first = span.indexOf(a);
  const second = span.indexOf(b);
  return first >= 0 && second >= 0 && first < second;
}

// Each pin: [id, step, check(span)]. The go-red table below mutates exactly one pin's clause.
const UPDATE_PINS = [
  ['wt-absolute', 0, (s) => s.includes('`{wt}` is the absolute `{main-checkout}/.worktrees/close-out-{number}`') && s.includes('never under `.claude/worktrees/`')],
  ['paste-quoted', 0, (s) => s.includes('double-quote every pasted path and ref (`{wt}`, `{main-checkout}`, `{head}`, `{base}`)')],
  ['command-failed-stops', 0, (s) => /fails outside the cases named below\s+stops the candidate \(`stopped: update failed — command failed`\)/.test(s)],
  // #4317 — step 0
  ['gh-only', 0, (s) => s.includes('When `command -v gh` exits non-zero, stop before step 1 offers anything')
    && s.includes('(`stopped: update failed — gh absent`) — the PR is never touched')
    && s.includes('`_shared/github-write-transport.md`\'s "Pull requests are not covered by this mapping"')],
  ['marker-kind', 0, (s) => s.includes('a `close-out-update` run comment (`_shared/pr-run-comments.md`\'s Comment kinds)')
    && s.includes('<!-- run-comment: close-out-update -->')],
  ['marker-before-landing', 0, (s) => s.includes('Write it pending before each call that lands an update — `gh pr update-branch` in step 2, the push in step 5 — never after.')],
  ['marker-read', 0, (s) => s.includes('its `status` `pending` is a pending marker')
    && s.includes('still routes to the resume, with that value `unknown`')],
  ['marker-read-unrecognised-stops', 0, (s) => s.includes('`unreadable` stops the candidate (`stopped: update failed — marker unreadable`), never none')],
  ['marker-cli', 0, (s) => ['read', 'write', 'resolve-pending'].every((verb) => s.includes(`bin/close-out-marker.js" ${verb} --comments-file "{comments-path}"`))
    && s.includes('never by hand')],
  ['marker-clear-only', 0, (s) => /only after `close-out\.md` step 5's `merged`, a decline at its step 4 gate,\s+or a landing call that landed nothing \(below\); every other stop leaves it pending/.test(s)],
  ['marker-failures-stop', 0, (s) => s.includes('(`stopped: update failed — marker unreadable`)')
    && s.includes('(`stopped: update failed — marker not written`), nothing pushed')
    && s.includes('never that procedure\'s issue fallback, since only the PR is ever read')],
  ['marker-failed-clear', 0, (s) => s.includes('A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.')],
  ['marker-accumulates', 0, (s) => s.includes('`write` given a payload whose marker is pending appends this update to it')],
  ['marker-write-trusted', 0, (s) => s.includes('After each pending write, run Find again: a written marker it does not return (the writing account is not a trusted author) counts as a failed write.')],
  ['marker-read-by-id', 0, (s) => s.includes('`read` prints its `id` (the comment to update in place)')],
  ['marker-nothing-landed', 0, (s) => /When a landing call fails,[\s\S]{0,120}re-read `gh pr view \{number\} --json headRefOid`[\s\S]{0,360}\(`cleared \(nothing landed\)`\); any other head on any read keeps it pending/.test(s)],
  ['marker-landing-rereads', 0, (s) => s.includes('a call GitHub accepted can still land after it errors, so re-read')
    && s.includes('up to 3 reads, a few seconds apart, each its own plain command:\nthe pre-update head on every read means nothing landed')],
  ['marker-failed-landing-restores', 0, (s) => s.includes('so restore the marker to the body `read --body-out` saved before this run\'s write')],
  ['marker-clear-noop', 0, (s) => s.includes('a no-op when Find returns none (a `{wt}` from before the marker existed)')],
  ['marker-read-every-candidate', 0, (s) => s.includes('except its **Update marker** section, which `close-out.md` step 2 reads for every candidate')],
  // #4331 fix wave — conflicted paths through a file, the prior body through --body-out
  ['marker-conflicted-files-file', 0, (s) => s.includes('write --comments-file "{comments-path}" --update-method "{merge | gh pr update-branch}" --conflicted-files-file "{paths-path}"')
    && s.includes('`--conflicted-files-file "{paths-path}"`: a file written with the Write tool, one path per line')
    && s.includes('never composed in the shell')],
  ['marker-body-out-before-write', 0, (s) => s.includes('read --comments-file "{comments-path}" --body-out "{prior-body-path}"')
    && s.includes('The Read that precedes each pending write passes `--body-out "{prior-body-path}"`')],
  ['marker-restore-verbatim', 0, (s) => s.includes('A restore posts that saved `{prior-body-path}` file as the comment body, unchanged and never recomposed')],
  ['marker-clear-saved-body', 0, (s) => s.includes('the found comment\'s body, which a `read --body-out` run just before the clear saved')],
  ['marker-unrepresentable-paths', 0, (s) => s.includes('A path holding a comma or leading or trailing whitespace, or named exactly `none` or `unknown`, cannot be recorded by name')
    && s.includes('pass `--conflicted-files unknown` for that update')],
  ['offer-options', 1, (s) => s.includes('`DIRTY`: options `"Update from {base} (Recommended)"` / `"Stop"`')
    && s.includes('`BEHIND`: options `"Update from {base} (Recommended)"` / `"Skip update"`')
    && s.includes('`DIRTY` then stops the candidate (`stopped: mergeStateStatus DIRTY — update declined`)')],
  ['offer-descriptions', 1, (s) => /Each option's `description` states its consequence in one clause[\s\S]{0,200}`"Skip update"` continuing to the merge question/.test(s)],
  ['offer-skipped-on-resume', 1, (s) => s.includes('Skipped on a resume (step 2) unless step 2 sends it here')],
  ['approval-warning', 1, (s) => /dismiss existing approvals[\s\S]{0,120}`armed`, not `merged`/.test(s)],
  ['decline-untouched', 1, (s) => s.includes('Declining touches nothing — the PR stays exactly as it was')],
  ['behind-continues', 1, (s) => s.includes('`BEHIND` was never a stop, so a declined update continues to `close-out.md` step 3')],
  ['resume-offer-no-skip', 1, (s) => s.includes('On a resume step 2 sends here, `BEHIND` offers the same two options as `DIRTY`, and its `"Stop"` stops the candidate (`stopped: mergeStateStatus BEHIND — update declined`)')],
  ['resume-decline-not-continue', 1, (s) => s.includes('On a resume that decline is the `"Stop"` above, never this continue.')],
  ['resume', 2, (s) => s.includes('is a prior run\'s update: add nothing yet, pin, then compare')
    && /`git -C \{wt\} merge-base --is-ancestor origin\/\{head\} HEAD` exits 0[^\n]*: resume at step 4/.test(s)],
  ['resume-fast-forward', 2, (s) => /`git -C \{wt\} merge-base --is-ancestor HEAD origin\/\{head\}` exits 0[^\n]*: `git -C \{wt\} checkout --detach origin\/\{head\}`, then step 4/.test(s)],
  ['resume-diverged', 2, (s) => s.includes('Neither (diverged): stop (`stopped: update failed — head moved`), keep `{wt}`, and tell the human to merge `origin/{head}` into it or remove it')],
  ['resume-conflicted-files', 2, (s) => /recover `\{conflicted-files\}`: `git -C \{wt\} log --merges -1 --format=%H origin\/\{head\}\.\.HEAD`[\s\S]{0,80}`git -C \{wt\} merge-tree --write-tree --name-only --no-messages \{merge\}\^1 \{merge\}\^2` lists its conflicted paths/.test(s)
    && s.includes('no merge commit is a `BEHIND` update: `none`')],
  ['resume-unfinished-merge', 2, (s) => s.includes('`git -C {wt} rev-parse --verify --quiet MERGE_HEAD` exits 0')
    && s.includes('`git -C {wt} status --porcelain --untracked-files=no` prints anything')
    && /is not resumable as it is: stop \(`stopped: update failed — conflict not resolved`\)/.test(s)],
  ['conflicted-unknown', 2, (s) => s.includes('any other exit — git older than 2.38, an unresolvable ref — `unknown`')],
  ['resume-expected-head', 2, (s) => /— the values line's current `headRefOid`\s+on a resume/.test(s)],
  ['head-pin', 2, (s) => s.includes('`git fetch origin {head}` and require `git rev-parse origin/{head}` to equal the expected head')
    && s.includes('a mismatch after that stops (`stopped: update failed — head moved`)')],
  ['detached', 2, (s) => s.includes('`git worktree add --detach {wt} origin/{head}`')],
  ['worktree-before-update', 2, (s) => before(s, '`git worktree add --detach {wt} origin/{head}` before anything touches the PR', '`gh pr update-branch {number}`')],
  ['reread-spaced', 2, (s) => s.includes('up to 3 reads, a few seconds apart, each its own plain command — for a sha that differs')],
  ['behind-post-update-checkout', 2, (s) => s.includes('pin again to that post-update sha, then `git -C {wt} checkout --detach origin/{head}`')],
  // #4317 — step 2
  ['fail-stops-git', 2, (s) => s.includes('A `git worktree add`, `checkout` or `fetch` in steps 2-3 that exits non-zero stops the candidate (`stopped: update failed — command failed`) before any later command of steps 2-6 runs (step 7\'s teardown still runs)')],
  ['resume-from-marker', 2, (s) => s.includes('No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4')],
  ['base-moved-again', 2, (s) => /goes to step 1's offer instead of step 4 when `close-out\.md` step 2's read is `DIRTY`, `mergeable: CONFLICTING` or `BEHIND`/.test(s)],
  ['base-moved-decline-stops', 2, (s) => s.includes('Declining stops the candidate on either status, as step 1 says — a resume offers no `"Skip update"`')],
  ['resume-values-marker', 2, (s) => s.includes('A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`')],
  ['resume-pending-resolution', 2, (s) => s.includes('is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub\'s update merge')],
  ['resume-no-marker-local', 2, (s) => s.includes('With no pending marker nothing was pushed, since the marker precedes every landing call, so recover')],
  ['marker-before-update-branch', 2, (s) => before(s, '`BEHIND` then writes the pending marker', '`gh pr update-branch {number}`')],
  ['marker-post-update-sha', 2, (s) => s.includes('Then rewrite the marker\'s `pending` `resolution-commit` entry to that sha with `resolve-pending`.')],
  ['pin-retry-after-exit0', 2, (s) => s.includes('after an exit-0 fetch, a ref missing or stale locally is fetched once more')],
  ['base-moved-no-wt', 2, (s) => s.includes('— the one just added for a pending marker included — goes to step 1\'s offer')],
  ['base-moved-fresh-carries', 2, (s) => s.includes('is still a resume for step 8, which hands off the marker as Fresh\'s write leaves it')],
  ['resume-pre-update-head-hex', 2, (s) => s.includes('a `preUpdateHead` of `unknown` (`read` accepts only a full 40-hex sha, since a comment body is never pasted into a command unchecked)')],
  ['resume-pre-update-head-field', 2, (s) => s.includes('`{pre-update-head}` being the Read\'s `preUpdateHead`')],
  ['resume-pending-unknown-no-stop', 2, (s) => s.includes('or a `rev-list` that exits non-zero: `unknown`, never a stop')],
  ['merge-base-in', 3, (s) => s.includes('`git -C {wt} fetch origin {base}`') && s.includes('Then `git -C {wt} merge --no-edit origin/{base}`')],
  ['merge-stage-no-path-list', 3, (s) => s.includes('Then `git -C {wt} add -u` (every conflicted path is tracked, and a path list would put attacker-nameable names into a shell argument)')
    && !s.includes('add {paths}')],
  ['nothing-new-stops', 3, (s) => /brings in nothing[\s\S]{0,200}stop-set status stops the candidate \(`stopped: mergeStateStatus \{status\} after update`\)/.test(s)],
  // #4317 — step 3
  ['base-fetch-checked', 3, (s) => /require `git -C \{wt\} rev-parse origin\/\{base\}` to equal the first field of `git -C \{wt\} ls-remote origin refs\/heads\/\{base\}`[\s\S]{0,260}\(`stopped: update failed — base not fetched`\), nothing merged/.test(s)
    && before(s, 'ls-remote origin refs/heads/{base}', 'Then `git -C {wt} merge --no-edit origin/{base}`')],
  ['base-fetch-retry', 3, (s) => s.includes('on a mismatch fetch and compare once more, and stop on one after that')],
  ['nothing-new-pending-verifies', 3, (s) => s.includes('or at step 4 when step 2 found a pending marker, since the head it marks is still unverified')],
  ['cd-into-wt', 4, (s) => s.includes('a standalone `cd {wt}` (never chained) comes first')],
  ['lockfile', 4, (s) => /lockfile[\s\S]{0,120}`_shared\/worktree-adopt-freshness\.md` step 4/.test(s)],
  ['cd-back', 4, (s) => s.includes('then a standalone `cd {main-checkout}` whatever the result')],
  ['stamp-full', 4, (s) => s.includes('`node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`')
    && s.includes('`verifiedHead` is true, `scope` is `full`, and the stamp\'s `sha` equals `git -C {wt} rev-parse HEAD`')],
  ['verify-stops', 4, (s) => s.includes('Otherwise stop (`stopped: update failed — verification`), push nothing')],
  ['failed-verify-keeps-wt', 4, (s) => /keep `\{wt\}`[\s\S]{0,120}`\/claude-tweaks:dispatch close-out #\{record\}`/.test(s)],
  ['plain-push', 5, (s) => s.includes('`git -C {wt} push origin HEAD:{head}` — plain')
    && [...s.matchAll(/force[- ]push/gi)].every((m) => s.slice(Math.max(0, m.index - 30), m.index).includes('never'))],
  // #4317 — step 5
  ['marker-conflicted-files-file-push', 5, (s) => s.includes('written to `--conflicted-files-file "{paths-path}"` with the Write tool, one per line; `none` or `unknown` through `--conflicted-files`')],
  ['marker-before-push', 5, (s) => before(s, 'First write the pending marker', '`git -C {wt} push origin HEAD:{head}`')],
  ['marker-resume-fix-keeps', 5, (s) => s.includes('a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update')],
  ['head-before-ci', 6, (s) => before(s, 'Confirm `gh pr view {number} --json headRefOid` equals `{verified-sha}`', '--watch`')],
  ['head-run-first', 6, (s) => s.includes('Step 2.5\'s head-run read') && before(s, '`gh run list --commit {verified-sha}`', '--watch`')],
  ['empty-runs-continue', 6, (s) => /up to 3 reads; still empty adds nothing \(Step 2\.5's empty-runs rule[^)]*\),\s+so continue to the watch and step 1's read/.test(s)],
  ['watch-timeout', 6, (s) => /`gh pr checks \{number\} --watch` as its own Bash call with an explicit long timeout[\s\S]{0,160}a timeout is `stopped: CI pending after update`/.test(s)],
  ['ci-step1', 6, (s) => s.includes('re-run `close-out.md` step 1\'s read: only `passing` continues')],
  ['head-after-ci', 6, (s) => before(s, '--watch`', 're-check `headRefOid` against `{verified-sha}`')],
  ['mergeability-reread', 6, (s) => s.includes('re-run step 2\'s mergeability read')],
  ['stop-set', 6, (s) => /post-update stop set is `DIRTY`, `mergeable: CONFLICTING`, `BEHIND`[^.]{0,60}, a string result, or `null`/.test(s)],
  ['unknown-bounded', 6, (s) => /`UNKNOWN`[\s\S]{0,120}up to 3 reads[\s\S]{0,120}stop only if still `UNKNOWN` \(`stopped: mergeStateStatus UNKNOWN after update`\)/.test(s)],
  ['teardown-on-stop', 7, (s) => /first on every stop after step 2, except a failed step 4 and a stop on a `\{wt\}` step 2 found mid-merge or holding tracked changes —\s+each keeps `\{wt\}`/.test(s)],
  // #4317 — step 7
  ['teardown-marker-not-wt', 7, (s) => s.includes('`{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down')],
  ['teardown-nothing-new-scoped', 7, (s) => s.includes('after step 3\'s brings-in-nothing read when step 2 found no pending marker')],
  ['teardown-next-run', 7, (s) => s.includes('the next run\'s step 2 resumes `{wt}`, or stops on it once the PR head has diverged')],
  ['teardown', 7, (s) => s.includes('`git worktree remove {wt}`')],
  ['handoff-sha', 8, (s) => s.includes('`{verified-sha}` itself')],
  ['handoff-resolution-merge', 8, (s) => s.includes('else short `{merge}` when step 2 found one, since a later fix commit is not the resolution')],
  ['handoff-resume-values', 8, (s) => s.includes('`merge` when step 2 found a `{merge}`, else `gh pr update-branch`')
    && s.includes('as step 2 recovered them') && !s.includes('unrecorded')],
  // #4317 — step 8
  ['handoff-marker-values', 8, (s) => s.includes('on a resume, the pending marker\'s, else')],
  ['handoff-conflicted-marker', 8, (s) => s.includes('on a resume, the pending marker\'s as last written, else')],
  ['handoff-every-entry', 8, (s) => s.includes('on a resume, every entry of the pending marker\'s, shortened')],
  ['handoff-pending-kept', 8, (s) => s.includes('The marker stays pending until `close-out.md` clears it after the merge or a decline.')],
];

function assertUpdateSteps(update) {
  for (const [id, n, check] of UPDATE_PINS) {
    assert.ok(check(stepSpan(update, n)), `close-out-update.md pin ${id} (step ${n})`);
  }
}

function assertUpdateRouting(step2, update, closeOut) {
  // AC1.1 — DIRTY/CONFLICTING and BEHIND route to the update offer, not only a stop
  const dirtySpan = routingSpan(step2, '`mergeStateStatus: DIRTY`', '`mergeStateStatus: BEHIND`');
  const behindSpan = routingSpan(step2, '`mergeStateStatus: BEHIND`', '`mergeStateStatus: BLOCKED`');
  assert.ok(dirtySpan.includes('close-out-update.md'), 'AC1.1: the DIRTY paragraph itself routes to close-out-update.md');
  assert.match(dirtySpan, /CONFLICTING/, 'AC1.1: mergeable CONFLICTING is treated like DIRTY');
  assert.ok(behindSpan.includes('close-out-update.md'), 'AC1.1: the BEHIND clause itself routes to close-out-update.md');
  assert.match(behindSpan, /declining continues/, 'AC1.2: a declined BEHIND update continues');
  assert.match(behindSpan, /except on a resume[\s\S]{0,200}declining stops, since that head is unverified/, '#4317: a declined BEHIND resume stops');
  assert.ok(!/rebase and re-verify/i.test(step2), 'AC1.1: the old rebase recommendation is gone from step 2');
  // An existing update worktree resumes, whatever the forge now says (a BEHIND update is already on GitHub)
  const wtSpan = routingSpan(step2, 'An existing `.worktrees/close-out-{number}`', '`mergeStateStatus: DIRTY`');
  assert.match(wtSpan, /routes to `close-out-update\.md`'s resume[\s\S]{0,40}regardless of `mergeStateStatus`/, 'an existing update worktree routes to the resume');
  assert.match(wtSpan, /or a pending update marker \(`close-out-update\.md`'s \*\*Update marker\*\*/, '#4317 AC1.1: a pending update marker routes to the resume too');
  assert.match(wtSpan, /from whichever checkout this run is in/, '#4317 AC1.1: the marker routes a run from any checkout');
  assert.match(wtSpan, /read that section and run its \*\*Read\*\* here for every candidate/, '#4317 AC1.1: the marker is read for every candidate');
  // AC1.2, AC2.1 — anchored per step of the update procedure
  assertUpdateSteps(update);
  // AC4.1 — no path rebases or force-pushes
  assert.match(update, /never a rebase/i, 'AC4.1: states never a rebase');
  assert.match(update, /force[- ]push/i, 'AC4.1: states never a force push');
  assert.ok(update.includes('gh pr update-branch'), 'AC4.1: BEHIND uses gh pr update-branch');
  const spans = [...update.matchAll(/`([^`\n]+)`/g), ...closeOut.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  for (const s of spans) {
    assert.ok(!/^git\b.*\brebase\b/.test(s), `AC4.1: no git rebase command: ${s}`);
    assert.ok(!/^git\b.*\bpush\b.*(--force|\s-f\b)/.test(s), `AC4.1: no force push command: ${s}`);
    assert.ok(!/^gh pr update-branch\b.*--rebase/.test(s), `AC4.1: no update-branch --rebase: ${s}`);
    assert.ok(!/^git\b.*\bpush\b.*\s\+\S/.test(s), `AC4.1: no +refspec force push: ${s}`);
  }
  // AC5.1 (close-out half) — the Anti-Patterns ban is rescoped to the headless sweep
  assert.ok(!closeOut.includes('Rebasing a `DIRTY` candidate to clear it automatically'), 'AC5.1: old anti-pattern row removed');
  assert.match(closeOut, /\| Rebasing or force-pushing[^\n]*item 11[^\n]*\|/, 'AC5.1: rescoped anti-pattern row names item 11');
  assert.match(closeOut, /\| Rebasing or force-pushing[^\n]*without a passing full suite[^\n]*without a passing full-suite `verify\.js` stamp[^\n]*\|/, 'AC5.1: the row also bans an update without a passing full suite');
}

test('AC1.1/AC1.2/AC2.1/AC4.1/AC5.1: step 2 routes conflicting and behind PRs to the re-verified update path', () => {
  assertUpdateRouting(STEP_2, UPDATE, CLOSE_OUT);
});

test('go-red control: dropping the DIRTY routing from step 2 fails the same assertions', () => {
  const mutated = STEP_2.replace(/close-out-update\.md/g, 'REMOVED');
  assert.throws(() => assertUpdateRouting(mutated, UPDATE, CLOSE_OUT));
});

test('go-red control: dropping only the DIRTY reference fails the routing assertions', () => {
  const mutated = dropRefIn(STEP_2, '`mergeStateStatus: DIRTY`', '`mergeStateStatus: BEHIND`');
  assert.notEqual(mutated, STEP_2, 'the mutation must change step 2');
  assert.throws(() => assertUpdateRouting(mutated, UPDATE, CLOSE_OUT));
});

test('go-red control: dropping only the BEHIND reference fails the routing assertions', () => {
  const mutated = dropRefIn(STEP_2, '`mergeStateStatus: BEHIND`', '`mergeStateStatus: BLOCKED`');
  assert.notEqual(mutated, STEP_2, 'the mutation must change step 2');
  assert.throws(() => assertUpdateRouting(mutated, UPDATE, CLOSE_OUT));
});

test('Review Focus: isolated detached worktree, dependency install, declines', () => {
  // Each check reads its own step's span; the go-red table below covers every pin.
  for (const id of ['wt-absolute', 'detached', 'teardown', 'lockfile', 'behind-continues']) {
    const [, n, check] = UPDATE_PINS.find(([pin]) => pin === id);
    assert.ok(check(stepSpan(UPDATE, n)), `pin ${id} (step ${n})`);
  }
});

const PINS_4317 = {
  'AC1.1': ['marker-cli', 'marker-kind', 'marker-before-landing', 'marker-read', 'marker-clear-only', 'marker-failures-stop', 'marker-failed-clear', 'marker-nothing-landed', 'resume-from-marker', 'base-moved-again', 'base-moved-decline-stops', 'nothing-new-pending-verifies', 'teardown-on-stop', 'teardown-marker-not-wt', 'handoff-pending-kept', 'base-moved-no-wt', 'base-moved-fresh-carries', 'teardown-nothing-new-scoped', 'marker-write-trusted', 'marker-read-by-id', 'resume-offer-no-skip', 'resume-decline-not-continue', 'marker-read-every-candidate', 'marker-clear-noop', 'marker-failed-landing-restores', 'marker-read-unrecognised-stops', 'marker-landing-rereads'],
  'AC2.1': ['resume-values-marker', 'resume-pending-resolution', 'resume-no-marker-local', 'marker-before-update-branch', 'marker-post-update-sha', 'marker-before-push', 'marker-resume-fix-keeps', 'handoff-marker-values', 'handoff-resolution-merge', 'handoff-resume-values', 'marker-accumulates', 'resume-pre-update-head-field', 'handoff-conflicted-marker', 'handoff-every-entry', 'resume-pending-unknown-no-stop', 'resume-pre-update-head-hex', 'marker-conflicted-files-file', 'marker-conflicted-files-file-push', 'marker-body-out-before-write', 'marker-restore-verbatim', 'marker-clear-saved-body'],
  'AC3.1': ['fail-stops-git', 'base-fetch-checked', 'pin-retry-after-exit0', 'base-fetch-retry'],
  'AC4.1': ['gh-only'],
};

for (const [ac, ids] of Object.entries(PINS_4317)) {
  test(`#4317 ${ac}: close-out-update.md carries its pinned clauses`, () => {
    for (const id of ids) {
      const entry = UPDATE_PINS.find(([pin]) => pin === id);
      assert.ok(entry, `pin ${id} exists`);
      const [, n, check] = entry;
      assert.ok(check(stepSpan(UPDATE, n)), `pin ${id} (step ${n})`);
    }
  });
}

test('#4317 AC5.1: every #4317 pin has its own go-red mutation', () => {
  const mutated = new Set(UPDATE_MUTATIONS.map(([id]) => id));
  for (const id of Object.values(PINS_4317).flat()) assert.ok(mutated.has(id), `pin ${id} has a mutation`);
});

// One mutation per pin, each removing or rewriting only that pin's clause in memory.
// [pin id, exact text in close-out-update.md, replacement]
const UPDATE_MUTATIONS = [
  ['wt-absolute', 'is the absolute `{main-checkout}/.worktrees/close-out-{number}`', 'is `.worktrees/close-out-{number}`'],
  ['paste-quoted', ', and double-quote every pasted path and ref (`{wt}`, `{main-checkout}`, `{head}`, `{base}`) in the commands below —\na checkout path may contain a space and a branch name may contain shell metacharacters.', '.'],
  ['command-failed-stops', ' A command that fails outside the cases named below\nstops the candidate (`stopped: update failed — command failed`) the same way.', ''],
  ['offer-options', '`DIRTY`: options `"Update from {base} (Recommended)"` / `"Stop"`', '`DIRTY`: no question; the candidate stops'],
  ['offer-descriptions', 'Each option\'s `description` states its consequence in one clause: the update option merges the base into the PR branch, re-verifies, and pushes;\n   `"Stop"` and `"Skip update"` leave the PR untouched, `"Stop"` ending this candidate and `"Skip update"` continuing to the merge question.\n   ', ''],
  ['offer-skipped-on-resume', 'Skipped on a resume (step 2) unless step 2 sends it here. ', ''],
  ['approval-warning', ' —\n   and that the new head may dismiss existing approvals on a repo that dismisses stale reviews, so the merge may end `armed`, not `merged`.', '.'],
  ['decline-untouched', 'Declining touches nothing — the PR stays exactly as it was.\n', ''],
  ['behind-continues', '`BEHIND` was never a stop, so a declined update continues to `close-out.md` step 3 unchanged.', '`BEHIND` stops too.'],
  ['resume', 'exits 0 (the PR head plus any unpushed resolution or fix): resume at step 4.', 'exits 0: add a fresh worktree.'],
  ['resume-fast-forward', ': `git -C {wt} checkout --detach origin/{head}`, then step 4.', ': resume at step 4 as it is.'],
  ['resume-diverged', 'Neither (diverged): stop (`stopped: update failed — head moved`), keep `{wt}`, and tell the human to merge `origin/{head}` into it or remove it.', 'Neither (diverged): resume at step 4.'],
  ['resume-conflicted-files', '`git -C {wt} merge-tree --write-tree --name-only --no-messages {merge}^1 {merge}^2` lists its conflicted paths', 'they are `unrecorded`'],
  ['resume-unfinished-merge', 'is not resumable as it is: stop (`stopped: update failed — conflict not resolved`),', 'resumes at step 4,'],
  ['conflicted-unknown', '; any other exit — git older than 2.38, an unresolvable ref — `unknown`', ''],
  ['resume-expected-head', 'the values line\'s current `headRefOid`\n   on a resume and before any update', 'the values line\'s `headRefOid`'],
  ['head-pin', ' and require `git rev-parse origin/{head}` to equal the expected head', ''],
  ['detached', '`git worktree add --detach {wt} origin/{head}`', '`git worktree add {wt} {head}`'],
  ['worktree-before-update', ' before anything touches the PR', ' after the update'],
  ['reread-spaced', ', a few seconds apart, each its own plain command — for a sha', ' — for a sha'],
  ['behind-post-update-checkout', '; pin again to that post-update sha, then `git -C {wt} checkout --detach origin/{head}`.', '.'],
  ['merge-base-in', 'Then `git -C {wt} merge --no-edit origin/{base}`.', 'Then merge.'],
  ['merge-stage-no-path-list', 'Then `git -C {wt} add -u` (every conflicted path is tracked, and a path list would put attacker-nameable names into a shell argument)', 'Then `git -C {wt} add {paths}`'],
  ['nothing-new-stops', 'a stop-set status stops the candidate (`stopped: mergeStateStatus {status} after update`); otherwise hand', 'then hand'],
  ['cd-into-wt', 'so a standalone `cd {wt}` (never chained) comes first.', 'so run it there.'],
  ['lockfile', 'When the project has a lockfile, run its install command there (the mapping is `_shared/worktree-adopt-freshness.md` step 4) — after the merge, which may change it.\n', ''],
  ['cd-back', ',\n   then a standalone `cd {main-checkout}` whatever the result, before any later step.', '.'],
  ['stamp-full', '`scope` is `full`, ', ''],
  ['verify-stops', 'Otherwise stop (`stopped: update failed — verification`), push nothing,', 'Otherwise continue and push,'],
  ['failed-verify-keeps-wt', 'keep `{wt}`, and report it', 'and report `{wt}`'],
  ['plain-push', '`git -C {wt} push origin HEAD:{head}` — plain.', 'then force-push the branch.'],
  ['head-before-ci', 'Confirm `gh pr view {number} --json headRefOid` equals `{verified-sha}` — one re-read if it lags; a sha that still differs stops the candidate\n   (`stopped: update failed — head moved`), since one sha is never verified and another merged.\n   ', ''],
  ['head-run-first', 'so first repeat `_shared/pr-first-merge.md` Step 2.5\'s head-run read\n   (`gh run list --commit {verified-sha}`) until it lists a run — ', 'so wait — '],
  ['empty-runs-continue', '; still empty adds nothing (Step 2.5\'s empty-runs rule, e.g. no or path-filtered workflows),\n   so continue to the watch and step 1\'s read, which decide.', ', else `stopped: CI pending after update`.'],
  ['watch-timeout', ' as its own Bash call with an explicit long timeout (the tool\'s maximum)', ''],
  ['ci-step1', 're-run `close-out.md` step 1\'s read: only `passing` continues', 're-read CI'],
  ['head-after-ci', ',\n   and re-check `headRefOid` against `{verified-sha}` as above, since a push may have landed during the wait.', '.'],
  ['mergeability-reread', '   Last, re-run step 2\'s mergeability read. ', '   '],
  ['stop-set', 'The post-update stop set is `DIRTY`, `mergeable: CONFLICTING`, `BEHIND` (the base moved during the wait), a string result, or `null` —\n   each stops', 'A conflict stops'],
  ['unknown-bounded', 're-read it — up to 3 reads, a few seconds apart, each its own plain command — and stop only if still `UNKNOWN`', 'stop on it'],
  ['teardown-on-stop', ' and a stop on a `{wt}` step 2 found mid-merge or holding tracked changes —\n   each keeps', ', which keeps'],
  ['teardown-next-run', 'the next run\'s step 2 resumes `{wt}`, or stops on it once the PR head has diverged', 'the next run resumes `{wt}`'],
  ['teardown', 'on exit 0, `git worktree remove {wt}`', 'on exit 0, leave it'],
  ['handoff-sha', '`{verified-sha}` itself (`close-out.md` step 5 merges only that head),\n   ', ''],
  ['handoff-resolution-merge', ', else short `{merge}` when step 2 found one, since a later fix commit is not the resolution', ''],
  ['handoff-resume-values', 'as step 2 recovered them', '`unrecorded` on a resume'],
  ['handoff-conflicted-marker', 'the pending marker\'s as last written, else ', ''],
  ['handoff-every-entry', 'every entry of the pending marker\'s, shortened', 'the short pending marker\'s'],
  ['resume-offer-no-skip', 'On a resume step 2 sends here, `BEHIND` offers the same two options as `DIRTY`', 'On a resume step 2 sends here, `BEHIND` offers `"Skip update"` too'],
  ['resume-decline-not-continue', '\n   On a resume that decline is the `"Stop"` above, never this continue.', ''],
  ['marker-read-every-candidate', ', except its **Update marker** section, which `close-out.md` step 2 reads for every candidate', ''],
  ['marker-clear-noop', ' a no-op when Find returns none (a `{wt}` from before the marker existed); else', ''],
  ['marker-failed-landing-restores', 'so restore the marker to the body `read --body-out` saved before this run\'s write — or, when step 2 found no pending marker, clear it', 'so clear it'],
  ['marker-conflicted-files-file', ' — never composed in the shell, since a path is attacker-nameable and `posts.$slug.tsx` expands inside a double-quoted argument', ''],
  ['marker-body-out-before-write', '\nThe Read that precedes each pending write passes `--body-out "{prior-body-path}"`, saving the body that write replaces; a Clear\'s Read passes it too.', ''],
  ['marker-restore-verbatim', '\nA restore posts that saved `{prior-body-path}` file as the comment body, unchanged and never recomposed (the re-Find overwrites `{comments-path}`, so the saved file is the only copy).', ''],
  ['marker-clear-saved-body', 'the found comment\'s body, which a `read --body-out` run just before the clear saved (an earlier Read\'s file predates any pending write since), with its second line', 'the second line'],
  ['marker-unrepresentable-paths', '\nA path holding a comma or leading or trailing whitespace, or named exactly `none` or `unknown`, cannot be recorded by name: `write` exits 1 on the paths file, so pass `--conflicted-files unknown` for that update.', ''],
  ['marker-conflicted-files-file-push', ' (the paths recorded at step 3 or recovered at step 2, written to `--conflicted-files-file "{paths-path}"` with the Write tool, one per line; `none` or `unknown` through `--conflicted-files`)', ''],
  ['resume-pending-unknown-no-stop', ', or a `rev-list` that exits non-zero: `unknown`, never a stop.', ': `unknown`.'],
  ['resume-pre-update-head-hex', ' (`read` accepts only a full 40-hex sha, since a comment body is never pasted into a command unchecked)', ''],
  ['gh-only', '(`stopped: update failed — gh absent`) — the PR is never touched', '(`stopped: update failed — gh absent`) after the update'],
  ['marker-kind', 'a `close-out-update` run comment (`_shared/pr-run-comments.md`\'s Comment kinds)', 'a local note'],
  ['marker-before-landing', 'Write it pending before each call that lands an update', 'Write it pending after each call that lands an update'],
  ['marker-read', 'its `status` `pending` is a pending marker', 'its `status` is ignored'],
  ['marker-cli', ', never by hand', ''],
  ['marker-clear-only', '; every other stop leaves it pending', ', or on any stop'],
  ['marker-failures-stop', ' — never that procedure\'s issue fallback, since only the PR is ever read', ', or post it to the issue instead'],
  ['marker-failed-clear', 'A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.', 'A failed clear stops the candidate.'],
  ['marker-nothing-landed', '; any other head on any read keeps it pending', ''],
  ['marker-landing-rereads', 'a call GitHub accepted can still land after it errors, so re-read `gh pr view {number} --json headRefOid` — up to 3 reads, a few seconds apart, each its own plain command:\nthe pre-update head on every read means', 're-read `gh pr view {number} --json headRefOid`: the pre-update head still there means'],
  ['marker-read-unrecognised-stops', '`unreadable` stops the candidate (`stopped: update failed — marker unreadable`), never none.', '`unreadable` is none.'],
  ['fail-stops-git', 'before any later command of steps 2-6 runs', 'unless the next step can continue'],
  ['resume-from-marker', 'No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4', 'No `{wt}`: continue at step 3'],
  ['base-moved-again', 'goes to step 1\'s offer instead of step 4', 'goes to step 4'],
  ['base-moved-decline-stops', 'Declining stops the candidate on either status', 'Declining `BEHIND` continues to step 4'],
  ['resume-values-marker', 'A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`', '`{wt}` supplies the values'],
  ['resume-pending-resolution', 'is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub\'s update merge', 'stays `pending`'],
  ['resume-no-marker-local', 'With no pending marker nothing was pushed, since the marker precedes every landing call, so recover', 'Otherwise recover'],
  ['marker-before-update-branch', '`BEHIND` then writes the pending marker (`write` with `--update-method "gh pr update-branch" --conflicted-files none --resolution-commit pending`, and `--pre-update-head` set to the values line\'s `headRefOid`)\n   and runs `gh pr update-branch {number}`', '`BEHIND` then runs `gh pr update-branch {number}`'],
  ['marker-post-update-sha', '\n   Then rewrite the marker\'s `pending` `resolution-commit` entry to that sha with `resolve-pending`.', ''],
  ['pin-retry-after-exit0', 'after an exit-0 fetch, a ref missing', 'a ref missing'],
  ['base-moved-no-wt', ' — the one just added for a pending marker included —', ''],
  ['base-moved-fresh-carries', ' and is still a resume for step 8, which hands off the marker as Fresh\'s write leaves it.', ', with Fresh\'s own values.'],
  ['resume-pre-update-head-field', ', `{pre-update-head}` being the Read\'s `preUpdateHead`', ''],
  ['marker-accumulates', 'appends this update to it', 'overwrites it'],
  ['marker-write-trusted', '\nAfter each pending write, run Find again: a written marker it does not return (the writing account is not a trusted author) counts as a failed write.', ''],
  ['marker-read-by-id', '`read` prints its `id` (the comment to update in place)', '`read` prints its body'],
  ['teardown-nothing-new-scoped', ' read when step 2 found no pending marker', ' read'],
  ['base-fetch-retry', 'on a mismatch fetch and compare once more, and stop on one after that', 'on a mismatch stop'],
  ['base-fetch-checked', 'then require `git -C {wt} rev-parse origin/{base}` to equal the first field of `git -C {wt} ls-remote origin refs/heads/{base}`', 'then trust it'],
  ['nothing-new-pending-verifies', ' —\n   or at step 4 when step 2 found a pending marker, since the head it marks is still unverified', ''],
  ['marker-before-push', 'First write the pending marker', 'After the push, write the pending marker'],
  ['marker-resume-fix-keeps', 'a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update', 'a resume rewrites it'],
  ['teardown-marker-not-wt', '`{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down', '`{wt}` is the resume marker, so a stop after an update keeps it'],
  ['handoff-marker-values', 'on a resume, the pending marker\'s, else `merge`', 'on a resume, `merge`'],
  ['handoff-pending-kept', ' The marker stays pending until `close-out.md` clears it after the merge or a decline.', ''],
];

test('every close-out-update.md pin has exactly one go-red mutation', () => {
  assert.deepEqual(UPDATE_MUTATIONS.map(([id]) => id).sort(), UPDATE_PINS.map(([id]) => id).sort());
});

for (const [id, from, to] of UPDATE_MUTATIONS) {
  test(`go-red control: mutating only the ${id} clause fails the update-path assertions`, () => {
    assertOccursOnce(UPDATE, from, `the ${id} clause occurs exactly once`);
    const mutated = UPDATE.replace(from, to);
    assert.notEqual(mutated, UPDATE, 'the mutation must change the text');
    assert.throws(() => assertUpdateSteps(mutated), new RegExp(`pin ${id} `));
    assert.throws(() => assertUpdateRouting(STEP_2, mutated, CLOSE_OUT), new RegExp(`pin ${id} `));
  });
}

// Prose-code twin (#4331): the marker template's explanatory paragraph is composed by the module's
// serializeMarker and restated in the doc's ```text template, so the two must stay byte-equal.
const TWIN_SAMPLE = { updateMethod: ['merge'], conflictedFiles: [], preUpdateHead: 'a'.repeat(40), resolutionCommits: ['pending'] };

function paragraphLine(text, where) {
  const lines = text.split('\n').filter((l) => l.startsWith('While this reads'));
  assert.equal(lines.length, 1, `${where} has exactly one "While this reads" paragraph line`);
  return lines[0];
}

// The field-key prefixes of a marker body in order: the lines after the status line, up to the first blank line.
function fieldKeys(body, where) {
  const lines = body.split('\n').slice(2);
  const keys = lines.slice(0, lines.indexOf('')).map((l) => (l.match(/^[a-z-]+:/) || [l])[0]);
  assert.equal(keys.length, 4, `${where} has four field lines before its blank line`);
  return keys;
}

function assertExplanationTwin(update) {
  const templates = [...update.matchAll(/```text\n([\s\S]*?)```/g)].filter((m) => m[1].startsWith('<!-- run-comment: close-out-update -->'));
  assert.equal(templates.length, 1, 'close-out-update.md has exactly one marker template fence');
  assert.equal(paragraphLine(templates[0][1], 'the marker template'), paragraphLine(serializeMarker(TWIN_SAMPLE), 'serializeMarker\'s body'),
    'the template\'s explanatory paragraph equals serializeMarker\'s');
  assert.deepEqual(fieldKeys(templates[0][1], 'the marker template'), fieldKeys(serializeMarker(TWIN_SAMPLE), 'serializeMarker\'s body'),
    'the template\'s field-key prefixes equal serializeMarker\'s, in order');
}

test('#4331 prose-code twin: the marker template\'s paragraph equals serializeMarker\'s', () => {
  assertExplanationTwin(UPDATE);
});

test('#4331 prose-code twin go-red control: one reworded word in the template paragraph fails', () => {
  const from = 're-verifies the head before the merge question';
  assertOccursOnce(UPDATE, from, 'the paragraph clause occurs exactly once');
  assert.throws(() => assertExplanationTwin(UPDATE.replace(from, 're-checks the head before the merge question')), /explanatory paragraph equals serializeMarker/);
});

test('#4331 prose-code twin: the template\'s field keys are update-method, conflicted-files, pre-update-head, resolution-commit', () => {
  const template = UPDATE.match(/```text\n(<!-- run-comment: close-out-update -->[\s\S]*?)```/)[1];
  assert.deepEqual(fieldKeys(template, 'the marker template'), ['update-method:', 'conflicted-files:', 'pre-update-head:', 'resolution-commit:']);
});

test('#4331 prose-code twin go-red control: a renamed or reordered field key in the template fails', () => {
  const rename = ['pre-update-head: {the values line\'s headRefOid}', 'pre-update-sha: {the values line\'s headRefOid}'];
  const reorder = ['conflicted-files: {comma-joined paths | none | unknown}\npre-update-head: {the values line\'s headRefOid}', 'pre-update-head: {the values line\'s headRefOid}\nconflicted-files: {comma-joined paths | none | unknown}'];
  for (const [from, to] of [rename, reorder]) {
    assertOccursOnce(UPDATE, from, 'the field line clause occurs exactly once');
    assert.throws(() => assertExplanationTwin(UPDATE.replace(from, to)), /field-key prefixes equal serializeMarker/);
  }
});

// Every flag a close-out-marker.js command line in the doc passes is one the CLI accepts for that verb
// (#4331): the pins above hold the prose's clauses, not that the flags it shows exist.
function markerCliFlags(update) {
  const found = [];
  for (const m of update.matchAll(/bin\/close-out-marker\.js" (read|write|resolve-pending)([^\n]*)/g)) {
    for (const f of m[2].matchAll(/(?:^| )(--[a-z][a-z-]*)/g)) found.push([m[1], f[1]]);
  }
  return found;
}

function assertMarkerCliFlags(update) {
  const flags = markerCliFlags(update);
  assert.ok(flags.length >= 11, `the doc passes at least 11 marker CLI flags (found ${flags.length})`);
  assert.deepEqual([...new Set(flags.map(([verb]) => verb))].sort(), ['read', 'resolve-pending', 'write']);
  for (const [verb, flag] of flags) {
    const parsed = parseMarkerArgs([verb, flag, 'v']);
    assert.ok(!(parsed.error && /unknown argument/.test(parsed.error)), `close-out-marker.js ${verb} accepts ${flag}`);
  }
}

test('#4331 every flag close-out-update.md passes to close-out-marker.js is one the CLI accepts for that verb', () => {
  assertMarkerCliFlags(UPDATE);
});

test('#4331 flag-scan go-red control: a misspelled flag in a marker command line fails', () => {
  const from = 'read --comments-file "{comments-path}" --body-out "{prior-body-path}"';
  assertOccursOnce(UPDATE, from, 'the read command line occurs exactly once');
  assert.throws(() => assertMarkerCliFlags(UPDATE.replace(from, from.replace('--body-out', '--body-outt'))), /accepts --body-outt/);
});

// close-out.md step 2 clauses: [label, exact text, replacement, expected message]
const STEP_2_MUTATIONS = [
  ['declining continues (M6)', 'declining continues, since\n   BEHIND was never a stop', 'BEHIND is now a stop', /declined BEHIND update continues/],
  ['BEHIND resume declining stops', ' — except on a resume (the existing `.worktrees/close-out-{number}` or pending marker above), where `close-out-update.md` step 1 offers no skip: declining stops, since that head is unverified', '', /declined BEHIND resume stops/],
  ['existing update worktree resumes', 'routes to `close-out-update.md`\'s resume (its step 2) regardless of `mergeStateStatus`', 'is ignored', /routes to the resume/],
  ['pending marker resumes', ' or a pending update marker (`close-out-update.md`\'s **Update marker**: read that section and run its **Read** here for every candidate, whatever its `mergeStateStatus` — a failed read stops this candidate, `stopped: update failed — marker unreadable`)', '', /pending update marker routes/],
  ['every candidate reads the marker', ' read that section and run its **Read** here for every candidate, whatever its `mergeStateStatus` —', ' read here —', /read for every candidate/],
  ['any checkout', ', from whichever checkout this run is in', '', /routes a run from any checkout/],
  ['rebase recommendation, any case', 'read `close-out-update.md` in this skill\'s directory', 'Rebase and re-verify first, or read `close-out-update.md` in this skill\'s directory', /rebase recommendation is gone/],
];

for (const [label, from, to, message] of STEP_2_MUTATIONS) {
  test(`go-red control: close-out step 2 without "${label}" fails the routing assertions`, () => {
    assertOccursOnce(STEP_2, from, `the ${label} clause occurs exactly once in step 2`);
    const mutated = STEP_2.replace(from, to);
    assert.notEqual(mutated, STEP_2, 'the mutation must change step 2');
    assert.throws(() => assertUpdateRouting(mutated, UPDATE, CLOSE_OUT), message);
  });
}

// AC2.1 at the merge itself: close-out step 5 re-reads the head and merges only the verified sha.
function assertMergeHeadCheck(closeOut) {
  const start = closeOut.indexOf('5. **On confirmation — merge.**');
  assert.ok(start >= 0, 'close-out step 5 found');
  const step5 = closeOut.slice(start, closeOut.indexOf('\n6. ', start));
  // Keyed on a handed-off sha, not on the update having run: a merge that brought in nothing hands off none.
  assert.match(step5, /When `close-out-update\.md` handed off a `\{verified-sha\}`, first re-read\s+`gh pr view \{number\} --json headRefOid` immediately before Step 3/, 'step 5 re-reads the head before Step 3');
  assert.match(step5, /any sha other than\s+that `\{verified-sha\}` \(`stopped: update failed — head moved`\)/, 'step 5 stops on a moved head');
  assert.match(step5, /pass `\{verified-sha\}`\s+as Step 3's expected head/, 'step 5 passes the verified sha as the expected head');
}

const MERGE = readSkillFile('_shared', 'pr-first-merge.md');

// pr-first-merge.md Step 3: the expected-head sentence sits after the `--squash` sentence, before the
// fence-execution rule — kept out of the opening window #2015's pin reads.
function assertExpectedHeadSentence(merge) {
  const start = merge.indexOf('## Step 3: Attempt auto-merge');
  const squash = merge.indexOf('`--squash` keeps one conventional commit per PR.', start);
  const fences = merge.indexOf('Run each fence as its own Bash call', squash);
  assert.ok(start >= 0 && squash > start && fences > squash, 'Step 3, its squash sentence and its fence rule found');
  const head = merge.slice(squash, fences);
  assert.match(head, /expected head sha[^\n]*append `--match-head-commit \{expected-head\}` to every `gh pr merge` command in this step[^\n]*callers that supply none are unchanged/,
    'Step 3 appends --match-head-commit for a caller-supplied expected head');
}

test('AC2.1: close-out step 5 merges only the verified head, via Step 3\'s --match-head-commit', () => {
  assertMergeHeadCheck(CLOSE_OUT);
  assertExpectedHeadSentence(MERGE);
});

test('go-red control: close-out step 5 without the head re-check fails', () => {
  const from = 'When `close-out-update.md` handed off a `{verified-sha}`, first re-read\n   `gh pr view {number} --json headRefOid` immediately before Step 3 and stop on any sha other than\n   that `{verified-sha}` (`stopped: update failed — head moved`); then pass `{verified-sha}`\n   as Step 3\'s expected head, so its `--match-head-commit` accepts only that head.\n   ';
  assertOccursOnce(CLOSE_OUT, from, 'the head re-check occurs exactly once');
  assert.throws(() => assertMergeHeadCheck(CLOSE_OUT.replace(from, '')), /re-reads the head/);
});

test('go-red control: close-out step 5 keyed on the update having run, not on a handed-off sha, fails', () => {
  const from = 'When `close-out-update.md` handed off a `{verified-sha}`, first';
  assertOccursOnce(CLOSE_OUT, from, 'the trigger clause occurs exactly once');
  assert.throws(() => assertMergeHeadCheck(CLOSE_OUT.replace(from, 'When `close-out-update.md` ran, first')), /re-reads the head/);
});

test('go-red control: pr-first-merge Step 3 without the expected-head sentence fails', () => {
  const from = 'append `--match-head-commit {expected-head}` to every `gh pr merge` command in this step';
  assertOccursOnce(MERGE, from, 'the sentence occurs exactly once');
  assert.throws(() => assertExpectedHeadSentence(MERGE.replace(from, 'merge as usual')), /--match-head-commit/);
});

// close-out.md's Reporting list names every `update failed` reason close-out-update.md can stop with.
function assertUpdateFailedReasonsReported(update, closeOut) {
  const reasons = [...update.matchAll(/`stopped: update failed — ([^`)]+)`/g)].map((m) => m[1]);
  assert.ok(reasons.length >= 5, 'close-out-update.md names its update-failed stop reasons');
  const reporting = closeOut.slice(closeOut.indexOf('## Reporting'));
  const listed = reporting.match(/`stopped: update failed — \{([^}]+)\}`/);
  assert.ok(listed, 'close-out.md Reporting lists the update-failed reasons');
  const names = listed[1].split('|').map((n) => n.trim());
  for (const r of new Set(reasons)) {
    assert.ok(names.includes(r), `close-out.md Reporting lists the update-failed reason "${r}"`);
  }
}

test('close-out.md Reporting lists every update-failed stop reason close-out-update.md names', () => {
  assertUpdateFailedReasonsReported(UPDATE, CLOSE_OUT);
});

test('go-red control: a close-out-update.md stop reason missing from close-out.md Reporting fails', () => {
  const from = ' | command failed}`';
  assertOccursOnce(CLOSE_OUT, from, 'the last reporting reason occurs exactly once');
  assert.throws(() => assertUpdateFailedReasonsReported(UPDATE, CLOSE_OUT.replace(from, '}`')), /lists the update-failed reason "command failed"/);
});

// close-out.md's Reporting list names the declined-update outcome for both DIRTY and BEHIND.
function assertDeclinedOutcomeReported(closeOut) {
  const reporting = closeOut.slice(closeOut.indexOf('## Reporting'));
  assert.match(reporting, /`stopped: mergeStateStatus \{DIRTY \| BEHIND\} — update declined`/, 'close-out.md Reporting lists the declined-update outcome for DIRTY and BEHIND');
}

test('close-out.md Reporting lists the declined-update outcome for DIRTY and BEHIND', () => {
  assertDeclinedOutcomeReported(CLOSE_OUT);
});

test('go-red control: a Reporting list naming only DIRTY for a declined update fails', () => {
  const from = '`stopped: mergeStateStatus {DIRTY | BEHIND} — update declined`';
  assertOccursOnce(CLOSE_OUT, from, 'the declined-update outcome occurs exactly once');
  assert.throws(() => assertDeclinedOutcomeReported(CLOSE_OUT.replace(from, '`stopped: mergeStateStatus DIRTY — update declined`')), /declined-update outcome/);
});

const CONFIRM = readSkillFile('dispatch', 'close-out-confirmation.md');

const CLAUSE_VALUES = ['{update-method}', '{conflicted-files}', '{resolution-commit}'];

// Asserts against the {update-clause} definition paragraph ALONE (to the next blank line):
// the "Source values live" paragraph below it names the same variables and must not satisfy these.
function assertUpdateClause(text) {
  const question = text.split('\n').find((l) => l.includes('`question`:'));
  assert.ok(question, 'question line found');
  assert.ok(question.includes('{update-clause}'), 'question carries {update-clause}');
  const from = text.indexOf('{update-clause}', text.indexOf(question) + question.length);
  assert.ok(from >= 0, '{update-clause} definition found after the question');
  const end = text.indexOf('\n\n', from);
  const def = text.slice(from, end < 0 ? undefined : end);
  for (const v of CLAUSE_VALUES) {
    assert.ok(def.includes(v), `{update-clause} definition names ${v}`);
  }
  assert.match(def, /close-out-update\.md/, 'values come from close-out-update.md, never re-derived');
  assert.match(def, /empty|omitted/i, 'no update → the clause is empty');
  // A resumed update ran in an earlier session, so the clause must not claim "this session".
  assert.match(def, /Updated from \{base\} by close-out via/, 'clause holds for a resumed update too');
  // #4317 NB4: keyed on a handed-off sha, like close-out.md step 5 — a merge that brought in nothing ran but hands off none.
  assert.match(def, /when `close-out-update\.md` handed off a `\{verified-sha\}` for this candidate/, 'clause keyed on a handed-off sha');
  assert.doesNotMatch(def, /ran for this candidate/, 'clause never keyed on the update having run');
  assert.doesNotMatch(def, /this session/, 'clause never claims the update ran this session');
  // The approver the question names saw an earlier head, so the clause says so.
  assert.match(def, /any approval above predates it/, 'clause says an approval above predates the update');
}

test('go-red control: an update clause without the stale-approval note fails AC3.1', () => {
  const from = '; any approval above predates it';
  assertOccursOnce(CONFIRM, from, 'the stale-approval note occurs exactly once');
  assert.throws(() => assertUpdateClause(CONFIRM.replace(from, '')), /approval above predates/);
});

test('go-red control: an update clause claiming "this session" fails AC3.1', () => {
  const from = 'Updated from {base} by close-out via';
  assertOccursOnce(CONFIRM, from, 'the clause wording occurs exactly once');
  assert.throws(() => assertUpdateClause(CONFIRM.replace(from, 'Updated from {base} this session via')), /resumed update too/);
});

test('#4317 AC2.1 go-red control: an update clause keyed on the update having run fails', () => {
  const from = 'when `close-out-update.md` handed off a `{verified-sha}` for this candidate';
  assertOccursOnce(CONFIRM, from, 'the trigger clause occurs exactly once');
  assert.throws(() => assertUpdateClause(CONFIRM.replace(from, 'when `close-out-update.md` ran for this candidate')), /handed-off sha/);
});

// #4317 AC1.1: the marker is cleared only after the verified merge or a decline at the gate.
function assertDeclineClearsMarker(confirm) {
  const start = confirm.indexOf('Declining (Option 2) stops here');
  assert.ok(start >= 0, 'decline paragraph found');
  const end = confirm.indexOf('\n\n', start);
  const para = confirm.slice(start, end < 0 ? undefined : end);
  assert.match(para, /When `close-out-update\.md` handed off a `\{verified-sha\}`, first clear its marker\s+\(`cleared \(declined at confirmation gate\)`/, 'a decline clears the update marker');
}

function assertMergedClearsMarker(closeOut) {
  const start = closeOut.indexOf('7. **On `merged`');
  assert.ok(start >= 0, 'close-out step 7 found');
  const step7 = closeOut.slice(start, closeOut.indexOf('\n## ', start));
  assert.match(step7, /When `close-out-update\.md` handed off a `\{verified-sha\}`, clear its marker on `merged` \(`cleared \(merged\)`/, 'merged clears the update marker');
  assert.match(step7, /on `armed` it stays pending/, 'armed leaves the marker pending');
}

test('#4317 AC1.1: the update marker is cleared on merged and on a gate decline, and only there', () => {
  assertDeclineClearsMarker(CONFIRM);
  assertMergedClearsMarker(CLOSE_OUT);
});

test('#4317 AC1.1 go-red control: a decline that keeps the marker fails', () => {
  const from = 'first clear its marker';
  assertOccursOnce(CONFIRM, from, 'the clear occurs exactly once');
  assert.throws(() => assertDeclineClearsMarker(CONFIRM.replace(from, 'keep its marker')), /decline clears/);
});

test('#4317 AC1.1 go-red control: a merged outcome that keeps the marker fails', () => {
  const from = 'clear its marker on `merged`';
  assertOccursOnce(CLOSE_OUT, from, 'the clear occurs exactly once');
  assert.throws(() => assertMergedClearsMarker(CLOSE_OUT.replace(from, 'leave its marker on `merged`')), /merged clears/);
});

test('#4317 AC1.1 go-red control: an armed outcome that clears the marker fails', () => {
  const from = 'on `armed` it stays pending';
  assertOccursOnce(CLOSE_OUT, from, 'the armed clause occurs exactly once');
  assert.throws(() => assertMergedClearsMarker(CLOSE_OUT.replace(from, 'on `armed` it is cleared')), /armed leaves/);
});

test('AC3.1: the confirmation question names that an update ran, the conflicted files, and the resolution commit', () => {
  assertUpdateClause(CONFIRM);
});

for (const v of CLAUSE_VALUES) {
  test(`go-red control: dropping ${v} from the {update-clause} paragraph alone fails AC3.1`, () => {
    const q = CONFIRM.indexOf('`question`:');
    const from = CONFIRM.indexOf('{update-clause}', CONFIRM.indexOf('\n', q));
    const end = CONFIRM.indexOf('\n\n', from);
    const para = CONFIRM.slice(from, end);
    assert.ok(para.includes(v), `the clause paragraph names ${v} to begin with`);
    const mutated = CONFIRM.slice(0, from) + para.split(v).join('{dropped}') + CONFIRM.slice(end);
    assert.notEqual(mutated, CONFIRM, 'the mutation must change the text');
    assert.throws(() => assertUpdateClause(mutated), new RegExp(`names ${v.replace(/[{}]/g, '\\$&')}`));
  });
}

const SCAN = readSkillFile('_shared', 'github-pr-scan.md');

function assertItem11(scan) {
  const start = scan.indexOf('11. **Stale pending-review PR**');
  const end = scan.indexOf('Findings and recommendations', start);
  assert.ok(start >= 0 && end > start, 'item 11 locatable');
  const item11 = scan.slice(start, end);
  assert.ok(item11.includes('**Flag-only, never auto-rebase.**'), 'still flag-only');
  assert.ok(item11.includes('close-out-update.md'), 'names close-out\'s update path');
  assert.ok(!item11.includes('gh pr update-branch'), 'the sweep itself never updates');
  assert.ok(!/rebase and re-verify/i.test(scan), 'the [pr-stale] recommendation no longer says rebase');
}

test('AC5.1: github-pr-scan item 11 stays flag-only and points at close-out\'s update path', () => {
  assertItem11(SCAN);
});

test('go-red control: a capitalized rebase recommendation in github-pr-scan fails AC5.1', () => {
  const from = 'Update from the integration branch and re-verify';
  assertOccursOnce(SCAN, from, 'the [pr-stale] recommendation occurs exactly once');
  assert.throws(() => assertItem11(SCAN.replace(from, 'Rebase and re-verify')), /no longer says rebase/);
});

// After an update the gate's CI/mergeability values are the update's post-push re-reads.
function assertPostUpdateSourceValues(confirm) {
  const start = confirm.indexOf('**Source values live');
  assert.ok(start >= 0, 'Source values live paragraph found');
  const para = confirm.slice(start, confirm.indexOf('\n\n', start));
  assert.match(para, /After an update, `\{status\}` and `\{mergeable-summary\}` are `close-out-update\.md`\s+step 6's re-reads/, 'post-update values come from close-out-update.md step 6');
}

test('the confirmation gate reads post-update CI and mergeability from close-out-update.md step 6', () => {
  assertPostUpdateSourceValues(CONFIRM);
});

test('go-red control: the confirmation gate without the post-update source rule fails', () => {
  const from = 'After an update, `{status}` and `{mergeable-summary}` are `close-out-update.md`\nstep 6\'s re-reads (the latest read), never steps 1-2\'s pre-update values, which describe a head the\nupdate replaced. ';
  assertOccursOnce(CONFIRM, from, 'the rule occurs exactly once');
  assert.throws(() => assertPostUpdateSourceValues(CONFIRM.replace(from, '')), /step 6/);
});

const COMMENTS = readSkillFile('_shared', 'pr-run-comments.md');

// #4317 AC1.1: the marker is a registered run-comment kind, with its gate exception stated where the gate is.
function assertCloseOutKindRegistered(comments) {
  assert.match(comments, /^\| `close-out-update` \|[^\n]*`<!-- run-comment: close-out-update -->`[^\n]*\|$/m, 'Comment kinds lists close-out-update with its marker');
  assert.match(comments, /^\| `\/claude-tweaks:dispatch close-out` \(`close-out-update\.md`'s Update marker\) \| `close-out-update` \|[^\n]*\|$/m, 'Consumer table lists close-out-update');
  const gate = comments.slice(comments.indexOf('## The gate'), comments.indexOf('## Comment kinds'));
  assert.match(gate, /\*\*`close-out-update` is the one exception:\*\*/, 'the gate section names the close-out-update exception');
  assert.match(gate, /so it skips this gate, and a failed find or write stops the update instead of falling back to the issue/, 'the exception states it skips the gate and never falls back to the issue');
}

test('#4317 AC1.1: pr-run-comments.md registers the close-out-update kind and its gate exception', () => {
  assertCloseOutKindRegistered(COMMENTS);
});

test('#4317 AC1.1 go-red control: dropping the gate exception\'s substance fails', () => {
  const from = 'so it skips this gate, and a failed find or write stops the update instead of falling back to the issue';
  assertOccursOnce(COMMENTS, from, 'the gate exception clause occurs exactly once');
  assert.throws(() => assertCloseOutKindRegistered(COMMENTS.replace(from, 'so it follows the gate')), /skips the gate and never falls back to the issue/);
});

test('#4317 AC1.1 go-red control: dropping the close-out-update kind row fails', () => {
  const row = COMMENTS.split('\n').find((l) => l.startsWith('| `close-out-update` |'));
  assert.ok(row, 'the kind row exists to drop');
  assert.throws(() => assertCloseOutKindRegistered(COMMENTS.replace(`${row}\n`, '')), /Comment kinds lists close-out-update/);
});

test('#4317 AC1.1 go-red control: dropping the gate exception fails', () => {
  const from = '**`close-out-update` is the one exception:**';
  assertOccursOnce(COMMENTS, from, 'the exception occurs exactly once');
  assert.throws(() => assertCloseOutKindRegistered(COMMENTS.replace(from, '')), /gate section names/);
});
