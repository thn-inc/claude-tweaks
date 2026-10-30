// tests/resolve-policy-control-mode.test.js — #4609: the thirteen flat
// control-mode policy keys, the `element` list validation they introduced,
// isControlModeOn, and the `risk-path-globs` block key. Every test builds a throwaway fixture repo under
// os.tmpdir() (never inside this repo — IL-80), writes policy.yml into it, and
// spawns bin/resolve-policy.js with cwd set there. The keys are inert: nothing
// reads them yet, so this file pins only resolution and validation.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolvePolicyKeys, parseRiskPathGlobs, auditPolicy, BUILTIN_RISK_CATEGORIES } = require('../plugin/bin/lib/policy-schema');
const { isControlModeOn } = require('../plugin/bin/lib/policy');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRepo(policy) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-policy-control-'));
  tempDirs.push(tmp);
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  if (policy !== undefined) {
    fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
    fs.writeFileSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), policy);
  }
  return tmp;
}

function values(policy, ...keys) {
  const res = spawnSync(process.execPath, [CLI, '--values', ...keys], { cwd: makeRepo(policy), encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function json(policy, ...keys) {
  const res = spawnSync(process.execPath, [CLI, ...keys], { cwd: makeRepo(policy), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('AC1.1: with no keys set, control-mode, acceptance-target and deploy-reach print their defaults', () => {
  const res = values(undefined, 'control-mode', 'acceptance-target', 'deploy-reach');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, 'off\nlocal\nnone\n');
  assert.strictEqual(res.stderr, '');
});

test('AC1.2: each empty list key prints one empty line and exits 0, like merge-sensitive-paths', () => {
  for (const key of ['owned-owners', 'trusted-authors', 'risk-categories', 'merge-sensitive-paths']) {
    const res = values(undefined, key);
    assert.strictEqual(res.status, 0, key);
    assert.strictEqual(res.stdout, '\n', key);
    // --values also prints an empty line for an unregistered key, so the JSON
    // form is what proves the key is registered with its [] default.
    assert.deepStrictEqual(json(undefined, key)[key], { value: [], source: 'default' }, key);
  }
});

test('AC1.4: deploy-wait-seconds prints 900 and deploy-poll-seconds prints 30', () => {
  const res = values(undefined, 'deploy-wait-seconds', 'deploy-poll-seconds');
  assert.strictEqual(res.stdout, '900\n30\n');
});

test('AC1.5: deploy-wait-seconds -1, deploy-poll-seconds 0 and non-integers take the invalid-value path', () => {
  const cases = [
    ['deploy-wait-seconds', '-1', 900],
    ['deploy-wait-seconds', '1.5', 900],
    ['deploy-wait-seconds', 'soon', 900],
    ['deploy-poll-seconds', '0', 30],
    ['deploy-poll-seconds', '2.5', 30],
    ['deploy-poll-seconds', 'often', 30],
  ];
  for (const [key, raw, dflt] of cases) {
    const out = json(`${key}: ${raw}\n`, key);
    assert.deepStrictEqual(out[key], { value: dflt, source: 'default', invalid: true }, `${key}: ${raw}`);
  }
  // The boundary values stay valid: wait 0 disables the wait, poll 1 is the floor.
  assert.deepStrictEqual(json('deploy-wait-seconds: 0\n', 'deploy-wait-seconds')['deploy-wait-seconds'], { value: 0, source: 'policy' });
  assert.deepStrictEqual(json('deploy-poll-seconds: 1\n', 'deploy-poll-seconds')['deploy-poll-seconds'], { value: 1, source: 'policy' });
});

test('AC2.1: control-mode: on prints on', () => {
  const res = values('control-mode: on\n', 'control-mode');
  assert.strictEqual(res.stdout, 'on\n');
  assert.strictEqual(res.stderr, '');
});

test('AC2.2: control-mode: maybe resolves off, flagged invalid, with one stderr warning, never on', () => {
  const out = json('control-mode: maybe\n', 'control-mode');
  assert.deepStrictEqual(out['control-mode'], { value: 'off', source: 'default', invalid: true });
  const res = values('control-mode: maybe\n', 'control-mode');
  assert.strictEqual(res.stdout, 'off\n');
  assert.strictEqual(res.stderr.trim().split('\n').length, 1, 'exactly one warning line');
  assert.match(res.stderr, /control-mode has invalid value "maybe"/);
  // The same path as the pre-existing autonomy lever.
  const autonomy = json('autonomy: maybe\n', 'autonomy');
  assert.deepStrictEqual(autonomy.autonomy, { value: 'supervised', source: 'default', invalid: true });
  // A capital spelling is invalid too, never read as on.
  assert.deepStrictEqual(json('control-mode: ON\n', 'control-mode')['control-mode'], { value: 'off', source: 'default', invalid: true });
});

test('AC3.1: acceptance-target: dev resolves', () => {
  const out = json('acceptance-target: dev\n', 'acceptance-target');
  assert.deepStrictEqual(out['acceptance-target'], { value: 'dev', source: 'policy' });
});

test('AC3.2: acceptance-target: staging is rejected', () => {
  const out = json('acceptance-target: staging\n', 'acceptance-target');
  assert.deepStrictEqual(out['acceptance-target'], { value: 'local', source: 'default', invalid: true });
});

test('every string key returns its value; whitespace-allowed keys keep spaces and drop one matched pair of quotes', () => {
  const policy = [
    'deploy-command: "npm run deploy:dev"',
    'deploy-live-workflow: Deploy to dev',
    'dev-test-account: dev smoke user',
    'dev-base-url: https://dev.example.com',
    'deploy-version-url: https://dev.example.com/version',
    '',
  ].join('\n');
  const res = values(policy, 'deploy-command', 'deploy-live-workflow', 'dev-test-account', 'dev-base-url', 'deploy-version-url');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(res.stdout, [
    'npm run deploy:dev',
    'Deploy to dev',
    'dev smoke user',
    'https://dev.example.com',
    'https://dev.example.com/version',
    '',
  ].join('\n'));
  // deploy-reach takes all three of its values.
  for (const reach of ['on-merge', 'command', 'none']) {
    assert.strictEqual(values(`deploy-reach: ${reach}\n`, 'deploy-reach').stdout, `${reach}\n`);
  }
});

test('AC4.6: owned-owners and trusted-authors round-trip a populated list in the raw comma-separated contract form, casing preserved', () => {
  for (const key of ['owned-owners', 'trusted-authors']) {
    const res = values(`${key}: Thn-Inc,acme\n`, key);
    assert.strictEqual(res.stdout, 'Thn-Inc,acme\n', key);
    assert.strictEqual(res.stderr, '', key);
  }
});

test('AC4.7: list elements failing the login rule are rejected', () => {
  const bad = ['""', '@acme', 'acme/repo', 'has space', '{a: 1}', '[Thn-Inc, acme]', 'a,', 'a,,b', ', a'];
  for (const key of ['owned-owners', 'trusted-authors']) {
    for (const raw of bad) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: [], source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

test('a list is read from one line only: a dash-style block is ignored, a quoted or bracketed list is rejected', () => {
  // Pre-existing parser limit (parseFlatLines skips indented lines), and it fails safe: nobody is trusted.
  assert.deepStrictEqual(json('owned-owners:\n  - acme\n', 'owned-owners')['owned-owners'], { value: [], source: 'default' });
  for (const raw of ['"Thn-Inc,acme"', "'acme'"]) {
    assert.deepStrictEqual(json(`owned-owners: ${raw}\n`, 'owned-owners')['owned-owners'], { value: [], source: 'default', invalid: true }, raw);
  }
});

test('the built-in risk slugs are the four from the spec, and the prose section names each', () => {
  assert.deepStrictEqual(BUILTIN_RISK_CATEGORIES, ['migrations', 'auth', 'public-contract', 'irreversible-side-effect']);
  const md = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md'), 'utf8');
  const start = md.indexOf('\n## Control mode\n');
  assert.notStrictEqual(start, -1, 'policy-schema.md has no "## Control mode" section');
  const next = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, next === -1 ? md.length : next);
  for (const slug of BUILTIN_RISK_CATEGORIES) assert.ok(section.includes(`\`${slug}\``), `the Control mode section does not name \`${slug}\``);
});

test('login rule accepts a bot login and an underscore login', () => {
  for (const login of ['dependabot[bot]', 'user_corp', 'a', '9lives', 'Thn-Inc, acme']) {
    const out = json(`owned-owners: ${login}\n`, 'owned-owners');
    assert.deepStrictEqual(out['owned-owners'], { value: login, source: 'policy' }, login);
  }
});

test('AC4.8: isControlModeOn is true only for the exact string on', () => {
  assert.strictEqual(isControlModeOn('on'), true);
  for (const v of ['ON', 'On', 'yes', 'off', '', ' on', undefined, null, true, 1]) {
    assert.strictEqual(isControlModeOn(v), false, String(v));
  }
});

test('risk-categories accepts extra slugs and rejects a non-slug', () => {
  const ok = json('risk-categories: data-export,pii\n', 'risk-categories');
  assert.deepStrictEqual(ok['risk-categories'], { value: 'data-export,pii', source: 'policy' });
  for (const raw of ['Data_Export', 'Auth', '-lead', 'pii,', 'has space']) {
    const out = json(`risk-categories: ${raw}\n`, 'risk-categories');
    assert.deepStrictEqual(out['risk-categories'], { value: [], source: 'default', invalid: true }, raw);
  }
});

test('deploy-command is cut at a # like every flat value', () => {
  const res = values('deploy-command: curl https://x/#y\n', 'deploy-command');
  assert.strictEqual(res.stdout, 'curl https://x/\n');
});

test('quoting does not protect a #: a quoted value cut mid-quote is rejected, not resolved malformed', () => {
  for (const key of ['deploy-command', 'deploy-live-workflow', 'dev-test-account']) {
    for (const raw of ['"curl https://x/#y"', "'curl https://x/#y'", '"never closed']) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

// Characterization (pre-existing, pinned by tests/policy-schema.test.js F6/#2253):
// release-hook keeps an unbalanced quote as an ordinary value; the closed-quote
// rule is opt-in per row and belongs to the #4609 keys only.
test('release-hook is unaffected by the closed-quote rule', () => {
  assert.deepStrictEqual(json('release-hook: "never closed\n', 'release-hook')['release-hook'], { value: '"never closed', source: 'policy' });
});

test('a blank quoted allowWhitespace value is rejected, not resolved to a missing value', () => {
  for (const key of ['deploy-command', 'deploy-live-workflow', 'dev-test-account', 'release-hook']) {
    for (const raw of ['""', "''", '"  "']) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

// Characterization (pre-existing, unchanged): the command-shaped string rule keeps
// accepting a bare command, a matched-quote command, and a command that merely
// starts with a closed quoted word.
test('a whitespace-allowed command keeps resolving as before', () => {
  const resolve = (key, raw) => json(`${key}: ${raw}\n`, key)[key];
  for (const key of ['deploy-command', 'release-hook']) {
    assert.deepStrictEqual(resolve(key, 'npm run deploy'), { value: 'npm run deploy', source: 'policy' }, key);
    assert.deepStrictEqual(resolve(key, '"npm run deploy"'), { value: 'npm run deploy', source: 'policy' }, key);
    assert.deepStrictEqual(resolve(key, "'npm run deploy'"), { value: 'npm run deploy', source: 'policy' }, key);
    assert.deepStrictEqual(resolve(key, '"/opt/my tools/run.sh" --go'), { value: '"/opt/my tools/run.sh" --go', source: 'policy' }, key);
  }
});

test('URL keys require http(s) and reject a quoted value', () => {
  for (const key of ['dev-base-url', 'deploy-version-url']) {
    for (const ok of ['https://dev.example.com', 'http://localhost:3000']) {
      assert.deepStrictEqual(json(`${key}: ${ok}\n`, key)[key], { value: ok, source: 'policy' }, `${key}: ${ok}`);
    }
    for (const bad of ['"https://x"', 'not-a-url', 'has space', 'ftp://x']) {
      const out = json(`${key}: ${bad}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${bad}`);
    }
  }
});

// Characterization (pre-existing behavior, unchanged): a list row with no
// `element` accepts any text, and a string row with no `pattern` keeps its
// non-blank / whitespace-free rule.
test('a list row without element and a string row without pattern behave as before', () => {
  const resolve = (key, raw) => resolvePolicyKeys([key], { policyRaw: `${key}: ${raw}\n`, runConfigRaw: null })[key];
  for (const raw of ['[a, b]', '@x,,y,', 'has space/{}']) {
    assert.deepStrictEqual(resolve('merge-sensitive-paths', raw), { value: raw, source: 'policy' }, raw);
    assert.deepStrictEqual(resolve('experiment-flag-patterns', raw), { value: raw, source: 'policy' }, raw);
  }
  assert.deepStrictEqual(resolve('integration-branch', 'develop'), { value: 'develop', source: 'policy' });
  assert.deepStrictEqual(resolve('integration-branch', 'not-a-url'), { value: 'not-a-url', source: 'policy' });
  assert.deepStrictEqual(resolve('integration-branch', 'dev branch'), { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(resolve('release-hook', 'npm run publish'), { value: 'npm run publish', source: 'policy' });
});

// ---- risk-path-globs: the block key (#4609 Task 2) ----

const BLOCK = [
  'risk-path-globs:',
  '  migrations: [migrations/**, db/schema.rb]',
  '  auth: ["src/auth/**"]   # trailing comment',
  '  public-contract:',
  '    - openapi/**',
  '    - "sdk/**"   # trailing comment',
  'autonomy: trusted',
  '',
].join('\n');

const globs = (policy) => json(policy, 'risk-path-globs')['risk-path-globs'];
const REJECTED = { value: {}, source: 'default', invalid: true };

test('AC1.3: risk-path-globs is {} in JSON when unset, and --values rejects it with no scalar form', () => {
  assert.deepStrictEqual(globs(undefined), { value: {}, source: 'default' });
  const res = values(undefined, 'risk-path-globs');
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /risk-path-globs/);
  assert.match(res.stderr, /no scalar form/);
  assert.strictEqual(res.stdout, '');
});

test('AC4.1: risk-path-globs accepts a slug-to-glob-list map (inline and block lists) and round-trips unchanged', () => {
  assert.deepStrictEqual(globs(BLOCK), {
    value: { migrations: ['migrations/**', 'db/schema.rb'], auth: ['src/auth/**'], 'public-contract': ['openapi/**', 'sdk/**'] },
    source: 'policy',
  });
});

test('the same block with CRLF line endings parses identically', () => {
  assert.deepStrictEqual(globs(BLOCK.replace(/\n/g, '\r\n')), {
    value: { migrations: ['migrations/**', 'db/schema.rb'], auth: ['src/auth/**'], 'public-contract': ['openapi/**', 'sdk/**'] },
    source: 'policy',
  });
  assert.strictEqual(json(BLOCK.replace(/\n/g, '\r\n'), 'autonomy').autonomy.value, 'trusted');
});

test('a key after the block still parses, and is not swallowed into the block', () => {
  assert.deepStrictEqual(json(BLOCK, 'autonomy').autonomy, { value: 'trusted', source: 'policy' });
  // A column-0 comment inside the block does not end it.
  const withComment = 'risk-path-globs:\n  auth: [a]\n# note\n  migrations: [b]\nautonomy: trusted\n';
  assert.deepStrictEqual(globs(withComment).value, { auth: ['a'], migrations: ['b'] });
});

test('AC4.2: risk-categories accepts extra slugs usable as map keys', () => {
  const out = globs('risk-categories: pii\nrisk-path-globs:\n  pii: [x/**]\n  auth: [y]\n');
  assert.deepStrictEqual(out, { value: { pii: ['x/**'], auth: ['y'] }, source: 'policy' });
});

test('AC4.3: an unknown slug is rejected', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  nope: [a]\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a]\n  nope: [b]\n'), REJECTED);
});

test('a slug from an invalid risk-categories value is rejected, so a typo cannot widen the map', () => {
  assert.deepStrictEqual(globs('risk-categories: Bad_Slug\nrisk-path-globs:\n  Bad_Slug: [a]\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-categories: pii,\nrisk-path-globs:\n  pii: [a]\n'), REJECTED);
});

test('AC4.4: a non-list value is rejected', () => {
  const cases = [
    'risk-path-globs:\n  auth: src/**\n',
    'risk-path-globs:\n  auth:\n',
    'risk-path-globs:\n  auth:\n  migrations: [a]\n',
    'risk-path-globs: x\n',
    'risk-path-globs: {auth: [a]}\n',
    'risk-path-globs: x\n  auth: [a]\n',
    'risk-path-globs:\n  auth: [a]\n    - x\n',
    'risk-path-globs:\n  auth: [a]\n  - x\n',
    'risk-path-globs:\n  auth: "[a]"\n',
    'risk-path-globs:\n  auth:src/**\n',
    'risk-path-globs:\n  - auth\n',
  ];
  for (const policy of cases) assert.deepStrictEqual(globs(policy), REJECTED, JSON.stringify(policy));
});

test('AC4.5: a non-string glob is rejected, inline and as a sequence item; a quoted one is a string', () => {
  for (const bad of ['1', 'true', 'false', 'null', '~', '1.5', 'True', '{a: 1}']) {
    assert.deepStrictEqual(globs(`risk-path-globs:\n  auth: [${bad}]\n`), REJECTED, `[${bad}]`);
    assert.deepStrictEqual(globs(`risk-path-globs:\n  auth:\n    - ${bad}\n`), REJECTED, `- ${bad}`);
  }
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["1", \'true\']\n').value, { auth: ['1', 'true'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - "null"\n').value, { auth: ['null'] });
});

test('a nested list, an empty element, an unbalanced brace and a duplicate slug are rejected', () => {
  const cases = [
    'risk-path-globs:\n  auth: [[a]]\n',
    'risk-path-globs:\n  auth: [a,,b]\n',
    'risk-path-globs:\n  auth: [a,]\n',
    'risk-path-globs:\n  auth: [""]\n',
    'risk-path-globs:\n  auth: [src/{a,b}/**]\n', // an unquoted comma splits the brace group
    'risk-path-globs:\n  auth: [src/{a/**]\n',
    'risk-path-globs:\n  auth: [src/a}/**]\n',
    'risk-path-globs:\n  auth: [a]\n  auth: [b]\n',
    'risk-path-globs:\n  auth: [a]\n  migrations: [b]\n  auth:\n    - c\n',
    'risk-path-globs:\n  auth:\n    -\n',
    'risk-path-globs:\n  auth:\n    - a\n    - \n',
    'risk-path-globs:\n  auth: ["a\n',
    'risk-path-globs:\n  auth: ["a" b]\n',
    'risk-path-globs:\n  auth:\n    - "a\n',
    'risk-path-globs:\n  auth: [a]\n    migrations: [b]\n', // rows must share one indent
  ];
  for (const policy of cases) assert.deepStrictEqual(globs(policy), REJECTED, JSON.stringify(policy));
});

test('a brace group is accepted when quoted or written as a sequence item', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["src/{a,b}/**"]\n').value, { auth: ['src/{a,b}/**'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - "src/{a,b}/**"\n').value, { auth: ['src/{a,b}/**'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - src/{a,b}/**\n').value, { auth: ['src/{a,b}/**'] });
});

test('a sequence written at the row\'s own indent (normal YAML) is accepted', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n  - a\n  - b\n  migrations: [c]\n').value, { auth: ['a', 'b'], migrations: ['c'] });
});

test('an empty glob list is valid, and so is a key with no rows', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: []\n'), { value: { auth: [] }, source: 'policy' });
  assert.deepStrictEqual(globs('risk-path-globs:\n'), { value: {}, source: 'policy' });
});

test('--values model-profiles still errors with its existing message', () => {
  const res = values('model-profiles:\n  standard:\n    effort: low\n', 'model-profiles');
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.stderr, 'resolve-policy: --values does not support model-profiles (no scalar form) — use the JSON output\n');
  assert.strictEqual(res.stdout, '');
  const joined = values(undefined, 'autonomy,risk-path-globs');
  assert.strictEqual(joined.status, 1);
  assert.match(joined.stderr, /risk-path-globs/);
});

test('parseRiskPathGlobs returns its three shapes', () => {
  assert.deepStrictEqual(parseRiskPathGlobs(null, []), { present: false });
  assert.deepStrictEqual(parseRiskPathGlobs('autonomy: trusted\n', []), { present: false });
  assert.deepStrictEqual(parseRiskPathGlobs('risk-path-globs:\n  auth: [a]\n', []), { present: true, ok: true, value: { auth: ['a'] } });
  const bad = parseRiskPathGlobs('risk-path-globs:\n  nope: [a]\nautonomy: trusted\n', []);
  assert.strictEqual(bad.present, true);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.raw, 'risk-path-globs:\n  nope: [a]');
  assert.deepStrictEqual(parseRiskPathGlobs('risk-path-globs:\n  pii: [a]\n', ['pii']).value, { pii: ['a'] });
});

test('auditPolicy reports an invalid block once, and nothing for a valid one', () => {
  const flagged = (policy) => auditPolicy(makeRepo(policy)).invalidValues.filter((row) => row.key === 'risk-path-globs');
  assert.strictEqual(flagged('risk-path-globs:\n  nope: [a]\n').length, 1);
  assert.strictEqual(flagged('risk-path-globs: x\n').length, 1, 'an inline value is flagged once, not twice');
  assert.strictEqual(flagged('risk-path-globs:\n  auth:\n').length, 1);
  assert.strictEqual(flagged(BLOCK).length, 0);
  assert.strictEqual(flagged('autonomy: trusted\n').length, 0);
  const report = auditPolicy(makeRepo(BLOCK));
  assert.deepStrictEqual(report.invalidValues, []);
  assert.deepStrictEqual(report.unrecognizedKeys, []);
});
