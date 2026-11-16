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
// fewer than 2 published releases, no Release-Note: trailer left to render in
// range — none at all, or only "No user-visible change" ones — or both
// targets already carry the exact rendered block); 1 a gh/git call
// failed. A CHANGELOG trim (`changelog-max-releases`, #5563) never changes the
// exit code: any trim failure prints one line to stderr, the file is left
// untrimmed, and the run finishes as it would without the key. The trim rides
// the Highlights commit, or makes its own when there is no Highlights to write.

const { renderReleaseNotes, extractReleaseNotes } = require('./release-notes');
const { readChangelogMaxReleases } = require('./policy');
const { resolvePolicyKeys } = require('./policy-schema');
const { parseChangelogFooter, parseChangelogVersions } = require('./changelog');
const { prepareTrim, firstLine } = require('./changelog-release-trim');

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
// {sha, releaseNotes} records — the shape renderReleaseNotes expects.
// extractReleaseNotes is imported from release-notes.js, never a second
// hand-typed copy of the pattern (AC7); a bundled merge commit yields one note
// per bundled record (#4634).
function parseReleaseNotesFromLog(raw) {
  return String(raw || '').split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [sha, body = ''] = chunk.split(FIELD);
      return { sha: (sha || '').trim(), releaseNotes: extractReleaseNotes(body) };
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
  // A trimmed file ends in the "Older releases" footer: the newest entry stops at it, and the
  // footer is never an entry of its own (the shared footer helper, not a heading pattern here).
  const footer = parseChangelogFooter(changelog);
  if (footer && firstAt >= footer.index) return null;
  const rest = changelog.slice(firstAt + 1);
  const nextRel = rest.search(HEADING_RE);
  const headingEnd = nextRel === -1 ? changelog.length : firstAt + 1 + nextRel;
  const entryEnd = footer ? Math.min(headingEnd, footer.index) : headingEnd;
  const entry = changelog.slice(firstAt, entryEnd);
  if (containsBlock(entry, block)) return null;
  const trimmedEntry = entry.replace(/\s*$/, '');
  // Two trailing newlines — not one — preserve the blank-line separator
  // CHANGELOG.md's own entries already use ahead of the next `## ` heading
  // (or, at end of file, a single trailing newline reads fine either way).
  const newEntry = `${trimmedEntry}\n\n${HIGHLIGHTS_HEADING}\n${block}\n\n`;
  return `${changelog.slice(0, firstAt)}${newEntry}${changelog.slice(entryEnd)}`;
}

// The branch the trimmed commit must be reachable from: `integration-branch`, else the
// target of origin/HEAD, else the checked-out branch, else `main`. Called only when a trim
// needs the ancestor check (the key is above 0 and the file is over the bound).
function defaultBranch(deps, readPolicy) {
  const policyRaw = readPolicy();
  const resolved = resolvePolicyKeys(['integration-branch'], { policyRaw: typeof policyRaw === 'string' ? policyRaw : null })['integration-branch'];
  const named = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : '';
  if (named) return named;
  try {
    const head = deps.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, '');
    if (head) return head;
  } catch {
    // no origin/HEAD: fall through to the checked-out branch
  }
  try {
    const current = deps.git(['branch', '--show-current']).trim();
    if (current) return current;
  } catch {
    // unreadable: fall through to main
  }
  return 'main';
}

function commitAndPush(deps, text, subject, progress = {}) {
  deps.writeFile('CHANGELOG.md', text);
  progress.written = true;
  deps.git(['add', 'CHANGELOG.md']);
  deps.git(['commit', '-m', subject]);
  progress.committed = true;
  deps.git(['push']);
}

// The trim-only commit never fails the run: on any error it undoes what it did (the commit when
// one landed, then the file and the index), prints one line and reports false.
function commitTrimOnly(deps, text, original, subject) {
  const progress = { written: false, committed: false };
  try {
    commitAndPush(deps, text, subject, progress);
    return true;
  } catch (err) {
    // Same wording as release-local's restore: a restore that itself failed must not claim the
    // file was left untrimmed. A failure before the write has nothing to restore.
    let restored = true;
    try {
      if (progress.committed) deps.git(['reset', '--soft', 'HEAD~1']);
      if (progress.written) {
        deps.writeFile('CHANGELOG.md', original);
        deps.git(['add', 'CHANGELOG.md']);
      }
    } catch {
      restored = false;
    }
    deps.stderr(`changelog trim: failed (${firstLine((err && err.message) || err)}); ${restored ? 'file left untrimmed' : 'the restore also failed, CHANGELOG.md and the index may still hold the trimmed file'}\n`);
    return false;
  }
}

