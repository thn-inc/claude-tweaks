'use strict';
// tests/wrap-up-closing-records-array-fill.test.js — #4107: Section C step 2's
// closing-records fill must yield one ISSUES element per record under bash AND
// zsh. zsh does not word-split an unquoted expansion, so `ISSUES=($CLOSING)`
// collapsed "101 202" into one element and the carrier commit wrote
// `Fixes #101 202`. The live fenced block (cut before the commit guard, so no
// `git commit` ever runs) and a frozen copy of the pre-change block go through
// the same runner, under both shells.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const SKILL = path.join(__dirname, '..', 'plugin/skills/wrap-up/cleanup-procedures-execution.md');
const ANCHOR = '2. **Stamp the closing-keyword carrier commit';
const GUARD = 'if [ "${#ISSUES[@]}" -gt 0 ]';

// Section C step 2's fenced block as shipped: from the anchor's ```bash fence up
// to the commit guard, dedented from the list item's 3-space indent.
function liveBlock() {
  const text = readText(SKILL);
  const start = text.indexOf(ANCHOR);
  assert.ok(start !== -1, 'Section C step 2 anchor vanished — the cases below would be vacuous');
  const open = text.indexOf('```bash\n', start);
  assert.ok(open !== -1, 'Section C step 2 bash fence vanished');
  const body = text.indexOf('\n', open) + 1;
  const end = text.indexOf(GUARD, body);
  assert.ok(end !== -1, 'commit guard vanished — the cut would no longer keep git commit out of the run');
  const block = text.slice(body, end).replace(/^ {3}/gm, '');
  assert.doesNotMatch(block, /git commit/, 'the extracted block must never run git commit');
  return block;
}

// Frozen pre-change block: Section C step 2 as shipped at d4d40c982 (`c.join(" ")`
// and `ISSUES=($CLOSING)`), dedented the same way. It runs through the same runner
// as the live block, so the zsh case proves the defect on this machine.
const PRE_CHANGE_BLOCK = [
  'ISSUES=()',
  'PACK="${RUN_DIR}/wrap-up-pack.json"',
  'MIRROR="{worktree}/.claude-tweaks/pipelines/{run-id}"',
  `if [ -f "$PACK" ] && CLOSING=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=p.inputs&&p.inputs.closingRecords;if(!Array.isArray(c))process.exit(1);console.log(c.join(" "))' -- "$PACK" 2>/dev/null); then`,
  '  ISSUES=($CLOSING)',
  'else',
  '  for f in "${MIRROR}"/work/*-spec.md; do',
  '    [ -e "$f" ] || continue',
  '    ISSUES+=("$(grep -m1 \'^record:\' "$f" | sed \'s/^record: *//\')")',
  '  done',
  'fi',
  '',
].join('\n');

// zsh -f reads no rc files, so nothing can set SH_WORD_SPLIT behind the test's back.
const SHELLS = [
  { name: 'bash', cmd: 'bash', args: ['--noprofile', '--norc'] },
  { name: 'zsh', cmd: 'zsh', args: ['-f'] },
];

const PROBE = [
  "printf 'count=%s\\n' \"${#ISSUES[@]}\"",
  "for e in \"${ISSUES[@]}\"; do printf 'el=%s\\n' \"$e\"; done",
].join('\n');

const onPath = (cmd) => !spawnSync(cmd, ['--version'], { encoding: 'utf8' }).error;
const skipFor = (shell) => (onPath(shell.cmd) ? false : `${shell.cmd} not on PATH`);

// Run one block under one shell with a pack whose inputs.closingRecords is `records`.
// Returns the ISSUES element count and the elements, as the probe prints them.
function runBlock(shell, block, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4107-'));
  try {
    // Forward slashes: Git Bash on a Windows runner reads C:/… but not C:\….
    const posixDir = dir.split(path.sep).join('/');
    fs.writeFileSync(path.join(dir, 'wrap-up-pack.json'), JSON.stringify({ inputs: { closingRecords: records } }));
    const script = path.join(dir, 'snippet.sh');
    fs.writeFileSync(script, `${block.split('${RUN_DIR}').join(posixDir)}\n${PROBE}\n`);
    const r = spawnSync(shell.cmd, [...shell.args, script.split(path.sep).join('/')], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${shell.name} exited ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /^count=\d+\n/, `${shell.name} printed no count line: ${r.stdout}${r.stderr}`);
    const lines = r.stdout.split('\n').filter(Boolean);
    return {
      count: Number(lines[0].slice('count='.length)),
      els: lines.slice(1).map((l) => l.slice('el='.length)),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CASES = [
  { records: [101, 202], expect: ['101', '202'] },
  { records: [101], expect: ['101'] },
  { records: [], expect: [] },
];

for (const shell of SHELLS) {
  const skip = skipFor(shell);
  for (const { records, expect } of CASES) {
    test(`${shell.name}: live block fills ${expect.length} element(s) for closingRecords ${JSON.stringify(records)}`, { skip }, () => {
      assert.deepStrictEqual(runBlock(shell, liveBlock(), records), { count: expect.length, els: expect });
    });
  }
}

for (const shell of SHELLS) {
  const skip = skipFor(shell);
  test(`${shell.name}: pre-change block for closingRecords [101, 202] — zsh collapses it to one element, bash splits it`, { skip }, () => {
    const expect = shell.name === 'zsh' ? { count: 1, els: ['101 202'] } : { count: 2, els: ['101', '202'] };
    assert.deepStrictEqual(runBlock(shell, PRE_CHANGE_BLOCK, [101, 202]), expect);
  });
  for (const { records, expect } of CASES.slice(1)) {
    test(`${shell.name}: pre-change block fills ${expect.length} element(s) for closingRecords ${JSON.stringify(records)}`, { skip }, () => {
      assert.deepStrictEqual(runBlock(shell, PRE_CHANGE_BLOCK, records), { count: expect.length, els: expect });
    });
  }
}
