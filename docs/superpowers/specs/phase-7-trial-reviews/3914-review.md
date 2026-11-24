## Review: #3914 — Decide whether shipped routine templates must share one model value (PR #6215)

**Review effort:** low (derived from record labels: risk:low × size:low; diff heuristic agrees: 2 files, 25 lines, test + docs only; no `review-effort-floor` set)

Run context: standalone `/claude-tweaks:review 3914` in the pipeline driver's worktree (`$PIPELINE_RUN_DIR` unset). The record is `ceremony:fast-lane` and the build's run config reads `ceremony-profile: fast-lane`, but a standalone review runs every step, so Steps 1 and 4 ran.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| Ruling: a per-template `model` is supported but must be declared; a silent mismatch is a half-finished migration | done (test header comment + schema row) |
| `ROUTINE_DEFAULT_MODEL` + `MODEL_OVERRIDES` (`{ model, reason }`, empty) in `tests/routine-template-schema.test.js`; each template equals the default or its own override; stale override entries (unknown template, or model equal to the default) fail | done |
| `_shared/routine-template-schema.md`'s `model` row states shared default + declared override + migrate-all-in-one-change | done |

| Acceptance Criterion | Status |
|---------------------|--------|
| Changing one template's `model` with no override entry fails the suite, and the failure names that template | met (mutation run: `release/routine-template.yml model is 'claude-opus-5-5' but the shared default is 'claude-sonnet-5-5' …`) |
| Adding a matching `MODEL_OVERRIDES` entry with a reason makes it pass | met (mutation run: 16/16 pass) |
| A stale override entry (unknown template, or model equal to the default) fails | met (mutation runs: `names no shipped template` / `equals the shared default`) |
| Schema `model` row states the shared-default-plus-declared-override rule | met |
| `npm test` passes | met (PR CI green on 085fb40; impact-selected `npm test` after the review fix: 5360 tests, 5359 pass, 0 fail, 1 skipped) |

Non-Goals: none violated (no schema/parser change; live routine records and `record-freshness.md` untouched). Risk markers: none open (Gotchas are notes, not unvalidated assumptions). Current-State outcome reach: the named gap — a half-migrated template tree passing the suite — is closed, proven by the AC1 mutation. Cross-Spec Promises (Step 1.6): no parent record — skipped.

All mutation checks ran in a `git archive` extract under the session scratchpad through `tools/run-tests.js`, never in the linked worktree.

### Verification (from /test)
- Runner stamp: `verifiedHead: true` at 085fb40 (scoped run on a valid `fullSha` 88cdbe8); PR #6215 CI green on that head (4 shards + `test`).
- After the review fix: impact-selected `npm test` exit 0 — 5360 tests, 5359 pass, 0 fail, 1 skipped. PR CI for the new head 3736da6 had not reported when this review ended.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| error | `tests/routine-template-schema.test.js:105` — the model failure message always named `ROUTINE_DEFAULT_MODEL` as expected, even when the assertion compared against the template's own `MODEL_OVERRIDES` entry, so a template drifting from its override was told to expect the default and to add an override it already had. Reproduced by execution: template `claude-opus-5-5`, override `claude-fable-5-2` → message said "the shared default is 'claude-sonnet-5-5'". | low | fixed (3736da6) |
| error | `tests/routine-template-schema.test.js:144` — the override-entry test never checked `entry.model`; an entry with no `model` key passed it (`notEqual(undefined, default)`) and only failed later in the per-template test with the wrong-cause message. | low | fixed (3736da6) |

Both findings came from lens 3c's single read (low tier). The tiebreak judge confirmed both, but the resolver did not accept the evidence (see Tiebreak). They were fixed anyway, so this is a deliberate deviation from the procedure, stated here. Finding 1 had execution evidence independent of the tiebreak, the record's own Gotcha asks that the failure message point the migration author at the exact problem, and each fix is a two-line test-only change. After the fix: the drift case reads "its MODEL_OVERRIDES entry declares 'claude-fable-5-2'", and a model-less entry fails with "MODEL_OVERRIDES['release'] needs a model". All five AC mutations still behave as specified.

