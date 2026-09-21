'use strict';

function resolveRetroTags(deps, { tsvLines }) {
  const byVersion = new Map();
  for (const b of deps.iterBumpCommits()) {
    if (!byVersion.has(b.version)) byVersion.set(b.version, []);
    byVersion.get(b.version).push(b.sha);
  }

  const resolved = [];
  const tombstones = [];
  const collisions = [];
  const unresolved = [];

  for (const line of tsvLines) {
    const candidates = byVersion.get(line.version) || [];
    if (candidates.length === 1) {
      resolved.push({ version: line.version, sha: candidates[0], date: line.date, source: line.source });
      continue;
    }
    if (candidates.length === 0) {
      const hits = deps.findAllVersionCommits(line.version);
      if (hits.length === 0) {
        tombstones.push({ version: line.version, reason: `no commit anywhere in history ever set the manifest to "version": "${line.version}" (exhaustive git log --all -S search) — a documented-but-never-committed reservation` });
      } else {
        unresolved.push({ version: line.version, candidates: hits });
      }
      continue;
    }
    if (candidates.length === 2) {
      const dated = candidates.map((sha) => ({ sha, date: deps.authorDate(sha) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      if (dated[0].date === dated[1].date) { unresolved.push({ version: line.version, candidates }); continue; }
      const parentVersion = deps.parentVersion(candidates[0]) || deps.parentVersion(candidates[1]);
      collisions.push({
        version: line.version,
        candidates,
        chosen: dated[0].sha,
        reason: `later of two candidates sharing parent version ${parentVersion}; verify against the CHANGELOG v${line.version} entry before applying`,
      });
      continue;
    }
    unresolved.push({ version: line.version, candidates });
  }

  return { resolved, tombstones, collisions, unresolved };
}

module.exports = { resolveRetroTags };
