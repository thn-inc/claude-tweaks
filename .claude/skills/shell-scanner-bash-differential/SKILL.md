---
name: shell-scanner-bash-differential
description: Use when changing or reviewing the write gate's shell scanner in `plugin/bin/lib/hooks/git-command.js` (heredoc stripping, quoting and nesting spans, the segment and cwd walk, `fileWriteTargets`/`gitTargets`/`mkdirTargets`) or the prefilter that shares it — judge each case against real bash 3.2 and 5, check base for regressions, fuzz differentially, time adversarial shapes through the real hook, and prove every rule with a mutant. Keywords - shell scanner, heredoc, stripHeredocBodies, forEachShellSegment, bash 3.2, bash 5, differential, fuzz, mutant, fail closed, spurious deny, leak, step budget, cwd cap, routine table.
---

# Shell scanner: judge it against real bash

## Overview

`git-command.js` decides what a Bash command writes, and where, without running it. It is a hand-written model of bash. A gap in that model is a leak: the gate allows a write into the main checkout. #4149 spent six review rounds on this module, and each round found a new divergence. Reasoning about bash by hand converges slowly. What converged was checking each case against a real shell and proving each rule mechanically. The rules below are that method.

## Key Patterns

### Real bash is the oracle, in both versions

Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here). Use a scratch directory, a logging `git` stub in a stub dir that is the whole `PATH`, and real `cp`/`mkdir`/redirect targets, then record what each shell actually wrote and where. Write the verdict into the test comment, the way `tests/hooks-gate-coverage.test.js` does ("bash 3.2 and 5 write /main/f.js for each"). When the versions disagree, note it ("bash 3.2 cannot parse the odd-quote heredoc one") and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual.

An option-parsing rule (which word `-t` or a long option takes as its value: `LONG_VALUE_OPTIONS`, `explicitTargetDir`) is judged by GNU coreutils, not by bash. macOS's own `cp` and `install` are BSD and reject every long option, so link Homebrew's GNU build into `stubDir` under the bare name (`fs.symlinkSync('/opt/homebrew/bin/gcp', stubDir + '/cp')`, `ginstall` for `install`). Run each shape before writing its row, a shape a record hands you included: GNU validates some values, so `cp --no-preserve -t a M/f.js`, `cp --sparse -t …` and `install --group -t …` exit 1 (`invalid argument`, `invalid group`) and write nothing. Give such a row a value the tool accepts (`install --gro staff -d M/x`), or say in its comment that it pins a reading, not a write (#4483).

### Bias every unknown toward a visible body or a reported target

The gate's tradeoff is that a spurious deny is acceptable and a leak is not. A shape the scanner cannot place keeps its heredoc body visible, or resolves a relative target in the overflow cwd (`walkOptions` in `pre-tool-use.js` passes the main checkout). That is how the reader allowlist works: a non-reader on the opener line keeps the body, and `while read l; do …; done <<EOF` keeps it by design. Pin each fail-closed tradeoff as deliberate, so a later "fix" cannot quietly reopen it (`#4149: a shell loop on the opener line keeps its body (deliberate fail-closed tradeoff)`).

### Compare against base before calling a change a fix

Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base and at earlier revisions of the branch, in a scratch `git worktree add --detach`. Diff the targets. Anything that moves from denied to allowed needs its own bash verdict. The common shapes that must keep stripping live in the `#4149 routine` table in `tests/hooks-gate-coverage.test.js`. Add a shape there whenever a rule touches its neighbourhood.

When the change threads a `pathImpl` through the resolvers, run that base comparison with `path.win32` injected on both sides too. HEAD under `path.win32` against HEAD under POSIX shows only where the platforms differ, not what the change moved: #4281's cross-drive drive-root regression passed that check, and the final review caught it.

### Fuzz differentially, then turn each divergence into a case

Hand-picked cases find the bugs you already imagined. Generate commands from a small alphabet of the constructs the scanner models (quotes, `$( )`, backticks, `${ }`, `$(( ))`, groups, `&`, `|`, `&&`, `cd`, heredoc openers, redirects), run each one under both shells, and compare with the scanner's targets. A shell that writes where the scanner reports nothing is a leak: fix it and pin it. A target bash never wrote is a spurious deny: accept it only when it is the fail-closed side of a stated tradeoff.

### Time adversarial shapes through the real hook, and keep wall clock out of tests/

The scanner runs on every Bash call, so a super-linear shape stalls the session. Time repeated nests, unterminated `"$(` chains and many distinct `cd`s through `hooks.js pre-tool-use` itself, not just the function. #4149 found 12 s at 120 KB and 24 to 49 s at 40 KB that way. Bound them with a cap (`NEST_LEVEL_CAP`, the per-pass step budget, the 16-entry cwd cap), and pin each cap in `tests/` with a timing-free case (a budget-spending line that must leave the next body kept). Wall-clock budgets go in `perf/heredoc-scan-linearity.test.js`. A `ms < 750` assertion in `tests/` failed `npm test` under load.

### Every rule earns a mutant that turns a test red

In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it). #4149 dropped six rules this way (`5f8729589`, `9ba9e4d4a`). Mutate the checks downstream of a rule too: a rule that is only reachable through another rule's branch can look pinned when it is not.

