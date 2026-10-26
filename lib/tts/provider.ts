/**
 * TTS provider abstraction: supports local PiperTTS and Cloudflare Workers AI.
 */

export type TTSProviderKind = 'local' | 'cloudflare' | 'skip'

export interface TTSProvider {
  kind: TTSProviderKind
  synthesize(text: string): Promise<ArrayBuffer>
}

class LocalTTSProvider implements TTSProvider {
  kind: TTSProviderKind = 'local'

  async synthesize(text: string): Promise<ArrayBuffer> {
    // Call local /api/tts endpoint
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    
    if (!res.ok) throw new Error(`TTS failed: ${res.statusText}`)
    return res.arrayBuffer()
  }
}

class CloudflareTTSProvider implements TTSProvider {
  kind: TTSProviderKind = 'cloudflare'
  private apiToken: string
  private accountId: string

  constructor(apiToken: string, accountId: string = '') {
    this.apiToken = apiToken
    this.accountId = accountId
  }

  async synthesize(text: string): Promise<ArrayBuffer> {
    // Cloudflare Workers AI TTS endpoint
    // Format: POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/deepgram/aura-2-en
    
    if (!this.accountId) {
      // Fall back to local if no account ID configured
      return new LocalTTSProvider().synthesize(text)
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/deepgram/aura-2-en`
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice: 'asteria', // Cloudflare Aura 2 voice
      }),
    })

    if (!res.ok) {
      throw new Error(`Cloudflare TTS failed: ${res.status} ${res.statusText}`)
    }

    return res.arrayBuffer()
  }
}

class SkipTTSProvider implements TTSProvider {
  kind: TTSProviderKind = 'skip'

  async synthesize(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }
}

export function createTTSProvider(kind: TTSProviderKind, apiToken?: string, accountId?: string): TTSProvider {
  switch (kind) {
    case 'cloudflare':
      return new CloudflareTTSProvider(apiToken || '', accountId)
    case 'local':
      return new LocalTTSProvider()
    case 'skip':
      return new SkipTTSProvider()
  }
}
