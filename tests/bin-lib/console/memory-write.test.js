'use strict';
// #4620 Task 9: automatic, revertable memory writes (console-resolve.js --memory-write). The write lands
// outside the repository, so every containment case asserts that nothing was created or logged.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readText } = require('../../helpers/read-skill');
const { chmodDenialSkip } = require('../../helpers/root');
const { initRepo } = require('../../helpers/git-fixtures');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'plugin', 'bin', 'console-resolve.js');
const { run, parseArgs } = require(CLI);
const { wholeFileDiff, planMemoryWrite, MEMORY_DIFF_CAP_BYTES, MEMORY_REVERT_COMMAND } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'memory-write'));
const { resolveAll } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function fixture() {
  const root = fs.realpathSync(scratchDir('memory-write-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); git('commit', '-q', '--allow-empty', '-m', 'init');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  // The shape is gated on control mode in code (console-resolve.js controlModeGate).
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'control-mode: on\n');
  const memoryDir = path.join(root, 'memory-home');
  fs.mkdirSync(memoryDir);
  const contentFile = path.join(root, 'content.tmp');
  return { root, runDir, memoryDir, contentFile };
}

async function write(fx, target, content) {
  fs.writeFileSync(fx.contentFile, content);
  let out = '';
  let err = '';
  // `--memory-write` leads the flags so the one-`console-resolve.js" --run` pin in review-console.md holds.
  const code = await run(['--memory-write', target, '--memory-dir', fx.memoryDir, '--content-file', fx.contentFile, '--run', fx.runDir], {
    cwd: () => fx.root, mainRoot: fx.root, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, now: () => Date.parse('2026-09-06T12:00:00Z'),
  });
  return { code, out, err };
}

const decisions = (fx) => fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');

// The diff block under the entry: the indented lines following the `Memory write` line.
function diffOf(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- AUTO') && l.includes('Memory write'));
  assert.notStrictEqual(at, -1, 'no Memory write entry');
  const out = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('    '); i++) out.push(lines[i].slice(4));
  return `${out.join('\n')}\n`;
}

function revert(fx, text, ceiling) {
  const patch = path.join(fx.root, 'revert.patch');
  fs.writeFileSync(patch, diffOf(text));
  // Run the one constant the CLI prints, under the autocrlf a Windows install sets: `git apply` writes
  // through autocrlf even outside a repository (#5694).
  const gitconfig = path.join(fx.root, 'autocrlf.gitconfig');
  fs.writeFileSync(gitconfig, '[core]\n\tautocrlf = true\n');
  const [bin, ...args] = MEMORY_REVERT_COMMAND.split(' ');
  assert.strictEqual(bin, 'git');
  execFileSync(bin, [...args, patch], { cwd: fx.memoryDir, env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', ...(ceiling ? { GIT_CEILING_DIRECTORIES: ceiling } : {}) }, windowsHide: true });
}

test('wholeFileDiff: header, ranges and no-newline markers', () => {
  assert.strictEqual(wholeFileDiff('a.md', 'a\nb\n', 'a\nc\n'), '--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,2 @@\n-a\n-b\n+a\n+c\n');
  assert.strictEqual(wholeFileDiff('a.md', null, 'x\n'), '--- /dev/null\n+++ b/a.md\n@@ -0,0 +1,1 @@\n+x\n');
  assert.strictEqual(wholeFileDiff('a.md', 'x', 'y'), '--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file\n');
});

test('AC4.1: a memory write logs the path, the prior hash and the old-to-new diff', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.memoryDir, 'note.md'), 'a\nb\n');
  const r = await write(fx, 'note.md', 'a\nc\n');
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(fs.readFileSync(path.join(fx.memoryDir, 'note.md'), 'utf8'), 'a\nc\n');
  const text = decisions(fx);
  assert.ok(text.includes(`Memory write ${path.join(fx.memoryDir, 'note.md')}: prior sha256 ${sha('a\nb\n')}`), text);
  assert.ok(text.includes('Reversibility: high.'), text);
  const diff = diffOf(text);
  assert.ok(diff.includes('\n-b\n') && diff.includes('\n+c\n'), diff);
});

