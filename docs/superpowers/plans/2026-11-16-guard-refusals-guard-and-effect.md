# Guard Refusals: Guard and Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tools/guard-refusals.js` say, for every refused tool call, which guard refused it, whether the refused command only reads, how a refused read was refused, and whether the plugin's rewriter already changes it.

**Architecture:** A new `tools/guard-refusals/effect.js` classifies a Bash command as `read`/`write`/`unknown` over `lexShell` (exported from `shapes.js`) plus `plugin/bin/lib/hooks/git-command.js`'s target parsers. `transcripts.js` records a row for every `is_error` result one of the guards produced (any tool) with a `guard` value, keeping the existing `refusals` list exactly as it is. `trace.js` gains nine reason ids. `guard-refusals.js` adds `effect`, `readClass`, `rewrite` per row and the `guards`/`byEffect`/`byReadClass`/`byRewrite`/`rows` output.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T005753-record-5587/work/5587-spec.md` (record #5587; AC6 read per the body's "Decision (plan review, AC6, 2026-11-16)": Reading B)

Scope keywords: classifyEffect, GATE_FRAGMENTS, classifyGuard

Waived plugin/bin/lib/hooks/harness-refusal.js: read only (ISOLATION_CLAUSE, already required); AC10 forbids editing it.
Waived plugin/skills/build/adopted-branch-collision-check.md: a Gotchas example of fence tracing; the record leaves the trace as it is.

## Global Constraints

- No path under `plugin/` changes (AC10). `tools/` and `tests/` only, plus `docs/` and `.claude/skills/parse-signal-discipline/SKILL.md`.
- No transcript content enters the repository: every fixture is hand-written; the PR quotes counts and reason ids only.
- `calls`, `refusals`, `perPipeline`, `byReason`, `byShape`, `byFence` and `top` keep their present meaning and counts. Expectations for those in existing tests are not edited (AC7).
- A command that can write is never `read`. An unlisted command word is `unknown`, never `read`.
- Gate fragments live in one table in `transcripts.js`; the "Edit the worktree copy of this file" fragment lives in `transcripts.js`, not in `plugin/bin/lib/hooks/harness-refusal.js`.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #5587`.

## Review Focus

- A write hidden inside a substitution or after a separator: `git log "$(rm x)"`, `` echo `rm x` ``, `ls && rm x`, `ls | tee f`. Expected: `write`. Pinned in Task 1's table.
- Redirects that are not writes: `2>&1`, `>&2`, `&>/dev/null`, `2>/dev/null`. Expected: `read` when the words are readers. A csh `>& file` is a write. Pinned in Task 1.
- A heredoc body naming a writer: `cat <<EOF\nrm x\nEOF` is `read` (data for a reader); `node <<EOF … EOF` is `unknown`. Pinned in Task 1.
- A Bash `is_error` result that merely prints `claude-tweaks:` after `Exit code 1` is not a row. Pinned in Task 3 (AC1).
- A plugin denial whose text matches no fragment is `plugin:other`, never dropped and never a harness row. Pinned in Task 3.

## AC coverage map

