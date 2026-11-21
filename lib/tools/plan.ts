import type { ToolDef } from '@/lib/agent/types'

/**
 * update_plan — Hermione's visible task checklist (like Claude's): the
 * operator sees each step with a spinner (working), a dashed circle (to do)
 * or a check (done), updated live as she works.
 */

export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export interface PlanItem {
  content: string
  status: PlanStatus
}

const MAX_ITEMS = 12

/** The model's items as a clean list (null when unusable). At most one step is in progress. */
export function parsePlan(raw: unknown): PlanItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: PlanItem[] = []
  for (const r of raw) {
    const content = String(typeof r === 'string' ? r : (r as any)?.content ?? (r as any)?.step ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
    if (!content) continue
    const s = String((r as any)?.status ?? 'pending').toLowerCase().replace(/[\s-]/g, '_')
    const status: PlanStatus = s === 'completed' || s === 'done' ? 'completed' : s === 'in_progress' || s === 'active' ? 'in_progress' : 'pending'
    items.push({ content, status })
    if (items.length >= MAX_ITEMS) break
  }
  if (!items.length) return null
  // Only one "in progress" at a time — keep the first.
  let seen = false
  for (const it of items) {
    if (it.status !== 'in_progress') continue
    if (seen) it.status = 'pending'
    seen = true
  }
  return items
}

export const updatePlan: ToolDef = {
  name: 'update_plan',
  description:
    'Show the operator your step-by-step plan as a live checklist. For any task with 3 or more steps, call it FIRST with the whole plan ' +
    '(first step "in_progress", the rest "pending"), then call it again each time you finish a step (mark it "completed", the next "in_progress"). ' +
    'Send the whole list every time. Mark everything "completed" before your final answer. You may call it alongside another tool in the same turn. ' +
    'Skip it for simple questions. Runs automatically.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: `The whole plan, in order (2–${MAX_ITEMS} short steps, a few words each)`,
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The step, e.g. "Search for top puppy breeds"' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['items'],
  },
  async run(args, ctx) {
    const items = parsePlan(args.items)
    if (!items) return { ok: false, output: 'items must be a list of {content, status}' }
    ctx.emit({ type: 'plan', items })
    const next = items.find((i) => i.status === 'in_progress')
    const left = items.filter((i) => i.status !== 'completed').length
    return {
      ok: true,
      output: left ? `Plan shown (${items.length - left}/${items.length} done${next ? `; now: ${next.content}` : ''}).` : 'Plan complete — all steps done.',
    }
  },
}
