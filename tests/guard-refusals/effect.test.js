'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyEffect, WRITE_WORDS } = require('../../tools/guard-refusals/effect');
const { WRITE_SHAPES } = require('../../plugin/bin/lib/hooks/git-command');
const { GATE_COVERAGE } = require('../../plugin/bin/lib/hooks/pre-tool-use');

// #5587: tools/guard-refusals/effect.js says whether a refused Bash command
// only reads, writes, or cannot be judged. A command that can write is never
// `read`, and an unlisted command word is `unknown`, never `read`.

const MINIMAL = {
  cp: 'cp a b',
  mv: 'mv a b',
  tee: 'tee f',
  sed: 'sed -i s/a/b/ f',
  perl: 'perl -i -pe 1 f',
  install: 'install a b',
  ln: 'ln -s a b',
  truncate: 'truncate -s 0 f',
  dd: 'dd of=f',
  rm: 'rm x',
  mkdir: 'mkdir d',
  touch: 'touch f',
  chmod: 'chmod +x f',
  find: 'find . -delete',
  curl: 'curl -o f https://x',
  sort: 'sort -o f g',
};

test('AC3: every WRITE_SHAPES, WRITE_WORDS and GATE_COVERAGE.gitActions member has a minimal writing case that is write', () => {
  for (const w of [...WRITE_SHAPES, ...Object.keys(WRITE_WORDS)]) {
    assert.ok(MINIMAL[w], `${w} has no case`);
    assert.equal(classifyEffect(MINIMAL[w]).effect, 'write', `${w}: ${MINIMAL[w]}`);
  }
  for (const sub of GATE_COVERAGE.gitActions) {
    assert.equal(classifyEffect(`git ${sub} x`).effect, 'write', `git ${sub} x`);
  }
});

const TABLE = [
  ['git log; rm x', 'write'],
  ['git log "$(rm x)"', 'write'],
  ['cat a > b', 'write'],
  ['ls 2>/dev/null', 'read'],
  ['echo x >&2', 'read'],
  ['node /abs/x.js', 'unknown'],
  ['frobnicate x', 'unknown'],
  ['git branch --show-current', 'read'],
  ['git branch -D x', 'write'],
  ["gh api graphql -f query='query { viewer { login } }'", 'read'],
  ["gh api graphql -f query='mutation { x }'", 'write'],
  ['echo `rm x`', 'write'],
  ['ls && rm x', 'write'],
  ['ls | tee f', 'write'],
  ['ls 2>&1', 'read'],
  ['ls &>/dev/null', 'read'],
  ['ls >& out', 'write'],
  ['cat <<EOF\nrm x\nEOF', 'read'],
  ['node <<EOF\nx\nEOF', 'unknown'],
  ['sed -n p f', 'read'],
  // Spec decision: sed is write only with -i/--in-place; every other form is read, whatever its script.
  ["sed -n 'w out' f", 'read'],
  ['sed -f s.sed f', 'read'],
  ['sed --in-place s/a/b/ f', 'write'],
  ['find . -name x', 'read'],
  ['find . -exec rm {} \\;', 'write'],
  ['curl https://x', 'read'],
  ['sort f', 'read'],
  ['perl -ne 1 f', 'unknown'],
  ['dd if=a', 'unknown'],
  ['git status', 'read'],
  ['git -C /x status', 'read'],
  ['git diff --output=f', 'write'],
  ['git fetch', 'write'],
  ['git branch foo', 'write'],
  ['git branch', 'read'],
  ['git tag', 'read'],
  ['git tag v1', 'write'],
  ['git stash list', 'read'],
  ['git stash', 'write'],
  ['git worktree list', 'read'],
  ['git worktree add x', 'write'],
  ['git config --get a.b', 'read'],
  ['git config a.b c', 'write'],
  ['git remote -v', 'read'],
  ['gh pr view 1', 'read'],
  ['gh pr merge 1', 'write'],
  ['gh issue list', 'read'],
  ['gh api repos/o/r/pulls', 'read'],
  ['gh api -X POST repos/o/r/issues', 'write'],
  ['gh api repos/o/r/issues -f title=x', 'write'],
  ['gh api -X GET search/issues -f q=x', 'read'],
  ['gh api graphql -f query=@q.graphql', 'unknown'],
  ['gh api graphql -f query="$Q"', 'unknown'],
  ['node -e 1', 'unknown'],
  ['python3 x.py', 'unknown'],
  ['playwright-cli open', 'unknown'],
  ['bash x.sh', 'unknown'],
  ['$CMD x', 'unknown'],
  ['env FOO=1 ls', 'read'],
  ['env FOO=1 rm x', 'write'],
  ['timeout 5 ls', 'read'],
  ['command -v git', 'read'],
  ['for f in a b; do cat $f; done', 'read'],
  ['if test -f x; then cat x; fi', 'read'],
  ['cd /x && ls', 'read'],
  ['ls | xargs rm', 'unknown'],
  ["awk '{print}' f", 'unknown'],
  ['/bin/rm x', 'write'],
  ['echo hi > /dev/null', 'read'],
  ['mkdir -p d', 'write'],
  ['tree -o f', 'unknown'],
  ['xxd a b', 'unknown'],
  ['hostname x', 'unknown'],
  ['date -s 1', 'unknown'],
  ["git -c core.pager='rm x' log", 'unknown'],
  ["git -c alias.x='!rm x' x", 'unknown'],
  ['git -c color.ui=never log', 'read'],
];

test('AC4: verdict table pins at least 60 commands', () => {
  assert.ok(TABLE.length >= 60, `only ${TABLE.length} rows`);
  for (const [command, effect] of TABLE) {
    assert.equal(classifyEffect(command).effect, effect, command);
  }
});

test('classifyEffect returns a why naming the program for unknown', () => {
  assert.equal(classifyEffect('node /abs/x.js').why, 'node script');
  assert.equal(classifyEffect('node -e 1').why, 'node -e');
  assert.equal(classifyEffect('python3 x').why, 'python3');
  assert.equal(classifyEffect('frobnicate').why, 'unlisted word: frobnicate');
});

// Shapes that look like reads but can write or run a program: each resolves
// away from `read`.
const NEVER_READ = [
  ['cat <<EOF\n$(rm x)\nEOF', 'unknown'],
  ['echo "$(echo ")"; rm x)"', 'write'],
  ['echo "$(echo ")"; ls)"', 'unknown'],
  ['PATH=/x ls', 'unknown'],
  ['git -c credential.helper=x status', 'unknown'],
  ['git log --out=f', 'write'],
  ['curl --trace f https://x', 'write'],
  ['rg --pre cmd x', 'unknown'],
  ['/bin/r? x', 'unknown'],
  ['{rm,ls} x', 'unknown'],
  ['', 'unknown'],
  ['   ', 'unknown'],
  [`${'echo $('.repeat(8)}echo hi${')'.repeat(8)}`, 'read'],
  [`${'echo $('.repeat(9)}echo hi${')'.repeat(9)}`, 'unknown'],
  ['echo $((1+2))', 'read'],
  ['echo $(( $(rm x) ))', 'write'],
  ['case x in a) rm y ;; esac', 'write'],
  ['case x in a) ls ;; b) cat f ;; esac', 'read'],
];

test('shapes that could write are never read', () => {
  for (const [command, effect] of NEVER_READ) {
    assert.equal(classifyEffect(command).effect, effect, JSON.stringify(command));
  }
});
