'use strict';
const fs = require('fs');
const path = require('path');
const { listDocs } = require('./scope');
const { toPosix, relativeDisplayId } = require('../shared-primitives');

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True when `needle` occurs in `content` as a whole path/filename token —
// not preceded by a character that would make it part of a LONGER path or
// filename (a letter, digit, '-', '_', '.', or '/'), and not followed by a
// letter/digit/'-'/'_' that would make it part of a longer filename. A bare
// substring check (e.g. `content.includes('config.md')`) also matches
// inside "db/config.md" or "sub/config.md" — a DIFFERENT doc that merely
// shares a basename. Anchoring on both sides rejects those false positives
// while still matching genuine markdown-link contexts ("(config.md)",
// "[x](config.md)", a leading quote, whitespace, or start-of-string).
function hasBoundedMatch(content, needle) {
  if (!needle) return false;
  const pattern = new RegExp(`(?<![A-Za-z0-9_./-])${escapeForRegExp(needle)}(?![A-Za-z0-9_-])`);
  return pattern.test(content);
}

// Counts how many files under docs/**, README.md, or CLAUDE.md — the
// actual places a human or agent would navigate from — mention this
// doc's filename. A mechanical, repo-scoped signal; the JUDGE step in
// docs-health/SKILL.md decides whether a near-zero count means a genuine
// orphan or an intentionally standalone doc. `pathImpl` feeds only the
// `referencedBy` display IDs (relativeDisplayId, always '/'); every fs path
// stays native.
function computeInboundReferences(docId, root, { pathImpl = path } = {}) {
  const docPath = path.join(root, 'docs', `${docId}.md`);
  // The docs-root-relative, path-qualified form of this doc's own path (e.g.
  // "api/config.md", or just "config.md" when docId has no subdirectory).
  const qualifiedPath = `${docId}.md`;
  // The repo-root-relative form (e.g. "docs/api/config.md", or
  // "docs/config.md") — how README.md/CLAUDE.md links typically spell it.
  const rootRelativePath = `docs/${docId}.md`;

  const candidates = [];
  const docsDir = path.join(root, 'docs');
  // scope.js's listDocs, with both exclusion filters off: findability needs
  // every candidate *referrer* file under docs/ (including
  // docs/superpowers/** and docs/journeys/**, which may legitimately link to
  // an audited doc even though they're never themselves audit targets), not
  // just the Diátaxis-portal subset listDocs(root) returns for its usual
  // scan-target callers.
  if (fs.existsSync(docsDir)) {
    candidates.push(...listDocs(root, { excludeTopLevelDirs: false, skipDotDirs: false }).map((d) => d.path));
  }
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) candidates.push(readme);
  const claudeMd = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) candidates.push(claudeMd);

  const referencedBy = [];
  for (const file of candidates) {
    if (path.resolve(file) === path.resolve(docPath)) continue;
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    // A bare basename substring check (e.g. "config.md") also matches
    // content that links to a DIFFERENT doc with the same filename in
    // another directory (e.g. "db/config.md".includes("config.md") is true
    // even though it never mentions docs/api/config.md at all) — and this
    // holds regardless of whether docId itself has a subdirectory, since a
    // top-level docId's qualifiedPath degenerates to the same bare basename
    // (e.g. "docs/sub/config.md" wrongly substring-matching top-level
    // docId "config"'s qualifiedPath "config.md"). Require every candidate
    // string to match as a path-boundary-anchored token instead of a raw
    // substring: this doc's docs-root-relative path, its repo-root-relative
    // path (the "docs/"-prefixed form README.md/CLAUDE.md links commonly
    // use), or the relative path an actual markdown link from THIS
    // candidate file's own directory would use (e.g. a sibling in the same
    // directory linking with a bare "config.md", or a nested doc linking
    // with "../config.md").
    const relFromCandidate = toPosix(path.relative(path.dirname(file), docPath));
    if (
      hasBoundedMatch(content, qualifiedPath) ||
      hasBoundedMatch(content, rootRelativePath) ||
      hasBoundedMatch(content, relFromCandidate)
    ) {
      referencedBy.push(relativeDisplayId(root, file, pathImpl));
    }
  }
  return { count: referencedBy.length, referencedBy };
}

module.exports = { computeInboundReferences };
