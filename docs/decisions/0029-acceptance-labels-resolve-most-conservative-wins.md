# 0029. Acceptance labels resolve most-conservative-wins, so every verdict writer replaces the labels it outranks

- **Status:** accepted
- **Date:** 2026-10-31
- **Context:** #4610 (the expand step of the `demo:*` to `accept:*` rename), under the human-in-control design #4608; precedence decided by the user at #4610's plan review

## Context

Until #4610 a record's acceptance labels were treated as mutually exclusive by construction: `/claude-tweaks:demo` removed `demo:pending` in the same command that added the verdict. Two readers still had to cope with the case where a partial write or a concurrent edit left two labels behind, and they coped differently. `bin/lib/issues/acceptance.js` used a first-match table that put the resolved verdicts before `pending`, on purpose, so that a resolved record would never be swept again. `bin/lib/issues/record-vocabulary.js`'s `parseRecordFacets` used last-match-in-array-wins, so the answer depended on the order GitHub returned the labels in.

#4610 made several labels on one record a normal state rather than an accident. `demo:*` and its `accept:*` twins are now both read. The writers switch vocabularies in a later record (#4613). Dispatch, a separate repository that never calls this plugin, will write `accept:*` from its own inbox once its side ships. Older installed builds see only `demo:*`. For the length of the migration, a record can carry one label from each vocabulary. Even after it, a writer that adds a label without removing the old one leaves two. The design #4608 also sets one firm constraint: an unanswered `pending` is never treated as accepted.

## Decision

Every reader resolves a record's acceptance labels through one function, `acceptanceOf` in `bin/lib/issues/record-vocabulary.js`. It applies one order across both vocabularies and every pair of labels: `changes-requested` beats `pending` beats `approved` beats no verdict, whatever order the labels arrive in. A leftover label therefore always resolves to the more cautious verdict. The cost falls on the writers: a writer that records a verdict must also remove every acceptance label that verdict would otherwise be outranked by, or its verdict will not take effect.

## Alternatives considered

- **Keep the old order, with a resolved verdict beating a stale `pending`.** This is what `acceptance.js` did, and what `tests/bin-lib/issues/acceptance.test.js` pinned for `demo:pending` + `demo:approved`. Rejected because it lets an `approved` left over from an earlier round hide a new `pending` once a fresh brief goes up, so unanswered work reads as accepted. That breaks #4608's constraint, and the failure is silent. Changing this pinned pair was the one deliberate exception to #4610's rule that no `demo:*` behaviour change.
- **Last label wins, by array order.** This is what `parseRecordFacets` did. Rejected because GitHub's label order carries no meaning, so the verdict would be arbitrary, and the two readers would keep disagreeing.
- **The newer vocabulary wins (`accept:*` over `demo:*`).** Rejected because during the migration the old spelling is still the one `/demo` writes, so the newer human verdict may well be the `demo:*` label. It also leaves same-vocabulary pairs undecided.
- **The most recently applied label wins, read from the issue timeline.** This is the only option that truly answers "what did the human say last". Rejected because every reader would need an extra API call per record. The label-only readers (`gh issue list --search` scans, the wrap-up checks, the merge-lane breaker) and the `local-files` backend have no timeline to read.
- **Flag a conflict as a fourth state.** Rejected because no reader and no Dispatch route has anything it can do with "conflict", so each would have to invent a handling. The cautious verdict already sends the record to a human.

## Consequences

The order is easy to apply: readers call one function, `tests/bin-lib/issues/acceptance.test.js` runs the mixed pairs in both array orders through both readers, and a stray `approved` can no longer hide open work.

The hard part is the writers. A writer that only adds labels now silently loses a later human verdict. An Approve on a record a human had earlier rejected would keep reading `changes-requested` to every reader. #4610's final whole-branch review found exactly this, as its one critical finding. The fix: `/demo`'s verdict now removes each outranked label it fetched, in both spellings, in the same command (`skills/demo/SKILL.md` Step 3). The same duty binds every future writer: the `accept:*` writer switch (#4613), Dispatch's own writer in its repository, and any later verdict handler. A rename or expand step that changes this order has to check every writer against every pair of labels it newly makes reachable.

A second effect is still open: `/claude-tweaks:wrap-up` posting a fresh brief on a record that already carries `changes-requested` now fails its acceptance-labeling check loudly ("pending label outranked by a verdict") rather than clearing the human's verdict. Whether a fresh brief should replace a prior verdict is a human decision that #4610 left unresolved.

The cross-vocabulary half of this rule goes away when the contract step (#4625) removes `demo:*`. The same-vocabulary half does not.

Revisit if GitHub gains an atomic replace-labels write that every writer uses, so leftover labels stop happening. Revisit too if readers get label-event order cheaply enough that most-recent-wins becomes affordable for label-only scans.
