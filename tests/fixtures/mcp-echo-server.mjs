// A tiny MCP server for tests: one read-only tool and one that changes something.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo', version: '1.0.0' })
const notes = []
server.registerTool(
  'echo',
  { description: 'Echo the text back', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }),
)
server.registerTool(
  'write_note',
  { description: 'Store a note', inputSchema: { note: z.string() } },
  async ({ note }) => {
    notes.push(note)
    return { content: [{ type: 'text', text: `stored ${notes.length} note(s)` }] }
  },
)
await server.connect(new StdioServerTransport())