test('AC4.1: a create logs prior sha256 none and a /dev/null diff', async () => {
  const fx = fixture();
  const r = await write(fx, 'new.md', 'hello\n');
  assert.strictEqual(r.code, 0, r.err);
  const text = decisions(fx);
  assert.ok(text.includes('prior sha256 none'), text);
  assert.ok(diffOf(text).startsWith('--- /dev/null\n'), text);
});

test('AC4.2: applying the reverse diff restores the prior content (trailing newline, none, and a create)', async () => {
  for (const prior of ['a\nb\n', 'a\nb']) {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.memoryDir, 'note.md'), prior);
    assert.strictEqual((await write(fx, 'note.md', 'a\nc\n')).code, 0);
    revert(fx, decisions(fx));
    assert.strictEqual(fs.readFileSync(path.join(fx.memoryDir, 'note.md'), 'utf8'), prior);
  }
  const fx = fixture();
  assert.strictEqual((await write(fx, 'new.md', 'hello\n')).code, 0);
  revert(fx, decisions(fx));
  assert.strictEqual(fs.existsSync(path.join(fx.memoryDir, 'new.md')), false);
});

test('AC4.2: the reverse diff also restores the prior content from a memory directory outside any git repository', async (t) => {
  const fx = fixture();
  // The real memory directory sits outside any repository; the ceiling stops git discovering one above os.tmpdir().
  const outside = fs.realpathSync(scratchDir('memory-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fx.memoryDir = outside;
  fs.writeFileSync(path.join(outside, 'note.md'), 'a\nb\n');
  assert.strictEqual((await write(fx, 'note.md', 'a\nc\n')).code, 0);
  revert(fx, decisions(fx), path.dirname(outside));
  assert.strictEqual(fs.readFileSync(path.join(outside, 'note.md'), 'utf8'), 'a\nb\n');
});

const BIG = `${'x'.repeat(100)}\n`.repeat(250);

test('AC4.2: an over-cap diff stores the prior content under staged/ and names it', async () => {
  const fx = fixture();
  assert.ok(Buffer.byteLength(wholeFileDiff('n.md', 'old\n', BIG)) > MEMORY_DIFF_CAP_BYTES);
  fs.writeFileSync(path.join(fx.memoryDir, 'n.md'), 'old\n');
  const r = await write(fx, 'n.md', BIG);
  assert.strictEqual(r.code, 0, r.err);
  const backup = path.join(fx.runDir, 'staged', `.memory-prior-${sha('old\n').slice(0, 12)}.md`);
  assert.strictEqual(fs.readFileSync(backup, 'utf8'), 'old\n');
  const text = decisions(fx);
  assert.ok(text.includes(backup), text);
  assert.ok(!text.includes('\n    @@'), 'the over-cap diff is not inlined');
});

test('an over-cap backup never becomes a console item', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.memoryDir, 'n.md'), 'old\n');
  assert.strictEqual((await write(fx, 'n.md', BIG)).code, 0);
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } }, gitApplyCheck: () => ({ ok: true }), readGrants: () => ({}), now: () => 0 };
  const withBackup = resolveAll({ runDir: fx.runDir, policy: 'console-auto', deps }).items;
  fs.rmSync(path.join(fx.runDir, 'staged', `.memory-prior-${sha('old\n').slice(0, 12)}.md`));
  const without = resolveAll({ runDir: fx.runDir, policy: 'console-auto', deps }).items;
  assert.deepStrictEqual(withBackup, without);
  assert.ok(!withBackup.some((i) => i.id.includes('memory-prior')));
});

test('AC4.3: no approval prompt — the CLI source names no AskUserQuestion', () => {
  for (const f of [CLI, path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'memory-write.js')]) {
    assert.ok(!readText(f).includes('AskUserQuestion'), f);
  }
});

