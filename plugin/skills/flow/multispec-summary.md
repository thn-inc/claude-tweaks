# Multi-Spec Summary Template

Loaded at summary-render time by `/flow`'s consolidated close-out.

After all specs complete (or one fails), present a consolidated summary:

**Needs-a-human residue (#3370).** Run `node "{pluginRoot}/bin/console-residue.js" --run "$MULTISPEC_PARENT_DIR" --require-verify {base}` once against the parent run dir (the archive path when already archived, per `_shared/timing-render.md`'s archive-path rule), `{base}` being the base ref `wrap-up/summary-template.md`'s `{base}` rule resolves — it covers every `spec-*/console.json`, and `--require-verify` adds a line, with its paste-ready command, for each `spec-*/` that never wrote `verify.json` (wrap-up's Verify execution never ran, or its write failed) — and render its stdout verbatim under a `### Needs a human` heading. Omit the section only when the command exits 0 with empty stdout; on any non-zero exit, render the CLI's stderr verbatim under the heading, so a failed scan never reads as "no residue".

```markdown
## Flow: Multi-Spec Pipeline Complete  {— keep-going if applicable}

| Spec | Build | Test | Review | Polish | Wrap-Up | Outcome |
|------|-------|------|--------|--------|---------|---------|
| {N} | passed | passed | PASS | applied + re-verified | done | Complete |
| {N} | passed | passed | PASS | skipped (no-polish) | done | Complete (no polish) |
| {N} | passed | passed | BLOCKED | — | — | Stopped at review |
| {N} | passed | passed | PASS | re-verify failed | — | Stopped at re-verify |
| {N} | passed | FAILED | — | — | — | Failed (test gate) — continued (keep-going) |
| {N} | — | — | — | — | — | Not run (previous spec failed) |

**Release status:** {one line for the run's single shared branch, from `_shared/pr-first-merge-post-merge.md` Step 4.1, verbatim — same vocabulary as `summary-template.md`'s line; `n/a — not merged in this run (outcome: {armed | pending-review})` when the bundle PR did not merge in this run}

### Needs a human

{stdout of `node "{pluginRoot}/bin/console-residue.js" --run "$MULTISPEC_PARENT_DIR" --require-verify {base}`, verbatim, per the Needs-a-human residue rule above — omit this whole section only on exit 0 with empty stdout; on any non-zero exit, the CLI's stderr verbatim instead}

### Try it

#### Spec {N}: {title}
{one `#### Spec {N}` group per spec, in run order. That spec's Try it block (`_shared/try-it.md`) — the body of its session-scoped `try-it-{N}.md`, verbatim, minus its own heading line and up to any appended `### Try it — end to end` section, which renders below instead; when the file cannot be used, compose it per `_shared/try-it.md`'s Rules. A spec that did not complete reads `Not delivered — {outcome}` instead}

### Try it — end to end
{the contract's end-to-end variant, composed now across every completed spec, minus its own heading line. When fewer than two specs completed: `Only spec {N} completed — its Try it above is the end-to-end path.` Then, for each spec whose file carries a parent gate's appended `### Try it — end to end` section (`wrap-up/verification-brief-parent-gate.md` — the parent's whole sub-issue set, a different scope from this bundle), that section's body under `#### Parent #{P}`}

### Timing

{stdout of `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$MULTISPEC_PARENT_DIR" --markdown --auto-transcript` (#1928), rendered verbatim per `_shared/timing-render.md` — the phase table, its notes, the archive-path `--run` rule, and the Dispatches section; never composed by hand}

### Manual Steps Required (all specs)
| # | Spec | What | Where |
|---|------|------|-------|
| 1 | {N} | {description} | {source} |
(or: No manual steps required.)

### Per-Spec Details
(expand each spec's key outputs, failures, and review findings)
```

Both Try it sections are mandatory on every multi-spec summary (#2821) — the oversight floor never gates them; see `summary-template.md`'s Try it rule for where each spec's block is read from.

The header includes `— keep-going` when the run was invoked with that flag. The outcome column distinguishes:
- `Complete` — all gates passed
- `Stopped at {step}` — HARD-GATE failure, remaining specs not run (default mode)
- `Failed ({gate}) — continued (keep-going)` — HARD-GATE failure but pipeline continued to the next spec
- `Not run (previous spec failed)` — only appears in default mode; never under `keep-going`
