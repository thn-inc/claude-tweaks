'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { ROLES, RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, implementerSettings, toolchainRoot, toolchainReadPaths, composeArgs, toolsFor, assertSpendCeiling } = require(path.join(LIB, 'driver', 'roles.js'));

const ALLOW_SANDBOXED = ['Read', 'Edit', 'Write', 'Bash(node --test *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)'];
const ALLOW_EDIT_ONLY = ['Read', 'Edit', 'Write'];
const DENY = ['Bash(gh *)', 'Bash(git push *)', 'Bash(git commit *)', 'Bash(git add *)', 'Bash(curl *)', 'Bash(wget *)'];
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, failIfUnavailable: true, network: { allowedDomains: [], strictAllowlist: true }, filesystem: { allowRead: [] } };

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

test('AC1.1: on darwin the read block is on and allowRead deep-equals readPaths', () => {
  const input = ['/opt/tool'];
  const s = implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: input });
  assert.strictEqual(s.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.deepStrictEqual(s.sandbox.filesystem.allowRead, ['/opt/tool']);
  assert.notStrictEqual(s.sandbox.filesystem.allowRead, input);
});

test('AC1.2: on linux and win32 neither key is present', () => {
  for (const [platform, readPaths] of [['linux', ['/opt/tool']], ['win32', ['C:\\tool']]]) {
    const s = implementerSettings({ testCommand: 'node --test', platform, readPaths });
    assert.ok(!('blockReadsOutsideWorkingDirectories' in s.permissions), platform);
    assert.ok(!('sandbox' in s), platform);
  }
});

test('AC2.1: a readPaths entry that is not a string or not absolute throws a TypeError naming it', () => {
  for (const bad of [5, null, 'relative/dir', '', './x']) {
    assert.throws(
      () => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: ['/opt/ok', bad] }),
      (e) => e instanceof TypeError && e.message.includes(JSON.stringify(bad)),
      JSON.stringify(bad),
    );
  }
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: '/opt/tool' }), (e) => e instanceof TypeError && /readPaths must be an array/.test(e.message));
});

test('AC2.1: validation runs on every platform, and win32 judges absoluteness by win32 rules', () => {
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'linux', readPaths: ['relative'] }), TypeError);
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'win32', readPaths: ['opt/tool'] }), TypeError);
  assert.doesNotThrow(() => implementerSettings({ testCommand: 'node --test', platform: 'win32', readPaths: ['C:\\tool'] }));
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'linux', readPaths: 'x' }), /readPaths must be an array/);
  assert.throws(
    () => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: ['C:\\tool'] }),
    (e) => e instanceof TypeError && e.message.includes(JSON.stringify('C:\\tool')),
  );
});

test('AC2.1: an entry that would void the block is refused: a filesystem root or a path that is not normalized', () => {
  for (const bad of ['/', '/opt/../..', '/opt/./tool', '/opt/../x', '/opt//tool']) {
    assert.throws(
      () => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [bad] }),
      (e) => e instanceof TypeError && e.message.includes(JSON.stringify(bad)),
      bad,
    );
  }
  for (const bad of ['C:\\', 'C:\\opt\\..\\x', 'C:/tool', 'C:\\tool/']) {
    assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'win32', readPaths: [bad] }), (e) => e instanceof TypeError && e.message.includes(JSON.stringify(bad)), bad);
  }
  assert.deepStrictEqual(implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: ['/opt/tool/'] }).sandbox.filesystem.allowRead, ['/opt/tool/']);
  assert.doesNotThrow(() => implementerSettings({ testCommand: 'node --test', platform: 'win32', readPaths: ['C:\\tool\\'] }));
});

test('AC2.1: an entry JSON.stringify cannot serialize is still named in the TypeError', () => {
  const cyclic = []; cyclic.push(cyclic);
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [10n] }), (e) => e instanceof TypeError && e.message.includes('10'));
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [cyclic] }), (e) => e instanceof TypeError && /\[object Array\]/.test(e.message));
  assert.throws(() => implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [Object.assign(Object.create(null), { toJSON() { throw new Error('x'); } })] }), (e) => e instanceof TypeError && e.message.includes('[object Object]'));
});

test('AC2.2: an empty readPaths keeps the block on and re-opens nothing', () => {
  const empty = implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [] });
  assert.strictEqual(empty.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.deepStrictEqual(empty.sandbox.filesystem.allowRead, []);
  assert.deepStrictEqual(implementerSettings({ testCommand: 'node --test', platform: 'darwin' }), empty);
});

