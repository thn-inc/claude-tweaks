'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { REASONS, classifyReason, buildFenceIndex, traceFence, normalizeCommandLine } = require('../../tools/guard-refusals/trace');
const { ISOLATION_CLAUSE } = require('../../plugin/bin/lib/hooks/harness-refusal');

// #4028: one case per reason id. Each clause is the live wording, copied from a refusal in the local
// transcript store (Claude Code 2.1.x) — the same strings scratch-worktree.md section 7 quotes. The
// frame around it is never hand-built: it is a whole refused tool_result from the committed store
// fixtures, with only its clause swapped, cut the way transcripts.js cuts a result before it calls
// classifyReason (from ISOLATION_CLAUSE, 1500 chars).
const STORE = path.join(__dirname, '..', 'fixtures', 'guard-refusals', 'store');

// The verbatim text of the refused tool_result on line `lineNo` of the fixture `rel`.
function storedRefusal(rel, lineNo) {
  const entry = JSON.parse(fs.readFileSync(path.join(STORE, rel), 'utf8').split('\n')[lineNo - 1]);
  const block = entry.message.content.find((b) => b.type === 'tool_result' && b.is_error === true);
  const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
  assert.ok(text.includes(ISOLATION_CLAUSE) && text.includes('Refusing to run'), `${rel}:${lineNo} is not a refusal frame`);
  return text;
}

// transcripts.js's own cut of a refused result (its `text.slice(at, at + 1500)`).
const asScanned = (text) => text.slice(text.indexOf(ISOLATION_CLAUSE), text.indexOf(ISOLATION_CLAUSE) + 1500);

const SESSION_FRAME = storedRefusal('-Users-me-claude-tweaks/0c44b2b9-5474-4ec3-be09-bf547e54aa66.jsonl', 2);
const AGENT_FRAME = storedRefusal('-Users-me-adhoc/0abec85b-3c5f-4486-9a98-1b623ee68597/subagents/agent-ab1ce6ebd797a6f56.jsonl', 2);
const RUN_PLAIN_FRAME = storedRefusal('-Users-me-claude-tweaks/00211950-4a25-4747-a8aa-5f2fd40bdc8c.jsonl', 3);
const THERE_FRAME = storedRefusal('-Users-me-claude-tweaks/8307632c-d334-4558-8434-09b421be6ed2/subagents/agent-a05018134f5ee897f.jsonl', 2);
const NODE_FRAME = storedRefusal('-Users-me-record-3670/5c28ef9e-a723-493c-9c70-294071dd8fe7/subagents/agent-a20eb732992453d65.jsonl', 2);

// `frame` with the clause between "but this command " and ". Refusing to run" replaced by `clause`.
function withClause(frame, clause) {
  const lead = 'but this command ';
  const at = frame.indexOf(lead);
  const end = frame.indexOf('. Refusing to run', at);
  assert.ok(at !== -1 && end !== -1, 'fixture frame lost its clause boundaries');
  return frame.slice(0, at + lead.length) + clause + frame.slice(end);
}

const refusal = (clause, frame = SESSION_FRAME) => asScanned(withClause(frame, clause));

