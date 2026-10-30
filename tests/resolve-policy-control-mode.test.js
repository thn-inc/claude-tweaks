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

const { POLICY_KEYS, resolvePolicyKeys, parseRiskPathGlobs, auditPolicy, BUILTIN_RISK_CATEGORIES } = require('../plugin/bin/lib/policy-schema');
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
    // The first three start with a quote; the rest open a quote later in the value (a cut leaves it unclosed).
    for (const raw of [
      '"curl https://x/#y"', "'curl https://x/#y'", '"never closed',
      'curl "https://x/#y"', "deploy --note 'a#b' --prod", '"a" "b#c"', "deploy --note='a#b'",
      // A double quote glued to a word opens too.
      'git commit -m"fix #12"', 'curl -H"X: a#b" http://x', 'cmd >"a#b"',
      // A backslash escapes the next character, so this `"` does not close the quote.
      'x "a\\"#b"',
    ]) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

test('closed quotes in the middle of a value stay valid, and an apostrophe inside a word opens no quote', () => {
  const resolve = (key, raw) => json(`${key}: ${raw}\n`, key)[key];
  assert.deepStrictEqual(resolve('deploy-command', 'curl "https://x/y" --go'), { value: 'curl "https://x/y" --go', source: 'policy' });
  assert.deepStrictEqual(resolve('deploy-command', "deploy --note='a b' --prod"), { value: "deploy --note='a b' --prod", source: 'policy' });
  assert.deepStrictEqual(resolve('deploy-command', "sh -c 'echo \"x\"'"), { value: "sh -c 'echo \"x\"'", source: 'policy' });
  assert.deepStrictEqual(resolve('deploy-live-workflow', "Deploy Bob's app"), { value: "Deploy Bob's app", source: 'policy' });
  // Inside single quotes a backslash is not an escape, so this `'` closes the quote.
  assert.deepStrictEqual(resolve('deploy-command', "x 'a\\'"), { value: "x 'a\\'", source: 'policy' });
  assert.deepStrictEqual(resolve('deploy-command', 'git commit -m"fix it" --all'), { value: 'git commit -m"fix it" --all', source: 'policy' });
});

// Characterization (pre-existing, pinned by tests/policy-schema.test.js F6/#2253):
// release-hook keeps an unbalanced quote as an ordinary value; the closed-quote
// rule is opt-in per row and belongs to the #4609 keys only. Its other outcomes
// are pinned here at their base values too, including the missing `value`.
test('release-hook is unaffected by the closed-quote rule', () => {
  assert.deepStrictEqual(json('release-hook: "never closed\n', 'release-hook')['release-hook'], { value: '"never closed', source: 'policy' });
  for (const raw of ['""', "''", '"  "']) {
    assert.deepStrictEqual(json(`release-hook: ${raw}\n`, 'release-hook')['release-hook'], { source: 'policy' }, raw);
  }
  assert.deepStrictEqual(json('release-hook: "a" "b"\n', 'release-hook')['release-hook'], { value: 'a" "b', source: 'policy' });
  assert.deepStrictEqual(json("release-hook: 'a b' 'c'\n", 'release-hook')['release-hook'], { value: "a b' 'c", source: 'policy' });
});

