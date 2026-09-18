'use strict';
// bin/lib/release-notes.js — renders the collected `Release-Note:` trailers
// of a set of parsed commits as a flat, headerless bullet list (#2581). The
// single shared module both the local-merge changelog renderer
// (release-local/changelog.js) and the pr-first post-publish sub-issue
// import — the rendering logic and the `Release-Note:` footer pattern each
// exist exactly once. No type-based grouping: Claude Code's own release
// notes are a flat list where the leading verb already carries the
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
// `!= null` to decide whether to render the ### Highlights block at all.
function renderReleaseNotes(commits) {
  const lines = commits
    .filter((c) => c.releaseNote && c.releaseNote.trim())
    .map((c) => `* ${c.releaseNote.trim()}`);
  return lines.length ? lines.join('\n') : null;
}

module.exports = { renderReleaseNotes, RELEASE_NOTE_FOOTER_RE };
