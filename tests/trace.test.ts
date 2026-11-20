import { describe, expect, it } from 'vitest'
import { describeTool, formatElapsed, thinkingHeadline } from '@/lib/agent/stepText'
import { parsePlan, updatePlan } from '@/lib/tools/plan'

describe('step descriptions', () => {
  it('says what each tool is doing in plain words, present or past', () => {
    expect(describeTool('web_search', { query: 'top puppy breeds' })).toBe('Searching the web for “top puppy breeds”')
    expect(describeTool('web_search', { query: 'x' }, true)).toBe('Searched the web for “x”')
    expect(describeTool('web_fetch', { url: 'https://www.akc.org/most-popular-breeds/' })).toBe('Reading akc.org')
    expect(describeTool('image_search', { queries: ['Samoyed puppy', 'Corgi puppy', 'Pug', 'Beagle'] })).toBe(
      'Finding pictures of Samoyed puppy, Corgi puppy and 2 more',
    )
    expect(describeTool('fs_read', { path: 'C:\\proj\\src\\app.tsx' })).toBe('Reading app.tsx')
    expect(describeTool('shell_run', { command: 'git status' })).toBe('Running `git status`')
    expect(describeTool('page_act', { command: 'fill', value: 'London' })).toBe('Typing “London” on the page')
    expect(describeTool('notes_search', { query: 'wifi' }, true)).toBe('Searched your notes for “wifi”')
    expect(describeTool('brand_new_tool', {})).toBe('Using brand new tool')
  })

  it('shows the newest finished sentence of her thinking', () => {
    expect(thinkingHeadline('The user wants breeds. I should check the AKC list first. Then find pict')).toBe(
      'I should check the AKC list first.',
    )
    expect(thinkingHeadline('Just started thinking')).toBe('Just started thinking')
    expect(thinkingHeadline('**Plan:** use `web_search`.')).toBe('Plan: use web_search.')
    expect(thinkingHeadline('')).toBe('')
    expect(thinkingHeadline('word '.repeat(60) + '.').length).toBeLessThanOrEqual(110)
  })

  it('formats elapsed time', () => {
    expect(formatElapsed(400)).toBe('0s')
    expect(formatElapsed(14_200)).toBe('14s')
    expect(formatElapsed(65_000)).toBe('1m 05s')
  })
})

describe('update_plan', () => {
  it('cleans the list: strings or objects, odd statuses, one step in progress', () => {
    expect(
      parsePlan([
        'Search breeds',
        { content: ' Find   pictures ', status: 'in-progress' },
        { content: 'Write answer', status: 'in_progress' },
        { step: 'Check', status: 'done' },
        { content: '' },
      ]),
    ).toEqual([
      { content: 'Search breeds', status: 'pending' },
      { content: 'Find pictures', status: 'in_progress' },
      { content: 'Write answer', status: 'pending' },
      { content: 'Check', status: 'completed' },
    ])
    expect(parsePlan('nope')).toBeNull()
    expect(parsePlan([])).toBeNull()
  })

  it('shows the plan in the chat and tells her where she is', async () => {
    const events: any[] = []
    const r = await updatePlan.run(
      { items: [{ content: 'Search', status: 'completed' }, { content: 'Summarise', status: 'in_progress' }] },
      { sessionId: 's', emit: (e: any) => events.push(e) } as any,
    )
    expect(events[0]).toEqual({ type: 'plan', items: [{ content: 'Search', status: 'completed' }, { content: 'Summarise', status: 'in_progress' }] })
    expect(r.output).toBe('Plan shown (1/2 done; now: Summarise).')
    const done = await updatePlan.run({ items: [{ content: 'Search', status: 'completed' }] }, { sessionId: 's', emit: () => {} } as any)
    expect(done.output).toMatch(/all steps done/)
  })
})
