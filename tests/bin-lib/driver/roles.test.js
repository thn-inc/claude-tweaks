'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { conformsTo } = require(path.join(LIB, 'driver', 'worker.js'));
const { ROLES, RESULT_SCHEMA, REVIEW_RESULT_SCHEMA, MERGE_CHECK_RESULT_SCHEMA, ACCEPTANCE_RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, implementerSettings, toolchainRoot, toolchainReadPaths, reopensHome, composeArgs, toolsFor, assertSpendCeiling, assertEffort, DRIVER_ROLE_PROFILES, POLICY_DRIVER_ROLES, LENS_REPLY_SCHEMA, LENS_GIT_RULES, lensReviewerSettings, lensAdmittedFormsNote, settingsFor, lensGitEnv, LENS_EMPTY_GIT_CONFIG } = require(path.join(LIB, 'driver', 'roles.js'));
const { PROFILES, EFFORT_SCALE } = require(path.join(LIB, 'model-profiles', 'profiles.js'));

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

test('#5942 composeArgs: effort appends --effort {level} after --model', () => {
  for (const lvl of EFFORT_SCALE) {
    const args = composeArgs({ role: 'reviewer', schema: REVIEW_RESULT_SCHEMA, model: 'sonnet', effort: lvl, platform: 'darwin' });
    assert.deepStrictEqual(args.slice(-4), ['--model', 'sonnet', '--effort', lvl]);
    assert.strictEqual(args.filter((a) => a === '--effort').length, 1);
  }
});

test('#5942 AC1.1 (argv): no effort, or effort null, composes no --effort', () => {
  for (const role of Object.keys(ROLES)) {
    const common = { role, settingsFile: '/s/x.json', schema: RESULT_SCHEMA, model: 'sonnet', platform: 'darwin' };
    assert.ok(!composeArgs(common).includes('--effort'), role + ' omitted');
    assert.ok(!composeArgs({ ...common, effort: null }).includes('--effort'), role + ' null');
  }
});

test('#5942 AC5.1: composeArgs refuses an unknown effort', () => {
  for (const bad of ['extreme', 'HIGH', '', 1]) {
    assert.throws(() => composeArgs({ role: 'reviewer', schema: REVIEW_RESULT_SCHEMA, model: 'sonnet', effort: bad, platform: 'darwin' }), RangeError, String(bad));
  }
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

test('#5942: assertEffort accepts undefined, null and every EFFORT_SCALE level; anything else throws RangeError', () => {
  assert.doesNotThrow(() => assertEffort(undefined));
  assert.doesNotThrow(() => assertEffort(null));
  for (const lvl of EFFORT_SCALE) assert.doesNotThrow(() => assertEffort(lvl), lvl);
  for (const bad of ['extreme', 'HIGH', '', 1]) assert.throws(() => assertEffort(bad), RangeError, String(bad));
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
  for (const bad of ['node --test)', 'node\n--test', '', 'a*b']) {
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

test('AC1: every role but the implementer launches with no Bash, Edit or Write', () => {
  for (const role of Object.keys(ROLES)) {
    if (role === 'implementer') continue;
    for (const p of ['darwin', 'linux', 'win32']) {
      // The lens-reviewer has Bash where the sandbox was probed, and never Edit or Write.
      const want = role === 'lens-reviewer' && SANDBOX_PROBED_PLATFORMS.includes(p) ? ['Bash'] : [];
      assert.deepEqual(toolsFor(role, p).filter((t) => ['Bash', 'Edit', 'Write'].includes(t)), want, role + ' on ' + p);
    }
  }
  for (const [role, schema] of [['merge-check', MERGE_CHECK_RESULT_SCHEMA], ['acceptance', ACCEPTANCE_RESULT_SCHEMA]]) {
    assert.deepEqual(ROLES[role], { tools: ['Read', 'Grep', 'Glob'], settings: false });
    const args = composeArgs({ role, schema, platform: 'darwin' });
    assert.ok(args.includes('--restricted'), role);
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob', role);
    assert.ok(!args.includes('--settings'), role);
  }
});

test('AC1: no role has an allow rule that can run gh', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const allow = [
      ...implementerSettings({ testCommand: 'npm test', platform, readPaths: [] }).permissions.allow,
      ...lensReviewerSettings({ platform, readPaths: [] }).permissions.allow,
    ];
    for (const rule of allow) {
      assert.ok(!/^Bash\(\s*gh\b/.test(rule), rule);
      assert.ok(!['Bash', 'Bash(*)'].includes(rule), rule);
      assert.ok(!/^Bash\(\s*\*/.test(rule), rule);
    }
  }
  for (const role of Object.keys(ROLES)) {
    if (role === 'implementer') continue;
    assert.strictEqual(ROLES[role].settings, role === 'lens-reviewer', role);
  }
});

test('merge-check and acceptance result schemas use only the launcher subset', () => {
  assert.ok(conformsTo(MERGE_CHECK_RESULT_SCHEMA, { verdict: 'auto-merge', rationale: 'x' }));
  assert.ok(conformsTo(MERGE_CHECK_RESULT_SCHEMA, { verdict: 'needs-human', rationale: 'x' }));
  assert.ok(!conformsTo(MERGE_CHECK_RESULT_SCHEMA, { verdict: 'Auto-Merge', rationale: 'x' }));
  assert.ok(!conformsTo(MERGE_CHECK_RESULT_SCHEMA, { verdict: 'auto-merge' }));
  assert.ok(!conformsTo(MERGE_CHECK_RESULT_SCHEMA, { verdict: 'auto-merge', rationale: 'x', extra: 'y' }));
  assert.ok(conformsTo(ACCEPTANCE_RESULT_SCHEMA, { tryIt: [], observationPlan: {}, claims: [], parentBrief: {} }));
  assert.ok(!conformsTo(ACCEPTANCE_RESULT_SCHEMA, { tryIt: [], observationPlan: {}, claims: [] }));
  assert.ok(!conformsTo(ACCEPTANCE_RESULT_SCHEMA, { tryIt: {}, observationPlan: {}, claims: [], parentBrief: {} }));
  assert.deepEqual(MERGE_CHECK_RESULT_SCHEMA.required, ['verdict', 'rationale']);
  assert.deepEqual(ACCEPTANCE_RESULT_SCHEMA.required, ['tryIt', 'observationPlan', 'claims', 'parentBrief']);
  const types = [];
  const walk = (n) => { if (n && typeof n === 'object') { if (typeof n.type === 'string') types.push(n.type); Object.values(n.properties || {}).forEach(walk); } };
  for (const s of [MERGE_CHECK_RESULT_SCHEMA, ACCEPTANCE_RESULT_SCHEMA]) {
    assert.strictEqual(s.additionalProperties, false);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.properties.verdict || s.properties.tryIt));
    walk(s);
  }
  assert.ok(types.length >= 6);
  for (const t of types) assert.ok(['object', 'string', 'array'].includes(t), t);
});

test('events: MERGE_STEP_NAMES carries merge-check and merge-acceptance after merge-supplier', () => {
  const { MERGE_STEP_NAMES } = require(path.join(LIB, 'driver', 'events.js'));
  const i = MERGE_STEP_NAMES.indexOf('merge-supplier');
  assert.deepEqual(MERGE_STEP_NAMES.slice(i + 1, i + 3), ['merge-check', 'merge-acceptance']);
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

// isExecutable defaults to "every resolved path is an executable file"; null omits the seam.
function fakeDeps({ lookup = {}, realpath = {}, firstLine = {}, home, lookupThrows = false, isExecutable = () => true } = {}) {
  const calls = [];
  return {
    calls,
    home,
    ...(isExecutable === null ? {} : { isExecutable }),
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
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22']);
  assert.strictEqual(lookups, 1);
});

test('toolchainReadPaths skips env assignments and env options that take an argument', () => {
  for (const line of ['#!/usr/bin/env NAME=1 node', '#!/usr/bin/env -u FOO node', '#!/usr/bin/env -C /x A=b node --flag']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22'], line);
  }
});

test('toolchainReadPaths adds nothing for a bare shebang, an env with no name, or a non-shebang line, and reads a CRLF shebang', () => {
  const only = ['/h/.nvm/v22/lib/node_modules/npm'];
  for (const line of ['#!', '#!   ', '#!/usr/bin/env', '#!/usr/bin/env -S', '#!/usr/bin/env -u FOO', 'console.log(1)']) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), only, JSON.stringify(line));
  }
  const crlf = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node\r' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', crlf), ['/h/.nvm/v22']);
});

