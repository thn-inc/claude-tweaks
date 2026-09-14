# Harness Health — Step 7: FILE

The full filing procedure for `/claude-tweaks:harness-health` Step 7, lazy-loaded from `SKILL.md`. Covers the classification-to-scoring fold, the born-`ready` rule, the retry-queue drain and regressed-reopen mechanics, label bootstrapping, the interactive filing gate, and the Type-expression branch.

Read this when a run actually reaches Step 7 — a firing that finds nothing due, or emits no surviving findings, never needs it.

---

**Step 7 — FILE.**

Every harness-health record files onto the unified work record (`skills/_shared/work-record.md`): origin `by:harness-health`; classification folds into the scoring axis instead of staying a producer-specific label the gate must know:

| Classification | risk | size |
|---|---|---|
| `additive` | `risk:low` | `size:low` |
| `restructural` | `risk:medium` | `size:high` |
| kind `new-skill` (no classification-driven scoring) | unscored — no `risk:*` label | unscored — no `size:*` label |

`new-skill` candidates file with no scoring labels by design — there is no classification-driven
tier to guess from a kind that carries no scoring evidence. `/claude-tweaks:assess-agent-autonomy`'s
`grant-check` mode (`backlog refine`'s grant sub-stage) recognizes a `new-skill` finding from its body content
directly (it reads "**New skill candidate**" with a "Proposed new skill" deliverable) rather than
depending on a scoring label being present, and can still recommend `auto:build` for a
well-specified proposal — building the draft autonomously is reasonable, since a human confirms the
grant and reviews again before any merge — while recommending against `auto:merge`, since a new
skill file shapes future agent behavior regardless of how clean the diff looks. Every filed finding
is **born-`ready`** — harness-health findings are agent-sized and spec-shaped by construction
(Current State / Deliverables / Acceptance Criteria), so they file with the `ready` label already
applied and appear directly in the authorization gate's worklist, skipping maturation. `toIssuePayload` (`bin/lib/harness-health/issue-payload.js`) assembles the payload via `record.js`'s `recordPayload`, then appends the classification/kind-derived diagnostic label (`harness-health:additive` / `harness-health:restructural` / `harness-health:new-skill`) after the canonical labels — the emitted label set is exactly `by:harness-health` + scoring (when present) + `ready` + the diagnostic label, matching the table above.

**Materiality floor, before the cap digest.** Before the drain-rate cap check below, apply `_shared/materiality-floor.md`'s floor test to any survivor whose Step 6 decision is `'file'` (folding in this file's own classification-to-scoring mapping — `additive` -> `risk:low`/`size:low`, `restructural` -> `risk:medium`/`size:high`, `new-skill` unscored by design, so its axes cannot be judged low — per the contract's fail-toward-filing rule it always clears the materiality floor and files as an ordinary issue, never eligible for the digest): a finding that fails to clear the materiality floor routes to the materiality floor's own shared digest container instead — never to `harness-health`'s per-origin `{PREFIX}:digest` cap issue described below, a separate mechanism. Only a survivor that clears the materiality floor proceeds to the cap check.

**Drain-rate cap and digest mode.** Before filing any survivor whose Step 6 decision is `'file'`, apply the `health-open-cap` throttle per `_shared/health-filing-digest.md`'s FILE-step shape (`{PREFIX}` = `harness-health`) — at or above the cap, the finding is appended to `harness-health`'s digest issue instead of filed as a new singleton. A `'reopen'` decision (regression) always bypasses the cap.

Before filing this firing's own new findings, drain the durable retry queue from prior firings' filing failures and check for regressed reopens (see `_shared/health-state.md`) — both mechanics below follow the canonical shape in `_shared/health-filing-mechanics.md` (`{BINARY}` = `harness-health.js`, `{PREFIX}` = `harness-health`); check that file when either changes to keep this skill's copy in sync with its three siblings. Each drained retry payload is also subject to the same cap check above before its `gh issue create` attempt. Resolve this run's session-scoped temp path first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HARNESS_HEALTH_RETRY_PAYLOADS=harness-health-retry-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" retry-queue drain --root . > "$HARNESS_HEALTH_RETRY_PAYLOADS"
```

For each payload in `$HARNESS_HEALTH_RETRY_PAYLOADS`, attempt `gh issue create` exactly as below. Track every attempt's outcome (retry-queue payloads AND any brand-new payload from this step's own filing loop that fails) as `[{ fingerprint, payload, ok: true }]` or `[{ fingerprint, payload, ok: false, error: "<gh's error output>" }]`, write to this run's session-scoped `harness-health-retry-results.json`, then re-resolve both session-scoped paths this fence needs (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" HARNESS_HEALTH_RETRY_RESULTS=harness-health-retry-results.json HARNESS_HEALTH_ESCALATED=harness-health-escalated.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" retry-queue update "$HARNESS_HEALTH_RETRY_RESULTS" --root . > "$HARNESS_HEALTH_ESCALATED"
```

If `$HARNESS_HEALTH_ESCALATED` is non-empty, file (or update) a `harness-health:filing-failed` issue for each entry, naming the stuck fingerprint and its failure history — bootstrap that label the same way as the others below.

Before filing, bootstrap only the label families this run applies, with real descriptions — using the shared helper so a too-long description fails loudly here rather than as a 422 on `gh issue create`. Canonical pairs copied verbatim from `_shared/label-bootstrap.md`'s `LABELS_JSON`, plus harness-health's own diagnostic labels:

```bash
# Bootstrap per _shared/label-bootstrap.md, LABELS_JSON =
# [["by:harness-health", "Origin: filed by the harness-health skill", "BFD4F2"],
#  ["risk:low",          "Scoring: low blast radius — safe for autonomous build", "0E8A16"],
#  ["risk:medium",       "Scoring: moderate blast radius — review before merge recommended", "FBCA04"],
#  ["size:low",          "Scoring: small, agent-sized change", "D4C5F9"],
#  ["size:high",         "Scoring: large change — consider decomposition before building", "5319E7"],
#  ["ready",             "Stage: spec-shaped and agent-sized — in the authorization gate's worklist", "2EA44F"],
#  ["upstream-candidate", "A headless health-sweep finding about claude-tweaks — forward via /claude-tweaks:feedback", "0052CC"],
#  ["harness-health:additive",     "Safe, mechanical patch - additive change with no removed behavior", "0E8A16"],
#  ["harness-health:restructural", "Structural change requiring human review before applying", "FBCA04"],
#  ["harness-health:new-skill",    "Proposes a new skill candidate surfaced by harness-health", "7057FF"],
#  ["harness-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention", "D93F0B"]]
```

Each payload in `$HARNESS_HEALTH_PAYLOADS` (SKILL.md Step 6's session-scoped output, `_shared/session-tmp-root.md`) carries structured fields, not just the GitHub issue text — `id`, `kind`, `target`, `assetType`, `category`, `section`, `classification`, `confidence`, `reversibility`, and `intent` are all present directly on the payload object, alongside `title`, `body`, `labels`, and `type`. These stay on the payload as triage metadata — nothing here branches on them anymore, though Step 7's batch table renders `category`/`classification`/`confidence`/`reversibility` as columns. The finding's `oldString`/`newString` patch text is deliberately **not** duplicated as top-level fields: `payload.body` already carries both verbatim in its fenced Current/Proposed (or "Remove this content") blocks, and that markdown is what ships to GitHub. Read the patch out of `body` if you need it. `intent` is the exception that stays: it is a one-word classification rather than duplicated content, and with `newString` gone it is the only top-level signal distinguishing a removal from a replacement.

For a payload whose fingerprint marker (embedded in `payload.body`, read via `extractFingerprint`) matches a `status: "regressed"` entry in `.claude-tweaks/harness-health/cache.json` after this run, the finding was previously closed and has reappeared — reopen the existing issue instead of filing a new one:

```bash
gh issue reopen <issue_number>
gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"
```

`<issue_number>` is that cache entry's `issue` field.

**Interactive mode only — the ask-before-file gate.** Before filing this firing's own new findings (not the retry-queue drains or regressed reopens above, which already executed unconditionally), read `_shared/health-filing-gate.md` and follow its two-tier decision, using its per-consumer batch table's `harness-health` row for the table columns and the Recommended pre-fill rule.

**Headless (Routine) runs skip this gate entirely** — do not read that file — per `_shared/health-filing-gate.md`'s applicability rule; every surviving finding files automatically, with no human to route it through a table.

For each survivor disposed as "File issue" (every payload if "Apply all recommended" was chosen and its Recommended value was `"File issue"`; only the individually-overridden ones otherwise), call `gh issue create`.

**Type expression branch** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings). Read the project's `work-types` config key once before filing and branch — never re-probe mid-flow (`_shared/work-record.md`'s config-key table; the key is written by `/init`). `work-types: native` applies `payload.type` (always `task`) via GitHub's native Issue Type; `work-types: labels` adds the matching `type:task` label instead (the pair lives in `record.js`'s `TYPE_LABELS`):

