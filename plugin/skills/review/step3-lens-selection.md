# Step 3 Adaptive Lens Selection — /claude-tweaks:review

Read from `step3-lens-dispatch.md`'s lens-selection pointer only when `review-lens-selection` resolves `adaptive`. At `tier` this file is never read and Step 3 dispatches the resolved tier's whole lens set, as that file says. The tier's set stays the ceiling: a lens the tier excludes is never added.

## Select

Standalone (no run directory), skip the CLI, which needs `--run`: dispatch the tier's whole lens set and say so in the review report. Otherwise run it once per review, after Step 2.5 resolves the tier and before any lens dispatch:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-select.js" --run "$PIPELINE_RUN_DIR" --tier {tier} --base {base} [--risk-flags "{risk-flags}"]
```

`{base}` is the review's merge base, the one `build-review-context.js` takes in Step 3. Pass `--risk-flags` with the record's `Risk-flags:` value in double quotes, and leave the flag out when the record has no `Risk-flags:` line; `none` or an empty value reads as no flags too. A value holding anything but lowercase letters, digits, `-`, `,` and spaces goes in as `"malformed"`, which reads as flagged. It prints one JSON line, `{ tier, selected, skipped, fallback }`; the rules, constants and their sources are in `bin/lib/review-lens/select.js`'s header, not restated here.

The CLI writes `lens-selection.json` in the run directory, beside `lens-dispatch.json`, and logs its own `SKIP` line per skipped lens and one `AUTO` line for a fallback. Write none of them. A non-empty `fallback` means the CLI already chose the full tier set.

## Dispatch

Dispatch exactly the lenses in `selected`, on every path: the Task dispatch, and the `lenses` the workflow in `step3-workflow-dispatch.md` is called with. Lens 3h also needs its own QA-data gate. A lens in `skipped` is not dispatched and produces no findings.

The prose rules that skip a lens are replaced by the CLI's facts under `adaptive`, not kept as a second filter: "skip a lens if it doesn't apply to this change type" and the `low`-tier no-executable-content skip do not apply.

The CLI is not run again. The workflow path's Task fallback reads the same output, so there its "every lens" and "lenses 3a–3g" mean the `selected` set.

## Fallback

When the CLI exits 1 or 2, or its output is not one parseable JSON line, dispatch the full tier set and log one `AUTO` line, never a `SKIP`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status AUTO --step "Step 3 lens selection" --text "review-lens-select exit {n}: full tier set dispatched" --reversibility n/a
```

For unparseable output on exit 0, write `exit 0 (unparseable output)` for `exit {n}`.