test('toolchainRoot returns null when lookup throws', () => {
  assert.strictEqual(toolchainRoot('node', fakeDeps({ lookupThrows: true })), null);
});

test('toolchainReadPaths: an absent testCommand derives no read path, and a bad one is refused before any seam runs', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' } });
  assert.deepStrictEqual(toolchainReadPaths(undefined, d), []);
  assert.throws(() => toolchainReadPaths(null, d), (e) => e instanceof TypeError && /testCommand/.test(e.message));
  assert.throws(() => toolchainReadPaths('node -e', d), (e) => e instanceof TypeError && /testCommand/.test(e.message));
  assert.deepStrictEqual(d.calls, []);
});

test('toolchainRoot takes an absolute first word as the path and refuses a relative one', () => {
  const d = fakeDeps();
  assert.strictEqual(toolchainRoot('/opt/t/bin/run --x', d), '/opt/t');
  assert.strictEqual(toolchainRoot('./node_modules/.bin/jest', d), null);
  assert.deepStrictEqual(d.calls, []);
  // A realpath that would turn the relative word absolute: the refusal itself must hold.
  const absolute = fakeDeps({ realpath: { './node_modules/.bin/jest': '/abs/node_modules/.bin/jest' } });
  assert.strictEqual(toolchainRoot('./node_modules/.bin/jest', absolute), null);
  assert.deepStrictEqual(absolute.calls, []);
});

test('toolchainRoot returns null when realpath throws', () => {
  const d = fakeDeps({ lookup: { node: '/x/bin/node' }, realpath: { '/x/bin/node': new Error('boom') } });
  assert.strictEqual(toolchainRoot('node', d), null);
});

test('toolchainReadPaths follows an env shebang one level', () => {
  const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22']);
});