test('AC4.4: a write outside the memory dir is refused and writes nothing', async () => {
  const fx = fixture();
  const outside = path.join(fx.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'victim.md'), 'keep\n');
  fs.symlinkSync(outside, path.join(fx.memoryDir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(outside, 'victim.md'), path.join(fx.memoryDir, 'filelink.md'));
  const cases = ['../escape.md', path.join(outside, 'abs.md'), 'link/in.md', 'link/victim.md', 'filelink.md'];
  for (const target of cases) {
    const before = decisions(fx);
    const r = await write(fx, target, 'pwned\n');
    assert.strictEqual(r.code, 5, `${target}: ${r.err}`);
    assert.match(r.err, /memory write refused \(outside-memory-dir\) — nothing written/);
    assert.strictEqual(decisions(fx), before, target);
  }
  assert.deepStrictEqual(fs.readdirSync(outside), ['victim.md']);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.md'), 'utf8'), 'keep\n');
  assert.strictEqual(fs.existsSync(path.join(fx.root, 'escape.md')), false);
});

test('a symlink inside the memory dir pointing at another file inside it writes the resolved file', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.memoryDir, 'real.md'), 'a\n');
  fs.symlinkSync(path.join(fx.memoryDir, 'real.md'), path.join(fx.memoryDir, 'alias.md'));
  assert.strictEqual((await write(fx, 'alias.md', 'b\n')).code, 0);
  assert.strictEqual(fs.readFileSync(path.join(fx.memoryDir, 'real.md'), 'utf8'), 'b\n');
});

test('planMemoryWrite: a missing memory dir is refused', () => {
  const fx = fixture();
  const plan = planMemoryWrite({ memoryDir: path.join(fx.root, 'nope'), target: 'a.md', content: 'x', priorText: null });
  assert.strictEqual(plan.ok, false);
});

test('a directory as the target is refused (exit 5) and logs nothing', async () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.memoryDir, 'dir.md'));
  const r = await write(fx, 'dir.md', 'x\n');
  assert.strictEqual(r.code, 5, r.err);
  assert.strictEqual(decisions(fx), '');
});

test('a missing parent directory is refused with its own why (parent-missing), exit 5, nothing written', async () => {
  const fx = fixture();
  for (const target of ['no-such-dir/x.md', 'a/b/x.md']) {
    const r = await write(fx, target, 'x\n');
    assert.strictEqual(r.code, 5, `${target}: ${r.err}`);
    assert.match(r.err, /memory write refused \(parent-missing\) — nothing written/, target);
  }
  assert.deepStrictEqual(fs.readdirSync(fx.memoryDir), []);
  assert.strictEqual(decisions(fx), '');
});

test('a missing parent outside the memory dir stays outside-memory-dir (never parent-missing)', async () => {
  const fx = fixture();
  const outside = path.join(fx.root, 'outside-dir');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(fx.memoryDir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(fx.root, 'gone-dir'), path.join(fx.memoryDir, 'dl'));
  for (const target of ['../nope/x.md', path.join(fx.root, 'elsewhere', 'nope', 'x.md'), 'link/nope/x.md', 'dl/nope/x.md']) {
    const r = await write(fx, target, 'x\n');
    assert.strictEqual(r.code, 5, `${target}: ${r.err}`);
    assert.match(r.err, /memory write refused \(outside-memory-dir\) — nothing written/, target);
  }
  assert.strictEqual(fs.existsSync(path.join(fx.root, 'nope')), false);
  assert.strictEqual(fs.existsSync(path.join(fx.root, 'elsewhere')), false);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
  assert.strictEqual(fs.existsSync(path.join(fx.root, 'gone-dir')), false);
});

test('a symlink inside the memory dir pointing at a directory inside it is refused, nothing written', async () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.memoryDir, 'sub'));
  fs.symlinkSync(path.join(fx.memoryDir, 'sub'), path.join(fx.memoryDir, 'sublink'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = await write(fx, 'sublink', 'x\n');
  assert.strictEqual(r.code, 5, r.err);
  assert.deepStrictEqual(fs.readdirSync(path.join(fx.memoryDir, 'sub')), []);
  assert.strictEqual(decisions(fx), '');
});

