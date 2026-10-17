# Worktree-guard refusal shapes addendum (#2776) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, in `scratch-worktree.md` §7, the live verdict for each refusal shape #2776 reported, so pipeline sessions stop rediscovering workarounds.

**Architecture:** Documentation only. One dated addendum paragraph plus bullets appended at the end of `## 7. Shell constraint`, in the file's established addendum style. Every verdict below was gathered live in this build's worktree session, one plain command per Bash call (macOS, zsh, Claude Code harness build current on 2026-10-16) — the addendum transcribes them; it adds nothing on the original report's word.

**Tech Stack:** Markdown; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T173115-spec-2702-2727-2776/spec-2776/work/2776-spec.md`

## Global Constraints

- No change to `plugin/bin/lib/hooks/pre-tool-use.js` or any file under `plugin/bin/lib/hooks/` (AC3).
- `plugin/skills/_shared/worktree-setup.md` must not change — it already points at §7 (line 10), and its composed bundle sits near its 46,080 B ceiling.
- `docs/hooks.md` and `docs/skill-authoring.md` are read-only for this record.
- Cite existing addenda (#1785, #1876) rather than restating their workarounds.

## Review Focus

- A reader taking the `.git/` entry as a guard refusal — the addendum must say it is a permission-rule denial (different message), settings-dependent.
- A reader concluding heredoc + `gh` is unsafe — the trigger is the runtime variable; literal paths pass.
- A reader treating the "did not reproduce" list as a retraction of earlier entries — keep the "last observed, not a guarantee" caveat.
- The `.github/`/`github.com` overlap with #1876's entry — state precisely what was and was not re-tested.
- `tests/scratch-worktree-remote-branch-delete.test.js` slices on the `## 7. Shell constraint` heading — appending below it must not disturb that slice.

---

### Task 1: Append the #2776 addendum to §7

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` (append after the final line, the `**2026-10-03 addendum (#2739, #2742):**` block's last bullet, currently line 275)
- Test: `tests/scratch-worktree-remote-branch-delete.test.js` (existing; run, not modified)

**Interfaces:**
- Consumes: none
- Produces: none (prose)

No new test: §7's prior addenda (#1108, #1651, #1876, #1785, #2739/#2742) shipped as prose with no pin, and the record's ACs are content checks verified by reading the file.

- [ ] **Step 1: Measure the baseline**

Run: `wc -c plugin/skills/_shared/scratch-worktree.md`
Expected: `28086`

- [ ] **Step 2: Append the addendum**

Append exactly this text after the last line of the file, separated by one blank line:

```markdown
**2026-10-16 addendum (#2776):** seven shapes from one external report (plugin 6.129.0, which attributed them to `pre-tool-use.js` — the refusal wording appears nowhere under `plugin/bin/`; it is this harness guard's), re-verified live in a worktree session one plain command per call (macOS, zsh). One reproduced, narrower than reported; one was a permission-rule denial, not this guard; five did **not** reproduce.

- Heredoc-written file plus `gh pr comment --body-file` in the same call — refused only when the path is a runtime variable: `cat > "$TMPDIR/x.md" <<'EOF' … EOF` followed by `gh pr comment N --body-file "$TMPDIR/x.md"` is refused ("runs gh with a value computed at runtime (the variable TMPDIR) inside a construct too complex to verify"). The same two commands with a literal path pass, and the variable-path `gh` call alone passes — the #1785 runtime-variable family above, not a heredoc or `gh` trigger. **Workaround:** a literal path, or the `Write` tool for the body followed by a plain `gh pr comment N --body-file /literal/path` call.
- A `.git/` read in a pipeline (`tail -n 4 .git/worktrees/<wt>/claude-tweaks-verify/tests.log | head -1`) — denied with different wording, "Permission to use Bash with command … has been denied": a permission rule, not this guard. Isolated live: a user-scope `Read(**/*.log)` deny rule matched the project-relative `.log` path (`tail -n 1 x.log` gets the same denial; a relative `.git/` path to a non-log file runs), so a session without such a rule will not see it. The relative path is wrong anyway — inside a linked worktree `.git` is a file, so `.git/worktrees/…` does not resolve. **Workaround:** the absolute per-worktree git dir (`git rev-parse --git-dir` prints it; `claude-tweaks-verify/` sits inside it), which ran unrefused, or the `Read` tool on that absolute path.
- Did not reproduce — each ran unrefused: a quoted `"git"` grep pattern in a 2-command chain (`grep -c "git" README.md && echo ok`); a `.github/` path segment in a 2-command chain (`sed -n '1,3p' .github/workflows/test.yml && echo done`); an `awk` program (`awk '{print $1}' file`); `bash ./helper.sh`; and the report's own `.g*t`/`.g*hub` glob workaround — unnecessary, since the bare forms pass (a shell-expanded path glob is not #1785's refused `find -iname` glob value). A bare `github.com` URL argument (`echo https://github.com/…`) also ran; #1876's refused form additionally carried a `"$RUN_DIR"` variable, so its trigger may have been that rather than the substring — not retracted here. Same "last observed, not a guarantee" caveat as the entries above.
```

- [ ] **Step 3: Verify placement and content**

Run: `grep -n "2026-10-16 addendum (#2776)" plugin/skills/_shared/scratch-worktree.md`
Expected: exactly one match, on a line after the `**2026-10-03 addendum (#2739, #2742):**` line.

Run: `wc -c plugin/skills/_shared/scratch-worktree.md`
Expected: roughly 30,900 B — well under the 45 KB per-file ceiling; no composed bundle includes this file (`grep -rln "compose-context.*scratch-worktree" plugin tests` is empty).

- [ ] **Step 4: Run the neighboring suite**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Confirm no hook code changed**

Run: `git diff --name-only HEAD -- plugin/bin/lib/hooks plugin/skills/_shared/worktree-setup.md`
Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/scratch-worktree.md
git commit -m "Document #2776's worktree-guard shapes — one reproduced narrower, one a permission rule, five not reproduced (refs #2776)"
```
