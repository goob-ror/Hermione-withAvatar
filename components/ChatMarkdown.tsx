'use client'

import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Info, Lightbulb, MessageSquareWarning, OctagonAlert, SquareTerminal, TriangleAlert } from 'lucide-react'
import { HEX_COLOR, remarkHermione, type CalloutKind } from './markdownExtras'

/**
 * Hermione's answers, rendered like a chat app: headings, bold, lists,
 * quotes, tables that scroll sideways, and code in its own box.
 *
 * Safe by design: raw HTML in the model's text is NOT rendered (no
 * rehype-raw), and react-markdown's URL filter drops javascript: links — so
 * text Hermione read on a web page can't inject anything into the console.
 */

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat'])
const LANG_LABEL: Record<string, string> = {
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', shell: 'Shell', console: 'Console', powershell: 'PowerShell', ps1: 'PowerShell',
  pwsh: 'PowerShell', cmd: 'Command Prompt', bat: 'Batch', js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript',
  typescript: 'TypeScript', tsx: 'TSX', jsx: 'JSX', py: 'Python', python: 'Python', json: 'JSON', html: 'HTML', css: 'CSS',
  sql: 'SQL', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', go: 'Go', rust: 'Rust', rs: 'Rust',
  java: 'Java', c: 'C', cpp: 'C++', csharp: 'C#', cs: 'C#', php: 'PHP', ruby: 'Ruby', lua: 'Lua', luau: 'Luau', diff: 'Diff',
}

/**
 * Copy-ready text blocks for content packaging — ```titles, ```hashtags … —
 * shown as wrapped prose with a friendly label (and the usual Copy button).
 */
const PROSE_BLOCKS: Record<string, string> = {
  text: 'Text', titles: 'Title options', title: 'Title', description: 'Description', caption: 'Caption',
  hashtags: 'Hashtags', tags: 'Tags', hook: 'Hook', script: 'Script', voiceover: 'Voiceover', cta: 'Call to action',
  thumbnail: 'Thumbnail text', cover: 'Cover text',
}

/** Plain text of rendered children (highlighting wraps tokens in spans). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

function CodeBlock({
  lang,
  children,
  onRunInTerminal,
}: {
  lang: string
  children: ReactNode
  onRunInTerminal?: (command: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const code = textOf(children).replace(/\n$/, '')
  const isShell = SHELL_LANGS.has(lang)
  // ```titles-youtube → "Title options · Youtube"; ```hook-0-3s → "Hook · 0–3s"
  const [base, ...rest] = lang.split(/[-_]/)
  const prose = PROSE_BLOCKS[base]
  const tail = rest.join('-')
  const detail = /^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?s?$/.test(tail)
    ? tail.replace('-', '–')
    : rest.join(' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bYoutube\b/, 'YouTube').replace(/\bTiktok\b/, 'TikTok')
  const label = prose
    ? `${prose}${tail ? ` · ${detail}` : ''}`
    : LANG_LABEL[lang] ?? (lang ? lang[0].toUpperCase() + lang.slice(1) : 'Code')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }

  return (
    <div className={prose ? 'md-code is-prose' : 'md-code'}>
      <div className="md-code-head">
        <span className="lang">
          {isShell && <SquareTerminal className="size-3.5" />}
          {label}
        </span>
        <span className="actions">
          {isShell && onRunInTerminal && (
            <button type="button" onClick={() => onRunInTerminal(code)} title="Send to the shared terminal (asks before running)">
              <SquareTerminal className="size-3.5" /> Run
            </button>
          )}
          <button type="button" onClick={copy} title="Copy">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/** A colour chip next to its hex code; click copies the code. */
function Swatch({ color, isCode }: { color: string; isCode: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(color)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <button
      type="button"
      className={isCode ? 'md-swatch is-code' : 'md-swatch'}
      title={copied ? 'Copied' : `${color} — click to copy`}
      onClick={copy}
    >
      <span className="chip" style={{ background: color }} aria-hidden />
      {copied ? 'Copied' : color}
    </button>
  )
}

/** Web images only; a broken one disappears instead of showing a torn icon. */
function WebImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}

const CALLOUT_ICON: Record<CalloutKind, typeof Info> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
}

const hasClass = (className: unknown, name: string) =>
  typeof className === 'string' && className.split(/\s+/).includes(name)

function components(onRunInTerminal?: (command: string) => void): Components {
  return {
    // Fenced code: its own box. Inline code: a small chip (styled by CSS).
    pre: ({ children }) => {
      const codeEl = Array.isArray(children) ? children[0] : children
      const className: string = (codeEl as { props?: { className?: string } })?.props?.className ?? ''
      const lang = (className.match(/language-([\w+#-]+)/)?.[1] ?? '').toLowerCase()
      return (
        <CodeBlock lang={lang} onRunInTerminal={onRunInTerminal}>
          {children}
        </CodeBlock>
      )
    },
    table: ({ children }) => (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    img: ({ src, alt }) =>
      typeof src === 'string' && /^https?:\/\//i.test(src) ? <WebImage src={src} alt={alt ?? ''} /> : null,
    // Colour swatches (tagged by remarkHermione); every other span is a highlight token.
    span: ({ className, children, ...rest }) => {
      const color = (rest as Record<string, unknown>)['data-color']
      if (hasClass(className, 'md-swatch') && typeof color === 'string' && HEX_COLOR.test(color)) {
        return <Swatch color={color} isCode={hasClass(className, 'is-code')} />
      }
      return <span className={className}>{children}</span>
    },
    // Callout titles get their icon; gallery and callout boxes pass through.
    div: ({ className, children, role, ...rest }) => {
      const kind = (rest as Record<string, unknown>)['data-kind'] as CalloutKind | undefined
      if (hasClass(className, 'md-callout-title') && kind && kind in CALLOUT_ICON) {
        const Icon = CALLOUT_ICON[kind]
        return (
          <div className={className}>
            <Icon className="size-4" aria-hidden />
            {children}
          </div>
        )
      }
      return (
        <div className={className} role={role}>
          {children}
        </div>
      )
    },
  }
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  onRunInTerminal,
}: {
  text: string
  onRunInTerminal?: (command: string) => void
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHermione]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={components(onRunInTerminal)}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
