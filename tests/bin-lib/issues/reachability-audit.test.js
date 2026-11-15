'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseAllowedTools, reachForTool, auditSkillManifest, auditMcpServerConfig,
} = require('../../../plugin/bin/lib/issues/reachability-audit');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'reachability-audit.js');

// --- parseAllowedTools ---

test('parseAllowedTools reads a comma-separated allowed-tools frontmatter line', () => {
  const content = '---\nname: foo\nallowed-tools: Read, Grep, Glob, Bash, AskUserQuestion\n---\nbody\n';
  assert.deepStrictEqual(
    parseAllowedTools(content),
    ['Read', 'Grep', 'Glob', 'Bash', 'AskUserQuestion'],
  );
});

test('parseAllowedTools returns null when there is no frontmatter fence', () => {
  assert.strictEqual(parseAllowedTools('# just a heading\nno fence here\n'), null);
});

test('parseAllowedTools returns null when frontmatter exists but has no allowed-tools key', () => {
  const content = '---\nname: foo\ndescription: bar\n---\nbody\n';
  assert.strictEqual(parseAllowedTools(content), null);
});

test('parseAllowedTools returns [] when allowed-tools is present but empty', () => {
  const content = '---\nname: foo\nallowed-tools:\n---\nbody\n';
  assert.deepStrictEqual(parseAllowedTools(content), []);
});

// --- reachForTool ---

test('reachForTool grades Read as filesystem read-only, no network/secrets', () => {
  assert.deepStrictEqual(reachForTool('Read'), { fs: 'read' });
});

test('reachForTool grades Bash as full reach (fs write, network, secrets)', () => {
  const reach = reachForTool('Bash');
  assert.strictEqual(reach.fs, 'write');
  assert.strictEqual(reach.network, true);
  assert.strictEqual(reach.secrets, true);
});

test('reachForTool grades an unrecognized/mcp__ tool name as full reach and marks it unknown', () => {
  const reach = reachForTool('mcp__github__create_pull_request');
  assert.strictEqual(reach.fs, 'write');
  assert.strictEqual(reach.network, true);
  assert.strictEqual(reach.secrets, true);
  assert.strictEqual(reach.unknown, true);
});

// --- auditSkillManifest: narrow-reach passes clean ---

test('auditSkillManifest: a narrow-reach skill (read-only tools) audits clean', () => {
  const content = '---\nname: narrow\nallowed-tools: Read, Grep, Glob\n---\nbody\n';
  const result = auditSkillManifest(content);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.clean, true);
  assert.deepStrictEqual(result.flags, []);
  assert.strictEqual(result.filesystem, 'read');
  assert.strictEqual(result.network, false);
  assert.strictEqual(result.secrets, false);
  assert.deepStrictEqual(result.unknownTools, []);
});

test('auditSkillManifest: a tools-free skill (AskUserQuestion only) audits clean', () => {
  const content = '---\nname: ask-only\nallowed-tools: AskUserQuestion\n---\nbody\n';
  const result = auditSkillManifest(content);
  assert.strictEqual(result.clean, true);
  assert.strictEqual(result.filesystem, null);
});

// --- auditSkillManifest: broad-reach flags each category separately ---

test('auditSkillManifest: a broad-reach skill flags filesystem, network, and secrets separately', () => {
  const content = '---\nname: broad\nallowed-tools: Read, Write, Bash, WebFetch, mcp__github__create_pull_request\n---\nbody\n';
  const result = auditSkillManifest(content);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.filesystem, 'write');
  assert.strictEqual(result.network, true);
  assert.strictEqual(result.secrets, true);
  assert.deepStrictEqual(result.flags.sort(), ['filesystem:write', 'network', 'secrets'].sort());
  assert.deepStrictEqual(result.unknownTools, ['mcp__github__create_pull_request']);
});

