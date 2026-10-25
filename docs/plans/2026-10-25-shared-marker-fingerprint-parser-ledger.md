# Open Items — Share one marker-fingerprint parser between health-core/digest.js and materiality-digest.js

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | "stateless across calls" test in fingerprint.test.js cannot go red (regex built per call) — low-signal, plan-mandated | fixed | Removed in tests/bin-lib/health-core/fingerprint.test.js (wrap-up) — no plausible implementation change could fail it |
| 2 | build | prefix-escape test covers only `.`; a `$`/`(` case would also pin the `$&` replacement form | fixed | Added `$` and `(` cases to the literal-prefix test in tests/bin-lib/health-core/fingerprint.test.js (wrap-up); with the escape removed the test goes red |
