# Try It — the Human Walkthrough Block

Canonical definition of the `### Try it` block: the human-facing walkthrough of what a finished
run delivered — where to go, what to do, what to expect. Every surface that shows it cites this
file and renders the block verbatim; none restates its fields. Consumers:
`wrap-up/verification-brief.md` (composes it for every record), `wrap-up/verification-brief-parent-gate.md`
(the end-to-end variant for a decomposition parent), `flow/summary-template.md` and
`flow/multispec-summary.md` (render it in the Pipeline Summary), `demo/SKILL.md` and
`demo/entry-paths.md` (render it first, read back from the brief or the PR's `try-it` run comment;
compose it only when neither carries one).

Distinct from `_shared/observation-plan.md`: the observation plan is the agent's procedure — the
Prepare/Validate/Inspect commands `/claude-tweaks:demo` executes. This block is what a person reads
and does by hand. It borrows the observation plan's Entry point semantics for non-web surfaces; it
never replaces the plan.

## Shape

```markdown
### Try it

**{feature — one short name per thing the human can try}**
- Precondition: {what must be true first — deployed, data sync run, feature flag on, plugin updated — or `none`}
- Access: {the login tier or role needed, or `none`}
- Entry point: {the route or page to open, or the command to run}
- Steps:
  1. {one human action per numbered line — open, click, type, run}
- Expected: {the observable result that means it works}
```

One bold-named group per feature the run delivered — most records deliver one. The five field
lines keep this order.

## End-to-end variant

For a bundle (a multi-spec `/claude-tweaks:flow` run) or a decomposition parent: heading
`### Try it — end to end`, one group walking the primary path across the assembled specs or
sub-issues, the same five fields. Each step names the spec it exercises with a `(#N)` suffix.

## Sources

Compose from evidence the run already produced — never invent behavior nobody observed:

1. The spec's Deliverables and Acceptance Criteria — what the feature is, and the Expected result.
2. The QA stories that passed this run (`/claude-tweaks:test`'s green stories only) — a story's URL
   becomes the Entry point, its steps become Steps, its assertions become Expected.
3. A run with no green QA stories (a backend, infra, skill or CLI surface) builds the block from the
   ACs, taking the Entry point from `_shared/observation-plan.md`'s per-kind Entry point semantics:
   the invocation for `cli`, the flow's own invocation for `flow`, the file to open for `diff`. In
   this plugin's own repo the runnable unit is a skill invocation (e.g. `/claude-tweaks:flow #N`) —
   name it.

The end-to-end variant draws on the same evidence across every assembled spec or sub-issue — each
one's Acceptance Criteria and passed QA stories — plus, for a decomposition parent, the parent's
own design summary for the path that joins them.

## Rules

- Never empty, never placeholder text (`TBD`, an unfilled `{...}`, "see the PR"). Only
  Precondition and Access may read `none`; Entry point, Steps and Expected are always concrete.
- Human-facing: no agent procedure — no `playwright-cli`, no Prepare/Validate vocabulary, and no
  test command as the Expected result (Expected is what a person sees). A command belongs in Steps
  only when running it is the feature itself.
- Every command is runnable as written from the repository root — no inherited working directory.
- Composed once per record per run, by `wrap-up/verification-brief.md`, into the session-scoped
  file `try-it-{N}.md` (`_shared/session-tmp-root.md`). Every later surface in the same run reads
  that file rather than recomposing, so the summary, the PR and the brief show identical text. A
  surface that finds the file missing or empty (a different session, or the composing step never
  ran) composes the block fresh from the Sources above.

## Where it appears

`wrap-up/verification-brief.md`'s Routing and **Posting it alone** decide where the block lands —
in the record's Verification Brief, or alone as a `try-it` PR run comment
(`_shared/pr-run-comments.md`) — and `verification-brief-parent-gate.md` decides where the
end-to-end variant lands. Stated there once, not restated here. Every successful
`/claude-tweaks:flow` run's Pipeline Summary renders the block (`flow/summary-template.md`,
`flow/multispec-summary.md`), and `/claude-tweaks:demo` renders it first (its Step 2).

The oversight floor (`bin/lib/issues/oversight-floor.js`) never gates the block — it gates only the
`demo:pending` label and the sign-off ceremony.
