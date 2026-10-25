// tests/hooks-bash-prefilter.test.js
//
// #3074: hooks.json registers ONE unconditional Bash handler per event; this
// prefilter is what keeps an uninteresting Bash call from paying the full
// handler. It must be a SUPERSET of the old per-pattern `if` predicates —
// a false "skip" silently drops enforcement, a false "run" costs one module load.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const {
  commandWords, shouldRunFull, earlyGate, hasFileRedirection,
} = require('../plugin/bin/lib/hooks/bash-prefilter');
const {
  WRITE_SHAPES, GUARDED_PROGRAM_WORDS, gitTargets, fileWriteTargets, mkdirTargets, powershellOpaqueCommand,
} = require('../plugin/bin/lib/hooks/git-command');
const { teardownTargets } = require('../plugin/bin/lib/hooks/pre-tool-use');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

// #3092: the corpus is run through the REAL guard parsers, so a word dropped
// from GUARDED_PROGRAM_WORDS (or a parser keyed on a word the constant never
// learned) shows up as a targeted command the prefilter skips. Every entry
// must produce a target; see the sanity test below. The corpus and
// PARSERS_BY_EVENT are hand-kept: a parser branch keyed on a new word is caught
// only once a corpus line exercises it, so a change that adds one adds its line here.
const CWD = process.cwd();
const DIFFERENTIAL_CORPUS = [
  'cp a.txt b.txt', 'mv a.txt b.txt', 'echo x | tee out.txt', 'sed -i s/a/b/ f.txt',
  'perl -pi -e s/a/b/ f.txt', 'install -m 644 a.txt dest.txt', 'ln -s a.txt link.txt',
  'truncate -s 0 f.txt', 'dd if=/dev/zero of=f.bin count=1', 'mkdir -p newdir',
  'git commit -m x', 'git push', 'git rm f.txt', 'env git commit -m x', 'env -i git push',
  '/usr/bin/git commit -m x', 'git worktree remove ../w',
  'G=git; $G commit -m x', 'C=cp; $C a.txt b.txt', 'X=mk; ${X}dir d',
  'powershell -EncodedCommand QQBCAEMA', 'pwsh -Command "echo hi"',
  // #3080: bare redirection has no command word — hasFileRedirection, not the
  // word scan, is what reaches it; see shouldRunFull's pre-tool-use-only OR.
  'echo x > tracked.js',
  // #4015: a redirect glued to a word.
  'echo foo>tracked.js',
  // #4210: a glued redirect after a quoted span.
  'echo "hi">tracked.js',
];
const teardown = (command) => teardownTargets({ input: { tool_name: 'Bash', tool_input: { command } }, cwd: CWD });
const powershell = (command) => (powershellOpaqueCommand(command, CWD) ? [{ action: 'powershell-opaque' }] : []);
// post-tool-use.js runs only the git-family parsers (gitTargets + teardownTargets' Bash branch).
const PARSERS_BY_EVENT = {
  'pre-tool-use': [(c) => gitTargets(c, CWD), (c) => fileWriteTargets(c, CWD), (c) => mkdirTargets(c, CWD), teardown, powershell],
  'post-tool-use': [(c) => gitTargets(c, CWD), teardown],
};
const targeted = (event, command) => PARSERS_BY_EVENT[event].some((parse) => parse(command).length > 0);

test('every differential-corpus command produces at least one guard-parser target (corpus has not rotted)', () => {
  for (const command of DIFFERENTIAL_CORPUS) {
    assert.ok(targeted('pre-tool-use', command), `no parser targets ${JSON.stringify(command)} — fix or drop the corpus entry`);
  }
});

for (const event of Object.keys(PARSERS_BY_EVENT)) {
  test(`${event}: every command a guard parser targets takes the full-handler path (#3092)`, () => {
    for (const command of DIFFERENTIAL_CORPUS) {
      if (!targeted(event, command)) continue;
      assert.strictEqual(shouldRunFull(event, bash(command)), true,
        `${event} prefilter skips ${JSON.stringify(command)} although a guard parser targets it`);
    }
  });
}

