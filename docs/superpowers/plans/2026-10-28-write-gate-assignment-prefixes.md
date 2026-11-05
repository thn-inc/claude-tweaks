# Write-gate command-prefix lead (#4448) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The write gate's shell scanner reads the command word bash and the `env`/`sudo` wrappers actually run, so a write or commit behind a `NAME=value`, `NAME+=value`, `env` or `sudo` prefix resolves the path bash writes.

**Architecture:** One shared lead reader in `plugin/bin/lib/hooks/git-command.js` skips the bash prefix (assignment words, read by the existing span-aware `assignmentWordEnd`, and redirections, in any order), then the `env` and `sudo` wrappers with their own options and `NAME=value` words. `fileWriteTargets` and the git lead (`findGitLead` → `resolveGitCommand`, used by `gitTargets` and `teardownTargets`) read their command word through it; the `cd` lead reads only the bash prefix half (a wrapper never runs the `cd` builtin).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T200032-record-4448/work/4448-spec.md` (record #4448)

Scope keywords: findGitLead, resolveGitCommand, assignmentWordEnd, dropRedirections, SIMPLE_ASSIGNMENT_RE

## Global Constraints

- Every expected target comes from a real-shell verdict, never from the scanner's own output. Governing skill `shell-scanner-bash-differential` (`.claude/skills/shell-scanner-bash-differential/SKILL.md`), quoted verbatim:
  - "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here)." … "Write the verdict into the test comment, the way `tests/hooks-gate-coverage.test.js` does (\"bash 3.2 and 5 write /main/f.js for each\"). When the versions disagree, note it … and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "The gate's tradeoff is that a spurious deny is acceptable and a leak is not."
  - "Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base and at earlier revisions of the branch, in a scratch `git worktree add --detach`. Diff the targets. Anything that moves from denied to allowed needs its own bash verdict."
  - "In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it)."
  - "When the tokenizer's word changes meaning … every rule that compares a word's spelling gains spellings bash reads differently … pin each with an escaped and a quoted spelling."
  - "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)."
  - "Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32."
  - "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js`."
  - "Judging a case only under bash 3.2 and 5 … Run zsh as a third oracle … do not quietly side with zsh in the expected target."
- Real-shell oracle: run shapes only through the bounded driver already in the session scratchpad, `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6632f468-fb30-4491-bfde-ec591460a9c3/scratchpad/oracle/verdicts.js` (`node verdicts.js "<worktree>" [cases.json]`, cases are `[["wt"|"main", "cmd with M and W for the main/worktree dirs"], …]`; it runs bash 3.2, bash 5 and zsh with a stub-only PATH and prints what each wrote and where `git` ran). Never `spawnSync` a shape with the real PATH.
- The four scanner suites: `tests/hooks-gate-coverage.test.js`, `tests/hooks-git-command.test.js`, `tests/hooks-bash-prefilter.test.js`, `tests/teardown-gate.test.js`.
- Out of scope (#4244): compound keywords and the `builtin`/`command`/`pushd` prefixes; also not here: `mkdirTargets`, `powershellOpaqueCommand` and the heredoc reader allowlist (`checkReaderCommand`), which keep their own lead reading.
- Already satisfied at base (no task): AC2's `"x"=1 cd …` shape (#4281's `isAssignmentWord` bare-name check; `fileWriteTargets('"x"=1 cd /wt; cp a f.js', '/main')` returns `/main/f.js` today) and the `while ((next = …) > cdLead)` loop, already a plain `for (;;)` loop at `git-command.js:830`. Task 1 adds the AC2.1 pin.

Real-shell verdicts already taken (bash 3.2, bash 5 and zsh agree on every row; started in `wt`, `M` = the main checkout):

