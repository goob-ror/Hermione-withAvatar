'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, Server, Globe2, Volume2, X } from 'lucide-react'

export interface StartupConfig {
  aiProvider: {
    kind: 'ollama' | 'openai' | 'cloudflare'
    label: string
    baseUrl?: string
    apiKey?: string
    model?: string
  }
  ttsProvider: {
    kind: 'local' | 'cloudflare' | 'skip'
    label: string
    apiKey?: string
  }
  agentName: string
}

interface Props {
  open: boolean
  onComplete: (config: StartupConfig) => void
}

type Step = 'welcome' | 'ai-model' | 'tts-model' | 'agent-name' | 'review'

export function StartupConfigModal({ open, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [aiKind, setAiKind] = useState<'ollama' | 'openai' | 'cloudflare'>('ollama')
  const [aiUrl, setAiUrl] = useState('http://127.0.0.1:11434')
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState('hermes')
  const [ttsKind, setTtsKind] = useState<'local' | 'cloudflare' | 'skip'>('cloudflare')
  const [ttsKey, setTtsKey] = useState('')
  const [agentName, setAgentName] = useState('Hermione')
  const [error, setError] = useState('')

  if (!open) return null

  const handleNext = () => {
    setError('')
    if (step === 'welcome') setStep('ai-model')
    else if (step === 'ai-model') {
      if (aiKind === 'openai' && !aiUrl) {
        setError('API endpoint required for OpenAI-compatible models')
        return
      }
      if (aiKind === 'openai' && !aiKey) {
        setError('API key required for OpenAI-compatible models')
        return
      }
      setStep('tts-model')
    } else if (step === 'tts-model') {
      if (ttsKind === 'cloudflare' && !ttsKey) {
        setError('Cloudflare API token required. Get it at https://dash.cloudflare.com/profile/api-tokens')
        return
      }
      setStep('agent-name')
    } else if (step === 'agent-name') {
      if (!agentName.trim()) {
        setError('Agent name is required')
        return
      }
      setStep('review')
    } else if (step === 'review') {
      const config: StartupConfig = {
        aiProvider: {
          kind: aiKind,
          label: aiKind === 'ollama' ? 'Ollama (local)' : aiKind === 'cloudflare' ? 'Cloudflare AI' : 'OpenAI-compatible',
          baseUrl: aiKind === 'ollama' ? aiUrl : aiUrl,
          apiKey: aiKind === 'openai' ? aiKey : undefined,
          model: aiModel,
        },
        ttsProvider: {
          kind: ttsKind,
          label: ttsKind === 'local' ? 'PiperTTS (local)' : ttsKind === 'cloudflare' ? 'Cloudflare Workers AI' : 'None',
          apiKey: ttsKind === 'cloudflare' ? ttsKey : undefined,
        },
        agentName,
      }
      onComplete(config)
    }
  }

  const handleBack = () => {
    if (step === 'ai-model') setStep('welcome')
    else if (step === 'tts-model') setStep('ai-model')
    else if (step === 'agent-name') setStep('tts-model')
    else if (step === 'review') setStep('agent-name')
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center">
      <div className="bg-[#1a1a1c] border border-[#2a2a2c] rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="border-b border-[#2a2a2c] px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-100">Configure Hermione</h1>
          <p className="text-xs text-gray-500 mt-1">
            {step === 'welcome' && 'Welcome! Let\u0027s set up your AI assistant'}
            {step === 'ai-model' && 'Choose your AI model provider'}
            {step === 'tts-model' && 'Choose text-to-speech (optional)'}
            {step === 'agent-name' && 'Name your AI assistant'}
            {step === 'review' && 'Review and confirm'}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 min-h-64">
          {step === 'welcome' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Hermione is your personal AI agent. First, configure where the AI runs and how it speaks.
              </p>
              <div className="bg-[#0a0a0b] border border-[#2a2a2c] rounded p-4">
                <p className="text-xs text-gray-400">
                  <strong>Local mode:</strong> Use Ollama for offline AI. <br />
                  <strong>Cloud mode:</strong> Use OpenAI-compatible APIs or Cloudflare Workers AI.
                </p>
              </div>
            </div>
          )}

          {step === 'ai-model' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-3">AI Provider</label>
                <div className="space-y-2">
                  <button
                    onClick={() => { setAiKind('ollama'); setError('') }}
                    className={`w-full text-left p-3 rounded border transition ${
                      aiKind === 'ollama'
                        ? 'bg-[#1f1f21] border-[#80a9c1]'
                        : 'bg-[#0a0a0b] border-[#2a2a2c] hover:border-[#3a3a3c]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Server size={16} />
                      <div>
                        <div className="text-sm font-medium text-gray-200">Ollama (Local)</div>
                        <div className="text-xs text-gray-500">Runs on your machine</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { setAiKind('openai'); setError('') }}
                    className={`w-full text-left p-3 rounded border transition ${
                      aiKind === 'openai'
                        ? 'bg-[#1f1f21] border-[#80a9c1]'
                        : 'bg-[#0a0a0b] border-[#2a2a2c] hover:border-[#3a3a3c]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Globe2 size={16} />
                      <div>
                        <div className="text-sm font-medium text-gray-200">OpenAI-compatible</div>
                        <div className="text-xs text-gray-500">Any OpenAI API or compatible endpoint</div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {aiKind === 'ollama' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2">Ollama URL</label>
                  <input
                    type="text"
                    value={aiUrl}
                    onChange={(e) => setAiUrl(e.target.value)}
                    placeholder="http://127.0.0.1:11434"
                    className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                  />
                  <label className="block text-xs font-semibold text-gray-300 mb-2 mt-3">Model name</label>
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="hermes"
                    className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                  />
                </div>
              )}

              {aiKind === 'openai' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-2">API Endpoint</label>
                    <input
                      type="text"
                      value={aiUrl}
                      onChange={(e) => setAiUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-2">API Key</label>
                    <input
                      type="password"
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder="sk-…"
                      className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-2">Model</label>
                    <input
                      type="text"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'tts-model' && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-gray-300 mb-3">Text-to-Speech Provider</label>
              <div className="space-y-2">
                <button
                  onClick={() => { setTtsKind('cloudflare'); setError('') }}
                  className={`w-full text-left p-3 rounded border transition ${
                    ttsKind === 'cloudflare'
                      ? 'bg-[#1f1f21] border-[#80a9c1]'
                      : 'bg-[#0a0a0b] border-[#2a2a2c] hover:border-[#3a3a3c]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Volume2 size={16} />
                    <div>
                      <div className="text-sm font-medium text-gray-200">Cloudflare Workers AI (Free)</div>
                      <div className="text-xs text-gray-500">10k requests/day, no credit card</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => { setTtsKind('local'); setError('') }}
                  className={`w-full text-left p-3 rounded border transition ${
                    ttsKind === 'local'
                      ? 'bg-[#1f1f21] border-[#80a9c1]'
                      : 'bg-[#0a0a0b] border-[#2a2a2c] hover:border-[#3a3a3c]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Volume2 size={16} />
                    <div>
                      <div className="text-sm font-medium text-gray-200">PiperTTS (Local)</div>
                      <div className="text-xs text-gray-500">Offline speech synthesis</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => { setTtsKind('skip'); setError('') }}
                  className={`w-full text-left p-3 rounded border transition ${
                    ttsKind === 'skip'
                      ? 'bg-[#1f1f21] border-[#80a9c1]'
                      : 'bg-[#0a0a0b] border-[#2a2a2c] hover:border-[#3a3a3c]'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-200">None (skip TTS)</div>
                </button>
              </div>

              {ttsKind === 'cloudflare' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2">Cloudflare API Token</label>
                  <input
                    type="password"
                    value={ttsKey}
                    onChange={(e) => setTtsKey(e.target.value)}
                    placeholder="Bearer token from Cloudflare dashboard"
                    className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Get from: <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-[#80a9c1] hover:underline">Cloudflare Dashboard</a>
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'agent-name' && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-gray-300 mb-2">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Hermione"
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2c] rounded text-sm text-gray-100 placeholder-gray-600 focus:border-[#80a9c1] outline-none"
              />
              <p className="text-xs text-gray-400">
                This is how the agent will refer to itself.
              </p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3 text-sm">
              <div className="bg-[#0a0a0b] border border-[#2a2a2c] rounded p-3">
                <div className="text-xs font-semibold text-gray-400 mb-2">AI Provider</div>
                <div className="text-gray-200">{aiKind === 'ollama' ? 'Ollama' : 'OpenAI-compatible'}</div>
                {aiKind === 'ollama' && <div className="text-xs text-gray-500">{aiUrl}</div>}
              </div>
              <div className="bg-[#0a0a0b] border border-[#2a2a2c] rounded p-3">
                <div className="text-xs font-semibold text-gray-400 mb-2">TTS Provider</div>
                <div className="text-gray-200">
                  {ttsKind === 'cloudflare' ? 'Cloudflare Workers AI' : ttsKind === 'local' ? 'PiperTTS' : 'Disabled'}
                </div>
              </div>
              <div className="bg-[#0a0a0b] border border-[#2a2a2c] rounded p-3">
                <div className="text-xs font-semibold text-gray-400 mb-2">Agent Name</div>
                <div className="text-gray-200">{agentName}</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#2a2a2c] px-6 py-4 flex justify-between gap-3">
          {step !== 'welcome' && (
            <button
              onClick={handleBack}
              className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 transition"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-[#80a9c1] hover:bg-[#6d98ad] text-black text-sm font-medium rounded transition flex items-center gap-2"
          >
            {step === 'review' ? 'Complete' : 'Next'}
            {step !== 'review' && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
