'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { readText } = require('./helpers/read-skill');

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
// readText() normalizes CRLF -> LF: on a Windows checkout (core.autocrlf=true)
// the bare-\n extractor regexes below would otherwise match nothing.
const SHARED_DOC = readText(
  path.join(ROOT, 'plugin', 'skills', '_shared', 'run-dir-resolution.md'),
);
const WRAP_UP_SKILL = readText(
  path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'SKILL.md'),
);

function extractSnippet(text = SHARED_DOC) {
  const section = text.match(
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
function extractWrapUpSnippet(text = WRAP_UP_SKILL) {
  const section = text.match(
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

// #2870: the reference snippet's Step-2 `find | sort | tail` ranked a legacy
// dash-less name (20260911T…) above every canonical 2026-MM-DDT… run-id, so a
// stale directory was adopted forever. bin/lib/hooks/run-dir-resolve.js's
// newestMatch filters to canonical names; the snippet must agree with it.
test('step 2 (shared run-dir-resolution.md snippet): a non-canonical dir that string-sorts last is never adopted over a canonical match', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const canonical = path.join(pipelines, '2026-09-20T080000-backlog-standalone');
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(path.join(pipelines, '20260911T131119-backlog-standalone'), { recursive: true });

  const resolved = runResolutionWith(extractSnippet(), { cwd: main, specSlug: 'backlog-standalone' });

  // The step-2 path comes from `pwd` and is MSYS-form (/d/a/...) under Git Bash, so compare by directory name.
  assert.strictEqual(path.basename(resolved), path.basename(canonical));
});

// #3865: the snippet's Step-2 glob matched the slug as a substring, so spec-378
// adopted a newer ...-spec-3784 run dir. run-dir-resolve.js's hasSegment matches
// a whole `-`-delimited segment; the snippet must agree with it.
test('step 2 (shared run-dir-resolution.md snippet): spec-378 resolves its own run dir, never a newer spec-3784 or spec-3784-3790 one', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const own = path.join(pipelines, '2026-01-01T000000-spec-378');
  fs.mkdirSync(own, { recursive: true });
  fs.mkdirSync(path.join(pipelines, '2026-06-01T000000-spec-3784'), { recursive: true });
  fs.mkdirSync(path.join(pipelines, '2026-07-01T000000-spec-3784-3790'), { recursive: true });

  const resolved = runResolutionWith(extractSnippet(), { cwd: main, specSlug: 'spec-378' });

  assert.strictEqual(path.basename(resolved), path.basename(own));
});

test('step 2 (shared run-dir-resolution.md snippet): spec-378 with only spec-3784 run dirs resolves nothing, and a multi-spec spec-378-379 dir still matches', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(path.join(pipelines, '2026-06-01T000000-spec-3784'), { recursive: true });
  assert.strictEqual(runResolutionWith(extractSnippet(), { cwd: main, specSlug: 'spec-378' }), '');

  const multi = path.join(pipelines, '2026-03-01T000000-spec-378-379');
  fs.mkdirSync(multi, { recursive: true });
  assert.strictEqual(path.basename(runResolutionWith(extractSnippet(), { cwd: main, specSlug: 'spec-378' })), path.basename(multi));
});

// Pins that the read-plus-extract path survives a CRLF checkout: the docs are
// converted to CRLF, read back through readText(), and must yield the same
// snippets as the LF text.
test('CRLF control: both skill docs extract the same snippets after a CRLF round-trip through readText()', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-dir-crlf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cases = [
    { name: 'run-dir-resolution.md', lf: SHARED_DOC, extract: extractSnippet },
    { name: 'wrap-up-SKILL.md', lf: WRAP_UP_SKILL, extract: extractWrapUpSnippet },
  ];
  for (const { name, lf, extract } of cases) {
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.ok(crlf.includes('\r\n'), `${name}: CRLF build must contain \\r\\n`);
    assert.ok(!crlf.includes('\r\r\n'), `${name}: CRLF build must not contain \\r\\r\\n`);

    const file = path.join(tmp, name);
    fs.writeFileSync(file, crlf);
    const roundTripped = readText(file);

    assert.strictEqual(
      extract(roundTripped),
      extract(lf),
      `${name}: extractor must return the same snippet for the CRLF round-trip as for the LF text`,
    );
  }
});
