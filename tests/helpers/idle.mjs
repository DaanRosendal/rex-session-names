import { spawn } from 'node:child_process'

// Extra arguments after the script show up in the process command line, which is how a watcher is recognised.
export function idle(t, ...marker) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', ...marker], {
    stdio: 'ignore',
  })
  t.after(() => child.kill('SIGKILL'))
  return child
}
