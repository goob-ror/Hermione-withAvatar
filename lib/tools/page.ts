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

export const pageOpen: ToolDef = {
  name: 'page_open',
  description:
    'Open a URL in the preview panel. The page is fetched, distilled to readable text, and rendered in an iframe the agent can then act on. Domain must be allowlisted. Requires approval.',
  group: 'browse',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL' },
      max_chars: { type: 'number', description: 'Cap the distilled text (default 12000)' },
      acknowledged: {
        type: 'boolean',
        description: 'Set true only after the operator approved this host in the visit modal. The gate is bypassed for this host in this session.',
      },
    },
    required: ['url'],
  },
  async run(args, ctx) {
    const result = await openPage(ctx.sessionId, String(args.url ?? ''), {
      maxChars: Number(args.max_chars) || undefined,
      acknowledged: args.acknowledged === true,
    })

    // The consent gate stopped the run. Tell the client to raise the modal; the
    // operator's answer comes back as a fresh call with `acknowledged: true`.
    if (result.blocked && result.consentRequired) {
      ctx.emit({
        type: 'visit_request',
        url: String(args.url ?? ''),
        host: result.host ?? '',
        approved: false,
        reason: 'first visit to this host in this session',
      })
      return {
        ok: false,
        output:
          `BLOCKED by the visit gate: this session has not approved ${result.host}. ` +
          'The operator is being asked now. Do not retry this call — wait for the operator to approve, ' +
          'then either continue or call page_open again with acknowledged set to true.',
      }
    }

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
    'Act on the page in the preview panel: click an element (by CSS selector or visible text), fill an input, submit a form, scroll, query elements, or read live text/links. Runs in the browser and returns what actually happened. Requires approval.',
  group: 'browse',
  tier: 'confirm',
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