test('toolchainReadPaths follows an absolute shebang and skips env options', () => {
  const abs = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/local/bin/python3' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', abs), ['/h/.nvm/v22/lib/node_modules/npm', '/usr/local']);
  const opts = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env -S node --flag' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', opts), ['/h/.nvm/v22']);
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
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22'], line);
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
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22']);
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
  const withNode = ['/h/.nvm/v22'];
  const lines = [
    '#!/usr/bin/env node', '#!/usr/bin/env -i node', '#!/usr/bin/env - node', '#!/usr/bin/env -0 -v node',
    '#!/usr/bin/env --ignore-environment --null --debug node', '#!/usr/bin/env -uFOO node', '#!/usr/bin/env -C/opt/proj node',
    '#!/usr/bin/env --unset=FOO node', '#!/usr/bin/env --chdir=/opt/proj node', '#!/usr/bin/env -i -S node --flag',
  ];
  for (const line of lines) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), withNode, line);
  }
});

test('toolchainReadPaths keeps its -S, bundled-flag and -- readings', () => {
  const only = ['/h/.nvm/v22/lib/node_modules/npm'];
  const cases = [
    ['#!/usr/bin/env -S node --flag', ['/h/.nvm/v22']], ['#!/usr/bin/env -Snode --flag', ['/h/.nvm/v22']],
    ['#!/usr/bin/env -S-i node', ['/h/.nvm/v22']], ['#!/usr/bin/env -S -P /opt/a node', only],
    ['#!/usr/bin/env -iv node', only], ['#!/usr/bin/env --', only], ['#!/usr/bin/env -- node', only],
    ['#!/usr/bin/env -uC node', ['/h/.nvm/v22']], ['#!/usr/bin/env -v -i node', ['/h/.nvm/v22']],
    ['#!/usr/bin/env -uFOO node', ['/h/.nvm/v22']], ['#!/usr/bin/env --unset=FOO node', ['/h/.nvm/v22']],
    ['#!/usr/bin/env -0 node', ['/h/.nvm/v22']], ['#!/usr/bin/env - node', ['/h/.nvm/v22']],
    ['#!/usr/bin/env -S /opt/py/bin/python3 -u', [...only, '/opt/py']],
  ];
  for (const [line, expected] of cases) {
    const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), expected, line);
  }
});

test('toolchainReadPaths never splits a -S… token that is an env option\'s argument', () => {
  const withNode = ['/h/.nvm/v22'];
  for (const line of ['#!/usr/bin/env -u -Sfoo node', '#!/usr/bin/env -C -Sfoo node', '#!/usr/bin/env --chdir -Sfoo node']) {
    const d = fakeDeps({ ...NPM_DEPS, lookup: { ...NPM_DEPS.lookup, foo: '/foo/bin/foo' }, firstLine: { [NPM_REAL]: line } });
    assert.deepStrictEqual(toolchainReadPaths('npm test', d), withNode, line);
  }
});

test('toolchainRoot guards every home it is given, as given and through its real path', () => {
  const homes = ['/h', '/x'];
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/h/tool' }, home: homes })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/x/tool' }, home: homes })), null);
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/h/bin/tool' }, home: homes })), '/h/bin');
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/x/bin/tool' }, home: homes })), '/x/bin');
  const real = { '/link': '/real/home' };
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/real/home/tool' }, home: ['/h', '/link'], realpath: real })), null);
  // Entries that are not non-empty strings are skipped; the rest still guard.
  assert.strictEqual(toolchainRoot('tool', fakeDeps({ lookup: { tool: '/x/tool' }, home: [undefined, '', 7, '/x'] })), null);
});