test('a blank quoted closed-quote value is rejected, not resolved to a missing value', () => {
  for (const key of ['deploy-command', 'deploy-live-workflow', 'dev-test-account']) {
    for (const raw of ['""', "''", '"  "']) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

test('outer quotes are stripped only when they enclose the whole value; otherwise it is kept as written', () => {
  for (const key of ['deploy-command', 'deploy-live-workflow', 'dev-test-account']) {
    const resolve = (raw) => json(`${key}: ${raw}\n`, key)[key];
    assert.deepStrictEqual(resolve('"npm run x"'), { value: 'npm run x', source: 'policy' }, key);
    assert.deepStrictEqual(resolve("'npm run x'"), { value: 'npm run x', source: 'policy' }, key);
    for (const raw of ["'a b' 'c'", '"/opt/my tools/run.sh" "my arg"', '"a" && "b"']) {
      assert.deepStrictEqual(resolve(raw), { value: raw, source: 'policy' }, `${key}: ${raw}`);
      assert.strictEqual(values(`${key}: ${raw}\n`, key).stdout, `${raw}\n`, `${key}: ${raw}`);
    }
    // An escaped quote inside double quotes does not end the pair; the value is not unescaped.
    assert.deepStrictEqual(resolve('"a \\"b\\" c"'), { value: 'a \\"b\\" c', source: 'policy' }, key);
    // In single quotes a backslash escapes nothing, so `\'` closes and the pair does not enclose the rest.
    assert.deepStrictEqual(resolve("'a\\' 'b'"), { value: "'a\\' 'b'", source: 'policy' }, key);
    assert.deepStrictEqual(resolve("'a\\'"), { value: 'a\\', source: 'policy' }, key);
    // The other quote kind inside a whole-value pair: stripped, and never re-judged as unclosed once bare.
    assert.deepStrictEqual(resolve('"a \'b"'), { value: "a 'b", source: 'policy' }, key);
    assert.deepStrictEqual(resolve("'a \"b'"), { value: 'a "b', source: 'policy' }, key);
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
const REJECTED = { value: null, source: 'default', invalid: true };
const flaggedGlobs = (policy) => auditPolicy(makeRepo(policy)).invalidValues.filter((row) => row.key === 'risk-path-globs');

test('the risk-path-globs summary names its pairing with risk-categories, without its own key', () => {
  const { summary } = POLICY_KEYS.find((row) => row.key === 'risk-path-globs');
  assert.match(summary, /risk-categories/);
  assert.doesNotMatch(summary, /risk-path-globs/);
  assert.ok(summary.length <= 140, `${summary.length} characters`);
});

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
  // `path: src/**` and `a:` are mappings, not strings, unquoted; a colon inside a path is fine.
  // `{a}` is a flow mapping too, and the others are block-sequence, block-scalar, anchor and tag syntax.
  for (const bad of ['1', 'true', 'false', 'null', '~', '1.5', 'True', '{a: 1}', '{a}', 'path: src/**', 'a:', '- a', '|', '>', '&a x', '!!str x']) {
    assert.deepStrictEqual(globs(`risk-path-globs:\n  auth: [${bad}]\n`), REJECTED, `[${bad}]`);
    assert.deepStrictEqual(globs(`risk-path-globs:\n  auth:\n    - ${bad}\n`), REJECTED, `- ${bad}`);
  }
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["1", \'true\']\n').value, { auth: ['1', 'true'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - "null"\n').value, { auth: ['null'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["path: src/**", C:/x, src/a:b/**]\n').value, { auth: ['path: src/**', 'C:/x', 'src/a:b/**'] });
  // Ordinary globs that merely look like YAML indicators stay valid, inline and as items.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [*.sql, "**/x", -x/**]\n').value, { auth: ['*.sql', '**/x', '-x/**'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - *.sql\n    - **/x\n    - -x/**\n').value, { auth: ['*.sql', '**/x', '-x/**'] });
});

// Valid YAML must not fall into the empty-map path (the plan-review ruling).
test('one trailing comma is valid; a doubled comma stays rejected', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a, b,]\n').value, { auth: ['a', 'b'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a, ]\n').value, { auth: ['a'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a,,b]\n'), REJECTED);
});

test('a multi-line flow list parses, with comments and CRLF', () => {
  const policy = [
    'risk-path-globs:',
    '  auth: [',
    '    a,   # first',
    '    "b #c",',
    '    d',
    '  ]',
    '  migrations: [x]',
    'autonomy: trusted',
    '',
  ].join('\n');
  const expected = { auth: ['a', 'b #c', 'd'], migrations: ['x'] };
  assert.deepStrictEqual(globs(policy), { value: expected, source: 'policy' });
  assert.deepStrictEqual(globs(policy.replace(/\n/g, '\r\n')), { value: expected, source: 'policy' });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    a,\n    b,\n  ]\n').value, { auth: ['a', 'b'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n  ]\n').value, { auth: [] });
  // The list closes on bracket balance, not on a line that ends in `]`: an element may end in a character class.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    src/[ab],\n    src/[cd]\n  ]\n').value, { auth: ['src/[ab]', 'src/[cd]'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    a,\n    src/*.[ch]\n  ]\n  migrations: [x]\n').value, { auth: ['a', 'src/*.[ch]'], migrations: ['x'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a,\n    "b]", c]\n').value, { auth: ['a', 'b]', 'c'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    src/[ab]\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a] x\n'), REJECTED);
  // A list that never closes inside the block is rejected.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    a,\n    b\nautonomy: trusted\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [\n    a,\n  migrations: [b]\n'), REJECTED);
});

