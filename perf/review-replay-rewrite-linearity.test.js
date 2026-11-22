// Review-replay prompt-rewrite scan linearity budget (#5991) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// tools/review-replay/reviews-rewrite.js scans archived prompts of unbounded length with
// several regexes. This pins each as linear on a long hex run, a long path and a long
// whitespace run. Lives outside tests/ because a wall-clock assertion flakes under
// sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const rw = require('../tools/review-replay/reviews-rewrite');

const mainRoot = '/m/Code Workspaces/repo';
const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

test('reviews-rewrite scans stay linear on adversarial input', () => {
  const hex = 'a'.repeat(200000);
  const start = performance.now();
  rw.rewriteShas(hex, { [sha]: sha });
  rw.rangeOf(`${hex}...${hex}`);
  rw.originRefsOf(`origin/${hex}`);
  rw.runInputsOf(`${mainRoot}/.claude-tweaks/pipelines/R/${hex}`, { mainRoot, runName: 'R' });
  rw.unrewrittenPaths(`${mainRoot}/`.repeat(20000), { mainRoot, runName: 'R', outDir: '/out' });
  rw.unrewrittenPaths(`${mainRoot}${'.'.repeat(200000)}x`, { mainRoot, runName: 'R', outDir: '/out' });
  rw.rewriteText(`${mainRoot}${'.'.repeat(200000)}x`, { mainRoot, runName: 'R', repoPath: '/r', replacements: {}, shaMap: {} });
  rw.unrewrittenPaths(`${mainRoot}${'a'.repeat(200000)}`, { mainRoot, runName: 'R', outDir: '/out' });
  rw.unrewrittenPaths(`${mainRoot}/${'.'.repeat(200000)}x`, { mainRoot, runName: 'R', outDir: `${mainRoot}/out` });
  rw.runInputsOf(`${mainRoot}/.claude-tweaks/pipelines/R/work/${'.'.repeat(200000)}x`, { mainRoot, runName: 'R' });
  rw.stripEffortLines(`[Effort: high — x]${' '.repeat(200000)}y`);
  // The single-pass rewrite and the outDir span walk (fix round 4).
  const rp = `${mainRoot}/out/repos/k/repo`;
  const ctx = `${mainRoot}/.claude-tweaks/pipelines/R/review-ctx/context.md`;
  rw.rewriteText(`${mainRoot}/.claude/worktrees/w ${sha} ${ctx} ${mainRoot} `.repeat(20000),
    { mainRoot, runName: 'R', repoPath: rp, replacements: { [ctx]: `${rp}/ctx.md` }, shaMap: { [sha]: sha } });
  rw.rewriteText(`${mainRoot}/.claude/worktrees/${'.'.repeat(200000)}`, { mainRoot, runName: 'R', repoPath: rp, replacements: {}, shaMap: {} });
  rw.unrewrittenPaths(`${mainRoot}/out/x `.repeat(40000), { mainRoot, runName: 'R', outDir: `${mainRoot}/out` });
  rw.unrewrittenPaths(`${mainRoot}/out/${'a'.repeat(200000)},${mainRoot}/src`, { mainRoot, runName: 'R', outDir: `${mainRoot}/out` });
  // The widened outDir span, its `..` check, and the root-independent absolute-path scan (whole-branch fix wave).
  rw.unrewrittenPaths(`${mainRoot}/out/${'é[@~='.repeat(40000)}`, { mainRoot, runName: 'R', outDir: `${mainRoot}/out` });
  rw.unrewrittenPaths(`${mainRoot}/out/${'../'.repeat(60000)}`, { mainRoot, runName: 'R', outDir: `${mainRoot}/out` });
  const other = { mainRoot: '/Volumes/backup/repo', runName: 'R', outDir: '/out' };
  rw.unrewrittenPaths('/a/.claude/worktrees/'.repeat(10000), other);
  rw.unrewrittenPaths(`/x ${'a/.claude-tweaks/pipelines/ '.repeat(8000)}`, other);
  rw.unrewrittenPaths(`/out/${'/.claude/worktrees/'.repeat(10000)}`, other);
  rw.unrewrittenPaths('/'.repeat(200000), other);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `scans took ${elapsed.toFixed(0)}ms — a regex here must not backtrack`);
});
