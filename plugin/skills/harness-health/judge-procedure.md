# Harness Health — JUDGE Procedure (dispatch-facing)

The agent-facing distillation of `_shared/harness-health-analysis.md`, used by one caller:

- **The parallel dispatch** in `SKILL.md` Step 1 — when `--budget > 1` returns two or more targets, inline the body below **verbatim** into each Task agent's prompt. Agents only see what's in their own prompt; a pointer to this file, to `SKILL.md`, or to `_shared/harness-health-analysis.md` does not reach them, and every agent handed a path pays to read that whole fragment independently.

The sequential path (`--budget 1`) still reads `_shared/harness-health-analysis.md` directly and is unaffected by this file — that fragment remains the canonical procedure, shared unchanged with `/claude-tweaks:wrap-up`'s Skills curation row and `/claude-tweaks:init` Phase 6. **This file is a distillation of it, not a replacement.** When that fragment changes, update this file in the same edit.

**Scope — deliberately narrower than the fragment.** The body below covers `kind: skill | rule | claude-md` only, because those are the only kinds the dispatch routes through the shared fragment:

- `kind: design-artifact` and `kind: memory` targets use `SKILL.md`'s own Step 3 branch text instead, so they are out of scope here by construction.
- New-skill gap detection and its qualification gate are out of scope: the gap scan runs **once per firing**, not once per target, and is never part of a per-target agent's work.
- The "`## claude-tweaks Pipeline` section in sync with the installed plugin version" CLAUDE.md sub-check is retained below; it is the one check that reads the installed plugin's own contract rather than the target project's source.

Substitute `{target.path}`, `{target.id}`, `{target.kind}`, `{plugin-root}` (the resolved `$CLAUDE_PLUGIN_ROOT`), and `{root}` (the resolved `${ROOT:-$PWD}`) before dispatch.

**`/claude-tweaks:init` Phase 6 — verified, no change needed.** Its Update-Mode drift-patch audit dispatches per-skill agents when the read set covers ≥ 8 skills, and was checked against this same defect. It does **not** hand agents a pointer: its dispatch blockquote delegates to `_shared/subagent-output-contract.md`, which already mandates inlining, and its `_shared/harness-health-analysis.md` reference addresses the main-thread reader, not the agents. It is underspecified (it never names *what* to inline) rather than broken, so it can reuse this file's body for `kind: skill` targets when that is tightened — a separate, smaller change than the one this file exists for.

Everything below the horizontal rule is the inlinable body.

---

Task scope: audit one harness document and emit findings. Read-only — never modify the target or any other file.

Target: `{target.path}` (id `{target.id}`, kind `{target.kind}`). Read it in full, then apply the procedure in this prompt.

Some checks require reading a **live** reference file — the origin template your target was generated from. Read those fresh each time rather than assuming their contents; a tightening of a template must be picked up automatically:

| Target kind | Origin template to read live |
|---|---|
| `skill` | `{root}/skills/init/skill-template.md` |
| `rule` | `{root}/skills/init/rules-template.md` |
| `claude-md` | `{root}/skills/init/claude-md-template.md` |

## Part 1 — Evidence pre-checks (deterministic, before judging)

Run these mechanical checks first and treat their output as **evidence a later judgment weighs**, never as findings themselves. Checks 1-2 are optional assists — skip gracefully when a referenced path or convention has no clean mechanical signature.

> Run these concurrently — they are independent read-only calls against the same target.

