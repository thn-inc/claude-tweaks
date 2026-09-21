# Staged: Close (GitHub) — bookkeeping-only verify deltas already resolve to `none` (#1922/#1923, PR #1938)

**Finding:** `[gh-issue]` #1801 (feedback, plugin 6.114.0) asks that a commit confined to pipeline bookkeeping files (`docs/plans/*-ledger.md`, `.claude-tweaks/pipelines/**/work/*.md`) not invalidate the verify-pass stamp and force a full re-run at the next multi-spec test gate. Its option (a) shipped: #1922 (closed 2026-09-07) added `verify.js --scope` with `bin/lib/verify/scope.js` (a delta whose files all map to no suite resolves `mode: 'none'`, and a `none` run still stamps `verifiedHead`), #1923 (closed 2026-09-07) wired `test/verification.md`'s scoping table with the row "Multi-spec spec-N `test` step — scoped (`none` on a bookkeeping-only delta)", and commit `8ea07f111` (PR #1938, merged 2026-09-07) made `flow/multi-spec.md` cite #1801 by number: "a bookkeeping-only delta (ledger rows, `work/*-spec.md`) resolves to `none`, logging `still-verified: bookkeeping-only delta ({paths})`". `init`'s starter `.claude-tweaks/verify-scope.json` (bootstrap step 6.6) maps the four bookkeeping globs to no suite, so a project scaffolded by `/claude-tweaks:init` gets this without hand-editing; a project with no declaration still runs full, by design (fail-closed). #1801 stayed open because the PR referenced it with `refs`, not a closing keyword.

**Proposed:** Close #1801 as completed — implemented by #1922/#1923 (PR #1938).

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1801 — implemented by #1922 + #1923 (both closed 2026-09-07, PR #1938); `flow/multi-spec.md` cites #1801 at its spec-N verification paragraph; the reporting project needs a `.claude-tweaks/verify-scope.json` (run `/claude-tweaks:init --update`) to benefit

**Commands:**
gh issue comment 1801 --body "Closing as implemented: #1922 (verify.js --scope, bin/lib/verify/scope.js resolves a delta with no suite-mapped files to mode none and still stamps verifiedHead) and #1923 (test/verification.md's scoping table row for the multi-spec spec-N test step, flow/multi-spec.md's 'still-verified: bookkeeping-only delta' line, which cites this record) shipped in PR #1938 on 2026-09-07. init's starter .claude-tweaks/verify-scope.json maps docs/plans/*-ledger.md and .claude-tweaks/pipelines/** to no suite; a project without a declaration still runs full by design — run /claude-tweaks:init --update to scaffold one. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1801 --reason completed
