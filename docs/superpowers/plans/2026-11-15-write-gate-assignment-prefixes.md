# Write-gate stripped command prefixes (#4448) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The write gate's shell scanner reads the command word bash actually runs behind every stripped prefix ADR 0028 (#4571) names, so a write or commit behind `NAME=value`, `NAME+=value`, `env`, `sudo`, `doas`, `command`, `builtin`, `exec`, `nice`, `nohup`, `time` or `!` resolves the path bash writes.

**Architecture:** One new helper in `plugin/bin/lib/hooks/git-command.js`, `commandWord(t, quoting, dir, opts)`, skips the bash prefix (assignment words, read by the existing span-aware `assignmentWordEnd`, and redirection words, in any order), then each stripped prefix word with its own option flags, looping until the command word. `visitSegment`'s `cd` lead (with `shellOnly`, since only the shell-level prefixes run the `cd` builtin in the current shell), `findGitLead`, `fileWriteTargets`' write-shape lead and `mkdirTargets`' lead all read their command word through it. The prefix word list (`STRIPPED_PREFIX_WORDS`) and the reader (`commandWord`) are both exported for #4572 and #4244, so the assignment-word skip and the option carve-outs are reused, not retyped (plan-review clarification in the spec).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T190708-record-4448/work/4448-spec.md` (record #4448, narrowed under ADR 0028)

Scope keywords: findGitLead, resolveGitCommand, assignmentWordEnd, dropRedirections, cdLead

## Global Constraints

- Every expected target comes from a real-shell verdict, never from the scanner's own output. Governing skill `shell-scanner-bash-differential` (`.claude/skills/shell-scanner-bash-differential/SKILL.md`), quoted verbatim:
  - "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here)." … "Write the verdict into the test comment, the way `tests/hooks-gate-coverage.test.js` does (\"bash 3.2 and 5 write /main/f.js for each\"). When the versions disagree, note it … and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "The gate's tradeoff is that a spurious deny is acceptable and a leak is not."
  - "Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base and at earlier revisions of the branch, in a scratch `git worktree add --detach`. Diff the targets. Anything that moves from denied to allowed needs its own bash verdict."
  - "When the change threads a `pathImpl` through the resolvers, run that base comparison with `path.win32` injected on both sides too."
  - "In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it)." … "Run the mutant rather than predicting which rows it turns red."
  - "A pin tagged with a record gets the same check against the release before that record: load that release's `git-command.js` from a scratch worktree, and if the pin passes there too, it pins nothing the record changed. Give it an input that fails there, or retitle it as a pre-existing pin."
  - "List every spelling-keyed rule in the same change, pin each with an escaped and a quoted spelling."
  - "A shape a change leaves out goes in three places in that change: a test row pinning it, the coverage block's gaps, and the tracking record, which must name it, not just its family."
  - "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)."
  - "Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32."
  - "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js`."
  - "Run zsh as a third oracle … add each zsh-only divergence to the known gaps in `policy-schema-coverage.md`. Whether the scanner should follow zsh is still an open decision (#4455), so do not quietly side with zsh in the expected target."
  - "The fail-closed cases are stated once, in `plugin/skills/_shared/policy-schema-coverage.md`'s coverage block."
