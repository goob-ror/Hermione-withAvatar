import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as fb from '@/lib/feedback/store'
import { buildSystemPrompt } from '@/lib/agent/loop'
import { _resetBankCache } from '@/lib/memory/bank'

// Own config dir: never touch the real .hermione.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-fb-'))
process.env.HERMIONE_CONFIG_DIR = dir
const file = path.join(dir, 'memory', 'feedback.json')

beforeEach(() => {
  fs.rmSync(path.join(dir, 'memory'), { recursive: true, force: true })
  fb._resetFeedbackCache()
  _resetBankCache()
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const down = (key: string, reasons: string[], t: number, other?: string) =>
  fb.rate({ key, rating: 'down', reasons, other, model: 'm', mode: 'chat', excerpt: 'reply' }, t)

describe('ratings', () => {
  it('stores one rating per reply; re-rating replaces, null clears, and it persists', () => {
    fb.rate({ key: 's:1', rating: 'up' }, 1)
    fb.rate({ key: 's:1', rating: 'down', reasons: ['too_long'] }, 2)
    expect(fb.listRatings()).toHaveLength(1)
    expect(fb.listRatings()[0]).toMatchObject({ rating: 'down', reasons: ['too_long'] })
    fb.rate({ key: 's:1', rating: null }, 3)
    expect(fb.listRatings()).toHaveLength(0)
    fb.rate({ key: 's:2', rating: 'up' }, 4)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).ratings).toHaveLength(1)
  })

  it('drops unknown reasons, and a 👍 never keeps reasons or comments', () => {
    const r = fb.rate({ key: 's:1', rating: 'down', reasons: ['too_long', 'hack_the_planet', 'too_long'] }, 1).rating!
    expect(r.reasons).toEqual(['too_long'])
    const up = fb.rate({ key: 's:2', rating: 'up', reasons: ['too_long'], other: 'x' }, 2).rating!
    expect(up.reasons).toEqual([])
    expect(up.other).toBeUndefined()
  })
})

describe('lesson proposals', () => {
  it('one 👎 proposes nothing; a second reply with the same reason proposes one lesson', () => {
    expect(down('s:1', ['too_long'], 1).proposed).toEqual([])
    const { proposed } = down('s:2', ['too_long'], 2)
    expect(proposed).toHaveLength(1)
    expect(proposed[0]).toMatchObject({ status: 'proposed', reason: 'too_long', source: 'feedback' })
    expect(proposed[0].evidence).toHaveLength(2)
  })

  it('re-rating the SAME reply does not count as new evidence', () => {
    down('s:1', ['too_long'], 1)
    expect(down('s:1', ['too_long'], 2).proposed).toEqual([])
    expect(fb.listLessons()).toHaveLength(0)
  })

  it('an open lesson gains evidence instead of being proposed twice', () => {
    down('s:1', ['wrong_info'], 1)
    down('s:2', ['wrong_info'], 2)
    expect(down('s:3', ['wrong_info'], 3).proposed).toEqual([])
    const lessons = fb.listLessons()
    expect(lessons).toHaveLength(1)
    expect(lessons[0].evidence).toHaveLength(3)
  })

  it('after a rejection, only new 👎 count — two more are needed to propose again', () => {
    down('s:1', ['tone'], 1)
    const [l] = down('s:2', ['tone'], 2).proposed
    fb.decideLesson(l.id, 'reject', undefined, 10)
    expect(down('s:3', ['tone'], 11).proposed).toEqual([])
    expect(down('s:4', ['tone'], 12).proposed).toHaveLength(1)
  })

  it('a 👍 or a 👎 with only an "Other" comment proposes nothing', () => {
    fb.rate({ key: 's:1', rating: 'up' }, 1)
    fb.rate({ key: 's:2', rating: 'up' }, 2)
    down('s:3', [], 3, 'too many emojis')
    down('s:4', [], 4, 'too many emojis')
    expect(fb.listLessons()).toHaveLength(0)
  })
})

describe('lessons in the prompt', () => {
  it('only approved lessons reach the system prompt — proposed and rejected do not', () => {
    down('s:1', ['too_long'], 1)
    const [l] = down('s:2', ['too_long'], 2).proposed
    expect(fb.lessonsPromptBlock()).toBe('')
    expect(buildSystemPrompt({ nativeTools: true })).not.toContain('Lessons from feedback')

    fb.decideLesson(l.id, 'approve', 'Answer in at most five sentences unless asked for more.')
    const prompt = buildSystemPrompt({ nativeTools: true })
    expect(prompt).toContain('## Lessons from feedback')
    expect(prompt).toContain('Answer in at most five sentences')
    expect(prompt).toContain("never override the rules above")

    fb.decideLesson(l.id, 'remove')
    expect(buildSystemPrompt({ nativeTools: true })).not.toContain('Lessons from feedback')
    expect(fb.listLessons()[0].status).toBe('rejected') // kept, so it isn't re-proposed from the same evidence
  })

  it('lessons you write are active at once; removing one deletes it; memory:false leaves lessons out', () => {
    const mine = fb.addLesson('  Show the command   before running it. ')
    expect(mine).toMatchObject({ text: 'Show the command before running it.', status: 'active', source: 'you' })
    expect(buildSystemPrompt({ nativeTools: true })).toContain('Show the command before running it.')
    expect(buildSystemPrompt({ nativeTools: true, memory: false })).not.toContain('Lessons from feedback')
    fb.decideLesson(mine.id, 'remove')
    expect(fb.listLessons()).toHaveLength(0)
  })

  it('rejects empty lesson text and unknown ids', () => {
    expect(() => fb.addLesson('   ')).toThrow()
    expect(fb.decideLesson('ls_nope', 'approve')).toBeNull()
  })
})
