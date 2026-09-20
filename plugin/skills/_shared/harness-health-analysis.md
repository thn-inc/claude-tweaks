# Harness Health Analysis — Shared Procedure

Canonical procedure for judging whether a project's harness documentation — `.claude/skills/*.md`, `.claude/rules/*.md`, and CLAUDE.md — still accurately describes the codebase, still conforms to its own origin template, and still follows known best practices for getting an LLM harness to perform well; and for detecting a cohesive, reusable pattern with no skill covering it. Read by three consumers, each supplying its own scope model:

| Consumer | Supplies |
|---|---|
| `/claude-tweaks:harness-health` | One target per firing (skill/rule/claude-md/design-artifact via churn/staleness rotation, `next-target`); memory only via an explicit `--kind memory --memory-dir <path>` invocation, never auto-selected |
| `/claude-tweaks:wrap-up`'s Skills and CLAUDE.md & rules curation rows | A finished spec's changed skill files + ledger/reflection seeds (Skills row), plus CLAUDE.md behind an applicability gate (CLAUDE.md & rules row) — see Scope note below |
| `/claude-tweaks:init` Phase 3/6 | Whole-codebase Phase 2 reconnaissance (skill-only this phase — see Scope note below) |

**Scope note:** all three consumers can read every section of this procedure. `/claude-tweaks:wrap-up` invokes it against skills (its Skills curation row) and, behind an applicability gate, against CLAUDE.md (its CLAUDE.md & rules curation row). `/claude-tweaks:init` Phase 6 invokes it against skills only; its CLAUDE.md path is Phase 1u.5's deterministic conformance check (`bin/lib/init/claude-md-conformance.js`), which detects structural drift rather than judging content, so the two are complementary rather than redundant. `/claude-tweaks:harness-health` remains the only consumer that exercises the `rule` path.

This file owns the judgment. It does not own scope selection, staging destination, or cursor/cache mechanics — those are each consumer's own job.

## Finding Shape

Emit each finding as a JSON object in exactly this shape:

```json
{
  "kind": "patch",
  "target": "auth",
  "assetType": "skill",
  "category": "drift",
  "section": "Key Patterns",
  "relatedSections": "<optional array of sibling section names sharing this finding's root cause; omit if there's only one occurrence — patch findings only, see /claude-tweaks:harness-health's bundling rule>",
  "classification": "additive",
  "confidence": "high",
  "reversibility": "high",
  "description": "The referenced example at src/auth/login.js no longer exists",
  "oldString": "See `src/auth/login.js` for the canonical flow.",
  "newString": "See `src/auth/session.js` for the canonical flow.",
  "reason": "src/auth/login.js was renamed to src/auth/session.js in a prior refactor; the skill still points at the old path."
}
```

