'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

// #421: /flow's materialize step (and the shared resolution algorithm it
// defers to) adopted an inherited $PIPELINE_RUN_DIR on existence alone — no
// check that the path actually resolves under the main checkout. #389
// observed this live: a dispatch-created worktree's /flow invocation ended up
// with its run directory trapped inside that worktree, where a later
// `git worktree remove` would have silently destroyed decisions.md/config.yml
// /staged/ with no git history to recover ([IL-127]). This test executes the
// *actual* documented resolution snippet (extracted verbatim from
// skills/_shared/run-dir-resolution.md's "Bash snippet (resolution)" section —
// moved there from pipeline-run-dir.md at #2019, alongside the Resolution
// order it implements — not a reimplementation, so a future edit that
// silently drops the anchoring check breaks this test) against a real temp
// git repo + linked worktree.

const ROOT = path.join(__dirname, '..');
const SHARED_DOC = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', '_shared', 'run-dir-resolution.md'),
  'utf8',
);
const WRAP_UP_SKILL = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'SKILL.md'),
  'utf8',
);

function extractSnippet() {
  const section = SHARED_DOC.match(
    /## Bash snippet \(resolution\)\n\n```bash\n([\s\S]*?)\n```/,
  );
  assert.ok(section, 'skills/_shared/run-dir-resolution.md must have a "## Bash snippet (resolution)" fenced bash block — extraction pattern is out of sync with the doc');
  return section[1];
}

// wrap-up/SKILL.md carries its own copy of the resolution snippet rather than
// deferring to the shared file (it needs to also stamp run-state.json at
// creation) — #421 fixed the shared snippet's adoption-time anchoring but
// never touched this copy, so it silently adopted a worktree-trapped
// $PIPELINE_RUN_DIR. Extracted verbatim, same reasoning as extractSnippet()
// above: a future edit that drops the anchoring check breaks this test.
function extractWrapUpSnippet() {
  const section = WRAP_UP_SKILL.match(
    /### Establish the run directory \(unconditional\)[\s\S]*?```bash\n([\s\S]*?)\n```/,
  );
  assert.ok(section, 'skills/wrap-up/SKILL.md must have a "### Establish the run directory (unconditional)" section with a fenced bash block — extraction pattern is out of sync with the doc');
  return section[1];
}

function runResolutionWith(snippet, { cwd, runDirEnv, specSlug }) {
  const script = `${snippet}\nprintf 'RESOLVED:%s\\n' "$RUN_DIR"`;
  const out = execFileSync('bash', ['-c', script], {
    cwd,
    env: {
      ...process.env,
      // wrap-up/SKILL.md's snippet now shells out to
      // `node bin/hooks.js resolve-run-dir` (#692) — CLAUDE_PLUGIN_ROOT must
      // point at THIS repo's plugin payload root (`plugin/`, where bin/hooks.js
      // lives), independent of `cwd` above (a temp fixture repo). Guarded so a
      // real value is never clobbered.
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || path.join(ROOT, 'plugin'),
      PIPELINE_RUN_DIR: runDirEnv || '',
      SPEC_SLUG: specSlug || 'no-match-xyz',
      MODE: '',
      STANDALONE_SKILL: '',
    },
    timeout: 30000,
  }).toString('utf8');
  const line = out.split('\n').find((l) => l.startsWith('RESOLVED:'));
  assert.ok(line, `resolution script produced no RESOLVED: line — full output:\n${out}`);
  return line.slice('RESOLVED:'.length);
}

const SNIPPETS = [
  { label: 'shared run-dir-resolution.md snippet', extract: extractSnippet },
  { label: "wrap-up/SKILL.md's own copy", extract: extractWrapUpSnippet },
];

for (const { label, extract } of SNIPPETS) {
  test(`adoption anchoring (${label}): an inherited PIPELINE_RUN_DIR trapped inside a linked worktree is rejected, not adopted`, () => {
    const main = gitRepo();
    const wt = linkedWorktreeOf(main);

    // Simulate the #389 shape: a run directory that exists, but lives inside
    // the worktree instead of the main checkout.
    const trapped = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-999');
    fs.mkdirSync(trapped, { recursive: true });

    const resolved = runResolutionWith(extract(), { cwd: wt, runDirEnv: trapped, specSlug: 'record-999' });

    assert.notStrictEqual(
      resolved,
      trapped,
      'the trapped-in-worktree directory must never be adopted as RUN_DIR — this is the exact #389 failure shape',
    );
    // Both snippets must reject the trapped path, but their fallback shapes
    // differ by design: the shared snippet only creates a standalone dir when
    // MODE=auto (unset here, so it falls through to empty/interactive);
    // wrap-up/SKILL.md's copy creates one unconditionally ("Every wrap-up run
    // has a run directory from Phase 1 on"). Either way, whatever it resolves
    // to must never live inside the worktree.
    if (resolved !== '') {
      assert.ok(
        resolved.startsWith(main + path.sep) || resolved === main,
        `resolved RUN_DIR must be anchored under the main checkout (${main}), not the worktree — got: ${resolved}`,
      );
    }
  });

  test(`adoption anchoring (${label}): an inherited PIPELINE_RUN_DIR correctly anchored to the main checkout is still adopted`, () => {
    const main = gitRepo();
    const wt = linkedWorktreeOf(main);

    const anchored = path.join(main, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-421');
    fs.mkdirSync(anchored, { recursive: true });

    // Invoked from inside the worktree (the dispatch shape) — the anchoring
    // check must still accept a value that is legitimately under $RUN_ROOT.
    const resolved = runResolutionWith(extract(), { cwd: wt, runDirEnv: anchored, specSlug: 'record-421' });

    assert.strictEqual(
      resolved,
      anchored,
      'a PIPELINE_RUN_DIR that genuinely resolves under the main checkout must still be adopted — anchoring must not become a false-positive rejection',
    );
  });
}
