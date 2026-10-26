'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  FolderOpen,
  Plus,
  Cpu,
  Check,
  AlertCircle,
  HardDrive,
  FileCode,
  Sparkles,
  Loader2,
  RefreshCw,
  Terminal,
} from 'lucide-react'

interface ModelModalProps {
  isOpen: boolean
  onClose: () => void
  currentModel: string
  onSelectModel: (modelName: string) => void
}

interface InstalledModel {
  name: string
  model: string
  size: number
  modified_at: string
  details?: {
    format?: string
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

interface WorkspaceGguf {
  name: string
  path: string
  size: number
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function ModelManagerModal({
  isOpen,
  onClose,
  currentModel,
  onSelectModel,
}: ModelModalProps) {
  const [activeTab, setActiveTab] = useState<'installed' | 'register'>('installed')
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([])
  const [workspaceGgufs, setWorkspaceGgufs] = useState<WorkspaceGguf[]>([])
  const [ollamaOnline, setOllamaOnline] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)
  const [refreshing, setRefreshing] = useState<boolean>(false)

  // Registration form
  const [newModelName, setNewModelName] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [template, setTemplate] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(
    'You are Hermione, an agile, purpose-built AI agent assistant running locally on RTX 4060.'
  )
  const [registering, setRegistering] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  // Hidden native file input fallback for browser environment
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const fetchModels = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setInstalledModels(data.models || [])
        setWorkspaceGgufs(data.workspaceGgufs || [])
        setOllamaOnline(!!data.ollamaOnline)
      }
    } catch (e) {
      console.error('Failed to load models:', e)
      setOllamaOnline(false)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchModels()
      setStatusMessage(null)
    }
  }, [isOpen])

  // Native OpenFileDialog trigger via backend
  const handlePickFileNative = async () => {
    try {
      setStatusMessage(null)
      const res = await fetch('/api/pick-file', { method: 'POST' })
      const data = await res.json()
      if (data && !data.canceled && data.filePath) {
        setSelectedFilePath(data.filePath)
        if (!newModelName) {
          // Auto-suggest a clean model name based on file basename
          const base = data.fileName
            .replace(/\.gguf$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9._:-]/g, '-')
          setNewModelName(base)
        }
      }
    } catch (err: any) {
      console.error('Pick file error:', err)
      // fallback to browser input
      fileInputRef.current?.click()
    }
  }

  // Handle workspace GGUF quick-pick
  const handleSelectWorkspaceGguf = (item: WorkspaceGguf) => {
    setSelectedFilePath(item.path)
    const base = item.name
      .replace(/\.gguf$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, '-')
    setNewModelName(base)
    setActiveTab('register')
  }

  // Register the model into Ollama
  const handleRegisterModel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newModelName || !selectedFilePath) {
      setStatusMessage({
        type: 'error',
        text: 'Please provide both a model name and a valid GGUF file path.',
      })
      return
    }

    setRegistering(true)
    setStatusMessage(null)

    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelName: newModelName,
          filePath: selectedFilePath,
          template: template.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Failed to register model')
      }

      setStatusMessage({
        type: 'success',
        text: `Model "${data.modelName}" successfully created and added to Ollama!`,
      })

      // Refresh installed models list & auto-select
      await fetchModels()
      onSelectModel(data.modelName)
      setActiveTab('installed')
      setNewModelName('')
      setSelectedFilePath('')
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error occurred during model registration',
      })
    } finally {
      setRegistering(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#121214] border border-[#27252a] rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-[#e9e7e4]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#202023] bg-[#0e0e10]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#b69a72]/20 border border-[#b69a72]/40 flex items-center justify-center text-[#d2b278]">
              <Cpu className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
                Ollama Model Manager
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono ${
                    ollamaOnline
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                      ollamaOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                    }`}
                  />
                  {ollamaOnline ? 'Ollama Online (:11434)' : 'Ollama Offline'}
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Switch active models or load any external GGUF file into your local engine.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex items-center px-6 border-b border-[#202023] bg-[#111113] gap-6 text-xs">
          <button
            onClick={() => setActiveTab('installed')}
            className={`py-3 font-medium transition-all relative ${
              activeTab === 'installed'
                ? 'text-white border-b-2 border-[#c5a871]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Active & Available Models ({installedModels.length})
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`py-3 font-medium transition-all relative flex items-center gap-1.5 ${
              activeTab === 'register'
                ? 'text-white border-b-2 border-[#c5a871]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Plus className="size-3.5" /> Assign New GGUF Model
          </button>
          <div className="ml-auto">
            <button
              onClick={fetchModels}
              disabled={refreshing}
              className="text-zinc-400 hover:text-white flex items-center gap-1.5 text-[11px] py-1 px-2 rounded hover:bg-zinc-800/40"
            >
              <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {statusMessage && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <Check className="size-4 shrink-0" />
              ) : (
                <AlertCircle className="size-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'installed' && (
            <div className="space-y-4">
              {/* Workspace GGUFs detected */}
              {workspaceGgufs.length > 0 && (
                <div className="bg-[#171619] border border-[#2a282d] rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                    <span className="flex items-center gap-1.5 text-[#d2b278]">
                      <Sparkles className="size-3.5" /> Workspace Models Detected ({workspaceGgufs.length})
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">codespace root</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    These GGUF model files exist directly in your project root and can be assigned to Ollama with 1 click:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {workspaceGgufs.map((gguf) => {
                      const isInstalled = installedModels.some(
                        (m) =>
                          m.name.includes(gguf.name.replace(/\.gguf$/i, '').toLowerCase()) ||
                          (gguf.name.includes('Lily') && m.name.includes('lily')) ||
                          (gguf.name.includes('Qwen') && m.name.includes('qwen'))
                      )
                      return (
                        <div
                          key={gguf.name}
                          className="bg-[#111112] border border-[#262428] rounded-md p-2.5 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-mono text-[11px] font-medium text-zinc-200 truncate">
                              {gguf.name}
                            </p>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {formatBytes(gguf.size)}
                            </span>
                          </div>
                          <button
                            onClick={() => handleSelectWorkspaceGguf(gguf)}
                            className="shrink-0 px-2.5 py-1 text-[10px] font-medium rounded bg-[#201e23] hover:bg-[#2b2830] text-[#dedbd7] border border-[#35323a] transition-colors"
                          >
                            {isInstalled ? 'Re-configure' : 'Assign to Ollama'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Installed Ollama Models List */}
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500 font-mono">
                  Registered Ollama Models
                </span>
                {installedModels.length === 0 ? (
                  <div className="text-center py-10 bg-[#161518]/50 border border-dashed border-[#2b282c] rounded-lg">
                    <HardDrive className="size-8 mx-auto text-zinc-600 mb-2" />
                    <p className="text-xs text-zinc-400">No models found in Ollama yet.</p>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Click the "Assign New GGUF Model" tab to register one from your codespace or any local directory.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {installedModels.map((m) => {
                      const isSelected =
                        currentModel === m.name ||
                        currentModel.startsWith(m.name.split(':')[0]) ||
                        m.name.startsWith(currentModel.split(':')[0])

                      return (
                        <div
                          key={m.name}
                          onClick={() => onSelectModel(m.name)}
                          className={`group cursor-pointer p-3.5 rounded-lg border transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-[#1e1c18] border-[#8a724b] shadow-[0_0_15px_rgba(197,168,113,0.1)]'
                              : 'bg-[#151416] border-[#252427] hover:border-[#38363c]'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-white">
                                {m.name}
                              </span>
                              {isSelected && (
                                <span className="bg-[#c5a871]/20 text-[#d2b278] border border-[#c5a871]/40 text-[9px] font-mono px-1.5 py-0.5 rounded">
                                  CURRENT ACTIVE
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-zinc-400 font-mono">
                              <span>Size: {formatBytes(m.size)}</span>
                              {m.details?.parameter_size && (
                                <span>Param: {m.details.parameter_size}</span>
                              )}
                              {m.details?.quantization_level && (
                                <span>Quant: {m.details.quantization_level}</span>
                              )}
                              {m.details?.family && (
                                <span>Family: {m.details.family}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isSelected ? (
                              <div className="w-6 h-6 rounded-full bg-[#c5a871] text-black flex items-center justify-center">
                                <Check className="size-3.5 stroke-[3]" />
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSelectModel(m.name)
                                }}
                                className="opacity-0 group-hover:opacity-100 px-2.5 py-1 text-xs rounded bg-[#201f22] hover:bg-[#2c292f] text-zinc-300 border border-[#353338] transition-all"
                              >
                                Select
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'register' && (
            <form onSubmit={handleRegisterModel} className="space-y-4">
              <div className="bg-[#161518] p-3 rounded-lg border border-[#27252a] text-xs text-zinc-400">
                <p>
                  You can point to <strong>any GGUF model</strong> on your machine (in the workspace, Downloads, another drive, etc.).
                  Hermione will generate the Modelfile and run <code>ollama create</code> automatically.
                </p>
              </div>

              {/* Model Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span>Assigned Model Name</span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    e.g. qwen3.5-9b, lily-cybersecurity, custom-agent
                  </span>
                </label>
                <input
                  type="text"
                  required
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="e.g. qwen3.5-9b"
                  className="w-full bg-[#151416] border border-[#2a292d] focus:border-[#c5a871] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none font-mono"
                />
              </div>

              {/* File Path + Select File Dialog */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span>Model File Location (.gguf)</span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Codespace root or any external folder
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={selectedFilePath}
                    onChange={(e) => setSelectedFilePath(e.target.value)}
                    placeholder="Full path or workspace relative path to .gguf"
                    className="flex-1 bg-[#151416] border border-[#2a292d] focus:border-[#c5a871] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={handlePickFileNative}
                    className="px-3 py-2 bg-[#211f24] hover:bg-[#2c2930] text-[#dedbd7] border border-[#37343c] rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    <FolderOpen className="size-3.5 text-[#d2b278]" />
                    Select File…
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".gguf,.bin"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0]
                        // Browser gives name; suggest relative or absolute
                        setSelectedFilePath(file.name)
                        if (!newModelName) {
                          setNewModelName(
                            file.name
                              .replace(/\.gguf$/i, '')
                              .toLowerCase()
                              .replace(/[^a-z0-9._:-]/g, '-')
                          )
                        }
                      }
                    }}
                  />
                </div>
              </div>

              {/* Optional System Prompt */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span>System Prompt (Optional)</span>
                  <span className="text-[10px] font-mono text-zinc-500">Agent Persona / Guardrails</span>
                </label>
                <textarea
                  rows={2}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="System instructions for the model..."
                  className="w-full bg-[#151416] border border-[#2a292d] focus:border-[#c5a871] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none font-sans resize-none"
                />
              </div>

              {/* Submit */}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('installed')}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-[#c5a871] hover:bg-[#d4b77f] text-black font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {registering ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Creating Ollama Model…
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5" />
                      Create &amp; Assign Model
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#202023] bg-[#0c0c0e] flex items-center justify-between text-[11px] text-zinc-500 font-mono">
          <span>Ollama Runtime: 127.0.0.1:11434</span>
          <span>GPU Reference: NVIDIA RTX 4060 8GB VRAM</span>
        </div>
      </div>
    </div>
  )
}