// The CHANGELOG half of the run: the Highlights entry (when there is a block) and the bounded
// trim (when `changelog-max-releases` is set), written, committed and pushed as one commit.
// With the key at 0 or absent this is the Highlights-only behavior, byte for byte. A trim
// failure prints one line and leaves the file as the Highlights step wrote it.
function publishChangelog(deps, { pair, block, key, readPolicy }) {
  let changelog = null;
  let highlighted = null;
  if (block !== null) {
    changelog = deps.readFile('CHANGELOG.md');
    highlighted = applyToChangelogEntry(changelog, block);
  }
  let trimmed = null;
  if (key.count > 0 || key.error != null) {
    try {
      // An unreadable policy is reported by prepareTrim before it touches the text.
      if (block === null && key.error == null) changelog = deps.readFile('CHANGELOG.md');
      const text = highlighted !== null ? highlighted : changelog;
      // Within the bound nothing would be removed: resolve no branch, make no git call.
      const withinBound = key.error == null && typeof text === 'string' && parseChangelogVersions(text).length <= key.count;
      if (!withinBound && (typeof changelog === 'string' || key.error != null)) {
        const branch = key.count > 0 ? defaultBranch(deps, readPolicy) : null;
        trimmed = prepareTrim({
          text,
          readPolicy,
          git: deps.git,
          ancestorRefs: branch === null ? [] : [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`],
          stderr: deps.stderr,
          trim: deps.trimChangelog,
        });
      }
    } catch (err) {
      deps.stderr(`changelog trim: failed (${firstLine((err && err.message) || err)}); file left untrimmed\n`);
    }
  }

  const finalText = trimmed ? trimmed.text : highlighted;
  if (finalText === null) {
    if (block !== null) deps.stdout('release-notes-publish: CHANGELOG.md already carries the rendered block (or no entry found) — skipped\n');
    return;
  }
  if (highlighted !== null) {
    commitAndPush(deps, finalText, `docs(changelog): append Highlights for ${pair.current}`);
  } else if (!commitTrimOnly(deps, finalText, changelog, `chore: trim CHANGELOG.md to the newest ${trimmed.count} releases`)) {
    return;
  }
  const trimNote = trimmed ? `trimmed to the newest ${trimmed.count} releases` : null;
  if (highlighted !== null) {
    deps.stdout(`release-notes-publish: committed Highlights into CHANGELOG.md for ${pair.current}${trimNote ? ` and ${trimNote}` : ''}\n`);
  } else {
    // The early-exit "no-op" line above already printed for a Highlights-free run: say the trim was committed.
    deps.stdout(`release-notes-publish: no Highlights to write; committed a trim of CHANGELOG.md to the newest ${trimmed.count} releases\n`);
  }
}

function run(argv, deps) {
  try {
    // Read once: the key read, the trim and the branch lookup all see the same answer.
    const rawPolicy = deps.readPolicy || (() => null);
    let memo = null;
    const readPolicy = () => {
      if (memo === null) {
        try { memo = { value: rawPolicy() }; } catch (err) { memo = { err }; }
      }
      if ('err' in memo) throw memo.err;
      return memo.value;
    };
    const key = readChangelogMaxReleases(readPolicy);
    const releases = JSON.parse(deps.gh(['release', 'list', '--json', 'tagName,publishedAt', '--limit', '2']));
    const pair = resolveTagPair(releases);
    if (!pair) {
      deps.stdout('release-notes-publish: fewer than 2 published releases — no-op\n');
      publishChangelog(deps, { pair, block: null, key, readPolicy });
      return 0;
    }

    const raw = deps.git(['log', '--first-parent', `--format=%H${FIELD}%B${RECORD}`, `${pair.previous}..${pair.current}`]);
    const commits = parseReleaseNotesFromLog(raw);
    const block = renderReleaseNotes(commits);
    if (block === null) {
      deps.stdout(`release-notes-publish: no Release-Note: trailers to render between ${pair.previous} and ${pair.current} — no-op\n`);
      publishChangelog(deps, { pair, block: null, key, readPolicy });
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

    publishChangelog(deps, { pair, block, key, readPolicy });
    return 0;
  } catch (err) {
    deps.stderr(`release-notes-publish: ${String((err && err.message) || err)}\n`);
    return 1;
  }
}

module.exports = { run, resolveTagPair, parseReleaseNotesFromLog, applyToReleaseBody, applyToChangelogEntry, HIGHLIGHTS_HEADING };
