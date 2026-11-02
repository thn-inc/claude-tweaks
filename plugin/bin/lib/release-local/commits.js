'use strict';
// bin/lib/release-local/commits.js — first-parent conventional-commit history
// since the last v* tag (#2254, design stance 3: the local engine reads
// --first-parent, so --no-ff merges are one composer-written subject each).
// An unparseable subject is reported as `unconventional`, never dropped
// (.claude/skills/parse-signal-discipline): it is real signal that someone
// bypassed the merge-time composer. #2954: readCommits/conventionalHistory
// also accept an opt-in `{ firstParent: false }` for a `pr-first` consumer
// whose PRs land as plain (unconventional-subject) --no-ff merges — the
// default stays first-parent for this module's other caller,
// bin/release-local.js, which still depends on it.
const { extractReleaseNotes } = require('../release-notes');
const { compareVersions } = require('../changelog.js');

const HEADER_RE = /^(\w+)(\([^)]*\))?(!)?: (.+)$/;
// Conventional Commits declares `BREAKING CHANGE:` and `BREAKING-CHANGE:` equivalent.
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE: ?([^\n]*)$/;
const RECORD = '\x1e';
const FIELD = '\x1f';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
// Closing/reference footers a bundled merge commit carries, one per bundled
// record (#4634): `Fixes #N` closes it, `Refs #N` keeps it open. Not
// closing-links.js's parseFixesSpan — that reads PR-body span markers a commit
// body never has. Case-sensitive and anchored, so prose never matches. `Fixes` must
// fill its line (CR-tolerant); `Refs` may carry trailing text, as hand-written
// footers on main do (`Refs #3351 — …`), because reading one only keeps a record open.
const FIXES_RE = /^Fixes #(\d+)[ \t]*\r?$/;
const REFS_RE = /^Refs #(\d+)\b/;

// git and GitHub split a commit body on LF alone, while JS `^`/`$` under `m` also break
// on U+2028/U+2029. Footers match per LF line, so text behind those separators stays in
// its line and a release note cannot smuggle a footer the forge never saw (#4634).
function lineMatches(re, lines) {
  return lines.map((line) => re.exec(line)).filter(Boolean);
}

// The highest v* tag reachable as an ancestor of `ref` (`git tag --merged`,
// full-reachability — not `git describe --first-parent`). A prior version
// used `describe --first-parent`, which walks the strict first-parent spine
// and can silently return an OLDER tag when the real last release is only
// reachable via a non-first-parent edge (e.g. a plain `git merge
// origin/<branch>` landed on a stale local branch buries the newer tag off
// the first-parent chain, incident 2026-09-23) — `describe` reports no
// error in that case, just the wrong tag, so callers never see a signal to
// fall back on. `--merged` can't make that mistake: it lists every tag
// that IS an ancestor, so the result is always a genuine ancestor tag, and
// `readCommits`'s `tag..ref` range below is correct regardless of whether
// that tag sits on the first-parent spine or not (range exclusion uses
// full reachability, not the `--first-parent` walk, even when `log
// --first-parent` is the command doing the walking).
function lastTag(git, ref = 'HEAD') {
  let bestTag = null;
  let bestVersion = null;
  for (const line of git(['tag', '--merged', ref, '-l', 'v[0-9]*']).split('\n')) {
    const tag = line.trim();
    const version = tag.replace(/^v/, '');
    // Also rejects the empty line `split` leaves at the end of git's output.
    if (!SEMVER_RE.test(version)) continue;
    if (!bestTag || compareVersions(version, bestVersion) > 0) {
      bestTag = tag;
      bestVersion = version;
    }
  }
  return bestTag;
}

function parseCommit({ sha, subject, body = '' }) {
  const m = HEADER_RE.exec(subject);
  const lines = body.split('\n');
  const footer = lineMatches(BREAKING_FOOTER_RE, lines)[0] || null;
  // A bundled merge commit carries one `Release-Note:` line per bundled record
  // (#4634), so every line is read, not the first. A single-record note written
  // over several lines reads back as its first line only (#2580/#2581).
  const releaseNotes = extractReleaseNotes(body);
  // An unconventional subject IS its own description — which is also what an
  // empty `BREAKING CHANGE:` footer (no description of its own) falls back to,
  // on both paths.
  const description = m ? m[4] : subject;
  const breaking = (m !== null && m[3] === '!') || footer !== null;
  let breakingNote = null;
  if (footer) breakingNote = footer[1].trim() || description;
  else if (breaking) breakingNote = description;
  return {
    sha,
    subject,
    type: m ? m[1] : null,
    scope: m && m[2] ? m[2].slice(1, -1) : null,
    breaking,
    breakingNote,
    description,
    unconventional: m === null,
    releaseNotes,
    fixes: lineMatches(FIXES_RE, lines).map((m) => Number(m[1])),
    refs: lineMatches(REFS_RE, lines).map((m) => Number(m[1])),
  };
}

// opts.firstParent (default true): the local engine's own semantics —
// --no-ff merges are one composer-written subject each (see header comment
// above) — so the default stays the first-parent walk for every existing
// caller. Passing `{ firstParent: false }` is opt-in: it runs the range
// without `--first-parent`, following every parent (release-please's own
// commit-range semantics under a `pr-first` integration model, #2954).
function readCommits(git, tag, ref = 'HEAD', opts = {}) {
  const range = tag ? `${tag}..${ref}` : ref;
  const args = ['log'];
  if (opts.firstParent !== false) args.push('--first-parent');
  args.push(`--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range);
  const raw = git(args);
  return raw.split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [sha, subject, body = ''] = chunk.split(FIELD);
      return parseCommit({ sha: sha.trim(), subject: subject.trim(), body });
    });
}

function conventionalHistory(git, ref = 'HEAD', opts = {}) {
  const tag = lastTag(git, ref);
  return { lastTag: tag, commits: readCommits(git, tag, ref, opts) };
}

module.exports = { HEADER_RE, lastTag, parseCommit, readCommits, conventionalHistory };