| Clause | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 3 Step 1, `transcripts.test.js` AC1 test |
| AC2.1, AC2.2 | Task 3 Step 1, `gate-fragments.test.js` AC2 tests and go-red cases |
| AC3.1, AC3.2 | Task 1 Step 1, `effect.test.js` AC3 test |
| AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6, AC4.7 | Task 1 Step 1, `effect.test.js` AC4 table |
| AC5.1, AC5.2, AC5.3 | Task 4 Step 1, `cli.test.js` AC5 test |
| AC6.1 | Task 2 Step 1, `trace.test.js` AC6 test (three `other` rows renamed per the record's AC6 Decision, Reading B) |
| AC7.1, AC7.2 | Task 2 Step 4, Task 3 Step 4, Task 4 Step 4: `node --test tests/guard-refusals/` with existing expectations untouched |
| AC8.1, AC8.2 | Task 5 Steps 1, 2, 5 |
| AC9.1, AC9.2, AC9.3, AC9.4, AC9.5, AC9.6 | Task 5 Step 3 (stratified seeded sample; wrong rows pinned in Task 1's table) |
| AC10.1 | Task 5 Step 4 |

---

### Task 1: Effect classifier

**Review risk:** high (decision logic: the read/write/unknown verdict branches on parsed command state)

**Files:**
- Create: `tools/guard-refusals/effect.js`
- Modify: `tools/guard-refusals/shapes.js` (export `lexShell` only; no other change)
- Test: `tests/guard-refusals/effect.test.js`

**Interfaces:**
- Consumes: `lexShell(text) -> Array<'plain'|'delim'|'single'|'double'|'comment'|'heredoc'>` from `./shapes`; `gitTargets(command, cwd)`, `fileWriteTargets(command, cwd)`, `mkdirTargets(command, cwd)` from `../../plugin/bin/lib/hooks/git-command`; `GATE_COVERAGE.gitActions` from `../../plugin/bin/lib/hooks/pre-tool-use`.
- Produces: `classifyEffect(command: string) -> { effect: 'read'|'write'|'unknown', why: string }`; exports `WRITE_WORDS`, `READERS`, `GIT_READ`, `GH_READ`, `GIT_WRITE`, `GH_WRITE`.

Tables (owned and exported by `effect.js`):
- `WRITE_WORDS` — word → what makes it write: `sed` short `i` / long `--in-place`; `perl` short `i`; `dd` operand prefix `of=`; `find` exact `-delete -exec -execdir -ok -okdir -fprint -fprint0 -fprintf -fls`; `curl` short `o O D c` / long `--output --remote-name --remote-name-all --dump-header --cookie-jar`; `sort` short `o` / long `--output`; `rm mv cp tee install ln truncate mkdir touch chmod` any. A short letter matches a single-dash cluster containing it (`-ni`, `-i.bak`, `-sSLo`); a long name matches itself or `name=…`.
- `READERS` — words that only read: `cat head tail less more wc grep egrep fgrep rg ls stat file find sed curl sort jq cut tr diff cmp comm basename dirname realpath readlink pwd echo printf which type printenv whoami id uname du df ps lsof pgrep column nl od hexdump strings sha256sum shasum md5 md5sum true false test [ [[ sleep cd pushd popd export unset set read :`. `perl`, `dd`, `awk`, `xargs` are not readers, nor are `tree` (`-o f` writes), `xxd` (a second operand is written), `hostname` (an operand sets it) and `date` (`-s` sets the clock): they are unlisted, so `unknown`.
- Wrappers classified by the command they wrap: `env` (after its flags and `NAME=value` words; bare `env` is read), `time`, `nice` (`-n N`), `timeout` (one duration), `nohup`, `command` (`command -v`/`-V` is read). Shell keywords (`if then else elif fi for while until do done case esac in select ! { }`) are transparent; the words of a `for`/`case`/`select` header are data.
- `GIT_READ` — unconditional read subcommands: `status log diff show rev-parse rev-list ls-files ls-tree ls-remote cat-file merge-base describe blame grep shortlog for-each-ref show-ref count-objects var check-ignore name-rev cherry whatchanged`. Conditional: `branch` / `tag` read only with no positional operand or with a list flag (`--list -l --show-current --contains --no-contains --merged --no-merged --points-at`) and no write flag (`-d -D -m -M -c -C --delete --move --copy -u --set-upstream-to --unset-upstream --edit-description -f --force -a` for `tag`); `remote` read with no subcommand, `-v`, `show`, `get-url`; `stash` read for `list`/`show`; `worktree` read for `list`; `config` read with `--get --get-all --get-regexp --list -l`; `reflog` read unless `expire`/`delete`. Any git subcommand with `--output`/`--output=` is write. Git global flags (`-C x`, `-c k=v`, `--no-pager`, `--no-optional-locks`, `--git-dir=…`, `--work-tree=…`) are skipped before the subcommand, except that a `-c` whose key is `core.*`, `alias.*`, or ends in `.pager` or `.editor` (case-insensitive), or whose word holds an unquoted or double-quoted `$`, makes the git command `unknown` (`why: 'git -c <key>'`): such a setting can run a program.
- `GIT_WRITE` — `commit push mv rm update-ref apply fetch pull merge rebase reset checkout switch restore add clean am cherry-pick revert gc prune init clone notes submodule update-index write-tree read-tree replace filter-branch bisect sparse-checkout`, plus the write forms of the conditional subcommands above (`stash` other than list/show, `worktree` other than list, `config` set, `remote add/remove/rm/set-url/rename`, `branch`/`tag` create/delete, `reflog expire/delete`). Every member of `GATE_COVERAGE.gitActions` must be here. Unlisted git subcommand → `unknown` (`why: 'git <sub>'`).
- `GH_READ` — `pr view|list|diff|checks|status`, `issue view|list|status`, `run view|list|watch`, `repo view`, `release view|list`, `search *`, `auth status`, `label list`, `workflow list|view`. `GH_WRITE` — `pr merge|create|edit|close|reopen|comment|ready|review`, `issue create|edit|close|reopen|comment|delete|transfer|pin|unpin|lock|unlock`, `label create|edit|delete|clone`, `release create|delete|upload|edit`, `run rerun|cancel|delete`, `workflow run|enable|disable`, `repo create|delete|edit|rename|archive|fork`. Unlisted gh subcommand → `unknown`.
- `gh api`: method from `-X`/`--method`/`--method=`; field flags `-f -F --field --raw-field --input`. A REST path is `read` for an explicit `GET` (fields or not) or no method and no field flag; `write` for another method or a field flag with no explicit GET. `gh api graphql`: the `query=` field's literal value (after quote removal) trimmed starts with `query` or `{` → read; starts with `mutation` → write; a value starting `@` (file), a value whose word holds an unquoted or double-quoted `$` expansion, or `--input` → `unknown`.

Algorithm (`classifyEffect`):
1. Run `fileWriteTargets(command, '/')`, `mkdirTargets(command, '/')`, `gitTargets(command, '/')`; any file/mkdir target, or a git target whose `action` is in `GATE_COVERAGE.gitActions` → `{ effect: 'write', why: 'git-command: <action>' }`. Wrap each call in try/catch; a throw falls through to step 2.
2. With `lexShell`, find every `$( … )` (not `$((`), backtick span, `<( … )` and `>( … )` whose opener is `plain` or `double`; classify each body recursively (depth cap 8; deeper → `unknown`, `why: 'nesting'`), and blank the span in the outer text to one data word.
3. Split the outer text at `plain` `;` `&` `|` newline `(` `)`. For each simple command, take its words with quotes removed (heredoc and comment chars belong to no word), strip leading `NAME=value` words and transparent keywords, and record output redirects (`>`, `>>`, `>|`, `&>`, `&>>`, `N>`, `N>>`, csh `>& file`): a redirect is a write unless its target is `/dev/null` or it duplicates a descriptor (`>&N`, `N>&M`, `>&-`).
4. Per simple command: a redirect write or a `WRITE_WORDS`/`GIT_WRITE`/`GH_WRITE` hit → write; command word computed at runtime (starts with `$` or is a blanked substitution) → `unknown` (`why: 'computed command name'`); a reader (with git/gh judged by their tables) → read; else `unknown` with `why` one of `node script`, `node -e` (`-e -p --eval --print`), `python3` (any `python`, `python3`, `python3.x`), `playwright-cli`, `bash` (`bash sh zsh dash ksh fish pwsh`), or `unlisted word: <word>`. A command word is its basename (`/usr/bin/rm` → `rm`).
5. Combine the simple commands and the substitution bodies: any `write` → write (first write's `why`); else any `unknown` → unknown (first unknown's `why`); else `{ effect: 'read', why: 'readers only' }`. Empty or whitespace command → `unknown`, `why: 'empty'`.

- [ ] **Step 1: Write the failing tests in `tests/guard-refusals/effect.test.js`**

  - `test('AC3: every WRITE_SHAPES, WRITE_WORDS and GATE_COVERAGE.gitActions member has a minimal writing case that is write')` — a `MINIMAL` object keyed by word (`cp: 'cp a b'`, `mv: 'mv a b'`, `tee: 'tee f'`, `sed: 'sed -i s/a/b/ f'`, `perl: 'perl -i -pe 1 f'`, `install: 'install a b'`, `ln: 'ln -s a b'`, `truncate: 'truncate -s 0 f'`, `dd: 'dd of=f'`, `rm: 'rm x'`, `mkdir: 'mkdir d'`, `touch: 'touch f'`, `chmod: 'chmod +x f'`, `find: 'find . -delete'`, `curl: 'curl -o f https://x'`, `sort: 'sort -o f g'`). Iterate `git-command.js`'s `WRITE_SHAPES` and `Object.keys(WRITE_WORDS)`: assert a `MINIMAL` entry exists (`assert.ok(MINIMAL[w], \`${w} has no case\`)`) and `classifyEffect(MINIMAL[w]).effect === 'write'`. Iterate `GATE_COVERAGE.gitActions`: `classifyEffect(\`git ${sub} x\`).effect === 'write'`.
  - `test('AC4: verdict table pins at least 60 commands')` — a `TABLE` of `[command, effect]` with at least 60 rows, asserting `TABLE.length >= 60` and each verdict. It must include: `['git log; rm x','write']`, `['git log "$(rm x)"','write']`, `['cat a > b','write']`, `['ls 2>/dev/null','read']`, `['echo x >&2','read']`, `['node /abs/x.js','unknown']`, `['frobnicate x','unknown']`, `['git branch --show-current','read']`, `['git branch -D x','write']`, `["gh api graphql -f query='query { viewer { login } }'",'read']`, `["gh api graphql -f query='mutation { x }'",'write']`, plus the Review Focus cases (`` ['echo `rm x`','write'] ``, `['ls && rm x','write']`, `['ls | tee f','write']`, `['ls 2>&1','read']`, `['ls &>/dev/null','read']`, `['ls >& out','write']`, `['cat <<EOF\nrm x\nEOF','read']`, `['node <<EOF\nx\nEOF','unknown']`), and rows for: `sed -n p f` read, `find . -name x` read, `find . -exec rm {} \\;` write, `curl https://x` read, `sort f` read, `perl -ne 1 f` unknown, `dd if=a` unknown, `git status` read, `git -C /x status` read, `git diff --output=f` write, `git fetch` write, `git branch foo` write, `git branch` read, `git tag` read, `git tag v1` write, `git stash list` read, `git stash` write, `git worktree list` read, `git worktree add x` write, `git config --get a.b` read, `git config a.b c` write, `git remote -v` read, `gh pr view 1` read, `gh pr merge 1` write, `gh issue list` read, `gh api repos/o/r/pulls` read, `gh api -X POST repos/o/r/issues` write, `gh api repos/o/r/issues -f title=x` write, `gh api -X GET search/issues -f q=x` read, `gh api graphql -f query=@q.graphql` unknown, `gh api graphql -f query="$Q"` unknown, `node -e 1` unknown, `python3 x.py` unknown, `playwright-cli open` unknown, `bash x.sh` unknown, `$CMD x` unknown, `env FOO=1 ls` read, `env FOO=1 rm x` write, `timeout 5 ls` read, `command -v git` read, `for f in a b; do cat $f; done` read, `if test -f x; then cat x; fi` read, `cd /x && ls` read, `ls | xargs rm` unknown (xargs is not a reader; its `rm` is an argument), `awk '{print}' f` unknown, `/bin/rm x` write, `echo hi > /dev/null` read, `mkdir -p d` write, `tree -o f` unknown, `xxd a b` unknown, `hostname x` unknown, `date -s 1` unknown, `git -c core.pager='rm x' log` unknown, `git -c alias.x='!rm x' x` unknown, `git -c color.ui=never log` read.
  - `test('classifyEffect returns a why naming the program for unknown')` — `classifyEffect('node /abs/x.js').why === 'node script'`, `'node -e 1'` → `'node -e'`, `'python3 x'` → `'python3'`, `'frobnicate'` → `'unlisted word: frobnicate'`.

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/guard-refusals/effect.test.js`
  Expected: FAIL with `Cannot find module '../../tools/guard-refusals/effect'`

- [ ] **Step 3: Add `lexShell` to `shapes.js`'s `module.exports`, and implement `tools/guard-refusals/effect.js`** per the tables and algorithm above, with a header comment in the style of its siblings (`#5587`, what it decides, the allowlist rule).

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/guard-refusals/effect.test.js tests/guard-refusals/shapes.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Probe linearity** (`.claude/skills/regex-scan-linearity`): time `classifyEffect` on `'a'.repeat(20000)`, `'$('.repeat(5000)`, `` '`'.repeat(20000) ``, `'a;'.repeat(10000)` and `'>'.repeat(20000)` in a scratch script outside the repo; each must finish under 1 s. A slow one is fixed before commit. No committed timing test.

- [ ] **Step 6: Commit**

```bash
git add tools/guard-refusals/effect.js tools/guard-refusals/shapes.js tests/guard-refusals/effect.test.js
git commit -m "Add the guard-refusals effect classifier — read, write or unknown per refused command, refs #5587"
```

---

### Task 2: Nine named reasons

**Files:**
- Modify: `tools/guard-refusals/trace.js` (`REASONS`, `REASON_TABLE`)
- Test: `tests/guard-refusals/trace.test.js` (`CASES`)

**Interfaces:**
- Produces: `REASONS` gains, before `'other'` and in this order, `playwright-runtime computed-command-name env-text python-git-text git-twice awk-program subshell arithmetic other-worktree-cwd`. `classifyReason` signature unchanged.

Patterns, appended after every existing `REASON_TABLE` entry in the same order:
`playwright-runtime` `/\bruns playwright-cli with a value computed at runtime/`; `computed-command-name` `/\bruns a command whose name is computed at runtime/`; `env-text` `/\bruns env with the text\b/`; `python-git-text` `/\bfeeds python text naming git\b/`; `git-twice` `/\bnames git more than once in a single command\b/`; `awk-program` `/\bruns awk with a program that can execute commands\b/`; `subshell` `/\buses a subshell\b/`; `arithmetic` `/\bevaluates\b[^\n]*\barithmetically\b/`; `other-worktree-cwd` `/\bworking directory\b[^\n]*\bis in a different worktree\b/`. The clause is at most 1500 chars (transcripts.js's cut), so the two `[^\n]*` runs are bounded.

- [ ] **Step 1: Update `CASES`.** The three existing rows that expect `'other'` (awk, playwright-cli, computed command name) are the clauses this task names: change only their ids to `awk-program`, `playwright-runtime`, `computed-command-name` (the spec's "only `other` shrinks"; logged as a premise reversal of AC6's "no expectation changed"). Add one row per remaining new id — `['env-text', 'runs env with the text "FOO=1 git status" inside a construct too complex to verify, so what it runs cannot be shown not to be git']`, `['python-git-text', 'feeds python text naming git in a plain command, so what it runs cannot be shown not to be git']`, `['git-twice', 'names git more than once in a single command, so it is too complex to verify that it stays inside the worktree']`, `['subshell', 'uses a subshell, so it is too complex to verify that it stays inside the worktree']`, `['arithmetic', 'evaluates a value computed at runtime arithmetically, which can run commands, so it cannot be shown not to be git']`, `['other-worktree-cwd', 'runs in a working directory (/tmp/wt-b) that is in a different worktree']` — and one new `['other', 'does something no named clause describes in a plain command']` so `other` keeps a case. Name the test `'AC6: classifyReason maps each live refusal clause …'` (rename the existing test title by prefixing `AC6: `).

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/guard-refusals/trace.test.js`
  Expected: FAIL on `env-text` (and the other new ids) returning `'other'`.

- [ ] **Step 3: Add the nine ids and patterns** to `trace.js` as above, and one header sentence naming #5587's additions.

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/guard-refusals/trace.test.js tests/guard-refusals/cli.test.js`
  Expected: PASS (cli's `byReason` counts for existing ids unchanged).

- [ ] **Step 5: Commit**

```bash
git add tools/guard-refusals/trace.js tests/guard-refusals/trace.test.js
git commit -m "Name nine more harness refusal clauses in guard-refusals — only other shrinks, refs #5587"
```

---

### Task 3: Guard of each row

**Review risk:** high (decision logic: ordered first-match gate classification of free deny text)

**Files:**
- Modify: `tools/guard-refusals/transcripts.js`
- Test: `tests/guard-refusals/transcripts.test.js` (append), Create: `tests/guard-refusals/gate-fragments.test.js`
- Modify: `tests/helpers/strip-comments.js` (header stem list), `.claude/skills/parse-signal-discipline/SKILL.md` (item 15 stem list) — add `gate-fragments` to both, alphabetically

**Interfaces:**
- Consumes: `ISOLATION_CLAUSE` (already required), `classifyReason` from `./trace`.
- Produces: `GATE_FRAGMENTS: Array<[gate: string, fragments: string[]]>` (exported, ordered); `classifyGuard(text: string) -> string|null` (exported; `'harness-command'`, `'harness-file'`, `'plugin:<gate>'`, `'plugin:other'`, or `null`); `scanStore(...)` returns, in addition to today's fields, `rows: Array<{ toolUseId, file, line, tool, guard, command, truncated, cwd, ts, runId, reason }>`. Each `refusals` entry gains `guard: 'harness-command'`, `cwd`, `ts`. `reason` is `classifyReason(...)` for `harness-command` rows, `null` otherwise.

Rules:
- `GATE_FRAGMENTS`, first match wins: `teardown` ["teardown gate", "is assigned to run"]; `worktree-always` ["this project requires an isolated worktree for"]; `lost-cwd` ["this command changes directory more ways than"]; `powershell-opaque` ["hands this guard literal (or base64) script text"]; `pipeline-shadow` ["a NEW pipeline run directory inside a", "the command has changed directory more ways than"]; `bookkeeping-stamps` ["resolves integration-model: pr-first and", "a materialize commit already landed in"]; `dispatch-config` ["has not written config.yml"]; `wd-enforcement` ["is active in worktree"]; `review-console-ask` ["which grants consoleAutoResolve"]; `dispatch-prompt` ["this Agent prompt names run"]. (`a materialize commit already landed in` is added beyond the spec's list: it is `checkBookkeepingStampsGate`'s other two deny texts, `pre-tool-use.js` lines 2179 and 2201, and live denials carry it; logged as a decision.)
- `classifyGuard`: ISOLATION_CLAUSE followed later by `Refusing to run` → `harness-command`; followed by `Edit the worktree copy of this file` → `harness-file`; text matching `/^(?:PreToolUse:[\w-]+ hook error: )?claude-tweaks[: ]/` → the first `GATE_FRAGMENTS` gate whose fragment it contains, else `plugin:other`; else `null`. A Bash result starting `Exit code N` never matches the plugin test.
- The walk records `{ tool, command, cwd: entry.cwd ?? null, ts: entry.timestamp ?? null, runId, file }` for every tool_use id (first occurrence), where `command` is `input.command` for Bash and Monitor, `input.file_path` (or `notebook_path`) for Write/Edit/NotebookEdit, else `''`. `calls` still counts Bash and Write ids only, and the existing `calls` map keeps its meaning. To bound memory, store `command` capped at `COMMAND_CAP` as today, and record `truncated: true` on the entry (and on its row) when the original string was longer than `COMMAND_CAP`, else `false`.
- Result text: a string `content` is used as is; an array `content` is the `text` of its `{ type: 'text' }` blocks joined with `'\n'` (plugin hook denials arrive in this shape, and the JSON-stringified form would put `[{"type":"text","text":"` before `claude-tweaks` and defeat the anchored plugin test); any other shape falls back to `JSON.stringify(content || '')` as today. Today's harness `refusals` detection reads this same text; its clause and tail contain no character JSON escapes, so the existing fixture counts do not move (AC7).
- The first `is_error` result per tool_use id whose `classifyGuard` is non-null is the row (today's `results` map keyed the same way). A result with no guard is not a row. A guarded result whose tool_use id has no recorded call (its call sits in a file outside the window) is not a row either — today's `if (!call) continue` rule, applied to `rows` too — so every row has a `tool` and a `command`. `refusals` is exactly the `harness-command` rows of a Bash or Write call — today's set, in today's order.

- [ ] **Step 1: Write the failing tests**

  In `transcripts.test.js`, a helper `writeStore(entries)` that writes hand-made JSONL lines into `<tmp>/-Users-me-guards/s1.jsonl`, stamps it with `STORE_MTIME`, and returns the projects dir. Each fixture pair is a tool_use line (`{ type:'assistant', timestamp, cwd:'/wt', message:{ content:[{ type:'tool_use', id, name, input }] } }`) and a tool_result line (`{ type:'user', message:{ content:[{ type:'tool_result', tool_use_id:id, is_error:true, content:text }] } }`).
  - `test('AC1: one refusal of each guard kind yields one guards count each and no row for printed skill text')` — fixtures: harness Bash (`'This session' + ISOLATION_CLAUSE + '/wt, but this command is too complex to verify that it stays inside the worktree. Refusing to run it.'`), harness Monitor (same text, `name:'Monitor'`, `input:{ command:'tail -f x' }`), harness Write (`… /wt. Edit the worktree copy of this file instead of the shared-checkout path.`), worktree-always (`'PreToolUse:Bash hook error: claude-tweaks: this project requires an isolated worktree for …'`), bookkeeping-stamps (`'PreToolUse:Write hook error: claude-tweaks: this project resolves integration-model: pr-first and …'`), teardown (`'claude-tweaks teardown gate: worktree /wt is still assigned …'`, `name:'ExitWorktree'`), and a Bash result `'Exit code 1\ncat: x: claude-tweaks: no such skill'`. Assert the tally of `scan.rows` by guard deep-equals `{ 'harness-command': 2, 'harness-file': 1, 'plugin:worktree-always': 1, 'plugin:bookkeeping-stamps': 1, 'plugin:teardown': 1 }`, that no row has the printed-text tool_use id, that `scan.refusals.length === 1` (the Bash one) and `scan.calls === 5` (Bash and Write ids only: three Bash — harness, worktree-always, printed — and two Write — harness-file, bookkeeping-stamps).
  - `test('classifyGuard: a claude-tweaks denial with no known fragment is plugin:other; a harness clause without a tail is no row')`.
  - `test('array-shaped tool_result content: a plugin denial and a harness refusal in text blocks are both rows')` — two fixtures whose result `content` is `[{ type:'text', text: <worktree-always denial> }]` and `[{ type:'text', text: <harness Bash refusal> }]`; assert their rows' guards are `plugin:worktree-always` and `harness-command`, and the harness one is in `scan.refusals`.
  - `test('a guarded result whose call is not in the store is no row')` — a harness Bash refusal tool_result with no matching tool_use line; assert `scan.rows` has no row with that id and `scan.refusals` none either.
  - `test('a command longer than COMMAND_CAP is stored cut and marked truncated')` — a harness Bash refusal whose command is `'ls ' + 'a'.repeat(20000) + '; rm x'`; assert the row's `truncated === true`, its stored command is 20000 chars and holds no `rm x`, and a short command's row has `truncated === false`.
  - `test('scanStore keeps the existing refusals list and adds guard, cwd and ts to each')` on `copyStore()`: `scan.refusals.length === 8`, every refusal has `guard === 'harness-command'`, and `scan.rows.filter(r => r.guard === 'harness-command' && (r.tool === 'Bash' || r.tool === 'Write')).length === 8`.

  In `gate-fragments.test.js` (follow `.claude/skills/bin-source-scan-conformance`): read `plugin/bin/lib/hooks/pre-tool-use.js` and `plugin/bin/lib/hooks/dispatch-prompt-gate.js` through `readText` (`tests/helpers/read-skill.js`), strip each with `stripComments` (keep-literals mode), assert `stripperVerdict(raw, stripped) === 'ok'` per file, and:
  - `test('AC2: every GATE_FRAGMENTS fragment occurs in the code of pre-tool-use.js or dispatch-prompt-gate.js')` — for each fragment, assert it occurs in one of the two stripped texts (comments blanked, so a fragment kept only in a comment fails).
  - `test('AC2 go-red: a fragment absent from both files is reported')` — run the same check function on `GATE_FRAGMENTS` plus `['x', ['no such deny text zz']]` and assert it returns that fragment as missing.
  - `test('AC2 go-red: a planted mis-parse is an offender')` — `stripperVerdict` on `"if (b) /'/.test(b); const c = 'x';"` with blank-mode stripping returns not `'ok'` and the check reports it.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/guard-refusals/transcripts.test.js tests/guard-refusals/gate-fragments.test.js`
  Expected: FAIL (`scan.rows` undefined; `GATE_FRAGMENTS` not exported).

- [ ] **Step 3: Implement** in `transcripts.js` per the rules above, updating its header comment (rows, guards, the fragment table, cwd/ts). Add `gate-fragments` to the two stem lists.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/guard-refusals/ tests/strip-comments-callers-twin.test.js`
  Expected: PASS. Every pre-existing transcripts/cli/trace expectation unchanged.

- [ ] **Step 5: Commit**

```bash
git add tools/guard-refusals/transcripts.js tests/guard-refusals/transcripts.test.js tests/guard-refusals/gate-fragments.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
git commit -m "Record which guard refused each call in guard-refusals — harness tails and plugin gate fragments, refs #5587"
```

---

### Task 4: Effect, read class and rewrite in the output, and docs

**Review risk:** high (decision logic: per-row effect, readClass and rewrite branch on computed row state)

**Files:**
- Modify: `tools/guard-refusals.js` (`summarize`, `renderTable`, header comment)
- Test: `tests/guard-refusals/cli.test.js`
- Modify: `docs/plugin-structure.md` (the `tools/guard-refusals.js` sentence in the `tools/` line)
- Modify: `docs/journeys/measure-worktree-guard-refusals-4028.md`

**Interfaces:**
- Consumes: `scan.rows`, `scan.refusals` (Task 3); `classifyEffect` (Task 1); `rewriteForGuard({ command, cwd, deps })` from `../plugin/bin/lib/hooks/guard-rewrite`.
- Produces: JSON keys, in order: `window, files, unreadable, calls, refusals, perPipeline, byReason, byShape, byFence, top, guards, byEffect, byReadClass, byRewrite, rows`.

Rules:
- Per row: `effect`/`why` — a Bash row with `truncated: true` is `{ effect:'unknown', why:'truncated' }` (its cut tail may hold a writer, so it is never `read`); other Bash rows `classifyEffect(command)`; Write/Edit/NotebookEdit rows `{ effect:'write', why:'file tool' }`; any other tool `{ effect:'unknown', why:'<tool> tool' }`.
- `readClass` — `harness-command` rows with `effect === 'read'`: `'other-checkout'` when `reason` is `git-redirect-shared`, `cd-shared` or `other-worktree-cwd`, else `'shape'`; every other row `null`.
- `rewrite` — `harness-command` Bash rows only: `null` when `cwd` is not a string; else `rewriteForGuard({ command, cwd, deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => p.replace(/\/+$/, '') || p } })`'s `applied`, or `[]` when it returns null. Other rows: `null`. (Probed: `ls /a\ b/c` at cwd `/wt` → `["quote-escaped-space"]`; `ls /a/b` → null → `[]`.)
- `guards` count per guard; `byEffect` `{ read, write, unknown }` over all rows; `byReadClass` `{ 'other-checkout', shape }`; `byRewrite` over harness-command Bash rows: one count per applied rule id, `unchanged` for `[]`, `no-cwd` for `null`. All via `sortedCounts`.
- `rows` — every row: `{ toolUseId, file, line, tool, guard, command, truncated, reason, effect, why, readClass, rewrite, runId, ts }`, `command` being the whole stored command (up to `COMMAND_CAP`), not cut further, so AC9's reader sees every word the classifier saw. `top` keeps its own present cut. Each `refusals` entry gains `guard, effect, why, readClass, rewrite, ts` (its existing fields unchanged).
- Text table gains, after "by fence (top 10)", a `by guard` block and a `by effect` block in the same `padStart(6)` format.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`:
  - Update only the `Object.keys(out)` assertion to the new key list (not an AC7-protected expectation).
  - `test('AC5: rewrite is the rule ids at HEAD for a row with a cwd, null without one, [] when nothing changes')` — a hand-made store (Task 3's `writeStore` pattern, local to this file) with three harness Bash refusals: `ls /a\ b/c` cwd `/wt`; the same command with no `cwd` field; `ls /a/b` cwd `/wt`. Assert the three rows' `rewrite` deep-equal `['quote-escaped-space']`, `null`, `[]`, and `byRewrite` deep-equals `{ 'no-cwd': 1, 'quote-escaped-space': 1, unchanged: 1 }` (sortedCounts order: ties by key).
  - `test('every row carries a guard and an effect, and the new blocks count them')` on that store plus one Write `harness-file` row and one plugin row: every `out.rows[i]` has a non-empty `guard` and an `effect` in `read|write|unknown`; `out.guards` sums to `out.rows.length`; `out.byEffect` sums to `out.rows.length`; `out.byReadClass` counts only harness-command read rows (`ls` rows are `shape`); the table text matches `/by guard\n/` and `/by effect\n/`.
  - `test('a truncated Bash row is unknown with why truncated, never read')` — a harness Bash refusal whose command is `'ls ' + 'a'.repeat(20000) + '; rm x'`; assert its row's `effect === 'unknown'`, `why === 'truncated'`, and `readClass === null`.
  - `test('AC7: the fixture store's existing counts are unchanged')` is the existing tests — do not edit them.

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/guard-refusals/cli.test.js`
  Expected: FAIL on the key list and the new tests.

- [ ] **Step 3: Implement** in `guard-refusals.js`; update its header comment's Output paragraph to describe `guards`, `byEffect`, `byReadClass`, `byRewrite`, `rows` and the per-row fields, and that `rewrite` means "the rules in this checkout change this text", never "the hook ran in that session". Update the `tools/guard-refusals.js` sentence in `docs/plugin-structure.md` and add a section to `docs/journeys/measure-worktree-guard-refusals-4028.md` naming the new fields and how to read them (no transcript content).

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/guard-refusals/`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tools/guard-refusals.js tests/guard-refusals/cli.test.js docs/plugin-structure.md docs/journeys/measure-worktree-guard-refusals-4028.md
git commit -m "Report effect, read class and rewriter verdict per row in guard-refusals — new guards and effect blocks, refs #5587"
```

---

### Task 5: Live measurement (AC8, AC9, AC10)

**Files:** none committed. Evidence goes to `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/51403a10-b269-495a-b726-0a91bb303e38/scratchpad/ac8-ac9-evidence.md` for the PR body.

- [ ] **Step 1: Run the 30-day window.** `node tools/guard-refusals.js --since-days 30 --json > "<scratchpad>/guard-refusals-30d.json"` with a 20-minute timeout. If it does not finish, run two disjoint 15-day windows (`--until <now-15d> --since-days 15` and `--since-days 15`) and sum `guards`, `byEffect`, `byReadClass`, `byRewrite` and the row counts; say which form ran.
- [ ] **Step 2: Check AC8.** From the JSON: share of `harness-command` rows with `reason === 'other'` ≤ 5%; share of `plugin:*` rows that are `plugin:other` ≤ 5%; every row has `guard` and `effect`. Record the numbers and the four blocks as printed. A threshold miss is a finding: name the largest uncovered clauses or texts (counts and reason wording only) and stop with it rather than editing patterns to fit.
- [ ] **Step 3: AC9 sample.** A scratch script (outside the repo) draws up to 100 `effect: 'read'` rows, stratified by first command word with at most 10 per word, using a seeded PRNG (state the seed). Read each row's whole `command` field (uncut in `rows`; a `truncated` row is never `read`, so none is sampled) and judge whether it can write. Record count read and count wrong. A wrong one: add it to Task 1's `TABLE` as `write` (or `unknown`), fix `effect.js`, re-run `node --test tests/guard-refusals/`, commit, re-run Step 1 and redraw.
- [ ] **Step 4: AC10.** Run `git diff --name-only origin/main...HEAD` and confirm no path starts with `plugin/`.
- [ ] **Step 5: Write the evidence file** with: the run form, built-tool per-row timing (effect and rewrite ms/row, from a scratch timing over 200 rows), the four blocks, the AC8 shares, the AC9 seed / read / wrong counts, and the AC10 result. No commands or paths from transcripts.
