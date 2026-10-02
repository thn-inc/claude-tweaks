# Skill Curation — judge file

Judge file for the `skills` registry row (`Skills`), loaded per that row when its gate opens. The gate, the scope cap, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only.

Analyze whether project skills need updating, and whether the work warrants a **new** skill — based on what was actually built. This row is judged on its own (never folded into the CLAUDE.md & rules row) because skill curation requires reading and comparing full skill files — a heavier weight of analysis than the doc/CLAUDE.md scans.

**Core principle: this step *generates* candidates from the work itself — it does not merely filter whatever upstream producers tagged.** Ledger entries and reflection insights are **seeds** that focus the analysis, not the gate that decides whether it runs. Even with zero seeds, the independent scan (7.2) inspects the skills whose domain overlaps the changed files, and gap detection looks for reusable patterns no skill covers.

**Fast-lane narrows breadth, never gates existence.** See `_shared/fast-lane-digest.md`'s
wrap-up section for the exact cap number — 7.2's independent scan still always runs regardless
of seeds; only its cap shrinks. This is a deliberate, narrow exception to the cap number, not a
reopening of the seed-gating question this principle exists to close.

## 7.1: Gather Seeds

An entry whose body carries `[route: D4]` or `[route: D5]`, or whose subject is a claude-tweaks skill, contract or CLI rather than this project's own code, is not a project-skill seed. Hand it to the Memory curation row (D4, `memory-curation.md`) or the Upstream feedback curation row (D5, `upstream-feedback.md`) and do not seed it here — seeding it would route it to this project's skill library and those rows would never see it. Where this project *is* claude-tweaks, the contract's self-reference check collapses D5 and the entry seeds here as usual.

