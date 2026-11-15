# Open Items — Judgment workers: merge-check verdict and acceptance brief, read-only

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | AC9 evaluation figures for the record's closing comment: `evaluate --repeat 3 --concurrency 4` exited 0 — 33 fixtures (18 `auto-merge`, 15 `needs-human`; floor 30 / 10 met); 99 runs, 0 launch failures, 0 replay errors, 0 floor-decided; `falseAutoMerge` none; agreement 87/99 (0.879; recorded `auto-merge` 42/54, recorded `needs-human` 45/45); empty review findings 81/93 over 31 fixtures, non-empty 6/6 over 2; 106 excluded (`no-merge-gate-verdict` 51, `review-summary-ambiguous` 48, `no-review-summary` 7). Full results: run dir `merge-check-eval.json` | open | Wrap-up posts these figures in #5228's closing comment (AC9); phase `build`, not `ops` — no manual step remains, so no `reason-not-auto` value applies |
