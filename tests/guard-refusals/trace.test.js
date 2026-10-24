'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { REASONS, classifyReason, buildFenceIndex, traceFence } = require('../../tools/guard-refusals/trace');

// #4028: one case per reason id. Each clause is the live wording, copied from a refusal in the local
// transcript store (Claude Code 2.1.x) — the same strings scratch-worktree.md section 7 quotes.
const WT = '/Users/me/Code Workspaces/r/.claude/worktrees/w';
const refusal = (clause, { noun = 'session', tail = 'Split it into plain, separate commands' } = {}) =>
  ` is isolated in the worktree ${WT}, but this command ${clause}. Refusing to run it — a worktree-isolated ${noun}'s git operations must target its own worktree. ${tail} and run them from ${WT}.`;

const CASES = [
  ['too-complex', 'is too complex to verify that it stays inside the worktree'],
  ['too-complex', 'uses string content the parser did not tokenize in a plain command, so it is too complex to verify that it stays inside the worktree'],
  ['names-git', 'names git in a form too complex to verify that it stays inside the worktree'],
  ['git-redirect-shared', 'redirects git to the shared checkout via -C'],
  ['cd-shared', 'changes directory to the shared checkout (/Users/me/Code Workspaces/r) before running git'],
  ['cd-shared', "working directory resolved to the shared checkout (/Users/me/Code Workspaces/r)"],
  ['git-C-runtime', 'points git at a directory computed at runtime (-C .), which can\'t be verified before it runs'],
  ['glob-git', 'redirects git through a glob pattern that expands at runtime'],
  ['runs-eval', "runs a string through eval, which can't be verified to stay inside the worktree"],
  ['runs-eval', 'runs eval inside a construct too complex to verify; what it reads or is handed as shell text cannot be shown not to run git'],
  ['runs-complete', "runs a string through complete, which can't be verified to stay inside the worktree"],
  ['sed-runtime', 'runs sed with a value computed at runtime (the variable S) where an option may stand (a value that is not double-quoted, or whose first character is matched or computed rather than spelled out, may begin with -; put -- before it) inside a construct too complex to verify, so what it runs cannot be shown not to be git'],
  ['sed-runtime', 'runs sed with a program computed at runtime inside a construct too complex to verify, so what it runs cannot be shown not to be git'],
  ['node-runtime-operand', 'runs node with a value computed at runtime (the variable P) (a computed argument goes after the script or --) where it cannot tell which operand is the program, next to an operand or input computed at runtime in a plain command, so what it runs cannot be shown not to be git'],
  ['node-program-runtime', 'runs node with a program computed at runtime (the variable P) in a plain command, so what it runs cannot be shown not to be git'],
  ['node-program-runtime', 'runs node with a script computed at runtime (a value computed at runtime (the variable B)) in a plain command, so what it runs cannot be shown not to be git'],
  ['node-program-runtime', 'feeds node a program assembled at runtime in a plain command, so what it runs cannot be shown not to be git'],
  ['gh-runtime', 'runs gh with a value computed at runtime (the variable S) inside a construct too complex to verify, so what it runs cannot be shown not to be git'],
  ['gh-text', 'runs gh with the text "\\(.title) [\\(.state)]… inside a construct too complex to verify, so what it runs cannot be shown not to be git'],
  ['bash-construct', 'runs bash inside a construct too complex to verify; what it reads or is handed as shell text cannot be shown not to run git'],
  ['bash-construct', 'runs pwsh in a plain command; what it reads or is handed as shell text cannot be shown not to run git'],
  ['other', 'runs awk with a program that can execute commands or that it cannot read in a plain command, so what it runs cannot be shown not to be git'],
  ['other', 'runs playwright-cli with a value computed at runtime (the variable SS) inside a construct too complex to verify, so what it runs cannot be shown not to be git'],
  ['other', 'runs a command whose name is computed at runtime in a plain command, so it cannot be shown not to be git'],
];

test('classifyReason maps each live refusal clause from §7 wording', () => {
  for (const [id, clause] of CASES) {
    assert.equal(classifyReason(refusal(clause)), id, `${id}: ${clause.slice(0, 70)}`);
  }
  assert.deepEqual([...new Set(CASES.map(([id]) => id))].sort(), [...REASONS].sort(), 'every reason id has a case');
});

