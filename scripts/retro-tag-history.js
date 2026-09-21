#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveRetroTags } = require('./lib/retro-tag-resolve.js');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function iterBumpCommits() {
  // Deliberately re-requires the still-live module rather than vendoring its logic —
  // this script runs once, before Task 5 deletes status.js.
  return require(path.join(repoRoot, 'plugin/bin/lib/release/status.js')).iterBumpCommits({ git }, 'HEAD');
}

function findAllVersionCommits(version) {
  try {
    const out = git(['log', '--all', '--format=%H', `-S"version": "${version}"`, '--', 'plugin/.claude-plugin/plugin.json', '.claude-plugin/plugin.json']).trim();
    return out ? out.split('\n') : [];
  } catch { return []; }
}

function authorDate(sha) { return git(['show', '--no-patch', '--format=%aI', sha]).trim(); }

function parentVersion(sha) {
  try {
    const { manifestVersionAtRef } = require(path.join(repoRoot, 'plugin/bin/lib/manifest-path.js'));
    return manifestVersionAtRef({ git }, `${sha}^`);
  } catch { return null; }
}

function commitDate(sha) { return git(['show', '--no-patch', '--format=%aI', sha]).trim().slice(0, 10); }

function changelogSummary(version) {
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const m = new RegExp(`^## v${version.replace(/\./g, '\\.')} — (.+)$`, 'm').exec(changelog);
  if (!m) throw new Error(`no CHANGELOG heading for v${version} — cannot compose a tag message`);
  return m[1].trim();
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const tsvPath = path.join(repoRoot, 'docs/shipped-versions.tsv');
  const tsvLines = fs.readFileSync(tsvPath, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [version, date, source] = l.split('\t'); return { version, date, source }; });

  const { resolved, tombstones, collisions, unresolved } = resolveRetroTags(
    { iterBumpCommits, findAllVersionCommits, authorDate, parentVersion },
    { tsvLines },
  );

  if (unresolved.length > 0) {
    console.error(`ABORT: ${unresolved.length} tsv line(s) could not be resolved automatically — no tags created:`);
    for (const u of unresolved) console.error(`  ${u.version}: candidates ${u.candidates.join(', ')}`);
    console.error('Resolve by hand (add an explicit case to resolveRetroTags or its caller) and retry.');
    return 1;
  }

  console.log(`Resolved: ${resolved.length} clean, ${collisions.length} collisions (later-commit rule), ${tombstones.length} tombstones (excluded, never committed):`);
  for (const t of tombstones) console.log(`  EXCLUDED v${t.version}: ${t.reason}`);
  for (const c of collisions) console.log(`  COLLISION v${c.version}: chose ${c.chosen.slice(0, 10)} of [${c.candidates.map((s) => s.slice(0, 10)).join(', ')}] (${c.reason})`);

  const toTag = [...resolved, ...collisions.map((c) => ({ version: c.version, sha: c.chosen, date: commitDate(c.chosen) }))];
  console.log(`\n${toTag.length} tags to create (${tsvLines.length} tsv lines − ${tombstones.length} tombstones):`);

  for (const t of toTag) {
    const summary = changelogSummary(t.version);
    const tagName = `v${t.version}`;
    console.log(`  ${tagName} @ ${t.sha.slice(0, 10)} (${t.date}) — ${summary}`);
    if (!dryRun) {
      execFileSync('git', ['tag', '-a', tagName, t.sha, '-m', `${tagName} — ${summary}`], {
        cwd: repoRoot,
        env: { ...process.env, GIT_COMMITTER_DATE: t.date },
      });
    }
  }

  if (dryRun) { console.log('\n[dry-run] no tags created, nothing pushed'); return 0; }

  execFileSync('git', ['push', 'origin', '--tags'], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`\nPushed ${toTag.length} tags to origin.`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
