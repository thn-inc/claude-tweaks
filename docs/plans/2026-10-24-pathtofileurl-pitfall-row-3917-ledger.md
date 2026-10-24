# Open Items — Add pathToFileURL-expectation pitfall row to windows-checkout-test-parity skill

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD parked (final review Minor): the new row omits the "proven on Windows vs reasoned from code" note its neighbours carry | observation | Ruling: code stands. The row text is spec-fixed verbatim, and the human reviewer the record asks for can add the note at merge review. |
| 2 | build | SDD parked (final review Minor): the win32 drive-letter behaviour has not been independently confirmed on a real Windows run | observation | Ruling: real but non-blocking. It is consistent with Node's `pathToFileURL` semantics and #3886's fix, and can only be confirmed via a `windows-regression.yml` dispatch. |
