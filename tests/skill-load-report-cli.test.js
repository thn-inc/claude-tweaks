// tests/skill-load-report-cli.test.js — bin/skill-load-report.js (#3309),
// the CLI harness-health's Skill-load check shells out to. Exercised via the
// injectable run(argv, deps) seam (harness-cost-report-cli.test.js's shape):
// a temp config dir stands in for $CLAUDE_CONFIG_DIR and a temp plugin root
// for the load model. Transcript lines mirror the observed shapes (a)-(e) in
// plugin/bin/lib/skill-audit/transcript-load.js's header; the subagent
// layout is shape (d).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../plugin/bin/skill-load-report');
const { slugForCwd } = require('../plugin/bin/lib/timing/transcript');
const { measuredTextBytes } = require('../plugin/bin/lib/skill-audit/context-cost');
const { skipUnderRoot } = require('./helpers/root');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const TS = '2026-10-17T12:00:00.000Z';

// Shape (a).
const skillUse = (skill, id) => ({ type: 'assistant', timestamp: TS, message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } });
// Shape (b): exactly `bytes` UTF-8 bytes.
function injectedBody(bytes, sourceToolUseID) {
  const head = 'Base directory for this skill: /p/skills/x\n\n';
  return { type: 'user', isMeta: true, sourceToolUseID, timestamp: TS, message: { role: 'user', content: [{ type: 'text', text: head + 'x'.repeat(bytes - head.length) }] } };
}
// Shape (e).
const readUse = (file, id) => ({ type: 'assistant', timestamp: TS, message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file } }] } });
const readResult = (id, bytes) => ({ type: 'user', timestamp: TS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'y'.repeat(bytes) }] } });
const invocation = (skill, id, bytes) => [skillUse(skill, id), injectedBody(bytes, id)];

const SKILL_PATH = '/home/u/.claude/plugins/cache/m/demo/1.0.0/skills/alpha/more.md';

// A Read fixture built from a real temp path: forward slashes on win32 too, the
// only form transcript-load's isProcedurePath records (a backslash path is never
// seen as a skill-file Read, so a path.join() fixture there would never register).
const posix = (p) => p.split(path.sep).join('/');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function writeJsonl(file, lines, mtimeSec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
}

// A plugin root named `demo` with one skill, alpha, citing nothing.
function pluginRoot() {
  const root = tmp('slr-plugin-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }));
  fs.mkdirSync(path.join(root, 'skills', 'alpha'), { recursive: true });
  const body = `# Alpha\n\n${'a'.repeat(1000)}\n`;
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), body);
  return { root, closure: measuredTextBytes(body, 'skills/alpha/SKILL.md').bytes };
}

function setup() {
  const configDir = tmp('slr-config-');
  const cwd = tmp('slr-cwd-');
  const transcriptDir = path.join(configDir, 'projects', slugForCwd(cwd));
  const out = { stdout: '', stderr: '' };
  const deps = {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
    cwd,
    configDir: () => configDir,
    listFiles: () => [],
  };
  const json = () => JSON.parse(out.stdout);
  return { configDir, cwd, transcriptDir, out, deps, json };
}

test('--help prints usage and exits 0', async () => {
  const { out, deps } = setup();
  assert.strictEqual(await run(['--help'], deps), 0);
  assert.match(out.stdout, /^usage: skill-load-report\.js/);
});

test('malformed invocations exit 2 with no stdout', async () => {
  for (const argv of [['--bogus'], ['--sessions', '0'], ['--sessions', 'abc'], ['--cwd'], ['--plugin-root', '--cwd'], ['--optional-plugin-root']]) {
    const { out, deps } = setup();
    assert.strictEqual(await run(argv, deps), 2, argv.join(' '));
    assert.strictEqual(out.stdout, '');
  }
});

test('a --plugin-root with no skills/ exits 2', async () => {
  const { out, deps } = setup();
  assert.strictEqual(await run(['--plugin-root', tmp('slr-empty-')], deps), 2);
  assert.match(out.stderr, /has no skills\/ directory/);
});

test('no transcript directory for the cwd: no-data naming the directory looked in, exit 0', async () => {
  const { transcriptDir, deps, json } = setup();
  assert.strictEqual(await run([], deps), 0);
  assert.deepStrictEqual(json(), { status: 'no-data', transcriptDir, sessions: 0, unreadable: 0, rows: [] });
});

test('a transcript directory holding no main transcript is no-data too', async () => {
  const { transcriptDir, deps, json } = setup();
  fs.mkdirSync(path.join(transcriptDir, 'some-session', 'subagents'), { recursive: true });
  assert.strictEqual(await run([], deps), 0);
  assert.strictEqual(json().status, 'no-data');
});

