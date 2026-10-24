# Open Items — verification.md execute block omits the pipeline-site baseline flags

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: Foreground rule provenance trimmed to `[IL-108]; #1904` and `#2688` (plan-mandated rail trim) | accepted | The trim is needed to keep `verification.md` under RAIL_BYTES (52,451/52,500). The incident detail is still in `docs/incident-log.md` under the IL-108 tag and in the cited issues, so nothing is lost. |
| 2 | build | SDD task review minor: the AC1.1 pin checks substrings inside the execute-block slice, not that the new paragraph comes after the fenced invocation | accepted | The slice bounds (`**Not skipped — execute.**` to `### Reading the result`) already fence the assertion to the block AC1 names. The AC asks only that the block carries the statement, so an ordering pin would add nothing AC1 asks for. |
