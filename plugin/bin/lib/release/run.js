'use strict';
const { precheck } = require('./precheck.js');
const { unnamedRecordsGate } = require('./unnamed-records.js');
const { bumpManifest, stubChangelogEntry, RELEASE_FILES } = require('./compose.js');
const { mirrorRelease } = require('./mirror.js');

// Reused by bin/release-local.js (#2254): the branch/clean-tree guard, and the
// fetch → ancestry re-check → push ordering. `onDiverged` is the caller's own
// partial-state message (the commit/tag already exist locally — do NOT re-run).
function guardReleasableTree(deps, { branch = 'main' } = {}) {
  const current = deps.git(['branch', '--show-current']).trim();
  if (current !== branch) throw new Error(`releases run from ${branch}; current branch is "${current}"`);
  if (deps.git(['status', '--porcelain', '--untracked-files=no']).trim() !== '') {
    throw new Error('working tree has tracked modifications — commit or restore them first');
  }
}

// `remoteBranchExists: false` — the branch is not on origin yet (release-local's
// first release into a fresh remote, #2254): there is no origin/<branch> to fetch
// or compare against, so the fetch would die with "couldn't find remote ref" and
// the ancestry check would have nothing to check. Push straight out.
function pushAfterAncestryCheck(deps, { branch = 'main', refs = [branch], onDiverged, remoteBranchExists = true }) {
  if (!remoteBranchExists) { deps.git(['push', 'origin', ...refs]); return; }
  deps.git(['fetch', 'origin', branch]);
  try {
    deps.git(['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD']);
  } catch {
    throw new Error(onDiverged);
  }
  deps.git(['push', 'origin', ...refs]);
}

function runRelease(deps, { part, summary, date, dryRun, log, allowUnnamed = [] }) {
  guardReleasableTree(deps);

  const { candidate: version, result } = precheck(deps, part);
  if (!result.ok) {
    const lines = result.conflicts.map((c) => `  - ${c.source}: ${c.detail} claims v${c.version}`);
    throw new Error(`version collision on v${version}:\n${lines.join('\n')}\nSuggested renumber: v${result.suggested}. Resolve and re-run.`);
  }

  // Prevention companion to `status.js`'s post-merge detection (#678/#768): refuse to
  // bump while a merge since the last bump remains unnamed in the summary/CHANGELOG.
  // `--dry-run` reports rather than aborts (AC3) — a preview must not itself block on
  // a gap it exists to surface.
  const gate = unnamedRecordsGate(deps, { summary, allow: allowUnnamed });
  if (gate.unnamed.length > 0) {
    const list = gate.unnamed.map((n) => `#${n}`).join(', ');
    const since = gate.lastBump ? `v${gate.lastBump.version}` : '(no prior release)';
    const message = `unnamed merges since ${since}: ${list}\n` +
      'Name them in the summary, backfill CHANGELOG.md\'s newest entry, or pass --allow-unnamed <n,m> to override deliberately.';
    if (dryRun) log(`[dry-run] release gate: ${message}`);
    else throw new Error(`release gate: ${message}`);
  }

  const [manifestPath, changelogPath, shippedPath] = RELEASE_FILES;
  const newManifest = bumpManifest(deps.readFile(manifestPath), version);
  const newChangelog = stubChangelogEntry(deps.readFile(changelogPath), version, summary);

  if (dryRun) {
    log(`[dry-run] would bump ${manifestPath} to v${version}`);
    log(`[dry-run] would stub CHANGELOG heading "## v${version} — ${summary}"`);
    log(`[dry-run] would append "${version}\t${date}\trelease" to ${shippedPath}`);
    log('[dry-run] would commit the trio, verify ancestry, push origin main, and re-pin the marketplace at the release commit');
    return { version, pushed: false, mirrored: false };
  }

  deps.writeFile(manifestPath, newManifest);
  deps.writeFile(changelogPath, newChangelog);
  deps.appendShipped(deps.repoRoot, version, date);

  deps.git(['add', ...RELEASE_FILES]);
  const staged = deps.git(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean).sort();
  const expected = [...RELEASE_FILES].sort();
  if (JSON.stringify(staged) !== JSON.stringify(expected)) {
    throw new Error(`staged set is not exactly the release trio: ${staged.join(', ')}`);
  }
  const allowNote = gate.allowed.length > 0
    ? `\n\nallow-unnamed: ${gate.allowed.map((n) => `#${n}`).join(', ')}`
    : '';
  deps.git(['commit', '-m', `Release v${version} — ${summary}${allowNote}`]);
  // The marketplace pins the payload subdirectory at a commit, so the mirror needs
  // the release commit's sha — read after the commit lands, never before, or the
  // pin names the previous release. Reading it here rather than after the push is
  // deliberate: the push moves no local ref, so both points name the same commit,
  // and this keeps the value available even if the ancestry check aborts below.
  const releaseSha = deps.git(['rev-parse', 'HEAD']).trim();

  pushAfterAncestryCheck(deps, {
    onDiverged: 'origin/main moved between pre-check and push. The release commit already exists locally — ' +
      'do NOT re-run the full release (it would bump a second time). Recover manually: ' +
      'git pull --rebase origin main, then git push origin main, then retry the marketplace mirror alone.',
  });
  log(`pushed v${version} to origin/main`);

  const description = JSON.parse(newManifest).description;
  let changed;
  try {
    ({ changed } = mirrorRelease(deps, { version, description, sha: releaseSha, dryRun: false }));
  } catch (err) {
    throw new Error(`v${version} is pushed and released; only the marketplace mirror failed: ${err.message}\n` +
      'Do NOT re-run the full release (it would bump a second time) — retry just the mirror once the cause is fixed.');
  }
  log(changed ? 'marketplace mirrored' : 'marketplace already current');
  return { version, pushed: true, mirrored: changed };
}

module.exports = { runRelease, guardReleasableTree, pushAfterAncestryCheck };
