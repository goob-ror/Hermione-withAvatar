import { describe, expect, it } from 'vitest'
import { plainSpeech, spokenSummary, waitingLine } from '@/lib/voice/summary'
import { chunkText, speechChunks } from '@/lib/voice/speaker'
import { cleanForSpeech, pcmToWav } from '@/lib/tts/audio'

const PUPPIES = [
  'Here are some of the most beloved puppy breeds that steal hearts everywhere! 🐾',
  '',
  '## Top Puppy Breeds',
  '',
  '1. ![Golden](https://img.test/g.jpg) **Golden Retriever** [[Family Favorite]] — The ultimate companion',
  '2. ![Lab](https://img.test/l.jpg) **Labrador Retriever** [[Most Popular]] — Loyal and gentle',
  '3. ![Frenchie](https://img.test/f.jpg) **French Bulldog** [[City Living]] — Compact and charming',
  '4. ![Beagle](https://img.test/b.jpg) **Beagle** [[Merry]] — Curious',
  '',
  '## My picks',
  '',
  '![🥇 Golden Retriever — sunshine](https://img.test/g.jpg)',
  '![🥈 French Bulldog](https://img.test/f.jpg)',
  '',
  '**Pro tip:** Consider your lifestyle first — active breeds need daily exercise. Others are happy on the couch.',
].join('\n')

describe('spoken summary', () => {
  it('says the opening line, what the list holds, and the tip — no URLs, emoji or markup', () => {
    const s = spokenSummary(PUPPIES)
    expect(s).toBe(
      'Here are some of the most beloved puppy breeds that steal hearts everywhere! ' +
        '4 in the list: Golden Retriever, Labrador Retriever and French Bulldog, and more. ' +
        'Pro tip: Consider your lifestyle first — active breeds need daily exercise.',
    )
    expect(s.length).toBeLessThanOrEqual(300)
  })

  it('finds other kinds of closing tips', () => {
    const md = PUPPIES.replace('**Pro tip:**', '**Travel tip:**')
    expect(spokenSummary(md)).toMatch(/Travel tip: Consider your lifestyle first/)
    expect(spokenSummary(PUPPIES.replace('**Pro tip:** ', '> [!TIP]\n> '))).toMatch(/Consider your lifestyle first/)
  })

  it('speaks a short answer whole', () => {
    expect(spokenSummary('The latest stable **Next.js** is `16.4.6`.')).toBe('The latest stable Next.js is 16.4.6.')
  })

  it('mentions code instead of reading it', () => {
    const s = spokenSummary(`Run this to list files in the folder you are in right now, including the hidden ones that start with a dot:\n\n\`\`\`bash\nls -la\n\`\`\`\n\nThat shows sizes and permissions too, which helps when something will not open for you.`)
    expect(s).not.toContain('ls -la')
    expect(s).toContain("I've put the code in the chat.")
  })

  it('never goes over the limit', () => {
    expect(spokenSummary('word '.repeat(400) + '.').length).toBeLessThanOrEqual(301)
  })

  it('plain speech drops pictures, tags and links but keeps link text', () => {
    expect(plainSpeech('See ![x](https://a.b/c.png) [[Tag]] [the docs](https://d.e) now')).toBe('See the docs now')
  })
})

describe('waiting lines', () => {
  it('fit what she is doing and vary', () => {
    expect(waitingLine('image_search', 0)).toMatch(/pictures/)
    expect(waitingLine('web_search', 0)).not.toBe(waitingLine('web_search', 1))
    expect(waitingLine('some_new_tool', 0)).toMatch(/thinking|moment|Nearly/)
    expect(waitingLine(undefined, 0)).toBeTruthy()
  })
})

describe('speech plumbing', () => {
  it('splits long text at sentences, and very long sentences at words', () => {
    const chunks = chunkText(`${'One short sentence. '.repeat(30)}${'longword '.repeat(80)}`, 100)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
    expect(chunks[0].endsWith('.')).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('longword longword')
  })

  it('wraps PCM in a valid WAV header', () => {
    const wav = pcmToWav(Buffer.alloc(4410 * 2), 22050)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(22050) // sample rate
    expect(wav.readUInt16LE(34)).toBe(16) // bits
    expect(wav.readUInt32LE(40)).toBe(8820) // data bytes
    expect(wav.length).toBe(44 + 8820)
  })

  it('cleans text for speech', () => {
    expect(cleanForSpeech('**Hi** 🐾 see https://x.y/z  `now`')).toBe('Hi see now')
  })
})

