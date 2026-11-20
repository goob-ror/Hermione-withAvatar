import type { ToolDef } from '@/lib/agent/types'

/**
 * ask_user — Hermione asks the operator a multiple-choice question and the
 * run pauses until they answer in the chat form (like a permission card).
 * The loop handles it specially; `run` is only reached if that's bypassed.
 */

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  options: QuestionOption[]
  multiple: boolean
  allowOther: boolean
}

export interface QuestionAnswer {
  choices: string[]
  other?: string
}

const MAX_OPTIONS = 8
const MAX_LABEL = 120
const MAX_DESCRIPTION = 300

/** The model's arguments as a clean question, or what's wrong with them. */
export function parseQuestion(args: Record<string, any>): { ok: true; question: Question } | { ok: false; problem: string } {
  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question) return { ok: false, problem: 'question is required' }

  const raw: unknown[] = Array.isArray(args.options) ? args.options : []
  const options: QuestionOption[] = []
  for (const o of raw) {
    const label = (typeof o === 'string' ? o : (o as any)?.label)
    if (typeof label !== 'string' || !label.trim()) continue
    const description = typeof (o as any)?.description === 'string' ? (o as any).description.trim().slice(0, MAX_DESCRIPTION) : ''
    const clean = label.trim().slice(0, MAX_LABEL)
    if (options.some((x) => x.label.toLowerCase() === clean.toLowerCase())) continue
    options.push(description ? { label: clean, description } : { label: clean })
  }
  if (options.length < 2) return { ok: false, problem: 'options needs at least 2 distinct choices' }
  if (options.length > MAX_OPTIONS) return { ok: false, problem: `options allows at most ${MAX_OPTIONS} choices` }

  return {
    ok: true,
    question: {
      question: question.slice(0, 500),
      options,
      multiple: args.multiple === true,
      allowOther: args.allow_other !== false,
    },
  }
}

/**
 * Check the operator's answer against the question (choices must be offered
 * options) and phrase it for the model. Null when it doesn't fit.
 */
export function answerText(q: Question, answer: QuestionAnswer): string | null {
  const offered = new Set(q.options.map((o) => o.label))
  const choices = [...new Set(answer.choices)]
  if (choices.some((c) => !offered.has(c))) return null
  const other = q.allowOther ? (answer.other ?? '').trim().slice(0, 2000) : ''
  if (!choices.length && !other) return null
  if (!q.multiple && choices.length + (other ? 1 : 0) > 1) return null

  const parts = choices.map((c) => `"${c}"`)
  if (other) parts.push(`their own answer: "${other}"`)
  return `The operator answered "${q.question}" with ${parts.join(' and ')}.`
}

export const SKIPPED_TEXT = 'The operator skipped the question without choosing. Carry on with sensible defaults, or ask in plain words.'
export const IGNORED_TEXT = 'The operator did not use the form; their reply follows as a chat message.'

export const askUser: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the operator a multiple-choice question when you need a decision from them (which option, which style, which file). ' +
    'They see a form with your options and answer by clicking; you get their choice back. ' +
    'Use it only for a real choice — not for yes/no permission (gated tools ask for that), and not when you can find the answer yourself.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question, one short sentence.' },
      options: {
        type: 'array',
        description: `2–${MAX_OPTIONS} choices: a short label each, plus an optional one-line description.`,
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, description: { type: 'string' } },
          required: ['label'],
        },
      },
      multiple: { type: 'boolean', description: 'true to let them pick several (checkboxes). Default false.' },
      allow_other: { type: 'boolean', description: 'Offer an "Other" box for their own answer. Default true.' },
    },
    required: ['question', 'options'],
  },
  async run() {
    return { ok: false, output: 'ask_user needs the chat form — it cannot run here.' }
  },
}
