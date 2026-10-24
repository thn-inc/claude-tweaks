// plugin/bin/lib/verify/changed-files.js — the changed-file set the scope
// engine classifies (#1922), and the base it is measured from. Base
// resolution follows blast-radius-cli.js's posture: an explicit --base is
// verified as a commit, a stamp anchor is used only when it is an ancestor
// of HEAD (and then canonicalized via rev-parse rather than trusted
// verbatim), the integration branch prefers its origin/ remote-tracking ref
// (preferOriginRef is imported from blast-radius-cli.js rather than
// duplicated), and an unresolvable base THROWS — never an empty set, which
// would clear every threshold and read as "nothing changed" ([IL-131]'s
// shape). Both git reads use `-z` so a C-quotable path (non-ASCII, containing
// a tab or newline) round-trips intact — git's default quoting would
// otherwise corrupt it. Every git call goes through execImpl so tests inject
// a fake, and every real call runs with stdio ['ignore','pipe','pipe'] (the
// posture blast-radius-cli.js's own default git() uses) so a benign
// non-ancestor/non-existent-ref probe never leaks git's own `fatal:` line to
// this process's stderr — the thrown error still carries the message on the
// exit-2 paths below.
'use strict';

const { execFileSync } = require('child_process');
const { preferOriginRef } = require('../blast-radius-cli.js');
const { anchorOf } = require('./stamp');
const { parseNameStatusZ, parseStatusPorcelainZ } = require('../git-z');

class ChangedFilesError extends Error {
  constructor(message) { super(message); this.name = 'ChangedFilesError'; }
}

