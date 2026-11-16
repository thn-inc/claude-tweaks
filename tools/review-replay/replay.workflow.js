export const meta = {
  name: 'review-replay',
  description: 'Replay archived review findings: one judge per prompt file per arm repeat, replies scored offline',
  phases: [{ title: 'Judges', detail: 'one agent per prompt file per repeat' }],
}

// The manifest arrives whole as args. Each judge is told only its slot's label and where its prompt file is.
const slots = args.arms.flatMap(arm =>
  Array.from({ length: arm.repeat }, (_, i) => i + 1).flatMap(r =>
    arm.prompts.map(p => () => {
      const label = `${arm.name}|${r}|${p.name}`
      return agent(`Replay judge ${label}.\nRead ${p.file} and follow it exactly; it is your whole task.`, { label, phase: 'Judges', model: arm.model, ...(arm.effort === null ? {} : { effort: arm.effort }) })
        .then(reply => ({ arm: arm.name, repeat: r, name: p.name, reply }))
    })
  )
)

return await parallel(slots)
