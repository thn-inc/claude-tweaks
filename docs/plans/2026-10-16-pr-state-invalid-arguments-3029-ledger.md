# Open Items — #3029 pr-state by-number argument guard

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Named-location drift: the record cites `archive-merged.js:1687` for the `resolvePrStateByNumber` call site; it is now at `:1818` (consumer still gates on `typeof === 'object'`, so no change needed) | observation | Verified at plan time; nothing outstanding |