Run the mutant rather than predicting which rows it turns red. A rule the scanner reads in two places reaches the rows through both: #4483's plan said full-name `install --group`/`--owner` rows could not catch a dropped `LONG_VALUE_OPTIONS` entry, because `INSTALL_VALUE_FLAGS` also lists those names for `partitionArgs`, but `explicitTargetDir` reads them through `takesLongValue` alone and the rows went red. A pin tagged with a record gets the same check against the release before that record: load that release's `git-command.js` from a scratch worktree, and if the pin passes there too, it pins nothing the record changed. Give it an input that fails there, or retitle it as a pre-existing pin. #4483 replaced a #4303 `$[ … ]` test that returned the same targets at v6.156.2.

### A change to what a word means re-opens every rule keyed on its spelling

When the tokenizer's word changes meaning (#4281 turned it from typed text into the bash value, quotes and escapes removed), every rule that compares a word's spelling gains spellings bash reads differently: the `cd` lead in `visitSegment`, `REDIRECTION_TOKEN_RE` in `dropRedirections`, assignment detection (`isAssignmentWord`). `\cd sub > f`, `tee 2\> f` and a backslash-newline before `A=x>f` each leaked that way, past the differential fuzz and the whole-branch review, until real bash ran them at base and HEAD. List every spelling-keyed rule in the same change, pin each with an escaped and a quoted spelling, and add escapes inside operators (`2\>`), keywords (`\cd`, `c\d`) and before assignments to the fuzz alphabet. A normalization added to the parsers (the backslash-newline join) gets the same reading in `bash-prefilter.js`'s `shouldRunFull` in that change, with bash's parity rule: a backslash-newline joins only after an odd run of backslashes.

### A change to what an operator means re-opens every place the splitter cuts at it

The same holds for a separator. #4303 gave `|` subshell semantics (a pipeline element's `cd` is undone), but the splitter already cut at the `|` between case patterns, which base read like `;` and which did no harm. Under the new meaning that cut undid the case arm's `cd`, so `case x in a|x) cd M;; esac; echo x > f` became a fail-open that origin/main did not have. Eight fix rounds missed it, and review found it. When a change gives `|`, `&&`/`||` or `&` new cwd semantics, list every context in which the splitter cuts at that character and the old meaning was harmless: case patterns and a leading-paren `(a|b)`, `[[ … || … ]]`, arithmetic, `|&`, and a `|` inside a backtick or `${x//a|b/c}`. Pin each against bash 3.2 and 5 in the same change, and add those contexts to the fuzz alphabet.

### A fix that consumers must interpret is a design decision

When a scanner fix needs a new marker or state that more than one consumer of `fileWriteTargets`/`gitTargets`/`mkdirTargets` must interpret, stop and ask for a design decision before building the consumers, with base parity (re-walk the command as base did) as the default option. #4303's cwd-cap fix grew a lost-cwd marker that four consumers read (the worktree gate, the shadow guard, teardown, post-tool-use). Fix rounds 5 and 6 each closed one leak and opened another, round 6 at over 10x base, until the user chose base parity before round 7.

### A compound in a list position re-opens every separator in its body

