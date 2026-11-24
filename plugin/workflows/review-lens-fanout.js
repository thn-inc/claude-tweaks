export const meta = {
  name: 'review-lens-fanout',
  description: 'Runs each review lens reviewer from its one brief and returns every reply for settle-lens-replies',
  whenToUse: 'Started only by /claude-tweaks:review Step 3 with args {lenses: [{lens, brief, model, reviewers}]}; never by hand.',
  phases: [{ title: 'Lens reviewers' }],
}

// Contract (#5599):
// - args: { lenses: [{ lens, brief, model, reviewers }] }. lens is one plain token of letters, digits, _ or -
//   (the class review-coordination.js settle-lens-replies reads); brief and model are non-blank strings, both
//   chosen by the session; reviewers is 1 or 2.
// - Every check runs before any agent starts. A refusal returns { started: false, reason } and starts nothing.
// - Each lens starts one agent per side, A then B (side A only for reviewers: 1), every one with the lens's brief
//   as its prompt, the lens's model, and the label `lens {lens} A` / `lens {lens} B`.
// - Returns { started: true, lenses: [{ lens, reviewers }], reviewers: [{ lens, side, text, failed }] }: the shape
//   settle-lens-replies reads, bare or under the run file's result. A reply is returned unmodified; a reply that is
//   not a non-blank string, an agent that throws, and a slot parallel() leaves null are all text: null, failed: true.
// Every agent call is wrapped on its own, so one reviewer's failure never touches another's reply.
// The stubbed tests in tests/review-lens-fanout-workflow.test.js cover this contract only; the two real runs quoted
// in PR #5819 (AC13) are the only evidence about the real Workflow tool.

const LENS_TOKEN = /^[A-Za-z0-9_-]+$/
const blank = (v) => typeof v !== 'string' || v.trim() === ''

function refusal(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'args must be an object'
  if (!Array.isArray(input.lenses) || input.lenses.length === 0) return 'lenses must be a non-empty array'
  const seen = new Set()
  for (const l of input.lenses) {
    if (typeof l?.lens !== 'string' || !LENS_TOKEN.test(l.lens)) {
      return 'lens must be one plain token of letters, digits, _ or -'
    }
    if (seen.has(l.lens)) return `lens ${l.lens} is named twice`
    seen.add(l.lens)
    if (blank(l.brief)) return `lens ${l.lens} has no brief`
    if (blank(l.model)) return `lens ${l.lens} has no model`
    if (l.reviewers !== 1 && l.reviewers !== 2) return `lens ${l.lens} reviewers must be 1 or 2`
  }
  return null
}

const reason = refusal(args)
if (reason !== null) return { started: false, reason }

phase('Lens reviewers')
const slots = args.lenses.flatMap((l) => {
  const sides = l.reviewers === 2 ? ['A', 'B'] : ['A']
  return sides.map((side) => ({ lens: l.lens, brief: l.brief, model: l.model, side }))
})
const replies = await parallel(slots.map(({ lens, brief, model, side }) => async () => {
  try {
    const text = await agent(brief, { label: `lens ${lens} ${side}`, model, phase: 'Lens reviewers' })
    if (typeof text === 'string' && text.trim() !== '') return { lens, side, text, failed: false }
    return { lens, side, text: null, failed: true }
  } catch {
    return { lens, side, text: null, failed: true }
  }
}))
const reviewers = replies.map((r, i) => r || { lens: slots[i].lens, side: slots[i].side, text: null, failed: true })

return { started: true, lenses: args.lenses.map((l) => ({ lens: l.lens, reviewers: l.reviewers })), reviewers }
