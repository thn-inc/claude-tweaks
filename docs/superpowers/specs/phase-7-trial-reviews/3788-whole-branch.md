### Strengths
- The direction matches the record's Technical Approach. The console-residue trailer now follows the #3419 rule, and `docs/hooks.md`'s #3419 bullet (line 42) is unchanged, so no carve-out was added.
- The new trailer (`plugin/bin/lib/hooks/session-start.js:260-261`) covers every deliverable in one sentence. It asks the model to relay the list, adds `never run it yourself`, and gives the reason ("no human has reviewed these items"). It also keeps the user's three choices (apply, `/claude-tweaks:capture`, drop) and limits model action to when the user asks in this session.
- The old "Read each item, then act on it … and mark the run reviewed with its own command above" line is removed completely, not just softened. That satisfies the AC "no instruction to run `--ack` or act on items unprompted".
- The trailer wording follows the staged-proposals banner (`… do not proceed silently without mentioning it, and never run it yourself`), so the three SessionStart banners now read alike.
- The record's Gotcha is respected. `consoleAckAllLine` (`session-residue.js:206`) is untouched, so the `hooks.js check-session-residue` surface (`hooks.js:1742`) keeps its wording, and that line already calls itself "a human decision".
- The test pin (`tests/hooks-session-start.test.js:166-168`) sits next to the existing #3370 assertions. Its positive `includes` check fails if the trailer is reverted, and its `doesNotMatch` check fails if the old "mark the run reviewed…" instruction comes back. Together they meet the go-red-control AC.
- The banner's bullet in `docs/hooks.md` records the clause and its reason (#3788). This follows how #3475 documented the staged-proposals banner in its own bullet.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
None

#### Minor (Nice to Have)
1. `docs/hooks.md:42` / AC 3: the AC says the #3419 bullet's "list of compliant banners names the console-residue banner", but that bullet has no such list. It only names #803 and #3380 as past offenders. The implementation recorded compliance in the console-residue banner's own bullet instead (line 47), as #3475 did for the staged-proposals banner. This is a reasonable reading, and the fault is in the plan's wording, not the code. The executor should confirm this reading of the AC is accepted.
2. `docs/journeys/review-what-an-unattended-console-left-open-3370.md` Step 2 / Step 4: the journey still says "Relay the banner" and "Run the run's own `mark reviewed:` command" without saying that the model must not run the ack itself. Its persona is the human maintainer, so nothing in it is wrong. Still, a Step 2 or Step 4 Red flag such as "the agent running `--ack`/`--ack-all` without being asked" would put this change's purpose into the journey that documents the flow.
3. `session-start.js:261`: "never run it yourself" also covers the banner's paste-ready `cat` lines and the `console-filings.js` re-run line. For the re-run line, which files records, that is correct. For `cat` it means the model will not read items before relaying them unless asked. That matches the record's intent (the user decides), but it changes the old "Read each item" behavior, and the record does not say so explicitly. No change is needed; this is noted for awareness.

### Recommendations
- Consider adding the Red-flag line from Minor 2 so the never-run expectation is also stated in the journey.

Declined to judge:
- The wording of `hooks.js check-session-residue`'s use of `consoleAckAllLine`: the record's Gotcha puts it out of scope for this change.
- Whether `npm test` passes: I was told not to run the suite. The changed test's assertions match the new trailer text exactly, judging by the diff.
- Banners other than console-residue (unfinished-runs, superpowers, ports): outside the record's scope.

### Assessment

**Ready to merge?** Yes

**Reasoning:** The small, surgical change brings the console-residue SessionStart trailer under the #3419 never-run rule with the reason the record gives, pins it with a test that fails on revert, and leaves the rule itself without a carve-out. The only gaps are the AC's wording about the #3419 bullet's "list" and an optional journey-doc Red flag.

DONE