test('a resolved path that is not an executable file resolves nothing', () => {
  const shebang = { [NPM_REAL]: '#!/usr/bin/env node' };
  // No isExecutable seam at all fails closed, like a throwing seam.
  const absent = fakeDeps({ ...NPM_DEPS, firstLine: shebang, isExecutable: null });
  assert.deepStrictEqual(toolchainReadPaths('npm test', absent), []);
  assert.strictEqual(toolchainRoot('/opt/t/bin/run', absent), null);
  const throwing = fakeDeps({ ...NPM_DEPS, firstLine: shebang, isExecutable: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', throwing), []);
  // Only `true` counts.
  assert.deepStrictEqual(toolchainReadPaths('npm test', fakeDeps({ ...NPM_DEPS, firstLine: shebang, isExecutable: () => 1 })), []);
  // A first word that is not executable re-opens nothing and its first line is never read.
  const seen = [];
  const notCmd = fakeDeps({ ...NPM_DEPS, firstLine: shebang, isExecutable: (p) => { seen.push(p); return p !== NPM_REAL; } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', notCmd), []);
  assert.deepStrictEqual(seen, [NPM_REAL]);
});

test('an interpreter that is not an executable file drops only the interpreter root', () => {
  const only = ['/h/.nvm/v22/lib/node_modules/npm'];
  const notNode = (p) => p !== '/h/.nvm/v22/bin/node';
  const env = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node' }, isExecutable: notNode });
  assert.deepStrictEqual(toolchainReadPaths('npm test', env), only);
  // An absolute shebang naming a key file: an existing file is not enough to re-open its directory.
  const key = '/h/.ssh/id_ed25519';
  const ssh = fakeDeps({ ...NPM_DEPS, home: '/h', firstLine: { [NPM_REAL]: '#!' + key }, isExecutable: (p) => p !== key });
  assert.deepStrictEqual(toolchainReadPaths('npm test', ssh), only);
  const opened = fakeDeps({ ...NPM_DEPS, home: '/h', firstLine: { [NPM_REAL]: '#!' + key } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', opened), [...only, '/h/.ssh'], 'the fixture re-opens .ssh when the key counts as executable');
});

test('toolchainReadPaths drops a root that another root in the list covers, keeping order', () => {
  // The interpreter root covers the command root: only the covering root stays.
  const d = fakeDeps({ ...NPM_DEPS, firstLine: { [NPM_REAL]: '#!/usr/bin/env node' } });
  assert.deepStrictEqual(toolchainReadPaths('npm test', d), ['/h/.nvm/v22']);
  // The command root covers the interpreter root.
  const outer = fakeDeps({ lookup: { tool: '/o/bin/tool', py: '/o/sub/bin/py' }, firstLine: { '/o/bin/tool': '#!/usr/bin/env py' } });
  assert.deepStrictEqual(toolchainReadPaths('tool run', outer), ['/o']);
  // A shared name prefix is not cover: both stay, in order.
  const prefix = fakeDeps({ lookup: { tool: '/o/v2/bin/tool', py: '/o/v22/bin/py' }, firstLine: { '/o/v2/bin/tool': '#!/usr/bin/env py' } });
  assert.deepStrictEqual(toolchainReadPaths('tool run', prefix), ['/o/v2', '/o/v22']);
});

test('reopensHome is true for the root, a home, an ancestor of a home or of its real path, and false inside a home', () => {
  const deps = { home: ['/h', '/u/me'], realpath: (p) => (p === '/h' ? '/real/h' : p) };
  for (const yes of ['/', '/h', '/u/me', '/u', '/real/h', '/real']) assert.strictEqual(reopensHome(yes, deps), true, yes);
  for (const no of ['/h/.nvm', '/u/me/bin', '/opt/tool', '/real/h/.cargo', '/hh']) assert.strictEqual(reopensHome(no, deps), false, no);
  // One home as a string, and a realpath that throws, still guard the home as given.
  assert.strictEqual(reopensHome('/h', { home: '/h', realpath: () => { throw new Error('no'); } }), true);
  assert.strictEqual(reopensHome('/opt', { home: [] }), false);
});

test('implementerSettings: an absent testCommand adds no test rule and keeps the git rules', () => {
  const absent = implementerSettings({ platform: 'darwin' });
  const given = implementerSettings({ testCommand: 'node --test', platform: 'darwin' });
  assert.deepStrictEqual(absent.permissions.allow, ['Read', 'Edit', 'Write', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)']);
  assert.deepStrictEqual(absent.permissions.deny, given.permissions.deny);
  assert.deepStrictEqual(absent.sandbox, given.sandbox);
});

test('implementerSettings: null, \'\' and a non-string testCommand are still refused', () => {
  for (const bad of [null, '', 5, {}, ['node']]) {
    assert.throws(() => implementerSettings({ testCommand: bad, platform: 'darwin' }), /testCommand/, JSON.stringify(bad));
  }
});

test('implementerSettings: the targeted runner form composes its rule', () => {
  const allow = implementerSettings({ testCommand: 'node tools/run-tests.js --files-from', platform: 'darwin' }).permissions.allow;
  assert.ok(allow.includes('Bash(node tools/run-tests.js --files-from *)'));
  assert.ok(!allow.some((r) => r.startsWith('Bash(npm')));
});

// One assertion function, shared by the pin and its go-red control.
function assertEveryRoleHasProfile(roles, profiles) {
  assert.deepStrictEqual(Object.keys(profiles).sort(), Object.keys(roles).sort());
  for (const [role, profile] of Object.entries(profiles)) assert.ok(Object.hasOwn(PROFILES, profile), `${role}: ${profile}`);
}
test('AC6.1: every ROLES entry has a default profile', () => {
  assertEveryRoleHasProfile(ROLES, DRIVER_ROLE_PROFILES);
  assert.deepStrictEqual({ ...DRIVER_ROLE_PROFILES }, { implementer: 'standard', reviewer: 'capable', explorer: 'standard', 'merge-check': 'standard', acceptance: 'standard', 'lens-reviewer': 'fast' });
  assert.ok(Object.isFrozen(DRIVER_ROLE_PROFILES));
});
test('AC6.1 (go-red control): a role added to ROLES without a default fails the check', () => {
  assert.throws(() => assertEveryRoleHasProfile({ ...ROLES, scout: { tools: ['Read'], settings: false } }, DRIVER_ROLE_PROFILES));
  assert.throws(() => assertEveryRoleHasProfile(ROLES, { ...DRIVER_ROLE_PROFILES, reviewer: 'turbo' }));
});
test('POLICY_DRIVER_ROLES: exactly the four spec roles, each in ROLES', () => {
  assert.deepStrictEqual([...POLICY_DRIVER_ROLES], ['implementer', 'reviewer', 'merge-check', 'acceptance']);
  for (const r of POLICY_DRIVER_ROLES) assert.ok(Object.hasOwn(ROLES, r), r);
  assert.ok(!POLICY_DRIVER_ROLES.includes('explorer'));
  assert.ok(Object.isFrozen(POLICY_DRIVER_ROLES));
});

// The lens-reviewer role (#6000): a read-only headless lens reviewer.
const LENS_GIT = ['Bash(git diff --no-ext-diff --no-textconv *)', 'Bash(git show --no-ext-diff --no-textconv *)', 'Bash(git log --no-ext-diff --no-textconv *)'];
const LENS_DENY = [...DENY, 'Bash(* --output*)', 'Bash(* --ext-diff*)', 'Bash(* --textconv*)', 'Bash(* --no-index*)', 'Bash(* --show-signature*)', 'Bash(*%G*)', 'Bash(git grep *)', 'Bash(git status *)', 'Bash(git blame *)', 'Bash(* --open-files-in-pager*)', 'Bash(git -c *)', 'Edit', 'Write'];
const LENS_DARWIN = {
  permissions: { defaultMode: 'dontAsk', allow: ['Read', 'Grep', 'Glob', ...LENS_GIT], deny: LENS_DENY, blockReadsOutsideWorkingDirectories: true },
  sandbox: { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, failIfUnavailable: true, network: { allowedDomains: [], strictAllowlist: true }, filesystem: { allowRead: ['/repo/.git'], denyWrite: ['.'] } },
};
const toolsArg = (args) => args[args.indexOf('--tools') + 1];

test('AC1.1: the lens-reviewer tool list and darwin settings are pinned', () => {
  assert.deepStrictEqual(ROLES['lens-reviewer'], { tools: ['Read', 'Grep', 'Glob', 'Bash'], settings: true });
  assert.deepStrictEqual(toolsFor('lens-reviewer', 'darwin'), ['Read', 'Grep', 'Glob', 'Bash']);
  assert.deepStrictEqual([...LENS_GIT_RULES], LENS_GIT);
  assert.ok(Object.isFrozen(LENS_GIT_RULES));
  assert.deepStrictEqual(lensReviewerSettings({ platform: 'darwin', readPaths: ['/repo/.git'] }), LENS_DARWIN);
  const args = composeArgs({ role: 'lens-reviewer', settingsFile: '/s/x.json', schema: LENS_REPLY_SCHEMA, platform: 'darwin' });
  for (const flag of ['--restricted', '--safe-mode']) assert.ok(args.includes(flag), flag);
  assert.strictEqual(args[args.indexOf('--settings') + 1], '/s/x.json');
  assert.strictEqual(toolsArg(args), 'Read,Grep,Glob,Bash');
  assert.deepStrictEqual(LENS_REPLY_SCHEMA, { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false });
  assert.ok(Object.isFrozen(LENS_REPLY_SCHEMA));
  assert.ok(conformsTo(LENS_REPLY_SCHEMA, { text: 'x' }));
  assert.ok(!conformsTo(LENS_REPLY_SCHEMA, { text: 'x', extra: 1 }));
});

test('AC1.2: off the sandbox-probed platforms the lens-reviewer has no Bash at all', () => {
  for (const platform of ['linux', 'win32']) {
    assert.deepStrictEqual(toolsFor('lens-reviewer', platform), ['Read'], platform);
    const s = lensReviewerSettings({ platform, readPaths: [] });
    assert.deepStrictEqual(Object.keys(s), ['permissions'], platform);
    assert.deepStrictEqual(s.permissions.allow, ['Read'], platform);
    assert.deepStrictEqual(s.permissions.deny, LENS_DENY, platform);
    assert.ok(!('blockReadsOutsideWorkingDirectories' in s.permissions), platform);
    for (const r of s.permissions.allow) assert.ok(!r.startsWith('Bash('), r);
    assert.strictEqual(toolsArg(composeArgs({ role: 'lens-reviewer', settingsFile: '/s/x.json', schema: LENS_REPLY_SCHEMA, platform })), 'Read', platform);
  }
});

test('lens-reviewer has no Write, Edit or network on any platform', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const tools = toolsFor('lens-reviewer', platform);
    const allow = lensReviewerSettings({ platform, readPaths: [] }).permissions.allow;
    for (const name of ['Write', 'Edit']) {
      assert.ok(!tools.includes(name), name + ' ' + platform);
      assert.ok(!allow.includes(name), name + ' ' + platform);
    }
  }
  const network = lensReviewerSettings({ platform: 'darwin', readPaths: [] }).sandbox.network;
  assert.deepStrictEqual(network.allowedDomains, []);
  assert.strictEqual(network.strictAllowlist, true);
});

test('Proof(auth) unit: no credential reaches the lens-reviewer settings', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const text = JSON.stringify(lensReviewerSettings({ platform, readPaths: platform === 'win32' ? ['C:\\repo\\.git'] : ['/repo/.git'] }));
    for (const word of ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'env', 'apiKeyHelper']) assert.ok(!text.includes(word), word + ' ' + platform);
  }
});

test('lensReviewerSettings refuses a bad readPaths and returns fresh arrays', () => {
  assert.throws(() => lensReviewerSettings({ platform: 'darwin', readPaths: ['rel'] }), TypeError);
  assert.throws(() => lensReviewerSettings({ platform: 'darwin', readPaths: ['/'] }), TypeError);
  const given = ['/repo/.git'];
  const a = lensReviewerSettings({ platform: 'darwin', readPaths: given });
  const b = lensReviewerSettings({ platform: 'darwin', readPaths: given });
  assert.notStrictEqual(a.sandbox.filesystem.allowRead, given);
  assert.notStrictEqual(a.permissions.allow, b.permissions.allow);
  assert.deepStrictEqual(lensReviewerSettings({ platform: 'darwin' }).sandbox.filesystem.allowRead, []);
});

// One assertion, shared by the pin and its negative control: the note lists exactly the
// forms of `rules`, one per line, and no other `git ` line.
function assertNoteListsRules(note, rules) {
  const lines = note.split('\n');
  const forms = rules.map((r) => r.replace(/^Bash\(/, '').replace(/ \*\)$/, ''));
  for (const form of forms) assert.ok(lines.includes(form), form);
  assert.strictEqual(lines.filter((l) => l.startsWith('git ')).length, rules.length);
  assert.ok(note.includes('exactly as written'));
}
test('Q2: the admitted-forms note lists every lens git allow rule and nothing else', () => {
  const note = lensAdmittedFormsNote();
  assertNoteListsRules(note, LENS_GIT_RULES);
  for (const form of ['git diff --no-ext-diff --no-textconv', 'git show --no-ext-diff --no-textconv', 'git log --no-ext-diff --no-textconv']) {
    assert.ok(note.split('\n').includes(form), form);
  }
  // Order: read-only reviewer, the forms, the Read tool, no rephrasing.
  const reviewerAt = note.search(/read-only reviewer/);
  const firstForm = note.indexOf('\ngit ');
  const readAt = note.search(/Read tool/);
  assert.ok(reviewerAt >= 0 && reviewerAt < firstForm);
  assert.ok(firstForm < readAt);
  assert.ok(readAt < note.search(/rephrase/));
  for (const op of ['`;`', '`&&`', '`|`']) assert.ok(note.includes(op), op);
  // Negative control: a rule list with one rule dropped yields a note the assertion rejects.
  assert.throws(() => assertNoteListsRules(note, LENS_GIT_RULES.slice(1)));
});

test('git grep is not admitted: no allow rule and no note line (it runs a program through -O, --open=, bundled -nO)', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const allow = lensReviewerSettings({ platform, readPaths: [] }).permissions.allow;
    assert.deepStrictEqual(allow.filter((r) => r.startsWith('Bash(git grep')), [], platform);
  }
  assert.deepStrictEqual(LENS_GIT_RULES.filter((r) => r.startsWith('Bash(git grep')), []);
  assert.deepStrictEqual(lensAdmittedFormsNote().split('\n').filter((l) => l.startsWith('git grep')), []);
});

