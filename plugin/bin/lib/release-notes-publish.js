'use strict';
// bin/lib/release-notes-publish.js — the pr-first post-publish step (#2582).
// release-please has no knowledge of this repo's custom `Release-Note:`
// trailer, so it never renders a Highlights block. This module runs after a
// release is published (triggered by the `release: published` event in
// .github/workflows/mirror-marketplace.yml), walks the just-published
// commit range, extracts `Release-Note:` footers, renders them via the
// shared release-notes.js module (the local-merge sub-issue's deliverable,
// #2581), and applies the rendered block to both the already-published
// GitHub Release body and the just-written CHANGELOG.md entry. Mirrors
// release-local/changelog.js's own Highlights rendering, applied post-hoc
// instead of at render time, since release-please's generated output never
// includes it. run(argv, deps) per .claude/skills/gh-api-module-pattern's
// CLI wrapper contract.
//
//   node plugin/bin/release-notes-publish.js
//
// Exit codes: 0 applied, partially applied, or no-op (nothing to do —
// fewer than 2 published releases, zero Release-Note: trailers in range, or
// both targets already carry the exact rendered block); 1 a gh/git call
// failed.

const { renderReleaseNotes, RELEASE_NOTE_FOOTER_RE } = require('./release-notes');

const HIGHLIGHTS_HEADING = '### Highlights';
const FIELD = '\x1f';
const RECORD = '\x1e';
// release-please's own heading forms (`## [x](…) (date)` / `## x (date)`)
// and this repo's legacy `## vX.Y.Z — …` form both start with `## ` — a
// single prefix check covers every heading shape CHANGELOG.md uses.
const HEADING_RE = /^##[ \t]/m;

// Resolve the previous/new tag pair from `gh release list`'s two
// most-recently-published entries, ordered by `publishedAt` — the
// just-published release is the newest by publish time, not by semver or
// tag-creation order. Fewer than 2 entries (the first-ever published
// release) has no previous tag to range from — a no-op, signalled as
// `null`, identical to the zero-trailers no-op (AC3).
function resolveTagPair(releases) {
  if (!Array.isArray(releases) || releases.length < 2) return null;
  const sorted = [...releases].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { previous: sorted[1].tagName, current: sorted[0].tagName };
}

// Parse `git log --first-parent --format=%H{FIELD}%B{RECORD}` output into
// {sha, releaseNote} records — the shape renderReleaseNotes expects.
// RELEASE_NOTE_FOOTER_RE is imported from release-notes.js, never a second
// hand-typed copy of the pattern (AC7).
function parseReleaseNotesFromLog(raw) {
  return String(raw || '').split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [sha, body = ''] = chunk.split(FIELD);
      const m = RELEASE_NOTE_FOOTER_RE.exec(body);
      return { sha: (sha || '').trim(), releaseNote: m ? m[1].trim() : null };
    });
}

function containsBlock(text, block) {
  return typeof text === 'string' && text.includes(block);
}

// Append `### Highlights\n{block}` to a GitHub Release body. Returns `null`
// when there is nothing to apply (no block) or the body already contains
// the exact rendered block (idempotency — AC4), otherwise the new body
// text. Never replaces existing content (AC1) — `gh release edit` has no
// append primitive, so the caller fetches the current body first and writes
// the concatenation back (Gotchas: a bare `--notes` call would destroy the
// release-please-generated body).
function applyToReleaseBody(currentBody, block) {
  if (block === null) return null;
  if (containsBlock(currentBody, block)) return null;
  const base = (currentBody || '').replace(/\s*$/, '');
  return `${base}\n\n${HIGHLIGHTS_HEADING}\n${block}`;
}

// Locate the first `## ` heading's entry — release-please always prepends
// its newest entry at the top (AC9) — and append `### Highlights\n{block}`
// to the end of that entry, before the next `## ` heading or end of file.
// Returns `null` when there is nothing to apply, no first entry is found,
// or that entry already contains the exact rendered block (AC4).
function applyToChangelogEntry(changelog, block) {
  if (block === null || typeof changelog !== 'string') return null;
  const firstAt = changelog.search(HEADING_RE);
  if (firstAt === -1) return null;
  const rest = changelog.slice(firstAt + 1);
  const nextRel = rest.search(HEADING_RE);
  const entryEnd = nextRel === -1 ? changelog.length : firstAt + 1 + nextRel;
  const entry = changelog.slice(firstAt, entryEnd);
  if (containsBlock(entry, block)) return null;
  const trimmedEntry = entry.replace(/\s*$/, '');
  // Two trailing newlines — not one — preserve the blank-line separator
  // CHANGELOG.md's own entries already use ahead of the next `## ` heading
  // (or, at end of file, a single trailing newline reads fine either way).
  const newEntry = `${trimmedEntry}\n\n${HIGHLIGHTS_HEADING}\n${block}\n\n`;
  return `${changelog.slice(0, firstAt)}${newEntry}${changelog.slice(entryEnd)}`;
}

function run(argv, deps) {
  try {
    const releases = JSON.parse(deps.gh(['release', 'list', '--json', 'tagName,publishedAt', '--limit', '2']));
    const pair = resolveTagPair(releases);
    if (!pair) {
      deps.stdout('release-notes-publish: fewer than 2 published releases — no-op\n');
      return 0;
    }

    const raw = deps.git(['log', '--first-parent', `--format=%H${FIELD}%B${RECORD}`, `${pair.previous}..${pair.current}`]);
    const commits = parseReleaseNotesFromLog(raw);
    const block = renderReleaseNotes(commits);
    if (block === null) {
      deps.stdout(`release-notes-publish: no Release-Note: trailers between ${pair.previous} and ${pair.current} — no-op\n`);
      return 0;
    }

    const currentBody = deps.gh(['release', 'view', pair.current, '--json', 'body', '-q', '.body']);
    const newBody = applyToReleaseBody(currentBody, block);
    if (newBody !== null) {
      deps.gh(['release', 'edit', pair.current, '--notes-file', '-'], newBody);
      deps.stdout(`release-notes-publish: appended Highlights to the ${pair.current} release body\n`);
    } else {
      deps.stdout(`release-notes-publish: ${pair.current} release body already carries the rendered block — skipped\n`);
    }

    const changelog = deps.readFile('CHANGELOG.md');
    const newChangelog = applyToChangelogEntry(changelog, block);
    if (newChangelog !== null) {
      deps.writeFile('CHANGELOG.md', newChangelog);
      deps.git(['add', 'CHANGELOG.md']);
      deps.git(['commit', '-m', `docs(changelog): append Highlights for ${pair.current}`]);
      deps.git(['push']);
      deps.stdout(`release-notes-publish: committed Highlights into CHANGELOG.md for ${pair.current}\n`);
    } else {
      deps.stdout('release-notes-publish: CHANGELOG.md already carries the rendered block (or no entry found) — skipped\n');
    }

    return 0;
  } catch (err) {
    deps.stderr(`release-notes-publish: ${String((err && err.message) || err)}\n`);
    return 1;
  }
}

module.exports = { run, resolveTagPair, parseReleaseNotesFromLog, applyToReleaseBody, applyToChangelogEntry, HIGHLIGHTS_HEADING };
