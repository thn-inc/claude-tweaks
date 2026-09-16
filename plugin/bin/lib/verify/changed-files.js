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

class ChangedFilesError extends Error {
  constructor(message) { super(message); this.name = 'ChangedFilesError'; }
}

function git(execImpl, args) {
  return String(execImpl('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
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
    throw new ChangedFilesError('could not resolve a base: no usable stamp anchor and no --integration-branch or --base given');
  }
  const ref = preferOriginRef((args) => git(execImpl, args), integrationBranch);
  const mb = tryGit(execImpl, ['merge-base', '--end-of-options', ref, 'HEAD']);
  if (mb === null || mb.trim() === '') {
    throw new ChangedFilesError(`could not resolve a base: no usable stamp anchor and no merge base of "${ref}" and HEAD`);
  }
  return mb.trim();
}

// `git diff --name-status -z`: a flat NUL-delimited stream — "STATUS\0path\0"
// per ordinary record, or "STATUS\0old\0new\0" for a rename/copy (status
// starts with R or C). No quoting is applied to paths in -z mode, unlike the
// default output which C-quotes non-ASCII bytes.
function parseDiffNameStatusZ(raw) {
  const tokens = raw.split('\0');
  const files = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    if (status === '') { i += 1; continue; }
    if (status[0] === 'R' || status[0] === 'C') {
      files.push(tokens[i + 2]);
      i += 3;
    } else {
      files.push(tokens[i + 1]);
      i += 2;
    }
  }
  return files;
}

// `git status --porcelain -z`: each record is "XY path\0" — the space
// between the two-letter status and the path survives (only the trailing
// newline/rename-arrow separator is replaced by NUL) — except a rename or
// copy (R/C anywhere in XY), which is "XY new\0old\0": the NEW path comes
// first in -z mode, reversed from the "old -> new" order of the default
// (non-z) porcelain format.
function parseStatusPorcelainZ(raw) {
  const tokens = raw.split('\0');
  const files = [];
  let i = 0;
  while (i < tokens.length) {
    const entry = tokens[i];
    if (entry === '') { i += 1; continue; }
    const xy = entry.slice(0, 2);
    files.push(entry.slice(3));
    i += (xy.includes('R') || xy.includes('C')) ? 2 : 1;
  }
  return files;
}

function changedFiles({ base, execImpl = execFileSync }) {
  const set = new Set();
  const diff = git(execImpl, ['diff', '--name-status', '-z', '--end-of-options', `${base}..HEAD`]);
  for (const f of parseDiffNameStatusZ(diff)) set.add(f);
  // --untracked-files=all: an untracked directory reports each file inside
  // it individually rather than collapsing to the directory name.
  const status = git(execImpl, ['status', '--porcelain', '-z', '--untracked-files=all']);
  for (const f of parseStatusPorcelainZ(status)) set.add(f);
  return { base, files: [...set].sort() };
}

module.exports = {
  changedFiles, resolveBase, usableAnchor, ChangedFilesError,
};
