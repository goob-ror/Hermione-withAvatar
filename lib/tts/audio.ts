/** Small audio/text helpers shared by Hermione's speech and the clip renderer. */

import { outsideTags } from './expression'

/** A 44-byte WAV header + the PCM samples. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * Text that reads well aloud: no Markdown symbols, URLs or emoji, one line.
 * Expression tags (<chuckle>, <sigh> …) pass through intact (speech.ts turns them into a style).
 */
export function cleanForSpeech(text: string): string {
  return outsideTags(text, (part) =>
    part
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
      .replace(/[*_`#>|~[\]]/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}
