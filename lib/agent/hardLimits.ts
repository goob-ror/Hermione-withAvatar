/**
 * Hard limits — checked for every approval-gated call in EVERY permission
 * mode (Ask, Auto and Off). They exist because pages Hermione reads are
 * untrusted: a page can try to steer an agent that no longer asks.
 *
 *   block — never run, even if you approve (a wipe can't be undone)
 *   ask   — always shows you the approval card, even in Auto or Off
 *
 * Patterns are deliberately simple and conservative; a false "ask" costs one
 * click, a missed "block" could cost a disk.
 */

export type HardLimit = { level: 'block' | 'ask'; reason: string }

const BLOCK: [RegExp, string][] = [
  [/\brm\s+(?:-[a-z]*[rf][a-z]*\s+)+(?:--no-preserve-root\s+)?(?:\/|~|\$home|\/\*|\.\/?\*?|\.\.)(?:\s|$|\/\s|\/\*)/i, 'recursive delete of a root, home or the whole project'],
  [/\b(?:rd|rmdir)\s+\/s\b[^\n]*\b[a-z]:\\?(?:\s|$|")/i, 'recursive delete of a whole drive'],
  [/\b(?:del|erase)\b[^\n]*\/s\b[^\n]*\b[a-z]:\\(?:\*|\s|$)/i, 'deleting everything on a drive'],
  [/remove-item\b[^\n]*-recurse[^\n]*\b(?:[a-z]:\\?(?:\s|$|['"])|\$env:(?:userprofile|systemroot)|~)/i, 'recursive delete of a drive or home folder'],
  [/\bformat(?:\.com)?\s+[a-z]:/i, 'formatting a drive'],
  [/\b(?:diskpart|mkfs(?:\.\w+)?|fdisk|wipefs)\b/i, 'disk partitioning / formatting'],
  [/\bdd\b[^\n]*\bof=\/dev\//i, 'writing raw data to a disk device'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'a fork bomb'],
  [/\breg\s+delete\s+hk(?:lm|ey_local_machine)/i, 'deleting system registry keys'],
  [/\bbcdedit\b|\bvssadmin\s+delete\b|\bcipher\s+\/w\b/i, 'boot / backup / free-space wiping commands'],
]

const ASK: [RegExp, string][] = [
  [/(?:curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|invoke-expression|python|node)\b/i, 'downloads and runs code from the internet'],
  [/\b(?:iex|invoke-expression)\b/i, 'runs a string as code'],
  [/(?:\.hermione[\\/]|providers\.json|\.env\b|id_rsa|id_ed25519|\.pem\b|\.npmrc|\.git-credentials|credentials\.json)/i, 'touches stored keys or credentials'],
  [/\b(?:shutdown|restart-computer|stop-computer|reboot|poweroff|halt)\b/i, 'shuts down or restarts the PC'],
  [/\bgit\s+push\b[^\n]*(?:--force|-f\b|--mirror|--delete)/i, 'rewrites or deletes remote git history'],
  [/\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/i, 'discards local changes for good'],
  [/\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b/i, 'publishes something publicly'],
  [/\b(?:taskkill|stop-process|kill\s+-9|pkill|killall)\b/i, 'kills processes'],
  [/\b(?:net\s+user|net\s+localgroup|new-localuser|useradd|passwd|sudo|runas)\b/i, 'changes accounts or elevates privileges'],
  [/\b(?:set-executionpolicy|netsh\s+advfirewall|set-mppreference|sc\s+(?:stop|delete|config))\b/i, 'changes system security settings or services'],
  [/\b(?:choco|winget|apt(?:-get)?|brew|scoop)\s+(?:install|uninstall|remove)\b|\bpip\s+uninstall\b/i, 'installs or removes software on the system'],
]

/** Money and logins on websites: never without you. */
const PAGE_SENSITIVE = /\b(?:pay|payment|checkout|check out|buy|purchase|order|place order|bayar|beli|card|cvv|cvc|password|passcode|pin|otp|log ?in|sign ?in|transfer|withdraw|donate|subscribe)\b/i
const CARD_NUMBER = /(?:\d[ -]?){13,19}/

export function hardLimit(tool: string, args: Record<string, any> = {}): HardLimit | undefined {
  if (tool === 'shell_run' || tool === 'terminal_run') {
    const cmd = String(args.command ?? '')
    for (const [re, reason] of BLOCK) if (re.test(cmd)) return { level: 'block', reason }
    for (const [re, reason] of ASK) if (re.test(cmd)) return { level: 'ask', reason }
    return undefined
  }
  if (tool === 'fs_delete' || tool === 'fs_write') {
    const p = String(args.path ?? '').trim().replace(/\\/g, '/')
    if (tool === 'fs_delete' && /^(?:\.?\/?|\.\.(?:\/.*)?|\/|[a-z]:\/?)$/i.test(p)) return { level: 'block', reason: 'deleting the whole project folder or a drive' }
    if (/(?:^|\/)\.hermione(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.git\/|id_rsa|\.pem$/i.test(p)) return { level: 'ask', reason: 'changes stored keys, settings or git internals' }
    return undefined
  }
  if (tool === 'page_act') {
    const cmd = String(args.command ?? '')
    if (cmd === 'submit') return { level: 'ask', reason: 'submitting a form on a website' }
    const words = `${args.text ?? ''} ${args.value ?? ''}`
    if (CARD_NUMBER.test(String(args.value ?? '')) || PAGE_SENSITIVE.test(words)) return { level: 'ask', reason: 'a payment, login or account action on a website' }
    return undefined
  }
  return undefined
}
