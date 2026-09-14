'use strict';
// bin/lib/release-local/commits.js — first-parent conventional-commit history
// since the last v* tag (#2254, design stance 3: the local engine reads
// --first-parent, so --no-ff merges are one composer-written subject each).
// An unparseable subject is reported as `unconventional`, never dropped
// (.claude/skills/parse-signal-discipline): it is real signal that someone
// bypassed the merge-time composer.
const HEADER_RE = /^(\w+)(\([^)]*\))?(!)?: (.+)$/;
// Conventional Commits declares `BREAKING CHANGE:` and `BREAKING-CHANGE:` equivalent.
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE: ?(.*)$/m;
const RECORD = '\x1e';
const FIELD = '\x1f';
const NO_TAG_RE = /No names found|No tags can describe|cannot describe anything/i;

function lastTag(git, ref = 'HEAD') {
  try {
    const out = git(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', '--first-parent', ref]).trim();
    return out || null;
  } catch (err) {
    if (NO_TAG_RE.test(String(err.message || err))) return null;
    throw err;
  }
}

function parseCommit({ sha, subject, body = '' }) {
  const m = HEADER_RE.exec(subject);
  const footer = BREAKING_FOOTER_RE.exec(body);
  if (!m) {
    // An empty `BREAKING CHANGE:` footer (no description of its own) falls back to
    // the subject, exactly as the conventional path does for its header form (m[4]).
    return { sha, subject, type: null, scope: null, breaking: footer !== null, breakingNote: footer ? (footer[1].trim() || subject) : null, description: subject, unconventional: true };
  }
  const breaking = m[3] === '!' || footer !== null;
  const breakingNote = footer ? (footer[1].trim() || m[4]) : (breaking ? m[4] : null);
  return { sha, subject, type: m[1], scope: m[2] ? m[2].slice(1, -1) : null, breaking, breakingNote, description: m[4], unconventional: false };
}

function readCommits(git, tag, ref = 'HEAD') {
  const range = tag ? `${tag}..${ref}` : ref;
  const raw = git(['log', '--first-parent', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, range]);
  return raw.split(RECORD)
    .map((chunk) => chunk.replace(/^\n/, ''))
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