test('a # inside a quoted item is not a comment', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - "a #b"   # real comment\n    - \'c #d\'\n').value, { auth: ['a #b', 'c #d'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["a #b", c]   # real comment\n').value, { auth: ['a #b', 'c'] });
  // A bare # after whitespace still starts a comment; an apostrophe inside a bare glob opens no quote.
  assert.deepStrictEqual(globs("risk-path-globs:\n  auth:\n    - it's/**   # comment\n    - a#b\n").value, { auth: ["it's/**", 'a#b'] });
  // A stray, unmatched quote opens nothing, so it cannot swallow the comment after it.
  assert.deepStrictEqual(globs("risk-path-globs:\n  auth:\n    - foo 'bar   # note\n").value, { auth: ["foo 'bar"] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - foo "bar   # note\n').value, { auth: ['foo "bar'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - "bar   # note\n'), REJECTED);
  // After whitespace a quote opens only after `[`, `,`, `-` or nothing, so an apostrophe in the comment closes nothing.
  assert.deepStrictEqual(globs("risk-path-globs:\n  auth:\n    - foo 'bar   # don't\n").value, { auth: ["foo 'bar"] });
  // A quote glued to a word opens nothing, whatever follows.
  assert.deepStrictEqual(globs("risk-path-globs:\n  auth:\n    - it's/**   # don't\n").value, { auth: ["it's/**"] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - foo-"bar   # baz"\n').value, { auth: ['foo-"bar'] });
});

test('a quoted ] in a multi-line flow list does not close the list', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a, "b]",\n    c]\n'), { value: { auth: ['a', 'b]', 'c'] }, source: 'policy' });
});

test('a malformed block resolves null, never the {} an unset key gives', () => {
  const resolved = (policyRaw) => resolvePolicyKeys(['risk-path-globs'], { policyRaw, runConfigRaw: null })['risk-path-globs'];
  assert.deepStrictEqual(resolved('risk-path-globs:\n  auth: [a,,b]\n'), REJECTED);
  assert.deepStrictEqual(resolved(null), { value: {}, source: 'default' });
  const raws = [];
  resolvePolicyKeys(['risk-path-globs'], { policyRaw: 'risk-path-globs:\n  nope: [a]\n', onInvalid: (key, raw) => raws.push([key, raw]) });
  assert.deepStrictEqual(raws, [['risk-path-globs', 'risk-path-globs:\n  nope: [a]']]);
});

test('a respelled or indented key line is rejected and flagged, never read as an absent key', () => {
  for (const line of ['risk-path-globs :', '"risk-path-globs":', "'risk-path-globs':", ' risk-path-globs:', '\trisk-path-globs:', '  "risk-path-globs" :']) {
    for (const policy of [`${line}\n  auth: [a]\n`, `${line}\n`, `autonomy: trusted\n${line}\n  auth: [a]\nautonomy: trusted\n`]) {
      assert.deepStrictEqual(globs(policy), REJECTED, JSON.stringify(policy));
      assert.strictEqual(flaggedGlobs(policy).length, 1, JSON.stringify(policy));
    }
  }
  assert.strictEqual(flaggedGlobs('"risk-path-globs":\n  auth: [a]\nautonomy: trusted\n')[0].value, '"risk-path-globs":\n  auth: [a]');
  // A respelling after a valid block is a second block.
  const second = 'risk-path-globs:\n  auth: [a]\nautonomy: trusted\n"risk-path-globs":\n  migrations: [b]\n';
  assert.deepStrictEqual(globs(second), REJECTED);
  assert.strictEqual(flaggedGlobs(second)[0].value, 'risk-path-globs:\n  auth: [a]\n"risk-path-globs":\n  migrations: [b]');
  // A respelling inside the block is that block's bad row, reported once.
  assert.strictEqual(flaggedGlobs('risk-path-globs:\n  auth: [a]\n  "risk-path-globs":\n')[0].value, 'risk-path-globs:\n  auth: [a]\n  "risk-path-globs":');
  // Neither a comment nor a longer key name is a spelling of it.
  for (const policy of ['# risk-path-globs:\n', 'risk-path-globs-old:\n', '  # risk-path-globs:\n']) {
    assert.deepStrictEqual(globs(policy), { value: {}, source: 'default' }, JSON.stringify(policy));
    assert.strictEqual(flaggedGlobs(policy).length, 0, JSON.stringify(policy));
  }
});