- Real-shell oracle: only through the bounded driver already in this session's scratchpad, `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/42aed7fb-95c9-4ed5-99e9-8fcb190dcad6/scratchpad/oracle/verdicts.js` (`node verdicts.js "<worktree>" <cases.json>`; cases are `[["wt"|"main", "cmd with M and W for the main/worktree dirs"], …]`; it copies the skill's Bounded bash verdict block verbatim as `runBash.js`, runs bash 3.2, bash 5 and zsh with a stub-only PATH and prints what each wrote and where `git` ran). Never `spawnSync` a shape with the real PATH.
- The four scanner suites: `tests/hooks-gate-coverage.test.js`, `tests/hooks-git-command.test.js`, `tests/hooks-bash-prefilter.test.js`, `tests/teardown-gate.test.js`.
- `mkdirTargets` reads its lead through `commandWord` too (plan review: `X=1 mkdir`, `sudo mkdir` and `time mkdir` aimed at a pipelines path otherwise escape the pipeline-shadow guard, and ADR 0028 lists `mkdir` among the shapes read behind the stripped prefixes).
- Not here: `powershellOpaqueCommand`, `processKillLead` and the heredoc reader check (`checkReaderCommand`) keep their own lead reading (#4572 owns the recogniser that reuses the exported set); compound keywords (`if`/`then`/`do`/…) are #4244's; `pushd`/`popd` are #4572's.
- `COMMAND_PREFIX_WORDS` (`git-command.js:~1931`, read by `lineLeavesStructureOpen` and `groupEventsWith`) is left unchanged (Gotcha ruling): it lists reserved words after which the next word is at command position for the heredoc/structure scan; `builtin` and `command` are ordinary builtins that open no structure, and `!`/`time` are already in it. The new set is separate and named `STRIPPED_PREFIX_WORDS`.
- `READER_WRAPPER_WORDS` is unchanged (its list is pinned to `policy-schema-coverage.md`'s reader prose by `tests/hooks-gate-coverage.test.js:162`).
- Draft PR #4530 is reused and re-scoped to this body (Gotcha 2): `pr-early-open.js` already rewrote its body to this run's marker and spec summary.

Real-shell verdicts taken for this plan (oracle above, started in `wt`, `M` = main checkout; "all" = bash 3.2, bash 5 and zsh agree):

| Shape | bash 3.2 / 5 write or run git in | zsh |
|---|---|---|
| `X=1 cp a M/f.js`, `X=1 tee M/f.js`, `x+=1 tee M/f.js`, `X=1 sed -i.bak s/a/b/ M/x`, `x=$(echo a b) cp a M/f.js`, `a=( 1 2 ) cp a M/f.js` | M | same |
| `! cp x M/b`, `time cp x M/b`, `time time cp …`, `command cp x M/b`, `command -p cp …`, `command -p -- cp …`, `nohup cp x M/b`, `nohup -- cp …`, `nice cp x M/b`, `nice -n 5 cp …`, `nice -n5 cp …`, `nice -5 cp …`, `exec cp x M/b`, `exec -a foo cp …`, `exec -c cp …`, `exec -cl cp …` | M | same |
| `time -p cp x M/b` | M | writes nothing (zsh runs `-p`) — side with bash |
| `/usr/bin/nice cp x M/b`, `/usr/bin/env cp …`, `/usr/bin/nohup cp …`, `/usr/bin/time cp …`, `\time cp …`, `'time' cp …`, `"nice" cp …`, `co\mmand cp …` | M | same |
| `nice nohup env X=1 cp a M/f.js`, `command nice cp …`, `time ! cp …`, `! time cp …`, `X=1 command cp …` | M | same |
| `X=1 time cp a M/f.js` | M | parse error, nothing — side with bash |
| `! ! cp a M/f.js` | bash 5: M; bash 3.2: syntax error | parse error — side with bash 5 |
| `env cp a M/f.js`, `env -i X=1 cp …`, `env -u X cp …`, `env -iuX cp …`, `env -- cp …`, `env - cp …`, `env a.b=1 cp …`, `env "x"=1 cp …`, `X=1 env Y=2 tee M/f.js` | M | same |
| `>g X=1 cp a M/f.js`, `X=1 >g cp a M/f.js` | M/f.js and wt/g | same |
| `builtin cd M; cp a f.js`, `\builtin cd M; …`, `builtin -- cd M; …`, `command cd M; …`, `command -- cd M; …`, `command -p cd M; …`, `! cd M; …`, `time cd M; …`, `time -p cd M; …`, `X=1 cd M; …`, `>g cd M; cp a f.js` | M/f.js | `builtin --`, `command`, `time -p` before `cd`: wt/f.js — side with bash |
| `nice cd M; cp a f.js`, `env cd M; cp a f.js` | wt/f.js (external `cd`) | same |
| `exec cd M; cp a f.js` | nothing (exit 127) | same |
| `cd M; x+=1 git commit -m x`, `x+=1 git -C M commit -m x`, `time git -C M commit …`, `command git -C M commit …`, `nohup git -C M commit …`, `! git -C M commit …`, `>g git -C M commit -m x`, `X=1 >g git -C M commit -m x` | git commit in M (and wt/g for the redirect rows) | same |
| `"x"=1 git -C M commit -m x`, `x\=1 git -C M commit -m x`, `"x"=1 cp a M/f.js`, `command X=1 cp a M/f.js`, `X=1 ! cp …`, `\! cp …` | nothing (exit 127) | same |
| from main: `"x"=1 cd W; cp a f.js` | main/f.js | same |
| `builtin cp x M/b` | nothing (`not a shell builtin`) | same |
| `command -v cp`, `command -V cp`, `command -pv cp; cp a f.js` | nothing / wt/f.js | same |
| `env -S 'cp a M/f.js'` | M (macOS env) | same |
| `env -P /nope cp a M/f.js` | nothing (exit 127) | same |
| `time`, `builtin`, `exec >g` | nothing; `exec >g` writes wt/g | same |
| `\time -l cp a M/f.js`, `/usr/bin/time -p cp a M/f.js` (external time) | M | same |
| `X=1 time -a -o log cp a M/f.js` | M/f.js and wt/log | parse error — side with bash |
| `\time -o M/log cp a b` | main/log (time's output file) and wt/b | same |
| `X=1 mkdir M/px`, `time mkdir M/px` | creates M/px (exit 0) | same |

`sudo` and `doas` cannot run in the oracle. Their argv contract is sudo(8)'s and doas(1)'s, cited in the test comments instead of a shell verdict: sudo reads options (value-taking short letters `a C c D g h p R r T t U u`; `-D`/`--chdir` sets the command's cwd), then `VAR=value` words, then the command; doas reads `-L -n -s` and value-taking `-C config` and `-u user`, then the command.

**Base-comparison ruling (AC5.1, the plan review's earlier Q2).** "The listed shapes" are this table's rows. Every row is either a Current State bullet, an AC1.2 shape, or a stripped prefix the narrowed body names (Deliverable 1) read with its options, and each has the verdict above. Two row groups move between allow and deny and are named here so the base comparison can be judged against them:
- **Allow → deny (fail closed, bash writes):** a redirection word before the command word (`>g X=1 cp …`, `>g git -C M commit …`, `>g cd M; cp a f.js`) and a path-qualified external prefix (`/usr/bin/nice cp …`). Both are a consequence of reading the command word as bash does; each is a leak at base.
- **Deny → allow (bash runs nothing):** `"x"=1 git -C M commit -m x` and `x\=1 git -C M commit -m x`. Deliverable 3 ("Read a quoted-name assignment as bash does") requires it, and bash 3.2, bash 5 and zsh all exit 127 with no commit.
Any other difference the comparison finds gets an oracle verdict and either a fix or a pinned fail-closed note (Task 4 Step 1).

**Opaque prefix options (the plan review's earlier Q1).** The narrowed body scopes `env` to "without `-S`/`--split-string`/`-P`"; under ADR 0028 every unreadable part is #4572's. So `env -S`/`--split-string`/`-P`, and the sudo/doas options after which no command runs from a known cwd (`sudo -e`/`--edit`, `-R`/`--chroot`, `-i`/`--login`, `-l`/`--list`, `-v`/`--validate`, `-K`/`--remove-timestamp`; `doas -C`, `-s`, `-L`), read no command word: base parity, no target. Per the governing skill each goes in three places: a test row (Task 1), the coverage block's gaps (Task 3), and #4572, which must name them (Task 3 Step 4).

## Review Focus

1. A prefix word spelled quoted or escaped (`'time' cp …`, `\builtin cd M`, `"nice" cp …`): bash and zsh still run the program, so the lead must match on the word's value. Pinned in Tasks 1 and 2 with escaped and quoted rows.
2. A prefix word that bash reads as a command name instead (`X=1 ! cp …`, `\! cp …`, `command X=1 cp …`): bash writes nothing; skipping it reports a target bash never writes. That is the accepted fail-closed side; pin one row as a deliberate tradeoff so a later fix cannot quietly reopen the opposite direction.
3. `command -v`/`-V` in a cluster (`command -pv cp`): a lookup that runs nothing must resolve no target, while `command -p cp` writes. Pinned in Task 1.
4. A prefix that does not run the `cd` builtin in the current shell (`nice cd M; cp a f.js`, `env cd M; …`, `exec cd M; …`): the cwd must not move, while `builtin`/`command`/`!`/`time` before `cd` move it. Pinned in Task 1.
5. A redirection before the command word: its target still resolves in the shell's own cwd, and the command after it is still read (`>g X=1 cp …`, `>g git -C M commit …`). Pinned in Tasks 1 and 2.

---

### Task 1: `commandWord` helper and the write-shape and `cd` leads

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new `redirectionWidth`, `STRIPPED_PREFIX_WORDS`, `commandWord` beside `assignmentWordEnd` ~782; `dropRedirections` ~3476 rewritten over `redirectionWidth`, behavior unchanged; `visitSegment` ~811-852: the assignment-only `cdLead` loop replaced; `fileWriteTargets` ~3492-3641: the lead read through `commandWord`; `mkdirTargets` ~3669-3689: its `t[0] !== 'mkdir'` lead read through `commandWord`, positionals from the word after the lead, resolved in the lead's `dir`; `module.exports` ~3691 gains `STRIPPED_PREFIX_WORDS` and `commandWord`)
- Test: `tests/hooks-gate-coverage.test.js` (new block after the `#4303` assignment-word tests)

**Interfaces:**
- Produces:
  - `STRIPPED_PREFIX_WORDS: readonly string[]` = `Object.freeze(['!', 'builtin', 'command', 'doas', 'env', 'exec', 'nice', 'nohup', 'sudo', 'time'])`, exported. Assignment words (`NAME=value`, `NAME+=value`) are the other stripped prefix; they are a word shape, read by `assignmentWordEnd`, not a word in the list.
  - `commandWord` (below) is exported too, so #4572's recogniser and #4244's keyword skip reuse the assignment-word skip and the option carve-outs rather than retyping them.
  - `redirectionWidth(raw: string, kinds: string, leadQuoted: boolean) -> 0|1|2` (module-internal): 0 not a redirection or heredoc word; 1 a glued one (`>f`, `<<EOF`); 2 a lone operator that takes the next word (`>`, `<<`, `<<-`, `<<<`). Exactly `dropRedirections`' per-token logic today.
  - `commandWord(t: string[], quoting, dir, { shellOnly = false } = {}) -> { index: number, dir, unprovable: boolean }` (exported). `quoting` is the walk's `{ raw, spanKinds, leadQuoted, pathImpl }`. Loop from `i = 0`: skip every assignment word (`assignmentWordEnd(raw, spanKinds, i) > i`) and redirection (`redirectionWidth`, advancing by its width); then if `t[i]` (the value) is a prefix word, skip it and its options and loop again; otherwise `t[i]` is the command word. `index` is -1 when no word is left or an opaque option is read. With `shellOnly`, only `!`, `time`, `builtin` and `command` are prefix words (the ones that run a following `cd` builtin in the current shell); `dir` never moves.
  - Prefix reading (value-matched; `env`, `sudo`, `doas`, `nice`, `nohup` and `time` also match a value ending in `/{name}`, as the git lead matches `/git`):
    - `!` — no options.
    - `time` — the bash keyword's `-p`, and the external program's options too, since a quoted, escaped, path-qualified or assignment-led `time` runs `/usr/bin/time` (macOS) or GNU time: plain letters `p l a v q`, value-taking `o` and `f` (cluster via `readShortCluster` with value letters `of`), long options by unique prefix `output` and `format` (value), `append`, `verbose`, `portability`, `quiet`, `help`, `version`; an unknown long option skips one word; `--` ends options. The `-o FILE` output file is not reported as a write target: a left-out shape, owned by #4572, pinned and documented in Task 1 Step 1 and Task 3.
    - `command` — a short cluster containing `v` or `V` → index -1 (a lookup); `-p` clusters skipped; `--` ends options.
    - `builtin` — `--` ends options.
    - `exec` — `-c`, `-l`, value-taking `-a NAME` (`readShortCluster` with value letters `a`); `--` ends options.
    - `nice` — value-taking `-n` (`-n 5`, `-n5`), `--adjustment=N` / `--adjustment N` (getopt unique prefix of `--adjustment`), one obsolete `-N` word (`/^-\d+$/`); `--` ends options.
    - `nohup` — `--` ends options.
    - `env` — `-` alone is `-i`; short clusters via `readShortCluster` with value letters `CuSPLUa`; `C` moves `dir` through `resolveCd` (unresolvable → `unprovable: true`, dir kept), `S`/`P` → index -1; long options by getopt unique prefix: `chdir` (value, moves dir), `unset` (value), `split-string` (value, → -1), `argv0` (value), `ignore-environment`, `null`, `debug`, `list-signal-handling`, `help`, `version`, and `block-signal`/`default-signal`/`ignore-signal` (a value only with `=`); an unknown or ambiguous long option skips one word; `--` ends options; then every word whose value contains `=` is env's assignment and is skipped.
    - `sudo` — short clusters with value letters `aCcDghpRrTtUu`; `D` moves `dir`; `e`, `R`, `i`, `l`, `v`, `K` → index -1; long options by unique prefix: `chdir` (value, moves dir), `edit`/`chroot`/`login`/`list`/`validate`/`remove-timestamp` (→ -1), `auth-type`, `close-from`, `group`, `host`, `login-class`, `prompt`, `role`, `type`, `command-timeout`, `other-user`, `user` (value-taking), `askpass`, `background`, `bell`, `preserve-env` (a value only with `=`), `set-home`, `help`, `non-interactive`, `preserve-groups`, `reset-timestamp`, `stdin`, `shell`, `version`; an unknown or ambiguous long option skips one word; `--` ends options; then every word whose value contains `=` is skipped.
    - `doas` — short clusters with value letters `Cu`; `C`, `s`, `L` → index -1; `-n` plain; `--` ends options.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-gate-coverage.test.js`, each comment carrying its verdict row from the Global Constraints table (`MAIN_F`, `path.resolve`; `MAIN_B = path.resolve('/main/b')`), all from cwd `/r` unless stated:
  - `AC1.1 #4448: a write shape behind a NAME=value or NAME+=value prefix resolves the main-checkout write` — `fileWriteTargets(cmd, '/r').map((x) => x.file)` includes `MAIN_F` for `X=1 cp a /main/f.js`, `X=1 tee /main/f.js`, `x+=1 tee /main/f.js`, `X=1 sed -i s/a/b/ /main/f.js`, `x=$(echo a b) cp a /main/f.js`, `a=( 1 2 ) cp a /main/f.js`, `sudo cp a /main/f.js`.
  - `AC1.2 #4448: a write shape behind each stripped prefix resolves the main-checkout write` — includes `MAIN_B` for `! cp x /main/b`, `time cp x /main/b`, `command cp x /main/b`, `nohup cp x /main/b`, `nice cp x /main/b`, `doas cp x /main/b`, `exec cp x /main/b`, `builtin cp x /main/b` (fail closed: bash writes nothing, `not a shell builtin`; pinned as the accepted tradeoff), and for the option rows `time -p cp …`, `command -p -- cp …`, `nohup -- cp …`, `nice -n 5 cp …`, `nice -n5 cp …`, `nice -5 cp …`, `nice --adjustment=5 cp …`, `exec -a foo cp …`, `exec -cl cp …`, `sudo -u bob cp …`, `sudo -E X=1 tee /main/b`, `doas -u bob cp …`, `doas -n cp …`.
  - `#4448: stripped prefixes chain and combine with assignments` — includes `MAIN_F` for `nice nohup env X=1 cp a /main/f.js`, `command nice cp a /main/f.js`, `time ! cp a /main/f.js`, `! time cp a /main/f.js`, `X=1 time cp a /main/f.js`, `X=1 command cp a /main/f.js`, `sudo env X=1 cp a /main/f.js`, `env sudo cp a /main/f.js`, `! ! cp a /main/f.js`.
  - `#4448: a quoted, escaped or path-qualified prefix word still strips` — includes `MAIN_F` for `\time cp a /main/f.js`, `'time' cp a /main/f.js`, `"nice" cp a /main/f.js`, `co\mmand cp a /main/f.js`, `/usr/bin/nice cp a /main/f.js`, `/usr/bin/env cp a /main/f.js`.
  - `#4448: a prefix word bash runs as a command name strips anyway (deliberate fail-closed tradeoff)` — includes `MAIN_F` for `X=1 ! cp a /main/f.js`, `\! cp a /main/f.js`, `command X=1 cp a /main/f.js` (bash: exit 127, nothing written).
  - `#4448: an env prefix with its options resolves the main-checkout write` — includes `MAIN_F` for `env cp a /main/f.js`, `env -i X=1 cp …`, `env -u X cp …`, `env -iuX cp …`, `env - cp …`, `env -- cp …`, `env a.b=1 cp …`, `env "x"=1 cp …`, `env --unset=X cp …`, `X=1 env Y=2 tee /main/f.js`.
  - `#4448: env -C and sudo -D move the cwd a relative write resolves in` — `env -C /main cp a f.js`, `env --chdir=/main cp a f.js`, `env -iC /main cp a f.js`, `env --ch /main cp a f.js`, `sudo -D /main cp a f.js`, `sudo --chdir=/main cp a f.js` each deep-equal `[{ action: 'copy', file: MAIN_F }]`; `env -C $X cp a f.js` → `[]` and `env -C $X cp a /main/f.js` → `[{ action: 'copy', file: MAIN_F }]`.
  - `#4448: a redirect before or among the prefix words keeps its own cwd, and the command after it is read` — `X=1 >g cp a /main/f.js` and `>g X=1 cp a /main/f.js` deep-equal `[{ action: 'write', file: path.resolve('/r/g') }, { action: 'copy', file: MAIN_F }]`.
  - `AC2.1 #4448: a lookup or a bare prefix resolves no target` — `fileWriteTargets(cmd, '/r')` deep-equals `[]` for `command -v cp`, `command -V cp`, `command -pv cp`, `builtin`, `time`, `!`, `nice`, `env`, `sudo`; and `exec >g` deep-equals `[{ action: 'write', file: path.resolve('/r/g') }]`.
  - `#4448: an opaque prefix option resolves no target (base parity, owned by #4572)` — `[]` for `env -S 'cp a /main/f.js'`, `env --split-string='cp a /main/f.js'`, `env -P /x cp a /main/f.js`, `env -iS 'cp a /main/f.js'`, `sudo -e /main/f.js`, `sudo --edit /main/f.js`, `sudo -R /x cp a /main/f.js`, `sudo -i cp a /main/f.js`, `sudo -l cp a /main/f.js`, `doas -C /x cp a /main/f.js`, `doas -s`.
  - `#4448: builtin, command, ! and time before cd move the cwd; other prefixes do not` — `fileWriteTargets(cmd, '/r')` deep-equals `[{ action: 'copy', file: MAIN_F }]` for `builtin cd /main; cp a f.js`, `\builtin cd /main; cp a f.js`, `builtin -- cd /main; cp a f.js`, `command cd /main; cp a f.js`, `command -p cd /main; cp a f.js`, `! cd /main; cp a f.js`, `time cd /main; cp a f.js`, `time -p cd /main; cp a f.js`, `>g cd /main; cp a f.js` (this one also has the `/r/g` write first); and `[{ action: 'copy', file: path.resolve('/r/f.js') }]` for `nice cd /main; cp a f.js`, `env cd /main; cp a f.js` and `exec cd /main; cp a f.js` (bash runs nothing after `exec cd`; the scanner keeps reading under the unmoved cwd, a spurious target in the shell's own cwd, never `/main`).
  - `#4448: a quoted or escaped assignment name is the command word, so no shape is read` — `"x"=1 cp a /main/f.js` and `x\=1 cp a /main/f.js` deep-equal `[]` (bash: exit 127).
  - `AC3.1 #4448: a quoted-name assignment before cd changes no cwd` — `fileWriteTargets('"x"=1 cd /wt; cp a f.js', '/main')` deep-equals `[{ action: 'copy', file: MAIN_F }]` (bash 3.2, 5 and zsh write main/f.js). This passes at base already (#4281's `isAssignmentWord`); title it `AC3.1 #4448 (pre-existing pin): …` per the governing skill's release-before check.
  - `#4448: the external time program's options are read, and its -o file is a left-out shape (#4572)` — includes `MAIN_F` for `\time -l cp a /main/f.js`, `/usr/bin/time -p cp a /main/f.js`, `X=1 time -a -o log cp a /main/f.js`, `\time -f %e cp a /main/f.js`, `\time --output=log cp a /main/f.js`; and `\time -o /main/log cp a b` reports no `path.resolve('/main/log')` target (pinned left-out shape; bash's `/usr/bin/time` writes `/main/log`).
  - `#4448: mkdir behind a stripped prefix resolves its directory` — `mkdirTargets(cmd, '/r').map((x) => x.file)` includes `path.resolve('/main/.claude-tweaks/pipelines/x')` for `X=1 mkdir /main/.claude-tweaks/pipelines/x`, `sudo mkdir -p /main/.claude-tweaks/pipelines/x`, `time mkdir /main/.claude-tweaks/pipelines/x`, `env -C /main mkdir .claude-tweaks/pipelines/x`; `command -v mkdir` → `[]`.
  - `AC4.1 #4448: the exported stripped-prefix rule matches the record's list` — `assert.deepStrictEqual([...gitCommand.STRIPPED_PREFIX_WORDS].sort(), ['!', 'builtin', 'command', 'doas', 'env', 'exec', 'nice', 'nohup', 'sudo', 'time'])` and `Object.isFrozen(gitCommand.STRIPPED_PREFIX_WORDS)`; and the exported reader applies the record's assignment and option rules — with `q = (t) => ({ raw: t, spanKinds: t.map((w) => 'b'.repeat(w.length)), leadQuoted: t.map(() => false), pathImpl: path })`, `gitCommand.commandWord(t, q(t), '/r').index` is `1` for `['X=1', 'cp']` and `['x+=1', 'cp']`, and `-1` for `['command', '-v', 'cp']`, `['command', '-V', 'cp']`, `['env', '-S', 'cp a b']` and `['env', '-P', '/x', 'cp']`. A comment names the record body's "Scope under ADR 0028" list as the source.

- [ ] **Step 2: Run them to verify the new ones fail**

Run: `node --test --test-name-pattern="#4448" tests/hooks-gate-coverage.test.js`
Expected: FAIL — the prefix, chain, quoted-prefix, external-time, mkdir, env, `-C`/`-D`, redirect and cd-prefix tests report `[]` or `/r` targets, and AC4.1 fails on the missing exports; AC3.1, the quoted-name, opaque-option and AC2.1 tests already pass (base-parity pins).

- [ ] **Step 3: Implement** `redirectionWidth`, `STRIPPED_PREFIX_WORDS` and `commandWord` per the Interfaces block. Rewrite `dropRedirections` over `redirectionWidth`. In `visitSegment` replace the `cdLead` loop with `const cdLead = commandWord(t, quoting, effCwd, { shellOnly: true }).index;` (build `quoting` before it; keep `t[cdLead] === 'cd'` and treat -1 as no cd) — this also removes the `for (;;)` assignment loop the record asks to replace. In `fileWriteTargets`: keep `redirectRawTargets` over the whole token list in `effCwd`; then `const lead = commandWord(tokens, quoting, effCwd)`, return on index -1; drop redirections from the slice after the lead (slicing `raw`/`leadQuoted`/`spanKinds` alongside); and resolve the shape's targets in `lead.dir` (`null` when `lead.unprovable`) instead of `effCwd`. In `mkdirTargets`, read the lead the same way (`t[lead.index] !== 'mkdir'` returns), take positionals from `t.slice(lead.index + 1)` and resolve them in `lead.dir`. Update the comments at `visitSegment` (~819-828) and the `fileWriteTargets` header that describe the old prefix reading.

- [ ] **Step 4: Run the tests and the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js
git commit -m "Read write shapes and cd behind the stripped command prefixes — refs #4448"
```

### Task 2: Git lead through `commandWord`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`findGitLead` ~906-965 and its header comment, `resolveGitCommand` ~978, `resolvedGitSegments` ~1030)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`teardownTargets` ~538: pass `quoting`; its comment at ~528-537 names the stripped prefixes)
- Test: `tests/hooks-gate-coverage.test.js`
- Test: `tests/teardown-gate.test.js`
- Test: `tests/hooks-git-command.test.js` (its walk at ~562 calls `resolveGitCommand(t, effCwd)` without quoting and keeps its result through the null-quoting fallback below)
- No change (Check B hit, reviewed): `docs/hooks.md` (names `resolveGitCommand` only for the lost-cwd marker, unchanged)
- No change (Check B hit, reviewed): `docs/plans/2026-10-25-4303-write-gate-fail-opens-ledger.md` (historical #4303 record)

**Interfaces:**
- Consumes: `commandWord(t, quoting, dir)` from Task 1.
- Produces: `findGitLead(t, dir, pathImpl = path, quoting = null)` and `resolveGitCommand(t, effCwd, pathImpl = path, quoting = null)`. With `quoting` null (direct callers and existing tests), a quoting built from `t` itself (`raw: t`, every character bare, no token lead-quoted, `pathImpl`) stands in, so `resolveGitCommand(['git', '-C', '', 'commit'], null)` and every existing env shape keep their results. The lead is `t[index] === 'git'` or ends in `/git`, as today; `unprovable` from `commandWord` makes the segment resolve null, as today. `findGitLead`'s own `SIMPLE_ASSIGNMENT_RE` skip and `env` loop are deleted.

- [ ] **Step 1: Write the failing tests**
  - `tests/hooks-gate-coverage.test.js`: `AC1.1 #4448: a git commit behind an appending assignment or a stripped prefix resolves the main checkout` — `gitTargets(cmd, '/r')` has an entry with `dir === MAIN_ROOT` for `cd /main; x+=1 git commit -m x`, `x+=1 git -C /main commit -m x`, `sudo git -C /main commit -m x`, `sudo -u bob git -C /main commit -m x`, `sudo -D /main git commit -m x`, `doas git -C /main commit -m x`, `time git -C /main commit -m x`, `command git -C /main commit -m x`, `nohup git -C /main commit -m x`, `nice -n 5 git -C /main commit -m x`, `! git -C /main commit -m x`, `exec git -C /main commit -m x`, `builtin cd /main; git commit -m x`, `env X=1 git -C /main commit -m x`, `>g git -C /main commit -m x`, `X=1 >g git -C /main commit -m x`.
  - same file: `#4448: a quoted or escaped assignment name before git runs no git` — `gitTargets('"x"=1 git -C /main commit -m x', '/r')` and `gitTargets('x\\=1 git -C /main commit -m x', '/r')` deep-equal `[]` (bash 3.2, 5 and zsh: exit 127, no commit). This moves a base deny to allow, per the Global Constraints ruling.
  - same file: `#4448: command -v git runs no git` — `gitTargets('command -v git', '/r')` deep-equals `[]`.
  - `tests/teardown-gate.test.js`: `#4448: teardownTargets reads a git worktree remove behind x+=1, sudo or time` — `x+=1 git worktree remove /abs/wt`, `sudo git worktree remove /abs/wt` and `time git worktree remove /abs/wt` each yield `[{ path: path.resolve('/abs/wt'), source: 'bash' }]` (follow that file's existing `teardownTargets` call shape).
  - `tests/hooks-git-command.test.js`: `#4448: resolveGitCommand without quoting reads an appending assignment and a stripped prefix` — `resolveGitCommand(['x+=1', 'git', 'commit'], '/r')` deep-equals `{ index: 2, dir: path.resolve('/r') }` and `resolveGitCommand(['nohup', 'git', 'commit'], '/r')` deep-equals `{ index: 2, dir: path.resolve('/r') }` (match that file's neighbours on whether `dir` is resolved).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern="#4448" tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js tests/hooks-git-command.test.js`
Expected: FAIL on the `+=`, prefix and leading-redirect rows; the quoted-name row fails too (base resolves `/main`); `command -v git` passes (base reads `command` as not-git).

- [ ] **Step 3: Implement** `findGitLead` over `commandWord`, thread `quoting` through `resolveGitCommand`, and pass the handler's `quoting` from `resolvedGitSegments` and `teardownTargets`. Update the `findGitLead` header comment (it lists the shapes it reads) and `pre-tool-use.js`'s comment.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js tests/hooks-git-command.test.js
git commit -m "Read the git lead behind the stripped command prefixes — refs #4448"
```

### Task 3: End-to-end deny, prefilter corpus, and the coverage prose

**Role:** integration

**Files:**
- Test: `tests/hooks-gate-coverage.test.js` (beside `AC1.1 e2e #4303`, ~3374, reusing `linkedWorktree4303`)
- Test: `tests/hooks-bash-prefilter.test.js` (`DIFFERENTIAL_CORPUS`, ~27)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (42,192 B; rail 52,500 B — headroom ~10.3 KB; this task adds about 0.6 KB): line ~30's last known-gap clause "and a write behind a `NAME=value`, `env` or `sudo` prefix (#4244)" is replaced by one sentence stating the reading (a write, `git` call or `cd` is read past the stripped prefixes: assignment words incl. `+=`, redirections, `env`, `sudo`, `doas`, `command`, `builtin`, `exec`, `nice`, `nohup`, `time` and `!` with their options; only `!`, `time`, `builtin` and `command` move the cwd for a following `cd`; `env -C`/`sudo -D` move the command's cwd), and the known gaps gain: a command behind `env -S`/`--split-string`/`-P` or `sudo -e`/`-R`/`-i`/`-l`/`-v`/`-K` or `doas -C`/`-s`/`-L` (#4572), the output file of the external `time` program's `-o`/`--output` (#4572), and zsh's reading of `command cd`, `builtin -- cd` and `time -p cd` (zsh does not move the cwd; the scanner follows bash, #4455). The #590 "Non-bare `git` invocations" section (~34-40) adds one bullet: stripped prefixes (`sudo git …`, `x+=1 git …`, `time git …`, …) are covered — the prefilter reaches each through the `git` word.
- Modify: `docs/journeys/get-a-disguised-main-checkout-write-denied-4303.md:90` — the gap row `A NAME=value, env or sudo prefix | #4448`: remove it (the shapes are now denied), matching how that table lists only open gaps; if the table's own header says it records closed gaps too, mark it closed by #4448 instead. Same file, line ~92: the #4244 row drops "and `builtin cd`" (Task 1 makes `builtin cd` move the cwd), leaving "Compound-command bodies (including a case or `cd` inside an `if`/`while`/`for` body) and `pushd`".
- Sweep (no change unless a hit describes the old behavior; list each hit's ruling in the commit body): `git grep -n -i -e "NAME=value" -e "env builtin" -e "assignment prefix" -e "sudo. prefix" -e "builtin cd" -- plugin docs/hooks.md docs/journeys`.

**Interfaces:**
- Consumes: Tasks 1 and 2's `fileWriteTargets`/`gitTargets` behavior.

- [ ] **Step 1: Write the tests**
  - `AC1.1 e2e #4448: a write or commit behind a stripped prefix from a linked worktree into the main checkout is DENIED` (same win32 skip as e2e #4303) — `linkedWorktree4303()`; `decisionFor(cmd)` is `'deny'` for `X=1 cp a ${main}/f.js`, `sudo cp a ${main}/f.js`, `X=1 tee ${main}/f.js`, `X=1 sed -i s/a/b/ ${main}/f.js`, `cd ${main}; x+=1 git commit -m x`, `x+=1 git -C ${main} commit -m x`, `! cp x ${main}/b`, `time cp x ${main}/b`, `command cp x ${main}/b`, `nohup cp x ${main}/b`, `nice cp x ${main}/b`, `doas cp x ${main}/b`, `exec cp x ${main}/b`; and the control `X=1 cp a ${wt}/f.js` is not `'deny'`.
  - `DIFFERENTIAL_CORPUS` gains, under a `// #4448: a write or git command behind a stripped prefix.` comment: `'X=1 cp a.txt b.txt'`, `'sudo tee out.txt'`, `'x+=1 git commit -m x'`, `'sudo git commit -m x'`, `'time cp a.txt b.txt'`, `'nohup git commit -m x'`, `'env -C sub cp a.txt b.txt'`, `'builtin cd sub; cp a.txt b.txt'`.

- [ ] **Step 2: Run them**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS (Tasks 1-2 already make them pass; Task 4's mutants prove the e2e rows can go red).

- [ ] **Step 3: Edit the prose** per the Files block, then run the sweep grep and rule on each hit. Run `node --test tests/hooks-gate-coverage.test.js` again (its prose pins read `policy-schema-coverage.md`).
Expected: PASS.

- [ ] **Step 4: Name the left-out shapes on #4572.** Write a comment body file with the Write tool (session temp dir) naming each opaque option shape from the Global Constraints' "Opaque prefix options" paragraph, and the external `time -o FILE` output file, as #4448's left-out shapes for #4572's unreadable rule, then `gh issue comment 4572 --body-file {file}`. Record the comment URL in the commit body of Step 5.

- [ ] **Step 5: Commit**

```bash
git add tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js plugin/skills/_shared/policy-schema-coverage.md docs/journeys/get-a-disguised-main-checkout-write-denied-4303.md
git commit -m "Pin the stripped prefixes end to end and document the prefix reading — refs #4448"
```

### Task 4: Base comparison, differential fuzz, and mutants

**Role:** judgment

**Files:**
- Evidence (not committed): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T190708-record-4448/evidence/4448-base-and-mutants.txt`, created after `mkdir -p` of its directory, written with a plain Bash redirect from a scratchpad node script (the run dir is main-anchored; the Write tool is refused there). One `decisions.md` entry per AC it covers (`log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T190708-record-4448" --section "/build" --status AUTO --step "AC evidence" --text-file {file}`), each naming the AC id, the command shape, the counts and the evidence path.
- Test: whichever of the four suites a surviving mutant shows is missing a pin.

**Interfaces:**
- Consumes: Tasks 1-3.

- [ ] **Step 1: Base comparison (AC5.1).** `git worktree add --detach <scratchpad>/base {merge-base}` (`git merge-base HEAD origin/main`, run first as its own call, pasted literally) as its own call. A scratchpad node script `require`s both copies of `git-command.js` and prints, for every command in Tasks 1-3's tests plus the `#4149 routine` table's openers and every `DIFFERENTIAL_CORPUS` line, `fileWriteTargets`, `gitTargets` and `mkdirTargets` from `/r` at base and at HEAD, then once more with `{ pathImpl: path.win32 }` on both sides. Expected: every difference is a row of the Global Constraints verdict table, including the two named allow/deny groups; any other difference gets an oracle verdict and either a fix or a pinned fail-closed note. Record the diff in the evidence file. Remove the scratch worktree after (`git worktree remove --force <scratchpad>/base`, its own call).

- [ ] **Step 2: Differential fuzz.** Generate at least 400 commands from the alphabet {`X=1`, `x+=1`, `"x"=1`, `x\=1`, `x=$(echo a b)`, `>g`, `env`, `env -i`, `env -u X`, `sudo`, `command`, `command -p`, `command -v`, `builtin`, `exec`, `nice -n 5`, `nohup`, `time`, `time -p`, `!`, `\time`, `'nice'`, `cd M;`, `cd W &&`} (one to three prefix items) × {`cp a f.js`, `tee f.js`, `sed -i.bak s/a/b/ f.js`, `git commit -m x`, `git -C M commit -m x`, `cd M; cp a f.js`} (`M`/`W` as the oracle substitutes them), run each through `verdicts.js` from `wt`, and through the HEAD scanner with cwd = the oracle's `wt` path and its `main` as the guarded root (a `sudo`/`doas` row has no oracle verdict: judge it by replacing the word with nothing, as sudo(8) runs the rest). Expected: no row where bash 3.2 or 5 writes or commits in `main` and the scanner reports no `main` target (a leak); a scanner-only `main` target is accepted only as a fail-closed row the verdict table or Review Focus 2 names. Turn each divergence into a pinned case. Record counts (total, leaks, accepted fail-closed, zsh-only) in the evidence file.

- [ ] **Step 3: Mutants (AC6.1).** In a scratch detached worktree at HEAD, one at a time: (a) `commandWord` stops skipping redirections; (b) it stops skipping assignment words; (c) each prefix word in turn is dropped from its reading (ten mutants); (d) `command`'s `v`/`V` lookup stops returning -1; (e) env `-C` / sudo `-D` stop moving `dir`; (f) the opaque options stop returning -1 (env `S`/`P`, sudo `e`/`R`/`i`, doas `C`); (g) the env/sudo `=`-word skip is removed; (h) the `/{name}` path match is removed; (i) `shellOnly` admits every prefix word; (j) `shellOnly` admits none; (k) `findGitLead` ignores `quoting` (bare reading); (l) `fileWriteTargets` resolves shape targets in `effCwd` instead of `lead.dir`; (l2) `mkdirTargets` goes back to `t[0] !== 'mkdir'`; (l3) the external-time option reading is reduced to `-p`; (m) `STRIPPED_PREFIX_WORDS` gains or loses one word. Run the four suites for each. Expected: every mutant turns at least one test red; add a discriminating case for any survivor (or delete a dead rule). Record mutant → failing test names in the evidence file.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures (AC7.1).

- [ ] **Step 5: Commit** any added pins: `git add <changed test files>` then `git commit -m "Pin #4448 mutant and fuzz survivors — refs #4448"` (skip when nothing changed).

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (one skip-to-command-word helper for `visitSegment`, `findGitLead`, the write-shape lead; the listed prefixes with their options) | Tasks 1, 2 |
| Deliverable 2 (export the prefix set) | Task 1 (`STRIPPED_PREFIX_WORDS`) |
| Deliverable 3 (quoted-name assignment read as bash does) | Task 1 (write shapes, AC3.1), Task 2 (git) |
| Deliverable 4 (pin each shape with its bash 3.2 and 5 verdicts) | Tasks 1-3 test comments |
| Plain loop in place of the assignment-in-condition loop | Task 1 Step 3 (the `cdLead` loop is replaced by one `commandWord` call) |
| Gotcha: `COMMAND_PREFIX_WORDS` and `groupEvents` | Global Constraints ruling (unchanged) |
| Gotcha: draft PR #4530 | Global Constraints (re-scoped by `pr-early-open.js`) |
| AC1.1 | Tasks 1, 2 (parser), Task 3 (e2e deny) |
| AC1.2 | Task 1, Task 3 (e2e) |
| AC2.1 | Task 1 |
| AC3.1 | Task 1 |
| AC4.1 | Task 1 |
| AC5.1 | Task 4 Step 1 |
| AC6.1 | Task 4 Step 3 |
| AC7.1 | Task 4 Step 4 |
