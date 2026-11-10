import type { Register } from 'claude-code'

// The tokens and the prod ticket (~/.config/op-agent, ~/.cache/op-agent): no tool call Claude makes may name them.
const TOKENS = /\.(config|cache)\/op-agent\b|OP_SERVICE_ACCOUNT_TOKEN|OP_RUN_NO_MASKING/
const WRITERS = new Set(['Write', 'Edit', 'NotebookEdit'])
const PROD = /op-agent\b.*--prod/s
const REF = /op:\/\/[^\s'"`]+/g
const ENV_FILE = /--env-file[= ]['"]?([^\s'"]+)/g
const INDIRECT = /\$\(|`|<\(|\b(?:eval|cd|pushd|source)\b/
// Closing windows needs no ticket in the wrapper, so it needs no question either.
const CLOSE = /^\s*op-agent\s+--prod\s+ssh-window\s+--close\s*$/
// A hand-built ssh inside a prod run: host aliases often point at the desktop 1Password agent.
const MANUAL_SSH = /op-agent\s+--prod\s+run\b[\s\S]*\bssh(?![-\w])/
const SSH_ITEM = /op-agent\s+--prod\s+ssh(?:-window)?\s+(?:--key\s+)?('[^']+'|"[^"]+"|\S+)/g

export const register: Register = on => {
  on('tool.call', ($, e, next) => {
    // Writers only by path, so docs that mention op-agent stay editable.
    const raw = WRITERS.has(e.tool) && 'file_path' in e ? String(e.file_path) : JSON.stringify(e)
    const probe = raw.replace(/\/(\.?\/)+/g, '/') // `a//b` and `a/./b` name the same path
    return TOKENS.test(probe)
      ? { deny: `${$.plugin.name}: the op-agent tokens and tickets are off limits to Claude.` }
      : next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its token guard failed, so the call did not run.` },
  )

  // Prod asks here and leaves a one-use ticket; the wrapper refuses --prod without one (scripts, obfuscation, other tools).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    if (!PROD.test(cmd) || CLOSE.test(cmd)) return next(e)
    if (MANUAL_SSH.test(cmd))
      return { deny: `${$.plugin.name}: for ssh use \`op-agent --prod ssh <host> [cmd]\` (key = the claude-prod item named like the host; \`--key <item>\` for another); a hand-built ssh may hit the desktop 1Password agent, which prompts on the PC.` }
    // The hook voids the ticket when the call returns, which for a background command is at launch.
    if (e.run_in_background)
      return { deny: `${$.plugin.name}: op-agent --prod cannot run in the background; run it in the foreground.` }

    const refs = await refsOf(cmd, file => $.fs.read(file))
    const question =
      (INDIRECT.test(cmd) ? 'Warning: the command uses $(…), backticks, <(…), eval, cd, pushd or source; the references below may not be all it reads.\n' : '') +
      `op-agent wants production secrets:\n${refs.join('\n') || '(could not read the references)'}` +
      `\n\nCommand: ${cmd}\n\nApprove?`
    const answer = await $.ui.ask(question, ['Approve', 'Reject']).catch(() => 'Reject')
    if (answer !== 'Approve')
      return { deny: `${$.plugin.name}: the user did not approve using these secrets. Do not retry without asking.` }

    const ticket = `${await $.env.get('HOME')}/.cache/op-agent/prod.ticket`
    await $.fs.write(ticket, String(Date.now()))
    try {
      return await next(e)
    } finally {
      // Void a ticket the command did not use (denied prompt, failed cd, no wrapper call).
      await $.fs.write(ticket, 'void')
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed, so the command did not run.` },
  )
}

// Best effort, for the prompt only (relative to the session's directory, not a `cd` in the command).
async function refsOf(cmd: string, read: (file: string) => Promise<string>) {
  const refs = new Set(cmd.match(REF) ?? [])
  for (const [, item] of cmd.matchAll(SSH_ITEM)) refs.add(`op://claude-prod/${item.replace(/^['"]|['"]$/g, '')}/private key (ssh)`)
  for (const [, file] of cmd.matchAll(ENV_FILE)) {
    const text = await read(file).catch(() => '')
    for (const ref of text.match(REF) ?? []) refs.add(ref)
  }
  return [...refs]
}
