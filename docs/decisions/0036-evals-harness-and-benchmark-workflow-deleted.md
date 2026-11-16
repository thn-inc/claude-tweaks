# 0036. The evals harness and its benchmark workflow are deleted

- **Status:** accepted
- **Date:** 2026-11-15
- **Context:** #5561

## Context

`evals/` was a separate Node project (102 tracked files, its own `package.json`) that ran skill scenarios against a live model through the Claude Agent SDK. By 2026-11-15 it was dormant:

- Its last commit was `57da82f41`, 2026-08-30.
- Its last recorded result, the final line of `evals/history.jsonl`, started on 2026-08-09.
- `.github/workflows/eval-benchmark.yml` was manual-dispatch only and offered six of the directory's 22 scenarios. GitHub shows one run of it (2026-10-09), which failed at its scenario step because the runner had neither `bwrap` nor `socat`, so the harness's required sandbox was unavailable. That is a gap in the harness's environment, not a plugin regression.
- Its 15 test files never ran in root CI. `npm test` covers `tests/` and `tools/upstream-drift/tests/` only.

Shipped skill text and code comments still cited eval scenario files, some as incident evidence and one, in two places in `plugin/skills/sweep/SKILL.md`, as what pinned or enforced sweep's boundary, although nothing had run those scenarios since August.

## Decision

Delete `evals/` and `.github/workflows/eval-benchmark.yml`. Do not replace them with another eval system in this change. Repair every reference outside `evals/` that pointed into it, so no shipped text names a file that does not exist or claims a check that does not run.

## Consequences

- No scenario-level regression check exists. Nothing tests that a live model respects a skill's stated boundary.
- Sweep's "never claims, builds, or merges" boundary: its statement in `plugin/skills/sweep/SKILL.md` is pinned by `tests/sweep-orchestrator.test.js`, which runs in CI. That test pins the wording, not a model's behavior.
- The permission-matrix-compliance and local-files preflight-stop scenarios have no CI replacement. The paragraphs they exercised, in `plugin/skills/backlog/SKILL.md`'s grant sub-stage, `plugin/skills/_shared/autonomy-ceiling.md` and `plugin/skills/_shared/local-files-preflight-stop.md`, are no longer regression-tested. They keep their sentences about the incidents, which remain the evidence.
- Six `main()` shim comments under `plugin/bin/` name `evals/` as an importer scope. That scope ceased to exist on this date; #5535 and #5536 delete the shims.
- `evals/NOTES.md` is now `docs/reference/agent-sdk-payload-notes.md`, which keeps the three sections cited from outside the harness.
- The `ANTHROPIC_API_KEY` Actions secret is used by no workflow. Whether to delete it is the maintainer's call.
- The harness's history is in git at the parent of the commit that deleted it, which landed through pull request #5581.
