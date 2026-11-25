import type { ToolDef } from '@/lib/agent/types'
import { MAX_REPORT, MAX_STEPS, runWorker } from '@/lib/agent/worker'

/**
 * delegate — hand one research task to a worker sub-agent (cheap helper
 * model, read-only web tools) and get back a short report. Several delegate
 * calls in one turn run in parallel, so independent questions are answered
 * at the same time, and the pages never fill Hermione's own context.
 */
export const delegate: ToolDef = {
  name: 'delegate',
  description:
    'Give ONE self-contained research task to a fast worker sub-agent and get back a short report with sources. ' +
    'It can search the web, read pages and inspect videos (read-only), and sees only your task text — include every detail it needs. ' +
    `It stops after ${MAX_STEPS} tool rounds and reports in under ${MAX_REPORT} characters. ` +
    'Call delegate several times in the same turn for independent sub-questions (e.g. one per product, source or city): they run in parallel. ' +
    'Do not delegate quick single lookups (call web_search yourself) or anything needing files, the shell, the live browser or the operator.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task, complete and specific: what to find, for what purpose, and what to report.' },
      sources: { type: 'array', items: { type: 'string' }, description: 'Optional URLs the worker should start from.' },
    },
    required: ['task'],
  },
  async run(args, ctx) {
    const task = String(args.task ?? '').trim()
    if (!task) return { ok: false, output: 'delegate needs a task' }
    const r = await runWorker(task.slice(0, 2000), {
      sources: Array.isArray(args.sources) ? args.sources.map(String) : [],
      sessionId: ctx.sessionId,
      emit: ctx.emit,
      parentCallId: ctx.callId,
    })
    if (!r.ok) return { ok: false, output: `The worker could not finish: ${r.error}. Do this yourself instead.` }
    return { ok: true, output: `Worker report (${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.model}):\n${r.report}` }
  },
}
