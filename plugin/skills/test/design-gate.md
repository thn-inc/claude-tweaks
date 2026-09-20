Design CLI Gate — invocation, result handling, and reporting for `/claude-tweaks:test` Step 1.5. Read after confirming the step's skip conditions in SKILL.md do not apply.

# Design CLI Gate (Impeccable)

After types/lint/tests pass (or if they were skipped via `VERIFICATION_PASSED`), invoke the design wrapper to run the deterministic Impeccable CLI check on changed frontend files. This catches design anti-patterns (default-AI gradients, hard-coded pixel values, etc.) without LLM cost.

## Invocation

Resolve `<changed-files>` from `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --changed-files --integration-branch {ref}` (`{ref}` via `_shared/integration-branch.md`) — the same shared changed-file set `/test`'s own `affected`/QA paths read (`test/SKILL.md`); never hand-roll bare `git diff --name-only` for this step — it is empty on every committed pipeline diff (the `<changed-files>` list this gate ran on before #2005). Join the returned `files` with commas for the `--files` value below. On exit 1 (no resolvable base), fall back to `git diff --name-only HEAD~1..HEAD` unioned with the working tree's own uncommitted changes (`git diff --name-only`, no range) — never an empty list.

Before invoking the wrapper, run `_shared/design-wrapper-handling.md`'s "Caller-side pre-check" with `--mode test`, this resolved `<changed-files>` list, and this run's own resolved `--surface` (the single in-scope record's materialized `surface:` header field, when one is resolvable; omitted for a multi-record or standalone run) — so a run that the wrapper would have no-opped on anyway never pays for loading `design-wrapper/SKILL.md`. On `decision: "skip"`, treat exactly like the wrapper's own `{skipped: reason}` return in the Result handling table below — do not invoke `Skill(claude-tweaks:design-wrapper)` at all. On `decision: "proceed"`, invoke `/claude-tweaks:design-wrapper test <changed-files>` as before.

## Result handling

| Wrapper return | Test gate behavior |
|----------------|-------------------|
| `{result: "pass", findings: [...]}` (zero findings, or advisory only) | Proceed. Surface advisory findings in the test output as informational. |
| `{result: "fail", findings: [...]}` (any `severity: warning`) | **Fail the test gate.** Surface the findings table in the test report. Do NOT auto-fix — design findings require human judgment. |
| `{skipped: ...}` (from the wrapper, or from the pre-check's `decision: "skip"` above) | Note the skip reason in test output and proceed. |
| `{deferred: ...}` (should not happen for `test` mode) | Treat as skip and proceed. |

See `_shared/design-wrapper-handling.md` for the canonical return-shape contract and the "why skips don't fail" rationale.

## Reporting

How the Design CLI result surfaces depends on which Step 2 template is active:

- **Standard mode / All mode** (renders the `verification.md` Step 3 table) — add a "Design CLI" row to that table:

  ```markdown
  | Design CLI | {pass/fail/skipped} | {Xs} | {N findings: Y warning, Z advisory} or {skip reason} |
  ```

- **Pipeline mode** (`## Pipeline result (VERIFICATION_PASSED + no stories)` / `... + stories` in `report-templates.md` — bare status lines, no table) — append a `Design CLI: {pass/fail/skipped} ({N findings: Y warning, Z advisory} or {skip reason})` line to the pipeline result output.
- **Skip-QA mode** (bare status lines per Skip-QA mode's own report format in SKILL.md, not a `report-templates.md` template) — append the same `Design CLI: {pass/fail/skipped} ({N findings: Y warning, Z advisory} or {skip reason})` line to that report.

If `severity: warning` findings are present, append a Design Findings section before the standard test-failure section:

```markdown
### Design Findings (Impeccable CLI)

| File | Line | Antipattern | Severity | Description |
|------|------|-------------|----------|-------------|
| {file} | {line} | {antipattern} | warning | {description} |
```
