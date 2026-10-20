# /feedback Bash-refusal attribution check (#3338) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before `/claude-tweaks:feedback` names a plugin hook (e.g. `bin/lib/hooks/pre-tool-use.js`) as the affected component for a Bash refusal, it greps the quoted refusal text under the plugin's `bin/`. With no match, it attributes the refusal to the Claude Code harness worktree guard and routes it as a `_shared/scratch-worktree.md` §7 addendum candidate.

**Architecture:** A prose-only change. One new paragraph goes into `plugin/skills/feedback/SKILL.md`'s `### Step 1: Gather`, where every filing path (free-text, queue, session-evaluation) settles the affected component. One pointer clause goes into `plugin/skills/feedback/bare-invocation.md`'s Merging paragraph, where the batch derives its component, so that path applies the same check. A new conformance test pins both.

**Tech Stack:** Markdown skill prose; `node --test` conformance test (built-in `node:test`, `node:assert`, `fs`).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T220331-record-3338/work/3338-spec.md` (materialized from GitHub issue #3338)

## Global Constraints

- Cite `docs/skill-authoring.md`'s section "Harness-level worktree Bash guard vs. the plugin's PreToolUse gate" rather than restating its rule.
- Positive signal for a plugin-hook attribution: the plugin's own deny prefixes `claude-tweaks: this project requires an isolated worktree…` and `claude-tweaks working-directory discipline: …`.
- No match routes to `_shared/scratch-worktree.md` §7 ("## 7. Shell constraint") as a documentation finding, never as a hook defect.
- No new Anti-Patterns row (`tests/bin-lib/skill-audit/anti-patterns.test.js` pins a repo-wide count).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #3338` (never closes/fixes), plus the trailer `Claude-Session: https://claude.ai/code/session_014jZCLvzHYqSD85nVGenWvD`.

## Review Focus

- The refusal frame `This session is isolated in the worktree … Refusing to run it` DOES match under `plugin/bin/`. `post-tool-use-failure.js`'s `HARNESS_ISOLATION_REFUSAL_RE` and `bash-prefilter.js`'s `REFUSAL_SIGNATURE` recognize the harness text; they do not emit it. Grepping the frame would therefore misattribute the refusal to the plugin. The prose must say to grep the distinctive reason clause (e.g. `too complex to verify`), not the frame. Task 1's test pins this caveat.
- A grep fragment that contains the substring `git` (e.g. `names git in a form too complex`) is itself refused by the harness guard inside a worktree session. The prose must say to pick a fragment without that substring. Task 1's test pins this.
- A `Permission to use Bash … has been denied` refusal is a permission rule, neither the plugin nor the harness guard. It won't match under `bin/` either, so it must not default to the harness. A cited pointer to the skill-authoring section covers it, and the test pins the `Permission to use Bash` mention.
- Consumer projects have no `plugin/` directory, so the search root there must be the installed build's `${CLAUDE_PLUGIN_ROOT}/bin/`. Pinned.

---

### Task 1: Attribution check in /feedback Step 1 + bare-invocation pointer

**Files:**
- Create: `tests/feedback-harness-refusal-attribution-conformance.test.js`
- Modify: `plugin/skills/feedback/SKILL.md` (Step 1: Gather — append one paragraph after the existing Definition paragraph and before the "preserved unfiled draft" paragraph)
- Modify: `plugin/skills/feedback/bare-invocation.md` (Merging paragraph — the clause "deriving the affected component from the skill, contract, or CLI the evidence names, falling back to "unclear / general" per Step 1")

**Interfaces:**
- Consumes: nothing.
- Produces: a bold-lead paragraph in SKILL.md Step 1 titled `**Bash-refusal attribution (#3338).**`; the bare-invocation pointer names "Step 1's Bash-refusal attribution check".