test('AC5.1: no role settings or arguments carry additionalDirectories or --add-dir', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.ok(!JSON.stringify(implementerSettings({ testCommand: 'node --test', platform, readPaths: [platform === 'win32' ? 'C:\\tool' : '/opt/tool'] })).includes('additionalDirectories'), platform);
    for (const role of Object.keys(ROLES)) {
      const args = composeArgs({ role, settingsFile: '/s/settings.json', schema: RESULT_SCHEMA, platform });
      assert.ok(!args.includes('--add-dir'), role + ' ' + platform);
    }
  }
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
  assert.notStrictEqual(a.sandbox.filesystem.allowRead, b.sandbox.filesystem.allowRead);
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

function fakeDeps({ lookup = {}, realpath = {}, firstLine = {}, home, lookupThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    home,
    lookup(name) {
      calls.push(name);
      if (lookupThrows) throw new Error('lookup boom');
      return name in lookup ? lookup[name] : null;
    },
    realpath(p) {
      if (realpath[p] instanceof Error) throw realpath[p];
      return p in realpath ? realpath[p] : p;
    },
    firstLine(p) {
      if (firstLine[p] instanceof Error) throw firstLine[p];
      return p in firstLine ? firstLine[p] : '';
    },
  };
}

test('AC3.1: toolchainRoot returns the root above bin, the binary\'s own directory, or null', () => {
  const d = fakeDeps({ lookup: { node: '/h/.nvm/versions/node/v22/bin/node', tool: '/opt/tools/node' } });
  assert.strictEqual(toolchainRoot('node --test', d), '/h/.nvm/versions/node/v22');
  assert.strictEqual(toolchainRoot('node', d), '/h/.nvm/versions/node/v22');
  assert.strictEqual(toolchainRoot('tool', d), '/opt/tools');
  assert.strictEqual(toolchainRoot('missing', d), null);
});

test('toolchainRoot resolves through realpath', () => {
  const d = fakeDeps({ lookup: { npm: '/h/.nvm/v22/bin/npm' }, realpath: { '/h/.nvm/v22/bin/npm': '/h/.nvm/v22/lib/node_modules/npm/bin/npm-cli.js' } });
  assert.strictEqual(toolchainRoot('npm test', d), '/h/.nvm/v22/lib/node_modules/npm');
});

test('toolchainRoot never returns home, an ancestor of it, or /', () => {
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/h/bin/tool' }, home: '/h' })), '/h/bin');
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/bin/tool' }, home: '/h/x' })), '/bin');
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/h/tool' }, home: '/h' })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/tool' }, home: '/h' })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/tool' } })), null);
  assert.strictEqual(toolchainRoot('bash', fakeDeps({ lookup: { bash: '/bin/bash' } })), '/bin');
});

test('toolchainRoot compares against home as given and through its real path', () => {
  const real = { '/link': '/real/home' };
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/link/tool' }, home: '/link', realpath: real })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/real/tool' }, home: '/link', realpath: real })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/link/bin/tool' }, home: '/link', realpath: real })), '/link/bin');
  const broken = fakeDeps({ lookup: { tool: '/h/tool' }, home: '/h', realpath: { '/h': new Error('boom') } });
  assert.strictEqual(toolchainRoot('tool', broken), null);
});

test('toolchainRoot treats a non-absolute resolved path as unresolved', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' }, realpath: { '/x/bin/node': 'rel/bin/node' } });
  assert.strictEqual(toolchainRoot('node', d), null);
  assert.deepStrictEqual(toolchainReadPaths('node --test', d), []);
});

test('toolchainRoot returns null when lookup returns an empty string', () => {
  assert.strictEqual(toolchainRoot('node', fakeDeps({ lookup: { node: '' }, realpath: { '': '/x/bin/node' } })), null);
});

const NPM_DEPS = {
  lookup: { npm: '/h/.nvm/v22/bin/npm', node: '/h/.nvm/v22/bin/node' },
  realpath: { '/h/.nvm/v22/bin/npm': '/h/.nvm/v22/lib/node_modules/npm/bin/npm-cli.js' },
};
const NPM_REAL = '/h/.nvm/v22/lib/node_modules/npm/bin/npm-cli.js';

test('toolchainReadPaths resolves the command once and derives root and shebang from that one answer', () => {
  let lookups = 0;
  const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node' } });
  const lookup = d.lookup;
  d.lookup = (name) => { if (name === 'npm') lookups++; return lookup(name); };
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22']);
  assert.strictEqual(lookups, 1);
});

test('toolchainReadPaths skips env assignments and env options that take an argument', () => {
  for (const line of ['#!/usr/bin/env NAME=1 node', '#!/usr/bin/env -u FOO node', '#!/usr/bin/env -C /x A=b node --flag']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22'], line);
  }
});

test('toolchainReadPaths adds nothing for a bare shebang, an env with no name, or a non-shebang line, and reads a CRLF shebang', () => {
  const only = ['/h/.nvm/v22/lib/node_modules/npm'];
  for (const line of ['#!', '#!   ', '#!/usr/bin/env', '#!/usr/bin/env -S', '#!/usr/bin/env -u FOO', 'console.log(1)']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), only, JSON.stringify(line));
  }
  const crlf = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node\r' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', crlf), [...only, '/h/.nvm/v22']);
});