describe('speech engine', () => {
  it('reads WAVs whatever chunks come before the audio', async () => {
    const { readWav } = await import('@/lib/tts/speech')
    const plain = pcmToWav(Buffer.alloc(960), 48000)
    expect(readWav(plain)).toMatchObject({ rate: 48000, channels: 1, bits: 16 })
    expect(readWav(plain).pcm.length).toBe(960)

    // A LIST chunk between fmt and data (some writers add one).
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')])
    const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)])
    withList.writeUInt32LE(withList.length - 8, 4)
    expect(readWav(withList).pcm.length).toBe(960)
    expect(() => readWav(Buffer.from('not audio at all, not even close'))).toThrow()
  })

  it('turns an expression cue into a VoxCPM2 delivery style (never a spoken tag)', async () => {
    const { styleFor } = await import('@/lib/tts/speech')
    expect(styleFor('<chuckle> Found it.')).toMatch(/amused/)
    expect(styleFor('<sigh> Finally done.')).toMatch(/sigh/)
    expect(styleFor('Hello, sir!', { greeting: true })).toMatch(/energetic/)
    expect(styleFor('Your build passed.')).toBe('')
  })

  it('has no voice (so the browser speaks) when VoxCPM2 is switched off', async () => {
    process.env.HERMIONE_VOXCPM = 'off'
    try {
      const { speak, speechStatus } = await import('@/lib/tts/speech')
      const s = await speechStatus()
      expect(s).toEqual({ engine: null, vox: { state: 'off' } })
      await expect(speak('Hello there.')).rejects.toThrow(/VoxCPM2 is not installed/)
      await expect(speak('Halo semuanya.', { lang: 'id' })).rejects.toThrow(/VoxCPM2 is not installed/)
    } finally {
      delete process.env.HERMIONE_VOXCPM
    }
  })
})

describe('voice language', () => {
  it('recognises Indonesian scripts and not English ones', async () => {
    const { isIndonesian } = await import('@/lib/tts/language')
    expect(isIndonesian('Akun SSCASN CPNS 2026 sudah bisa dibuat sekarang! Ini langkah pertama sebelum pendaftaran resmi dibuka.')).toBe(true)
    expect(isIndonesian('Stop! Jangan sampai gugur CPNS hanya karena salah unggah dokumen.')).toBe(true)
    expect(isIndonesian('Here are the top budget phones under three million rupiah right now.')).toBe(false)
    expect(isIndonesian('Hi, I am Hermione. I found eight lovely puppy breeds for you.')).toBe(false)
    expect(isIndonesian('CPNS 2026')).toBe(false) // too short to tell
    // Casual, slangy Indonesian (a real Forge script that the first version missed).
    expect(
      isIndonesian(
        'Kuliah tapi dompet tipis? Ini rahasianya! Pertama, bawa botol minum sendiri. Hemat 15 ribu per hari, sebulan bisa 450 ribu! Kedua, manfaatin diskon mahasiswa di mana-mana. Jangan malu tunjukin kartu mahasiswa!',
      ),
    ).toBe(true)
    // English with an Indonesian name or two stays English.
    expect(isIndonesian('Here is how to register for CPNS on the SSCASN portal before the deadline.')).toBe(false)
    expect(isIndonesian('Begin with the main skin care routine, then the cabin within the origin margin.')).toBe(false)
  })

  it('speaks English by default; Indonesian only for Indonesian Content Forge clips', async () => {
    const { voiceLangFor } = await import('@/lib/tts/language')
    const id = 'Siapkan email aktif, nomor HP, dan scan KTP sebelum daftar.'
    const en = 'Get your email, phone number and ID card ready before you register.'
    expect(voiceLangFor({ purpose: 'clip', mode: 'forge', text: id })).toBe('id')
    expect(voiceLangFor({ purpose: 'clip', mode: 'forge', text: en })).toBe('en')
    expect(voiceLangFor({ purpose: 'clip', mode: 'chat', text: id })).toBe('en') // not Content Forge
    expect(voiceLangFor({ purpose: 'live', mode: 'forge', text: id })).toBe('en') // live speech is always English
    expect(voiceLangFor({ purpose: 'live', text: id })).toBe('en')
  })
})

describe('speaking quickly with the slower voice', () => {
  const summary =
    'Great choice to start cooking! 5 in the list: Scrambled Eggs, Spaghetti Aglio e Olio and Grilled Cheese Sandwich, and more. Pro tip: Start with scrambled eggs to get comfortable with your stove.'

  it('starts with just the opening sentence for a local voice', () => {
    const chunks = speechChunks(summary, true)
    expect(chunks[0]).toBe('Great choice to start cooking!')
    expect(chunks.every((c) => c.length <= 140)).toBe(true)
    expect(chunks.join(' ')).toBe(summary)
  })

  it('cuts a long opening sentence down to about 90 characters', () => {
    const long = `${'This opening sentence just keeps going and going without any full stop for quite a while '.repeat(2)}. Then more.`
    expect(speechChunks(long, true)[0].length).toBeLessThanOrEqual(90)
  })

  it('keeps big chunks for the fast backup voice', () => {
    expect(speechChunks(summary, false)).toEqual([summary])
  })
})
