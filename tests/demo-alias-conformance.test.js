'use strict';

// #4613: /claude-tweaks:demo became /claude-tweaks:accept. plugin/skills/demo/SKILL.md is now a
// deprecated alias stub: one warn-tier notice quoting the recorded removal condition, then a
// forward to /claude-tweaks:accept with the same arguments. plugin/skills/demo/deprecated-aliases.md
// holds the same condition. Both files must carry the one string byte-exactly, so the condition
// a maintainer checks at each minor release is the one users are shown.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const STUB_PATH = path.join(ROOT, 'plugin', 'skills', 'demo', 'SKILL.md');
const ALIAS_DOC_PATH = path.join(ROOT, 'plugin', 'skills', 'demo', 'deprecated-aliases.md');
const ACCEPT_PATH = path.join(ROOT, 'plugin', 'skills', 'accept', 'SKILL.md');

const REMOVAL_CONDITION =
  '`/demo` may be removed when all three hold, checked at each minor release: (a) '
  + '`grep -rFn "claude-tweaks:demo" plugin docs README.md` finds no match outside the alias '
  + 'stub, the alias doc, `docs/incident-log.md`, `docs/decisions/` and `docs/plans/`; (b) at '
  + 'least two minor releases (versions of `plugin/.claude-plugin/plugin.json`) have shipped '
  + 'after the release containing this change; (c) the maintainer has confirmed Dispatch emits '
  + '`accept:*` labels.';

const NOTICE = `Deprecated: /claude-tweaks:demo is now /claude-tweaks:accept. ${REMOVAL_CONDITION}`;

const count = (haystack, needle) => haystack.split(needle).length - 1;

function argumentHint(body, label) {
  const m = body.match(/^argument-hint:[ \t]*(.+)$/m);
  assert.ok(m, `${label} has no argument-hint line`);
  return m[1].trim();
}

test('AC1.1: the stub prints exactly one notice naming accept and the condition', () => {
  const stub = readText(STUB_PATH);
  assert.equal(count(stub, REMOVAL_CONDITION), 1, 'the removal condition must appear exactly once in the stub');
  assert.equal(count(stub, NOTICE), 1, 'the stub must carry the full notice line exactly once');
  assert.equal(count(stub, 'Deprecated'), 1, "the word 'Deprecated' must appear exactly once (the notice)");
  assert.ok(stub.includes('/claude-tweaks:accept'));
});

test('AC1.2: the stub forwards to accept with the same arguments', () => {
  const stub = readText(STUB_PATH);
  const forwarding = stub
    .split(/\r?\n/)
    .filter((line) => line.includes('/claude-tweaks:accept') && line.includes('$ARGUMENTS') && /Skill tool/.test(line));
  assert.equal(forwarding.length, 1, 'expected exactly one forwarding line naming /claude-tweaks:accept, the Skill tool and $ARGUMENTS');
});

test('AC1.2 forwards arguments: the stub argument-hint equals accept', () => {
  const stubHint = argumentHint(readText(STUB_PATH), 'plugin/skills/demo/SKILL.md');
  const acceptHint = argumentHint(readText(ACCEPT_PATH), 'plugin/skills/accept/SKILL.md');
  assert.equal(stubHint, acceptHint);
});

test('AC5.1: deprecated-aliases.md has a /demo row carrying the condition verbatim', () => {
  const doc = readText(ALIAS_DOC_PATH);
  const heading = '## `/demo` (deprecated alias for `/claude-tweaks:accept`)';
  const start = doc.indexOf(heading);
  assert.ok(start !== -1, `missing section heading: ${heading}`);
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/^## /m);
  const section = end === -1 ? rest : rest.slice(0, end);
  assert.equal(count(section, REMOVAL_CONDITION), 1, 'the /demo section must carry the removal condition exactly once');
});

test('AC5.2: the alias notice quotes it', () => {
  const stub = readText(STUB_PATH);
  const doc = readText(ALIAS_DOC_PATH);
  assert.ok(stub.includes(REMOVAL_CONDITION) && doc.includes(REMOVAL_CONDITION));
});

// "Small" is pinned by structure, not by a byte count: decision 0024 makes
// plugin/bin/lib/skill-audit/budgets.js the only home for a skill-size number
// (tests/skill-size-single-source.test.js fails on one here), and that file holds
// platform-limit rails only. What the stub must not grow is acceptance mechanics.
test('the stub stays small: two steps and no acceptance mechanics', () => {
  const stub = readText(STUB_PATH);
  const steps = stub.match(/^## Step \d+\b.*$/gm) || [];
  assert.deepEqual(steps, ['## Step 1: Notice', '## Step 2: Forward']);
  for (const mechanic of ['acceptance-packet.js', 'gh issue', 'AskUserQuestion', '--add-label', '--remove-label']) {
    assert.ok(!stub.includes(mechanic), `the alias stub must not carry acceptance mechanics (found '${mechanic}')`);
  }
});

// AC6: removal condition (a), mechanized. git grep reads tracked files only, the same set the
// condition's `grep -rFn` is meant to judge. The allowed set is exactly the condition's: a match
// anywhere else, docs/superpowers/plans/ included, would keep condition (a) from ever holding.
const AC6_ALLOWED = [
  'plugin/skills/demo/SKILL.md',
  'plugin/skills/demo/deprecated-aliases.md',
  'docs/incident-log.md',
  'docs/decisions/',
  'docs/plans/',
];

function ac6Grep() {
  let out;
  try {
    out = execFileSync('git', ['grep', '-n', '-F', 'claude-tweaks:demo', '--', 'plugin', 'docs', 'README.md'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (err) {
    if (err.status === 1) return []; // git grep: 1 = no match; anything else is a real failure
    throw err;
  }
  return out.split(/\r?\n/).filter(Boolean);
}

test('AC6.1: no claude-tweaks:demo outside the allowed set', () => {
  const offenders = ac6Grep().filter((line) => !AC6_ALLOWED.some((prefix) => line.startsWith(prefix)));
  assert.deepEqual(offenders, [], `claude-tweaks:demo cited outside the allowed set:\n${offenders.join('\n')}`);
});

test('AC6.1: the allowed set is exactly the one removal condition (a) names', () => {
  // (a) names the stub and the alias doc in words, then each other path as a code span.
  const clause = REMOVAL_CONDITION.slice(REMOVAL_CONDITION.indexOf('finds no match outside'), REMOVAL_CONDITION.indexOf('; (b)'));
  const named = [...clause.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(AC6_ALLOWED, [path.relative(ROOT, STUB_PATH).split(path.sep).join('/'), path.relative(ROOT, ALIAS_DOC_PATH).split(path.sep).join('/'), ...named]);
});

test('AC6.2: the grep is live', () => {
  const lines = ac6Grep();
  assert.ok(lines.some((line) => line.startsWith('plugin/skills/demo/SKILL.md:')), 'the grep must match the alias stub');
  assert.ok(lines.some((line) => line.startsWith('plugin/skills/demo/deprecated-aliases.md:')), 'the grep must match the alias doc');
});
