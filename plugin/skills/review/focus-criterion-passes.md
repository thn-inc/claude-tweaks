# Code-Mode Procedure — Focus-Criterion Component Passes (Steps 6.6, 6.65, 6.66)

Split out of `code-mode-steps.md` (#2628) to stay under the per-file byte ceiling — these three steps are code-health focus-criterion passes reused directly inside `/claude-tweaks:review`'s Code-Mode Procedure, between Step 6.5 (Design Quality Pass) and Step 6.7 (Late Findings Routing). Loaded by `code-mode-steps.md` at that point in the procedure; step numbering is unchanged by the split.

## Step 6.6: Security Hardening Pass (#2624)

Pre-check: skip this step entirely (no section in the summary) when this review's diff scope (Step 2's own-work file list, or the full `git diff --name-only` set) touches no file matching `bin/lib/code-health/candidates-security-hardening.js`'s `CLIENT_DIR_RE` or `ROUTE_DIR_RE` path heuristics — a review with no client-side or route/handler files in scope has nothing this pass could find.

Otherwise, invoke the `security-hardening` focus criterion as a component skill: run the generator directly against this repo's working tree —

```bash
node -e "const {scanSecurityHardening}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/candidates-security-hardening.js'); console.log(JSON.stringify(scanSecurityHardening(process.cwd())))"
```

— then judge each returned candidate against `_shared/criteria-security-hardening.md` (loaded via `getCriterion('security-hardening')`, `bin/lib/code-health/criteria.js`), scoped to the files this review's diff actually touches (a candidate outside the diff scope is noise for a per-review pass, even if the generator found it repo-wide — this is a lighter-weight invocation than a full `/claude-tweaks:code-health focus=security-hardening` sweep, which scans and files issues repo-wide on its own schedule; this step never files a GitHub issue itself).

**Result handling:**

