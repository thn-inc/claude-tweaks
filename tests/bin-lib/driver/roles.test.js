'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { ROLES, RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, implementerSettings, composeArgs, toolsFor, assertSpendCeiling } = require(path.join(LIB, 'driver', 'roles.js'));

const ALLOW_SANDBOXED = ['Read', 'Edit', 'Write', 'Bash(node --test *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)'];
const ALLOW_EDIT_ONLY = ['Read', 'Edit', 'Write'];
const DENY = ['Bash(gh *)', 'Bash(git push *)', 'Bash(git commit *)', 'Bash(git add *)', 'Bash(curl *)', 'Bash(wget *)'];
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, failIfUnavailable: true, network: { allowedDomains: [], strictAllowlist: true } };

test('AC2: implementer settings on a sandbox-probed platform pin defaultMode and the exact allow and deny lists', () => {
  const s = implementerSettings({ testCommand: 'node --test', platform: 'darwin' });
  assert.strictEqual(s.permissions.defaultMode, 'dontAsk');
  assert.deepStrictEqual(s.permissions.allow, ALLOW_SANDBOXED);
  assert.deepStrictEqual(s.permissions.deny, DENY);
});

test('AC2: the test command is a parameter, and no other interpreter rule exists', () => {
  const s = implementerSettings({ testCommand: 'npm test --', platform: 'darwin' });
  assert.ok(s.permissions.allow.includes('Bash(npm test -- *)'));
  const others = s.permissions.allow.filter((r) => r !== 'Bash(npm test -- *)');
  for (const r of others) assert.doesNotMatch(r, /^Bash\((node|npm|sh|bash|python)\b/);
});

test('AC12: on a sandbox-probed platform the sandbox block is present with these exact keys', () => {
  assert.deepStrictEqual(SANDBOX_PROBED_PLATFORMS, ['darwin']);
  assert.deepStrictEqual(implementerSettings({ testCommand: 'node --test', platform: 'darwin' }).sandbox, SANDBOX);
});

test('AC12: off the sandbox-probed platforms the implementer has no Bash at all', () => {
  for (const platform of ['linux', 'win32']) {
    const s = implementerSettings({ testCommand: 'node --test', platform });
    assert.deepStrictEqual(Object.keys(s), ['permissions']);
    assert.deepStrictEqual(s.permissions.allow, ALLOW_EDIT_ONLY);
    assert.deepStrictEqual(s.permissions.deny, DENY);
    assert.ok(!('sandbox' in s));
    for (const r of s.permissions.allow) assert.ok(!r.startsWith('Bash('), r);
    const args = composeArgs({ role: 'implementer', settingsFile: '/s/settings.json', schema: RESULT_SCHEMA, platform });
    assert.strictEqual(args[args.indexOf('--tools') + 1], 'Read,Write,Edit');
  }
});

test('AC12: toolsFor drops Bash for a settings role off the probed platforms, and returns a fresh array', () => {
  assert.deepStrictEqual(toolsFor('implementer', 'darwin'), ['Read', 'Write', 'Edit', 'Bash']);
  assert.deepStrictEqual(toolsFor('implementer', 'linux'), ['Read', 'Write', 'Edit']);
  assert.deepStrictEqual(toolsFor('implementer', 'win32'), ['Read', 'Write', 'Edit']);
  for (const platform of ['darwin', 'linux']) assert.deepStrictEqual(toolsFor('reviewer', platform), ['Read', 'Grep', 'Glob']);
  assert.notStrictEqual(toolsFor('reviewer', 'darwin'), ROLES.reviewer.tools);
  assert.ok(!Object.isFrozen(toolsFor('implementer', 'darwin')));
});

test('AC12: composeArgs requires a platform for every role', () => {
  for (const platform of [undefined, '', 5, null]) {
    assert.throws(() => composeArgs({ role: 'reviewer', schema: RESULT_SCHEMA, platform }), (e) => e instanceof TypeError && /platform/.test(e.message), String(platform));
    assert.throws(() => composeArgs({ role: 'implementer', settingsFile: '/s/x.json', schema: RESULT_SCHEMA, platform }), /platform/, String(platform));
  }
});

test('Minor: a testCommand that widens the rule is refused, and the usual runners stay allowed', () => {
  for (const bad of [' node --test', 'node --test ', 'node  --test', 'bash -c', 'node -e', 'node --eval', 'node -p', 'node --print', 'python -c', 'sh', 'bash', 'zsh', 'node', 'python', 'python3']) {
    assert.throws(() => implementerSettings({ testCommand: bad, platform: 'darwin' }), /testCommand/, JSON.stringify(bad));
  }
  for (const good of ['pytest', 'make', 'node --test', 'npm test --']) {
    assert.ok(implementerSettings({ testCommand: good, platform: 'darwin' }).permissions.allow.includes('Bash(' + good + ' *)'), good);
  }
});

test('Minor: composeArgs refuses a missing settings file or schema', () => {
  assert.throws(() => composeArgs({ role: 'implementer', schema: RESULT_SCHEMA }), /settingsFile/);
  assert.throws(() => composeArgs({ role: 'implementer', settingsFile: '', schema: RESULT_SCHEMA }), /settingsFile/);
  assert.throws(() => composeArgs({ role: 'reviewer' }), /schema/);
  assert.throws(() => composeArgs({ role: 'reviewer', schema: 'x' }), /schema/);
  assert.throws(() => composeArgs({ role: 'reviewer', schema: null }), /schema/);
  assert.throws(() => composeArgs({ role: 'reviewer', schema: [] }), /schema/);
});

test('Minor: a given spendCeiling must be a finite number above zero', () => {
  for (const bad of [0, -1, NaN, Infinity, '2']) {
    assert.throws(() => composeArgs({ role: 'reviewer', schema: RESULT_SCHEMA, spendCeiling: bad }), RangeError, String(bad));
  }
});

test('Minor: assertSpendCeiling is the one rule: undefined and positive finite numbers pass, the rest throw RangeError', () => {
  assert.doesNotThrow(() => assertSpendCeiling(undefined));
  assert.doesNotThrow(() => assertSpendCeiling(0.0001));
  for (const bad of [0, -1, NaN, Infinity, '2', null]) assert.throws(() => assertSpendCeiling(bad), RangeError, String(bad));
});

test('Minor: the exported tables are frozen, and the builders return fresh objects', () => {
  for (const v of [ROLES, ROLES.reviewer.tools, RESULT_SCHEMA, RESULT_SCHEMA.properties.status.enum, SANDBOX_PROBED_PLATFORMS]) assert.ok(Object.isFrozen(v));
  const a = implementerSettings({ testCommand: 'node --test', platform: 'darwin' });
  const b = implementerSettings({ testCommand: 'node --test', platform: 'darwin' });
  assert.notStrictEqual(a.permissions.allow, b.permissions.allow);
  assert.ok(!Object.isFrozen(a.permissions.allow));
  const args = composeArgs({ role: 'reviewer', schema: RESULT_SCHEMA, platform: 'darwin' });
  assert.ok(!Object.isFrozen(args));
});

test('Review focus: a testCommand that would corrupt the rule is refused', () => {
  for (const bad of ['node --test)', 'node\n--test', '', 'a*b', undefined]) {
    assert.throws(() => implementerSettings({ testCommand: bad, platform: 'darwin' }), /testCommand/);
  }
});

test('AC1: the implementer argument list carries every flag, in this exact order', () => {
  const args = composeArgs({ role: 'implementer', settingsFile: '/s/settings.json', appendPromptFile: '/s/append.md', schema: RESULT_SCHEMA, spendCeiling: 2.5, model: 'haiku', platform: 'darwin' });
  assert.deepStrictEqual(args, [
    '-p', '--safe-mode', '--restricted', '--tools', 'Read,Write,Edit,Bash', '--disable-slash-commands', '--strict-mcp-config',
    '--settings', '/s/settings.json', '--permission-prompts', 'none', '--output-format', 'json',
    '--json-schema', JSON.stringify(RESULT_SCHEMA), '--append-system-prompt-file', '/s/append.md', '--max-budget-usd', '2.5', '--model', 'haiku',
  ]);
});

test('AC1: optional parts are omitted when not given', () => {
  const args = composeArgs({ role: 'implementer', settingsFile: '/s/settings.json', schema: RESULT_SCHEMA, platform: 'darwin' });
  for (const flag of ['--append-system-prompt-file', '--max-budget-usd', '--model']) assert.ok(!args.includes(flag), flag);
});

test('AC3: reviewer and explorer launch with --restricted, read-only tools, no Bash and no settings file', () => {
  for (const role of ['reviewer', 'explorer']) {
    const args = composeArgs({ role, schema: RESULT_SCHEMA, platform: 'darwin' });
    assert.deepStrictEqual(args, ['-p', '--safe-mode', '--restricted', '--tools', 'Read,Grep,Glob', '--disable-slash-commands', '--strict-mcp-config', '--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMA)]);
    assert.ok(!ROLES[role].tools.includes('Bash'));
    assert.strictEqual(ROLES[role].settings, false);
  }
});

test('AC1: no role ever carries a bypass, in arguments or settings', () => {
  const settings = JSON.stringify(['darwin', 'linux', 'win32'].map((platform) => implementerSettings({ testCommand: 'node --test', platform })));
  for (const role of Object.keys(ROLES)) {
    const text = composeArgs({ role, settingsFile: '/s/x.json', appendPromptFile: '/s/a.md', schema: RESULT_SCHEMA, spendCeiling: 1, model: 'm', platform: 'darwin' }).join('\n') + settings;
    assert.ok(!text.includes('--dangerously-skip-permissions'));
    assert.ok(!text.includes('bypassPermissions'));
    assert.ok(!text.includes('--setting-sources'));
  }
});

test('composeArgs refuses an unknown role', () => {
  assert.throws(() => composeArgs({ role: 'merger', schema: RESULT_SCHEMA }), /unknown role/);
});

test('Task 0 fixtures carry the field names the launcher reads', () => {
  const ok = require('./fixtures/worker-result.json');
  const budget = require('./fixtures/worker-result-budget.json');
  for (const k of ['type', 'subtype', 'is_error', 'num_turns', 'total_cost_usd', 'usage', 'permission_denials', 'structured_output']) assert.ok(k in ok, k);
  assert.strictEqual(budget.subtype, 'error_max_budget_usd');
  assert.ok(!('structured_output' in budget));
});

test('AC2.1, AC3.1: the implementer tool list per platform is what the Grep/Glob probe supports (#5239)', () => {
  assert.deepStrictEqual(toolsFor('implementer', 'darwin'), ['Read', 'Write', 'Edit', 'Bash']);
  for (const platform of ['linux', 'win32']) {
    assert.deepStrictEqual(toolsFor('implementer', platform), ['Read', 'Write', 'Edit'], platform);
    const allow = implementerSettings({ testCommand: 'node --test', platform }).permissions.allow;
    assert.deepStrictEqual(allow, ['Read', 'Edit', 'Write'], platform);
    for (const rule of allow) assert.ok(!/^(Bash|Grep|Glob)\b/.test(rule), platform + ': ' + rule);
    const args = composeArgs({ role: 'implementer', settingsFile: '/s/x.json', schema: RESULT_SCHEMA, platform });
    assert.strictEqual(args[args.indexOf('--tools') + 1], 'Read,Write,Edit', platform);
  }
});
