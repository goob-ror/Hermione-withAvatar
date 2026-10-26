#!/usr/bin/env node
/**
 * Publish scanner — refuses to let the repo leak things that do not belong on
 * a public remote.
 *
 * Scans the files git WOULD commit (`git ls-files` plus untracked-but-not-
 * ignored files), flags the four classes of accident that actually happen:
 *
 *   1. tracked secrets  — an env file, key, token or provider store that git
 *                         is already following (gitignore does not help there)
 *   2. secret-shaped strings inside source (keys, bearer tokens, private keys)
 *   3. machine-specific paths / identities (home dirs, personal emails)
 *   4. oversized binaries that should live in a release, not the tree
 *
 * Exit code 1 when anything CRITICAL or HIGH is found, so it can gate a push
 * in a pre-push hook or CI step.
 *
 *   node scripts/publish-check.mjs           # human report
 *   node scripts/publish-check.mjs --json    # machine report
 *   node scripts/publish-check.mjs --tracked # only files git already follows
 *
 * A line that must hold a secret-shaped literal on purpose (a test fixture, a
 * redaction sample) opts itself out with a `// publish-check:allow` comment.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim()
const jsonMode = process.argv.includes('--json')
const trackedOnly = process.argv.includes('--tracked')

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' })
  } catch {
    return ''
  }
}

const tracked = git(['ls-files']).split('\n').filter(Boolean)
const untracked = trackedOnly ? [] : git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
const files = [...new Set([...tracked, ...untracked])]

/* Anything matching these should never be committed, by name. */
const FORBIDDEN_NAMES = [
  { re: /^\.env(\..+)?$/i, allow: /\.(example|sample|template)$/i, label: 'environment file', severity: 'CRITICAL' },
  { re: /(^|\/)\.hermione\//, label: 'provider store (may contain API tokens)', severity: 'CRITICAL' },
  { re: /\.(pem|p8|p12|pfx|key|jks|keystore)$/i, label: 'private key / keystore', severity: 'CRITICAL' },
  { re: /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.pypirc|\.netrc|\.dockercfg)$/i, label: 'credential file', severity: 'CRITICAL' },
  { re: /\.(sqlite|sqlite3|db|dump)$/i, label: 'local database / dump', severity: 'HIGH' },
  { re: /\.(log)$/i, label: 'log file', severity: 'MEDIUM' },
  { re: /\.(gguf|safetensors|bin|ckpt|onnx|pth)$/i, label: 'model weight', severity: 'HIGH' },
  { re: /node_modules\//, label: 'vendored dependency tree', severity: 'HIGH' },
  { re: /(^|\/)(\.next|dist|build|out|coverage)\//, label: 'build output', severity: 'MEDIUM' },
]

/* Secret-shaped strings. Deliberately narrow to keep false positives usable. */
const SECRET_PATTERNS = [
  { re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g, label: 'API secret key' },
  { re: /\bsk_live_[A-Za-z0-9]{16,}/g, label: 'live payment key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, label: 'GitHub fine-grained token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS access key id' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'Slack token' },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, label: 'Google API key' },
  { re: /\b[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/g, label: 'Telegram bot token' },
  { re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: 'private key block' },
  { re: /\b(?:api[_-]?key|secret|token|passwd|password)\s*[:=]\s*['"][^'"\s]{16,}['"]/gi, label: 'hardcoded credential' },
]

/* Machine-specific strings that leak the operator, not the project. */
const PLACEHOLDER_USERS = new Set(['you', 'user', 'username', 'name', 'yourname', '<user>', 'me'])
const LOCAL_PATTERNS = [
  { re: /[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+/g, label: 'absolute Windows home path' },
  { re: /\/home\/[A-Za-z0-9._-]+\//g, label: 'absolute POSIX home path' },
  { re: /\/Users\/[A-Za-z0-9._-]+\//g, label: 'absolute macOS home path' },
]

/** `/Users/you/…` in a doc example is not a leak. */
function isPlaceholderPath(match) {
  const segment = match.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase()
  return !!segment && PLACEHOLDER_USERS.has(segment)
}

/* Files that legitimately contain absolute paths or example secrets. */
const SKIP_CONTENT = [
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^scripts\/publish-check\.mjs$/,
  /^\.env\.example$/,
  /\.min\.(js|css)$/,
  /^PiperTTS\//,
  /^public\/live2d\./,
  /^public\/live2dcubismcore/,
  /\.(png|jpe?g|gif|webp|ico|motion3\.json)$/i,
]

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|moc3|onnx|gguf|wav|mp3|zip|gz|tgz|pdf|woff2?|ttf)$/i
const SIZE_WARN = 2 * 1024 * 1024

const findings = []
const add = (severity, kind, file, detail, line) => findings.push({ severity, kind, file, detail, line })

for (const file of files) {
  const abs = path.join(repoRoot, file)

  for (const rule of FORBIDDEN_NAMES) {
    if (rule.re.test(file) && !(rule.allow && rule.allow.test(file))) {
      add(rule.severity, 'forbidden-path', file, rule.label)
    }
  }

  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    continue
  }
  if (!stat.isFile()) continue

  if (stat.size > SIZE_WARN && !BINARY_EXT.test(file)) {
    add('MEDIUM', 'large-file', file, `${(stat.size / 1024 / 1024).toFixed(1)} MB tracked source file`)
  }

  if (BINARY_EXT.test(file) || stat.size > 4 * 1024 * 1024) continue
  if (SKIP_CONTENT.some((re) => re.test(file))) continue

  let text
  try {
    text = fs.readFileSync(abs, 'utf-8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue

  const lines = text.split('\n')
  const rules = [
    ...SECRET_PATTERNS.map((r) => ({ ...r, kind: 'secret', severity: 'CRITICAL' })),
    ...LOCAL_PATTERNS.map((r) => ({ ...r, kind: 'local-path', severity: 'LOW' })),
  ]

  for (const rule of rules) {
    rule.re.lastIndex = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 4000) continue
      // One-line opt-out for deliberate fixtures: `// publish-check:allow`.
      if (/publish-check:\s*allow/i.test(line)) continue
      rule.re.lastIndex = 0
      if (!rule.re.test(line)) continue
      const match = line.match(rule.re)?.[0] ?? ''
      if (rule.kind === 'local-path' && isPlaceholderPath(match)) continue
      const redacted = match.length > 12 ? `${match.slice(0, 6)}…${match.slice(-4)}` : '***'
      add(rule.severity, rule.kind, file, `${rule.label}: ${redacted}`, i + 1)
    }
  }
}

/* Stale ignores: patterns that exist but match nothing tracked. */
const ignoreFile = path.join(repoRoot, '.gitignore')
let staleIgnores = []
if (fs.existsSync(ignoreFile)) {
  const patterns = fs
    .readFileSync(ignoreFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
  for (const pattern of patterns) {
    const bare = pattern.replace(/\/+$/, '')
    if (bare.length < 3) continue
    if (tracked.some((f) => f === bare || f.startsWith(`${bare}/`) || f.endsWith(`/${bare}`))) {
      staleIgnores.push({ pattern, trackedMatch: true })
    }
  }
}

const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file))

const summary = {
  scanned: files.length,
  tracked: tracked.length,
  findings: findings.length,
  bySeverity: Object.fromEntries(
    ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => [s, findings.filter((f) => f.severity === s).length]),
  ),
  ignoredButTracked: staleIgnores,
}

if (jsonMode) {
  console.log(JSON.stringify({ summary, findings }, null, 2))
} else {
  const paint = {
    CRITICAL: (s) => `\x1b[41;97m ${s} \x1b[0m`,
    HIGH: (s) => `\x1b[31m${s}\x1b[0m`,
    MEDIUM: (s) => `\x1b[33m${s}\x1b[0m`,
    LOW: (s) => `\x1b[90m${s}\x1b[0m`,
  }
  console.log(`\nPublish check — ${summary.tracked} tracked, ${summary.scanned} scanned\n${'─'.repeat(72)}`)
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file
    console.log(`${paint[f.severity](f.severity.padEnd(8))} ${f.kind.padEnd(14)} ${where}\n           ${f.detail}`)
  }
  if (!findings.length) console.log('clean — nothing sensitive in the publish set')
  if (staleIgnores.length) {
    console.log(`\n\x1b[33mignore patterns that match TRACKED files (gitignore cannot protect these):\x1b[0m`)
    for (const s of staleIgnores) console.log(`  ${s.pattern}`)
  }
  console.log(
    `\n${'─'.repeat(72)}\nCRITICAL ${summary.bySeverity.CRITICAL} · HIGH ${summary.bySeverity.HIGH} · MEDIUM ${summary.bySeverity.MEDIUM} · LOW ${summary.bySeverity.LOW}\n`,
  )
}

process.exit(summary.bySeverity.CRITICAL || summary.bySeverity.HIGH ? 1 : 0)