const CASES = [
  ['too-complex', 'is too complex to verify that it stays inside the worktree'],
  ['too-complex', 'uses string content the parser did not tokenize in a plain command, so it is too complex to verify that it stays inside the worktree'],
  ['names-git', 'names git in a form too complex to verify that it stays inside the worktree'],
  ['git-redirect-shared', 'redirects git to the shared checkout via -C'],
  ['cd-shared', 'changes directory to the shared checkout (/Users/me/Code Workspaces/r) before running git'],
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

test('classifyReason maps each live refusal clause, inside a real stored refusal frame, from §7 wording', () => {
  for (const [id, clause] of CASES) {
    const text = refusal(clause);
    assert.ok(text.includes(clause) && text.includes('Refusing to run'), `${id}: the swapped frame must hold the clause and its tail`);
    assert.equal(classifyReason(text), id, `${id}: ${clause.slice(0, 70)}`);
  }
  assert.deepEqual([...new Set(CASES.map(([id]) => id))].sort(), [...REASONS].sort(), 'every reason id has a case');
});

test('classifyReason reads each stored refusal verbatim: session, This agent, Run the plain command, Refusing to run it there', () => {
  assert.equal(classifyReason(asScanned(SESSION_FRAME)), 'too-complex');
  assert.equal(classifyReason(asScanned(AGENT_FRAME)), 'names-git');
  assert.equal(classifyReason(asScanned(RUN_PLAIN_FRAME)), 'names-git');
  assert.equal(classifyReason(asScanned(THERE_FRAME)), 'cd-shared');
  assert.equal(classifyReason(asScanned(NODE_FRAME)), 'node-runtime-operand');
  // A clause swapped into the This agent frame reads the same as in the session frame.
  assert.equal(classifyReason(refusal('runs a string through eval, which can\'t be verified to stay inside the worktree', AGENT_FRAME)), 'runs-eval');
});

// The cut at "Refusing to run": the real session frame with only its tail worktree path changed to one
// holding reason wording. Read whole, "run them from /Users/me/runs bash/wt." would match bash-construct,
// which REASON_TABLE tests before too-complex.
test('classifyReason ignores reason wording in the frame tail after "Refusing to run"', () => {
  const tail = /run them from [^\n]*\.$/;
  assert.match(SESSION_FRAME, tail, 'the stored session frame lost its "run them from <WT>." tail');
  const doctored = SESSION_FRAME.replace(tail, 'run them from /Users/me/runs bash/wt.');
  assert.notEqual(doctored, SESSION_FRAME);
  assert.equal(classifyReason(asScanned(doctored)), 'too-complex');
});

test('classifyReason reads a bare clause, and the empty string as other', () => {
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

// #4028 final review: only a real plugin root normalizes, an installed `claude-tweaks/<semver>/` cache
// root or a checkout's `plugin/` followed by `bin/` or `skills/`. Any other `/plugin/` segment stays.
test('normalizeCommandLine rewrites a real plugin root and leaves an unrelated /plugin/ path alone', () => {
  assert.equal(normalizeCommandLine('cat /x/plugin/y/file.txt'), 'cat /x/plugin/y/file.txt');
  assert.equal(normalizeCommandLine('cat "/x/plugin/y/file.txt"'), 'cat "/x/plugin/y/file.txt"');
  assert.equal(normalizeCommandLine('node /Users/me/r/plugin/bin/x.js'), 'node <ROOT>/bin/x.js');
  assert.equal(normalizeCommandLine('cat "/Users/me/Code Workspaces/r/plugin/skills/a.md"'), 'cat "<ROOT>/skills/a.md"');
  assert.equal(normalizeCommandLine(`cat ${ROOT}/hooks/hooks.json`), 'cat <ROOT>/hooks/hooks.json');
  // The real root is the last plugin/ segment followed by bin/ or skills/, not the first plugin/ seen.
  assert.equal(normalizeCommandLine('node /a/plugin/b/plugin/bin/x.js'), 'node <ROOT>/bin/x.js');
});

test('traceFence does not tie two fences whose paths differ before an unrelated /plugin/ segment', () => {
  const fence = (dir) => `# F\n\n\`\`\`bash\ncat /opt/${dir}/plugin/data/settings-file.txt\n\`\`\`\n`;
  const index = buildFenceIndex(skillsRoot({ 'A.md': fence('one'), 'B.md': fence('two') }));
  assert.deepEqual(traceFence('cat /opt/one/plugin/data/settings-file.txt', index), ['A.md:3']);
});

test('traceFence ignores a command line shorter than 20 characters', () => {
  const index = buildFenceIndex(skillsRoot({ 'D.md': '# D\n\n```bash\ngh pr list --json number\n```\n' }));
  assert.deepEqual(traceFence('gh pr list --json number', index), ['D.md:3']);
  const short = buildFenceIndex(skillsRoot({ 'E.md': '# E\n\n```bash\nls -la\n```\n' }));
  assert.deepEqual(traceFence('ls -la', short), []);
});
