'use client'

import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'

interface TokenCounterProps {
  visible: boolean
  messageCount: number
  estimatedTokens: number
  rtkCompressionStats?: {
    toolOutputsCompressed: number
    tokensSavedByRTK: number
  }
}

export function TokenCounter({
  visible,
  messageCount,
  estimatedTokens,
  rtkCompressionStats,
}: TokenCounterProps) {
  const [displayTokens, setDisplayTokens] = useState(estimatedTokens)

  useEffect(() => {
    setDisplayTokens(estimatedTokens)
  }, [estimatedTokens])

  if (!visible) return null

  // Estimate: ~4 tokens per word, ~5 chars per word
  const contextWindow = 8000 // Typical limit
  const usagePercent = (displayTokens / contextWindow) * 100
  const statusColor =
    usagePercent < 50
      ? 'text-green-400'
      : usagePercent < 80
        ? 'text-yellow-400'
        : 'text-red-400'

  return (
    <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 px-3 py-2 bg-[#0a0a0b] rounded border border-[#2a2a2c]">
      <Zap size={14} className={statusColor} />
      <span>
        {displayTokens.toLocaleString()} tokens ({usagePercent.toFixed(0)}%)
      </span>
      {messageCount > 0 && <span>• {messageCount} msg</span>}
      {rtkCompressionStats && rtkCompressionStats.tokensSavedByRTK > 0 && (
        <span className="text-green-400">
          • RTK saved {rtkCompressionStats.tokensSavedByRTK.toLocaleString()}
        </span>
      )}
    </div>
  )
}

/**
 * Rough token estimation (for display only)
 * Uses 4 tokens per word average
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // Split by whitespace, rough estimate
  const words = text.trim().split(/\s+/).length
  return Math.ceil(words * 1.3) // ~1.3 tokens per word (conservative)
}
