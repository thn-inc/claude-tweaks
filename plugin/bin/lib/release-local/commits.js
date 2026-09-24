'use strict';
// bin/lib/release-local/commits.js — first-parent conventional-commit history
// since the last v* tag (#2254, design stance 3: the local engine reads
// --first-parent, so --no-ff merges are one composer-written subject each).
// An unparseable subject is reported as `unconventional`, never dropped
// (.claude/skills/parse-signal-discipline): it is real signal that someone
// bypassed the merge-time composer.
const { RELEASE_NOTE_FOOTER_RE } = require('../release-notes');
const { compareVersions } = require('../changelog.js');

const HEADER_RE = /^(\w+)(\([^)]*\))?(!)?: (.+)$/;
// Conventional Commits declares `BREAKING CHANGE:` and `BREAKING-CHANGE:` equivalent.
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE: ?(.*)$/m;
const RECORD = '\x1e';
const FIELD = '\x1f';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

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
  const footer = BREAKING_FOOTER_RE.exec(body);
  // Single-line by construction (#2580/#2581) — a multi-line `Release-Note:` section
  // is truncated to its first line here, mirroring `footer`'s own extraction shape.
  const releaseNoteFooter = RELEASE_NOTE_FOOTER_RE.exec(body);
  const releaseNote = releaseNoteFooter ? releaseNoteFooter[1].trim() : null;
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
    releaseNote,
  };
}

function readCommits(git, tag, ref = 'HEAD') {
  const range = tag ? `${tag}..${ref}` : ref;
  const raw = git(['log', '--first-parent', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range]);
  return raw.split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [sha, subject, body = ''] = chunk.split(FIELD);
      return parseCommit({ sha: sha.trim(), subject: subject.trim(), body });
    });
}

function conventionalHistory(git, ref = 'HEAD') {
  const tag = lastTag(git, ref);
  return { lastTag: tag, commits: readCommits(git, tag, ref) };
}

module.exports = { HEADER_RE, lastTag, parseCommit, readCommits, conventionalHistory };