```bash
# Example: an additive finding, work-types: native
gh issue create --title "<payload.title>" --body "<payload.body>" --type task \
  --label by:harness-health --label risk:low --label size:low --label ready --label harness-health:additive

# Same finding, work-types: labels
gh issue create --title "<payload.title>" --body "<payload.body>" \
  --label by:harness-health --label risk:low --label size:low --label ready --label harness-health:additive --label type:task
```

**Exception — a headless D5 finding.** When the subject check routed this finding to D5 and no human is present to clear `/claude-tweaks:feedback`'s confirmation gate, this payload is the one case where the label set differs: apply `upstream-candidate` plus `by:harness-health`, and omit `ready`, `risk:*` and `size:*` entirely. It is not this project's work to build. See `skills/_shared/learning-routing.md`'s "Subject check (health sweeps)".

Apply the same branch to every payload regardless of classification/kind — a `restructural` payload's call carries `risk:medium`/`size:high`/`harness-health:restructural` instead, and a `new-skill` payload's call carries only `by:harness-health`/`ready`/`harness-health:new-skill` (no scoring labels), per the mapping table above; only the `--type task` vs. `--label type:task` branch and the `--label` list change, never the underlying `gh issue create --title/--body`. This applies uniformly — CLAUDE.md findings, design-artifact findings, additive skill/rule patches, restructural patches, and new-skill candidates all file the same way. `/harness-health` never edits anything directly; matching `/code-health`, it only ever judges and files.

**Recent-commit overlap check.** Immediately after each `gh issue create` above succeeds for a new finding, run `_shared/health-recent-commit-check.md` and apply it in full — it screens the just-filed finding against recently-merged commits and, on a strong match, posts a triage comment rather than blocking or reopening anything.

In `--dry-run` mode, print what would be filed or reopened, and the `gh` commands that would run, but do not call `gh`.