// The probe matrix's negative unit tests (#6000 Task 2): each vector's command is not
// admitted by the darwin lens-reviewer rules. A test-side reading of a `Bash(<pattern>)`
// rule: `*` matches any run of characters, anchored at both ends. A compound command is
// admitted only when every part is (the CLI splits on `;`, `&&`, `||` and `|`).
const LENS_P = '--no-ext-diff --no-textconv';
function lensRuleMatches(rule, command) {
  const m = /^Bash\((.*)\)$/s.exec(rule);
  if (!m) return false;
  // A trailing ` *` also matches the bare command (`Bash(git status *)` admits `git status`).
  const optionalTail = m[1].endsWith(' *');
  const pattern = optionalTail ? m[1].slice(0, -2) : m[1];
  const body = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (optionalTail ? '( .*)?' : '') + '$', 's').test(command);
}
function lensVerdict(command) {
  const { allow, deny } = lensReviewerSettings({ platform: 'darwin', readPaths: ['/repo/.git'] }).permissions;
  const parts = command.split(/;|&&|\|\||\|/).map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => ({
    part,
    allowedBy: allow.filter((r) => lensRuleMatches(r, part)),
    deniedBy: deny.filter((r) => lensRuleMatches(r, part)),
  }));
}
const lensAdmitted = (command) => lensVerdict(command).every((v) => v.allowedBy.length > 0 && v.deniedBy.length === 0);
// The rule matcher itself: it admits the pinned forms, so a "not admitted" verdict below is
// the rules' doing, not a matcher that admits nothing.
test('AC3.1 matcher control: the pinned forms are admitted and a bare touch is not', () => {
  for (const c of ['git diff ' + LENS_P + ' HEAD~1 HEAD', 'git log ' + LENS_P + ' -1', 'git show ' + LENS_P + ' HEAD']) assert.ok(lensAdmitted(c), c);
  assert.ok(!lensAdmitted('touch x'));
});
test('AC3.1 vector 1: --output on the diff family is not admitted by the lens-reviewer rules', () => {
  assert.ok(LENS_DENY.includes('Bash(* --output*)'));
  for (const c of ['git diff ' + LENS_P + ' HEAD~1 HEAD --output=out.txt', 'git log ' + LENS_P + ' -1 --output=out.txt', 'git show ' + LENS_P + ' HEAD --output=out.txt']) {
    const [v] = lensVerdict(c);
    assert.deepStrictEqual(v.deniedBy, ['Bash(* --output*)'], c);
    assert.ok(!lensAdmitted(c), c);
  }
});
test('AC3.1 vector 2: git diff without the pinned flags is not admitted by the lens-reviewer rules', () => {
  for (const c of ['git diff HEAD~1 HEAD', 'git log -1', 'git show HEAD', 'git diff --no-textconv HEAD~1 HEAD', 'git diff --no-ext-diff HEAD~1 HEAD']) {
    assert.deepStrictEqual(lensVerdict(c)[0].allowedBy, [], c);
  }
});
test('AC3.1 vector 3: an external diff program is not admitted by the lens-reviewer rules', () => {
  for (const rule of LENS_GIT_RULES) assert.ok(rule.includes(' --no-ext-diff '), rule);
  assert.ok(LENS_DENY.includes('Bash(* --ext-diff*)'));
});
test('AC3.1 vector 4: a textconv filter is not admitted by the lens-reviewer rules', () => {
  for (const rule of LENS_GIT_RULES) assert.ok(rule.includes(' --no-textconv '), rule);
  assert.ok(LENS_DENY.includes('Bash(* --textconv*)'));
});
test('AC3.1 vector 5: a pager is not admitted by the lens-reviewer rules', () => {
  for (const c of ['git -p log ' + LENS_P + ' -1', 'git --paginate log ' + LENS_P + ' -1', 'GIT_PAGER=x git log ' + LENS_P + ' -1', 'PAGER=x git log ' + LENS_P + ' -1']) {
    assert.deepStrictEqual(lensVerdict(c)[0].allowedBy, [], c);
  }
});
test('AC3.1 vector 6: core.fsmonitor is not admitted by the lens-reviewer rules outside the sandbox', () => {
  const s = lensReviewerSettings({ platform: 'darwin', readPaths: ['/repo/.git'] });
  assert.strictEqual(s.sandbox.enabled, true);
  assert.strictEqual(s.sandbox.allowUnsandboxedCommands, false);
  assert.strictEqual(s.sandbox.autoAllowBashIfSandboxed, false);
  assert.deepStrictEqual(s.sandbox.network, { allowedDomains: [], strictAllowlist: true });
  assert.deepStrictEqual(s.sandbox.filesystem.denyWrite, ['.']);
});
test('AC3.1 vector 7: git -c config is not admitted by the lens-reviewer rules', () => {
  const c = 'git -c core.pager=/tmp/x log ' + LENS_P + ' -1';
  const [v] = lensVerdict(c);
  assert.deepStrictEqual(v.allowedBy, [], c);
  assert.deepStrictEqual(v.deniedBy, ['Bash(git -c *)'], c);
});
test('AC3.1 vector 8: an environment prefix is not admitted by the lens-reviewer rules', () => {
  for (const c of ['GIT_EXTERNAL_DIFF=/tmp/x git diff ' + LENS_P + ' HEAD~1 HEAD', 'GIT_CONFIG_COUNT=1 git log ' + LENS_P + ' -1', 'env GIT_EXTERNAL_DIFF=/tmp/x git diff ' + LENS_P + ' HEAD~1 HEAD']) {
    assert.deepStrictEqual(lensVerdict(c)[0].allowedBy, [], c);
  }
});
// Vectors 9 and 16: the CLI's own read-only table admits `git grep`, `git status` and
// `git blame` with no allow rule (live probe, CLI 2.1.325), and each started a configured
// program, so a missing allow rule is not enough: a deny rule must name the command.
test('AC3.1 vector 9: git grep in every form is not admitted by the lens-reviewer rules', () => {
  for (const c of ['git grep -Oecho x', 'git grep -nOecho x', 'git grep --open=echo x', 'git grep --open-files-in-pager=echo x', 'git grep --textc x', 'git grep x']) {
    const [v] = lensVerdict(c);
    assert.deepStrictEqual(v.allowedBy, [], c);
    assert.ok(v.deniedBy.includes('Bash(git grep *)'), c);
  }
});
test('AC3.1 vector 16: git status and git blame are not admitted by the lens-reviewer rules', () => {
  for (const [c, rule] of [['git status --short', 'Bash(git status *)'], ['git status', 'Bash(git status *)'], ['git blame a.txt', 'Bash(git blame *)']]) {
    const [v] = lensVerdict(c);
    assert.deepStrictEqual(v.allowedBy, [], c);
    assert.ok(v.deniedBy.includes(rule), c);
  }
});
test('AC3.1 vector 10: git diff --no-index is not admitted by the lens-reviewer rules', () => {
  const c = 'git diff ' + LENS_P + ' --no-index /etc/hosts x';
  assert.deepStrictEqual(lensVerdict(c)[0].deniedBy, ['Bash(* --no-index*)']);
  assert.ok(!lensAdmitted(c));
});
test('AC3.1 vector 11: a compound command\'s second half is not admitted by the lens-reviewer rules', () => {
  for (const c of ['git log ' + LENS_P + ' -1; touch x', 'git log ' + LENS_P + ' -1 && touch x', 'git log ' + LENS_P + ' -1 | tee x']) {
    const verdict = lensVerdict(c);
    assert.ok(verdict[0].allowedBy.length > 0, c);
    assert.deepStrictEqual(verdict[1].allowedBy, [], c);
    assert.ok(!lensAdmitted(c), c);
  }
});
// Vector 14: the deny list does not name the abbreviations; git itself refuses them for the
// diff family (parse-options turns abbreviation off there). Asked of a real git, in a
// hermetic repository with no system or global config.
test('AC3.1 vector 14: abbreviated long options on the diff family are rejected by git, so nothing is written or started', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const cp = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-abbrev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'none'), GIT_CEILING_DIRECTORIES: path.dirname(dir) };
  const git = (args) => cp.spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(git(['init', '-q']).status, 0);
  for (const [i, text] of ['one\n', 'two\n'].entries()) {
    fs.writeFileSync(path.join(dir, 'a.txt'), text);
    assert.strictEqual(git(['add', 'a.txt']).status, 0);
    assert.strictEqual(git(['-c', 'user.name=p', '-c', 'user.email=p@example.invalid', 'commit', '-qm', 'c' + i]).status, 0);
  }
  for (const args of [
    ['diff', '--no-ext-diff', '--no-textconv', '--outp=out14.txt', 'HEAD~1', 'HEAD'],
    ['log', '--no-ext-diff', '--no-textconv', '--ext', 'HEAD', '-1'],
    ['show', '--no-ext-diff', '--no-textconv', '--textc', 'HEAD'],
    ['log', '--no-ext-diff', '--no-textconv', '--show-sig', '-1'],
  ]) {
    // Admitted by the rules (the deny list names none of these spellings)...
    assert.ok(lensAdmitted('git ' + args.join(' ')), args.join(' '));
    // ...and refused by git before it does anything.
    const r = git(args);
    assert.ok(r.status === 128 || r.status === 129, args.join(' ') + ' exited ' + r.status + ': ' + r.stderr);
    assert.match(r.stderr, /unrecognized argument|usage: git/, args.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(dir, 'out14.txt')), 'out14.txt was written');
});
test('AC3.1 vector 15: a later flag that overrides a pinned one, or starts signature verification, is not admitted by the lens-reviewer rules', () => {
  for (const [c, rule] of [
    ['git show ' + LENS_P + ' --ext-diff HEAD', 'Bash(* --ext-diff*)'],
    ['git log ' + LENS_P + ' -p --ext-diff -1', 'Bash(* --ext-diff*)'],
    ['git show ' + LENS_P + ' --textconv HEAD', 'Bash(* --textconv*)'],
    ['git log ' + LENS_P + ' --show-signature -1', 'Bash(* --show-signature*)'],
    ['git show ' + LENS_P + ' --show-signature HEAD', 'Bash(* --show-signature*)'],
    ['git log ' + LENS_P + ' --format=%GS -1', 'Bash(*%G*)'],
    ['git log ' + LENS_P + ' --pretty=tformat:%G? -1', 'Bash(*%G*)'],
  ]) {
    const [v] = lensVerdict(c);
    assert.ok(v.allowedBy.length > 0, 'the allow rule admits ' + c + ', so the deny rule is what refuses it');
    assert.deepStrictEqual(v.deniedBy, [rule], c);
  }
});

