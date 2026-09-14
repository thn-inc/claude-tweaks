# Code Health — Step 9: FILE / REOPEN ISSUES

The full filing procedure for `/claude-tweaks:code-health` Step 9, lazy-loaded from `SKILL.md`. Covers the born-`ready` rule, the drain-rate cap and digest mode, the retry-queue drain and regressed-reopen mechanics, label bootstrapping, the interactive filing gate, and the Type-expression branch.

Read this when a run actually reaches Step 9 — a firing that emits no surviving findings never needs it.

---

**Step 9 — FILE / REOPEN ISSUES.**

Every code-health record files onto the unified work record (`skills/_shared/work-record.md`): origin `by:code-health`; `finding.risk` maps to the `risk:{value}` label; `finding.effort` maps to the `size:{value}` label; Type is always `task`. Every filed finding is **born-`ready`** — code-health findings are agent-sized and spec-shaped by construction (Current State / Deliverables / Acceptance Criteria, verified by the Step 7 gate), so they file with the `ready` label already applied and appear directly in the authorization gate's worklist, skipping maturation. `toIssuePayloadV2` (`bin/lib/code-health/issue-payload.js`) assembles the payload via `record.js`'s `recordPayload` — the emitted label set is exactly `by:code-health`, `risk:<tier>`, `size:<tier>`, `ready` (no per-criterion label).

**Materiality floor, before the cap digest.** Before the drain-rate cap check below, apply `_shared/materiality-floor.md`'s floor test to any survivor whose Step 8 decision is `'file'` (with `risk`/`size` judged the same way this file already scores them for `recordPayload`, and no `priority` axis stamped by this skill — judge it as the routing skill per that contract's own rule): a finding that fails to clear the materiality floor routes to the materiality floor's own shared digest container instead — never to `code-health`'s per-origin `{PREFIX}:digest` cap issue described below, a separate mechanism. Only a survivor that clears the materiality floor proceeds to the cap check.

**Drain-rate cap and digest mode.** Before filing any survivor whose Step 8 decision is `'file'`, apply the `health-open-cap` throttle per `_shared/health-filing-digest.md`'s FILE-step shape (`{PREFIX}` = `code-health`) — at or above the cap, the finding is appended to `code-health`'s digest issue instead of filed as a new singleton. A `'reopen'` decision (regression) always bypasses the cap.

Before filing this firing's own new findings, drain the durable retry queue from prior firings' filing failures and check for regressed reopens (see `_shared/health-state.md`) — both mechanics below follow the canonical shape in `_shared/health-filing-mechanics.md` (`{BINARY}` = `code-health.js`, `{PREFIX}` = `code-health`); check that file when either changes to keep this skill's copy in sync with its three siblings. Each drained retry payload is also subject to the same cap check above before its `gh issue create` attempt. Resolve this run's session-scoped temp paths first, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CODE_HEALTH_RETRY_PAYLOADS=code-health-retry-payloads.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/code-health.js" retry-queue drain --root "${ROOT:-$PWD}" > "$CODE_HEALTH_RETRY_PAYLOADS"
```

For each payload in `$CODE_HEALTH_RETRY_PAYLOADS`, attempt `gh issue create` exactly as below. Track the outcome of every attempt (this firing's retry-queue payloads AND any brand-new payload from Step 9's own filing loop that fails) as `[{ fingerprint, payload, ok: true }]` or `[{ fingerprint, payload, ok: false, error: "<gh's error output>" }]`, write to this run's session-scoped `code-health-retry-results.json`, then re-resolve both session-scoped paths this fence needs (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CODE_HEALTH_RETRY_RESULTS=code-health-retry-results.json CODE_HEALTH_ESCALATED=code-health-escalated.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/code-health.js" retry-queue update "$CODE_HEALTH_RETRY_RESULTS" --root "${ROOT:-$PWD}" > "$CODE_HEALTH_ESCALATED"
```

This records successes (removed from the queue) and failures (added/incremented) in one durable write. If `$CODE_HEALTH_ESCALATED` is non-empty, file (or update) a `code-health:filing-failed` issue for each entry, naming the stuck fingerprint and its failure history — bootstrap that label the same way as the others below.

Before filing, bootstrap only the label families this run applies, with real descriptions — using the shared helper so a too-long description fails loudly here rather than as a 422 on `gh issue create`. Pairs copied verbatim from `_shared/label-bootstrap.md`'s canonical `LABELS_JSON`:

