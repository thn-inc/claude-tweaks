// tests/dispatch-near-dup-pairs-script.test.js — #3520.
//
// queue-pull-script.md's #1944 heredoc persists the strong cross-group near-duplicate pairs
// to $DISPATCH_NEAR_DUP_PAIRS for the later selection steps. Extract-and-run it, per
// skill-prose-conformance-tests, over groups fixtures.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const QUEUE_PULL = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'), 'utf8');

const ANCHOR = '# #1944: cross-group near-duplicate candidate warning.';
const START = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js"';
const END = 'NODE_EVAL_EOF\n';

// The #1944 heredoc: from its node-eval-file.js line through its closing NODE_EVAL_EOF line.
function heredoc() {
  const anchor = QUEUE_PULL.indexOf(ANCHOR);
  assert.notStrictEqual(anchor, -1, '#1944 anchor not found in queue-pull-script.md');
  const from = QUEUE_PULL.indexOf(START, anchor);
  assert.notStrictEqual(from, -1, 'no node-eval-file.js call after the #1944 anchor');
  const close = QUEUE_PULL.indexOf('\n' + END, from);
  assert.notStrictEqual(close, -1, 'the #1944 heredoc has no NODE_EVAL_EOF terminator');
  return QUEUE_PULL.slice(from, close + 1 + END.length);
}

function rec(number, title, anchors) {
  return {
    number,
    title,
    labels: [{ name: 'priority:medium' }],
    body: '## Current State\n\n' + anchors.map((a) => `- \`${a}\` is wired`).join('\n') + '\n',
  };
}

function setup(t, groups) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-nd-pairs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    DISPATCH_GROUPS: path.join(dir, 'groups.json'),
    DISPATCH_NEAR_DUP_PAIRS: path.join(dir, 'near-dup-pairs.json'),
  };
  fs.writeFileSync(files.DISPATCH_GROUPS, JSON.stringify(groups));
  return files;
}

function run(files) {
  const result = spawnSync('bash', ['-c', heredoc()], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin'), ...files },
  });
  assert.strictEqual(result.status, 0, `heredoc exited ${result.status}: ${result.stderr}`);
  return result;
}

const read = (files) => JSON.parse(fs.readFileSync(files.DISPATCH_NEAR_DUP_PAIRS, 'utf8'));

test('AC8.1: the heredoc warns on every cross-group pair and persists only the strong one, without a strong key', (t) => {
  const files = setup(t, [
    [rec(1, 'Wire the cache layer', ['a.one', 'b.two', 'c.three'])],
    [rec(2, 'Rotate the signing keys', ['a.one', 'b.two', 'c.three'])],
    [rec(3, 'Prune stale worktrees', ['d.four'])],
    [rec(4, 'Render the status table', ['d.four'])],
  ]);
  const result = run(files);
  assert.ok(
    result.stderr.includes('AUTO — dispatch: near-duplicate candidates across groups: #1 / #2 (body-anchor-overlap)'),
    `stderr was: ${result.stderr}`,
  );
  assert.ok(
    result.stderr.includes('AUTO — dispatch: near-duplicate candidates across groups: #3 / #4 (body-anchor-overlap)'),
    `stderr was: ${result.stderr}`,
  );
  assert.deepStrictEqual(read(files), [
    { records: [1, 2], signals: ['body-anchor-overlap'], sharedAnchors: ['a.one', 'b.two', 'c.three'] },
  ]);
});

test('Review Focus 4: a pull with no strong pair rewrites a stale pairs file to []', (t) => {
  const files = setup(t, [
    [rec(1, 'Wire the cache layer', ['a.one'])],
    [rec(2, 'Rotate the signing keys', ['z.nine'])],
  ]);
  fs.writeFileSync(files.DISPATCH_NEAR_DUP_PAIRS, JSON.stringify([{ records: [8, 9], signals: [], sharedAnchors: [] }]));
  run(files);
  assert.deepStrictEqual(read(files), []);
});

test('AC8.2: the files map, the in-flight fetch fields and the reason list carry the wiring', () => {
  assert.ok(QUEUE_PULL.includes("DISPATCH_NEAR_DUP_PAIRS: 'dispatch-near-dup-pairs.json'"));
  assert.ok(QUEUE_PULL.includes('gh issue list --label bot:in-progress --state open --json number,title,body,labels --limit 200'));
  const bullet = QUEUE_PULL.slice(QUEUE_PULL.indexOf("- `reason: 'neighbour-in-flight'`"));
  const text = bullet.slice(0, bullet.indexOf('\n'));
  assert.ok(text.includes('Key File'), 'the bullet names the Key File rule');
  assert.ok(text.includes('isStrongNearDuplicate'), 'the bullet names the near-duplicate rule');
});