- [ ] **Step 1: Write the failing test** `tests/feedback-harness-refusal-attribution-conformance.test.js`, in the neighbor `tests/feedback-dedup-search-scrub-conformance.test.js` style. Slice SKILL.md from `### Step 1: Gather` to `### Step 2` (`step1`), and read `bare-invocation.md` (`bare`). Tests:
  - `Step 1 greps the quoted refusal under the plugin's bin/ before naming a plugin hook`: `/Bash-refusal attribution/.test(step1)`, `step1.includes('${CLAUDE_PLUGIN_ROOT}/bin/')`, `/plugin\/bin\//.test(step1)`, `/pre-tool-use\.js/.test(step1)`
  - `No match attributes to the harness guard and routes to scratch-worktree §7, never a hook defect`: `/harness/i.test(step1)`, `step1.includes('_shared/scratch-worktree.md')`, `/§7|## 7\. Shell constraint/.test(step1)`, `/never[^.]*hook defect/i.test(step1)`
  - `The plugin's claude-tweaks-prefixed deny is the positive signal, citing skill-authoring rather than restating`: `step1.includes('claude-tweaks: this project requires an isolated worktree')`, `step1.includes('claude-tweaks working-directory discipline')`, `step1.includes("docs/skill-authoring.md")`, `step1.includes('Harness-level worktree Bash guard vs. the plugin')`
  - `Greps the reason clause, not the frame the plugin's own hooks recognize`: `step1.includes('Refusing to run it')`, `/reason clause/i.test(step1)`, `/post-tool-use-failure/.test(step1)`
  - `Warns that a fragment containing git trips the guard itself`: `/substring `git`|containing `git`/i.test(step1)`
  - `Permission-rule denials are not defaulted to the harness`: `step1.includes('Permission to use Bash')`
  - `bare-invocation's batch component derivation applies Step 1's check`: `/Step 1's Bash-refusal attribution check/.test(bare)`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/feedback-harness-refusal-attribution-conformance.test.js`
Expected: FAIL. Every test fails, because no such prose exists yet.

- [ ] **Step 3: Add the SKILL.md Step 1 paragraph and the bare-invocation pointer**

SKILL.md paragraph content, in order:
1. When the learning's evidence quotes a refused Bash call and the candidate affected component is `bin/lib/hooks/pre-tool-use.js` or any other plugin hook, first grep the quoted text under the plugin's own `bin/`: `"${CLAUDE_PLUGIN_ROOT}/bin/"` (this repo's `plugin/bin/`; the installed build's in a consumer project), e.g. `grep -rnF -- '{fragment}' "${CLAUDE_PLUGIN_ROOT}/bin/"`.
2. Grep the refusal's distinctive reason clause (`too complex to verify`, `computed at runtime`), never the surrounding `This session is isolated in the worktree … Refusing to run it` frame. The plugin's `post-tool-use-failure`/`bash-prefilter` hooks quote that frame to recognize harness refusals, so it matches without the plugin having emitted it. Pick a fragment without the substring `git`, since the guard refuses that grep itself inside a worktree session.
3. Match on a `claude-tweaks:`-prefixed deny (`claude-tweaks: this project requires an isolated worktree…`, `claude-tweaks working-directory discipline: …`) → the plugin-hook attribution stands. Cite `docs/skill-authoring.md`'s "Harness-level worktree Bash guard vs. the plugin's PreToolUse gate" section for telling the two apart.
4. No match → the affected component is the Claude Code harness worktree guard. Route it as a `_shared/scratch-worktree.md` §7 ("## 7. Shell constraint") addendum candidate (a documentation finding), never as a hook defect. Exception: `Permission to use Bash … has been denied` is a permission rule, per that same section.

bare-invocation.md: change the clause to `… falling back to "unclear / general" per Step 1, and applying Step 1's Bash-refusal attribution check …`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/feedback-harness-refusal-attribution-conformance.test.js tests/feedback-dedup-search-scrub-conformance.test.js tests/feedback-next-actions-plain-markdown-conformance.test.js tests/feedback-upstream-draft-conformance.test.js tests/feedback-watermark-prose.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/feedback-harness-refusal-attribution-conformance.test.js plugin/skills/feedback/SKILL.md plugin/skills/feedback/bare-invocation.md
git commit -m "Check quoted Bash refusals against plugin/bin in /feedback — attribute unmatched ones to the harness guard, refs #3338"
```
(plus the `Claude-Session:` trailer line from Global Constraints)

---

## Self-review

- **Spec coverage:** Deliverable 1 (grep before naming a hook; no match → harness + §7, documentation finding) → Step 3 items 1, 2, 4. Deliverable 2 (deny prefixes as the positive signal, cite skill-authoring) → item 3. AC1/AC2 → item 3/4 prose, pinned by tests 2–3. AC3 (conformance test) → Step 1.
- **Placeholders:** none.