```bash
# Bootstrap per _shared/label-bootstrap.md, LABELS_JSON =
# [["by:code-health", "Origin: filed by the code-health skill", "BFD4F2"],
#  ["risk:low",        "Scoring: low blast radius — safe for autonomous build", "0E8A16"],
#  ["risk:medium",     "Scoring: moderate blast radius — review before merge recommended", "FBCA04"],
#  ["risk:high",       "Scoring: high blast radius — human review required", "D93F0B"],
#  ["size:low",        "Scoring: small, agent-sized change", "D4C5F9"],
#  ["size:medium",     "Scoring: moderate change, may span several files", "8B5CF6"],
#  ["size:high",       "Scoring: large change — consider decomposition before building", "5319E7"],
#  ["ready",           "Stage: spec-shaped and agent-sized — in the authorization gate's worklist", "2EA44F"],
#  ["upstream-candidate", "A headless health-sweep finding about claude-tweaks — forward via /claude-tweaks:feedback", "0052CC"],
#  ["code-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention", "D93F0B"]]
```

There is no per-criterion label anymore — the criterion is already in the issue body's header line (`**Criterion:** ...`), and nothing reads it back off a label; this was also the label class that hit GitHub's 100-char cap (see `bin/lib/code-health/issue-payload.js`).

**Subject check before filing.** Apply the "Subject check (health sweeps)" section of `skills/_shared/learning-routing.md` — a finding about a claude-tweaks skill is a D5 learning routed to `/claude-tweaks:feedback`, not a project issue.

For a payload whose fingerprint marker (embedded in `payload.body`, read via `extractFingerprint`) matches a `status: "regressed"` entry in `.claude-tweaks/code-health/cache.json` after this run, the finding was previously closed and has reappeared — reopen the existing issue instead of filing a new one:

```bash
gh issue reopen <issue_number>
gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"
```

`<issue_number>` is that cache entry's `issue` field.

**Interactive mode only — the ask-before-file gate.** Before filing this firing's own new findings (not the retry-queue drains or reopen decisions above, which already executed unconditionally), read `_shared/health-filing-gate.md` and follow its two-tier decision, using its per-consumer batch table's `code-health` row for the table columns and the Recommended pre-fill rule (including the `possiblyStale` → `"Capture"` override).

**Headless (Routine) runs skip this gate entirely** — do not read that file — per `_shared/health-filing-gate.md`'s applicability rule; every surviving finding files automatically, with no human to route it through a table. The one exception is a finding still flagged `possiblyStale` after Step 7.5: hold it back rather than filing it blind. Drop it from the filing set (log the drop reason) instead of calling `gh issue create` for it — the slice's next scheduled sweep will re-judge the same content and, if the finding still holds against then-current evidence, file it then.

For each survivor disposed as "File issue" (every payload if "Apply all recommended" was chosen and its Recommended value was `"File issue"`; only the individually-overridden ones otherwise), call `gh issue create`. The engine is emit-only; filing is always done by the skill.

**Type expression branch** (canonical shape in `_shared/health-finding-shapes.md` — check that file when either changes to keep this skill's copy in sync with its three siblings). Read the project's `work-types` config key once before filing and branch — never re-probe mid-flow (`_shared/work-record.md`'s config-key table; the key is written by `/init`). `work-types: native` applies `payload.type` (always `task`) via GitHub's native Issue Type; `work-types: labels` adds the matching `type:task` label instead (the pair lives in `record.js`'s `TYPE_LABELS`):

```bash
# work-types: native
gh issue create \
  --title "<payload.title>" \
  --body "<payload.body>" \
  --type task \
  --label by:code-health \
  --label "risk:<tier>" \
  --label "size:<tier>" \
  --label ready

# work-types: labels
gh issue create \
  --title "<payload.title>" \
  --body "<payload.body>" \
  --label by:code-health \
  --label "risk:<tier>" \
  --label "size:<tier>" \
  --label ready \
  --label type:task
```

**Exception — a headless D5 finding.** When the subject check routed this finding to D5 and no human is present to clear `/claude-tweaks:feedback`'s confirmation gate, this payload is the one case where the label set differs: apply `upstream-candidate` plus `by:code-health`, and omit `ready`, `risk:*` and `size:*` entirely. It is not this project's work to build. See `skills/_shared/learning-routing.md`'s "Subject check (health sweeps)".

Apply the same branch to every payload regardless of criterion — only the `--type task` vs. `--label type:task` branch changes; the `risk`/`size` tier labels and the underlying `gh issue create --title/--body` never do.

**Recent-commit overlap check.** Immediately after each `gh issue create` above succeeds for a new finding, run `_shared/health-recent-commit-check.md` and apply it in full — it screens the just-filed finding against recently-merged commits and, on a strong match, posts a triage comment rather than blocking or reopening anything.

In `--dry-run` mode, print the payloads and the `gh` commands that would run, but do not call `gh`.