function git(execImpl, args) {
  return String(execImpl('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
}

function tryGit(execImpl, args) {
  try { return git(execImpl, args); } catch { return null; }
}

// usableAnchor({ stamp, execImpl }): the canonical sha of the stamp's own
// anchor (stamp.js's anchorOf: fullSha, or sha for a legacy stamp) when — and
// only when — it is a real ancestor of HEAD, else null. Shared by
// resolveBase's own anchor-first path below and bin/verify.js's
// --base-vs-anchor conflict check, so "is this anchor still usable" (a
// rewritten/rebased history can strand the old anchor even though it still
// resolves to a real commit) is tested exactly once (#1922 re-review NEW-1:
// the --base check previously ran a bare rev-parse with no ancestor test, so
// a stale-but-still-resolvable anchor could reject a legitimate --base after
// a history rewrite).
function usableAnchor({ stamp = null, execImpl = execFileSync } = {}) {
  const anchor = anchorOf(stamp);
  if (!anchor) return null;
  if (tryGit(execImpl, ['merge-base', '--is-ancestor', '--end-of-options', anchor, 'HEAD']) === null) return null;
  const canonical = tryGit(execImpl, ['rev-parse', '--verify', '--end-of-options', `${anchor}^{commit}`]);
  return canonical === null || canonical.trim() === '' ? null : canonical.trim();
}

function resolveBase({
  stamp = null, integrationBranch = null, base = null, execImpl = execFileSync, requireNonDegenerate = false,
} = {}) {
  if (base) {
    const out = tryGit(execImpl, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
    if (out === null || out.trim() === '') throw new ChangedFilesError(`--base "${base}" does not resolve to a commit`);
    return out.trim();
  }
  const anchor = usableAnchor({ stamp, execImpl });
  if (anchor !== null) {
    // #2486: a stamp anchor identical to HEAD answers "nothing since the
    // last full verify" — correct for --scope's own incremental intent
    // (that call site never sets requireNonDegenerate), but a caller that
    // explicitly named --integration-branch is asking a different question
    // ("what differs from that branch"), and silently answering the first
    // question instead produces a plausible-looking but empty diff. When
    // the anchor is this degenerate and an integration branch was given,
    // skip it and fall through to the integration-branch resolution below.
    const head = requireNonDegenerate && integrationBranch
      ? tryGit(execImpl, ['rev-parse', '--verify', 'HEAD'])
      : null;
    const degenerate = head !== null && head.trim() === anchor;
    if (!degenerate) return anchor;
  }
  if (!integrationBranch) {
    throw new ChangedFilesError('could not resolve a base: no stamp anchor in use (none usable, or --ignore-stamp) and no --integration-branch or --base given');
  }
  const ref = preferOriginRef((args) => git(execImpl, args), integrationBranch);
  const mb = tryGit(execImpl, ['merge-base', '--end-of-options', ref, 'HEAD']);
  if (mb === null || mb.trim() === '') {
    throw new ChangedFilesError(`could not resolve a base: no stamp anchor in use (none usable, or --ignore-stamp) and no merge base of "${ref}" and HEAD`);
  }
  return mb.trim();
}

// `git diff --name-status -z`: a flat NUL-delimited stream — "STATUS\0path\0"
// per ordinary record, or "STATUS\0old\0new\0" for a rename/copy (status
// starts with R or C). No quoting is applied to paths in -z mode, unlike the
// default output which C-quotes non-ASCII bytes. A rename's old path is gone
// from HEAD exactly like a deletion, so both of its paths are changed; a
// copy's source is untouched, so only the new path is. The pairs form (#4024)
// also carries each path's A/M/D status: a rename's old path is D and its new
// path A, a copy's new path A, and every other non-A/D letter (M, T, U) is M.
function parseDiffNameStatusPairsZ(raw) {
  const pairs = [];
  for (const { status, paths } of parseNameStatusZ(raw)) {
    if (status[0] === 'R' || status[0] === 'C') {
      if (status[0] === 'R') pairs.push([paths[0], 'D']);
      pairs.push([paths[1], 'A']);
    } else {
      pairs.push([paths[0], status[0] === 'A' || status[0] === 'D' ? status[0] : 'M']);
    }
  }
  return pairs.filter(([p]) => p !== undefined);
}

// The A/M/D status of a porcelain record's path (#4024): A for `??`, D when XY
// contains D, A when it contains A, R or C, else M.
function porcelainStatus(xy) {
  if (xy === '??') return 'A';
  if (xy.includes('D')) return 'D';
  return /[ARC]/.test(xy) ? 'A' : 'M';
}

// `git status --porcelain -z`: each record is "XY path\0" — the space
// between the two-letter status and the path survives (only the trailing
// newline/rename-arrow separator is replaced by NUL) — except a rename or
// copy (R/C anywhere in XY), which is "XY new\0old\0": the NEW path comes
// first in -z mode, reversed from the "old -> new" order of the default
// (non-z) porcelain format. As in parseDiffNameStatusPairsZ, a rename's old path
// is changed too; a copy's is not. The pairs form (#4024) carries each path's
// status per porcelainStatus; a rename's old path is D.
function parseStatusPorcelainPairsZ(raw) {
  const pairs = [];
  for (const { xy, path, origPath } of parseStatusPorcelainZ(raw)) {
    pairs.push([path, porcelainStatus(xy)]);
    if (xy.includes('R') && origPath !== undefined) pairs.push([origPath, 'D']);
  }
  return pairs;
}

function statusPorcelainPaths(raw) {
  return parseStatusPorcelainPairsZ(raw).map(([p]) => p);
}

// withStatus (#4024): also return `statuses`, one A/M/D per entry of `files`.
// The committed diff is read first, then the working tree; the first non-M
// status seen for a path wins (an existence change outranks a content edit),
// else M. Without the flag the return shape is exactly { base, files }.
function changedFiles({ base, execImpl = execFileSync, withStatus = false }) {
  const seen = new Map();
  const record = ([f, s]) => { if (!seen.has(f) || seen.get(f) === 'M') seen.set(f, s); };
  const diff = git(execImpl, ['diff', '--name-status', '-z', '--end-of-options', `${base}..HEAD`]);
  for (const pair of parseDiffNameStatusPairsZ(diff)) record(pair);
  // --untracked-files=all: an untracked directory reports each file inside
  // it individually rather than collapsing to the directory name.
  const status = git(execImpl, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all']);
  for (const pair of parseStatusPorcelainPairsZ(status)) record(pair);
  const files = [...seen.keys()].sort();
  if (!withStatus) return { base, files };
  // Object.fromEntries defines own properties, so a path named __proto__
  // cannot reach the prototype setter.
  return { base, files, statuses: Object.fromEntries(files.map((f) => [f, seen.get(f)])) };
}

// `git diff --name-only -z`: one NUL-terminated path per record, no status.
function parseNameOnlyZ(raw) {
  return raw.split('\0').filter((p) => p !== '');
}

// mergeNarrowing (#3072): a --scope run anchored on a full pass that has since
// merged its integration branch would otherwise select every suite the merged-in
// files touch, though those files are byte-identical to the integration tip that
// already passed its own CI. When a merge commit in {anchor}..HEAD has a non-first
// parent that is an ancestor of {ref}, drop every changed path whose HEAD content
// equals {ref}'s tip — unless the working tree also changes it. Two rules keep the
// "own" (kept) set honest: (1) the {ref}..HEAD diff runs with --no-renames —
// --name-only alone prints only a rename's destination, which would silently drop
// a path the branch itself deleted after the anchor (a near-copy already present
// upstream, then a delete, would otherwise read as "unchanged"); (2) every path
// the branch touched as of the anchor (merge-base(anchor, {ref})..{anchor}) is
// also kept in "own" even when its HEAD content now equals {ref}'s tip — a merge
// conflict resolved in {ref}'s favour must not silently drop a file the branch's
// own verified code depends on. Returns null (no narrowing, today's behavior) when
// there is no such merge, {ref} does not resolve, or any read above fails: the
// fallback over-verifies, never under-verifies. resolveBase's anchor-first
// contract is untouched — this filters its result, it never moves the base.
function mergeNarrowing({ anchor, integrationBranch, files, execImpl = execFileSync }) {
  if (!anchor || !integrationBranch) return null;
  const ref = preferOriginRef((args) => git(execImpl, args), integrationBranch);
  const merges = tryGit(execImpl, ['rev-list', '--merges', '--parents', '--end-of-options', `${anchor}..HEAD`]);
  if (merges === null) return null;
  const hasMergedRef = merges.split('\n').filter((l) => l.trim() !== '').some((line) => {
    const otherParents = line.trim().split(/\s+/).slice(2);
    return otherParents.some((p) => tryGit(execImpl, ['merge-base', '--is-ancestor', '--end-of-options', p, ref]) !== null);
  });
  if (!hasMergedRef) return null;
  const differs = tryGit(execImpl, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', ref, 'HEAD']);
  if (differs === null) return null;
  const own = new Set(parseNameOnlyZ(differs));
  const status = tryGit(execImpl, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all']);
  if (status === null) return null;
  for (const f of statusPorcelainPaths(status)) own.add(f);
  const mb = tryGit(execImpl, ['merge-base', '--end-of-options', anchor, ref]);
  if (mb === null || mb.trim() === '') return null;
  const ownAsOfAnchor = tryGit(execImpl, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', mb.trim(), anchor]);
  if (ownAsOfAnchor === null) return null;
  for (const f of parseNameOnlyZ(ownAsOfAnchor)) own.add(f);
  const excluded = files.filter((f) => !own.has(f));
  return { ref, excluded, files: files.filter((f) => own.has(f)) };
}

module.exports = {
  changedFiles, resolveBase, usableAnchor, mergeNarrowing, ChangedFilesError,
};
