'use client'

import { useState } from 'react'
import { X, Settings } from 'lucide-react'

export interface Phase1Settings {
  rtkEnabled: boolean
  rtkLevel: 'low' | 'medium' | 'high'
  lazyDevMode: 'auto' | 'always' | 'never'
  showTokenCounter: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  settings: Phase1Settings
  onSettingsChange: (settings: Phase1Settings) => void
}

export function Phase1SettingsPanel({ open, onClose, settings, onSettingsChange }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[99] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1c] border border-[#2a2a2c] rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="border-b border-[#2a2a2c] px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Settings size={18} />
            Token Efficiency & Code Mode
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6 max-h-96 overflow-y-auto">
          {/* RTK Settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-200">RTK (Reduced Token Kit)</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.rtkEnabled}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, rtkEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#2a2a2c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#80a9c1]"></div>
              </label>
            </div>
            <p className="text-xs text-gray-400">
              Compress tool outputs (git, grep, logs) to reduce input tokens by 60-90%
            </p>

            {settings.rtkEnabled && (
              <div className="pl-4 border-l border-[#2a2a2c] space-y-2">
                <p className="text-xs font-semibold text-gray-300">Compression Level</p>
                <div className="space-y-2">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => onSettingsChange({ ...settings, rtkLevel: level })}
                      className={`w-full text-left px-3 py-2 rounded text-xs transition ${
                        settings.rtkLevel === level
                          ? 'bg-[#80a9c1] text-black font-medium'
                          : 'bg-[#0a0a0b] text-gray-300 hover:bg-[#151416]'
                      }`}
                    >
                      {level === 'low' && '🟢 Low (keep more detail)'}
                      {level === 'medium' && '🟡 Medium (balanced)'}
                      {level === 'high' && '🔴 High (aggressive compression)'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Lazy Senior Dev Mode */}
          <div className="border-t border-[#2a2a2c] pt-4 space-y-3">
            <p className="text-sm font-semibold text-gray-200">Lazy Senior Dev Mode</p>
            <p className="text-xs text-gray-400">
              When working on code: YAGNI, stdlib-first, deletion over addition
            </p>

            <div className="space-y-2">
              {(['auto', 'always', 'never'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSettingsChange({ ...settings, lazyDevMode: mode })}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition ${
                    settings.lazyDevMode === mode
                      ? 'bg-[#80a9c1] text-black font-medium'
                      : 'bg-[#0a0a0b] text-gray-300 hover:bg-[#151416]'
                  }`}
                >
                  {mode === 'auto' && '🔄 Auto (ask on first code task)'}
                  {mode === 'always' && '🧑‍💻 Always (enabled for all sessions)'}
                  {mode === 'never' && '❌ Never (disabled)'}
                </button>
              ))}
            </div>
          </div>

          {/* Token Counter */}
          <div className="border-t border-[#2a2a2c] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-200">Show Token Counter</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showTokenCounter}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, showTokenCounter: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#2a2a2c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#80a9c1]"></div>
              </label>
            </div>
            <p className="text-xs text-gray-400">
              Display token usage in composer area
            </p>
          </div>

          {/* Info */}
          <div className="border-t border-[#2a2a2c] pt-4 bg-[#0a0a0b] rounded p-3">
            <p className="text-xs text-gray-400">
              <strong>RTK Example:</strong> <code>git log</code> goes from 5KB to ~500B (90% reduction)
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#2a2a2c] px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-[#80a9c1] hover:bg-[#6d98ad] text-black text-sm font-medium rounded transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
