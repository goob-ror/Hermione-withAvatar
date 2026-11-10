import type { ToolDef } from '@/lib/agent/types'
import { openPage } from '@/lib/preview/open'
import { getPage } from '@/lib/preview/store'
import { awaitCommand } from '@/lib/preview/store'

const ACT_COMMANDS = [
  'click',
  'fill',
  'submit',
  'scroll',
  'query',
  'count',
  'text',
  'links',
  'title',
  'url',
] as const

/** Bridge commands that only read the page — no clicks, no typing, no navigation. */
const READ_ONLY_COMMANDS = new Set<string>(['query', 'count', 'text', 'links', 'title', 'url'])

export const pageOpen: ToolDef = {
  name: 'page_open',
  description:
    'Show a public web page in the preview panel so the operator can watch, and so page_act can click/type on it. To just READ a page, web_fetch is lighter. Public internet only (no localhost / LAN). Runs automatically.',
  group: 'browse',
  // Auto, public only: the page renders sandboxed (opaque origin) and proxy.ts
  // refuses its API calls, so a hostile page can't reach Hermione or this machine.
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL on the public internet' },
      max_chars: { type: 'number', description: 'Cap the distilled text (default 12000)' },
    },
    required: ['url'],
  },
  async run(args, ctx) {
    const result = await openPage(ctx.sessionId, String(args.url ?? ''), {
      maxChars: Number(args.max_chars) || undefined,
      publicOnly: true,
    })

    if (result.ok && result.page) {
      ctx.emit({
        type: 'preview_ready',
        url: result.page.url,
        title: result.page.title,
        textLength: result.page.text.length,
      })
    }

    return { ok: result.ok, output: result.output }
  },
}

export const pageRead: ToolDef = {
  name: 'page_read',
  description:
    'Read the readable text of the page currently open in the preview panel (already distilled — headings and links included). No approval needed.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      max_chars: { type: 'number', description: 'Truncate the returned text (default 8000)' },
    },
  },
  async run(args, ctx) {
    const page = getPage(ctx.sessionId)
    if (!page) {
      return {
        ok: false,
        output: 'no page is open in the preview panel — call page_open first',
      }
    }
    const max = Math.min(50000, Math.max(500, Number(args.max_chars) || 8000))
    const body = page.text.length > max ? `${page.text.slice(0, max)}\n… truncated (${page.text.length} chars total)` : page.text
    const header = [
      `url: ${page.url}`,
      `title: ${page.title || '(none)'}`,
      page.description ? `description: ${page.description}` : '',
      page.headings.length ? `headings: ${page.headings.slice(0, 12).join(' | ')}` : '',
      'note: this is the snapshot taken when the page was opened; page_act echoes the live text after each action',
      '',
    ]
      .filter(Boolean)
      .join('\n')
    return { ok: true, output: `${header}\n${body}` }
  },
}

export const pageAct: ToolDef = {
  name: 'page_act',
  description:
    'Act on the page in the preview panel: click an element (by CSS selector or visible text), fill an input, submit a form, scroll, query elements, or read live text/links. Read commands (text, query, count, title, links, url) run automatically; click, fill, submit and scroll need approval.',
  group: 'browse',
  tier: 'confirm',
  // Reading the rendered page is as harmless as page_read; changing it is not.
  needsApproval: (args) => !READ_ONLY_COMMANDS.has(String(args.command ?? '').trim()),
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: [...ACT_COMMANDS],
        description: 'What to do on the page',
      },
      selector: { type: 'string', description: 'CSS selector (for click/fill/query/count/submit)' },
      text: { type: 'string', description: 'Visible text to match instead of a selector (click/fill)' },
      value: { type: 'string', description: 'Value to type into the element (fill)' },
      y: { type: 'number', description: 'Vertical scroll offset in pixels (scroll)' },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    const command = String(args.command ?? '').trim()
    if (!ACT_COMMANDS.includes(command as (typeof ACT_COMMANDS)[number])) {
      return { ok: false, output: `unknown page command "${command}" — use one of: ${ACT_COMMANDS.join(', ')}` }
    }

    const page = getPage(ctx.sessionId)
    if (!page) {
      return { ok: false, output: 'no page is open in the preview panel — call page_open first' }
    }

    const commandId = `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const payload: Record<string, any> = {
      selector: args.selector,
      text: args.text,
      value: args.value,
      y: args.y,
    }

    // Models very often send the text to type as `text` instead of `value`.
    if (command === 'fill' && payload.value == null && payload.text != null) {
      payload.value = payload.text
    }

    // Hand the command to the browser, then wait for the bridge to answer.
    const waiting = awaitCommand(commandId, 30000)
    ctx.emit({ type: 'preview_command', commandId, command, args: payload })
    const result = await waiting

    return {
      ok: result.ok,
      output: `${command} on ${page.url}\n${result.output}`,
    }
  },
}

export { ACT_COMMANDS }