1. **Stale-example check** (all kinds). For every backtick-quoted file path or command in the target, verify it still resolves: `ls "<referenced-path>" 2>&1`. For commands, confirm the command exists in `package.json` scripts, a `Makefile`, or as a known binary. A path or command that no longer resolves is strong evidence for a `stale examples` finding — cite the exact output, not "this looks outdated."
2. **Quantified convention-drift check** (all kinds). For each documented convention, grep how many current files match it versus how many comparable files don't: `grep -rl "<pattern-signature>" <domain-dir> | wc -l`. A convention followed by a small minority (e.g. 2 of 15) is quantified evidence — cite the ratio.
3. **Rule glob-resolution check** (`rule` only). Expand the rule's `paths:` frontmatter glob against the filesystem: `find "{root}" -path "<glob>" 2>&1`. Zero matches is strong mechanical evidence the rule's domain no longer exists — a high-confidence `drift` finding proposing an updated glob or retiring the rule.
4. **Tiered line-budget check** (`rule` and `claude-md`). Budget scales with how unconditionally the file loads, not with what kind it is:
   - **Always-loaded tier** — CLAUDE.md, and any rule whose `paths:` frontmatter is absent or empty (such a rule loads every session identically to CLAUDE.md). Budget: the resolved `harness-health-always-loaded-budget` value.
   - **Scoped tier** — any rule with a non-empty `paths:` list. Budget: the resolved `harness-health-scoped-rule-budget` value.

   ```bash
   wc -l "{target.path}"
   cd "{root}" && node "{plugin-root}/bin/resolve-policy.js" harness-health-always-loaded-budget harness-health-scoped-rule-budget
   ```

   Classify the tier, resolve the budget, compare. Over budget is mechanical, high-confidence evidence for a `template-conformance` finding — content belongs in a skill instead (always-loaded tier), or needs tightening/splitting (scoped tier).
5. **Unscoped-rule structural check** (`rule` only). Parse the frontmatter: `sed -n '/^---$/,/^---$/p' "{target.path}"`. A rule with no `paths:` key, or an empty list, is an always-high-confidence `template-conformance` finding on its own, independent of line count — project-wide conventions belong in CLAUDE.md, not a rule. A 10-line unscoped rule is still a structural violation, just a cheap one to fix.
6. **Self-referential count/date check** (all kinds).

   ```bash
   grep -nE 'as of [0-9]{4}-[0-9]{2}-[0-9]{2}|currently [0-9]+ (items?|entries|rules)|pruned from [0-9]+' "{target.path}"
   ```

   A match is evidence for a `best-practice` finding — a hand-typed count or date drifts the moment reality changes, because nothing recomputes it. Recommend removing the claim or replacing it with a pointer to a live check.