test('a column-0 line naming an allowed slug directly ending the block is rejected and flagged', () => {
  const cases = [
    'risk-path-globs:\nauth: [a]\n',
    'risk-path-globs:\n# note\nauth: [a]\n',
    'risk-path-globs:\n  auth: [a]\nmigrations: [b]\n',
    'risk-path-globs:\n"auth": [a]\n',
    'risk-path-globs:\nauth : [a]\n',
    'risk-categories: pii\nrisk-path-globs:\npii: [a]\n',
  ];
  for (const policy of cases) {
    assert.deepStrictEqual(globs(policy), REJECTED, JSON.stringify(policy));
    assert.strictEqual(flaggedGlobs(policy).length, 1, JSON.stringify(policy));
  }
  assert.strictEqual(flaggedGlobs('risk-path-globs:\n  auth: [a]\nmigrations: [b]\nautonomy: trusted\n')[0].value, 'risk-path-globs:\n  auth: [a]\nmigrations: [b]');
  // A bare key stays valid: commented-out rows produce it, and the next key is not a slug.
  for (const policy of ['risk-path-globs:\nautonomy: trusted\n', 'risk-path-globs:\n#  auth: [a]\nautonomy: trusted\n', 'risk-path-globs:\nnope: [a]\n']) {
    assert.deepStrictEqual(globs(policy), { value: {}, source: 'policy' }, JSON.stringify(policy));
    assert.strictEqual(flaggedGlobs(policy).length, 0, JSON.stringify(policy));
  }
  // Only a slug already further down the file: not directly ending the block, so not this rule.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a]\nautonomy: trusted\nmigrations: [b]\n').value, { auth: ['a'] });
});

test('quoted keys, a space before the colon and doubled-quote escapes are not read', () => {
  for (const policy of [
    'risk-path-globs:\n  "auth": [a]\n',
    "risk-path-globs:\n  'auth': [a]\n",
    'risk-path-globs:\n  auth : [a]\n',
    "risk-path-globs:\n  auth: ['it''s']\n",
    'risk-path-globs:\n  auth:\n    - "a" "b"\n',
  ]) assert.deepStrictEqual(globs(policy), REJECTED, JSON.stringify(policy));
});

