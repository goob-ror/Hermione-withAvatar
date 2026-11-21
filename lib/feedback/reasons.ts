/**
 * Why a reply got 👎 — the options on the feedback form, and the lesson each
 * one proposes once it repeats. Shared by the server store and the page.
 */
export const REASONS = [
  { id: 'wrong_info', label: 'Wrong or made-up info', lesson: 'Check facts with your tools before stating them, and say plainly when you are not sure.' },
  { id: 'too_long', label: 'Too long', lesson: 'Keep answers short and to the point; skip filler, recaps and headers unless asked.' },
  { id: 'too_short', label: 'Too short / missing detail', lesson: 'Give enough detail to act on: include the specifics, steps or examples the question needs.' },
  { id: 'ignored_instructions', label: "Didn't follow my instructions", lesson: "Re-read the operator's request before answering and follow every explicit instruction in it." },
  { id: 'unfinished', label: 'Said it was done, but it wasn’t', lesson: 'Only say a task is done after verifying it; report anything unfinished or unverified.' },
  { id: 'should_ask', label: 'Should have asked first', lesson: 'When a request is ambiguous in a way that changes the result, ask with ask_user before acting.' },
  { id: 'guessed', label: 'Guessed instead of using tools', lesson: 'Use your tools (search, read files, open pages) instead of guessing.' },
  { id: 'tone', label: 'Tone or style was off', lesson: 'Match the tone of the conversation: plain and direct for work, lighter only when the operator is.' },
] as const

export type ReasonId = (typeof REASONS)[number]['id']
export const REASON_IDS = REASONS.map((r) => r.id) as [ReasonId, ...ReasonId[]]
export const reasonLabel = (id: string) => REASONS.find((r) => r.id === id)?.label ?? id
