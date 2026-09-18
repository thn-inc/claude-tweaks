'use strict';
// bin/lib/release-notes.js — renders the collected `Release-Note:` trailers
// of a set of parsed commits as a flat, headerless bullet list (#2581). Its
// only consumers today are release-local/commits.js (the footer pattern) and
// release-local/changelog.js (the renderer); it lives here rather than inside
// release-local/ so the pr-first post-publish step (#2582) can import the same
// two exports instead of restating them. No type-based grouping: Claude Code's
// own release notes are a flat list where the leading verb already carries the
// category (see #2581's Non-Goals).

// Single-match (`/m`, not `/g`) — the same shape as commits.js's own
// BREAKING_FOOTER_RE, and the same known limitation: a "commit" body that
// happens to embed more than one original commit's footers (a squash) only
// yields the first Release-Note: line. Out of scope to fix here (#2581's
// Gotchas).
const RELEASE_NOTE_FOOTER_RE = /^Release-Note: ?(.*)$/m;

// Pure. Filters to commits whose releaseNote is non-empty after trimming,
// renders one `* {note}` bullet per commit in input order, and returns null
// (never '' or undefined) when nothing qualifies — changelog.js branches on
// `!== null` to decide whether to render the ### Highlights block at all.
function renderReleaseNotes(commits) {
  const notes = commits
    .map((c) => (c.releaseNote || '').trim())
    .filter((note) => note !== '');
  return notes.length ? notes.map((note) => `* ${note}`).join('\n') : null;
}

module.exports = { renderReleaseNotes, RELEASE_NOTE_FOOTER_RE };
