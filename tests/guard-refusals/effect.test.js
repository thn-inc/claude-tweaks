'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyEffect, classifyByTables, WRITE_WORDS, GIT_WRITE } = require('../../tools/guard-refusals/effect');
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
  less: 'less -o f x',
  file: 'file -C x',
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

// classifyEffect asks the write gate first, which masks the word tables for
// every WRITE_SHAPES and gitActions member; classifyByTables skips the gate.
test('every WRITE_WORDS, GIT_WRITE and gitActions member is write by the tables alone', () => {
  for (const w of Object.keys(WRITE_WORDS)) {
    assert.equal(classifyByTables(MINIMAL[w]).effect, 'write', `${w}: ${MINIMAL[w]}`);
  }
  for (const sub of GIT_WRITE) {
    assert.equal(classifyByTables(`git ${sub} x`).effect, 'write', `git ${sub} x`);
  }
  for (const sub of GATE_COVERAGE.gitActions) {
    assert.ok(GIT_WRITE.includes(sub), `${sub} missing from GIT_WRITE`);
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
  // AC9 remedy: a sed script that writes a file (w, W, s///w) or runs a program (e, s///e) is write, and a
  // script the classifier cannot read (a script file, an expansion) is unknown. The full table is SED_SCRIPTS.
  ["sed -n 'w out' f", 'write'],
  ['sed -f s.sed f', 'unknown'],
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
  // Only the write gate (git-command.js) catches this: the scan alone says unknown.
  ['git -c core.x=y commit', 'write'],
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
  ['[[ -f x ]]&&rm y', 'write'],
  ['[[ -f x ]]&& find . -delete', 'write'],
  ['[[ -f x ]]||gh pr merge 1', 'write'],
  ['[[ -f x ]]|tee f', 'write'],
  ['[[ -f x ]]>f', 'write'],
  ['[[ -f x ]]&&ls', 'read'],
  ['for f do gh pr merge 1; done', 'write'],
  ['for f do find . -delete; done', 'write'],
  ['for f do cat $f; done', 'read'],
  ['select f do rm $f; done', 'write'],
  ['curl -d x https://x', 'write'],
  ['curl --data-binary @f https://x', 'write'],
  ['curl --json {} https://x', 'write'],
  ['curl -F a=b https://x', 'write'],
  ['curl -T f https://x', 'write'],
  ['curl -X DELETE https://x', 'write'],
  ['curl -XPOST https://x', 'write'],
  ['curl --request=PUT https://x', 'write'],
  ['curl -sX POST https://x', 'write'],
  ['curl -X GET https://x', 'read'],
  ['curl -X HEAD https://x', 'read'],
  ['less -o f x', 'write'],
  ['less x', 'read'],
  ['./cat x', 'unknown'],
  ['../x', 'unknown'],
  ['bin/x', 'unknown'],
  ['export PATH=/x; ls', 'unknown'],
  ['export FOO=1; ls', 'read'],
  ['echo $((1+2))', 'read'],
  ['echo $(( $(rm x) ))', 'write'],
  ['case x in a) rm y ;; esac', 'write'],
  ['case x in a) ls ;; b) cat f ;; esac', 'read'],
  // A computed argument to a reader with a write flag could be that flag.
  ['sed "$OPTS" s/a/b/ f', 'unknown'],
  ['sed $OPTS s/a/b/ f', 'unknown'],
  ['sed -n "${a}p" f', 'unknown'],
  // A quoted expansion inside a sed script is still script text the classifier cannot read.
  ['sed -n "x${a}p" f', 'unknown'],
  ['curl $ARGS https://x', 'unknown'],
  ['curl "https://$h/x"', 'read'],
  ['find . $ACTION', 'unknown'],
  ['sort $O f', 'unknown'],
  ['less $L f', 'unknown'],
  ['rg $FLAGS x', 'unknown'],
  ['rg "$(echo --pre=x)" y', 'unknown'],
  ['rg x f', 'read'],
  ['ls $X', 'read'],
  ['cat "$f"', 'read'],
  // esac | must not hide a later writer.
  ['case a in a) ls;; esac | gh pr merge 1 | cat', 'write'],
  ['case a in a) ls;; esac | rm x | cat', 'write'],
  ['case a in a) ls;; esac | cat', 'read'],
  // git config write flags match by unique-prefix abbreviation.
  ['git config --unset-a foo.a', 'write'],
  ['git config --remove bar', 'write'],
  ['git config --ed', 'write'],
  ['git config --get a.b', 'read'],
  // Hazard environment variables that run a program from a reader.
  ["LESSOPEN='|rm x %s' less f", 'unknown'],
  ["LESSCLOSE='rm x' less f", 'unknown'],
  ['RIPGREP_CONFIG_PATH=/x rg y', 'unknown'],
  ['CURL_HOME=/x curl https://x', 'unknown'],
  ['file -C x', 'write'],
  ['file --compile x', 'write'],
  ['file x', 'read'],
  // curl -w %output{…} writes a file (curl 8.3+).
  ["curl -w '%output{f}' https://x", 'write'],
  ["curl --write-out '%output{f}' https://x", 'write'],
  ["curl -sw '%output{f}' https://x", 'write'],
  ["curl -w '%{http_code}' https://x", 'read'],
  // -X counts only where X is an option letter, and the method compares as curl sends it.
  ['curl -uXav:pw https://x', 'read'],
  ['curl -sX POST https://x', 'write'],
  ['curl -sXPOST https://x', 'write'],
  ['curl -sHXa:b -X POST https://x', 'write'],
  ['curl -X get https://x', 'write'],
  ['curl --request=head https://x', 'write'],
  ['curl -X GET https://x', 'read'],
  // -R takes no value, so it must not end the cluster scan.
  ['curl -RX POST https://x', 'write'],
  ['curl -sRX PUT https://x', 'write'],
  // An unquoted expansion mid-word can split into a write flag; a quoted one cannot.
  ['sed s/a/b/$O f', 'unknown'],
  ['curl https://x$O', 'unknown'],
  ['sort f$O', 'unknown'],
  ['rg x$F y', 'unknown'],
  ['less f$L', 'unknown'],
  ['sed s/a/b/`echo x` f', 'unknown'],
  ['less "f$L"', 'read'],
  ['sort "f$O"', 'read'],
  // git read verdicts: a word that starts with an expansion (quoted or not) or holds an unquoted one is computed.
  ['git diff $X', 'unknown'],
  ['git log $X', 'unknown'],
  ['git log "$X"', 'unknown'],
  ['git log a$X', 'unknown'],
  ['git log "a$X"', 'read'],
  ['git log --oneline', 'read'],
  ['git -C "$W" status', 'read'],
  ['git log -- "$f"', 'read'],
  ['git diff --output=f $X', 'write'],
];

test('a shape that could write or run a program is never read, and shapes that only look risky stay read', () => {
  for (const [command, effect] of NEVER_READ) {
    assert.equal(classifyEffect(command).effect, effect, JSON.stringify(command));
  }
});

// One row per sed script shape. `write`: the script writes a file or runs a program. `unknown`: the script, or
// which word is the script, cannot be read with confidence. `read`: every command in it only edits the stream.
const SED_SCRIPTS = [
  // w and W commands write a file, with or without an address, a block or an earlier command.
  ["sed 'w out' f", 'write'],
  ["sed -e 'w out' f", 'write'],
  ["sed -n 'W out' f", 'write'],
  ["sed --expression='w out' f", 'write'],
  ["sed -ne 'w out' f", 'write'],
  ["sed -n '/x/w out' f", 'write'],
  ["sed '1,5w out' f", 'write'],
  ["sed '$!w out' f", 'write'],
  ["sed 'p;w out' f", 'write'],
  ["sed 's/x/y/;w out' f", 'write'],
  ["sed 's/x/y/\nw out' f", 'write'],
  ["sed -n '/x/{p;w out' -e '}' f", 'write'],
  // The s command's w flag writes; its e flag and the e command run a program.
  ["sed 's/a/b/w out' f", 'write'],
  ["sed 's/a/b/gw out' f", 'write'],
  ["sed 's/a/b/e' f", 'write'],
  ["sed '1e date' f", 'write'],
  ["sed e f", 'write'],
  // GNU sed takes options after the file; BSD sed takes the first operand as the script. Either can write.
  ["sed -e p f -e 'w out'", 'write'],
  ["sed 'w out' f -e p", 'write'],
  // A script file, a computed script, an option or a script the scanner cannot follow: never read.
  ['sed --file=s.sed f', 'unknown'],
  ['sed -nf s.sed f', 'unknown'],
  ['sed -n "1,${n}p" f', 'unknown'],
  ["sed 's/a/b' f", 'unknown'],
  ["sed 'k' f", 'unknown'],
  ["sed 's/[/]/x/' f", 'unknown'],
  ['sed -l p f', 'unknown'],
  ['sed --frob p f', 'unknown'],
  ['sed f.txt -e p', 'unknown'],
  // BSD's in-place flag: the write gate already names it, whatever the script scan says of the option.
  ['sed -I .bak s/a/b/ f', 'write'],
  // Scripts that only edit the stream, including w and e as data and text that only looks like a command.
  ['sed -n p f', 'read'],
  ['sed -n 1,5p f', 'read'],
  ['sed s/a/b/ f', 'read'],
  ["sed -e s/a/b/ -e 's/c/d/g' f", 'read'],
  ['sed --expression=s/a/b/ f', 'read'],
  ['sed -ne 5p f', 'read'],
  ["sed -n '/start/,/end/p' f", 'read'],
  ["sed 's/w/e/' f", 'read'],
  ["sed 's|/a/w|/b/e|g' f", 'read'],
  ["sed -n '$p' f", 'read'],
  ["sed -E 's/(a|b)+/x/g' f", 'read'],
  ["sed '/^#/d; s/[0-9]*$//' f", 'read'],
  ["sed -n '2{p;q}' f", 'read'],
  ["sed 'y/abw/xye/' f", 'read'],
  ["sed '1a hello; w out' f", 'read'],
  ["sed '1r other' f", 'read'],
  ["sed ':a;N;$!ba;s/\\n/ /g' f", 'read'],
  ["sed 's/a/b/I' f", 'read'],
  ["sed 's/a/b/2g' f", 'read'],
  ["sed '\\,^/usr,d' f", 'read'],
  ["sed 's/a\\/w/b/' f", 'read'],
  ['sed --version', 'read'],
];

test('a sed script that writes or runs a program is write, an unreadable one is unknown, and the rest stay read', () => {
  // Every wrong row at once: one failing row must not hide the others.
  const wrong = SED_SCRIPTS
    .map(([command, effect]) => [command, effect, classifyEffect(command).effect])
    .filter(([, effect, got]) => got !== effect);
  assert.deepEqual(wrong, []);
});

// Hand-written, not read from WRITE_WORDS: a flag dropped from the table fails its case below, and a flag added
// to the table with no entry here fails the cross-check after it.
const PINNED_WRITE_TOKENS = {
  sed: ['-i', '--in-place'],
  perl: ['-i'],
  dd: ['of='],
  find: ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'],
  curl: ['-o', '-O', '-D', '-c', '-K', '-d', '-F', '-T', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '--form', '--form-string', '--upload-file', '--output', '--remote-name', '--remote-name-all', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc', '--config'],
  less: ['-o', '-O', '--log-file', '--LOG-FILE'],
  file: ['-C', '--compile'],
  sort: ['-o', '--output', '--compress-program'],
};

test('every flag, exact word and operand prefix a WRITE_WORDS entry lists is pinned and makes its word write', () => {
  for (const [word, tokens] of Object.entries(PINNED_WRITE_TOKENS)) {
    for (const token of tokens) {
      const command = `${word} . ${token} x`;
      assert.equal(classifyByTables(command).effect, 'write', command);
    }
  }
  for (const [word, entry] of Object.entries(WRITE_WORDS)) {
    if (entry.any) continue;
    const listed = [...[...(entry.short || '')].map((l) => `-${l}`), ...(entry.long || []), ...(entry.exact || []), ...(entry.prefix || [])];
    assert.deepEqual([...listed].sort(), [...(PINNED_WRITE_TOKENS[word] || [])].sort(), `${word}: table and pinned tokens differ`);
  }
});

test('every environment variable HAZARD_ENV names turns a reader into unknown', () => {
  const names = ['PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV', 'ENV', 'IFS', 'PAGER', 'EDITOR', 'VISUAL', 'SHELL', 'LESSOPEN', 'LESSCLOSE', 'RIPGREP_CONFIG_PATH', 'CURL_HOME',
    'GIT_PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_EXTERNAL_DIFF', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_EXEC_PATH', 'GIT_PROXY_COMMAND', 'GIT_CONFIG_COUNT'];
  for (const name of names) {
    assert.equal(classifyEffect(`${name}=x git log`).effect, 'unknown', name);
    assert.equal(classifyEffect(`export ${name}=x; ls`).effect, 'unknown', `export ${name}`);
  }
  assert.equal(classifyEffect('FOO=x git log').effect, 'read');
});

const RUNS_A_PROGRAM = [
  // gh api graphql: a query document that also holds a mutation is a write.
  ["gh api graphql -f query='query Q { viewer { login } } mutation M { x }'", 'write'],
  ["gh api graphql -f query='query Q { viewer { login } }'", 'read'],
  ["gh api graphql -f query='{ viewer { login } }'", 'read'],
  // A free-standing unquoted expansion can split into -X DELETE, -f body=… or --input.
  ['gh api repos/o/r/issues/1', 'read'],
  ['gh api repos/o/r/issues/1 $FLAGS', 'unknown'],
  ['gh api -X GET repos/o/r/issues/1 $FLAGS', 'unknown'],
  ["gh api graphql -f query='{ viewer { login } }' $FLAGS", 'unknown'],
  ['gh api -X DELETE repos/o/r/issues/1 $FLAGS', 'write'],
  ['gh api repos/o/r/issues/1 "x$FLAGS"', 'read'],
  // rg and git ls-remote flags that run a program.
  ['rg --hostname-bin=x foo', 'unknown'],
  ['rg --pre=x foo', 'unknown'],
  ["git ls-remote --upload-pack='touch x' /repo", 'unknown'],
  ["git ls-remote --exec='touch x' /repo", 'unknown'],
  ["git ls-remote --upload-pack 'touch x' /repo", 'unknown'],
  ['git ls-remote --upl=x /repo', 'unknown'],
  ['git ls-remote origin', 'read'],
  ['git ls-remote --heads origin', 'read'],
];

test('gh api, rg and git ls-remote forms that run a program or hide a write flag are not read', () => {
  for (const [command, effect] of RUNS_A_PROGRAM) {
    assert.equal(classifyEffect(command).effect, effect, JSON.stringify(command));
  }
});
