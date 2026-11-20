import { describe, expect, it } from 'vitest'
import { answerText, parseQuestion } from '@/lib/tools/ask'

describe('ask_user question parsing', () => {
  it('accepts plain strings or {label, description} and drops blanks and duplicates', () => {
    const r = parseQuestion({ question: ' Which? ', options: ['A', { label: 'B', description: 'second' }, '', 'a', { nope: 1 }] })
    expect(r).toEqual({
      ok: true,
      question: { question: 'Which?', options: [{ label: 'A' }, { label: 'B', description: 'second' }], multiple: false, allowOther: true },
    })
  })

  it('needs a question and 2–8 options', () => {
    expect(parseQuestion({ options: ['A', 'B'] }).ok).toBe(false)
    expect(parseQuestion({ question: 'Q', options: ['A'] }).ok).toBe(false)
    expect(parseQuestion({ question: 'Q', options: 'A,B' }).ok).toBe(false)
    expect(parseQuestion({ question: 'Q', options: Array.from({ length: 9 }, (_, i) => `o${i}`) }).ok).toBe(false)
  })
})

describe('ask_user answers', () => {
  const single = { question: 'Tone?', options: [{ label: 'Formal' }, { label: 'Playful' }], multiple: false, allowOther: true }
  const multi = { ...single, multiple: true, allowOther: false }

  it('phrases a valid answer for the model', () => {
    expect(answerText(single, { choices: ['Formal'] })).toBe('The operator answered "Tone?" with "Formal".')
    expect(answerText(single, { choices: [], other: 'Dry wit' })).toMatch(/their own answer: "Dry wit"/)
    expect(answerText(multi, { choices: ['Formal', 'Playful'] })).toMatch(/"Formal" and "Playful"/)
  })

  it('refuses answers that do not fit the question', () => {
    expect(answerText(single, { choices: ['Rude'] })).toBeNull() // not an option
    expect(answerText(single, { choices: ['Formal', 'Playful'] })).toBeNull() // one only
    expect(answerText(single, { choices: [] })).toBeNull() // nothing picked
    expect(answerText(multi, { choices: [], other: 'x' })).toBeNull() // "Other" not offered
  })
})