| Shape | Writes / git runs in |
|---|---|
| `X=1 cp a M/f.js`, `X=1 tee M/f.js`, `x+=1 tee M/f.js`, `X=1 sed -i.bak s/a/b/ M/f.js`, `X=1 truncate -s0 M/f.js`, `a=( 1 2 ) cp a M/f.js`, `X=1 Y=2 ln -s a M/l` | M |
| `x=$(echo >g) cp a M/f.js`, `X=1 >g cp a M/f.js`, `>g X=1 cp a M/f.js` | M/f.js and wt/g |
| `env cp a M/f.js`, `env -i X=1 cp …`, `env -u X cp …`, `env -uX cp …`, `env - cp …`, `env -- cp …`, `env a.b=1 cp …`, `env "x"=1 cp …`, `env --unset=X cp …`, `X=1 env Y=2 tee M/f.js` | M/f.js |
| `env -C M cp a f.js`, `env --chdir=M cp a f.js`, `env -iC M cp a f.js`, `env --ch M cp a f.js` (GNU env) | M/f.js |
| `cd M; x+=1 git commit -m x`, `x+=1 git -C M commit -m x`, `env X=1 git -C M commit -m x` | git commit in M |
| `>g git -C M commit -m x`, `X=1 >g git -C M commit -m x` | git commit in M, and wt/g |
| `>g cd M; cp a f.js`, `X=1 cd M; cp a f.js` | M/f.js |
| `"x"=1 git -C M commit -m x`, `"x"=1 cp a M/f.js`, `x\=1 cp a M/f.js` | nothing (exit 127, `x=1: command not found`) |
| `x=$(cd M) cp a f.js` | wt/f.js |
| from main: `"x"=1 cd W; cp a f.js` → main/f.js; `x+=1 cd W; cp a f.js` → wt/f.js | |

`sudo` cannot run in the oracle; its argv contract is sudo(8)'s: options (value-taking short letters `a C c D g h p R r T t U u`; `-D`/`--chdir` sets the command's cwd; `-R`/`--chroot` and `-e`/`--edit` mean the words after the options are not a command run from a known cwd), then `VAR=value` words, then the command. Test comments for sudo rows cite sudo(8), not a shell verdict.

## Review Focus

1. A `NAME=value` word whose value holds spaces inside `$( )` / backticks (`x=$(echo a b) cp a M/f.js`) — bash reads one word; the lead must land on `cp`, not inside the substitution. Pinned in Task 1.
2. A quoted or escaped assignment name (`"x"=1 cp …`, `x\=1 git -C M commit …`) — bash runs `x=1` as the command, so no target; a reader keyed on the post-quote-removal spelling would invent one. Pinned in Tasks 1 and 2.
3. `env -S`/`--split-string`/`-P` and `sudo -e`/`-R` — the program or its cwd is not statically knowable; these must resolve no shape target (base parity), never a fabricated one. Pinned in Task 1.
4. A redirection before the command word (`>g X=1 cp …`, `>g git -C M commit …`, `>g cd M; …`) — redirect targets still resolve in the shell's own cwd, and the command word after them is still read. Pinned in Tasks 1 and 2.
5. `env -C <unresolvable>` (`env -C $X cp a f.js`) — a relative target becomes unprovable (no target), while an absolute one (`env -C $X cp a /main/f.js`) still resolves. Pinned in Task 1.

---

### Task 1: Shared command-lead reader for write shapes and the `cd` lead

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`dropRedirections` ~3111, `visitSegment` ~811-852, `fileWriteTargets` ~3127-3256; new helpers beside `assignmentWordEnd` ~782)
- Test: `tests/hooks-gate-coverage.test.js` (new block after the `#4303` assignment-word tests, ~1550)