| Outcome | Review behavior |
|---|---|
| One or more candidates judged as real findings | Include them in the summary as a "Security Hardening" section (kind, file:line, severity per the criteria fragment's calibration). Findings are advisory — same posture as Step 6.5's design findings. |
| Candidates found but none survive judgment (false positives per the criteria fragment's "What NOT to flag") | Omit the section; note in the summary footer that the pass ran and found nothing actionable. |
| Pre-check skipped (no client/route files in scope) | Omit the section entirely — no footer note, same as Step 6.5's non-frontend skip. |

**Routing (optional):** actionable security-hardening findings the user wants to action inline route through Step 6.7 below, in the same consolidated pass as Step 6's visual findings, Step 6.5's design findings, and Step 6.65's agent-trust-scope findings. When the user opts not to action them inline, they remain in the Security Hardening summary section as informational — a finding the user declines is a signal for a follow-up record, not proof the risk isn't real, per this repo's "no implicit deferrals" convention (CLAUDE.md).

## Step 6.65: Agent Trust Scope Pass (#2749)

Pre-check: skip this step entirely (no section in the summary) when this review's diff scope (Step 2's own-work file list, or the full `git diff --name-only` set) touches neither `.claude/settings.json` nor `.claude-tweaks/policy.yml` — a review that touches neither file has nothing this pass could find, since those are the only two files `candidates-agent-trust-scope.js` reads.

Otherwise, invoke the `agent-trust-scope` focus criterion as a component skill: run the generator directly against this repo's working tree —

```bash
node -e "const {scanAgentTrustScope}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/candidates-agent-trust-scope.js'); console.log(JSON.stringify(scanAgentTrustScope(process.cwd())))"
```

— then judge each returned candidate against `_shared/criteria-agent-trust-scope.md` (loaded via `getCriterion('agent-trust-scope')`, `bin/lib/code-health/criteria.js`). Unlike Step 6.6's per-file candidates, this generator's output already reflects the whole project's current config (it reads exactly two repo-root files, never diff-scoped) — this step never files a GitHub issue itself, and is a lighter-weight invocation than a full `/claude-tweaks:code-health focus=agent-trust-scope` sweep, which runs on its own schedule.

**Result handling:**

| Outcome | Review behavior |
|---|---|
| `notApplicable: true` (no `.claude-tweaks/policy.yml`) | Omit the section entirely — not applicable, not a pass. No footer note (same as Step 6.5's non-frontend skip). |
| One or more candidates judged as real findings | Include them in the summary as an "Agent Trust Scope" section (dimension, file, severity per the criteria fragment's calibration). Findings are advisory — same posture as Step 6.5's design findings and Step 6.6's security-hardening findings. |
| Candidates found but none survive judgment (per the criteria fragment's "What NOT to flag") | Omit the section; note in the summary footer that the pass ran and found nothing actionable. |
| Zero candidates, `notApplicable: false` (autonomy not elevated, or deny list already covers all three dimensions) | Omit the section; note in the summary footer that the pass ran clean. |
| Pre-check skipped (diff touches neither config file) | Omit the section entirely — no footer note. |

**Routing (optional):** actionable agent-trust-scope findings the user wants to action inline route through Step 6.7 below, in the same consolidated pass as Step 6's visual findings, Step 6.5's design findings, and Step 6.6's security-hardening findings. When the user opts not to action them inline, they remain in the Agent Trust Scope summary section as informational — a finding the user declines is a signal for a follow-up record, not proof the risk isn't real, per this repo's "no implicit deferrals" convention (CLAUDE.md).

## Step 6.66: App Store Readiness Pass (#2628)

Pre-check: skip this step entirely (no section in the summary) when this review's diff scope (Step 2's own-work file list, or the full `git diff --name-only` set) shows no mobile-app signal — no `app.json`, no `.xcodeproj`/`.xcworkspace` path, no `android/app/build.gradle`, and no `package.json` change touching a `react-native`/`expo` dependency. A review with no mobile-app files in scope has nothing this pass could find.

Otherwise, invoke the `app-store-readiness` focus criterion as a component skill: run the generator directly against this repo's working tree —

```bash
node -e "const {scanAppStoreReadiness}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/candidates-app-store-readiness.js'); console.log(JSON.stringify(scanAppStoreReadiness(process.cwd())))"
```

— then judge each returned candidate against `_shared/criteria-app-store-readiness.md` (loaded via `getCriterion('app-store-readiness')`, `bin/lib/code-health/criteria.js`), scoped to the files this review's diff actually touches (a candidate outside the diff scope is noise for a per-review pass, even if the generator found it repo-wide — this is a lighter-weight invocation than a full `/claude-tweaks:code-health focus=app-store-readiness` sweep, which scans and files issues repo-wide on its own schedule; this step never files a GitHub issue itself). A `notApplicable: true` result (no mobile-app signal detected by the generator's own gate) is handled identically to the pre-check skip above — omit the section, no footer note.

**Result handling:**

| Outcome | Review behavior |
|---|---|
| `notApplicable: true` | Omit the section entirely — not applicable, not a pass. No footer note (same as Step 6.5's non-frontend skip). |
| One or more candidates judged as real findings | Include them in the summary as an "App Store Readiness" section (kind, file:line, severity per the criteria fragment's calibration). Findings are advisory — same posture as Step 6.5's design findings. |
| Candidates found but none survive judgment (false positives per the criteria fragment's "What NOT to flag") | Omit the section; note in the summary footer that the pass ran and found nothing actionable. |
| Pre-check skipped (no mobile-app files in scope) | Omit the section entirely — no footer note, same as Step 6.5's non-frontend skip. |

**Routing (optional):** actionable app-store-readiness findings the user wants to action inline route through Step 6.7 below, in the same consolidated pass as Step 6's visual findings, Step 6.5's design findings, Step 6.6's security-hardening findings, and Step 6.65's agent-trust-scope findings. When the user opts not to action them inline, they remain in the App Store Readiness summary section as informational — a finding the user declines is a signal for a follow-up record, not proof the risk isn't real, per this repo's "no implicit deferrals" convention (CLAUDE.md).