Lens 3b (Security): No findings.

### Tiebreak
**Verdicts:** 0 confirmed · 0 dropped · 2 digest · 0 console
- tests/routine-template-schema.test.js:105 — model failure message names the default instead of the override's model (low) — resolver: `digest`, reason `evidence-unverified`; judge verdict `confirmed`, Recommendation: file — "one-line fix is to name `expectedModel` in the message".
- tests/routine-template-schema.test.js:144 — override-entry test does not require `entry.model` (low) — resolver: `digest`, reason `evidence-unverified`; judge verdict `confirmed`, Recommendation: file — "add a non-empty-string check next to the `reason` check".

Why `evidence-unverified`: both cited source lines contain backticks (template literals), and the judge backslash-escaped them inside its backtick-quoted Evidence span. The quotes therefore did not match the file byte for byte. This is a quoting limitation, not doubt about the finding.

### Fan-out leftovers
None (no new untracked files; `agent-scratch/` empty).

### Implementation Hindsight
No changes needed — approach is sound. The default-plus-declared-override map is exactly the record's ruling. Keeping the constants in the test follows its Gotcha. Shipped prose that cites a maintainer-side `tests/*.test.js` file is established practice (57 skill files already do it).

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| The rule's constants (`ROUTINE_DEFAULT_MODEL`, `MODEL_OVERRIDES`) live in a maintainer-side test that does not ship, while the shipped schema doc points at them | Record's Gotcha: the model-profile table uses aliases, not versioned ids, so it cannot be the source; only maintainers migrate shipped templates, and they have the test |
| Acted on two tiebreak-`digest` findings | See Code Review Findings: execution evidence plus a judge `confirmed`; the digest came from a quote-format mismatch |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (surface: infra) and no UI trigger file in the diff"; journeys whose `files:` overlapped: attach-a-github-webhook-trigger, create-a-one-off-routine, opt-out-of-project-scope-claude-tweaks-declaration, respond-to-kernel-stale-drift

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).
Security Hardening, Agent Trust Scope, App Store Readiness: pre-checks skipped (no client/route files, neither config file, no mobile-app files in scope).

### Code Simplification
| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | tests/routine-template-schema.test.js | Replaced the two parallel `override ?` ternaries in the review fix's model assertion with one if/else and a shared message prefix | -6/+12 |

Verification: pass. The change is folded into commit 3736da6; it stays inside the review-fix lines.

### Skill Load Delta
Skill load delta (base 88cdbe8 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 41 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +38 more | 1,944–52,110 | 0 | 7,468,802–7,509,404 | +358 | — |

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Model failure message names the override's declared model when a template has an override — `tests/routine-template-schema.test.js` | `3736da6` |
| Bug fix | Override-entry test requires a non-empty `model` — `tests/routine-template-schema.test.js` | `3736da6` |
| Simplified | One if/else in place of two parallel ternaries in the model assertion — `tests/routine-template-schema.test.js` | `3736da6` |

Pushed to `drive-record-3914` (PR #6215 head now 3736da6). The PR stays a draft: it was not merged, closed or marked ready, and no wrap-up was run. No PR verdict comment was posted. This standalone review has no run directory, and the trial rules allow only fix commits and pushes.

### Key Learnings
1. The tiebreak resolver cannot verify an evidence quote of a source line that contains backticks (any JS template literal): the judge escapes them inside a backtick code span, and the byte-exact match fails as `evidence-unverified`. Real, confirmed findings on template-literal lines therefore land as `digest`. This is worth a resolver or prompt fix (for example, accept `\``-unescaped quotes, or ask for the quote in a fenced block).
2. A low-tier single-read lens agent reported bundle-relative line numbers (171/210 for real lines 105/144) despite the file-native instruction. Re-resolving `Path:Line` with `grep -n` before writing tiebreak entries remains necessary.
3. A pipeline driver's express-lane build met every AC but left both failure-message gaps. The record's own Gotcha ("keep the failure message naming the template and its value") was satisfied only for the default branch. A test that asserts against a computed expected value needs its message to name that computed value.