test('a dangling symlink target is refused and nothing is created behind it', async () => {
  const fx = fixture();
  const gone = path.join(fx.root, 'gone.md');
  fs.symlinkSync(gone, path.join(fx.memoryDir, 'dangling.md'));
  const r = await write(fx, 'dangling.md', 'x\n');
  assert.strictEqual(r.code, 5, r.err);
  assert.strictEqual(fs.existsSync(gone), false);
  assert.strictEqual(decisions(fx), '');
});

test('a failed target write exits 3, names the path and logs nothing', chmodDenialSkip('root ignores a read-only memory dir'), async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.memoryDir, 'note.md'), 'a\n');
  fs.chmodSync(fx.memoryDir, 0o555);
  try {
    const r = await write(fx, 'note.md', 'b\n');
    assert.strictEqual(r.code, 3, r.err);
    assert.ok(r.err.includes(path.join(fx.memoryDir, 'note.md')), r.err);
    assert.strictEqual(fs.readFileSync(path.join(fx.memoryDir, 'note.md'), 'utf8'), 'a\n');
    assert.strictEqual(decisions(fx), '');
  } finally { fs.chmodSync(fx.memoryDir, 0o755); }
});

test('a decisions.md that cannot be written exits 3 after the target was written, and stderr names the path', async () => {
  const fx = fixture();
  fs.rmSync(path.join(fx.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
  const r = await write(fx, 'note.md', 'b\n');
  assert.strictEqual(r.code, 3, r.err);
  assert.strictEqual(fs.readFileSync(path.join(fx.memoryDir, 'note.md'), 'utf8'), 'b\n');
  assert.match(r.err, new RegExp(`wrote ${path.join(fx.memoryDir, 'note.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, but the decisions.md entry could not be written`));
});

test('the entry head tells the reader how to reverse: strip the indent, git apply -R with autocrlf off, from the memory directory', async () => {
  const fx = fixture();
  assert.strictEqual((await write(fx, 'n.md', 'x\n')).code, 0);
  const head = decisions(fx).split('\n').find((l) => l.includes('Memory write'));
  for (const part of ['strip the 4-space indent', `${MEMORY_REVERT_COMMAND} {patch}`, 'git -c core.autocrlf=false apply -R --unidiff-zero {patch}', 'from the memory directory']) assert.ok(head.includes(part), part);
});

test('parseArgs: --memory-write needs its two companions, takes no other flag, and no other shape takes them', () => {
  const ok = parseArgs(['--memory-write', 'a.md', '--memory-dir', 'd', '--content-file', 'c', '--run', 'r']);
  assert.strictEqual(ok.memoryWrite, 'a.md');
  for (const argv of [
    ['--run', 'r', '--memory-write', 'a.md'],
    ['--run', 'r', '--memory-dir', 'd'],
    ['--run', 'r', '--content-file', 'c'],
    ['--run', 'r', '--memory-write', 'a.md', '--memory-dir', 'd', '--content-file', 'c', '--dry-run'],
    ['--run', 'r', '--memory-write', 'a.md', '--memory-dir', 'd', '--content-file', 'c', '--ceiling'],
    ['--run', 'r', '--memory-write', 'a.md', '--memory-dir', 'd', '--content-file', 'c', '--converge', 'f'],
    ['--run', 'r', '--ceiling', '--memory-dir', 'd'],
    ['--run', 'r', '--converge', 'f', '--content-file', 'c'],
    ['--run', 'r', '--policy', 'console-auto', '--memory-dir', 'd'],
    ['--run', 'r', '--set-item', 'x', '--resolution', 'pending', '--reason', 'y', '--content-file', 'c'],
    ['--run', 'r', '--check-repair', 'f', '--memory-dir', 'd'],
  ]) assert.throws(() => parseArgs(argv), /memory-write|memory-dir|content-file/, argv.join(' '));
});
