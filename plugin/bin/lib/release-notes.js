'use strict';
// bin/lib/release-notes.js — the shared `Release-Note:` trailer reader and the
// renderer of the collected notes as a flat, headerless bullet list (#2581).
// extractReleaseNotes is the one place the trailer pattern lives; its consumers
// are release-local/commits.js and release-notes-publish.js (the pr-first
// post-publish step, #2582), and the renderer's are release-local/changelog.js
// and release-notes-publish.js.
// It lives here rather than inside release-local/ so those consumers import the
// same exports instead of restating them. A bundled merge commit carries one
// `Release-Note:` line per bundled record (#4634), so the reader returns every
// line, not the first. No type-based grouping: Claude Code's own release notes
// are a flat list where the leading verb already carries the category (see
// #2581's Non-Goals).

// Module-internal and `/gm`: the global flag makes `String.prototype.matchAll`
// yield every line, and matchAll clones the regex so `lastIndex` never leaks
// between calls.
const RELEASE_NOTE_LINE_RE = /^Release-Note: ?(.*)$/gm;

// A note that says nothing a reader of the release notes needs (the
// "No user-visible change." filler every record must carry, #2660) is dropped
// at render time, not at extraction time — the commit still carries it.
const NO_CHANGE_RE = /^no user-visible change/i;

// Pure. Every `Release-Note:` line of a commit body, trimmed, empty ones
// dropped, in body order. A non-string body yields [].
function extractReleaseNotes(body) {
  if (typeof body !== 'string') return [];
  return Array.from(body.matchAll(RELEASE_NOTE_LINE_RE), (m) => m[1].trim()).filter((note) => note !== '');
}

// Pure. Flattens each commit's `releaseNotes` in commit order then note order,
// trims, drops empty notes, "No user-visible change" notes and exact duplicates
// (first occurrence kept), renders one `* {note}` bullet per remaining note,
// and returns null (never '' or undefined) when nothing remains — changelog.js
// branches on `!== null` to decide whether to render the ### Highlights block
// at all. A commit without a `releaseNotes` array contributes nothing.
function renderReleaseNotes(commits) {
  const seen = new Set();
  const notes = [];
  for (const c of commits) {
    if (!c || !Array.isArray(c.releaseNotes)) continue;
    for (const raw of c.releaseNotes) {
      const note = String(raw == null ? '' : raw).trim();
      if (note === '' || NO_CHANGE_RE.test(note) || seen.has(note)) continue;
      seen.add(note);
      notes.push(note);
    }
  }
  return notes.length ? notes.map((note) => `* ${note}`).join('\n') : null;
}

module.exports = { renderReleaseNotes, extractReleaseNotes };