test('unbalanced brackets in an unquoted element are rejected; a character class is a glob', () => {
  for (const bad of ['[a] [b]', '[a]]', '[[a]', '[a[, b]', '[x, a]]']) {
    assert.deepStrictEqual(globs(`risk-path-globs:\n  auth: ${bad}\n`), REJECTED, bad);
  }
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [src/[ab]/**, x]\n').value, { auth: ['src/[ab]/**', 'x'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - src/[ab]/**\n').value, { auth: ['src/[ab]/**'] });
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: ["a] [b"]\n').value, { auth: ['a] [b'] });
});

test('a column-0 sequence under the key, a second block and uneven sequence indent are rejected', () => {
  assert.deepStrictEqual(globs('risk-path-globs:\n- x\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n# note\n- x\n'), REJECTED);
  // A column-0 dash ending the block is rejected after rows too, never read as the end of a valid map.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a]\n- x\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - a\n# note\n- x\nautonomy: trusted\n'), REJECTED);
  // An item left of its row's indent is not that row's sequence.
  assert.deepStrictEqual(globs('risk-path-globs:\n    auth:\n  - a\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  migrations: [b]\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth: [a]\nrisk-path-globs: x\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n      - a\n    - b\n'), REJECTED);
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - a\n      - b\n'), REJECTED);
  // The same indent throughout is fine, and a second row may use a different sequence indent.
  assert.deepStrictEqual(globs('risk-path-globs:\n  auth:\n    - a\n    - b\n  migrations:\n      - c\n').value, { auth: ['a', 'b'], migrations: ['c'] });
});

test('risk-path-globs ignores the --run config overlay', () => {
  const runConfig = 'risk-path-globs:\n  auth: [from-run]\n';
  assert.deepStrictEqual(
    resolvePolicyKeys(['risk-path-globs'], { policyRaw: null, runConfigRaw: runConfig })['risk-path-globs'],
    { value: {}, source: 'default' },
  );
  assert.deepStrictEqual(
    resolvePolicyKeys(['risk-path-globs'], { policyRaw: 'risk-path-globs:\n  auth: [from-policy]\n', runConfigRaw: runConfig })['risk-path-globs'],
    { value: { auth: ['from-policy'] }, source: 'policy' },
  );
  // And through the CLI: a --run dir (outside the checkout, so the anchoring guard allows it) holding the block.
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-policy-control-run-'));
  tempDirs.push(runDir);
  fs.writeFileSync(path.join(runDir, 'config.yml'), runConfig);
  const res = spawnSync(process.execPath, [CLI, '--run', runDir, 'risk-path-globs'], { cwd: makeRepo(undefined), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout)['risk-path-globs'], { value: {}, source: 'default' });
});

test('a nested list, an empty element, an unbalanced brace and a duplicate slug are rejected', () => {
  const cases = [
    'risk-path-globs:\n  auth: [[a]]\n',
    'risk-path-globs:\n  auth: [a,,b]\n',
    'risk-path-globs:\n  auth: [a,,]\n', // only ONE trailing comma is valid YAML-ish tolerance
    'risk-path-globs:\n  auth: [,]\n',
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
  // A comment may follow the colon on the key line; an inline value may not.
  assert.deepStrictEqual(globs('risk-path-globs:   # note\n  auth: [a]\n').value, { auth: ['a'] });
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
  assert.deepStrictEqual(parseRiskPathGlobs(null, BUILTIN_RISK_CATEGORIES), { present: false });
  assert.deepStrictEqual(parseRiskPathGlobs('autonomy: trusted\n', BUILTIN_RISK_CATEGORIES), { present: false });
  assert.deepStrictEqual(parseRiskPathGlobs('risk-path-globs:\n  auth: [a]\n', BUILTIN_RISK_CATEGORIES), { present: true, ok: true, value: { auth: ['a'] } });
  const bad = parseRiskPathGlobs('risk-path-globs:\n  nope: [a]\nautonomy: trusted\n', BUILTIN_RISK_CATEGORIES);
  assert.strictEqual(bad.present, true);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.raw, 'risk-path-globs:\n  nope: [a]');
  // The allowed slugs are exactly what the caller passes: the parser knows no built-ins.
  assert.deepStrictEqual(parseRiskPathGlobs('risk-path-globs:\n  pii: [a]\n', ['pii']).value, { pii: ['a'] });
  assert.strictEqual(parseRiskPathGlobs('risk-path-globs:\n  auth: [a]\n', ['pii']).ok, false);
});

test('auditPolicy reports an invalid block once, and nothing for a valid one', () => {
  const flagged = flaggedGlobs;
  assert.strictEqual(flagged('risk-path-globs:\n  nope: [a]\n').length, 1);
  assert.strictEqual(flagged('risk-path-globs: x\n').length, 1, 'an inline value is flagged once, not twice');
  assert.strictEqual(flagged('risk-path-globs:\n  auth:\n').length, 1);
  assert.strictEqual(flagged('risk-path-globs:\n- x\n').length, 1, 'a column-0 sequence under the key is not silently an empty map');
  assert.strictEqual(flagged('risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  migrations: [b]\n').length, 1, 'a second block');
  assert.strictEqual(flagged('risk-path-globs:\n  auth: [a]\n- x\n').length, 1, 'a column-0 dash after rows');
  // The reported value carries the offending text, not just the first block.
  const rowText = (policy) => flagged(policy)[0].value;
  assert.strictEqual(rowText('risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  migrations: [b]\n'), 'risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  migrations: [b]');
  assert.strictEqual(rowText('risk-path-globs:\n  auth: [a]\nautonomy: trusted\nrisk-path-globs:\n  migrations: [b]\n'), 'risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  migrations: [b]');
  assert.strictEqual(rowText('risk-path-globs:\n  auth: [a]\n- x\nautonomy: trusted\n'), 'risk-path-globs:\n  auth: [a]\n- x');
  assert.strictEqual(rowText('risk-path-globs:\n  auth: [a]\n  nope: [b]\nautonomy: trusted\n'), 'risk-path-globs:\n  auth: [a]\n  nope: [b]');
  assert.strictEqual(parseRiskPathGlobs('risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  nope: [b]\n', BUILTIN_RISK_CATEGORIES).raw, 'risk-path-globs:\n  auth: [a]\nrisk-path-globs:\n  nope: [b]');
  assert.strictEqual(flagged(BLOCK).length, 0);
  assert.strictEqual(flagged('autonomy: trusted\n').length, 0);
  const report = auditPolicy(makeRepo(BLOCK));
  assert.deepStrictEqual(report.invalidValues, []);
  assert.deepStrictEqual(report.unrecognizedKeys, []);
});