test('classifyReason reads the This agent wording and the Refusing to run it there frame, and a bare clause', () => {
  assert.equal(classifyReason(refusal('names git in a form too complex to verify that it stays inside the worktree', { noun: 'agent' })), 'names-git');
  assert.equal(
    classifyReason(` is isolated in the worktree ${WT}, but this command's working directory resolved to the shared checkout (/Users/me/Code Workspaces/r). Refusing to run it there — a worktree-isolated session's commands must run inside its worktree. Re-run the command from ${WT}.`),
    'cd-shared',
  );
  assert.equal(classifyReason('this command is too complex to verify that it stays inside the worktree'), 'too-complex');
  assert.equal(classifyReason(''), 'other');
});

// A temp skills root with fences at known lines.
function skillsRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-skills-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const FENCE_A = [
  '# A', //                                                                                  1
  '', //                                                                                     2
  '```bash', //                                                                              3
  'node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --text-file {path}',
  'gh issue view {n} --json title,body > "$OUT"',
  '```',
  '',
].join('\n');

const FENCE_B = [
  '# B',
  '',
  '```sh',
  'node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$RUN_DIR" --kind {kind}',
  '```',
  '',
].join('\n');

const ROOT = '/Users/x/.claude/plugins/cache/m/claude-tweaks/6.145.0';

test('traceFence finds the fence a command was copied from with the plugin root and placeholders filled', () => {
  const index = buildFenceIndex(skillsRoot({ 'A.md': FENCE_A, 'B.md': FENCE_B }));
  const fromA = [
    `node "${ROOT}/bin/log-decision.js" --run "/Users/x/Code Workspaces/r/.claude-tweaks/pipelines/2026-10-24T193452-record-4028" --text-file /tmp/entry.md`,
    'gh issue view 4028 --json title,body > "/tmp/out.json"',
  ].join('\n');
  assert.deepEqual(traceFence(fromA, index), ['A.md:3']);
  assert.deepEqual(traceFence('ls -la /Users/x/some/other/directory/entirely', index), []);

  // The same command with the checkout's own plugin/ in place of the installed root.
  assert.deepEqual(
    traceFence('node "/Users/x/Code Workspaces/r/.claude/worktrees/w/plugin/bin/stage-item.js" --run "/tmp/run" --kind fix', index),
    ['B.md:3'],
  );
});

test('traceFence matches a command that kept ${CLAUDE_PLUGIN_ROOT} verbatim, and a fence that quotes a literal root', () => {
  const literal = `node "${ROOT}/bin/stage-item.js" --run "$RUN_DIR" --kind {kind}`;
  const index = buildFenceIndex(skillsRoot({ 'A.md': FENCE_A, 'L.md': `# L\n\n\`\`\`bash\n${literal}\n\`\`\`\n` }));
  // The agent pasted the placeholder spelling into the call, which is the runtime-variable shape the guard refuses.
  const verbatim = 'node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --text-file {path}';
  assert.deepEqual(traceFence(verbatim, index), ['A.md:3']);
  assert.deepEqual(traceFence(`node "${ROOT}/bin/stage-item.js" --run "/tmp/r" --kind fix`, index), ['L.md:3']);
});

test('traceFence returns every fence tied for the most matched lines, and prefers the one matching more', () => {
  const dup = FENCE_A.replace('# A', '# C');
  const index = buildFenceIndex(skillsRoot({ 'A.md': FENCE_A, 'sub/C.md': dup, 'B.md': FENCE_B }));
  const oneLine = `node "${ROOT}/bin/stage-item.js" --run "/tmp/r" --kind fix`;
  assert.deepEqual(traceFence(oneLine, index), ['B.md:3']);
  const logOnly = `node "${ROOT}/bin/log-decision.js" --run "/tmp/r" --text-file /tmp/e.md`;
  assert.deepEqual(traceFence(logOnly, index), ['A.md:3', 'sub/C.md:3'], 'tied fences all returned, sorted');
  const both = `${logOnly}\n${oneLine}`;
  assert.deepEqual(traceFence(both, index), ['A.md:3', 'B.md:3', 'sub/C.md:3'], 'one matched line each: A, B and C tie');
  const twoLines = `${logOnly}\ngh issue view 7 --json title,body > "/tmp/o.json"`;
  assert.deepEqual(traceFence(twoLines, index), ['A.md:3', 'sub/C.md:3'], 'two matched lines beat one');
});

test('traceFence ignores a command line shorter than 20 characters', () => {
  const index = buildFenceIndex(skillsRoot({ 'D.md': '# D\n\n```bash\ngh pr list --json number\n```\n' }));
  assert.deepEqual(traceFence('gh pr list --json number', index), ['D.md:3']);
  const short = buildFenceIndex(skillsRoot({ 'E.md': '# E\n\n```bash\nls -la\n```\n' }));
  assert.deepEqual(traceFence('ls -la', short), []);
});