7. **Narrative-density heuristic** (all kinds, approximate). For a file or section whose stated shape is a terse list, compute average words per bullet. When the terse-list shape is only part of the file, extract that section first — running `wc -w` over the whole file dilutes the ratio into a meaningless number:

   ```bash
   # Whole-file target (the entire body is the terse list):
   grep -c '^- ' "{target.path}"; wc -w "{target.path}"

   # Section-scoped target — isolate from the heading up to the next `## `.
   # Use awk, not a sed range plus a trailing `sed '$d'`: when the section is the
   # LAST in the file, a range print runs to EOF and `$d` then deletes a genuine
   # content line instead of a heading.
   # Session-scoped destination, suffixed with this target's own id (_shared/
   # session-tmp-root.md's "record-suffixed callers keep both suffixes" case) —
   # the id keeps this scratch file distinct across sibling Task agents auditing
   # different targets in the same parallel dispatch batch; the session segment
   # keeps it distinct across separate firings. Degrades to the plain suffixed
   # path when no $CLAUDE_CODE_SESSION_ID is visible, harmlessly.
   HARNESS_HEALTH_SECTION=$(node -e "
     const { sessionTmpPath } = require('{plugin-root}/bin/lib/session-tmp.js');
     const name = 'harness-health-section-{target.id}.txt';
     console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || require('path').join(require('os').tmpdir(), name))
   ")
   awk '/^## <section heading>$/{p=1; print; next} /^## /{ if (p) exit } p' "{target.path}" > "$HARNESS_HEALTH_SECTION"
   grep -c '^- ' "$HARNESS_HEALTH_SECTION"; wc -w "$HARNESS_HEALTH_SECTION"
   ```

   Divide word count by bullet count over the same extracted content. Above roughly 40 words/bullet is evidence — not a verdict — that specific bullets drifted from a terse constraint into an incident narrative. Feed it into dimension 8 rather than emitting it standalone.
8. **Bare skill-invocation reference check** (`skill` only).

   ```bash
   grep -noE '(^|[^a-zA-Z0-9./_-])/[a-z][a-z0-9-]{2,}([^a-zA-Z0-9./_-]|$)' "{target.path}" \
     | grep -vE 'claude-tweaks:|superpowers:|https?://' \
     | head -40
   ```

   The pattern is deliberately narrow: it requires a non-path character (or line start) before the slash and a non-path character (or line end) after the name, so ordinary file paths and URLs never match. `-o` emits only `{line}:{token}` — full-line output on prose-heavy targets runs to tens of kilobytes dominated by line content.

   **Cap interpretation:** `head -40` exists so one target cannot dominate context. Hitting the cap does **not** by itself mean the regex matched noise — a hub skill that legitimately names many siblings in descriptive prose can exceed 40 tokens with zero findings. Treat a capped result as a sample: triage the first 40, and re-run without the cap only if that triage surfaces real findings.

   A bare reference inside **actionable instruction text** ("Run `/X`", "`/X` handles it") is evidence for a `best-practice` finding — the `Skill` tool requires the fully-qualified name, and a bare short form fails at invocation time. A bare short name in a Relationship-to-Other-Skills table row or other descriptive prose is never passed to a tool call and is **not** a finding. Telling these apart requires reading the surrounding section, not just the grep hit.
9. **Context-cost bloat scan** (all kinds). Run the mechanical detector over the target, with the target's siblings supplying the corpus baseline:

   ```bash
   setopt nullglob 2>/dev/null || shopt -s nullglob 2>/dev/null
   node -e "
   const { bloatReport } = require('{plugin-root}/bin/lib/skill-audit/bloat.js');
   const [target, ...corpus] = process.argv.slice(1);
   console.log(bloatReport(target, corpus));
   " "{target.path}" "{root}"/.claude/skills/*.md "{root}"/.claude/skills/*/*.md
   ```

   Both skill layouts are listed because a project uses one or the other. On zsh, an unmatched glob aborts the whole command with `no matches found` by default — it is bash, not zsh, where an unmatched glob is skipped. The `setopt nullglob 2>/dev/null || shopt -s nullglob 2>/dev/null` guard line normalizes this so an unmatched glob expands to nothing in both shells and only the layout that actually exists reaches `corpus`. Quote the substituted root but leave the `*` unquoted — a project path containing a space otherwise splits into several bad paths, and quoting the whole pattern would stop it globbing at all.

   Four signals: files over the 45 KB soft ceiling, Anti-Pattern rows more than twice the corpus median byte length, provenance-narration phrasing (text addressed to whoever edited the file rather than to the model running it), and adjacent table rows whose right-hand cells are identical or near-identical. Each reported line is evidence dimension 9 weighs, never a finding by itself. When the corpus yields fewer than 20 Anti-Pattern rows the report prints `NO BASELINE` and the row signal was **not evaluated** — read that as "not checked," never as "clean."

## Part 2 — The dimension check

Apply the dimensions that meaningfully apply to this target's kind:

| Check | Question | skill | rule | claude-md |
|-------|----------|:---:|:---:|:---:|
| **1. Pattern accuracy** | Do documented examples/patterns still match how the codebase works? | ✓ | ✓ (does the convention still hold for files matching `paths:`?) | ✓ |
| **2. Convention drift** | Do documented conventions reflect current practice? (Use check 2's ratio where a clean signature exists.) | ✓ | ✓ (see the adherence guard) | ✓ |
| **3. Missing patterns** | Has the codebase introduced patterns that belong here but aren't documented? | ✓ | — | ✓ (always a patch to an existing section, never a new one) |
| **4. Stale examples** | Do referenced paths/commands still exist? (checks 1 and 3) | ✓ | ✓ | ✓ |
| **5. Anti-pattern gaps** | Has the codebase revealed new anti-patterns worth documenting? | ✓ | — | ✓ (Don'ts) |
| **6. Decision-framework completeness** | Does the Decision Framework cover the choices the codebase actually makes? | ✓ | — | rarely |
| **7. Template/structural conformance** | Does this still match the structure its own generator established? | ✓ | ✓ | ✓ |
| **8. Best-practice / harness-performance fit** | Does it follow known practices for making an LLM harness perform well — clear triggers, right-sized scope, concision? | ✓ | ✓ | ✓ |
| **9. Context-cost bloat** | Is the document paying context for text that instructs nobody — an oversized file, rows grown into paragraphs, narration of its own edit history, a table spending N rows on one fact? (check 9 is the evidence) | ✓ (all four signals) | ✓ (provenance and degenerate-row signals only; size is check 4's tiered line budget, not the byte ceiling) | ✓ (same as rule) |

For `rule` and `claude-md`, dimensions 7 and 8 read the **same** origin template — for those kinds the structural template and the best-practice guidance are one document, because the author already encoded best-practice judgment into the template.

Cross-skill overlap and right-sized-scope comparisons across the whole skill library are **not** this audit's job — a separate periodic pass owns them. Judge this target on its own terms.

**Rule adherence-ratio guard (dimension 2).** A low adherence ratio has two causes and only one belongs here:

- **The codebase's shape moved on** — the glob now matches files the rule was never meant to cover. Documentation drift; a real finding.
- **Files that should comply, don't** — the rule is still correct and code violates it. That is a code-quality problem, not a documentation one. **Do not emit a finding.**

Always reason about *why* the ratio is low before emitting anything. Never report a raw ratio as if a low number were self-evidently a documentation problem.

**Bloat-signal guard (dimension 9).** Every signal check 9 reports has a legitimate form, so none is a finding on its own. Read the flagged line first:

- **Over the ceiling.** Real for a skill file or one of its sub-files: it loads in full on every invocation and once per dispatched subagent. The fix is extraction to a lazy-loaded sub-file, never raising the ceiling — and a sub-file cited by two or more stubs naming *sections* of it is the same defect one level down, since `Read` has no section granularity. On a `rule` or `claude-md` target this line restates check 4's tiered line budget; bundle them, do not file both.
- **Over-long rows.** A row carrying an irreducible constraint can be long. What is not legitimate is a row that has absorbed the *reason* it was added — an incident narrative, a summary of what some past change did — which belongs in a project's incident log, not in a table re-read on every invocation.
- **Provenance narration.** Text whose subject is the document's own edit history. The test is deletion: if removing the sentence changes nothing about what the model does, it was written for a reviewer, not for the harness. A phrase that also constrains runtime behavior stays, however historical it sounds.
- **Degenerate tables.** N adjacent rows whose right-hand cells say one thing. Legitimate when the left-hand column carries the content and the right-hand column is a deliberate verdict repeated across cases — a decision matrix is supposed to repeat its verdicts. A defect when the repeated cell is prose that could be stated once in the table's lead-in, or when two rows differ only by a reworded clause.

Nothing here licenses an edit. A bloat finding proposes the exact `oldString`/`newString` that removes the weight and files like any other, and it owes the same anchor requirement — cite check 9's reported line and byte count, never an impression that the file feels long.

**CLAUDE.md-specific checks unlocked by dimensions 7/8:**

- **Line budget** — check 4's tiered comparison.
- **Observed, not aspirational** — flag "should" / "TODO" / "need to add" language describing infrastructure that does not exist yet; that belongs in a backlog, not CLAUDE.md.
- **Working Approach present verbatim** — the origin template mandates this section unmodified; a structural presence check.
- **Don'ts are guardrails, not wishes** — every Don't must describe an *existing* pattern (grep-checkable), never aspirational infrastructure.
- **Philosophy matches current maturity** — re-derive today's maturity signal and compare against what the Philosophy section claims; flags e.g. a project that shipped to real users but still reads "Greenfield."
- **`## claude-tweaks Pipeline` section in sync with the installed plugin version** — do the section's routing paragraphs match what the currently installed claude-tweaks version actually routes? This is the one check measured against the plugin's own contract rather than the target project's source. A surviving `## Project Defaults` section is itself a finding: the plugin stopped generating it and its levers now live in `.claude-tweaks/policy.yml`, so its presence means the project predates that change and its values are being read from a file no consumer resolves any more.
- **Rule expiry — is this rule still live?** Rules accumulate monotonically; nothing else here ever proposes removing one, so without this check an always-loaded file only grows. A rule is dead only on **positive evidence that the thing it guards can no longer happen**:
  - the file, module, flag, or API it names — or that the incident account it references names — no longer exists (run check 1 against that account too);
  - a hook, test, or lint now blocks the behaviour mechanically, so enforcement supersedes the prose;
  - the third-party behaviour it describes no longer holds in the **currently installed** version of that dependency (verify against installed source, not release notes);
  - a later rule subsumes it.

  **Absence of recurrence is not evidence of death.** A rule nobody has violated lately is usually a rule that is working — silence is what success looks like for a guardrail. Never infer expiry from "this hasn't come up in a while," from the incident's age, or from the rule seeming obvious in hindsight; that reasoning strips exactly the guardrails earning their place. If the only argument for removal is that the hazard feels unlikely now, there is no finding.

  Emit as `intent: "remove"` (see the finding shape), quoting the whole bullet verbatim including any tag linking it to an incident account. **Never propose deleting that account itself** — it is the evidence for why the rule existed, costs nothing while unread, and a rule removed in error is re-derived from it. Confidence `high` requires naming the specific commit, deleted path, or enforcing test; anything softer is `med` at best.

