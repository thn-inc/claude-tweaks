'use strict';

// #4588: the pure eligibility verdict behind `/claude-tweaks:dispatch resume #N`, plus the
// resume-context derivation for the first call's prompt. Sibling of exclusions.js: that module
// owns the queue's `open-pr` exclusion, this one decides whether the very PR it excludes is
// the record's own stalled build and may be restarted. No I/O here -- bin/dispatch-resume.js
// gathers the PR listing, claim blob, labels and run-dir/worktree state and passes them in.
//
// The Closed rule (spec D1): the eligible states are exhaustive. Every other state returns one
// `line` naming the state and a manual remedy, evaluated in the order resumeEligibility lists, and
// a `disposition` saying what that line tells the human to do with the PR: `resume` (fix or wait,
// then resume), `close-out` (it awaits review), `close` (rebuild it fresh, or take it by hand), or
// null (`no-pr`: there is no PR). refusalDetail turns a refusal into the fields a caller reports.

const path = require('path');
const { classifyClaimBlob } = require('../issues/claims');
const { RUN_ID_SHAPE } = require('../issues/claim-store');
const { parseEntry } = require('../log-decision/append');
const { sanitizeWorktreeName } = require('../worktree/name');

// The vocabulary has one home. `concurrent-resume` and `stale-bound-run` are produced only by
// bin/dispatch-resume.js's run-dir scan (one this pure function cannot make).
const REFUSAL_REASONS = Object.freeze([
  'no-pr', 'multiple-prs', 'foreign-pr', 'not-draft', 'live-sibling', 'pr-opened', 'live-claim',
  'claim-not-resumable', 'run-mismatch', 'record-closed', 'blocked-by', 'not-granted', 'label-drift',
  'unlisted-label', 'unlisted-state', 'prior-run-live', 'prior-run-other-host', 'dirty-worktree',
  'worktree-branch', 'branch-diverged', 'branch-checked-out', 'concurrent-resume', 'stale-bound-run',
  'invalid-input', 'multi-record-pr', 'cross-repo-pr',
]);

const PRIOR_RUN_DIR_CLASSES = Object.freeze([
  'archived', 'absent', 'residue', 'stateless', 'dead-owner', 'live-owner', 'unknown-owner', 'other-host-owner',
]);

// RUN_ID_SHAPE's fixed-width `YYYY-MM-DDTHHMMSS-` timestamp prefix.
const RUN_ID_PREFIX_LENGTH = 18;

const MARKER_BARE = /^claude-tweaks-run: (\S+)$/;
const MARKER_COMMENT = /^<!-- claude-tweaks-run: (\S+) -->$/;

// The run id from the first trimmed line that is exactly a `claude-tweaks-run: {id}` marker (bare or
// as an HTML comment) naming an id of RUN_ID_SHAPE; null otherwise. A substring mention never counts.
function runIdFromPrBody(body) {
  if (typeof body !== 'string') return null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const m = MARKER_BARE.exec(line) || MARKER_COMMENT.exec(line);
    if (m && RUN_ID_SHAPE.test(m[1])) return m[1];
  }
  return null;
}

function nonEmptyString(v) {
  return typeof v === 'string' && v !== '' ? v : null;
}

// The run id a claim blob names: `sweptFrom` for a `swept:` tombstone (its `runId` is the sweeping
// /tidy run's), `runId` otherwise. null when that field is not a non-empty string.
function claimRunId(parsedBlob) {
  if (parsedBlob === null || typeof parsedBlob !== 'object') return null;
  const swept = parsedBlob.released === true && typeof parsedBlob.reason === 'string'
    && parsedBlob.reason.startsWith('swept:');
  return nonEmptyString(swept ? parsedBlob.sweptFrom : parsedBlob.runId);
}

// The base open-pr line, byte-identical to open-pr-exclusion-report.md's named-record template.
function openPrLine(n, pr) {
  return `#${n} already has an open PR (#${pr}) — not re-dispatch-eligible until that PR merges or closes`;
}

const refuse = (reason, line, disposition = 'resume') => ({ eligible: false, reason, line, disposition });
const noPick = (reason, line, disposition = 'resume') => ({ ok: false, reason, line, disposition });

// The worktree a head's build lives in: one leading `worktree-` stripped, or null when the rest could
// not be that worktree's name, so no path or command is ever composed from it.
function worktreeNameForHead(head) {
  if (typeof head !== 'string') return null;
  const rest = head.startsWith('worktree-') ? head.slice('worktree-'.length) : head;
  if (!/^[A-Za-z0-9]/.test(rest) || sanitizeWorktreeName(rest) !== rest) return null;
  return rest.split('/').every((seg) => seg !== '' && !seg.startsWith('.')) ? rest : null;
}

