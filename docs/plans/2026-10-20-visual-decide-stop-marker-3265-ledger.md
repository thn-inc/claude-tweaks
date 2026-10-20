# Open Items — visual-decide stop leaves no server-stopped marker when the daemon exits without running its SIGTERM handler (win32)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: new test asserts stop exit 0 only implicitly via execFileAsync resolution, not an explicit assertion | deferred | — |
| 2 | build | SDD task review minor: new test reads status via the sync run() helper (fine since victim is already dead; reviewer noted as acceptable) | deferred | — |
