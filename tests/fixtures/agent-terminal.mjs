import { createInterface } from 'node:readline'

let title = '⠹ Review MR 123 | project'

function report(input = {}) {
  title = input.title ?? title
  process.stdout.write(`\u001b]0;${title}\u0007`)
  process.stdout.write(`\u001b]7501;state=working:app=${input.app ?? 'codex'}\u001b\\`)
}

report()
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line)
  if (input.exit) process.exit(0)
  report(input)
}