test('every guarded program word except env is the sole trigger of some targeted corpus command', () => {
  // Removing such a word from GUARDED_PROGRAM_WORDS makes its witness skip, so
  // the differential tests above fail. `env` is superset hygiene: every env-wrapped
  // command findGitLead resolves also carries `git`, so no witness can exist.
  const all = Object.values(GUARDED_PROGRAM_WORDS).flat();
  assert.ok(all.includes('env'), 'env must stay in the git family (findGitLead walks past it)');
  for (const word of all.filter((w) => w !== 'env')) {
    const witness = DIFFERENTIAL_CORPUS.find((command) => {
      if (!targeted('pre-tool-use', command) || /=/.test(command.split(/\s/)[0])) return false;
      const covered = [...commandWords(command)].filter((w) => all.includes(w));
      return covered.length === 1 && covered[0] === word;
    });
    assert.ok(witness, `no corpus command is triggered by '${word}' alone — add one so dropping it fails`);
  }
});

test('commandWords splits on whitespace and shell operators, strips quotes, takes basenames', () => {
  const w = commandWords('cd x && FOO=1 /usr/bin/git commit -m "y" | tee "out.txt"; echo $(git rev-parse HEAD)');
  for (const expected of ['cd', 'git', 'commit', 'tee', 'echo', 'rev-parse']) assert.ok(w.has(expected), expected);
  assert.ok(commandWords('"C:\\Program Files\\Git\\bin\\git.exe" status').has('git'));
});

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'timeout 5 git push',
  'env git commit -m x', 'env -i git commit -m x', 'env -C /x git commit -m y', 'env -u FOO git push',
  'git -c user.name=x commit -m y', 'git --exec-path=/x commit -m y', 'git --namespace=n push',
  'git -C . status', 'git worktree add ../w', 'git worktree remove ../w', '/usr/bin/git commit -m x',
  'for f in a b; do sed -i s/x/y/ "$f"; done', 'P=/tmp; cp a "$P/b"', 'mkdir -p "$TEMP/d"',
  'echo "$(git rev-parse HEAD)"', 'xargs git add < files.txt', 'git stash', 'git stash pop',
  // $VAR program indirection (substituteVars) and adjacent-span quoting reach a covered word.
  'G=git; $G commit -m x', 'C=cp; $C a b', 'M=mkdir; $M -p d', '"g"it commit -m x',
  // A program name CONCATENATED from an assignment and literal text: substituteVars
  // rewrites prefix + value + suffix, so the handler resolves these too.
  'G=gi; ${G}t commit -m x', 'X=it; g$X commit', 'X=c; ${X}p a.txt b.txt', 'X=mk; ${X}dir d',
  'X=t; gi$X push', 'A=tr; ${A}uncate -s 0 f', 'G=gi\n${G}t push',
  ...WRITE_SHAPES.map((s) => `${s} a b`),
]) {
  test(`pre-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), true);
  });
}

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'env -C /x git commit -m y',
  'git -c user.name=x commit -m y', 'git worktree remove ../w', 'for n in 1 2; do git push; done',
  'G=git; $G push', 'G=gi; ${G}t push',
]) {
  test(`post-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), true);
  });
}

