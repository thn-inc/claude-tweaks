# Open Items — Tell review lens agents to write scratch probes as one plain Bash call each

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | step3-lens-dispatch.md Scratch path sentence mixes "never … nor … and no" after the inserted clause — parses, reads slightly clumsy | deferred | — |
| 2 | build | new #3876 test pins exact phrases (nor a `;` sequence / no shell variable carried between calls / literal absolute path) — wording-coupled, consistent with neighbouring #3675 tests | deferred | — |
| 3 | review | step3-debate-and-refutation.md refutation and gap-sweep SCRATCH lines still stated the pre-#3876 recipe while step3-lens-dispatch.md gained the no-; / no-carried-variable / literal-path clause (medium, Convention: the four recipe sites are pinned as a set by #3519) | fixed | Same clause added to both SCRATCH lines plus a count-2 pin test, commit 4d999344b |
