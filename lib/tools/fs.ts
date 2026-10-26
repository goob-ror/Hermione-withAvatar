import fs from 'fs'
import path from 'path'
import type { ToolDef } from '@/lib/agent/types'
import { agentRoot, displayPath, resolveAllowed } from '@/lib/agent/paths'

const MAX_READ_BYTES = 256 * 1024

export const fsList: ToolDef = {
  name: 'fs_list',
  description:
    'List a directory inside the agent root, or inside a folder the operator granted. Read-only. Returns one entry per line with type and size.',
  group: 'shell',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path, relative to the agent root. Defaults to "."' },
    },
    required: [],
  },
  async run(args) {
    const abs = resolveAllowed(args.path ?? '.')
    const stat = fs.statSync(abs)
    if (!stat.isDirectory()) return { ok: false, output: `${displayPath(abs)} is not a directory` }

    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    if (entries.length === 0) return { ok: true, output: `${displayPath(abs)} is empty` }

    const lines = entries.slice(0, 400).map((e) => {
      const full = path.join(abs, e.name)
      let size = ''
      try {
        const s = fs.statSync(full)
        size = e.isDirectory() ? 'dir' : `${s.size} B`
      } catch {
        size = '?'
      }
      return `${e.isDirectory() ? 'd' : '-'} ${size.padStart(12)}  ${e.name}${e.isDirectory() ? '/' : ''}`
    })

    const more = entries.length > 400 ? `\n… ${entries.length - 400} more entries` : ''
    return { ok: true, output: `# ${displayPath(abs)} (${entries.length} entries)\n${lines.join('\n')}${more}` }
  },
}

export const fsRead: ToolDef = {
  name: 'fs_read',
  description: 'Read a text file inside the agent root, or inside a granted folder. Read-only. Files over 256 KB are truncated.',
  group: 'shell',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the agent root' },
      offset: { type: 'number', description: '1-based first line to return (optional)' },
      limit: { type: 'number', description: 'Maximum number of lines to return (optional)' },
    },
    required: ['path'],
  },
  async run(args) {
    const abs = resolveAllowed(args.path)
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) return { ok: false, output: `${displayPath(abs)} is a directory — use fs_list` }
    if (stat.size > 8 * 1024 * 1024) {
      return { ok: false, output: `refusing to read ${displayPath(abs)}: ${stat.size} bytes is too large` }
    }

    const raw = fs.readFileSync(abs, 'utf-8')
    const allLines = raw.split('\n')
    const offset = Math.max(1, Number(args.offset) || 1)
    const limit = Math.min(4000, Math.max(1, Number(args.limit) || 4000))
    const slice = allLines.slice(offset - 1, offset - 1 + limit)

    let body = slice.join('\n')
    if (body.length > MAX_READ_BYTES) body = body.slice(0, MAX_READ_BYTES) + '\n… truncated at 256 KB'
    const tail =
      allLines.length > offset - 1 + limit
        ? `\n… ${allLines.length - (offset - 1 + limit)} more lines (use offset/limit)`
        : ''

    return {
      ok: true,
      output: `# ${displayPath(abs)} (${allLines.length} lines, ${stat.size} bytes)\n${body}${tail}`,
    }
  },
}

export const fsWrite: ToolDef = {
  name: 'fs_write',
  description:
    'Write or overwrite a text file inside the agent root, or inside a granted read/write folder. Creates parent directories. Requires approval.',
  group: 'shell',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the agent root' },
      content: { type: 'string', description: 'Full file content to write' },
      append: { type: 'boolean', description: 'Append instead of overwrite (default false)' },
    },
    required: ['path', 'content'],
  },
  async run(args) {
    const abs = resolveAllowed(args.path, { need: 'write' })
    const content = String(args.content ?? '')
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    if (args.append) fs.appendFileSync(abs, content, 'utf-8')
    else fs.writeFileSync(abs, content, 'utf-8')

    const size = fs.statSync(abs).size
    return {
      ok: true,
      output: `${args.append ? 'appended to' : 'wrote'} ${displayPath(abs)} (${size} bytes)`,
    }
  },
}

export const fsDelete: ToolDef = {
  name: 'fs_delete',
  description:
    'Delete a file, or an empty directory, inside the agent root or a granted read/write folder. Refuses the root itself. Requires approval.',
  group: 'shell',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the agent root' },
      recursive: { type: 'boolean', description: 'Remove a directory tree (default false)' },
    },
    required: ['path'],
  },
  async run(args) {
    const abs = resolveAllowed(args.path, { need: 'write' })
    if (abs === agentRoot()) return { ok: false, output: 'refusing to delete the agent root' }

    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      if (args.recursive) fs.rmSync(abs, { recursive: true, force: false })
      else fs.rmdirSync(abs)
    } else {
      fs.unlinkSync(abs)
    }
    return { ok: true, output: `deleted ${displayPath(abs)}` }
  },
}