test('auditSkillManifest: WebFetch alone flags only network, not filesystem or secrets', () => {
  const content = '---\nname: fetch-only\nallowed-tools: WebFetch\n---\nbody\n';
  const result = auditSkillManifest(content);
  assert.strictEqual(result.clean, false);
  assert.deepStrictEqual(result.flags, ['network']);
  assert.strictEqual(result.filesystem, null);
  assert.strictEqual(result.secrets, false);
});

// --- auditSkillManifest: malformed/unreadable fails closed ---

test('auditSkillManifest: a manifest with no frontmatter fence fails closed, not clean', () => {
  const result = auditSkillManifest('# No frontmatter at all\njust prose\n');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.filesystem, 'write');
  assert.strictEqual(result.network, true);
  assert.strictEqual(result.secrets, true);
  assert.ok(result.flags.includes('unreadable'));
});

test('auditSkillManifest: empty content fails closed', () => {
  const result = auditSkillManifest('');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.clean, false);
});

test('auditSkillManifest: non-string input fails closed rather than throwing', () => {
  assert.doesNotThrow(() => auditSkillManifest(null));
  assert.doesNotThrow(() => auditSkillManifest(undefined));
  assert.doesNotThrow(() => auditSkillManifest(42));
  assert.strictEqual(auditSkillManifest(null).clean, false);
});

test('auditSkillManifest: frontmatter present but missing allowed-tools fails closed', () => {
  const content = '---\nname: foo\ndescription: bar\n---\nbody\n';
  const result = auditSkillManifest(content);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.clean, false);
});

// --- auditMcpServerConfig ---

test('auditMcpServerConfig: a well-formed server entry is always graded broad reach (never clean)', () => {
  const result = auditMcpServerConfig({ command: 'npx', args: ['-y', 'some-mcp-server'], env: {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.filesystem, 'write');
  assert.strictEqual(result.network, true);
  assert.strictEqual(result.secrets, false);
  assert.deepStrictEqual(result.secretEnvVars, []);
  assert.deepStrictEqual(result.flags, ['filesystem:write', 'network']);
});

test('auditMcpServerConfig: secret-shaped env var names are surfaced and flagged', () => {
  const result = auditMcpServerConfig({
    command: 'node',
    args: ['server.js'],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'info', API_SECRET_KEY: '${API_SECRET_KEY}' },
  });
  assert.strictEqual(result.secrets, true);
  assert.deepStrictEqual(result.secretEnvVars.sort(), ['API_SECRET_KEY', 'GITHUB_TOKEN'].sort());
  assert.ok(result.flags.includes('secrets'));
});

test('auditMcpServerConfig: a malformed config (no command) fails closed', () => {
  const result = auditMcpServerConfig({ args: ['foo'] });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.clean, false);
  assert.ok(result.flags.includes('unreadable'));
});

test('auditMcpServerConfig: a non-object config fails closed rather than throwing', () => {
  assert.doesNotThrow(() => auditMcpServerConfig(null));
  assert.doesNotThrow(() => auditMcpServerConfig('not an object'));
  assert.doesNotThrow(() => auditMcpServerConfig([1, 2, 3]));
  assert.strictEqual(auditMcpServerConfig(null).clean, false);
});

// --- CLI script entry (#5386) ---

// Real process: proves the script entry, exit code 0 and the one JSON line on stdout.
test('AC5.1 AC7.1: --skill on a clean fixture exits 0 with one JSON line', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reach-script-')));
  const skill = path.join(tmp, 'SKILL.md');
  fs.writeFileSync(skill, '---\nname: narrow\nallowed-tools: Read, Grep, Glob\n---\nbody\n');
  const res = spawnCli(CLI, ['--skill', skill], { env: { PATH: process.env.PATH } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(res.stderr, '');
  assert.ok(res.stdout.endsWith('\n') && res.stdout.indexOf('\n') === res.stdout.length - 1, 'one line');
  assert.strictEqual(JSON.parse(res.stdout).clean, true);
});

// Real process: proves the script entry's exit code 2 and the usage text on stderr.
test('AC7.1: no arguments exits 2 with the usage on stderr', () => {
  const res = spawnCli(CLI, [], { env: { PATH: process.env.PATH } });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(
    res.stderr,
    'reachability-audit: usage: reachability-audit.js --skill <path> | --mcp-server <path> [--server-name <name>]\n',
  );
});

// --- In-process entry (#5386) ---

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reach-')));
}

