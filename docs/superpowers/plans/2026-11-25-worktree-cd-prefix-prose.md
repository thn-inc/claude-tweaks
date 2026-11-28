# Drop `cd "…" &&` instructions from skill prose (#4442) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `plugin/skills/**/*.md` instruction tells an agent to prefix a command with `cd "<path>" &&`; a conformance test keeps it that way.

**Architecture:** Prose alignment to the existing canonical rule in `plugin/skills/_shared/subagent-dispatch-core.md`'s Working Directory Discipline (`git -C "<abs path>"`, absolute path arguments, one plain command per Bash call). Each site is rewritten to the argument-anchored form; a new `node --test` suite walks `plugin/skills/**/*.md` with a regex and fails on any `cd "…" &&` outside an explicit counter-example allowlist.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-11-25T083624-record-4442/work/4442-spec.md`

## Global Constraints

- Cite `_shared/subagent-dispatch-core.md`'s Working Directory Discipline rather than restating a second copy of the rule (spec Technical Approach).
- `plugin/skills/tidy/scan-procedures.md` is 52,450 B against the 52,500 B Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`): its edits must leave the file **at or below 52,450 B** (`wc -c`). No other edited file is within 10% of the rail (qa-prompts 22,084; issue-claims-backstops 12,802; judge-procedure 29,549).
- Commit messages: `{Verb} {what} — {detail}` style, `refs #4442` (never `closes`/`fixes`).

## Review Focus

1. A rewritten `find` under `{RUN_ROOT}` must still print paths the loop body can open — `find "{RUN_ROOT}/.claude-tweaks/pipelines" …` yields absolute paths, which `grep`/`wc` in the loop body accept as-is.
2. The QA agent's trace relocation reads `.playwright-cli/traces/` relative to its cwd (`plugin/agents/qa-agent.md` Section 6): the rewritten prompt must make the agent confirm its cwd is `{ABSOLUTE_WORKTREE_PATH}` (a `pwd` call), not silently drop the anchoring.
3. `gh issue list` infers its repo from cwd; without the `cd` it needs `--repo {owner}/{repo}` (the placeholder `scan-procedures.md:133` already uses).
4. `tests/skill-fence-guard-shapes.test.js:178`'s ratchet entry is keyed on the content anchor `cd "{RUN_ROOT}" && find .claude-tweaks/pipelines -path "*/work/*-spec.md" 2>/dev/null | wh` — once that fence line changes, the entry goes stale ("remove this entry") unless re-anchored to the new first line, while the fence still offends `gh-computed-input`.
5. `$(cd "$RUN_ROOT" && pwd -P)` in `_shared/run-dir-resolution.md` is a path-canonicalization subshell, not a command prefix; the test regex must not flag it.

---

### Task 1: Rewrite every `cd "…" &&` instruction and pin it with a conformance test