#4481 made a `case … esac` that sits in a pipeline or an and-or list follow #4303's pipeline rules. Each of its six fix rounds found a new leak where a separator or word inside the case met the list outside it: a nested case, a case after `||`, a leading-paren arm, a redirect on the compound, the `esac` keyword, and an arm's inner `;` that dropped the outer list's `||`/`&&`-skipped branch. The whole-branch review then found one more: a lone `&` before an arm's first separator wipes that skipped state and the pipeline's start. The state the walk keeps for the enclosing list (the skipped cwds, the pipeline's start, the point a `&` returns to) belongs to the compound's own frame, with one record per nesting level, and no separator inside the body may reset it. When a change lets a compound (`case`, a `{ }` group, a subshell) take part in a pipeline or an and-or list, list everything that can appear in its body: `;;`, `;`, a newline, `&`, `|`, `&&`/`||`, a nested compound, and a redirect after its closer. Pin each one with the compound as the first element, as a later element, and after `||`/`&&`, in the same change. Add `case`/`esac`, `;;`, paren patterns and nested compounds to the fuzz alphabet.

## Decision Framework

| Situation | Do |
|---|---|
| A new shape the scanner misreads | Get a bash 3.2 and 5 verdict, write the case, then fix |
| Bash versions disagree | Side with the version that writes; note the split in the comment |
| The fix widens what strips or allows | Run the base comparison and the routine table before anything else |
| A mutant survives every suite | Add a discriminating case, or delete the rule as dead |
| A shape is slow through the hook | Cap it, pin the cap timing-free in tests/, time it in perf/ |
| Each round keeps finding a new divergence class | Stop modelling more bash; recognise a fixed set of shapes and keep every other body visible |
| A change gives `\|`, `&&`/`\|\|` or `&` new cwd meaning | List every context where the splitter cuts at it (case patterns, `[[ ]]`, arithmetic, `\|&`, `${x//a\|b/c}`); pin each against bash |
| A fix needs a marker more than one consumer must read | Stop; ask for the design, with base parity as the default |
| A compound (`case`, group, subshell) can now sit in a pipeline or and-or list | Pin every body separator, nesting and closer redirect at first element, later element and after `\|\|`/`&&` |

## Project Conventions