**Interfaces:**
- Produces (module-internal, not exported unless a test needs it):
  - `redirectionWidth(raw: string, kinds: string, leadQuoted: boolean) -> 0|1|2` — 0: not a redirection/heredoc token; 1: a glued one (`>f`, `<<EOF`); 2: a lone operator that takes the next word (`>`, `<<`, `<<-`, `<<<`). Exactly the per-token logic `dropRedirections` has today; `dropRedirections` is rewritten to use it, behavior unchanged.
  - `commandPrefixEnd(rawT: string[], spanKinds: string[], leadQuoted: boolean[], i = 0) -> number` — index past every leading assignment word (`assignmentWordEnd`) and redirection (`redirectionWidth`), in any order.
  - `findCommandLead(t: string[], quoting, dir) -> { index: number, dir, unprovable: boolean }` — `commandPrefixEnd`, then while `t[i]` is exactly `env` or `sudo`, skip the wrapper (below). `index` is -1 when there is no command word or a wrapper option makes the program or its cwd unknowable (env `-S`/`--split-string`/`-P`; sudo `-e`/`--edit`, `-R`/`--chroot`). `dir` starts at the caller's cwd and moves for env `-C`/`--chdir` and sudo `-D`/`--chdir` through `resolveCd`; `unprovable` is true when that value does not resolve. `quoting` is the walk's `{ raw, spanKinds, leadQuoted, pathImpl }`.
  - Wrapper reading (one helper per the implementer's choice): after the wrapper word, skip redirections; a short-option cluster is read with `readShortCluster` (env value letters `CuSPLU`, sudo `aCcDghpRrTtUu`); `-` alone (env) is `-i`; `--` ends options; long options match by unique prefix (getopt) against the wrapper's full long-option list — GNU env: `chdir`(value, cwd), `unset`(value), `split-string`(value, opaque), `ignore-environment`, `null`, `debug`, `block-signal`, `default-signal`, `ignore-signal`, `list-signal-handling`, `help`, `version` (the `*-signal` ones take a value only with `=`); sudo: `auth-type`, `close-from`, `chdir`(cwd), `group`, `host`, `login-class`, `prompt`, `chroot`(opaque), `role`, `type`, `command-timeout`, `other-user`, `user` (value-taking), and `askpass`, `background`, `bell`, `preserve-env` (value only with `=`), `edit`(opaque), `set-home`, `help`, `login`, `remove-timestamp`, `reset-timestamp`, `list`, `non-interactive`, `preserve-groups`, `stdin`, `shell`, `version`, `validate`. An unknown or ambiguous long option skips one word. Then every word (post-expansion `t[i]`) containing `=` is the wrapper's assignment and is skipped.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-gate-coverage.test.js`, each comment carrying its verdict from the Global Constraints table (`MAIN_F`, `path.resolve`):
  - `AC1.1 #4448: a write shape behind a NAME=value or NAME+=value prefix resolves the main-checkout write` — for each of `X=1 cp a /main/f.js`, `X=1 tee /main/f.js`, `x+=1 tee /main/f.js`, `X=1 sed -i s/a/b/ /main/f.js`, `X=1 truncate -s0 /main/f.js`, `a=( 1 2 ) cp a /main/f.js`, `x=$(echo a b) cp a /main/f.js` from `/r`: `fileWriteTargets(cmd, '/r').map((t) => t.file)` includes `MAIN_F`; and `X=1 Y=2 ln -s a /main/l` includes `path.resolve('/main/l')`.
  - `AC1.1 #4448: a write shape behind an env or sudo prefix resolves the main-checkout write` — `env cp a /main/f.js`, `env -i X=1 cp …`, `env -u X cp …`, `env -uX cp …`, `env - cp …`, `env -- cp …`, `env a.b=1 cp …`, `env --unset=X cp …`, `X=1 env Y=2 tee /main/f.js`, `sudo cp a /main/f.js`, `sudo -u bob cp a /main/f.js`, `sudo -E X=1 tee /main/f.js`, `sudo env X=1 cp a /main/f.js`, `env sudo cp a /main/f.js`: each includes `MAIN_F`.
  - `#4448: env -C and sudo -D move the cwd a relative write resolves in` — `env -C /main cp a f.js`, `env --chdir=/main cp a f.js`, `env -iC /main cp a f.js`, `env --ch /main cp a f.js`, `sudo -D /main cp a f.js`, `sudo --chdir=/main cp a f.js` from `/r` each deep-equal `[{ action: 'copy', file: MAIN_F }]`.
  - `#4448: a redirect before or among the prefix words keeps its own cwd, and the command after it is read` — `X=1 >g cp a /main/f.js` and `>g X=1 cp a /main/f.js` from `/r` deep-equal `[{ action: 'write', file: path.resolve('/r/g') }, { action: 'copy', file: MAIN_F }]`; `>g cd /main; cp a f.js` from `/r` includes `MAIN_F`.
  - `#4448: a quoted or escaped assignment name is the command word, so no shape is read` — `"x"=1 cp a /main/f.js` and `x\=1 cp a /main/f.js` from `/r` deep-equal `[]` (bash: exit 127).
  - `#4448: an opaque wrapper option resolves no shape target (base parity)` — `env -S "cp a /main/f.js"`, `env -P /x cp a /main/f.js`, `sudo -e /main/f.js`, `sudo -R /x cp a /main/f.js` each deep-equal `[]`.
  - `#4448: an unresolvable env -C leaves a relative write unprovable and an absolute one known` — `env -C $X cp a f.js` → `[]`; `env -C $X cp a /main/f.js` → `[{ action: 'copy', file: MAIN_F }]`.
  - `AC2.1 #4448: a quoted-name assignment before cd changes no cwd` — `fileWriteTargets('"x"=1 cd /wt; cp a f.js', '/main')` deep-equals `[{ action: 'copy', file: MAIN_F }]` (bash 3.2, 5 and zsh write main/f.js; already true at base, pinned here).

- [ ] **Step 2: Run them to verify the new ones fail**

Run: `node --test --test-name-pattern="#4448" tests/hooks-gate-coverage.test.js`
Expected: FAIL — the NAME=value/env/sudo/-C/redirect-prefix tests report `[]`; the AC2.1, quoted-name and opaque-wrapper tests already pass (base parity pins).

- [ ] **Step 3: Implement** `redirectionWidth`, `commandPrefixEnd`, the wrapper reader and `findCommandLead` per the Interfaces block; rewrite `dropRedirections` over `redirectionWidth`; in `visitSegment` replace the assignment-only `cdLead` loop with `commandPrefixEnd(rawT, spanKinds, leadQuoted)`; in `fileWriteTargets` keep `redirectRawTargets` over the whole token list in `effCwd`, then take `findCommandLead(tokens, quoting, effCwd)`, return on index -1, drop redirections from the slice after the lead (slicing `raw`/`leadQuoted`/`spanKinds` alongside), and resolve the shape's targets in the lead's `dir` (`null` when `unprovable`). Update the comments at `visitSegment` (~819-828) and `findGitLead` (~906-930) that describe the old prefix reading.

- [ ] **Step 4: Run the tests and the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js
git commit -m "Read write shapes behind NAME=value, env and sudo prefixes — refs #4448"
```

### Task 2: Git lead through the shared reader

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`findGitLead` ~931, `resolveGitCommand` ~978, `resolvedGitSegments` ~1030)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`teardownTargets` ~538: pass `quoting`)
- Test: `tests/hooks-gate-coverage.test.js`
- Test: `tests/teardown-gate.test.js`
- Test: `tests/hooks-git-command.test.js`
- No change (Check B hits, reviewed): `docs/hooks.md` (names `resolveGitCommand` only for the lost-cwd marker, unchanged), `docs/plans/2026-10-25-4303-write-gate-fail-opens-ledger.md` and `docs/superpowers/plans/2026-10-25-write-gate-fail-opens-4303.md` (historical #4303 records)

**Interfaces:**
- Consumes: `findCommandLead(t, quoting, dir)` from Task 1.
- Produces: `findGitLead(t, dir, pathImpl = path, quoting = null)` and `resolveGitCommand(t, effCwd, pathImpl = path, quoting = null)`; with `quoting` null (direct callers and existing tests), a quoting built from `t` itself (every character bare, no token lead-quoted) stands in, so `resolveGitCommand(['git', '-C', '', 'commit'], null)` and every existing env shape keep their results. The lead word is `git` or ends in `/git`, as today; `unprovable` from the reader makes the segment resolve null, as today.

- [ ] **Step 1: Write the failing tests**
  - `tests/hooks-gate-coverage.test.js`: `AC1.1 #4448: a git commit behind an appending assignment, sudo or a leading redirect resolves the main checkout` — `gitTargets(cmd, '/r')` has an entry with `dir === MAIN_ROOT` for `cd /main; x+=1 git commit -m x`, `x+=1 git -C /main commit -m x`, `sudo git -C /main commit -m x`, `sudo -u bob git -C /main commit -m x`, `sudo -D /main git commit -m x`, `>g git -C /main commit -m x`, `X=1 >g git -C /main commit -m x`, `env X=1 git -C /main commit -m x`.
  - same file: `#4448: a quoted or escaped assignment name before git runs no git` — `gitTargets('"x"=1 git -C /main commit -m x', '/r')` and `gitTargets('x\\=1 git -C /main commit -m x', '/r')` deep-equal `[]` (bash: exit 127). This moves a base deny to allow; the verdict row is its evidence.
  - `tests/teardown-gate.test.js`: `#4448: teardownTargets reads a git worktree remove behind x+=1 or sudo` — `x+=1 git worktree remove /abs/wt` and `sudo git worktree remove /abs/wt` each yield `[{ path: path.resolve('/abs/wt'), source: 'bash' }]` (follow that file's existing `teardownTargets` call shape).
  - `tests/hooks-git-command.test.js`: `#4448: resolveGitCommand without quoting reads an appending assignment` — `resolveGitCommand(['x+=1', 'git', 'commit'], '/r')` deep-equals `{ index: 2, dir: '/r' }` (native-resolved as that file's neighbours do).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern="#4448" tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js tests/hooks-git-command.test.js`
Expected: FAIL on the `+=`, sudo and leading-redirect rows; the quoted-name row fails too (base resolves `/main`).

- [ ] **Step 3: Implement** `findGitLead` over `findCommandLead` (drop its own `SIMPLE_ASSIGNMENT_RE` and `env` loop), thread `quoting` through `resolveGitCommand`, and pass the handler's `quoting` from `resolvedGitSegments` and `teardownTargets`. Update the `findGitLead` header comment and `pre-tool-use.js`'s comment at ~528-537 to name sudo and the assignment-word reading.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js tests/hooks-git-command.test.js
git commit -m "Read the git lead behind NAME+=value, sudo and leading redirects — refs #4448"
```

### Task 3: End-to-end deny, prefilter corpus, and the coverage prose

**Role:** integration

**Files:**
- Test: `tests/hooks-gate-coverage.test.js` (beside `AC1.1 e2e #4303`, ~2979, reusing `linkedWorktree4303`)
- Test: `tests/hooks-bash-prefilter.test.js` (`DIFFERENTIAL_CORPUS`, ~27-50)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (36,737 B; rail 52,500 B — headroom ~15.7 KB): line ~30's known-gap clause "and a write behind a `NAME=value`, `env` or `sudo` prefix (#4244)" is removed and the reading is stated in that paragraph (bash prefix: assignment words incl. `+=` and redirections; `env`/`sudo` with their options, `-C`/`-D` moving the cwd; `env -S`/`-P`, `sudo -e`/`-R` read no command); the #590 "Non-bare `git` invocations" section (~34-36) adds `sudo` and `NAME+=value`.
- Modify: `docs/journeys/get-a-disguised-main-checkout-write-denied-4303.md:85` — the gap row `A NAME=value, env or sudo prefix | #4448` (Behavior-change prose sweep): drop the row or mark it closed by #4448, matching that table's convention.
- Sweep (no-change unless a hit describes the old behavior): `git grep -n -i -e "NAME=value" -e "env builtin" -e "assignment prefix" -- plugin docs/hooks.md`.

**Interfaces:**
- Consumes: Tasks 1 and 2's `fileWriteTargets`/`gitTargets` behavior.

- [ ] **Step 1: Write the tests**
  - `AC1.1 e2e #4448: a write or commit behind a NAME=value, env or sudo prefix from a linked worktree into the main checkout is DENIED` (same win32 skip as e2e #4303) — `linkedWorktree4303()`; `decisionFor(cmd)` is `'deny'` for `X=1 cp a ${main}/f.js`, `sudo cp a ${main}/f.js`, `X=1 tee ${main}/f.js`, `X=1 sed -i s/a/b/ ${main}/f.js`, `cd ${main}; x+=1 git commit -m x`, `x+=1 git -C ${main} commit -m x`; and the control `X=1 cp a ${wt}/f.js` is not `'deny'`.
  - `DIFFERENTIAL_CORPUS` gains, under a `// #4448: a write or git command behind a NAME=value, env or sudo prefix.` comment: `'X=1 cp a.txt b.txt'`, `'sudo tee out.txt'`, `'x+=1 git commit -m x'`, `'sudo git commit -m x'`, `'env -C sub cp a.txt b.txt'`.

- [ ] **Step 2: Run them**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS (Tasks 1-2 already make them pass; if Task 1/2 were reverted the e2e rows would read `allow` — Task 4 proves this by mutant).

- [ ] **Step 3: Edit the prose** per the Files block; run `node --test tests/hooks-gate-coverage.test.js` again (its prose pins read `policy-schema-coverage.md`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js plugin/skills/_shared/policy-schema-coverage.md docs/journeys/get-a-disguised-main-checkout-write-denied-4303.md
git commit -m "Pin the prefix shapes end to end and document the prefix reading — refs #4448"
```

### Task 4: Base comparison, differential fuzz, and mutants

**Role:** judgment

**Files:**
- Evidence (not committed to the repo): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-28T200032-record-4448/evidence/4448-base-and-mutants.md`, written with a plain Bash redirect or a node script (the run dir is main-anchored; the Write tool is refused there).
- Test: whichever of the four suites a surviving mutant shows is missing a pin.

**Interfaces:**
- Consumes: Tasks 1-3.

- [ ] **Step 1: Base comparison (AC3.1).** `git worktree add --detach <scratchpad>/base fae7a76ba` (the merge-base) as its own call; a scratchpad node script `require`s both copies of `git-command.js` and prints, for every command in Tasks 1-3's tests plus the `#4149 routine` table's openers and every `DIFFERENTIAL_CORPUS` line, `fileWriteTargets`, `gitTargets` and `mkdirTargets` from `/r` at base and at HEAD, then once more with `{ pathImpl: path.win32 }` on both sides. Expected: every difference is one of the listed #4448 shapes (or the quoted-name git row, whose verdict is in the table); any other difference gets a real-shell verdict through the oracle and either a fix or a pinned fail-closed note. Record the diff in the evidence file. Remove the scratch worktree after (`git worktree remove --force <scratchpad>/base`, its own call).

- [ ] **Step 2: Differential fuzz.** Generate ≥300 commands from the alphabet {`X=1`, `x+=1`, `"x"=1`, `x\=1`, `a=( 1 2 )`, `x=$(echo a b)`, `env`, `env -i`, `env -u X`, `env -C M`, `env --`, `>g`, `cd M;`, `cd W &&`} × {`cp a f.js`, `tee f.js`, `sed -i.bak s/a/b/ f.js`, `git commit -m x`, `git -C M commit -m x`} (`M`/`W` as the oracle substitutes them), run each through `verdicts.js` from `wt` and through the HEAD scanner with cwd = the oracle's `wt` and the scratch `main` as the guarded root. Expected: no row where a shell writes or commits in `main` and the scanner reports no `main` target (a leak); a scanner-only `main` target is accepted only as a stated fail-closed tradeoff. Turn each divergence into a pinned case. Record counts in the evidence file.

- [ ] **Step 3: Mutants (AC4.1).** In a scratch detached worktree at HEAD, one at a time: (a) `commandPrefixEnd` stops skipping redirections; (b) it stops skipping assignment words; (c) the wrapper loop stops recognizing `env`; (d) … `sudo`; (e) env `-C`/sudo `-D` stop moving `dir`; (f) the opaque options stop returning -1; (g) the wrapper `=`-word skip is removed; (h) `findGitLead` ignores `quoting` (plain-text reading); (i) `fileWriteTargets` resolves shape targets in `effCwd` instead of the lead's `dir`; (j) `visitSegment` goes back to assignment-only `cdLead`. Run the four suites for each. Expected: every mutant turns at least one test red; add a discriminating case for any survivor (or delete a dead rule). Record mutant → failing test names in the evidence file.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures (AC5.1).

- [ ] **Step 5: Commit** any added pins: `git add <changed test files>` then `git commit -m "Pin #4448 mutant survivors — refs #4448"` (skip when nothing changed).

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (skip NAME=value / NAME+=value, env, sudo before write-shape, git and cd lead) | Tasks 1, 2 |
| Deliverable 2 (quoted-name assignment read as bash does) | Task 1 (write shapes, AC2.1 pin), Task 2 (git) |
| Deliverable 3 (pin each shape with bash 3.2 and 5 verdicts) | Tasks 1-3 test comments |
| AC1.1 | Tasks 1, 2 (parser), Task 3 (e2e deny) |
| AC2.1 | Task 1 |
| AC3.1 | Task 4 Step 1 |
| AC4.1 | Task 4 Step 3 |
| AC5.1 | Task 4 Step 4 |