**Files:**
- Test: `tests/no-cd-prefix-instruction-conformance.test.js` (create)
- Modify: `plugin/skills/test/qa-prompts.md:98` and `:162` (both "**Working directory:**" lines)
- Modify: `plugin/skills/tidy/scan-procedures.md:91` (drop "(or run after `cd "{REPO_ROOT}"`)"), `:197` (the `{REPO_ROOT}` bullet's `gh` clause) and `:201` (the "Anchor with …" sentence)
- Modify: `plugin/skills/tidy/issue-claims-backstops.md:104`, `:129`, `:151`, `:176` (fence first lines)
- Modify: `plugin/skills/harness-health/judge-procedure.md:50`
- Modify: `tests/skill-fence-guard-shapes.test.js:178` (re-anchor the ratchet entry)
- Waived `plugin/skills/build/SKILL.md`: deliverable 1 already landed on base — Common Step 2's note reads "require `git -C "{worktree}" …` and absolute paths, one plain command per Bash call — never a `cd … &&` chain"; verified by the grep in Step 2 below, used as the revert target in Step 6.
- Waived `plugin/skills/_shared/subagent-dispatch-core.md`: reference only (canonical rule).

- [ ] **Step 1: Write the failing test** `tests/no-cd-prefix-instruction-conformance.test.js`

  Live-corpus read (a convention over every future addition). Walk `plugin/skills/**/*.md` (recursive `fs.readdirSync`, files read via `tests/helpers/read-skill`'s `readText`). Pattern, applied per line:
  `const CD_PREFIX = /(?<!\$\()\bcd\s+"[^"\n]*"\s*&&/g;`
  Allowlist (counter-examples labelled as forbidden, or guard-behavior documentation), keyed by `{ file, anchor }` where `anchor` is a substring of the matching line:
  - `_shared/subagent-dispatch-core.md` — `never \`cd "..." && git ...\``
  - `_shared/subagent-dispatch-core.md` — `a \`cd "<dir>" && <command>\` shape`
  - `_shared/scratch-worktree.md` — `\`cd "<wt>" && pwd && pwd\``
  - `_shared/scratch-worktree.md` — `\`cd "<main checkout>" && git log --oneline -1\``
  - `_shared/scratch-worktree.md` — `\`cd "<wt>" && cat > f <<'EOF'\``
  Tests (cite AC ids in names):
  - `AC1.1: no plugin/skills markdown instructs a cd "…" && prefix` — offenders (hits no allowlist entry covers) deep-equal `[]`; message lists `file:line text`.
  - `allowlist entries each match exactly one live line` — an entry matching zero lines fails with "remove this entry".
  - `AC2.1 go-red: a restored build/SKILL.md cd "$WORKTREE" && sentence is flagged` — run the same scan function over a temp dir holding one `.md` with the pre-fix sentence ``require them to use `cd "$WORKTREE" && …` or `git -C "$WORKTREE" …` `` and assert one offender.
  - `canonicalization subshell is not flagged` — temp `.md` containing `RUN_ROOT=$(cd "$RUN_ROOT" && pwd -P)` yields zero offenders.
  - Floor: the walk reads at least 100 `.md` files (a broken walk must not pass vacuously).
  Export nothing; keep the scan function parameterized by root so the go-red controls reuse it.

- [ ] **Step 2: Run it to verify it fails, and confirm deliverable 1 is on base**

  Run: `node --test tests/no-cd-prefix-instruction-conformance.test.js`
  Expected: FAIL — AC1.1 lists 9 offenders: `harness-health/judge-procedure.md:50`, `test/qa-prompts.md:98`, `:162`, `tidy/issue-claims-backstops.md:104`, `:129`, `:151`, `:176`, `tidy/scan-procedures.md:201` (two matches on that line). The other tests pass.
  Run: `git grep -n -F 'cd "$WORKTREE" &&' -- plugin/skills/build/SKILL.md`
  Expected: no output (exit 1).

- [ ] **Step 3: Rewrite the sites**

  - `qa-prompts.md:98` and `:162` (identical text in both templates — each template is copied whole into the agent prompt, so restate, do not cite a sibling file): replace with
    `**Working directory:** {ABSOLUTE_WORKTREE_PATH}. Run one plain command per Bash call, never a \`cd … &&\` prefix: give every file argument (screenshots, traces) as an absolute path under {ABSOLUTE_WORKTREE_PATH}, and use \`git -C "{ABSOLUTE_WORKTREE_PATH}"\` for git. First run \`pwd\` on its own: \`playwright-cli\` writes traces to \`.playwright-cli/traces/\` under the cwd, so a cwd other than {ABSOLUTE_WORKTREE_PATH} is \`BLOCKED\`.`
  - `scan-procedures.md:91`: delete ` (or run after \`cd "{REPO_ROOT}"\`)`.
  - `scan-procedures.md:197` bullet: the claim-ref listing takes `git -C "{REPO_ROOT}"`; the `gh issue list` backstop takes `--repo {owner}/{repo}` (replace the "`gh` infers the target repo from the cwd's git remote…" sentence).
  - `scan-procedures.md:201`: replace the "Anchor with `cd "{REPO_ROOT}" &&` / `cd "{RUN_ROOT}" &&` at the start of each command." sentence with one that passes each anchor as the command's own argument — `git -C "{REPO_ROOT}"`, `gh … --repo {owner}/{repo}`, `find "{RUN_ROOT}/.claude-tweaks/pipelines" …` — never a `cd` prefix (`_shared/subagent-dispatch-core.md`'s Working Directory Discipline). Keep the loud-failure rationale sentences that follow unchanged.
  - `issue-claims-backstops.md`: `:104` → `find "{RUN_ROOT}/.claude-tweaks/pipelines" -path "*/work/*-spec.md" 2>/dev/null | while read -r header; do`; `:129` → `gh issue list --repo {owner}/{repo} --label bot:in-progress --state open --json number,title -q '.[] | "\(.number) \(.title)"'`; `:151` → `find "{RUN_ROOT}/.claude-tweaks/pipelines" -maxdepth 1 -type d -name "*-standalone" 2>/dev/null | while read -r RUN_DIR; do`; `:176` → `find "{RUN_ROOT}/.claude-tweaks/pipelines" -path "*/staged/upstream-unfiled-*.md" 2>/dev/null`.
  - `judge-procedure.md:50` → `node "{plugin-root}/bin/resolve-policy.js" harness-health-always-loaded-budget harness-health-scoped-rule-budget` as its own line (the resolver reads the project from the cwd's checkout, which is `{root}` or a linked worktree of it).
  - `tests/skill-fence-guard-shapes.test.js:178`: change the anchor to `find "{RUN_ROOT}/.claude-tweaks/pipelines" -path "*/work/*-spec.md" 2>/dev/null | wh` (same file, same detector `gh-computed-input`).

- [ ] **Step 4: Run the tests to verify they pass, and the byte budget**

  Run: `node --test tests/no-cd-prefix-instruction-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/subagent-contract-clauses.test.js tests/review-dispatch-composition.test.js`
  Expected: PASS, 0 failures (AC3.1).
  Run: `wc -c plugin/skills/tidy/scan-procedures.md`
  Expected: ≤ 52450.
  Run: `git grep -n -E 'cd "\$WORKTREE" &&|cd "\{ABSOLUTE_WORKTREE_PATH\}" &&|cd "\{REPO_ROOT\}" &&|cd "\{RUN_ROOT\}" &&' -- plugin/skills`
  Expected: no output (AC1.1).

- [ ] **Step 5: Commit**

  `git -C "<worktree>" add` the six modified files and the new test by explicit path; message `Replace cd-prefix instructions with argument-anchored commands — QA prompt, tidy, harness-health; pin with a conformance test (refs #4442)`.

- [ ] **Step 6: Revert proof (AC2.1)**

  Restore the pre-fix `build/SKILL.md` sentence in a scratch copy (never a linked worktree): copy `plugin/skills` to a temp dir, append the old sentence ``When dispatching subagents, require them to use `cd "$WORKTREE" && …` or `git -C "$WORKTREE" …`.`` to the copy's `build/SKILL.md`, and run the test's scan over it — the go-red test in Step 1 already does this over a minimal temp tree; report its PASS line as the proof. Quote raw output.

---

## Self-review

- **Spec coverage:** D1 — already on base (Waived line, Step 2 grep). D2 — qa-prompts both lines. D3 — scan-procedures :91 and :201 (plus the :197 `gh` clause the rewrite depends on). D4 — conformance test with the shared-core allowlist. Scope additions under `scope-creep: add-to-plan`: `issue-claims-backstops.md` (the AC1 grep matches it) and `harness-health/judge-procedure.md` (the D4 test flags it). AC1 → Step 4 grep + AC1.1 test; AC2 → go-red test + Step 6; AC3 → Step 4 run.
- **Placeholders:** none.
- **Proportion:** one task, ten sites, one new test file.
