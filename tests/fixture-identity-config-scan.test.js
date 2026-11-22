'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// #5771: a fixture that sets its commit identity by spawning git's config command for the name and the
// email starts two git processes per repo it makes; `initRepo(dir, { name, email })` and `writeIdentity`
// in tests/helpers/git-fixtures.js write the same `[user]` section with none. This scan keeps those
// spawns out of the test tree: every `*.js` under tests/ is read and a file outside ALLOWLIST holding
// one is an offender. An inline `-c user.name=…` and the GIT_AUTHOR_* variables start no extra process
// and are not matched.
//
// Each file is read through the shared comment stripper (tests/helpers/strip-comments.js), so a comment
// naming the command is not a site; a file the stripper mis-parses or that does not compile as a module
// is reported as an offender, since the scan cannot see its live code. perf/ is outside the scanned
// tree: its sites are timing fixtures run by `npm run test:perf`, not suite tests.
//
// The matcher is the sweep's grep pattern, assembled from pieces so this file's own source holds no
// match (the scan reads this file like any other).
const ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');

const Q = '[\'"`]?';
const SEP = Q + '\\s*,?\\s*' + Q;
const IDENTITY_CONFIG = new RegExp('con' + 'fig' + SEP + '(?:--(?:local|global|add)' + SEP + ')?' + 'user' + '\\.(?:name|email)\\b');
const USER = 'user';

// Posix path relative to the repo root -> why that file's matches are allowed.
const ALLOWLIST = {
  'tests/bin-lib/reconcile/prune-remote.test.js': 'owned by #5769',
  'tests/bin-lib/verify/cli.test.js': `reads ${USER}.email back with git config to prove an identity reached a template copy (moved from tests/helpers-git-template.test.js by #5846)`,
  'tests/bin-lib/staged-patch/stack-check.test.js': `reads ${USER}.email back with git config to prove an identity reached a template copy (moved from tests/helpers-git-template.test.js by #5846)`,
  'tests/helpers-git-template.test.js': `reads ${USER}.name/${USER}.email back with git config to prove writeIdentity wrote them; one test title names the command; the writeIdentity byte-parity test runs git config ${USER}.name as the reference its bytes are compared against (the behaviour under test)`,
};

// 1-based line numbers of every line spawning (or naming) git config for user.name or user.email.
function identityConfigSites(text) {
  const lines = [];
  text.split('\n').forEach((line, i) => {
    if (IDENTITY_CONFIG.test(line)) lines.push(i + 1);
  });
  return lines;
}

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    corpusCache = listJs(TESTS_DIR).map((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const raw = readText(file);
      const stripped = stripComments(raw);
      return { rel, verdict: stripperVerdict(raw, stripped), sites: identityConfigSites(stripped) };
    });
  }
  return corpusCache;
}

test(`AC3.1: no test file outside the allowlist spawns git config ${USER}.name or ${USER}.email`, () => {
  const offenders = corpus()
    .filter(({ rel }) => !Object.hasOwn(ALLOWLIST, rel))
    .flatMap(({ rel, sites }) => sites.map((line) => `${rel}:${line}`));
  assert.deepEqual(offenders, [], `set the identity with initRepo(dir, { name, email }) or writeIdentity from tests/helpers/git-fixtures.js, or allowlist the file with a reason:\n${offenders.join('\n')}`);
});

test('the comment stripper parses every scanned file', () => {
  const unscannable = corpus()
    .filter(({ verdict }) => verdict !== 'ok')
    .map(({ rel, verdict }) => `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
  assert.deepEqual(unscannable, [], unscannable.join('\n'));
});

test('the scan walked the test tree', () => {
  const files = corpus();
  assert.ok(files.length >= 500, `walked only ${files.length} .js files under tests/, floor 500`);
  const template = files.find(({ rel }) => rel === 'tests/helpers-git-template.test.js');
  assert.ok(template, 'tests/helpers-git-template.test.js was not visited');
  assert.ok(template.sites.length >= 1, 'the allowlisted tests/helpers-git-template.test.js yielded no match: the matcher no longer sees a real site');
});

test('identityConfigSites matches every call shape and no inline -c identity', () => {
  const positives = [
    "git(['config', '" + USER + ".name', 'T'])",
    "execFileSync('git', ['-C', d, 'config', '" + USER + ".email', 'e'])",
    '`git config ' + USER + '.name T`',
    "git(dir, 'config', '--local', '" + USER + ".email')",
  ];
  for (const line of positives) assert.deepEqual(identityConfigSites(line), [1], line);
  assert.deepEqual(identityConfigSites(['const a = 1;', ...positives].join('\n')), [2, 3, 4, 5]);
  const negatives = [
    "['-c', '" + USER + ".name=T']",
    "'-c " + USER + ".email=e'",
    'GIT_AUTHOR_NAME',
  ];
  for (const line of negatives) assert.deepEqual(identityConfigSites(line), [], line);
});

test('a comment naming the command is not a site, a call beside it is', () => {
  const comment = '// git config ' + USER + '.name T';
  assert.deepEqual(identityConfigSites(stripComments(comment)), []);
  const call = "git(['config', '" + USER + ".name', 'T']); " + comment;
  assert.deepEqual(identityConfigSites(stripComments(call)), [1]);
});

test('every allowlist entry names an existing file that still holds a site, and carries a reason', () => {
  const siteCounts = new Map(corpus().map(({ rel, sites }) => [rel, sites.length]));
  for (const [rel, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(fs.statSync(path.join(ROOT, rel), { throwIfNoEntry: false })?.isFile(), `${rel} is not a file`);
    assert.ok((siteCounts.get(rel) ?? 0) >= 1, `${rel} holds no site any more: remove its allowlist entry`);
    assert.ok(typeof reason === 'string' && reason.trim() !== '', `${rel} has no reason`);
  }
});