for (const command of ['echo hi', 'ls -la', 'node script.js', 'for i in 1; do echo probe-loop-$i; done',
  'echo digit gitk sedate envoy', 'gh issue view 3074', '']) {
  test(`pre-tool-use skips: ${JSON.stringify(command)}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), false);
  });
}

test('post-tool-use skips write shapes it never handled (cp/mkdir/sed)', () => {
  for (const command of ['cp a b', 'mkdir -p d', 'sed -i s/a/b/ f']) {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), false, command);
  }
});

// #3080: hasFileRedirection unit cases — run/skip, standalone/glued, and the
// fd-dup/DEVNULL_LIKE exclusions the common `2>&1`/`> /dev/null` shapes need
// to stay cheap.
for (const command of [
  'echo x > tracked.js', 'printf y >> tracked.js', 'echo x >out.js', 'cmd &> f', 'cmd &>> f',
  'cmd >| f', 'cmd 2>> err.log', 'echo foo>out.js', 'cat a.txt>b.txt',
  'echo "hi">out.js', '(ls)>out.js',
]) {
  test(`hasFileRedirection detects: ${command}`, () => {
    assert.strictEqual(hasFileRedirection(command), true, command);
  });
}
for (const command of ['echo hi', 'cmd 2>&1', 'cmd >&2', 'echo x > /dev/null', 'cmd > /dev/stdout', 'echo "a > b"',
  'echo "foo>x"', "echo 'foo>x'", '[[ a>b ]]', 'echo foo">"x', '((i>0))']) {
  test(`hasFileRedirection does not trigger on: ${JSON.stringify(command)}`, () => {
    assert.strictEqual(hasFileRedirection(command), false, command);
  });
}

test('AC3.1 #4015: the differential corpus lists the glued shape, and it takes the full-handler path', () => {
  assert.ok(DIFFERENTIAL_CORPUS.includes('echo foo>tracked.js'));
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo foo>tracked.js')), true);
});

// #4210 F1/F3: the prefilter shares redirectWriteTargets, so a `>` in a nested
// "$( … )" context or a quoted leading `>` stays on the skip path, while a closed
// substitution or an escaped prefix character still reaches the full handler.
test('#4210 F1 F3: hasFileRedirection skips a nested or quoted leading `>`, and sees a redirect after a closed "$( … )"', () => {
  for (const command of [
    'echo "$(jq -r ".a>1" f.json)"', 'echo "$(echo "a>b")"', 'echo "$(cmd "x y>z")"', 'echo "${x:-"a>b"}"',
    'echo ">x"', 'gh issue comment 1 --body "> quoted reply"', 'V=">x"; echo $V',
    "git commit -m \"$(cat <<'EOF'\nfix: treat \"a | b>c\" as literal\nEOF\n)\"", 'msg="$(git log -1 --format="%s | %an>")"',
  ]) {
    assert.strictEqual(hasFileRedirection(command), false, command);
  }
  for (const command of [
    '"$(date)">out.js', 'echo "$(date)" foo>out.js', 'echo foo\\ bar>out.js',
    "git commit -m \"$(cat <<'EOF'\nDon't merge yet\nEOF\n)\" && echo x > out.js", 'echo "${x:-(}" > out.js',
  ]) {
    assert.strictEqual(hasFileRedirection(command), true, command);
  }
});

test('AC3.1 #4210: the differential corpus lists the quoted-word shape, and it takes the full-handler path', () => {
  assert.ok(DIFFERENTIAL_CORPUS.includes('echo "hi">tracked.js'));
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo "hi">tracked.js')), true);
});

test('shouldRunFull ORs hasFileRedirection into pre-tool-use only, never post-tool-use', () => {
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo x > f.js')), true);
  assert.strictEqual(shouldRunFull('post-tool-use', bash('echo x > f.js')), false,
    'post-tool-use never consumes fileWriteTargets, so widening it here would cost every redirecting post-tool-use call for nothing');
});

// #3989: the prefilter applies the parser's heredoc-body stripping, so a `>`
// inside a body never sends a call down the full path, while a redirect after
// the closing delimiter, or one inside a shell-fed body, still does.
test('#3989: hasFileRedirection ignores a heredoc body but sees a redirect after the delimiter or inside a shell-fed body', () => {
  assert.strictEqual(hasFileRedirection('node x.js <<EOF\nif (a > 0) b();\nEOF'), false);
  assert.strictEqual(hasFileRedirection('bash <<EOF\necho x > f.js\nEOF'), true);
  assert.strictEqual(hasFileRedirection('node x.js <<EOF\na\nEOF\necho x > f.js'), true);
  // Fix round 1 (#3989): an unterminated body keeps the text from its opener on.
  assert.strictEqual(hasFileRedirection('node x.js <<EOF\nbody\necho x > f.js'), true);
  // #4149: a non-shell executor reads its body too, so the body stays visible.
  assert.strictEqual(hasFileRedirection('make -f - <<EOF\nall:\n\techo x > f.js\nEOF'), true);
});

// #4149: the prefilter reads the outer text and every kept body chunk, so an odd
// quote in a kept body cannot hide a later redirect, and a body kept for a structure opened on an
// earlier line still sends the call down the full path.
test('#4149: hasFileRedirection reads the outer text and every kept body chunk', () => {
  assert.strictEqual(hasFileRedirection("grep -c x <<'EOF'\ndon't\nEOF\necho x > f.js"), true);
  assert.strictEqual(hasFileRedirection("{\ncat <<'EOF'\necho x > f.js\nEOF\n} | bash"), true);
  assert.strictEqual(hasFileRedirection("git commit -F - <<'EOF'\na > /main/x\nEOF"), false);
});

// #4149: a lone `&` ends the inert neighbour's command, so the backgrounded shell's
// body is kept and its redirect sends the call down the full path; a body kept for a non-shell
// consumer is also read whole, so an inner recipe heredoc cannot hide a redirect.
test('#4149: hasFileRedirection sees a body behind a lone & and inside a make recipe heredoc', () => {
  assert.strictEqual(hasFileRedirection("echo hi & bash <<'EOF'\necho x > f.js\nEOF\nwait"), true);
  assert.strictEqual(hasFileRedirection("make -s -f - <<'EOF'\nall:\n\tcat <<-X\n\techo x > f.js\n\tX\nEOF"), true);
  assert.strictEqual(hasFileRedirection("git add -A && git commit -F - <<'EOF'\na > /main/x\nEOF"), false);
});

test('fails open to "run" on anything it cannot read', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    assert.strictEqual(shouldRunFull(event, null), true);
    assert.strictEqual(shouldRunFull(event, []), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash' }), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash', tool_input: { command: 42 } }), true);
  }
});

test('an event name that is an Object.prototype key is not a governed event', () => {
  let reads = 0;
  assert.strictEqual(earlyGate('toString', () => { reads += 1; return '{}'; }), null);
  assert.strictEqual(reads, 0);
  assert.strictEqual(shouldRunFull('constructor', bash('echo hi')), true);
});

test('never skips a non-Bash tool', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'ExitWorktree', 'EnterWorktree', 'Skill', 'AskUserQuestion']) {
    for (const event of ['pre-tool-use', 'post-tool-use']) {
      assert.strictEqual(shouldRunFull(event, { tool_name: tool, tool_input: {} }), true, `${event} ${tool}`);
    }
  }
});

test('earlyGate reads stdin only for the governed tool-use events', () => {
  let reads = 0;
  const reader = (raw) => () => { reads += 1; return raw; };
  assert.strictEqual(earlyGate('session-start', reader('{}')), null);
  assert.strictEqual(earlyGate('record-worktree', reader('{}')), null);
  assert.strictEqual(reads, 0);
  const raw = JSON.stringify(bash('echo hi'));
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader(raw)), { raw, skip: true });
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader('not json')), { raw: 'not json', skip: false });
  assert.deepStrictEqual(earlyGate('post-tool-use', () => { throw new Error('EAGAIN'); }), { raw: '', skip: false });
});

// UserPromptSubmit fires on EVERY human prompt and Claude Code waits for it, so
// the gate is one raw substring test — JSON never escapes `/` or `:`, which makes
// `claude-tweaks:` a superset of every line the handler could record. Garbage and
// unreadable stdin skip because the handler would do nothing with them either.
test('earlyGate governs user-prompt-submit by a raw substring test', () => {
  let reads = 0;
  const reader = (raw) => () => { reads += 1; return raw; };
  const plain = '{"prompt":"hello there"}';
  assert.deepStrictEqual(earlyGate('user-prompt-submit', reader(plain)), { raw: plain, skip: true });
  assert.strictEqual(reads, 1);
  const typed = '{"prompt":"/claude-tweaks:help"}';
  assert.deepStrictEqual(earlyGate('user-prompt-submit', reader(typed)), { raw: typed, skip: false });
  // Superset: a mid-prompt mention runs the handler, which makes the real decision.
  const mention = '{"prompt":"see /claude-tweaks:build"}';
  assert.deepStrictEqual(earlyGate('user-prompt-submit', reader(mention)), { raw: mention, skip: false });
  assert.deepStrictEqual(earlyGate('user-prompt-submit', reader('not json')), { raw: 'not json', skip: true });
  assert.deepStrictEqual(earlyGate('user-prompt-submit', () => { throw new Error('EAGAIN'); }), { raw: '', skip: true });
  assert.strictEqual(reads, 4, 'one read per call, never a second');
  // A large prompt with no marker still takes the cheap path, read exactly once.
  reads = 0;
  const big = '{"prompt":"' + 'x'.repeat(1024 * 1024) + '"}';
  const gated = earlyGate('user-prompt-submit', reader(big));
  assert.strictEqual(gated.skip, true);
  assert.strictEqual(gated.raw, big);
  assert.strictEqual(reads, 1);
});

// #2783 M3: every failing Bash call fires PostToolUseFailure, but the handler
// only ever acts on the harness worktree-isolation refusal text.
const REFUSAL = 'This session is isolated in the worktree /w, but this command cannot be shown not to be git. Refusing to run it — a worktree-isolated session\'s git operations must target its own worktree.';
test('#2783: earlyGate skips a post-tool-use-failure payload unless it carries the harness refusal text', () => {
  const failed = JSON.stringify({ ...bash('git status'), error: 'Command failed with exit code 1' });
  assert.deepStrictEqual(earlyGate('post-tool-use-failure', () => failed), { raw: failed, skip: true });
  const refused = JSON.stringify({ ...bash('echo hi'), error: REFUSAL });
  assert.deepStrictEqual(earlyGate('post-tool-use-failure', () => refused), { raw: refused, skip: false });
  const escaped = refused.replace('Refusing', '\\u0052efusing');
  assert.strictEqual(earlyGate('post-tool-use-failure', () => escaped).skip, false, 'a JSON-escaped spelling still reaches the handler');
  assert.deepStrictEqual(earlyGate('post-tool-use-failure', () => 'not json'), { raw: 'not json', skip: true });
});

// ── e2e: bin/hooks.js's early exit (#3074) ───────────────────────────────────
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prefilter-'));
after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });
// A --require'd probe that records which modules this process loaded, so the
// test can prove the skip path never loaded the heavy ones.
const PROBE = path.join(SANDBOX, 'probe.js');
fs.writeFileSync(PROBE, "process.on('exit', () => { require('fs').writeFileSync(process.env.CT_PROBE_OUT, JSON.stringify(Object.keys(require.cache))); });\n");

function spawnHook(event, payload, { cwd = SANDBOX } = {}) {
  const out = path.join(SANDBOX, `loaded-${process.hrtime.bigint()}.json`);
  const stdout = execFileSync('node', ['--require', PROBE, HOOKS, event], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd, encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', CT_PROBE_OUT: out },
  });
  return { stdout, loaded: JSON.parse(fs.readFileSync(out, 'utf8')) };
}
const loadedModule = (loaded, rel) => loaded.some((p) => p.replace(/\\/g, '/').endsWith(rel));

test('e2e: an uninteresting Bash call exits 0 with no output and never loads the heavy modules', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    const { stdout, loaded } = spawnHook(event, { ...bash('echo hi'), cwd: SANDBOX });
    assert.strictEqual(stdout, '', event);
    assert.ok(!loadedModule(loaded, 'lib/hooks/context.js'), `${event} loaded context.js on the skip path`);
    assert.ok(!loadedModule(loaded, `lib/hooks/${event}.js`), `${event} loaded its event module on the skip path`);
  }
});

test('e2e (probe discriminates): a covered Bash call DOES load the event module', () => {
  const { loaded } = spawnHook('pre-tool-use', { ...bash('git status'), cwd: SANDBOX });
  assert.ok(loadedModule(loaded, 'lib/hooks/pre-tool-use.js'));
  assert.ok(loadedModule(loaded, 'lib/hooks/context.js'));
});

// #3080 AC: `cmd 2>&1` / `cmd > /dev/null` with no other covered word must take
// the skip path — same require.cache probe as the plain-skip test above,
// proving the added hasFileRedirection scan doesn't itself pull in the heavy
// modules for the shapes it's designed to keep cheap.
test('e2e #3080: `2>&1` / `> /dev/null` with no other covered word never load the heavy modules', () => {
  for (const command of ['cmd 2>&1', 'cmd > /dev/null']) {
    const { stdout, loaded } = spawnHook('pre-tool-use', { ...bash(command), cwd: SANDBOX });
    assert.strictEqual(stdout, '', command);
    assert.ok(!loadedModule(loaded, 'lib/hooks/context.js'), `${command} loaded context.js on the skip path`);
    assert.ok(!loadedModule(loaded, 'lib/hooks/pre-tool-use.js'), `${command} loaded pre-tool-use.js on the skip path`);
  }
});

// #3080: the inverse discrimination — a real redirection write DOES reach the
// full handler, so the probe above is proving something, not a tautology.
test('e2e #3080 (probe discriminates): a bare redirection write DOES load the event module', () => {
  const { loaded } = spawnHook('pre-tool-use', { ...bash('echo x > f.js'), cwd: SANDBOX });
  assert.ok(loadedModule(loaded, 'lib/hooks/pre-tool-use.js'));
  assert.ok(loadedModule(loaded, 'lib/hooks/context.js'));
});

test('e2e #2783: an ordinary failed Bash call never loads post-tool-use-failure.js; a harness refusal does', () => {
  const plain = spawnHook('post-tool-use-failure', { ...bash('git status'), error: 'Command failed with exit code 1', cwd: SANDBOX });
  assert.strictEqual(plain.stdout, '');
  assert.ok(!loadedModule(plain.loaded, 'lib/hooks/context.js'), 'context.js loaded on the skip path');
  assert.ok(!loadedModule(plain.loaded, 'lib/hooks/post-tool-use-failure.js'), 'event module loaded on the skip path');
  const refused = spawnHook('post-tool-use-failure', { ...bash('echo hi'), error: REFUSAL, cwd: SANDBOX });
  assert.strictEqual(refused.stdout, '');
  assert.ok(loadedModule(refused.loaded, 'lib/hooks/post-tool-use-failure.js'), 'a refusal must reach the full handler');
});

test('e2e: malformed stdin still reaches the full handler and exits 0', () => {
  const { loaded } = spawnHook('pre-tool-use', 'not json');
  assert.ok(loadedModule(loaded, 'lib/hooks/pre-tool-use.js'));
});

test('e2e: a non-Bash tool is never skipped', () => {
  const { loaded } = spawnHook('post-tool-use', { tool_name: 'Skill', tool_input: { skill: 'x' }, cwd: SANDBOX });
  assert.ok(loadedModule(loaded, 'lib/hooks/post-tool-use.js'));
});

// The handler substitutes same-command literal assignments into the program word
// (git-command.js substituteVars), so `G=git; $G commit` resolves to a commit
// target. The prefilter must see the assigned value, or the deny is dropped.
test('e2e: $VAR program indirection reaches the worktree-always deny, same as the literal spelling', () => {
  const project = gitRepo();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  for (const command of ['git commit -m x', 'G=git; $G commit -m x']) {
    const { stdout } = spawnHook('pre-tool-use', { ...bash(command), cwd: project }, { cwd: project });
    assert.match(stdout, /"permissionDecision":"deny"/, command);
  }
});

// substituteVars also rewrites a token that merely CONTAINS a reference
// (prefix + value + suffix), so `${G}t` is the program `git` to the handler even
// though no single word of the command spells it.
test('e2e: a CONCATENATED program name reaches the worktree-always deny too', () => {
  const project = gitRepo();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const command = 'G=gi; ${G}t commit -m x';
  const { stdout } = spawnHook('pre-tool-use', { ...bash(command), cwd: project }, { cwd: project });
  assert.match(stdout, /"permissionDecision":"deny"/, command);
});

// checkGitStashWarn (#1967) had no `Bash(git stash *)` predicate, so a plain
// `git stash` never spawned the hook and the warning was unreachable for its
// most common spelling (the #70 matcher/parser asymmetry). The prefilter's
// `git` word makes it reachable.
test('e2e: a plain `git stash` from a linked worktree now reaches checkGitStashWarn', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const { stdout } = spawnHook('pre-tool-use', { ...bash('git stash'), cwd: wt }, { cwd: wt });
  assert.match(stdout, /git stash is repository-wide/);
});

// ── #4028: the guard normalizer on the skip path ─────────────────────────────
// A skip-path Bash call whose shape the harness worktree guard over-refuses gets
// a semantics-preserving rewrite as `updatedInput`, and never a
// permissionDecision, since the guard must re-check the rewritten command.
test('earlyGate returns json with updatedInput for a rewritable skip-path Bash call and no json otherwise', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const tool_input = { command: `node -e '1' "$HOME"`, description: 'probe' };
  const raw = JSON.stringify({ tool_name: 'Bash', tool_input, cwd: wt });
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => raw), {
    raw, skip: true,
    json: { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { command: `node -e '1' -- "$HOME"`, description: 'probe' } } },
  });
  const plain = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: wt });
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => plain), { raw: plain, skip: true }, 'nothing to rewrite');
  const outside = JSON.stringify({ tool_name: 'Bash', tool_input, cwd: SANDBOX });
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => outside), { raw: outside, skip: true }, 'not a linked worktree');
  const noCwd = JSON.stringify({ tool_name: 'Bash', tool_input });
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => noCwd), { raw: noCwd, skip: true }, 'no cwd in the payload');
  assert.deepStrictEqual(earlyGate('post-tool-use', () => raw), { raw, skip: true }, 'post-tool-use never rewrites');
  const full = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git status; node -e '1' "$HOME"` }, cwd: wt });
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => full), { raw: full, skip: false }, 'the full handler owns a non-skip call');
});