test('AC3.1: require() prints nothing and leaves process.exitCode undefined', () => {
  const origWrite = process.stdout.write;
  const origExit = process.exitCode;
  const writes = [];
  delete require.cache[CLI];
  process.stdout.write = function capture(chunk) { writes.push(String(chunk)); return true; };
  let exitCode;
  try {
    require(CLI);
    exitCode = process.exitCode;
  } finally {
    process.stdout.write = origWrite;
    delete require.cache[CLI];
    process.exitCode = origExit;
  }
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(exitCode, undefined);
});

test('AC8.1: a relative --skill path resolves against deps.cwd()', () => {
  const tmp = tmpDir();
  fs.writeFileSync(path.join(tmp, 'SKILL.md'), '---\nname: narrow\nallowed-tools: Read, Grep\n---\nbody\n');
  const res = runCliSync(CLI, ['--skill', 'SKILL.md'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).clean, true);
});

test('a missing relative --skill path prints the absolute path resolved against deps.cwd()', () => {
  const tmp = tmpDir();
  const res = runCliSync(CLI, ['--skill', 'nope/SKILL.md'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(
    res.stderr,
    `reachability-audit: cannot read --skill path: ${path.resolve(tmp, 'nope/SKILL.md')} (ENOENT)\n`,
  );
});

test('a missing relative --mcp-server path prints err.message with the path as typed', () => {
  const tmp = tmpDir();
  const inProc = runCliSync(CLI, ['--mcp-server', 'nope.json'], { cwd: tmp });
  const spawned = spawnCli(CLI, ['--mcp-server', 'nope.json'], { cwd: tmp, env: { PATH: process.env.PATH } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(inProc.code, 2);
  assert.strictEqual(inProc.stdout, '');
  assert.match(inProc.stderr, /\(ENOENT: no such file or directory, open 'nope\.json'\)\n$/);
  assert.strictEqual(inProc.code, spawned.code);
  assert.strictEqual(inProc.stdout, spawned.stdout);
  assert.strictEqual(inProc.stderr, spawned.stderr);
});

// A deleted working directory: process.cwd() throws ENOENT. An absolute path never needs it.
const deletedCwd = () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); };

test('an absolute --skill / --mcp-server path works when deps.cwd() throws (deleted cwd)', () => {
  const tmp = tmpDir();
  const skill = path.join(tmp, 'SKILL.md');
  fs.writeFileSync(skill, '---\nname: narrow\nallowed-tools: Read, Grep\n---\nbody\n');
  const ok = runCliSync(CLI, ['--skill', skill], { deps: { cwd: deletedCwd } });
  const missingSkill = runCliSync(CLI, ['--skill', path.join(tmp, 'nope', 'SKILL.md')], { deps: { cwd: deletedCwd } });
  const missingMcp = runCliSync(CLI, ['--mcp-server', path.join(tmp, 'nope.json')], { deps: { cwd: deletedCwd } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(ok.code, 0, ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).clean, true);
  assert.strictEqual(missingSkill.code, 2);
  assert.strictEqual(missingSkill.stderr, `reachability-audit: cannot read --skill path: ${path.join(tmp, 'nope', 'SKILL.md')} (ENOENT)\n`);
  assert.strictEqual(missingMcp.code, 2);
  assert.match(missingMcp.stderr, /^reachability-audit: cannot read\/parse --mcp-server path: .*nope\.json \(ENOENT: /);
});
