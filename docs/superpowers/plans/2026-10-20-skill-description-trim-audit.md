# Skill Description Trim Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit every shipped skill description (and the one agent definition) against the newer-model "shrink descriptions, stop pre-reading doc stacks" guidance, apply only the clear-cut trims, and record per-skill findings in a linked reference doc.

**Architecture:** Two tasks. Task 1 edits 11 `description:` frontmatter lines, removing only clauses that are body content (procedure summaries, restatements) or restated skill-graph edges (`docs/skill-graph.md` is their single home per CLAUDE.md's Cross-references rule). Task 2 writes `docs/reference/skill-description-audit.md` with the measurements and a per-skill verdict table, and adds a pointer plus one convention clause to `docs/skill-authoring.md`.

**Tech Stack:** Markdown, YAML frontmatter, `node` one-liners over `plugin/bin/lib/skill-audit/context-cost.js` (`measureDescriptions(root)` returns `[{name, description, chars}]`; `root` is the `plugin/` directory).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T211218-record-2799/work/2799-spec.md`

## Global Constraints

- Preserve every `Keywords - …` token byte-for-byte (`docs/skill-authoring.md` Frontmatter conventions; #394 had to restore dropped tokens in `a7af7690c`).
- No new numeric size constant or size comparison under `tests/` or `plugin/bin/` — `tests/skill-size-single-source.test.js` fails on one (decision 0024). No new test file: the existing `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js` already guards descriptions.
- A description containing a whitespace-preceded `#` must be double-quoted (#393, `findDescriptionHashHazards`). None of the target strings below contain `#` or `: `, so they stay plain scalars.
- Do not touch any description marked keep or needs-human-judgment in the verdict table.
- Commits use `{Verb} {what} — {detail}` style and `refs #2799` (never `closes`/`fixes`).

## Review Focus

1. A trimmed clause that was the only thing separating a skill from a near-identical name (built-in `simplify`, `init`, `/help`; `journeys` vs `journey-health`; `research` vs `anthropic-skills:deep-research`) — Task 1 only trims skills whose remaining trigger still disambiguates; `simplify` is excluded for this reason.
2. A dropped Keywords token — Task 1 Step 5 compares Keywords segments against the base commit.
3. A removed skill-graph edge that `docs/skill-graph.md` does not actually carry — Task 1 Step 1 verifies each edge's row exists before trimming.
4. A YAML parse change from editing the frontmatter line (quoting, trailing whitespace) — Task 1 Step 4 re-reads every description through `measureDescriptions` and the full `context-cost` suite (`findDescriptionHashHazards`, non-empty description check).
5. The findings doc silently omitting a skill — Task 2 Step 2's probe fails on any `plugin/skills/*` directory missing from the table.

---

### Task 1: Trim 11 skill descriptions

**Files:**
- Modify (line 3, `description:` only): `plugin/skills/browse/SKILL.md`, `plugin/skills/deepen/SKILL.md`, `plugin/skills/design-wrapper/SKILL.md`, `plugin/skills/journeys/SKILL.md`, `plugin/skills/reflect/SKILL.md`, `plugin/skills/release/SKILL.md`, `plugin/skills/review/SKILL.md`, `plugin/skills/routine-kickoff/SKILL.md`, `plugin/skills/visual-review/SKILL.md`, `plugin/skills/visualize/SKILL.md`, `plugin/skills/wrap-up/SKILL.md`

**Interfaces:**
- Produces: the before/after `chars` per skill and the corpus total (printed by Step 4) — Task 2 transcribes them into the findings doc.

- [ ] **Step 1: Confirm each removed edge lives in `docs/skill-graph.md`**

For the edge-restating clauses (browse → stories/visual-review/review/demo; deepen ← review/reflect; journeys ← build; reflect ← review/wrap-up; visual-review ← review; visualize ← journeys/specify/review), find the matching row under the skill's own `## {skill}` section or the caller's section: `git grep -n -E "^## (browse|deepen|journeys|reflect|visual-review|visualize)$" -- docs/skill-graph.md` then read each section. Any edge with no row: add the row to `docs/skill-graph.md` in this task before trimming (none expected — rows were confirmed for browse, deepen, journeys, reflect, design-wrapper at plan time).

- [ ] **Step 2: Run the removed-clause probe to verify it fails**

Run: `node -e 'const m=require("./plugin/bin/lib/skill-audit/context-cost.js");const re=/Works standalone or as a step within|Standalone, or surfaced by|Standalone, or a soft-hook|operation vocabulary used by|encapsulates|quality gate between implementation|The lifecycle closure step|reads the preflight pack|Runs the stale-docs guard/;const bad=m.measureDescriptions(process.cwd()+"/plugin").filter(d=>d.name!=="simplify"&&re.test(d.description)).map(d=>d.name);console.log(bad);process.exit(bad.length?1:0)'`
Expected: FAIL (exit 1) listing the 11 skills.

- [ ] **Step 3: Replace each `description:` value with exactly this text**

| Skill | New description (AC2.1: trigger sentence kept, per Frontmatter conventions) |
|---|---|
| browse | `Use when you need browser automation via playwright-cli. Keywords - browse, browser, playwright-cli, screenshot, scrape, automation.` |
| deepen | `Use for an architectural-depth pass on recently changed code — finds shallow modules and proposes deepening or collapsing them, ranked by leverage.` |
| design-wrapper | `Use when a lifecycle skill (/test, /review, /build, /flow, /visual-review, /specify, /tidy) needs to invoke Impeccable design-quality commands.` |
| journeys | `Use when you want to create or update user journey documentation for recently built features.` |
| reflect | `Use when you want to step back and evaluate recent work through structured lenses — approach correctness, structural debt, surprises, near-misses.` |
| release | `Use to cut a release. Keywords - release, tag, changelog, release-please, release train, Release-As.` |
| review | `Use when a build is complete and you need analytical judgment on code quality, correctness, and simplicity before wrapping up. Gates on /claude-tweaks:test passing.` |
| routine-kickoff | `Machine-invoked by cloud-Routine kernels — the firing-lifecycle home. Not user-facing. Keywords - routine kickoff, firing lifecycle, kernel, cloud routine.` |
| visual-review | `Use when you want to visually review a running application in the browser — inspect UI quality, walk user journeys, discover undocumented journeys, or generate creative improvement ideas.` |
| visualize | `Use for a themed diagram (architecture, flowchart, sequence, state, ER — see argument-hint) or a live diagram of this project's open queue.` |
| wrap-up | `Use when /claude-tweaks:review passes and you need to capture learnings, clean up specs/plans, update skills, and decide next steps.` |

Edit only line 3 of each file; leave every other frontmatter line and the body untouched.

- [ ] **Step 4: Run the probe and the description suite to verify they pass**

Run the Step 2 command again. Expected: PASS (exit 0, prints `[]`).
Then: `node --test tests/bin-lib/skill-audit/context-cost.test.js` — Expected: all pass; note the `rail diagnostic: description total` line.
Then record before/after totals: `node -e 'const m=require("./plugin/bin/lib/skill-audit/context-cost.js");const d=m.measureDescriptions(process.cwd()+"/plugin");console.log(m.totalDescriptionChars(d));for(const x of d)console.log(x.name,x.chars)'` (before = 8616 at base `7aa24bd26`).

- [ ] **Step 5: Verify Keywords tokens are unchanged (AC2.2)**

Run: `node -e 'const cp=require("child_process"),fs=require("fs");const kw=s=>(s.match(/^description:.*?(Keywords - .*)$/m)||[])[1]||"";let bad=[];for(const n of ["browse","release","routine-kickoff"]){const p="plugin/skills/"+n+"/SKILL.md";const a=kw(cp.execFileSync("git",["show","7aa24bd26:"+p],{encoding:"utf8"}));const b=kw(fs.readFileSync(p,"utf8"));if(!a||a!==b)bad.push(n)}console.log(bad);process.exit(bad.length?1:0)'`
Expected: PASS (exit 0, `[]`).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/browse/SKILL.md plugin/skills/deepen/SKILL.md plugin/skills/design-wrapper/SKILL.md plugin/skills/journeys/SKILL.md plugin/skills/reflect/SKILL.md plugin/skills/release/SKILL.md plugin/skills/review/SKILL.md plugin/skills/routine-kickoff/SKILL.md plugin/skills/visual-review/SKILL.md plugin/skills/visualize/SKILL.md plugin/skills/wrap-up/SKILL.md
git commit -m "Trim 11 skill descriptions — drop restated skill-graph edges and body-content clauses (refs #2799)"
```

### Task 2: Findings doc and authoring-convention pointer

**Files:**
- Create: `docs/reference/skill-description-audit.md`
- Modify: `docs/skill-authoring.md` (Frontmatter conventions `description` bullet, line 126; Model-version prompting notes section, after the record #2679 paragraph ending line 245)

**Interfaces:**
- Consumes: Task 1 Step 4's per-skill `chars` and corpus total.

- [ ] **Step 1: Run the coverage probe to verify it fails (covers AC1.1 per-skill findings, AC3.1 linked doc)**

Run: `node -e 'const fs=require("fs");const p="docs/reference/skill-description-audit.md";const d=fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";const s=fs.readdirSync("plugin/skills").filter(n=>!n.startsWith("_"));const miss=s.filter(n=>!d.includes("| `"+n+"` |"));if(!d.includes("| `qa-agent` |"))miss.push("qa-agent");console.log(miss.length);process.exit(miss.length?1:0)'`
Expected: FAIL (exit 1, doc absent).

- [ ] **Step 2: Write `docs/reference/skill-description-audit.md` (AC1.1, AC1.2, AC3.1)**

Sections, in order:
1. `# Skill description trim audit (record #2799)` + one paragraph: the external guidance (shrink skill descriptions; stop pre-reading doc stacks written for weaker models), audit date 2026-10-20, scope = all 39 `plugin/skills/*/SKILL.md` descriptions plus `plugin/agents/qa-agent.md`.
2. `## Guidance vs this repo's conventions` — agreements and conflicts, each stated, none silently resolved:
   - Agrees: `docs/skill-authoring.md` already says "Keep it short — every description loads into every session".
   - Conflict (kept repo side): "shrink" vs the #394 Keywords-preservation rule — Keywords are the selection surface; no token was trimmed. Human call if the guidance should override it.
   - Conflict (kept repo side, needs-human-judgment): "stop pre-reading doc stacks" vs CLAUDE.md's conditional "Read X before touching Y" pointers and the lazy-loaded sub-file pattern (decisions 0016, 0024). These are scoped, on-demand reads, not upfront stacks; no change made.
   - Basis for the edge trims: CLAUDE.md's Cross-references rule ("Do not restate an edge inside a `SKILL.md`") — a description saying "works as a step within /X" or "used by /Y" restates a `docs/skill-graph.md` edge.
3. `## Measurements` — corpus total before (8,616 chars) and after (Task 1 Step 4) against the listing budget from decision 0024 (8,000 chars at 200k context, 40,000 at 1M; shared with every other installed plugin's skills); per-description max 1,536 untouched (largest is 260).
4. `## Per-skill findings` — table `| Skill | Chars before | Verdict | Reason |`, one row per skill, skill name as `` `name` `` in the first cell. Verdicts and reasons:
   - **trim**: browse (consumer list + vocabulary clause — body content and restated edges), deepen, journeys, reflect, visual-review, visualize (restated skill-graph edges), design-wrapper (explanatory second sentence; caller list kept as the trigger), review (restatement "The quality gate between…"; "Gates on /claude-tweaks:test passing" kept as a precondition), wrap-up (restatement "The lifecycle closure step."), release (procedure summary; Keywords carry the scope), routine-kickoff (procedure summary; "Not user-facing" negative trigger kept).
   - **needs-human-judgment**: simplify (name collides with the built-in `simplify` skill; its edge clause is the only claude-tweaks-lifecycle anchor, so trimming is not clear-cut), qa-agent (the "owns a single named session, runs in parallel" clause guides the dispatching model, not trigger matching), intake / sweep / walkthrough (no "Use when/to/for" trigger form — a convention-conformance question, not a trim).
   - **keep** (reason per row): activity, assess-agent-autonomy, backlog, build (record-vs-design-doc input forms), capture, challenge, code-health ("never edits" separates it from editing skills), demo ("Distinct from /test and /review"), dispatch (drain vs direct modes), docs-health, feedback (vs `claude-user-config:repo-feedback`), flow (records-only negative scope), harness-health, help (CLI `/help` overlap), init (built-in `init` collision; re-run trigger), journey-health, ledger ("never invoked via the Skill tool"), pipeline-smoke-test, research ("via /deep-research" vs `anthropic-skills:deep-research`), routine, specify (input forms), stories, test, tidy.
5. `## Re-running this audit` — one paragraph: re-run on a model bump alongside `docs/skill-authoring.md`'s Model-version prompting notes checklist, using the Task 1 Step 4 measure command.

- [ ] **Step 3: Edit `docs/skill-authoring.md`**

- In the `description` bullet (line 126), after "…a lost keyword can stop a skill from firing (#394).", append: ` Don't restate a skill-graph edge ("works as a step within /X", "used by /Y") — edges live once in docs/skill-graph.md (CLAUDE.md's Cross-references).`
- After the "Verification/self-check instruction audit (record #2679)" paragraph, add a paragraph headed `**Description trim audit (record #2799).**` stating: also part of this checklist — re-measure description totals against the listing budget and re-judge descriptions per `docs/reference/skill-description-audit.md`, trimming only clauses that are body content or restated edges, never Keywords tokens or name-collision disambiguation.

- [ ] **Step 4: Run the coverage probe to verify it passes**

Run the Step 1 command. Expected: PASS (exit 0, prints `0`).

- [ ] **Step 5: Commit**

```bash
git add docs/reference/skill-description-audit.md docs/skill-authoring.md
git commit -m "Record #2799 skill description audit findings — per-skill verdicts, guidance conflicts, listing-budget measurements (refs #2799)"
```
