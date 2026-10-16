# Criteria: Simplification

Shared, criteria-only fragment — the "what is worth simplifying" knowledge. No workflow, no subagent dispatch, no Next Actions. Consumed by `/claude-tweaks:simplify` (the reactive cleanup pass, which dispatches `code-simplifier:code-simplifier`) and by `/claude-tweaks:code-health`'s simplification judgment lens (Phase 2 subagents). One source of truth so a reactive cleanup and a proactive sweep flag the same kinds of complexity.

## What is worth flagging

- Unnecessary complexity from iterative development
- Verbose patterns from trial-and-error debugging
- Leftover defensive code from abandoned approaches
- Inconsistent naming or structure across changed files
- Dead paths, redundant conditionals, over-abstraction
- Cross-file / cross-task patterns (when multiple changes touched related files):
  - Inconsistent naming or patterns between files modified by different tasks
  - Opportunities to consolidate similar code written by different authors/subagents
  - Unnecessary complexity that accumulated across iterative implementation

## Constraints (what NOT to flag)

- **Preserve all behavior** — simplification never changes behavior. If behavior needs changing, that is a different concern, not a simplification finding.
- **Don't replace a test's expected value with the code under test** — a literal expected value in a test assertion is an independent oracle, not duplication. Replacing it with the production constant (or a call to the production function) that the test checks still passes, but the assertion can then hold for any value of that constant, so the test can no longer fail. Moving a repeated literal into a test-local constant is fine; reading the expected value from the module under test is not. Production code that duplicates a constant is still fair game.
- **Stay in scope** — only the changed files. Never flag unrelated code.
- **Don't over-simplify at the cost of readability** — simpler isn't always better. Dense one-liners can be harder to read than explicit code; a clarity loss is not a simplification.
- **Don't simplify generated files** — generated code is regenerated, not hand-simplified.