// chmod cannot deny reads on Windows, and mode bits are ignored under root.
const CHMOD_DENIAL_SKIP = { skip: (process.platform === 'win32' && 'win32: chmod does not deny reads') || skipUnderRoot('mode bits are ignored under root').skip };

test('an unreadable main transcript is counted, and with none read the result is no-data', CHMOD_DENIAL_SKIP, async () => {
  const { transcriptDir, deps, json } = setup();
  const file = path.join(transcriptDir, 's1.jsonl');
  writeJsonl(file, invocation('demo:alpha', 't1', 500));
  fs.chmodSync(file, 0o000);
  try {
    assert.strictEqual(await run([], deps), 0);
    assert.deepStrictEqual(json(), { status: 'no-data', transcriptDir, sessions: 0, unreadable: 1, rows: [] });
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

test('an unreadable subagents/ directory is counted and the run continues', CHMOD_DENIAL_SKIP, async () => {
  const { transcriptDir, deps, json } = setup();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 500));
  const subagentsDir = path.join(transcriptDir, 's1', 'subagents');
  fs.mkdirSync(subagentsDir, { recursive: true });
  fs.chmodSync(subagentsDir, 0o000);
  try {
    assert.strictEqual(await run([], deps), 0);
    const result = json();
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.sessions, 1);
    assert.strictEqual(result.unreadable, 1);
  } finally {
    fs.chmodSync(subagentsDir, 0o700);
  }
});

test('closure joins on namespace + skill: demo:alpha gets its closure, another plugin\'s same-named skill gets closure null', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', closure + 500),
    ...invocation('other:alpha', 't2', 300),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  const r = json();
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.sessions, 1);
  assert.deepStrictEqual(r.rows, [
    { skill: 'demo:alpha', invocations: 1, median: closure + 500, max: closure + 500, closure, outsideClosure: [] },
    { skill: 'other:alpha', invocations: 1, median: 300, max: 300, closure: null, outsideClosure: null },
  ]);
});

test('a project-local root (no plugin.json) folds path-namespaced names into the bare skill', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  fs.rmSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('alpha', 't1', 200),
    ...invocation('.claude/worktrees/wt:alpha', 't2', 100),
    ...invocation('demo:alpha', 't3', 50),
  ]);
  await run(['--plugin-root', root], deps);
  assert.deepStrictEqual(json().rows, [
    { skill: 'alpha', invocations: 2, median: 150, max: 200, closure, outsideClosure: [] },
    { skill: 'demo:alpha', invocations: 1, median: 50, max: 50, closure: null, outsideClosure: null },
  ]);
});

const CACHE = '/home/u/.claude/plugins/cache/m/demo/1.0.0';
const withFile = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const outsideOf = (r, skill) => r.rows.find((x) => x.skill === skill).outsideClosure;

test('AC1.1: a read of a root file outside the closure is listed in outsideClosure', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse(`${CACHE}/skills/alpha/extra.md`, 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), ['skills/alpha/extra.md']);
});

test('AC1.2: reading only closure files leaves outsideClosure empty', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse(`${CACHE}/skills/alpha/SKILL.md`, 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), []);
});

test('cross-root reads are not comparable', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse('/repo/.claude/skills/other/SKILL.md', 'r1'),
    readResult('r1', 40),
    readUse('/home/u/.claude/plugins/cache/m2/other/2.0.0/skills/beta/SKILL.md', 'r2'),
    readResult('r2', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), []);
});

// Origin anchoring: a read counts only when the text before its final
// "skills/" segment is the matched root itself or, for a named plugin, an
// installed copy of it under plugins/cache/{marketplace}/{name}/{version}/.
test('origin: a same-relative-path read under no root is not counted', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse('/proj/.claude/skills/alpha/extra.md', 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), []);
});

test('origin: an installed copy of the same plugin at another version is counted', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse('/home/u/.claude/plugins/cache/m/demo/9.9.9/skills/alpha/extra.md', 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), ['skills/alpha/extra.md']);
});

test('origin: a cache path of a different plugin name is not counted', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse('/home/u/.claude/plugins/cache/m/other/1.0.0/skills/alpha/extra.md', 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), []);
});

test('origin: a read under the root\'s own absolute path is counted', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse(posix(path.join(root, 'skills/alpha/extra.md')), 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), ['skills/alpha/extra.md']);
});

test('origin: a root with no plugin.json accepts no installed-copy path', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  fs.rmSync(path.join(root, '.claude-plugin'), { recursive: true });
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('alpha', 't1', 100),
    readUse(`${CACHE}/skills/alpha/extra.md`, 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'alpha'), []);
});

