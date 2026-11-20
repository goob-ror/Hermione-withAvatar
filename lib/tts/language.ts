/**
 * Which voice language a text needs. Hermione speaks English by default;
 * Indonesian is used only for Content Forge voiceovers whose script really
 * is Indonesian — checked from the words themselves, not taken on trust.
 */

export type VoiceLang = 'en' | 'id'

/** Common Indonesian words — function words, casual speech and everyday content vocabulary. */
const ID_WORDS = new Set(
  (
    'yang dan di ke dari ini itu untuk dengan tidak akan sudah bisa ada juga karena kalau kamu aku saya kita kami mereka ' +
    'dia jangan sampai hanya atau tapi tetapi agar supaya lagi masih belum harus sangat lebih paling semua setiap banyak ' +
    'sedikit apa siapa bagaimana kenapa mengapa dimana kapan sini sana begitu seperti sebelum sesudah setelah saat ketika ' +
    'pada dalam oleh tentang bagi para nya pun lah kah dong sih ya yuk ayo nih tuh gimana gak nggak enggak udah aja ' +
    'cara daftar buat bikin lihat cek simak mau perlu coba langsung punya kasih biar terus nanti sekarang hari bulan ' +
    'tahun minggu ribu juta pertama kedua ketiga terakhir hemat uang murah mahal gratis beli jual bayar makan minum ' +
    'kerja sekolah kuliah mahasiswa teman orang anak rumah baru besar kecil sendiri malu mana rahasia caranya ' +
    'tips trik wajib banget bener benar salah semua tanpa lalu kemudian juga sama beda'
  ).split(/\s+/),
)

/** Common English words that rarely appear in Indonesian text. */
const EN_WORDS = new Set(
  (
    'the a an and or but is are was were be been being to of in on at for with from by as it its this that these those ' +
    'you your we our they their he she his her i me my not no yes do does did have has had will would can could should ' +
    'what how why when where which who if then than so just also more most very about into out up down here there now'
  ).split(/\s+/),
)

/** Indonesian word endings: -nya, -kan, -lah, -kah and casual -in (manfaatin, tunjukin). */
const ID_SUFFIX = /^[a-z]{3,}(nya|kan|lah|kah|in)$/

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** How much of a text looks Indonesian vs English: counts of words with evidence for each. */
export function languageEvidence(text: string): { words: number; id: number; en: number } {
  const words = wordsOf(text)
  let id = 0
  let en = 0
  for (const w of words) {
    if (EN_WORDS.has(w)) en++
    else if (ID_WORDS.has(w) || ID_SUFFIX.test(w)) id++
  }
  return { words: words.length, id, en }
}

/** Share of words (0–1) that look Indonesian. */
export function indonesianScore(text: string): number {
  const e = languageEvidence(text)
  return e.words ? e.id / e.words : 0
}

/**
 * True when the text is clearly Indonesian: at least 3 words, at least two
 * (and 15%) of them Indonesian, and more Indonesian evidence than English.
 */
export function isIndonesian(text: string): boolean {
  const e = languageEvidence(text)
  return e.words >= 3 && e.id >= Math.max(2, Math.ceil(e.words * 0.15)) && e.id > e.en
}

/**
 * The voice language for speech:
 *   - live speech (chat answers, summaries, Read aloud): always English;
 *   - clip voiceovers: Indonesian only in Content Forge and only when the
 *     script is actually Indonesian; English otherwise.
 */
export function voiceLangFor(opts: { purpose: 'live' | 'clip'; mode?: 'chat' | 'forge'; text: string }): VoiceLang {
  if (opts.purpose !== 'clip' || opts.mode !== 'forge') return 'en'
  return isIndonesian(opts.text) ? 'id' : 'en'
}
