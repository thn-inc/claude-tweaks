'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseAllowedTools, reachForTool, auditSkillManifest, auditMcpServerConfig,
} = require('../../../plugin/bin/lib/issues/reachability-audit');

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
