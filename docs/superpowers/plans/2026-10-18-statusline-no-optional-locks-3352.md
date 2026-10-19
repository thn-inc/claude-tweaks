# Statusline lock-free git status (#3352) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the statusline's per-render `git status` from rewriting `.git/index` under `index.lock`, so the session's own `git add`/`commit`/`merge` no longer fail with `index.lock: File exists`.

**Architecture:** `renderGit` keeps its single `execSync` call and its parsing; only the command string gains the top-level `--no-optional-locks` option. A real-git test pins the behaviour (index untouched on a stale-stat repo), the same temp-repo pattern the file's existing `renderGit` test uses — no new seam.

**Tech Stack:** Node 18+, `node:test`, `node:assert`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-18T193619-spec-3352-3464/spec-3352/work/3352-spec.md`

## Global Constraints

- Touch only `plugin/bin/claude-tweaks-statusline.js` and `tests/statusline.test.js`.
- `--no-optional-locks` is a top-level git option — it goes before `status`: `git --no-optional-locks status --porcelain -b`.
- `parseStatusBranch` and every other line of `renderGit` stay unchanged.
- Never `git stash`; run the focused test in the foreground, output redirected to a `.txt` file under `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad`; the caller runs `npm test` centrally afterwards.
- Commit references the record with `refs #3352`, never a closing keyword.

## Review Focus

- A repo whose tracked file has a stale stat (mtime changed, content unchanged) — the exact case where plain `git status` rewrites the index; covered by Task 1's behaviour test.
- A dirty repo still renders the dirty dot (`{branch}●` under `NO_COLOR=1`) — covered by Task 1's dirty assertion.
- Flag placed after the subcommand (`git status --no-optional-locks`) makes git exit non-zero, and `renderGit` would silently return `null` — the clean-branch assertion in Task 1 catches this (it expects the branch name, not `null`).
- Detached HEAD / no-commits rendering — unchanged parsing, already pinned by the existing `parseStatusBranch` tests (lines 46-67); no new test.
- Windows: `windowsHide: true` and the string-command form are unchanged; no new test.

---

### Task 1: Lock-free `renderGit` status call

**Files:**
- Modify: `plugin/bin/claude-tweaks-statusline.js:204`
- Test: `tests/statusline.test.js` (insert after the existing `renderGit: uses the passed cwd rather than the process-wide cwd` test, ending at line 96)

**Interfaces:**
- Consumes: `sl.renderGit(cwd: string) => string | null` (existing export); `NO_COLOR=1` makes `color.yellow(s)` return `s` unchanged (`plugin/bin/lib/color.js`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** (AC1, AC2)

Add two tests reusing the existing test's temp-repo setup (`fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-'))`, `git init -q -b main`, `user.email`/`user.name` config, commit `file.txt`, `NO_COLOR=1` set and restored in `finally`, `fs.rmSync` cleanup):

1. `renderGit: does not rewrite the index on a stale-stat repo (AC1 — --no-optional-locks)`
   - After the commit, `fs.utimesSync(path.join(repoDir, 'file.txt'), new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'))`.
   - `const indexPath = path.join(repoDir, '.git', 'index'); const before = fs.readFileSync(indexPath); const beforeMtime = fs.statSync(indexPath).mtimeMs;`
   - `assert.strictEqual(sl.renderGit(repoDir), 'main');` (AC2 clean case — also catches a misplaced flag returning `null`)
   - `assert.ok(fs.readFileSync(indexPath).equals(before), 'renderGit rewrote .git/index');`
   - `assert.strictEqual(fs.statSync(indexPath).mtimeMs, beforeMtime);`
2. `renderGit: dirty repo renders the dirty dot (AC2)`
   - After the commit, `fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'x\n');`
   - `assert.strictEqual(sl.renderGit(repoDir), 'main●');`

- [ ] **Step 2: Run tests to verify the AC1 test fails**

Run: `node --test tests/statusline.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/statusline-3352-red.txt 2>&1; echo "exit=$?"`
Expected: FAIL — `renderGit: does not rewrite the index on a stale-stat repo` fails with `renderGit rewrote .git/index`; the dirty-dot test passes (behaviour already correct).

- [ ] **Step 3: Implement** — in `renderGit` change the `execSync` command string to `'git --no-optional-locks status --porcelain -b'`. Extend the comment above `parseStatusBranch` (line ~181) by one sentence: `--no-optional-locks` keeps this read-only probe from rewriting the index under `index.lock`, which otherwise races the session's own `git add`/`commit`.

- [ ] **Step 4: Run tests to verify they pass** (AC1, AC2)

Run: `node --test tests/statusline.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/statusline-3352-green.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`, `# fail 0`.

- [ ] **Step 5: Commit** (AC3 is verified centrally by the caller's `npm test`)

```bash
git add plugin/bin/claude-tweaks-statusline.js tests/statusline.test.js
git commit -m "Make statusline git status lock-free — --no-optional-locks stops renderGit rewriting index.lock (refs #3352)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
```
