'use strict';
// #3976 Task 5: the pipelines `.gitignore` un-ignores only work/*-spec.md, never every file under
// work/ — ad hoc agent files (a prompt-audit probe, a scratch log) must not be committed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { cleanGitEnv } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const GITIGNORE = path.join(ROOT, '.gitignore');
const STEP_04 = path.join(ROOT, 'plugin', 'skills', 'init', 'bootstrap', 'step-04-gitignore-suggestions.md');

const P = '.claude-tweaks/pipelines';
const WORK_DIRS = [`${P}/*/work`, `${P}/*/spec-*/work`, `${P}/archive/*/work`, `${P}/archive/*/spec-*/work`];

// The pipelines lines before this task, frozen from `git show aaeab498b7:.gitignore` (lines 9-17, 31-38).
const PRE_CHANGE_GITIGNORE = [
  '.claude-tweaks/pipelines/*',
  '!.claude-tweaks/pipelines/*/',
  '.claude-tweaks/pipelines/*/*',
  '!.claude-tweaks/pipelines/*/work/',
  '!.claude-tweaks/pipelines/*/work/**',
  '!.claude-tweaks/pipelines/*/spec-*/',
  '.claude-tweaks/pipelines/*/spec-*/*',
  '!.claude-tweaks/pipelines/*/spec-*/work/',
  '!.claude-tweaks/pipelines/*/spec-*/work/**',
  '!.claude-tweaks/pipelines/archive/*/',
  '.claude-tweaks/pipelines/archive/*/*',
  '!.claude-tweaks/pipelines/archive/*/work/',
  '!.claude-tweaks/pipelines/archive/*/work/**',
  '!.claude-tweaks/pipelines/archive/*/spec-*/',
  '.claude-tweaks/pipelines/archive/*/spec-*/*',
  '!.claude-tweaks/pipelines/archive/*/spec-*/work/',
  '!.claude-tweaks/pipelines/archive/*/spec-*/work/**',
].join('\n') + '\n';

const lines = (text) => text.split('\n');

const ENV = { ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

// `git check-ignore -q` exit code for each path under one temp repo carrying `gitignoreText`.
function ignoreExits(gitignoreText, relPaths) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gi-narrow-'));
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), gitignoreText);
    const out = {};
    for (const rel of relPaths) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x\n');
      out[rel] = git('check-ignore', '-q', '--', rel).status;
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const RUN = '2026-11-16T000000-record-3056';
const VARIANTS = [`${P}/${RUN}/work`, `${P}/${RUN}/spec-3056/work`, `${P}/archive/${RUN}/work`, `${P}/archive/${RUN}/spec-3056/work`];

// Asserts probe files under work/ are ignored, the spec header is not, one level deeper is ignored.
function assertWorkIgnoreRule(gitignoreText) {
  const paths = [];
  for (const v of VARIANTS) paths.push(`${v}/prompt-audit-probe.txt`, `${v}/3056-spec.md`, `${v}/sub/3056-spec.md`);
  const exits = ignoreExits(gitignoreText, paths);
  for (const v of VARIANTS) {
    assert.equal(exits[`${v}/prompt-audit-probe.txt`], 0, `${v}/prompt-audit-probe.txt is not ignored`);
    assert.equal(exits[`${v}/3056-spec.md`], 1, `${v}/3056-spec.md is ignored`);
    assert.equal(exits[`${v}/sub/3056-spec.md`], 0, `${v}/sub/3056-spec.md is not ignored`);
  }
}

test('AC5.1 .gitignore un-ignores work/*-spec.md and no other file under work/', () => {
  const LINES = lines(readText(GITIGNORE));
  for (const work of WORK_DIRS) {
    const count = (line) => LINES.filter((l) => l === line).length;
    assert.equal(count(`${work}/*`), 1, `${work}/* must occur exactly once`);
    assert.equal(count(`!${work}/*-spec.md`), 1, `!${work}/*-spec.md must occur exactly once`);
    const at = LINES.indexOf(`${work}/*`);
    assert.equal(LINES[at + 1], `!${work}/*-spec.md`, `${work}/* is not followed by its *-spec.md un-ignore`);
    assert.ok(LINES.includes(`!${work}/`), `missing the directory line !${work}/`);
  }
  assert.deepEqual(LINES.filter((l) => l.endsWith('/work/**')), [], 'a blanket work/** un-ignore remains');
});

test('AC5.2 git check-ignore: work/prompt-audit-probe.txt ignored, work/3056-spec.md not', () => {
  assertWorkIgnoreRule(readText(GITIGNORE));
});

test('AC5.3 step-04 fenced block carries the identical pipelines lines', () => {
  const fence = readText(STEP_04).match(/```gitignore\n([\s\S]*?)\n```/);
  assert.ok(fence, 'no gitignore fence in step-04');
  const pipelinesLines = (text) => lines(text).filter((l) => /^!?\.claude-tweaks\/pipelines/.test(l));
  const expected = pipelinesLines(readText(GITIGNORE)).filter((l) => !/-(tidy|sweep)-standalone/.test(l));
  assert.deepEqual(pipelinesLines(fence[1]), expected);
  assert.ok(expected.length >= 21, `only ${expected.length} pipelines lines`);
});

test('go-red control: the frozen pre-change work/** lines fail the AC5.2 assertion for the named reason', () => {
  assert.ok(PRE_CHANGE_GITIGNORE.includes('!.claude-tweaks/pipelines/*/work/**'));
  assert.throws(() => assertWorkIgnoreRule(PRE_CHANGE_GITIGNORE), /prompt-audit-probe\.txt is not ignored/);
});
