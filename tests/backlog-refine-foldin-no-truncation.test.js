'use strict';
// Binds backlog/refine-mode.md's Step 1 unsynced fold-in script (the fence
// that produces the merged faceted set) to execution: extract-and-run form
// (docs/skill-authoring.md, "Executable snippets in skill prose") — the doc
// is the only source of the executed text, so the doc and the probe cannot
// drift.
//
// Record #1403 (the refine-mode twin of #1388): the pre-fix script read
// `$ST_BACKLOG_REFINE_FACETED` (via `require()`) in the same shell command
// that redirected (`>`) its own stdout onto that same path. Shell
// redirection truncates the target file before the reading process ever
// opens it. The fix writes to a distinct path and `mv`s it into place after
// the `node -e` process exits — mirroring #1388's overview-mode.md fix,
// which tests/backlog-overview-foldin-no-truncation.test.js binds the same
// way.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

const DOC = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-mode.md');
// Forward slashes: the snippet interpolates ${CLAUDE_PLUGIN_ROOT} into a JS string literal
// inside `node -e "…"`, where a win32 backslash path would be read as escape sequences.
const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin').split(path.sep).join('/');

// The extracted fence is bash, so run it under bash explicitly — execSync's default shell is
// cmd.exe on win32, which has no `eval`. Skip, with a stated reason, when no bash is on PATH.
const SKIP_NO_BASH = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'bash not available';

// Anchored on the fence's own eval line — unique to the merge fence via the
// `_DATED=` token, which the first (unsynced-only) fence never carries.
// Captures through to (not including) the closing fence.
const FENCE_ANCHOR =
  /```bash\n(eval "\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" ST_BACKLOG_REFINE_UNSYNCED=backlog-refine-unsynced\.json ST_BACKLOG_REFINE_UNSYNCED_DATED=backlog-refine-unsynced-dated\.json[\s\S]*?)\n```/m;

function extractFoldInSnippet() {
  // LF-normalized: a core.autocrlf checkout reads fences as ```bash\r\n, and the \r
  // would also ride into the snippet bash executes.
  const doc = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const match = FENCE_ANCHOR.exec(doc);
  assert.ok(match, 'extraction pattern is out of sync with refine-mode.md — update this test');
  return match[1];
}

function seedSession(sessionId, { githubRecord, unsyncedRecord }) {
  const sessionDir = path.join(os.tmpdir(), `ct-session-${sessionId}`);
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'backlog-refine-faceted.json'), JSON.stringify([githubRecord]));
  fs.writeFileSync(path.join(sessionDir, 'backlog-refine-unsynced.json'), JSON.stringify([unsyncedRecord]));
  return sessionDir;
}

const GITHUB_RECORD = { number: 42, title: 'github-sourced record', facets: { risk: 'low' } };
const UNSYNCED_RECORD = { title: 'unsynced-sourced record', facets: {}, filePath: 'specs/1-x.md' };

test('refine-mode.md Step 1 fold-in script preserves both sources — no truncation before read', { skip: SKIP_NO_BASH }, () => {
  const sessionId = `refine-fold-in-fix-${process.pid}-${Date.now()}`;
  const sessionDir = seedSession(sessionId, { githubRecord: GITHUB_RECORD, unsyncedRecord: UNSYNCED_RECORD });

  const snippet = extractFoldInSnippet();
  execSync(snippet, {
    encoding: 'utf8',
    shell: 'bash',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: sessionId },
  });

  const merged = JSON.parse(fs.readFileSync(path.join(sessionDir, 'backlog-refine-faceted.json'), 'utf8'));
  assert.strictEqual(merged.length, 2, 'merged output must include both the github-sourced and unsynced-sourced records');
  assert.strictEqual(merged[0].number, 42);
  assert.strictEqual(merged[1].title, 'unsynced-sourced record');
  assert.strictEqual(merged[1].facets.unsynced, true);

  fs.rmSync(sessionDir, { recursive: true, force: true });
});

test('go-red control: the pre-#1403 single-redirect form loses the github-sourced record it truncated away', { skip: SKIP_NO_BASH }, () => {
  // Frozen bytes of the fence this test's own extraction replaces (the exact
  // pre-fix script) — proves the assertion above can actually fail, per
  // skill-prose-conformance-tests' go-red discipline (IL-105). Never re-read
  // from the live file: this is what the fix removed.
  const PRE_FIX_SNIPPET = [
    'eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ST_BACKLOG_REFINE_UNSYNCED=backlog-refine-unsynced.json ST_BACKLOG_REFINE_UNSYNCED_DATED=backlog-refine-unsynced-dated.json ST_BACKLOG_REFINE_FACETED=backlog-refine-faceted.json)"',
    'node -e "',
    "  const { deriveCreatedAtFromGit } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');",
    "  const records = require('$ST_BACKLOG_REFINE_UNSYNCED');",
    '  console.log(JSON.stringify(deriveCreatedAtFromGit(records)));',
    '" > "$ST_BACKLOG_REFINE_UNSYNCED_DATED"',
    'node -e "',
    "  const { mergeUnsyncedRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');",
    "  const github = require('$ST_BACKLOG_REFINE_FACETED');",
    "  const unsynced = require('$ST_BACKLOG_REFINE_UNSYNCED_DATED');",
    '  console.log(JSON.stringify(mergeUnsyncedRecords(github, unsynced)));',
    '" > "$ST_BACKLOG_REFINE_FACETED"',
  ].join('\n');

  // Proves the live fence and the frozen pre-fix control actually differ —
  // otherwise this control would be testing nothing.
  assert.notStrictEqual(extractFoldInSnippet().trim(), PRE_FIX_SNIPPET.trim());

  const sessionId = `refine-fold-in-control-${process.pid}-${Date.now()}`;
  const sessionDir = seedSession(sessionId, { githubRecord: GITHUB_RECORD, unsyncedRecord: UNSYNCED_RECORD });

  // The pre-fix script truncates backlog-refine-faceted.json (via `>`)
  // before its own `node -e` process opens it via `require()` — the merge
  // step's `require($ST_BACKLOG_REFINE_FACETED)` then throws on the
  // now-empty file, so the command itself fails rather than silently
  // producing a wrong-length result.
  assert.throws(
    () => {
      execSync(PRE_FIX_SNIPPET, {
        encoding: 'utf8',
        shell: 'bash',
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: sessionId },
      });
    },
    /Command failed/,
    'the pre-fix snippet must fail (truncated $ST_BACKLOG_REFINE_FACETED breaks its own require()) — if it succeeds, this control no longer proves the fix is load-bearing',
  );

  const facetedPath = path.join(sessionDir, 'backlog-refine-faceted.json');
  assert.strictEqual(
    fs.readFileSync(facetedPath, 'utf8'),
    '',
    'the pre-fix snippet must leave backlog-refine-faceted.json truncated to empty',
  );

  fs.rmSync(sessionDir, { recursive: true, force: true });
});