test('toolchainRoot returns null when lookup throws', () => {
  assert.strictEqual(toolchainRoot('node', fakeDeps({ lookupThrows: true })), null);
});

test('toolchainReadPaths refuses a bad testCommand before any seam runs', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' } });
  assert.throws(() => toolchainReadPaths(undefined, d), (e) => e instanceof TypeError && /testCommand/.test(e.message));
  assert.throws(() => toolchainReadPaths('node -e', d), (e) => e instanceof TypeError && /testCommand/.test(e.message));
  assert.deepStrictEqual(d.calls, []);
});

test('toolchainRoot takes an absolute first word as the path and refuses a relative one', () => {
  const d = fakeDeps();
  assert.strictEqual(toolchainRoot('/opt/t/bin/run --x', d), '/opt/t');
  assert.strictEqual(toolchainRoot('./node_modules/.bin/jest', d), null);
  assert.deepStrictEqual(d.calls, []);
});

test('toolchainRoot returns null when realpath throws', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' }, realpath: { '/x/bin/node': new Error('boom') } });
  assert.strictEqual(toolchainRoot('node', d), null);
});

test('toolchainReadPaths follows an env shebang one level', () => {
  const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22']);
});

test('toolchainReadPaths follows an absolute shebang and skips env options', () => {
  const abs = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/local/bin/python3' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', abs), ['/h/.nvm/v22/lib/node_modules/npm', '/usr/local']);
  const opts = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env -S node --flag' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', opts), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22']);
});

test('toolchainReadPaths drops nulls and duplicates, and a throwing firstLine adds nothing', () => {
  assert.deepStrictEqual(toolchainReadPaths('npm test', fakeDeps()), []);
  const same = fakeDeps({ lookup: { tool: '/o/bin/tool', node: '/o/bin/node' }, firstLine: { '/o/bin/tool': '#!/usr/bin/env node' } });
  assert.deepStrictEqual(toolchainReadPaths('tool run', same), ['/o']);
  const boom = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: new Error('boom') } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', boom), ['/h/.nvm/v22/lib/node_modules/npm']);
});

test('toolchainReadPaths skips GNU env long options with a separate argument', () => {
  for (const line of ['#!/usr/bin/env --chdir /opt/proj node', '#!/usr/bin/env --unset FOO node']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22'], line);
  }
});

test('toolchainReadPaths adds no interpreter when env searches an alternate path', () => {
  for (const line of ['#!/usr/bin/env -P /opt/alt node', '#!/usr/bin/env -P/opt/alt node', '#!/usr/bin/env -i -P /opt/alt node']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm'], line);
  }
});

test('toolchainReadPaths reads an attached -S string', () => {
  const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env -Snode --flag' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22']);
});

test('toolchainRoot treats a non-normalized resolved path as unresolved', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' }, realpath: { '/x/bin/node': '/x/../bin/node' } });
  assert.strictEqual(toolchainRoot('node', d), null);
});

test('toolchainReadPaths adds no interpreter for any env option it does not know', () => {
  const only = ['/h/.nvm/v22/lib/node_modules/npm'];
  const lines = [
    '#!/usr/bin/env -iP /opt/alt node', '#!/usr/bin/env -iC /opt/proj node',
    '#!/usr/bin/env -a /opt/x node', '#!/usr/bin/env --argv0 /opt/x node', '#!/usr/bin/env --chd /opt/proj node',
    '#!/usr/bin/env --bogus node', '#!/usr/bin/env -z node',
  ];
  for (const line of lines) {
    // A lookup that would resolve the option token itself: taking it as the interpreter must show.
    const lookup = { ...NPM_DEPS.lookup };
    for (const tok of line.split(/\s+/)) if (tok.startsWith('-')) lookup[tok] = '/zzz/bin/tool';
    const d = fakeDeps({ ...NPM_DEPS, lookup, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), only, line);
  }
});

test('toolchainReadPaths still reads the interpreter past the known env flags and attached arguments', () => {
  const both = ['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22'];
  const lines = [
    '#!/usr/bin/env node', '#!/usr/bin/env -i node', '#!/usr/bin/env - node', '#!/usr/bin/env -0 -v node',
    '#!/usr/bin/env --ignore-environment --null --debug node', '#!/usr/bin/env -uFOO node', '#!/usr/bin/env -C/opt/proj node',
    '#!/usr/bin/env --unset=FOO node', '#!/usr/bin/env --chdir=/opt/proj node', '#!/usr/bin/env -i -S node --flag',
  ];
  for (const line of lines) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), both, line);
  }
});