// The open closing PRs split on whose branch they are. `kept` states isCrossRepository === false;
// a fork's body proves nothing and an entry that does not state it is not trusted, so both are `forks`.
function splitListing(prs) {
  const rows = (Array.isArray(prs) ? prs : []).filter((p) => p && typeof p === 'object');
  return { kept: rows.filter((p) => p.isCrossRepository === false), forks: rows.filter((p) => p.isCrossRepository !== false) };
}

// A foreign or bundled PR: `close` only for a draft. A non-draft PR may await review, so it is never
// told to close -- close-out takes it when it carries the marker close-out needs, a human otherwise.
function closeUnlessReviewable(reason, issue, pr, draftLine) {
  if (pr.isDraft === true) return noPick(reason, draftLine, 'close');
  const line = runIdFromPrBody(pr.body) !== null
    ? `#${issue}'s PR #${pr.number} is not a draft and awaits review — run /claude-tweaks:dispatch close-out #${issue}`
    : `#${issue}'s PR #${pr.number} is not a draft and carries no claude-tweaks-run marker, which close-out needs — review and merge it by hand`;
  return noPick(reason, line, 'close-out');
}

function crossRepoRefusal(issue, forks) {
  const sorted = [...forks].sort((a, b) => a.number - b.number);
  const named = sorted.map((p) => `#${p.number} (${p.url})`).join(', ');
  const one = sorted.length === 1;
  const subject = `#${issue}'s open closing ${one ? 'PR' : 'PRs'} ${named} ${one ? 'comes' : 'come'} from a fork or another repository`;
  if (sorted.some((p) => p.isDraft !== true)) {
    return noPick('cross-repo-pr', `${subject} and ${one ? 'is not a draft' : 'not all are drafts'} — review and merge ${one ? 'it' : 'them'} by hand`, 'close-out');
  }
  return noPick('cross-repo-pr', `${subject} — dispatch resume only restarts a build on this repository's own branch; merge or close ${one ? 'it' : 'them'}, then run /claude-tweaks:dispatch #${issue}`, 'close');
}

// Which of the record's open closing PRs is its own stalled build, whatever its head is named: one
// same-repo PR closing this record alone, on a head a worktree could hold, whose marker's slug names
// this record exactly.
function selectResumePr(issue, prs) {
  const { kept, forks } = splitListing(prs);
  if (kept.length === 0) {
    if (forks.length > 0) return crossRepoRefusal(issue, forks);
    return noPick('no-pr', `#${issue} has no open PR that closes it — nothing to resume; run /claude-tweaks:dispatch #${issue}`, null);
  }
  if (kept.length > 1) {
    const numbers = kept.map((p) => p.number).sort((a, b) => a - b).map((n) => `#${n}`).join(', ');
    return noPick('multiple-prs', `#${issue} has ${kept.length} open PRs that close it (${numbers} in ascending number order) — not resumable until only one remains; close the extra PR, then run /claude-tweaks:dispatch resume #${issue}`);
  }
  const pr = kept[0];
  if (!Number.isInteger(pr.closingRecords) || pr.closingRecords < 1) {
    const bad = invalidInput(issue, 'PR closing-record count', pr.closingRecords);
    return noPick(bad.reason, bad.line, bad.disposition);
  }
  if (pr.closingRecords > 1) {
    return closeUnlessReviewable('multi-record-pr', issue, pr, `#${issue}'s PR #${pr.number} closes ${pr.closingRecords} records — dispatch resume restarts one record's build, never a bundle; merge or close PR #${pr.number} by hand, then run /claude-tweaks:dispatch #${issue}`);
  }
  const runId = runIdFromPrBody(pr.body);
  if (worktreeNameForHead(pr.headRefName) === null || runId === null || runId.slice(RUN_ID_PREFIX_LENGTH) !== `record-${issue}`) {
    return closeUnlessReviewable('foreign-pr', issue, pr, openPrLine(issue, pr.number));
  }
  return { ok: true, pr, runId };
}

