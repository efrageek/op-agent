import { test, expect } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

const BASH_OK = { result: { stdout: 'ran', stderr: '', interrupted: false } }

// Beneath the plugin: Bash "runs", and the dialog answers `pick` (or is dismissed).
function engine($: Engine, on: On, pick?: string) {
  const asked: string[] = []
  const ran: string[] = []
  const tickets: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => (ran.push(e.command), BASH_OK))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0].question
    asked.push(q)
    if (pick === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q]: pick } } }
  })
  on('fs.read', (_$, e) => (JSON.stringify(e).includes('.env.1p') ? { value: 'KEY=op://claude-prod/example-key/key\n' } : { deny: 'missing' }))
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.write', (_$, e) => (tickets.push(e.path), { value: undefined }))
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: 'x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }))
  return { asked, ran, tickets }
}

test('a plain dev run passes without asking', async ($, on) => {
  const { asked, ran } = engine($, on)
  await $.tool.call({ tool: 'Bash', command: 'op-agent run --env-file .env.dev -- npm test' })
  expect(asked).toEqual([])
  expect(ran).toEqual(['op-agent run --env-file .env.dev -- npm test'])
})

test('a prod run asks and runs once approved', async ($, on) => {
  const { asked, ran, tickets } = engine($, on, 'Approve')
  await $.tool.call({ tool: 'Bash', command: 'op-agent --prod run --env-file .env.1p -- ./deploy.sh' })
  expect(tickets).toEqual(['/home/t/.cache/op-agent/prod.ticket', '/home/t/.cache/op-agent/prod.ticket'])
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('op-agent wants production secrets:\nop://claude-prod/example-key/key')
  expect(ran.length).toBe(1)
})

test('a prod ssh shows its key in the question', async ($, on) => {
  const { asked } = engine($, on, 'Reject')
  await $.tool.call({ tool: 'Bash', command: 'op-agent --prod ssh example-host echo ok' })
  await $.tool.call({ tool: 'Bash', command: 'op-agent --prod ssh --key other-key example-host echo ok' })
  expect(asked[0]).toContain('op://claude-prod/example-host/private key (ssh)')
  expect(asked[1]).toContain('op://claude-prod/other-key/private key (ssh)')
  await $.tool.call({ tool: 'Bash', command: 'op-agent --prod ssh-window other-host 120' })
  expect(asked[2]).toContain('op://claude-prod/other-host/private key (ssh)')
})

test('a prod run with cd warns that the references may be incomplete', async ($, on) => {
  const { asked } = engine($, on, 'Reject')
  await $.tool.call({ tool: 'Bash', command: 'cd app && op-agent --prod run -- x' })
  expect(asked[0]).toContain('Warning: the command uses $(…), backticks, <(…), eval, cd, pushd or source; the references below may not be all it reads.')
})

test('closing ssh windows with --prod does not ask', async ($, on) => {
  const { asked, ran, tickets } = engine($, on)
  await $.tool.call({ tool: 'Bash', command: 'op-agent --prod ssh-window --close' })
  expect(asked).toEqual([])
  expect(ran.length).toBe(1)
  expect(tickets).toEqual([])
})

test('a hand-built ssh in a prod run is denied before asking', async ($, on) => {
  const { asked, ran } = engine($, on, 'Approve')
  const r = await $.tool.call({ tool: 'Bash', command: `K='op://claude-prod/example-key/private key' op-agent --prod run -- bash -c 'ssh-add - <<<"$K"; ssh -o BatchMode=yes example-host uptime'` })
  expect(r.deny ?? (r.isError && 'error')).toBeTruthy()
  expect(asked).toEqual([])
  expect(ran).toEqual([])
})

test('prod in the background is denied before asking', async ($, on) => {
  const { asked, ran } = engine($, on, 'Approve')
  const r = await $.tool.call({ tool: 'Bash', command: 'op-agent --prod run -- ./deploy.sh', run_in_background: true })
  expect(r.deny ?? (r.isError && 'error')).toBeTruthy()
  expect(asked).toEqual([])
  expect(ran).toEqual([])
})

test('a prod run is denied when rejected or dismissed', async ($, on) => {
  const { ran, tickets } = engine($, on)
  const r = await $.tool.call({ tool: 'Bash', command: 'op-agent --prod run -- ./deploy.sh' })
  expect(r.deny ?? (r.isError && 'error')).toBeTruthy()
  expect(ran).toEqual([])
  expect(tickets).toEqual([])
})

test('dev forms never ask; a hidden --prod gets no ticket, so the wrapper refuses it', async ($, on) => {
  const { asked, ran, tickets } = engine($, on)
  for (const command of ['cd app && op-agent run -- x', 'P=--pr; op-agent ${P}od run -- x', './deploy.sh'])
    await $.tool.call({ tool: 'Bash', command })
  expect(asked).toEqual([])
  expect(ran.length).toBe(3)
  expect(tickets).toEqual([])
})

test('the tokens are off limits', async ($, on) => {
  const { ran } = engine($, on)
  for (const call of [
    { tool: 'Bash', command: 'cat ~/.config/op-agent/prod.token' },
    { tool: 'Bash', command: 'touch ~/.cache/op-agent/prod.ticket' },
    { tool: 'Read', file_path: '/home/t/.config/op-agent/dev.token' },
    { tool: 'Read', file_path: '/home/t/.config//op-agent/./dev.token' },
  ] as const) {
    const r = await $.tool.call(call)
    expect(r.deny ?? (r.isError && 'error')).toBeTruthy()
  }
  expect(ran).toEqual([])
})