test('earlyGate keeps skip true and returns no json when rewriteForGuard throws', () => {
  const raw = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `node -e '1' "$HOME"` }, cwd: SANDBOX });
  const boom = () => { throw new Error('boom'); };
  assert.deepStrictEqual(earlyGate('pre-tool-use', () => raw, { rewriteForGuard: boom }), { raw, skip: true });
  // The seam is the one earlyGate really calls.
  const stub = earlyGate('pre-tool-use', () => raw, { rewriteForGuard: () => ({ command: 'X', applied: ['t'] }) });
  assert.strictEqual(stub.json.hookSpecificOutput.updatedInput.command, 'X');
});

test('e2e #4028: a rewritable skip-path call prints updatedInput and still never loads the heavy modules', () => {
  const wt = linkedWorktreeOf(gitRepo());
  const { stdout, loaded } = spawnHook('pre-tool-use', { ...bash(`node -e '1' "$HOME"`), cwd: wt }, { cwd: wt });
  assert.deepStrictEqual(JSON.parse(stdout), { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { command: `node -e '1' -- "$HOME"` } } });
  assert.ok(!loadedModule(loaded, 'lib/hooks/context.js'), 'context.js loaded on the skip path');
  assert.ok(!loadedModule(loaded, 'lib/hooks/pre-tool-use.js'), 'pre-tool-use.js loaded on the skip path');
});

// Review Focus 5: a throw inside the normalizer, in the real process, on both the
// fast path and the full handler, still exits 0 with no stdout.
test('e2e #4028: a throwing normalizer exits 0 with no stdout on the skip path and the full path', () => {
  const thrower = path.join(SANDBOX, 'throw-rewrite.js');
  const target = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'guard-rewrite.js');
  fs.writeFileSync(thrower, `require(${JSON.stringify(target)}).rewriteForGuard = () => { throw new Error('boom'); };\n`);
  const wt = linkedWorktreeOf(gitRepo());
  for (const command of [`node -e '1' "$HOME"`, 'P=/x/y; node $P/z.js']) {
    const stdout = execFileSync('node', ['--require', thrower, HOOKS, 'pre-tool-use'], {
      input: JSON.stringify({ ...bash(command), cwd: wt }), cwd: wt, encoding: 'utf8',
      env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
    });
    assert.strictEqual(stdout, '', command);
  }
});