// Every step a fresh dispatch of the record needs: its open-pr exclusion goes with the PR, and a kept
// worktree or branch blocks the new one. A head no worktree could hold is unsafe to paste into a command.
function closeRedispatchRemedy({ issue, prNumber, headRefName, mainRoot }) {
  const name = worktreeNameForHead(headRefName);
  const closePr = `close PR #${prNumber} (gh pr close ${prNumber})`;
  const redispatch = `then run /claude-tweaks:dispatch #${issue}`;
  if (name === null) return `${closePr}, remove any worktree holding its branch and delete the local and remote branch by hand, ${redispatch}`;
  const worktree = path.join(mainRoot, '.claude', 'worktrees', ...name.split('/'));
  return `${closePr}, remove its worktree if one exists (git worktree remove "${worktree}"), delete the local and remote branch (git branch -D ${headRefName}; git push origin --delete ${headRefName}), ${redispatch}`;
}

// What a caller reports for a refused verdict. `prNumbers` are the refusal's subject (the kept PRs, or
// the fork PRs when none is kept), ascending; `headRefName` is the one kept PR's head, else null.
function refusalDetail({ issue, verdict, prs, mainRoot }) {
  const { kept, forks } = splitListing(prs);
  const subject = kept.length > 0 ? kept : forks;
  const only = kept.length === 1 ? kept[0] : null;
  let remedy = verdict.line;
  if (verdict.reason === 'no-pr') remedy = null;
  else if (verdict.disposition === 'close' && only !== null && verdict.reason !== 'record-closed' && verdict.reason !== 'cross-repo-pr') {
    remedy = closeRedispatchRemedy({ issue, prNumber: only.number, headRefName: only.headRefName, mainRoot });
  }
  return {
    prNumbers: subject.map((p) => p.number).sort((a, b) => a - b),
    disposition: verdict.disposition === undefined ? null : verdict.disposition,
    remedy,
    headRefName: only === null ? null : only.headRefName,
  };
}

