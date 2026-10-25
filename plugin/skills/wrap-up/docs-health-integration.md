# Docs-Health Integration — judge file

Judge file for the `docs` registry row (`Docs`), loaded per that row when its gate opens. The gate, the scope cap, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only.

Loaded by `/claude-tweaks:wrap-up`'s Docs curation row to judge the health of docs this work actually touched or is closely related to, and to detect documentation this work should have produced but didn't. Three checks — D0 broadens which existing docs get judged beyond the touched set via a domain-overlap scan, D1 applies the shared docs-health judgment to that combined scope, D2 judges the diff for missing coverage.

**Fast-lane narrows breadth, never gates existence.** See `_shared/fast-lane-digest.md`'s
wrap-up section for the exact cap number — the engine applies the profile to `scope.cap` only,
never to gate evaluation (`engine-plan.js`'s `resolveDomainOverlapScope`); D0's scan still runs
whenever the row's gate is open, with a smaller cap. The same principle `skill-curation.md`
states for the Skills row; it holds for this row too.

## D0: Domain-Overlap Scan

**Purpose:** rank existing docs by how much they cover the changed subsystem, so D1 also judges docs that weren't directly touched but are still relevant — the documentation equivalent of skill curation's independent domain-scoped scan (`skill-curation.md` 7.2).

1. Read `docs/REGISTRY.md`. **Explicit fallback:** if it doesn't exist, or exists with no Auto-detect patterns, skip this scan for the run entirely — do not fall back to scanning the whole `docs/` tree (that's `/claude-tweaks:docs-health`'s own rotation's job, not this sub-issue's). Report this via the payload's `detail` as `"registry absent/empty — domain-overlap scan skipped"`; this is not an error.
2. Otherwise, score each registry entry by how much its Auto-detect patterns intersect this work's `git diff --name-only` — reuse `bin/lib/issues/blast-radius.js`'s `classifyDiffFiles` directly (map each bare filename to `{path: f}` first, since the function reads `f.path`), passing the registry's own Auto-detect patterns as the `sensitivePaths` argument. A result's `isSensitive: true` means a registry-pattern hit here.
3. Rank descending by overlap-hit count. Take the **top-N**, where N is the cap that arrives in the worklist row (`scope.cap`), resolved by the engine. Exclude any doc already in D1's touched-docs scope below — it's already covered, don't double-judge it.
4. If more docs than the applicable cap have a nonzero overlap score, **note the overflow explicitly** in the payload's `detail` (name the cap and how many were left unread) — never silently truncate. `/claude-tweaks:tidy` and future wrap-ups pick up the remainder.
5. Add the selected top-N docs to D1's scope below — they go through the identical JUDGE procedure (D1 Steps 1-3) as touched docs, with no special-casing.

## Registry Maintenance

Independent of D0/D1/D2 above — keeps `docs/REGISTRY.md` itself accurate, rather than judging the docs it points to. Check if:

- New docs were created during this work (e.g., an ADR for a significant decision) → propose adding an entry to the registry.
- Existing docs were deleted or moved → propose removing or updating the corresponding registry entry.
- Auto-detect patterns need adjustment (directories renamed, new code areas the registry's patterns don't cover yet) → propose a pattern update.

→ Collect each as: `[registry] {action} — {detail}`, folded into the same Documentation updates collection as D1's and D2's findings (see D1's routing below).

## D1: Inline JUDGE application

**Scope:** every doc under `docs/**` that this work edited or newly created (`git diff --name-only` against the run's base, filtered to `docs/**/*.md`), **unioned with D0's domain-overlap top-N** above. Registry-matched-but-unedited docs outside D0's selected top-N are `/claude-tweaks:docs-health`'s own rotation's concern — don't re-scope this to include them.

For each doc in scope:

1. Read the doc in full.
2. Apply the full JUDGE procedure from `_shared/criteria-docs-diataxis.md` (genre-drift including placement-fit, depth-mismatch, findability, staleness including freshness-dependencies, dual-persona misleading-risk) — the identical procedure `/claude-tweaks:docs-health` Step 3 applies, reused inline here rather than invoking `/claude-tweaks:docs-health` as a nested skill call (same reuse pattern the Skills curation row already applies to `_shared/harness-health-analysis.md`).
3. Run the same verify gate `/claude-tweaks:docs-health` Step 3.5 applies: is each finding real, actionable, and correctly `misleads`-tagged? Drop any that fail.

Route surviving findings by `classification`:

- **`additive`** → collect as `[doc] {file} — {description}` rows. In every mode they surface in the Review Console's own "Documentation updates" section (`review-console.md`), which owns the one terminal decision — applied at Phase 4's execution step exactly like any other approved doc edit.
- **`restructural`** → file as a `by:docs-health` GitHub issue via the existing dedup/filing CLI machinery, scoped to exactly this run's touched-doc IDs instead of a `next-target` rotation pick. This index build is issue-backed (`gh issue list`), so on `gh`-absent it routes through `_shared/github-write-transport.md`'s `list_issues` mapping instead of running the command below — never invoke `validate-findings --issues` against a file this branch didn't write. Resolve this run's session-scoped temp paths first, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated):

  ```bash
  WRAPUP_DOCS_HEALTH_ISSUES_RAW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value wrapup-docs-health-issues-raw.json)"
  WRAPUP_DOCS_HEALTH_ISSUES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value wrapup-docs-health-issues.json)"
  gh issue list --label by:docs-health --state all --json number,state,labels,body --limit 500 > "$WRAPUP_DOCS_HEALTH_ISSUES_RAW"
  ```

  Parse via `extractFingerprint` (`bin/lib/issues/record.js`) into `{ number, state, labels, fingerprint }` objects, same as `/claude-tweaks:docs-health` Step 4, and write to `$WRAPUP_DOCS_HEALTH_ISSUES`. Write this check's `restructural` findings to this run's session-scoped `wrapup-docs-health-findings.json` in the same finding shape `_shared/criteria-docs-diataxis.md`'s "Emitting a finding" section defines, then re-resolve this fence's session-scoped paths (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

  ```bash
  WRAPUP_DOCS_HEALTH_FINDINGS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value wrapup-docs-health-findings.json)"
  WRAPUP_DOCS_HEALTH_ISSUES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value wrapup-docs-health-issues.json)"
  WRAPUP_DOCS_HEALTH_PAYLOADS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value wrapup-docs-health-payloads.json)"
  node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js" validate-findings "$WRAPUP_DOCS_HEALTH_FINDINGS" \
    --root "${ROOT:-$PWD}" --issues "$WRAPUP_DOCS_HEALTH_ISSUES" --dry-run \
    > "$WRAPUP_DOCS_HEALTH_PAYLOADS"
  ```

  `--dry-run` here — wrap-up's own approval gate (the Review Console) is the point of approval, not `validate-findings`'s own dedup-and-file path. After the user approves at that gate, re-run the identical command without `--dry-run` so the cursor/cache state actually persists. Before filing, bootstrap the label families this run applies — same canonical pairs `/claude-tweaks:docs-health` Step 6 bootstraps from `_shared/label-bootstrap.md`'s `LABELS_JSON`, since a project with no prior standalone `/docs-health` run won't have them yet. Then file each surviving payload with `gh issue create` exactly as `/claude-tweaks:docs-health` Step 6 does (same label set: `by:docs-health`, the scoring labels from that skill's classification table's `restructural` row, `ready`, `docs-health:restructural`).

## D2: Missing-documentation gap-detection

**Scope:** this work's full diff, not any existing doc — this check's input is code, so it never runs against the docs-health criteria fragment (which only ever takes a doc as input).

Ask: did this work introduce a new subsystem, skill, or architectural pattern with **zero existing doc coverage anywhere** in the project — not merely a small change that doesn't match a registry Auto-detect pattern, but something a future reader would have no doc to go to at all? This is a deliberately high bar. Examples that clear it: a new skill directory, a new top-level architectural pattern, a new user-facing capability with no existing doc even adjacent to it. Examples that don't: a new function in an already-documented module, a bug fix, a config tweak.

On a hit:

1. Infer the matching genre from what the new subsystem actually is (see `_shared/criteria-docs-diataxis.md` Dimension 1's "what it actually does" table) — a new skill's user-facing guide is typically How-To-shaped; a new architectural pattern is typically Explanation-shaped; a new API surface is typically Reference-shaped.
2. **Resolve the path before proposing it.** Read that genre's `doc-convention-{genre}` key via the canonical read path (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" doc-convention-{genre}` — `_shared/policy-schema.md`) and branch on the JSON envelope, the same pattern `adr-curation.md` Step 3 uses for the `adr` genre: `source: "policy"` means the key is set, so use the recorded value and skip detection entirely; `source: "default"` means it is unset, so read `_shared/existing-convention-detection.md` and run its procedure for this genre against the inferred directory plus that genre's declared aliases (`_shared/diataxis-genre-templates.md`'s Genre declarations table). The result is a resolved path plus one of three outcomes: `plugin`, `project`, or `conflict`. Detection answers a weaker question for these four genres than it does for ADR — the plugin prescribes content, not a filename grammar, so a `project` resolution changes which candidate directory and sibling-naming pattern the inferred path uses, not a fixed numbering scheme.
3. Propose a `[doc] {resolved-file-path} — Create: {one-line rationale}` row, folded into the same Documentation updates collection as D1's additive findings (see D1's routing above).
4. On a `conflict` outcome, additionally collect exactly one row per run per genre: `[{genre}-convention] {inferred directory} — {plugin form} vs {found form} ({N} existing)` — the same row shape `adr-curation.md` Step 4 collects for `[adr-convention]` (see `wrap-up/console-template.md`'s render template, which is genre-generic). This row requires per-item approval and is **not** covered by "Approve all." Until it is answered, no `[doc]` row for that genre from this run may be written — the resolved path depends on the answer.
5. On approval, Phase 4's execution step scaffolds the new file from the matching section of `skills/_shared/diataxis-genre-templates.md`, then fills in real content from this work's own session context — unlike `/claude-tweaks:init` Phase 8.5's missing-doc detection (which only backlogs a pointer to the template, since it's scanning an unfamiliar codebase with no session context to fill anything in from), wrap-up has full context on what was just built and writes real content immediately.

Never propose more than one new doc per genuinely new subsystem — if the new subsystem spans multiple genres worth of content (e.g. both a How-To and a Reference), propose each as its own row rather than one doc trying to be two genres.

**Known narrowing — a project with no `docs/` tree never gets a D2 proposal.** The Docs registry row's gate is `docs/` existing and non-empty, so on a project with no docs tree at all this file is never read and D2 never runs — even though D2 is precisely the check that would create the first doc. Accepted: `/claude-tweaks:init` Phase 8.5 covers first-doc scaffolding for such a project. The narrowing is stated here, beside the check it narrows, because the gate that causes it lives in the registry (`bin/lib/wrap-up/registry.js`) and the engine, not in this file.

Declare **"No documentation updates needed"** only when D0 finds no domain-overlap docs (or the registry is absent/empty), D1's full scope (touched + domain-overlap) produces no findings, and D2 finds no missing-doc gap.
