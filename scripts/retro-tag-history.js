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

function commitDate(sha) { return git(['show', '--no-patch', '--format=%aI', sha]).trim().slice(0, 10); }

// Every entry below is a real, cited finding — see this task's own prose above and
// .superpowers/sdd/2026-09-21-record-2259-release-process-migration/task-2-report.md.
// Ten real collisions; v6.64.3 (wip-never-shipped) and the two 4.5.0-phase* lines need
// no entry here — resolveRetroTags excludes them on its own (source column / non-semver).
const OVERRIDES = {
  '5.5.0': { action: 'use', sha: '878dc0dec7d8ef055034acd495271d61d4160ea8', reason: 'CHANGELOG v5.5.0 heading is a verbatim match for this commit\'s subject ("Document generic issue ingestion across consumers"); the other candidate\'s content shipped as v5.6.0 per the reconciling merge 9aed4f47e\'s own message' },
  '6.19.0': { action: 'use', sha: '756b03478f24929a47cfd4808cfe2eeacda31b2d', reason: 'first-parent mainline side of the merge into v6.20.0; CHANGELOG body matches ("Shared record-staleness threshold + bucket predicates")' },
  '6.24.0': { action: 'use', sha: '701ce72d5857009e5f9ec2c9b2af8517bbb76b2b', reason: 'CHANGELOG v6.24.0 explicitly narrates: "This number shipped twice ... before returning to 6.24.0 on 2026-08-02"' },
  '6.34.0': { action: 'use', sha: '4a8441be7fe7ff34ba8e486069e2517e837dbab3', reason: 'CHANGELOG heading/body ("Skill-bloat reduction Phase 2: the Relationship table leaves the payload") matches this commit\'s content exactly' },
  '6.39.0': { action: 'use', sha: 'a6eaa653fcb941f95bdb513fc49996409e5b9193', reason: 'CHANGELOG heading "Routines report which build they resolved (closes #129)" matches this commit almost verbatim' },
  '6.39.2': { action: 'use', sha: '0881abf54d5f02cc32b11140411d1b9944c924b3', reason: 'CHANGELOG heading "One broken journey no longer pins journey-health\'s rotation (closes #131)" matches this commit\'s own subject ("renumber the journey-health Phase 0 fix to 6.39.2"); the other candidate\'s content shipped as v6.39.3 per its own successor merge 17e3d10de5' },
  '6.52.0': { action: 'use', sha: '18677cb88d5a5c7d037e7627db36b21d9231df32', reason: 'CHANGELOG v6.52.0 is entirely about "Impeccable\'s own doctor findings reach /tidy", matching this commit; the other candidate\'s content shipped as v6.53.0 per the reconciling merge 7346175de2\'s own "renumber to 6.53.0" message' },
  '6.56.0': { action: 'use', sha: '75d9f8ee5060482993ee76c23ce76d8474cca89f', reason: 'CHANGELOG v6.56.0 body matches this commit exactly (closes #148); the other candidate\'s content is separately, correctly captured as v6.57.0' },
  '6.64.1': { action: 'use', sha: 'f383e4480aab1fa69084f59f9dcd7bc1ef249004', reason: 'diff adds skills/routine/record-freshness.md and compareRoutineRecords/readRoutineRecordsAtRef, an exact match for the CHANGELOG v6.64.1 entry; branch name worktree-routine-record-freshness-190 literally encodes the entry\'s own #190 reference' },
  '6.94.0': { action: 'use', sha: '61df3e44aafcefa6e5c0969822f7ddfb1a0de8c0', reason: 'CHANGELOG v6.94.0 heading is a verbatim match for this commit\'s own subject; the other candidate is a later, unrelated worktree\'s "merge origin/main" that incidentally inherited the already-published state (confirmed: this commit is an ancestor of the other candidate)' },
};

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

  const { resolved, excluded, unresolved } = resolveRetroTags(
    { iterBumpCommits, findAllVersionCommits },
    { tsvLines, overrides: OVERRIDES },
  );

  if (unresolved.length > 0) {
    console.error(`ABORT: ${unresolved.length} tsv line(s) could not be resolved automatically — no tags created:`);
    for (const u of unresolved) console.error(`  ${u.version}: candidates ${u.candidates.join(', ')}`);
    console.error('Add an explicit override to the OVERRIDES map above (with cited evidence) and retry — never guess.');
    return 1;
  }

  console.log(`Resolved: ${resolved.length} (${Object.keys(OVERRIDES).length} via override), ${excluded.length} excluded:`);
  for (const e of excluded) console.log(`  EXCLUDED v${e.version}: ${e.reason}`);

  console.log(`\n${resolved.length} tags to create (${tsvLines.length} tsv lines − ${excluded.length} excluded):`);
  for (const t of resolved) {
    const summary = changelogSummary(t.version);
    const tagName = `v${t.version}`;
    const date = t.date || commitDate(t.sha);
    console.log(`  ${tagName} @ ${t.sha.slice(0, 10)} (${date}) — ${summary}${t.reason ? ` [override: ${t.reason}]` : ''}`);
    if (!dryRun) {
      execFileSync('git', ['tag', '-a', tagName, t.sha, '-m', `${tagName} — ${summary}`], {
        cwd: repoRoot,
        env: { ...process.env, GIT_COMMITTER_DATE: date },
      });
    }
  }

  if (dryRun) { console.log('\n[dry-run] no tags created, nothing pushed'); return 0; }

  execFileSync('git', ['push', 'origin', '--tags'], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`\nPushed ${resolved.length} tags to origin.`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, OVERRIDES };