test('outsideClosure is distinct and sorted', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/z.md', 'z\n');
  withFile(root, 'skills/alpha/b.md', 'b\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('demo:alpha', 't1', 100),
    readUse(`${CACHE}/skills/alpha/z.md`, 'r1'),
    readResult('r1', 10),
    readUse(`${CACHE}/skills/alpha/b.md`, 'r2'),
    readResult('r2', 10),
    ...invocation('demo:alpha', 't2', 100),
    readUse(`${CACHE}/skills/alpha/z.md`, 'r3'),
    readResult('r3', 10),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  assert.deepStrictEqual(outsideOf(json(), 'demo:alpha'), ['skills/alpha/b.md', 'skills/alpha/z.md']);
});

test('null closure gives null outsideClosure', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(root, 'skills/alpha/extra.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    readUse(`${CACHE}/skills/alpha/extra.md`, 'r0'),
    readResult('r0', 10),
    ...invocation('other:alpha', 't1', 100),
    readUse(`${CACHE}/skills/alpha/extra.md`, 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  const rows = json().rows;
  assert.deepStrictEqual(rows.map((r) => r.skill).sort(), ['(main, unattributed)', 'other:alpha']);
  for (const r of rows) assert.deepStrictEqual([r.closure, r.outsideClosure], [null, null], r.skill);
});

test('--optional-plugin-root without skills/ is skipped, not exit 2', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  assert.strictEqual(await run(['--plugin-root', root, '--optional-plugin-root', tmp('slr-noskills-')], deps), 0);
  assert.strictEqual(json().status, 'ok');
});

test('--optional-plugin-root with skills/ joins its closure', async () => {
  const { cwd, transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  fs.cpSync(root, path.join(cwd, '.claude'), { recursive: true, filter: (src) => path.basename(src) !== '.claude-plugin' });
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('alpha', 't1', 100));
  assert.strictEqual(await run(['--optional-plugin-root', '.claude'], deps), 0);
  const row = json().rows.find((r) => r.skill === 'alpha');
  assert.strictEqual(typeof row.closure, 'number');
  assert.deepStrictEqual(row.outsideClosure, []);
});

test('closure counts a bare-name citation of another skill\'s file', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  const alphaBody = `# Alpha\n\nsee \`beta-notes.md\`\n${'a'.repeat(1000)}\n`;
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), alphaBody);
  fs.mkdirSync(path.join(root, 'skills', 'beta'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'beta', 'SKILL.md'), '# Beta\n');
  fs.writeFileSync(path.join(root, 'skills', 'beta', 'beta-notes.md'), `${'b'.repeat(500)}\n`);
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  await run(['--plugin-root', root], deps);
  const row = json().rows.find((r) => r.skill === 'demo:alpha');
  assert.strictEqual(row.closure, measuredTextBytes(alphaBody, 'skills/alpha/SKILL.md').bytes + 501);
});

test('rows that tie on max sort by skill ascending', async () => {
  const { transcriptDir, deps, json } = setup();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('z:last', 't1', 400),
    ...invocation('a:first', 't2', 400),
    ...invocation('m:big', 't3', 900),
  ]);
  await run([], deps);
  assert.deepStrictEqual(json().rows.map((r) => r.skill), ['m:big', 'a:first', 'z:last']);
});

test('--sessions keeps the newest main transcripts by mtime, and each one\'s subagents/*.jsonl (shape d) are read', async () => {
  const { transcriptDir, deps, json } = setup();
  writeJsonl(path.join(transcriptDir, 'old.jsonl'), invocation('demo:old', 't1', 100), 1_000_000);
  writeJsonl(path.join(transcriptDir, 'new.jsonl'), invocation('demo:new', 't2', 200), 2_000_000);
  writeJsonl(path.join(transcriptDir, 'new', 'subagents', 'agent-a1.jsonl'), [readUse(SKILL_PATH, 'r1'), readResult('r1', 50)]);
  fs.writeFileSync(path.join(transcriptDir, 'new', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'fork' }));
  writeJsonl(path.join(transcriptDir, 'old', 'subagents', 'agent-a2.jsonl'), [readUse(SKILL_PATH, 'r2'), readResult('r2', 70)]);
  assert.strictEqual(await run(['--sessions', '1'], deps), 0);
  const r = json();
  assert.strictEqual(r.sessions, 1);
  assert.deepStrictEqual(r.rows.map((x) => [x.skill, x.max]), [['demo:new', 200], ['(subagent, unattributed)', 50]]);
});

test('default plugin roots come from discoverPluginRoots over the cwd\'s tracked files', async () => {
  const { cwd, transcriptDir, deps, json } = setup();
  const { root, closure } = pluginRoot();
  fs.cpSync(root, path.join(cwd, 'plugin'), { recursive: true });
  deps.listFiles = () => ['plugin/skills/alpha/SKILL.md', 'README.md'];
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  await run([], deps);
  assert.deepStrictEqual(json().rows.map((r) => [r.skill, r.closure]), [['demo:alpha', closure]]);
});