1. Read ledger entries with phase `build/skill` (from /build Step 4.5) or `review/skill` (from /review lens 3a), plus any ledger entry whose body contains a `[skill: …]` tag (from /reflect findings under phases `review/hindsight`, `wrap-up`, or `reflect`).
2. Check reflection insights (SKILL.md's Phase 1 reflect pass) tagged for skill destinations.
3. Collect the seeds as `{skill name | NEW — name} ← {source}` pairs.

Seeds are inputs, not gates. **Proceed to 7.2 regardless of how many seeds exist — including zero.** A skill audit that runs only when something was pre-tagged is the failure mode this procedure exists to fix.

## 7.2: Independent Scan (generation)

> **Parallel execution:** Use parallel tool calls aggressively — the changed-file list and the ranked skill reads are independent and should run concurrently.

Regardless of seeds, look at the work itself:

1. **List changed files** — `git diff --name-only` against the work's base ref.
2. **List skills** — enumerate skill files in `.claude/skills/`. If the directory doesn't exist, still run step 4 (gap detection) — a project with no skills is the strongest case for a first one.
3. **Rank by domain overlap** — score each skill by how much its domain (the directories, file-types, and patterns it documents) intersects the changed files. Read the most relevant skills in full, up to the cap, **or 60 KB of skill content total, whichever comes first**. The cap arrives in the worklist row (`scope.cap`), resolved by the engine; it is a **file** cap and never raises the 60 KB byte budget.

   **Why a byte budget and not just a file cap.** A file count bounds nothing by itself: the largest single `SKILL.md` in this plugin already exceeds this whole budget on its own, so "top N in full" can mean a quarter-megabyte read. The byte budget is the real bound; the file cap only keeps the read set small when the files happen to be small.

   **On reaching the byte budget**, do not stop and do not silently drop the rest. Switch to a **bounded read** for every still-unread skill in the ranked set — its frontmatter plus its section headings (`grep -n '^#\+ ' <file>` gives the outline cheaply) — and then full-read only those whose outline actually touches the changed files. This is the same bounded-read discipline `_shared/harness-health-analysis.md` already applies to sub-files. Anything still unread after that is **overflow**, reported per the rule below.

   The caps bound token cost; the ranking ensures the highest-value skills are covered. If more skills than the applicable cap are relevant, or the byte budget cut the read set short, **note the overflow explicitly** — `/claude-tweaks:tidy` and future wrap-ups pick up the remainder (never silently truncate).
4. **Gap detection** — identify any *cohesive* set of changed files implementing one reusable pattern in a domain that **no** skill covers. "Cohesive" means multiple files implementing a single pattern, not scattered one-off edits. Each cohesive uncovered domain becomes a new-skill gap candidate, evaluated via the shared procedure in 7.3-7.5.
5. **Union with seeds** — add any seeded skills from 7.1 not already in 7.2's ranked read set to the read set. Seeds are always analyzed: the byte budget can downgrade a seeded skill to the bounded read described in step 3, but never drops it from the read set.

## 7.3-7.5: Judge Each Relevant Skill and New-Skill Candidates

Apply the full procedure in `_shared/harness-health-analysis.md` (Steps 1-6: evidence pre-checks, the dimension check, new-skill gap detection, the new-skill qualification gate, the verify gate, and quality gates) to every skill in the read set (seeded + scanned from 7.2) and to any new-skill candidates discovered there. That file is the single canonical procedure — also read by `/claude-tweaks:init` (Phase 3/6) and the standalone `/claude-tweaks:harness-health` routine — so a skill's drift verdict doesn't depend on which of the three ever looked at it.

Emit findings in the Finding Shape that file defines. A proposed new-skill candidate is **never auto-created** — it is always staged for an explicit decision (7.6). For approved candidates, note the skill name and scope; the actual skill file is created at SKILL.md's Phase 4 execution step.

**Record the audit.** For each skill analyzed in this pass — whether or not a patch was proposed — record it in the shared cursor so `/claude-tweaks:harness-health`'s rotation and `/claude-tweaks:init`'s classification skip a skill wrap-up just reviewed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" validate-findings <findings-for-that-skill.json> --root . --target <skill-id> --kind skill
```

An empty findings array is valid here — it still records `lastAuditedSha`/`lastAuditedMs` for that skill.

**This call is local-only by default (#2545)** — it records the cursor on a local-only branch in this checkout and never touches the network, so a judge calling it once per analyzed skill performs zero remote pushes regardless of how many skills this row covers. This judge never pushes `health-state` itself — doing so would be the one remote-write side effect the row's no-mutation contract (`curation-engine.md`'s fan-out rule) exists to rule out. Publishing the accumulated cursor state is **controller-side, not judge-side**: at row end — immediately after this row's judge returns its payload to `record` (`curation-engine.md` section 2/3), before the next row's judge runs — the controller runs `node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" push-cursor --root .` exactly once, shipping every skill's locally-recorded cursor from this row in a single push.

## 7.6: Stage or Present

**Staging (every mode — Phase 1 guarantees a run directory):**

For each proposed change:

1. Classify as **additive** (new examples, new anti-patterns, new section appended) or **restructural** (changing existing wording, moving content, renaming sections, splitting/merging skills).
2. **Additive + reversibility:high + confidence:high** → auto-apply now: make the edit in the working tree only — never run `git add`/`git commit` (`curation-engine.md` section 4's serial-commit pass is the single committer; it audits the edit, commits it, and writes this log entry with the hash only it knows). This rule applies whether or not a ledger entry seeded the change. Log entry (written by the controller at commit time):
   ```
   AUTO 14:52:24 — Skills row: applied additive update to {skill}/SKILL.md ({section}). Reversibility: high; commit: {hash}.
   ```
3. **Restructural OR confidence:med-low** → stage as `staged/wrap-up-skill-{N}.md` containing the Update Mode patch. Log entry:
   ```
   STAGED 14:52:31 — Skills row: skill update proposed for {skill}/SKILL.md ({section}). Reversibility: high (stage path: staged/wrap-up-skill-{N}.md).
   ```
4. **New skill candidates** (7.3-7.5) → always stage (creating a new skill is a structural decision). Log entry:
   ```
   STAGED 14:52:38 — Skills row: new skill candidate "{name}". Reversibility: high (stage path: staged/wrap-up-skill-new-{name}.md).
   ```

Staged items surface at the Wrap-Up Review Console (SKILL.md's Phase 4) as rows in the "Skill updates" section. New-skill candidates appear as ordinary rows covered by "Approve all."

Declare **"No skill updates needed"** only when 7.1 found no seeds, 7.2's scan found no relevant skills and no gap candidates, and 7.3-7.5 produced no candidates. Do not declare it merely because no ledger entries were tagged.

**This file never presents a decision.** In every mode — `auto`, `hybrid`, interactive, standalone — staged skill updates surface at the Review Console's "Skill updates" section (`review-console.md`), which owns the one terminal decision, its hard gate on rendering the table, and the full Update Mode patches shown beneath it. This row only stages; do not present a second batch table here, and do not wait for approval before the next registry row runs.