## Part 3 — Verify gate (adversarial, before emitting)

Re-examine every candidate finding and answer three questions:

1. **Is it real?** Does the target actually diverge from the codebase, its origin template, or known best practice — or did you misread the target's prose, the code's structure, or the template's requirements?
2. **Is it actionable?** Is `oldString` an exact, unique quote from the target file, and does `newString` concretely fix the issue (not "consider updating this")?
3. **Does it reproduce?** Given the cited evidence, would a reviewer applying `newString` end up with content that is actually correct, without further investigation?

Drop any finding that fails any question, and state the drop reason. This is a judgment step, not a mechanical one — do not skip it.

## Part 4 — Quality gates

- [ ] Every example is adapted from actual codebase patterns, not generic.
- [ ] File paths referenced actually exist (post-patch).
- [ ] Commands referenced actually work.
- [ ] Conventions described match what the codebase actually does.
- [ ] No generic advice that adds no project-specific value.
- [ ] Anti-patterns/Don'ts cite project-specific reasons, not textbook warnings.
- [ ] A `template-conformance` or `best-practice` finding cites the specific origin-template requirement it checks against, not a vague "this could be better."

## Part 5 — Anchor requirement

Every finding must trace to a concrete anchor: a referenced path or command that failed check 1, a quantified drift ratio, a zero-match glob expansion, a line count over budget, or a specific changed-file/commit observation. **A finding with no concrete anchor is indistinguishable from a hallucinated one** — discard it, and note what was discarded and why.

