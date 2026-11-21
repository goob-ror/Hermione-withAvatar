import { describe, expect, it } from 'vitest'
import { expressionsEnabled, expressive, isSomber, sanitizeTags, stripTags } from '@/lib/tts/expression'
import { cleanForSpeech } from '@/lib/tts/audio'
import { chunkText, speechChunks } from '@/lib/voice/speaker'
import { speakable } from '@/components/ReplyActions'

const tags = (s: string) => s.match(/<[a-z]+>/g) ?? []

describe('expression cues', () => {
  it('turns opening laughter into a chuckle and drops the "haha"', () => {
    expect(expressive('Haha, that is a clever trick.')).toBe('<chuckle> That is a clever trick.')
    expect(expressive('Ha! Well played.')).toBe('<chuckle> Well played.')
    expect(expressive('Heh, fair point.')).toBe('<chuckle> Fair point.')
  })

  it('replaces laughter mid-line with one chuckle', () => {
    expect(expressive("That's rather clever, haha.")).toBe("That's rather clever <chuckle>.")
    expect(tags(expressive('Funny, haha. And again, haha.'))).toEqual(['<chuckle>'])
    expect(expressive('Funny, haha. And again, haha.')).not.toMatch(/haha/i)
  })

  it('sighs with relief, gasps at surprises, groans at nuisances', () => {
    expect(expressive('Phew, that took a while.')).toBe('<sigh> That took a while.')
    expect(expressive("Finally, it's done.")).toBe("<sigh> Finally, it's done.")
    expect(expressive('Oh! I see what happened.')).toBe('<gasp> Oh! I see what happened.')
    expect(expressive('Whoa, that is fast.')).toBe('<gasp> Whoa, that is fast.')
    expect(expressive('Ugh, this page again.')).toBe('<groan> This page again.')
  })

  it('leaves ordinary lines alone', () => {
    for (const line of [
      'Still searching the web for you.',
      'Finally, add the eggs and stir.',
      'Oh, and one more thing.',
      "Hello, Sam. I'm Hermione. Let's build something today.",
      'The latest stable Next.js is 16.4.6.',
    ]) {
      expect(expressive(line)).toBe(line)
    }
  })

  it('sighs on only some "Hmm" lines, the same ones every time', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Hmm, let me think about option ${i}.`)
    const sighed = lines.filter((l) => expressive(l).startsWith('<sigh>')).length
    expect(sighed).toBeGreaterThan(0)
    expect(sighed).toBeLessThan(20)
    for (const l of lines) expect(expressive(l)).toBe(expressive(l))
  })

  it('never adds two tags to a line', () => {
    expect(tags(expressive('Haha, nice. Phew, done. Ugh, again. Whoa.'))).toEqual(['<chuckle>'])
    expect(tags(expressive('Done. Phew, that was a long one.'))).toEqual(['<sigh>'])
  })

  it('stays quiet on errors, failures and bad news', () => {
    for (const line of [
      'Haha, the build failed again.',
      'Ugh, something went wrong.',
      "Oh! I'm sorry to hear that.",
      'Whoa, the server crashed.',
      'Phew. Unfortunately it could not be saved.',
    ]) {
      expect(tags(expressive(line))).toEqual([])
    }
    expect(expressive('Haha, the build failed again.')).toBe('The build failed again.')
    expect(expressive('Something went wrong. <laugh> The details are in the chat.')).toBe(
      'Something went wrong. The details are in the chat.',
    )
    expect(isSomber('Oh no, that is bad news.')).toBe(true)
  })

  it('does not leave a tag with nothing to say', () => {
    expect(stripTags(expressive('Haha!'))).toMatch(/\w/)
  })
})

describe('tag hygiene', () => {
  it('keeps only the first allowed tag and drops unknown or off-character ones', () => {
    expect(sanitizeTags('Well <smile> then <laugh> fine <sigh> ok.')).toBe('Well then <laugh> fine ok.')
    expect(sanitizeTags('<cough> Excuse me. <yawn> Late.')).toBe('Excuse me. Late.')
    expect(sanitizeTags('A < B and C > D')).toBe('A < B and C > D')
    expect(sanitizeTags('< CHUCKLE > Indeed.')).toBe('<chuckle> Indeed.')
  })

  it('a tag already in the text counts as the one', () => {
    expect(expressive('<sigh> Haha, fine.')).toBe('<sigh> Fine.')
  })

  it('strips every tag for VoxCPM2, browser speech and the screen', () => {
    expect(stripTags('<chuckle> Well played. <sigh> Done <gasp>!')).toBe('Well played. Done!')
  })

  it('can be switched off', () => {
    expect(expressionsEnabled({})).toBe(true)
    expect(expressionsEnabled({ HERMIONE_VOICE_EXPRESSIONS: 'off' })).toBe(false)
    expect(expressionsEnabled({ HERMIONE_VOICE_EXPRESSIONS: 'false' })).toBe(false)
    expect(expressionsEnabled({ HERMIONE_VOICE_EXPRESSIONS: 'on' })).toBe(true)
  })
})

describe('tags survive the speech pipeline', () => {
  it('cleanForSpeech keeps tags whole but still removes Markdown', () => {
    expect(cleanForSpeech('**Well** <chuckle> played > `now`')).toBe('Well <chuckle> played now')
    expect(cleanForSpeech('<Sigh>  Done.')).toBe('<sigh> Done.')
  })

  it('Read aloud keeps tags whole', () => {
    expect(speakable('> quoted\n\n<chuckle> **Nice** one.')).toContain('<chuckle> Nice one.')
  })

  it('chunking never splits a tag', () => {
    const text = `${'This is a fairly long sentence that keeps going on. '.repeat(4)}<sigh> Finally done. ${'More words here to fill. '.repeat(6)}`
    for (const chunks of [chunkText(text, 90), chunkText(text, 140), speechChunks(text, true)]) {
      const joined = chunks.join(' ')
      expect(tags(joined)).toEqual(['<sigh>'])
      for (const c of chunks) expect(c).not.toMatch(/<[a-z]*$|^[a-z]*>/)
    }
  })
})