test('every settings role has a builder, so settingsFor never reaches its no-builder throw', () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    if (!spec.settings) continue;
    const s = settingsFor(role, { testCommand: 'node --test', platform: 'darwin', readPaths: [] });
    assert.ok(s && typeof s.permissions === 'object', role);
  }
});

test('settingsFor dispatches by role', () => {
  const input = { testCommand: 'node --test', platform: 'darwin', readPaths: ['/opt/a'] };
  assert.deepStrictEqual(settingsFor('implementer', input), implementerSettings(input));
  assert.deepStrictEqual(settingsFor('implementer', { ...input, platform: 'linux' }), implementerSettings({ ...input, platform: 'linux' }));
  assert.deepStrictEqual(settingsFor('lens-reviewer', input), lensReviewerSettings({ platform: 'darwin', readPaths: ['/opt/a'] }));
  for (const role of ['reviewer', 'explorer', 'merge-check', 'acceptance']) assert.strictEqual(settingsFor(role, input), null, role);
  assert.throws(() => settingsFor('nope', input), /unknown role/);
});

// The lens-reviewer worker's pinned git environment (#6000 Task 2b).
const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
test('lensGitEnv pins system/global config, diff.external, fsmonitor, attributesFile, pager and GIT_ATTR_SOURCE', () => {
  const env = lensGitEnv({ attrSource: EMPTY_TREE_SHA1 });
  assert.deepStrictEqual({ ...env }, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'diff.external', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'core.attributesFile', GIT_CONFIG_VALUE_2: '/dev/null',
    GIT_CONFIG_KEY_3: 'core.pager', GIT_CONFIG_VALUE_3: 'cat',
    GIT_ATTR_SOURCE: EMPTY_TREE_SHA1,
  });
  assert.ok(Object.isFrozen(env));
  assert.strictEqual(LENS_EMPTY_GIT_CONFIG, '/dev/null');
  assert.strictEqual(Number(env.GIT_CONFIG_COUNT), Object.keys(env).filter((k) => /^GIT_CONFIG_KEY_\d+$/.test(k)).length);
  // A SHA-256 repository's empty tree is accepted too.
  const sha256 = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321';
  assert.strictEqual(lensGitEnv({ attrSource: sha256 }).GIT_ATTR_SOURCE, sha256);
});

test('lensGitEnv refuses a malformed attrSource', () => {
  for (const bad of [undefined, null, '', 'HEAD', EMPTY_TREE_SHA1.toUpperCase(), EMPTY_TREE_SHA1.slice(1), EMPTY_TREE_SHA1 + '0', EMPTY_TREE_SHA1 + '\n', ' ' + EMPTY_TREE_SHA1, 42]) {
    assert.throws(() => lensGitEnv({ attrSource: bad }), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => lensGitEnv(), TypeError);
});
