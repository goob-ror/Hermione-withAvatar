/**
 * IntegrationsPanel Component - Configure all integrations
 */

'use client'

import { useState, useEffect } from 'react'
import { Settings, Mail, Calendar, MessageSquare, Code, Cloud, Check, X } from 'lucide-react'

interface Integration {
  name: string
  type: 'google' | 'telegram' | 'github' | 'deployment'
  configured: boolean
  icon: React.ReactNode
}

interface IntegrationsPanelProps {
  open: boolean
  onClose: () => void
}

export default function IntegrationsPanel({ open, onClose }: IntegrationsPanelProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [activeConfig, setActiveConfig] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Google config
  const [googleAccounts, setGoogleAccounts] = useState<any[]>([])
  
  // Telegram config
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramConfigured, setTelegramConfigured] = useState(false)

  // GitHub config
  const [githubToken, setGithubToken] = useState('')
  const [githubOwner, setGithubOwner] = useState('')
  const [githubConfigured, setGithubConfigured] = useState(false)

  useEffect(() => {
    if (open) {
      loadIntegrations()
    }
  }, [open])

  const loadIntegrations = async () => {
    try {
      const [googleRes, telegramRes, githubRes] = await Promise.all([
        fetch('/api/google/accounts?action=list'),
        fetch('/api/telegram/config'),
        fetch('/api/github/config'),
      ])

      const googleData = await googleRes.json()
      const telegramData = await telegramRes.json()
      const githubData = await githubRes.json()

      setGoogleAccounts(googleData.accounts || [])
      setTelegramConfigured(telegramData.configured || false)
      setGithubConfigured(githubData.configured || false)

      setIntegrations([
        {
          name: 'Google',
          type: 'google',
          configured: (googleData.accounts?.length || 0) > 0,
          icon: <Mail className="w-5 h-5" />,
        },
        {
          name: 'Telegram',
          type: 'telegram',
          configured: telegramData.configured || false,
          icon: <MessageSquare className="w-5 h-5" />,
        },
        {
          name: 'GitHub',
          type: 'github',
          configured: githubData.configured || false,
          icon: <Code className="w-5 h-5" />,
        },
      ])
    } catch (err) {
      console.error('Failed to load integrations:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleAuth = () => {
    fetch('/api/google/accounts?action=auth-url')
      .then(res => res.json())
      .then(data => {
        if (data.authUrl) {
          window.open(data.authUrl, '_blank')
        }
      })
  }

  const handleTelegramSave = async () => {
    try {
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: telegramBotToken }),
      })

      const data = await res.json()
      if (data.success) {
        setTelegramConfigured(true)
        setActiveConfig(null)
        loadIntegrations()
      }
    } catch (err) {
      console.error('Failed to save Telegram config:', err)
    }
  }

  const handleGitHubSave = async () => {
    try {
      const res = await fetch('/api/github/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubToken, owner: githubOwner }),
      })

      const data = await res.json()
      if (data.success) {
        setGithubConfigured(true)
        setActiveConfig(null)
        setGithubToken('')
        loadIntegrations()
      }
    } catch (err) {
      console.error('Failed to save GitHub config:', err)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Integrations</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : activeConfig ? (
            // Configuration Forms
            <div>
              <button
                onClick={() => setActiveConfig(null)}
                className="text-sm text-blue-400 hover:text-blue-300 mb-4"
              >
                ← Back to integrations
              </button>

              {activeConfig === 'google' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Google Accounts</h3>
                  
                  {googleAccounts.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {googleAccounts.map(account => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between p-3 bg-gray-800 rounded"
                        >
                          <div>
                            <p className="text-white text-sm">{account.email}</p>
                            <p className="text-xs text-gray-400">{account.displayName}</p>
                          </div>
                          {account.id === googleAccounts[0]?.id && (
                            <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded">
                              Active
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleGoogleAuth}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Add Google Account
                  </button>
                  <p className="text-xs text-gray-400">
                    Opens Google OAuth in a new window. Grant access and return here.
                  </p>
                </div>
              )}

              {activeConfig === 'telegram' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Telegram Bot</h3>
                  
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      Bot Token
                    </label>
                    <input
                      type="password"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Get your bot token from @BotFather on Telegram
                    </p>
                  </div>

                  <button
                    onClick={handleTelegramSave}
                    disabled={!telegramBotToken}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Configuration
                  </button>
                </div>
              )}

              {activeConfig === 'github' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">GitHub</h3>
                  
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      Personal Access Token
                    </label>
                    <input
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Generate at github.com/settings/tokens
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      GitHub Username
                    </label>
                    <input
                      type="text"
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value)}
                      placeholder="username"
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 outline-none"
                    />
                  </div>

                  <button
                    onClick={handleGitHubSave}
                    disabled={!githubToken || !githubOwner}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Configuration
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Integration List
            <div className="space-y-3">
              {integrations.map(integration => (
                <div
                  key={integration.name}
                  className="flex items-center justify-between p-4 bg-gray-800 rounded hover:bg-gray-750 cursor-pointer"
                  onClick={() => setActiveConfig(integration.type)}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-gray-400">
                      {integration.icon}
                    </div>
                    <div>
                      <h3 className="text-white font-medium">{integration.name}</h3>
                      <p className="text-xs text-gray-400">
                        {integration.configured ? 'Configured' : 'Not configured'}
                      </p>
                    </div>
                  </div>
                  {integration.configured ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <X className="w-5 h-5 text-gray-500" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
