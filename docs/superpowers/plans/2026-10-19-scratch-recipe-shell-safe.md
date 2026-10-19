# Shell-Shape-Safe Scratch Recipe (#3519) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop telling worktree-isolated dispatched agents to write scratch probes with a heredoc or a `mkdir -p … &&` chain. The harness Bash guard refuses both by shape.

**Architecture:** Replace the recipe wording at every site that states it with one canonical sentence fragment, and pin that fragment (plus the absence of the old `redirect/heredoc` wording) in the existing subagent-contract conformance suite.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T035154-record-3519/work/3519-spec.md` (materialized from GitHub issue #3519)

## Global Constraints

- Recipe shape (from the spec): `mkdir -p` as its own Bash call, the file written by one plain `node -e` or `printf` redirect call (no heredoc, no `&&`), and `rm` as its own call.
- Canonical fragment (byte-identical at every site; the test pins this exact string):
  `via Bash, one plain command per call — \`mkdir -p\` as its own call, the file written by one plain \`printf\` redirect or \`node -e\` call, \`rm\` as its own call; never a heredoc or an \`&&\` chain, which the harness Bash guard refuses by shape`
- Byte headroom against the shared 51,200-byte ceiling (no file-specific pin found: `git grep -n -e byteLength -e CEILING -- tests | grep -i -e lens-dispatch -e debate -e subagent-output` → no hits). `step3-lens-dispatch.md` is 47,193 bytes (about 4.0 KB headroom), `step3-debate-and-refutation.md` 21,199, and `subagent-output-contract.md` 28,795. Each edit grows its sentence by under 200 bytes.

## Scope (sole-site sweep)

`git grep -n -i -e "redirect/heredoc" -e "redirect or heredoc" -e "heredoc, then" -- plugin docs tests` turns up **four** recipe sites:

1. `plugin/skills/_shared/subagent-output-contract.md:39`, the Scratch rule (named in the spec)
2. `plugin/skills/review/step3-lens-dispatch.md:82`, the Scratch path paragraph (named in the spec at line 80; it has since moved to 82)
3. `plugin/skills/review/step3-debate-and-refutation.md:98`, the refutation-agent template's `SCRATCH:` line
4. `plugin/skills/review/step3-debate-and-refutation.md:135`, the gap-sweep template's `SCRATCH:` line

The spec names only sites 1 and 2, but 3 and 4 are the dispatch-prompt text that review agents actually receive, which is the failure the spec observed (run 2026-10-17T214422-record-3020). Leaving them unfixed would keep the defect alive, so the `scope-creep: add-to-plan` policy adds them.

The fifth hit, `tests/auto-decision-log-worktree-gate.test.js:52`, is a code comment and not a recipe. Out of scope.

Existing pins near these sentences (moved-prose check): `tests/multi-agent-coordination.test.js:1202-1220` needs `Scratch rule` within 400 chars after `SCRATCH: {ctx-dir}/agent-scratch/{agent-id}` in `step3-lens-dispatch.md`. That citation comes before the reworded clause and is untouched. Lines 1260-1295 pin only the `SCRATCH:` line heads in the two templates, which are also untouched. No test pins the `redirect/heredoc` wording.

Prohibition-vs-mandate check: `git grep -n -i heredoc -- plugin/skills/review plugin/skills/_shared/subagent-output-contract.md plugin/skills/_shared/subagent-dispatch-core.md` finds no other instruction telling a dispatched agent to use a heredoc for scratch writes.

## Review Focus

- A recipe site added later that copies the old wording. The negative assertion covers the three files, not the whole corpus; the sweep above is what establishes there are four sites today.
- The canonical fragment drifting between sites (for example, one site reworded). The per-file occurrence counts catch it.
- `step3-lens-dispatch.md`'s `Scratch rule` citation sliding out of the 400-char window. It sits before the edited clause, so it can't move.

---

### Task 1: Reword the four scratch-recipe sites and pin them

**Files:**
- Modify: `plugin/skills/_shared/subagent-output-contract.md:39`
- Modify: `plugin/skills/review/step3-lens-dispatch.md:82`
- Modify: `plugin/skills/review/step3-debate-and-refutation.md:98,135`
- Test: `tests/subagent-contract-clauses.test.js`

**Interfaces:**
- Produces: `assertShellSafeScratchRecipe(text, label, expectedCount)` in the test file, the single assertion function that both the positive tests and the go-red control call.

- [ ] **Step 1: Write the failing test.** Append to `tests/subagent-contract-clauses.test.js`:
  - `const SHELL_SAFE_RECIPE` set to the canonical fragment from Global Constraints, as a literal string.
  - `function assertShellSafeScratchRecipe(text, label, expectedCount)`, which asserts:
    - `text.split(SHELL_SAFE_RECIPE).length - 1 === expectedCount`
    - `assert.doesNotMatch(text, /redirect\/heredoc/)`
    - `assert.doesNotMatch(text, /`mkdir -p` \+ a/)`
  - Test `'scratch-write recipe is shell-shape-safe at every site (#3519)'`, which reads the three files (contract via `FILES[...]`; the two review files via `readText(path.join(ROOT, 'plugin', 'skills', 'review', ...))`) and calls the function with counts 1, 1, and 2.
  - Test `'go-red control: the pre-#3519 recipe wording fails the shell-safe assertion (#3519)'`, which runs `assert.throws(() => assertShellSafeScratchRecipe(OLD, 'frozen pre-#3519 excerpt', 1))` against a frozen literal `OLD` = ``create and delete the file via Bash (`mkdir -p` + a shell redirect/heredoc, then `rm`), never the `Write`/`Edit` tools.``

- [ ] **Step 2: Run it and confirm it fails.**
  Run: `node --test tests/subagent-contract-clauses.test.js`
  Expected: FAIL. The new site test fails (count 0, and `redirect/heredoc` is present). The control passes.

- [ ] **Step 3: Implement.** At each site, replace the parenthetical `via Bash (`mkdir -p` + a [shell ]redirect/heredoc, then `rm`)` with the canonical fragment, keeping each sentence's surrounding grammar:
  - contract:39 → `create and delete the file {fragment} (`_shared/scratch-worktree.md` §7) — and never the `Write`/`Edit` tools.`
  - lens-dispatch:82 → `instruct the agent inline to create and delete that file {fragment}, never `Write`/`Edit`**`
  - debate:98 and debate:135 → `create and delete it {fragment} — never `Write`/`Edit`, which …` (rest unchanged)

- [ ] **Step 4: Run it and confirm it passes.**
  Run: `node --test tests/subagent-contract-clauses.test.js tests/multi-agent-coordination.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit.**
  ```bash
  git add plugin/skills/_shared/subagent-output-contract.md plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-debate-and-refutation.md tests/subagent-contract-clauses.test.js
  git commit -m "Reword scratch-write recipe to shell-shape-safe calls — refs #3519"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 3 (four sites; the spec's two plus the two dispatch templates). Deliverable 2 and AC2 are Steps 1 and 2 plus the go-red control. AC1 is the `redirect/heredoc` negative assertion; the only remaining `heredoc` token is the prohibition "never a heredoc", not a recommendation. AC3 (`npm test`) runs in Common Step 5.
- **Placeholders:** none.