For a new-skill candidate, use `"kind": "new-skill"` and replace `section`/`oldString`/`newString` with `"proposedBody"` (the full proposed SKILL.md content, using the Initial Mode template from `/claude-tweaks:init`'s `skill-template.md`):

```json
{
  "kind": "new-skill",
  "target": "queue-retry-pattern",
  "assetType": "skill",
  "category": "drift",
  "classification": "additive",
  "confidence": "med",
  "reversibility": "high",
  "description": "Three files under src/jobs/ implement the same retry-with-backoff pattern with no skill documenting it",
  "proposedBody": "---\nname: queue-retry-pattern\ndescription: ...\n---\n...",
  "reason": "src/jobs/emailQueue.js, src/jobs/webhookQueue.js, and src/jobs/syncQueue.js all implement retry-with-exponential-backoff independently — a reusable pattern with no skill covering it."
}
```

Required fields for every finding: `kind` (`patch` | `new-skill`), `target` (the artifact's id — a skill/rule filename stem, `"CLAUDE"` for CLAUDE.md, `"PRODUCT"`/`"DESIGN"` for a design artifact, or a memory entry's filename stem), `assetType` (`skill` | `rule` | `claude-md` | `design-artifact` | `memory`), `category` (`drift` | `template-conformance` | `best-practice`), `classification` (`additive` | `restructural`), `confidence` (`high` | `med` | `low`), `reversibility` (`high` | `med` | `low`), `description`, `reason`. `kind: "patch"` additionally requires `section`, `oldString` (empty string `""` allowed for a pure addition with nothing to replace), and `newString`, and may optionally carry `relatedSections` (an array of non-empty strings — sibling `section` values sharing this finding's root cause; see `/claude-tweaks:harness-health`'s bundling rule) and `intent` (only ever `"remove"`, for a deletion — see "Removing content" below; omit it entirely on every other finding). `kind: "new-skill"` additionally requires `proposedBody` and never carries `relatedSections` — new-skill candidates have no `section` to bundle by. **`new-skill` is the only artifact-creation kind** — rules and CLAUDE.md never get a `"new-rule"` or `"new-claude-md-section"` kind; a "missing pattern" finding against an existing rule or CLAUDE.md is always a `kind: "patch"` addition to that file's existing content (see Step 3).

`category` distinguishes *why* a finding exists, so a human skimming filed issues can tell them apart at a glance:
- **`drift`** — the document no longer matches the codebase's current reality.
- **`template-conformance`** — the document no longer matches the structure its own generator established.
- **`best-practice`** — the document is accurate and well-structured, but not written in a way that gets the harness to perform well.

**Removing content (`intent: "remove"`).** Content that was correct when written can stop being live — the hazard a rule guarded became impossible, or a hook/test now enforces it mechanically. Expressing that means deleting content rather than replacing it, so a removal finding sets `"intent": "remove"` with `newString: ""`. It additionally requires `kind: "patch"`, `assetType: "claude-md"`, `classification: "restructural"`, and a non-empty `oldString` quoting exactly what goes. Omit `intent` on every other finding: an empty `newString` anywhere else is still a validation error, because that is the signature of a model that returned nothing rather than an intentional delete. Removal is scoped to CLAUDE.md precisely because CLAUDE.md findings never auto-apply (the exception below) — that containment is what makes an empty `newString` safe. Widening it to skills or rules means auditing every auto-apply path (`/init` Phase 6, `/wrap-up`'s Skills curation row) first.

**`oldString`/`newString` must be exact, unique, verbatim quotes from the target file** — not paraphrased "Current/Proposed" prose. A consuming skill that still applies patches directly (e.g. `/init` Phase 6, `/wrap-up`'s Skills curation row) does so via the `Edit` tool, which requires `oldString` to match uniquely; a paraphrased or non-unique quote will fail to apply or apply to the wrong location. **Exception: CLAUDE.md findings never auto-apply regardless of classification/confidence/reversibility.** CLAUDE.md governs every future session's behavior; an unattended routine editing it carries outsized blast radius compared to a single skill's documentation. (`/claude-tweaks:harness-health` itself no longer applies anything, to CLAUDE.md or anything else — it always files, per its own `SKILL.md` Step 7.)

**Memory findings.** An `assetType: "memory"` finding carries these same required fields, restated in memory-scoped form in `_shared/harness-health-memory-checks.md` so that branch is self-sufficient without loading this file. This section stays canonical — keep the two in sync when either changes.

## Step 1: Evidence Pre-Checks (deterministic, before judging)

Before forming any finding, run these mechanical checks and treat their output as evidence the judgment step weighs — not findings themselves:

> **Parallel execution:** Use parallel tool calls aggressively — all the checks below are independent read-only ls/grep/find/wc/sed calls against the same target with no dependency on one another and should run concurrently.

1. **Stale-example check.** For every backtick-quoted file path or command referenced in the target (e.g. `` `src/auth/login.js` ``, `` `npm run build` ``), verify it still exists / still works:
   ```bash
   ls "<referenced-path>" 2>&1
   ```
   For commands, check the command exists in `package.json` scripts, a `Makefile`, or is a known binary. A referenced path or command that no longer resolves is strong evidence for a `stale examples` finding — cite the exact `ls`/check output as the finding's evidence, not just "this looks outdated."

2. **Quantified convention-drift check.** For each documented convention or pattern (e.g., "this project always uses X for Y"), grep how many current files actually match it vs. how many files in the same domain don't:
   ```bash
   grep -rl "<pattern-signature>" <domain-dir> | wc -l
   ```
   A convention followed by a small minority of relevant files (e.g., "2 of 15") is quantified evidence of drift — cite the ratio in the finding's evidence field, not just an impression.

3. **Rule glob-resolution check** (rules only, new). Expand the rule's `paths:` frontmatter glob(s) against the actual filesystem:
   ```bash
   find "<root>" -path "<glob>" 2>&1
   ```
   Zero matches is strong, mechanical evidence the rule's domain no longer exists (a renamed/removed directory) — a high-confidence `drift` finding proposing either an updated glob or retiring the rule.

4. **Tiered line-budget check** (CLAUDE.md and rules, revised). Budget scales with how unconditionally a file loads, not with what kind of file it is:
   - **Always-loaded tier** — CLAUDE.md, and any `.claude/rules/*.md` file whose `paths:` frontmatter is absent or empty (`parseRulePaths` in `bin/lib/harness-health/scope.js` already returns `[]` for exactly this case — it loads every session identically to CLAUDE.md). Budget: the `harness-health-always-loaded-budget` policy key, resolved below.
   - **Scoped tier** — any rule with a non-empty `paths:` list. Budget: the `harness-health-scoped-rule-budget` policy key, resolved below.

   ```bash
   wc -l <target-path>
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" harness-health-scoped-rule-budget harness-health-always-loaded-budget
   ```

   Classify the target's tier, take its budget from the resolver's JSON output (the resolver applies the schema defaults when the file or key is absent), then compare. Over budget is mechanical, high-confidence evidence for a `template-conformance` finding — content belongs in a skill instead (always-loaded tier), or needs tightening/splitting (scoped tier), per `skills/init/claude-md-template.md`'s "Under 150 lines" principle and `skills/init/rules-template.md`'s budget guidance.
5. **Unscoped-rule structural check** (rules only, new). Parse the rule's frontmatter for a `paths:` key:
   ```bash
   sed -n '/^---$/,/^---$/p' "<rule-path>"
   ```
   A rule with no `paths:` key, or an empty list, is a mechanical, always-high-confidence `template-conformance` finding on its own — independent of line count — citing `skills/init/rules-template.md`'s "Only create rules for conventions that are path-specific; project-wide conventions belong in CLAUDE.md" contract. A 10-line unscoped rule still gets flagged; it is a structural violation regardless of size, just a cheap one to fix.
6. **Self-referential count/date check** (any kind, new). Grep the target for a hand-typed, self-tracking claim:
   ```bash
   grep -nE 'as of [0-9]{4}-[0-9]{2}-[0-9]{2}|currently [0-9]+ (items?|entries|rules)|pruned from [0-9]+' "<target-path>"
   ```
   A match is mechanical evidence for a `best-practice` finding — a hand-typed count or date claim drifts the moment reality changes, because nothing recomputes it. Recommend removing the claim, or replacing it with a pointer to a live check (`/claude-tweaks:harness-health --target <name>`) instead of a hardcoded number.
7. **Narrative-density heuristic** (any kind, new, approximate). For a file or section whose stated shape is a terse list (a rule file's body; a `## Don'ts`-style section), compute average words-per-bullet-line — when the terse-list shape is only *part* of the target file (e.g. CLAUDE.md's `## Don'ts` section among many other sections), extract just that section first, since running `wc -w` over the whole file dilutes the ratio with unrelated prose and produces a meaningless number:
   ```bash
   # Whole-file target (e.g. a rule file whose entire body is the terse list):
   grep -c '^- ' "<target-path>"
   wc -w "<target-path>"

   # Section-scoped target (e.g. CLAUDE.md's `## Don'ts` section specifically) — isolate the
   # section first, from its heading up to (not including) the next `## ` heading. Use awk, not
   # a `sed` range + trailing `sed '$d'`: when the target section is the LAST one in the file
   # (no following `## ` heading to end the range on), a range print runs to EOF and an
   # unconditional `$d` then deletes the genuine last content line instead of a heading.
   # Session-scoped destination (_shared/session-tmp-root.md) — degrades to the unscoped
   # path when no $CLAUDE_CODE_SESSION_ID is visible, harmlessly.
   HARNESS_HEALTH_SECTION=$(node -e "
     const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
     console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'harness-health-section.txt') || require('path').join(require('os').tmpdir(), 'harness-health-section.txt'))
   ")
   awk '/^## {section heading}$/{p=1; print; next} /^## /{ if (p) exit } p' "<target-path>" > "$HARNESS_HEALTH_SECTION"
   grep -c '^- ' "$HARNESS_HEALTH_SECTION"
   wc -w "$HARNESS_HEALTH_SECTION"
   ```
   Divide word count by bullet count for a rough average, computing both counts over the same extracted content. Above roughly 40 words/bullet is evidence — not a verdict — that specific bullets have drifted from a terse constraint into an incident narrative. Feed this as an anchor into dimension 8's existing best-practice judgment rather than treating it as a standalone finding; tune the threshold from real findings over time.
8. **Bare skill-invocation reference check** (skills only, new). Grep the target skill's actionable instruction text — `## Step N` bodies and `## Next Actions` blocks — for a bare `/{other-skill-name}` referencing another skill in the same project, without a `claude-tweaks:`-style fully-qualified prefix:
   ```bash
   grep -noE '(^|[^a-zA-Z0-9./_-])/[a-z][a-z0-9-]{2,}([^a-zA-Z0-9./_-]|$)' "<target-path>" \
     | grep -vE 'claude-tweaks:|superpowers:|https?://' \
     | head -40
   ```
   The pattern is deliberately narrow: it requires a non-path character (or line start) *before* the slash and a non-path character (or line end) *after* the name, so ordinary file paths (`bin/lib/issues/claim.js`, `./scripts/deploy.sh`, `.claude-tweaks/pipelines/`) and URLs never match. The `-o` flag emits only `{line}:{matched-token}` rather than the whole line — full-line output on a prose-heavy target runs to tens of kilobytes dominated by line content, not by the hit, and the line number is all the triage step below actually needs. The follow-on `grep -v` drops already-qualified references; because `-o` makes it filter *tokens* rather than whole lines, a genuine bare `/{skill}` is still caught on a line that also contains a correctly-qualified `/claude-tweaks:{skill}`.

   **Cap interpretation.** The `head -40` bound exists so one target can never dominate the caller's context — this check runs against up to five skills per `/wrap-up` Skills-row invocation and is multiplied by `--budget` under `/harness-health`. Hitting the cap does *not* by itself mean the regex matched noise: a hub skill that legitimately names many siblings in descriptive prose can exceed 40 tokens with zero findings. Treat a capped result as a sample — triage the first 40, and re-run without `| head -40` only if that triage surfaces real findings.

   A bare reference sitting inside imperative instruction text ("Run `/X`", "`/X` handles it") — as opposed to a Relationship-to-Other-Skills table row or other descriptive prose, where a bare short name is never passed to a tool call — is evidence for a `best-practice` finding: the `Skill` tool requires the fully-qualified name, and a bare short form fails at invocation time. Distinguishing actionable text from descriptive prose requires reading the surrounding section, not just the grep hit — treat this as a candidate list to triage, not a verdict. Feed confirmed hits into dimension 8's best-practice judgment.
9. **Context-cost bloat scan** (any kind). Run the mechanical detector over the target, with the target's siblings supplying the corpus baseline:
   ```bash
   setopt nullglob 2>/dev/null || shopt -s nullglob 2>/dev/null
   node -e "
   const { bloatReport } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/bloat.js');
   const [target, ...corpus] = process.argv.slice(1);
   console.log(bloatReport(target, corpus));
   " "<target-path>" "<root>"/.claude/skills/*.md "<root>"/.claude/skills/*/*.md
   ```

   List both skill layouts — a project uses one or the other. On zsh (this project's shell), an unmatched glob aborts the whole command with `no matches found` by default — it is bash, not zsh, where an unmatched glob is skipped (expanded to its own literal pattern text, which the `require`d corpus reader then simply finds no such file for). The `setopt nullglob 2>/dev/null || shopt -s nullglob 2>/dev/null` guard line normalizes this: it enables nullglob under whichever shell is running (the `setopt` form succeeds under zsh and short-circuits the `||`; it fails under bash, where the `shopt` form runs instead), so an unmatched glob expands to nothing in both shells and only the layout that actually exists reaches `corpus`. Quote the substituted root but leave the `*` unquoted: a project path containing a space otherwise splits into several bad paths, and quoting the whole pattern stops it globbing at all. Auditing this plugin's own skills, the corpus is `"<root>"/skills/*/*.md` instead.

   It reports four signals: files over the 45 KB soft ceiling, Anti-Pattern rows more than twice the corpus median byte length, provenance-narration phrasing (text addressed to whoever edited the file rather than to the model running it), and adjacent table rows whose right-hand cells are identical or near-identical. Every reported line is evidence dimension 9 weighs, never a finding on its own — see the bloat-signal guard in Step 2 for what each signal's legitimate form looks like. When the corpus yields fewer than 20 Anti-Pattern rows the report prints `NO BASELINE` and the row signal was **not evaluated**: read that as "not checked," never as "clean."
10. **Composed-bytes measurement** (skills only). Run `composedBytesReport` from `${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/context-cost.js` over the plugin root and read the per-call-site table it returns (one row per compose call site, one column per condition combination its sources branch on):
    ```bash
    node -e "
    const { composedBytesReport, overComposedCeiling } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/context-cost.js');
    const rows = composedBytesReport(process.argv[1]); console.log(JSON.stringify({ rows: rows.map((r) => ({ step: r.step, file: r.file, max: r.max, error: r.error })), over: overComposedCeiling(rows) }));
    " "<plugin-root>"
    ```
    `<plugin-root>` is the directory with `skills/` directly beneath it — this repo's `plugin/`, or `${CLAUDE_PLUGIN_ROOT}` for an installed consumer — never the repo root. A combination over `CEILING_BYTES` — or a step carried by `COMPOSED_STEP_EXCEPTIONS` — is evidence for dimension 9, cited by the module's numbers, never restated here.

Checks 1-2 are optional assists — skip gracefully if a referenced path/command genuinely can't be checked mechanically (e.g., a described convention with no clean grep signature). A finding grounded in one of these checks is higher-confidence than one based on reading alone.

## Step 2: The Dimension Check

For the target (or, for wrap-up/init, each skill in their own read set), apply the dimensions that meaningfully apply to its kind:

| Check | Question | Skill | Rule | CLAUDE.md |
|-------|----------|:---:|:---:|:---:|
| **1. Pattern accuracy** | Do documented examples/patterns still match how the codebase works? | ✓ | ✓ (does the stated convention still hold for files matching `paths:`?) | ✓ |
| **2. Convention drift** | Do documented conventions reflect current practice, or has the codebase diverged? (Use the quantified check from Step 1 where a clean grep signature exists.) | ✓ | ✓ (the adherence-ratio check — see guard below) | ✓ |
| **3. Missing patterns** | Has the codebase introduced patterns that belong here but aren't documented? | ✓ | — | ✓ (always a `patch` to an existing section, never a new one) |
| **4. Stale examples** | Do referenced file paths/commands still exist? (Use the stale-example check from Step 1.) | ✓ | ✓ (the glob-resolution check) | ✓ |
| **5. Anti-pattern gaps** | Has the codebase revealed new anti-patterns worth documenting? | ✓ | — | ✓ (Don'ts) |
| **6. Decision framework completeness** | Does the Decision Framework cover the choices the codebase actually makes? | ✓ | — | rarely (only if the project's CLAUDE.md happens to have one) |
| **7. Template/structural conformance** (new) | Does this artifact still match the structure its own generator established? | ✓ (`docs/skill-authoring.md`'s own "SKILL.md structure" convention + `skills/init/skill-template.md`) | ✓ (`skills/init/rules-template.md`'s frontmatter shape) | ✓ (`skills/init/claude-md-template.md`'s "Principles" — 150-line budget, observed-not-aspirational, required sections, Working Approach present verbatim) |
| **8. Best-practice/harness-performance fit** (new) | Does it follow known practices for getting an LLM harness to perform well (clear triggers, no cross-skill overlap, right-sized scope, concision)? | ✓ (`superpowers:writing-skills`; the mechanical cross-skill-overlap/right-sized-scope check now lives in `skills/harness-health/library-shape-analysis.md`'s periodic pass, not this dimension directly) | ✓ (`skills/init/rules-template.md`'s own "path-specific only; project-wide belongs in CLAUDE.md" guidance — a suspiciously broad glob should be a CLAUDE.md convention instead) | ✓ (`skills/init/claude-md-template.md`'s Principles, same source as dimension 7 for this kind) |
| **9. Context-cost bloat** | Is the document paying context for text that instructs nobody — an oversized file, rows grown into paragraphs, narration of its own edit history, a table spending N rows on one fact, or a compose call site composing over its ceiling? (Use Step 1's checks 9 and 10 as the evidence.) | ✓ (all four signals, plus check 10's composed-bytes gate) | ✓ (provenance and degenerate-row signals; size is check 4's tiered line budget, not the byte ceiling) | ✓ (same as rule) |

For rules and CLAUDE.md, dimensions 7 and 8 read from the *same* origin-template file — for those two kinds the structural template and the best-practice guidance are the same document, since the project's own author already encoded best-practice judgment into the template. Read these templates **live** each time, not from a frozen copy of their content — a future tightening of `skill-template.md`/`rules-template.md`/`claude-md-template.md` is picked up automatically by every subsequent audit.

**Rule adherence-ratio guard (dimension 2).** A low adherence ratio (few files matching `paths:` actually follow the stated convention) has two different causes, and only one belongs to this procedure:
- **The codebase's shape moved on** (the glob now matches files the rule was never meant to cover, e.g. a newer sibling directory) → this is documentation drift, a real finding here.
- **Files that should comply, don't** (the rule is still correct; code violates it) → this is a code-quality/compliance problem, `/claude-tweaks:code-health`'s job, not this procedure's. Do not emit a finding for this case.

Always reason about *why* the ratio is low before emitting a finding — never report the raw ratio as if a low number were self-evidently a documentation problem.

**Bloat-signal guard (dimension 9).** Every signal Step 1's checks 9 and 10 report has a legitimate form, so none is a finding on its own. Read the flagged line before emitting anything:

- **Over the ceiling.** A real finding for a skill file or one of its sub-files: it loads in full on every invocation and once per dispatched subagent. The fix is composition first — `when:` markers or a compose call site whose composed bytes the gate measures (check 10) — and extraction to a lazy-loaded sub-file only when the sub-file is a genuinely lazy unit some runs never read; never raising the ceiling. A sub-file cited by two or more stubs naming *sections* of it is the same defect one level down, since `Read` has no section granularity. For a `rule` or `claude-md` target the byte-ceiling line restates check 4's tiered line budget; bundle them, don't file both.
- **Over-long rows.** A row carrying an irreducible constraint can be long. What is not legitimate is a row that has absorbed the *reason* it was added — an incident narrative, a summary of what a past change did — which belongs in the project's incident log, not in a table re-read on every invocation.
- **Provenance narration.** Text whose subject is the document's own edit history. The test is deletion: if removing the sentence changes nothing about what the model does, it was written for a reviewer, not for the harness. A phrase that also constrains runtime behavior stays, however historical it sounds.
- **Degenerate tables.** N adjacent rows whose right-hand cells say one thing. Legitimate when the left-hand column carries the content and the right-hand column is a deliberate verdict repeated across cases (a decision matrix is supposed to repeat its verdicts). A defect when the repeated cell is prose that could be stated once in the table's lead-in, or when two rows differ only by a reworded clause.

Nothing in this dimension licenses an edit: a bloat finding proposes the exact `oldString`/`newString` that removes the weight and files like any other, and it owes the same Anchor Requirement — cite checks 9 and 10's reported line and byte count, never an impression that the file feels long.

**CLAUDE.md-specific checks unlocked by dimension 7/8 (concrete, largely mechanical):**
- **Line budget** — Step 1's tiered `wc -l` check vs. the `harness-health-always-loaded-budget` policy lever.
- **Observed-not-aspirational** — flag language ("should", "TODO", "need to add") describing infrastructure that doesn't exist yet; that belongs in the project's backlog, not CLAUDE.md.
- **Working Approach present verbatim** — `skills/init/claude-md-template.md` mandates this section be included unmodified in every generated CLAUDE.md; a structural presence check.
- **Don'ts are guardrails, not wishes** — every Don't must describe an *existing* pattern (grep-checkable, same evidence style as dimension 2), never aspirational infrastructure.
- **Rule expiry — is this rule still live?** The complement of the check above: that one catches a rule written for infrastructure that never existed; this one catches a rule that *was* earned and whose hazard has since gone away. Rules accumulate monotonically — nothing else in this procedure ever proposes removing one — so without this check the always-loaded file only grows. A rule is dead only on **positive evidence that the thing it guards can no longer happen**:
  - the file, module, flag, or API named by the rule — or by the longer incident account it references, where the project keeps one — no longer exists; this is Step 1's stale-example check, run against that account as well as the rule itself;
  - a hook, test, or lint now blocks the behaviour mechanically — the enforcement supersedes the prose, and the rule is redundant rather than wrong;
  - the third-party behaviour it describes no longer holds in the **currently installed** version of that dependency (verify against its installed source, not its release notes);
  - a later rule subsumes it, making it a duplicate.

  **Absence of recurrence is not evidence of death.** A rule nobody has violated lately is usually a rule that is working; silence is what success looks like for a guardrail. Never infer expiry from "this hasn't come up in a while," from the age of the incident, or from the rule seeming obvious in hindsight — that reasoning strips exactly the guardrails that are earning their place. If the only argument for removal is that the hazard feels unlikely now, there is no finding.

  Emit as `intent: "remove"` (see Finding Shape), quoting the whole bullet verbatim including any tag linking it to an incident account. Never propose deleting that account itself — it is the evidence for why the rule once existed, it costs nothing while unread, and a rule removed in error is re-derived from it. Confidence `high` requires naming the specific commit, deleted path, or enforcing test; anything softer is `med` at best.
- **Philosophy matches current maturity** — re-derive today's maturity signal (the classification `/claude-tweaks:init` Phase 2h would compute right now) and compare it to what the Philosophy section says; flags e.g. a project that shipped to real users since the CLAUDE.md was written but still reads "Greenfield."
- **`## claude-tweaks Pipeline` section in sync with the installed plugin version** — do the section's routing paragraphs match what the currently installed claude-tweaks plugin version actually routes? This one is checked against the plugin's own evolving contract (its bundled `skills/init/claude-md-template.md`), not the target project's own source — a genuinely different kind of drift from every other check in this file. **A surviving `## Project Defaults` section is itself a finding**: the plugin stopped generating it, and its levers now live in `.claude-tweaks/policy.yml`, so its presence means the project predates that change and its values are being read from a file no consumer resolves any more.

**Bounded sub-file reads.** If the target references sub-files (lazy-loaded content — e.g. the sub-files sitting alongside `init`'s or `build`'s own SKILL.md), do not read all of them by default — read only the sub-files whose content plausibly relates to what changed (matched by filename/section keyword against the change source: churned domain paths for the routine, the spec's changed files for wrap-up, Phase 2 findings for init). Note explicitly which sub-files were skipped and why, so a human reviewing the finding can request a deeper read if needed.

## Memory-Specific Checks (`assetType: memory` targets)

Canonical home: `_shared/harness-health-memory-checks.md`. A `memory` target skips the
dimension check above entirely, so its mechanical checks, its finding fields, and its
filing posture live in that fragment as a self-sufficient lazy-load unit — nothing about them
is restated here. `/claude-tweaks:harness-health`'s Step 3 `target.kind === 'memory'` branch is
its only consumer; `/claude-tweaks:wrap-up`'s Skills curation row and `/claude-tweaks:init` Phase 3/6 are
skill-only and never reach it.

## Step 3: New-Skill Gap Detection

Independent of any specific target's audit, look for a **cohesive** set of files implementing one reusable pattern with **no** skill covering it. This step is skill-only — rules and CLAUDE.md never get an equivalent "new-rule" or "new-claude-md-section" gap scan this phase; their dimension 3 ("missing patterns") is the closest analog, and it always produces a `patch` against existing content instead. "Cohesive" means multiple files implementing the same pattern, not scattered one-off edits — ground this in concrete signals, not impression alone:

- A new top-level directory with 3+ files sharing a naming convention (e.g. `*.queue.js`, `*Repository.ts`).
- A recurring import combination (the same 2+ modules imported together) appearing in 3+ files with no matching skill.
- A commit-message keyword or phrase recurring across 3+ commits, none of which are covered by an existing skill's domain.
- A single new file/module reused (imported/called) from 2+ other files, where the reused interface is itself non-trivial (2+ exported functions/methods, or a documented options/config surface — not a one-line wrapper). A module with a single call site, however well-designed, does not qualify under this signal — there is no softer "clearly designed for reuse" alternate clause, to keep this signal as mechanically anchored as the other three.

## Step 4: New-Skill Qualification Gate

Evaluate each gap candidate (from Step 3, or seeded by a caller — e.g. wrap-up's `[skill: NEW - {name}]` ledger tags) against three criteria:

1. **Reusability** — the pattern applies to 2+ future builds, not a one-off.
2. **Complexity** — the pattern is non-obvious (simple conventions belong in CLAUDE.md, not a skill).
3. **Project-specific** — the pattern is specific to this project, not generic best practice.

**Propose the candidate when at least 2 of the 3 criteria are clearly met.** A candidate meeting all three is a strong recommendation; one meeting exactly two is proposed for human review. A candidate meeting ≤1 criterion is dropped — note which criteria were missing so the decision is auditable.

**Fold-into-existing-skill branch (ordering, explicit).** This gate runs first, unchanged, exactly as above — a candidate that fails it (≤1 criterion met) is dropped outright, full stop; the domain-fit check below never becomes a second path around the gate, and a signal-4-admitted candidate's reusability/complexity/project-specificity criteria must still be judged independently, never assumed satisfied by the fact that signal 4 (Step 3's single-module-reuse signal) admitted it. Only for a candidate that already clears the ≥2-of-3 gate: check whether an existing skill's domain — read that skill's **full body**, not just its frontmatter `description`; a superficial keyword match against a broad or catch-all description is not sufficient evidence of genuine fit — already reasonably covers this territory.
- **If yes**, propose a `kind: "patch"` to that skill instead of a new file (Finding Shape's `patch` fields: `section`/`oldString`/`newString`).
- **If no** existing skill's domain fits, propose `kind: "new-skill"` as before.

**Per-consumer domain-fit scope.** The domain-fit check's comparison scope differs by which of the three consumers (see the table at the top of this file) is running it: `/claude-tweaks:wrap-up`'s Skills curation row already has a bounded read set (7.2's top-cap ∪ seeds) to check the candidate against — reuse it, no extra reads needed. Standalone `/claude-tweaks:harness-health` and `/claude-tweaks:init` Phase 3/6 have no equivalent pre-bounded skill list for this check — for those two, scan the full skill library's frontmatter `description` fields (a cheap scan, not a full-body read for every skill), then read the full body only of any skill whose description plausibly matches before deciding fit.

## Step 5: Verify Gate (adversarial, before staging)

Before a finding is emitted, re-examine it and answer three questions — same discipline `/code-health` already applies:

1. **Is it real?** Does the target actually diverge from the codebase (or its own origin template, or known best practice), or did the judge misread the target's prose, the code's structure, or the template's requirements?
2. **Is it actionable?** For a patch: is `oldString` an exact, unique quote from the target file, and does `newString` concretely fix the issue (not "consider updating this")? For a new-skill candidate: is `proposedBody` a real, codebase-grounded SKILL.md, not a generic template?
3. **Does it reproduce?** Given the evidence cited, would a reviewer applying `newString` (or creating the proposed skill) end up with content that's actually correct, without further investigation?

Drop any finding that fails any of the three questions. Log the drop reason. This gate is a judgment step, not mechanical — do not skip it even for a routine firing under no time pressure to rush.

## Step 6: Quality Gates (before finalizing any patch or new skill)

- [ ] Every code example is adapted from actual codebase patterns (not generic).
- [ ] File paths referenced actually exist (post-patch).
- [ ] Commands referenced actually work.
- [ ] Conventions described match what the codebase actually does.
- [ ] No generic advice that adds no project-specific value.
- [ ] Anti-patterns/Don'ts cite project-specific reasons, not textbook warnings.
- [ ] A `kind: "new-skill"` finding's `proposedBody` description starts with "Use when..." and names a clear trigger.
- [ ] A `category: "template-conformance"` or `"best-practice"` finding cites the specific origin-template requirement it's checking against (not a vague "this could be better").

## Anchor Requirement

Every finding must trace to a concrete anchor — a specific referenced path/command that failed the Step 1 check, a quantified drift ratio, a zero-match glob expansion, a line-count over budget, a ledger entry, a reflection insight, or a specific changed-file/commit observation. A finding with no concrete anchor is indistinguishable from a hallucinated one — discard it, and note what was discarded and why.