- A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` (`docs/hooks.md`, #3092). The prefilter and the five guard parsers must agree on every command in it.
- The fail-closed cases are stated once, in `plugin/skills/_shared/policy-schema-coverage.md`'s coverage block. Its reader lists are pinned to `DATA_READER_WORDS`, `READER_WRAPPER_WORDS`, `GIT_DATA_SUBCOMMANDS` and `INERT_NEIGHBOUR_WORDS`, so changing a list means editing the prose in the same change.
- Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N). Test comments state what bash and the scanner do now, citing the record that set it: no `Fix round 1 (#3989):` or `#4481 round 2:` lead and no "an earlier revision of this branch", since the squash merge erases the history they narrate (#4483 rewrote about 25). A comparison with a released version (`before #4210 it did`) is fine.
- Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32.
- A marker the scanner plants in a word value (`STRAY`, a NUL, in `settleStrayBackslash`) needs every typed copy stripped from the input before the walk, or a typed one reads as the marker. `forEachShellSegment` and `shouldRunFull` both drop every NUL first, as bash does with one it reads (#4281).

## Common Operations

This session's Bash guard refuses heredocs, `cd` chains and any argument containing a `git` token. Write the drivers as scratchpad node scripts and run them with `node <script>`:
- bash verdict: `runBash(bash, cmd, { cwd, stubDir, root, guardRepo })` from the Bounded bash verdict block below, then read the stub's log and the files it wrote. Repeat with `/opt/homebrew/bin/bash`.
- base comparison: `git worktree add --detach <scratch> <base>`, then `require(<scratch>/plugin/bin/lib/hooks/git-command.js)` beside the branch copy and diff `fileWriteTargets(cmd, cwd)`.
- mutant: edit a copy in a scratch worktree and run `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` there.

### Bounded bash verdict

Every real-bash run goes through this driver, copied from the version that passed its checks (bash 3.2 and 5; dd, cat, backgrounded dd, endless loop, unstubbed word, SIGTERM and SIGKILL of the driver; `cd -`, a bare `cd`, `~`, an inherited CDPATH and BASH_ENV, a cwd outside the tree and a write into the guarded checkout). It does five things:

- **Cap:** each file a child writes is capped at 4 MiB (`ulimit -f`, soft and hard, so a child cannot raise it; bash counts 1024-byte blocks).
- **Process group, timeout, kills:** bash runs as its own process group with a 5 s timeout. The whole group is killed on timeout, 300 ms after bash exits (so a backgrounded writer has opened its target), and on driver SIGTERM/SIGINT/SIGHUP.
- **Stdin and output:** stdin is closed, and at most 64 KiB of each stream is kept.
- **PATH:** PATH is the stub dir alone, so a word with no stub fails as `command not found`. Link into `stubDir` only the real tools a case checks: `cp`, `mv`, `mkdir`, `touch`, `tee`, `ln`, and `dd`/`cat`/`install` only when the case is about them (`fs.symlinkSync('/bin/dd', stubDir + '/dd')`). Redirects need no program. A stub must not need PATH itself: give it an absolute shebang (`#!/bin/sh`) and use builtins only, since `#!/usr/bin/env node` or a call to `date` fails under the stub-only PATH.
- **Environment and escape check:** a spawn's `cwd` does not keep a case in its scratch tree. bash 5's `cd -` reads an imported OLDPWD (3.2 ignores it), a bare `cd` and `~` read HOME, `cd sub` searches CDPATH, BASH_ENV runs a file before the command, and git finds a repo by climbing from the cwd. So the child gets no inherited environment: only PATH, OLDPWD and PWD pinned to `cwd`, HOME pinned to `root` (the scratch tree, which must contain `cwd`), and GIT_CEILING_DIRECTORIES set to `root`'s parent. When `guardRepo` names the real checkout, its HEAD and `git status --porcelain` are read before and after each run, and any change rejects the run. After a fuzz run, check `git log <fix-base>..HEAD` for foreign authors too.

The cap bounds disk, not CPU: `while :; do :; done` stops only at the timeout. SIGKILL cannot be handled, so after a SIGKILLed driver the cap is the backstop: an orphaned writer dies by SIGXFSZ at 4 MiB.

```js
'use strict';
// Bounded real-bash verdict runner for the shell-scanner differential recipe.
// runBash(bash, cmd, { cwd, stubDir, root, guardRepo }) -> Promise<{ status, signal, timedOut, stdout, stderr }>

const { spawn, execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const CAP_KB = 4096; // `ulimit -f` counts 1024-byte blocks: 4 MiB per file, per child
const TIMEOUT_MS = 5000; // wall clock per shape
const GRACE_MS = 300; // after bash exits, let a backgrounded writer open its target before the group kill
const KEEP_BYTES = 64 * 1024; // retained output per stream

const live = new Map(); // pgid -> true, every process group not yet killed

function killGroup(pgid) {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (e) {
    if (e.code !== 'ESRCH') throw e;
  }
}

function killAll() {
  for (const pgid of live.keys()) killGroup(pgid);
  live.clear();
}

process.on('exit', killAll);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    killAll();
    process.exit(128 + os.constants.signals[sig]);
  });
}

// The real checkout's HEAD and status: a case that left its scratch tree shows up as a change.
function repoState(repo) {
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return git(['rev-parse', 'HEAD']) + git(['status', '--porcelain', '--untracked-files=all']);
}

function runBash(bash, cmd, { cwd, stubDir, root, guardRepo }) {
  return new Promise((resolve, reject) => {
    if (!root || (cwd !== root && !cwd.startsWith(root + path.sep))) {
      reject(new Error(`runBash: cwd ${cwd} is outside the scratch tree ${root}`));
      return;
    }
    const before = guardRepo ? repoState(guardRepo) : null;
    const child = spawn(bash, ['-c', 'ulimit -f ' + CAP_KB + ' || exit 125\n' + cmd], {
      cwd,
      // Nothing inherited: an imported OLDPWD, HOME, CDPATH or BASH_ENV sends a case outside its tree.
      env: { PATH: stubDir, OLDPWD: cwd, PWD: cwd, HOME: root, GIT_CEILING_DIRECTORIES: path.dirname(root) },
      detached: true, // own session and process group: pgid === child.pid
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pgid = child.pid; // undefined when spawn itself failed (missing bash, bad cwd)
    if (pgid !== undefined) live.set(pgid, true);

    const streams = { out: [], err: [], outBytes: 0, errBytes: 0 };
    const collect = (chunk, list, key) => {
      if (streams[key] >= KEEP_BYTES) return;
      const part = chunk.subarray(0, KEEP_BYTES - streams[key]);
      list.push(part);
      streams[key] += part.length;
    };
    child.stdout.on('data', (c) => collect(c, streams.out, 'outBytes'));
    child.stderr.on('data', (c) => collect(c, streams.err, 'errBytes'));

    let settled = false;
    let timedOut = false;
    let graceTimer = null;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      killGroup(pgid);
      live.delete(pgid);
      if (guardRepo && repoState(guardRepo) !== before) {
        reject(new Error(`ESCAPE: ${guardRepo} changed during ${bash} -c ${JSON.stringify(cmd).slice(0, 300)}`));
        return;
      }
      resolve({
        status,
        signal,
        timedOut,
        stdout: Buffer.concat(streams.out).toString(),
        stderr: Buffer.concat(streams.err).toString(),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      finish(null, 'SIGKILL');
    }, TIMEOUT_MS);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pgid !== undefined) {
        killGroup(pgid);
        live.delete(pgid);
      }
      reject(e);
    });
    child.on('exit', (status, signal) => {
      graceTimer = setTimeout(() => finish(status, signal), GRACE_MS);
    });
  });
}
```

Leftover check, after a session and after any driver run that was killed: `ps -ax -o pid=,ppid=,etime=,command= | awk '$2 == 1 && $4 ~ /(^|\/)g?(dd|cat)$/'` lists PPID-1 writers. `ps` shows the bare word (`dd if=/dev/zero …`) as argv[0], not the stub path, so match the command word. For each pid, `lsof -p <pid>` shows its open output file; if that sits under a `scratchpad/` or `agent-scratch/` path, `kill -9 <pid>`. `lsof +D <scratch dir>` lists every process whose cwd or open file is under that dir, which finds a case's bash and its children, since they inherit the cwd. Freed space can stay pinned by a Time Machine local snapshot: check `tmutil listlocalsnapshots /`.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Writing the expected target from what bash "should" do | Six #4149 rounds found divergences reasoning had missed: `$((cmd) )` is a substitution, a lone `&` inside `$( )` resets the sub run, and a substitution after `<<` runs with the body on stdin |
| Accepting a fix whose tests all pass without a base comparison | A new strip rule can let a write through that base denied, and no case pins the old denial |
| Keeping a rule because it reads as necessary | #4149 found six rules whose mutants no test killed; three were dead and three were equivalent to other code |
| Timing a shape by calling the function only | The hook adds the prefilter and three walks per call (worktree-required, E1, teardown); time `hooks.js pre-tool-use` |
| Asserting wall clock in tests/ | It flakes under sibling-suite load; the timing-free cap pin goes in tests/, the clock in perf/ |
| Re-checking main only at setup on a long scanner run | #4015 landed mid-run on the same functions and needed a semantic merge at review |
| Fuzzing only the shapes the change targets | #4281's fuzz missed three escaped-spelling leaks (`\cd`, `2\>`, an escaped newline before an assignment) in rules the change never edited but whose input it redefined |
| Running a shape under real bash with `spawnSync`, no cap and the real PATH after the stubs | 2026-10-26: three orphaned `dd if=/dev/zero` writers from #4303's oracle tree wrote ~463 GB into deleted files over 7 h, and 30 orphaned `cat a f1` loops from #4281's fuzz scratch were still writing 17 h after that run was archived; `spawnSync` with no timeout kills nobody, and with one it kills only bash. |
| Spawning the oracle with `{ ...process.env }` and only PATH replaced | #4303 round 5: fuzz seed 99's `(cd - && git commit -qm "work on #12")` ran under bash 5 in the session's worktree, which the imported OLDPWD named, and put four empty commits on the live branch |
| Judging a case only under bash 3.2 and 5 | The session's Bash tool runs the user's shell, which is zsh on this host. #4481: zsh runs a pipeline's last element in the current shell, so `true \| cd ../main; echo x > f.js` writes main/f.js while the scanner's bash model reports ./f.js. Run zsh as a third oracle, as #4481's test comments do, and add each zsh-only divergence to the known gaps in `policy-schema-coverage.md`. Whether the scanner should follow zsh is still an open decision (#4455), so do not quietly side with zsh in the expected target |

## Reference

- `plugin/bin/lib/hooks/git-command.js` — the scanner (`stripHeredocBodies`, `scanPass`, `topLevelSpans`, `forEachShellSegment`, `fileWriteTargets`)
- `plugin/bin/lib/hooks/pre-tool-use.js` — `walkOptions`, the overflow cwd
- `tests/hooks-gate-coverage.test.js` — write-target cases, the `#4149 routine` table, the prose pins
- `perf/heredoc-scan-linearity.test.js` — linearity budgets
- `docs/hooks.md` — the Bash prefilter section