## Finding shape

`oldString`/`newString` must be **exact, unique, verbatim quotes** from the target file — not paraphrased "Current/Proposed" prose. A consuming skill applies patches via an exact-match edit, so a paraphrased or non-unique quote fails to apply, or applies in the wrong place.

`category` distinguishes *why* a finding exists: `drift` (no longer matches the codebase's reality), `template-conformance` (no longer matches the structure its own generator established), `best-practice` (accurate and well-structured, but not written to make the harness perform well).

Emit each finding in this shape:

```json
{
  "kind": "patch",
  "target": "{target.id}",
  "assetType": "{target.kind}",
  "category": "drift | template-conformance | best-practice",
  "section": "<heading within the target>",
  "relatedSections": "<optional array of sibling section names sharing this finding's root cause; omit when there is only one occurrence>",
  "classification": "additive | restructural",
  "confidence": "high | med | low",
  "reversibility": "high | med | low",
  "description": "<acceptance criteria — what 'fixed' looks like>",
  "oldString": "<exact verbatim quote from the target; empty string only for a pure addition>",
  "newString": "<proposed replacement text>",
  "reason": "<the evidence — why this was flagged, citing the anchor>"
}
```

A **removal** additionally sets `"intent": "remove"` with `newString: ""`, and requires `assetType: "claude-md"`, `classification: "restructural"`, and a non-empty `oldString`. Omit `intent` on every other finding — an empty `newString` anywhere else is a validation error, because that is the signature of a model that returned nothing rather than an intentional delete.

**Bundling rule:** when two or more findings in this target share both the same `category` and the same root cause, emit **one** finding, not one per section. Pick the clearest occurrence as the primary `section`, list the others in `relatedSections`, make `reason` state the shared root cause, and make `description` require every listed section fixed. Only bundle when both `category` and root cause match.

## Output

Write the findings array to `/tmp/harness-health-findings-{target.id}.json`.

Reply with **nothing but** a single status line: `DONE` (or `DONE_WITH_CONCERNS`) once that file is written, `NEEDS_CONTEXT` if the target or this procedure was insufficient, or `BLOCKED` if you could not complete. An empty findings array (`[]`) written to that path with a `DONE` status is a valid, expected outcome — do not invent findings to avoid it.

[Use: Standard] (contract § Model Selection — judgment-heavy analysis against the dimension check, not mechanical extraction)
