'use strict';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function resolveRetroTags(deps, { tsvLines, overrides = {} }) {
  const byVersion = new Map();
  for (const b of deps.iterBumpCommits()) {
    if (!byVersion.has(b.version)) byVersion.set(b.version, []);
    byVersion.get(b.version).push(b.sha);
  }

  const resolved = [];
  const excluded = [];
  const unresolved = [];

  for (const line of tsvLines) {
    const override = overrides[line.version];
    if (override) {
      if (override.action === 'use') {
        resolved.push({ version: line.version, sha: override.sha, date: line.date, source: line.source, reason: override.reason });
      } else if (override.action === 'exclude') {
        excluded.push({ version: line.version, reason: override.reason });
      } else {
        throw new Error(`unknown override action for ${line.version}: ${override.action}`);
      }
      continue;
    }

    if (!SEMVER_RE.test(line.version)) {
      excluded.push({ version: line.version, reason: `non-standard version string "${line.version}" (not strict X.Y.Z) — not independently taggable under this project's vX.Y.Z convention` });
      continue;
    }

    if (line.source === 'wip-never-shipped') {
      excluded.push({ version: line.version, reason: `tsv source is wip-never-shipped — documented as never having reached main's tip, regardless of any candidate commit found` });
      continue;
    }

    const candidates = byVersion.get(line.version) || [];
    if (candidates.length === 1) {
      resolved.push({ version: line.version, sha: candidates[0], date: line.date, source: line.source });
      continue;
    }
    if (candidates.length === 0) {
      const hits = deps.findAllVersionCommits(line.version);
      if (hits.length === 0) {
        excluded.push({ version: line.version, reason: `no commit anywhere in history ever set the manifest to "version": "${line.version}" (exhaustive git log --all -S search) — a documented-but-never-committed reservation` });
      } else {
        unresolved.push({ version: line.version, candidates: hits });
      }
      continue;
    }
    // 2+ real candidates, no override: never auto-pick. Validated live against this
    // repo's own history that "pick the later commit" is wrong 6 times out of 11 —
    // an unresolved-without-override outcome is the only safe default.
    unresolved.push({ version: line.version, candidates });
  }

  return { resolved, excluded, unresolved };
}

module.exports = { resolveRetroTags };