// run() checks skills/ first, then calls deps.configDir() before closureIndex,
// so a configDir that removes the root's skills/ (or the root) is the hook for
// a plugin root vanishing between the check and the index build.
test('AC3.2: a plugin root\'s skills/ deleted between the skills/ check and the index build degrades instead of throwing', async () => {
  const { configDir, transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  deps.configDir = () => { fs.rmSync(path.join(root, 'skills'), { recursive: true }); return configDir; };
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  const r = json();
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.rows.map((x) => [x.skill, x.closure]), [['demo:alpha', null]]);
});

test('AC3.2: a plugin root deleted entirely at the same point degrades the same way', async () => {
  const { configDir, transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  deps.configDir = () => { fs.rmSync(root, { recursive: true }); return configDir; };
  assert.strictEqual(await run(['--plugin-root', root], deps), 0);
  const r = json();
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.rows.map((x) => [x.skill, x.closure]), [['demo:alpha', null]]);
});

const HARNESS_HEALTH = path.join(__dirname, '..', 'plugin', 'skills', 'harness-health', 'SKILL.md');

// The Skill-load check paragraph is its lead-in, one ```bash block, and the
// text after the fence up to the next blank line.
function skillLoadParagraph(text) {
  const start = text.indexOf('**Skill-load check (#3309');
  assert.ok(start >= 0, 'harness-health/SKILL.md has no Skill-load check paragraph');
  const fenceEnd = text.indexOf('\n```\n', text.indexOf('```bash', start)) + 5;
  return text.slice(start, text.indexOf('\n\n', fenceEnd));
}

// The paragraph's documented command with ${CLAUDE_PLUGIN_ROOT} replaced by
// `pluginRootDir`, as the argv run() takes: split on spaces outside double
// quotes, quotes stripped, the leading `node <script>` tokens dropped.
function documentedArgv(pluginRootDir) {
  const para = skillLoadParagraph(readText(HARNESS_HEALTH));
  const line = para.split('\n').find((l) => l.startsWith('node ') && l.includes('skill-load-report.js'));
  assert.ok(line, 'the Skill-load check paragraph has no skill-load-report.js command line');
  const tokens = [];
  let cur = '';
  let quoted = false;
  for (const ch of line.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRootDir)) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ' ' && !quoted) { if (cur) tokens.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens.slice(2);
}

test('AC3.1: a project-local skill invoked from a worktree joins its .claude/skills closure under the harness-health command as written', async () => {
  const { cwd, transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  withFile(cwd, '.claude/skills/alpha/SKILL.md', `# Alpha\n\n${'a'.repeat(1000)}\n`);
  withFile(cwd, '.claude/skills/alpha/notes.md', 'uncited\n');
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), [
    ...invocation('.claude/worktrees/wt:alpha', 't1', 100),
    readUse(posix(path.join(cwd, '.claude/skills/alpha/notes.md')), 'r1'),
    readResult('r1', 40),
  ]);
  assert.strictEqual(await run(documentedArgv(root), deps), 0);
  const row = json().rows.find((r) => r.skill === 'alpha');
  assert.ok(row, 'no alpha row');
  assert.strictEqual(typeof row.closure, 'number');
  assert.deepStrictEqual(row.outsideClosure, ['skills/alpha/notes.md']);
});

test('the harness-health command runs in a project with no .claude/skills', async () => {
  const { transcriptDir, deps, json } = setup();
  const { root } = pluginRoot();
  writeJsonl(path.join(transcriptDir, 's1.jsonl'), invocation('demo:alpha', 't1', 100));
  assert.strictEqual(await run(documentedArgv(root), deps), 0);
  assert.strictEqual(json().status, 'ok');
});

test('harness-health names the Skill-load check: command, top 10, filing title, dedup, auto-close, --dry-run', () => {
  const para = skillLoadParagraph(readText(HARNESS_HEALTH));
  for (const needle of [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/skill-load-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --optional-plugin-root .claude',
    'top 10',
    'non-empty `outsideClosure`',
    '"Skill reads files outside its static closure: {skill}"',
    'open `by:harness-health` issue already carries that exact title',
    '`status: "ok"`',
    'empty `outsideClosure`',
    'No outside reads observed over the last {sessions} sessions',
    'never closes anything',
    'reopen',
    '`--dry-run`',
  ]) assert.ok(para.includes(needle), `Skill-load check paragraph is missing: ${needle}`);
});

test('skill-load-report: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'harness-health', 'SKILL.md');
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  assert.ok(skillLoadParagraph(text).includes('top 10'));
});