function parseClaim(content) {
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The inputs that guard a refusal (siblingLive, issueState, openBlockers, worktreeDirty,
// worktreeBranch) must be the type the gatherer promises: a missing or mistyped one is never read
// as "nothing to refuse", nor named in a refusal line as if it were a real state.
function invalidInput(n, what, value) {
  let kind = typeof value;
  if (value === null) kind = 'null';
  else if (Array.isArray(value)) kind = 'array';
  return refuse('invalid-input', `#${n}'s ${what} was not usable (${kind}) — not resumable on a malformed check; run /claude-tweaks:dispatch resume #${n} again, and report it if it repeats`);
}

function sha7(sha) {
  return typeof sha === 'string' && sha !== '' ? sha.slice(0, 7) : 'unknown';
}

// `reason` is a claim tombstone's release reason, '' when it carries none.
function resumableTombstoneReason(reason) {
  return reason.startsWith('failed:') || reason.startsWith('abandoned:') || reason.startsWith('swept: stale claim');
}

function resumeEligibility(input) {
  const {
    issue: n, prs, claimContent, labels, now, priorRunDir, priorRunOpen, priorRunOwnerHost, siblingLive,
    worktreePath, worktreeDirty, worktreeBranch, issueState, openBlockers, localBranchSha, branchCheckedOutAt,
  } = input;

  const selected = selectResumePr(n, prs);
  if (!selected.ok) return refuse(selected.reason, selected.line, selected.disposition);
  const { pr, runId } = selected;
  const prNo = pr.number;
  const resumeCmd = `/claude-tweaks:dispatch resume #${n}`;

  if (pr.isDraft !== true) {
    return refuse('not-draft', `#${n}'s PR #${prNo} is not a draft — dispatch resume only restarts a stalled build's draft PR; if it awaits review, run /claude-tweaks:dispatch close-out #${n}`, 'close-out');
  }
  if (typeof siblingLive !== 'boolean') return invalidInput(n, 'sibling-session check', siblingLive);
  if (siblingLive) return refuse('live-sibling', openPrLine(n, prNo));

  const claimState = classifyClaimBlob(claimContent, now).state;
  const blob = parseClaim(claimContent);
  const tombReason = claimState === 'tombstone' && typeof blob.reason === 'string' ? blob.reason : '';

  if (claimState === 'tombstone' && tombReason.startsWith('pr-opened:')) {
    return refuse('pr-opened', `#${n}'s PR #${prNo} finished its build and awaits review — run /claude-tweaks:dispatch close-out #${n}`, 'close-out');
  }
  if (claimState === 'live') {
    return refuse('live-claim', `#${n} is already claimed by a live run — not resumable; wait for that run to finish or its claim to expire, then run ${resumeCmd}`);
  }
  const resumableClaim = claimState === 'stale' || (claimState === 'tombstone' && resumableTombstoneReason(tombReason));
  if (!resumableClaim) {
    const reasonPart = claimState === 'tombstone' ? ` (${tombReason || 'no reason'})` : '';
    return refuse('claim-not-resumable', `#${n}'s claim is ${claimState}${reasonPart} — not resumable: dispatch resume needs a failed:, abandoned: or swept: stale claim tombstone, or a stale claim; close PR #${prNo} and run /claude-tweaks:dispatch #${n} to rebuild it fresh`, 'close');
  }

  const claimRun = claimRunId(blob);
  if (claimRun !== runId) {
    if (claimRun === null) {
      return refuse('run-mismatch', `#${n}'s claim names no run id but PR #${prNo}'s claude-tweaks-run: marker names ${runId} — not resumable; close PR #${prNo} and run /claude-tweaks:dispatch #${n} to rebuild it fresh`, 'close');
    }
    return refuse('run-mismatch', `#${n}'s claim names run ${claimRun} but PR #${prNo}'s claude-tweaks-run: marker names ${runId} — not resumable while they disagree; rebind PR #${prNo}'s claude-tweaks-run: marker to ${claimRun} by hand (the run that claimed #${n} last), then run ${resumeCmd}`);
  }

  if (typeof issueState !== 'string') return invalidInput(n, 'issue state', issueState);
  if (issueState !== 'OPEN') {
    return refuse('record-closed', `#${n} is ${String(issueState).toLowerCase()} — not resumable; reopen it first if the work is still wanted, or close PR #${prNo}`, 'close');
  }
  if (!Array.isArray(openBlockers)) return invalidInput(n, 'open-blocker list', openBlockers);
  if (openBlockers.length > 0) {
    return refuse('blocked-by', `#${n} is blocked by open ${openBlockers.map((b) => `#${b}`).join(', ')} — not resumable until they close; then run ${resumeCmd}`);
  }

  const labelList = Array.isArray(labels) ? labels : [];
  if (labelList.includes('bot:blocked') || !labelList.includes('auto:build')) {
    const why = labelList.includes('bot:blocked') ? 'carries bot:blocked' : 'lacks auto:build';
    return refuse('not-granted', `#${n} ${why} — re-grant it with /claude-tweaks:backlog refine #${n}, then run ${resumeCmd}`);
  }
  if (labelList.includes('bot:in-progress') && claimState !== 'stale') {
    return refuse('label-drift', `#${n} carries bot:in-progress without a stale claim — remove that label (gh issue edit ${n} --remove-label bot:in-progress), then run ${resumeCmd}`);
  }
  const unlisted = labelList.filter((l) => typeof l === 'string' && l.startsWith('bot:') && l !== 'bot:in-progress').sort()[0];
  if (unlisted !== undefined) {
    return refuse('unlisted-label', `#${n} carries ${unlisted} — not resumable while it is set; clear it (gh issue edit ${n} --remove-label ${unlisted}) once its trigger has fired, then run ${resumeCmd}`);
  }

  if (!PRIOR_RUN_DIR_CLASSES.includes(priorRunDir)) {
    return refuse('unlisted-state', `#${n}'s prior run ${runId} is in an unrecognised state (${priorRunDir}) — not resumable; inspect .claude-tweaks/pipelines/${runId} by hand, archive it with hooks.js archive-run if its owner is gone, then run ${resumeCmd}`);
  }
  if (priorRunDir === 'live-owner' || priorRunDir === 'unknown-owner') {
    const owner = priorRunDir === 'live-owner' ? 'live' : 'unknown';
    const refusal = refuse('prior-run-live', `#${n}'s prior run ${runId} has an owner that is not provably dead (${owner}) — not resumable while it may still be running; wait for it to exit, then run ${resumeCmd}`);
    return priorRunDir === 'live-owner' ? { ...refusal, liveRun: true } : refusal;
  }
  if (priorRunDir === 'other-host-owner') {
    const host = nonEmptyString(priorRunOwnerHost) || 'an unrecorded host';
    return refuse('prior-run-other-host', `#${n}'s prior run ${runId} is owned by a session on another host (${host}) — its death cannot be proven from this machine; run ${resumeCmd} on ${host}`);
  }

  if (!Array.isArray(worktreeDirty)) return invalidInput(n, 'dirty-path list', worktreeDirty);
  if (worktreeDirty.length > 0) {
    return refuse('dirty-worktree', `#${n}'s stalled worktree ${worktreePath} has uncommitted edits: ${worktreeDirty.join(', ')} — commit or discard them, then run ${resumeCmd}; resume never commits or pushes them`);
  }
  if (worktreeBranch !== null && typeof worktreeBranch !== 'string') {
    return invalidInput(n, 'stalled-worktree branch', worktreeBranch);
  }
  if (worktreeBranch !== null && worktreeBranch !== pr.headRefName) {
    const on = worktreeBranch === '' ? 'a detached HEAD' : `branch ${worktreeBranch}`;
    return refuse('worktree-branch', `#${n}'s stalled worktree ${worktreePath} is on ${on}, not ${pr.headRefName} — check out ${pr.headRefName} there, or remove the worktree so resume recreates it, then run ${resumeCmd}`);
  }

  const worktreeMissing = worktreeBranch === null;
  const hasLocalBranch = worktreeMissing && nonEmptyString(localBranchSha) !== null;
  if (worktreeMissing && nonEmptyString(branchCheckedOutAt) !== null) {
    // Still registered at the stalled path itself: the directory is gone, so prune, not remove.
    if (typeof worktreePath === 'string' && path.resolve(branchCheckedOutAt) === path.resolve(worktreePath)) {
      const main = path.dirname(path.dirname(path.dirname(worktreePath))); // {main}/.claude/worktrees/{name}
      return refuse('branch-checked-out', `#${n}'s branch ${pr.headRefName} is still registered to the missing worktree ${worktreePath} — prune it with git -C ${main} worktree prune, then run ${resumeCmd}`);
    }
    return refuse('branch-checked-out', `#${n}'s branch ${pr.headRefName} is checked out at ${branchCheckedOutAt} — remove that worktree (or resume from it), then run ${resumeCmd}`);
  }
  if (hasLocalBranch && localBranchSha !== pr.headRefOid) {
    return refuse('branch-diverged', `#${n}'s local branch ${pr.headRefName} is at ${sha7(localBranchSha)}, not PR #${prNo}'s head ${sha7(pr.headRefOid)} — push its commits or reset it to origin/${pr.headRefName}, then run ${resumeCmd}`);
  }

  const deadOwner = priorRunDir === 'dead-owner';
  return {
    eligible: true,
    priorRunId: runId,
    prUrl: pr.url,
    prNumber: prNo,
    priorRunDir,
    archivePriorRun: deadOwner,
    closePriorRun: deadOwner && priorRunOpen === true,
    localBranchExists: hasLocalBranch,
  };
}

// ---- resume context (deliverable 4) ----

// /dispatch and /wrap-up record settle/teardown, not build progress.
const PIPELINE_SECTIONS = new Set(['/flow', '/build', '/test', '/review', '/design-wrapper']);
const DEFECT_STATUSES = new Set(['KEPT-PROMPT', 'REFUSED']);
const DEFECT_MAX_CHARS = 300;

function truncate(text) {
  return text.length > DEFECT_MAX_CHARS ? `${text.slice(0, DEFECT_MAX_CHARS - 1)}…` : text;
}

// The archived run's decisions.md -> where the build stopped and what it left open.
//   lastPhase   -- {section, step} of the last entry under the last pipeline section heading in the
//                  file (`step` is the entry's location); null when that section holds no entry.
//   openDefects -- the action text of every KEPT-PROMPT / REFUSED entry in pipeline sections, in
//                  file order, each at most 300 chars.
function resumeContext(decisionsText) {
  const result = { lastPhase: null, openDefects: [] };
  if (typeof decisionsText !== 'string') return result;
  let section = null;
  let lastPipelineSection = null;
  let lastEntry = null;
  for (const raw of decisionsText.split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(raw);
    if (heading) {
      section = heading[1];
      if (PIPELINE_SECTIONS.has(section)) {
        lastPipelineSection = section;
        lastEntry = null;
      }
      continue;
    }
    if (!PIPELINE_SECTIONS.has(section)) continue;
    const entry = parseEntry(raw);
    if (entry === null) continue;
    lastEntry = entry;
    if (DEFECT_STATUSES.has(entry.status)) result.openDefects.push(truncate(entry.action));
  }
  if (lastPipelineSection !== null && lastEntry !== null) {
    result.lastPhase = { section: lastPipelineSection, step: lastEntry.location };
  }
  return result;
}

module.exports = {
  REFUSAL_REASONS, RUN_ID_PREFIX_LENGTH, runIdFromPrBody, claimRunId, openPrLine, selectResumePr, resumeEligibility, resumeContext,
  worktreeNameForHead, closeRedispatchRemedy, refusalDetail,
};
