'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFrontmatterListField } = require('../health-core/frontmatter-list');

// Parses a doc's `files:` frontmatter list (repo-relative dependency
// paths) — reuses journey docs' existing `files:` field/shape (see
// journeys/journey-template.md's regression-detection use) rather than
// introducing a competing field name for a near-identical concept.
// Returns [] when absent or the doc has no frontmatter at all. Thin wrapper
// over the shared parser (bin/lib/health-core/frontmatter-list.js), which
// also backs harness-health/scope.js's parseRulePaths and journey-health/
// scope.js's parseJourneyFiles — same bullet-list shape, different
// frontmatter key.
function parseFilesField(content) {
  return parseFrontmatterListField(content, 'files');
}

// relPaths (repo-relative, already confirmed to exist) -> { [relPath]:
// lastChangedMs }. A single batched `git log --name-only` walk instead of one
// `git log -1` subprocess per path — every path's lookup is independent of
// the others, so N sequential process forks for N paths (each with its own
// 30s timeout) was pure waste for a doc with many tracked dependencies.
// Commits are listed newest-first, so the first time a path is seen in the
// name-only output is its most recent change — git's own pathspec filtering
// (the trailing `--`) already restricts both which commits appear AND which
// filenames are printed to just the given relPaths, so no manual filtering
// is needed here. Entries absent from the returned map (git unavailable, no
// history) are treated as "never changed" by the caller, same as before.
function gitLastChangedMap(root, relPaths) {
  const result = {};
  if (!relPaths || relPaths.length === 0) return result;
  try {
    const out = execFileSync(
      'git',
      ['-C', root, 'log', '--format=%x00%ct', '--name-only', '--', ...relPaths],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true },
    );
    let currentTimestampMs = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('\0')) {
        currentTimestampMs = parseInt(line.slice(1), 10) * 1000;
        continue;
      }
      const relPath = line.trim();
      if (!relPath || currentTimestampMs === null) continue;
      // First occurrence wins (newest commit first) — a later, older commit
      // touching the same path must never overwrite it.
      if (!(relPath in result)) result[relPath] = currentTimestampMs;
    }
  } catch {
    // git unavailable — result stays empty, every path treated as "never
    // changed" by the caller, matching the prior per-path try/catch.
  }
  return result;
}

// For each files: dependency: does it exist (missing = its own staleness
// signal), and has it changed more recently than sinceTimestamp (the
// doc's last-audit cursor, epoch ms, or null if never audited — nothing
// is flagged stale against a null baseline)? Mechanical signal only — the
// JUDGE step in docs-health/SKILL.md decides whether a flagged change is
// substantive enough to matter.
function checkTrackedFreshness(content, root, sinceTimestamp) {
  const files = parseFilesField(content);
  const missing = [];
  const existing = [];
  for (const relPath of files) {
    if (fs.existsSync(path.join(root, relPath))) {
      existing.push(relPath);
    } else {
      missing.push(relPath);
    }
  }

  const stale = [];
  const lastChangedByPath = gitLastChangedMap(root, existing);
  for (const relPath of existing) {
    const lastChangedMs = relPath in lastChangedByPath ? lastChangedByPath[relPath] : null;
    if (lastChangedMs !== null && sinceTimestamp !== null && lastChangedMs > sinceTimestamp) {
      stale.push({ path: relPath, lastChangedMs });
    }
  }
  return { stale, missing };
}

module.exports = { parseFilesField, checkTrackedFreshness, gitLastChangedMap };
