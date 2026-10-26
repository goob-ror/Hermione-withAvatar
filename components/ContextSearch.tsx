/**
 * ContextSearch Component - Unified search across all tools
 */

'use client'

import { useState, useEffect } from 'react'
import { Search, Mail, Calendar, CheckSquare, FileText, Code } from 'lucide-react'

interface SearchResult {
  source: 'gmail' | 'calendar' | 'tasks' | 'drive' | 'github' | 'snippets' | 'files'
  type: string
  title: string
  snippet: string
  url?: string
  date?: string
  relevance: number
  metadata?: Record<string, any>
}

interface ContextSearchProps {
  open: boolean
  onClose: () => void
}

export default function ContextSearch({ open, onClose }: ContextSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSources, setSelectedSources] = useState<string[]>([
    'gmail', 'calendar', 'tasks', 'drive', 'snippets'
  ])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
    }
  }, [open])

  const handleSearch = async () => {
    if (!query.trim()) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        action: 'search',
        q: query,
        sources: selectedSources.join(','),
        maxResults: '20',
      })

      const res = await fetch(`/api/context/search?${params}`)
      const data = await res.json()

      if (data.results) {
        setResults(data.results)
      }
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setLoading(false)
    }
  }

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'gmail': return <Mail className="w-4 h-4" />
      case 'calendar': return <Calendar className="w-4 h-4" />
      case 'tasks': return <CheckSquare className="w-4 h-4" />
      case 'drive': return <FileText className="w-4 h-4" />
      case 'snippets': return <Code className="w-4 h-4" />
      case 'github': return <Code className="w-4 h-4" />
      default: return <FileText className="w-4 h-4" />
    }
  }

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'gmail': return 'text-red-400'
      case 'calendar': return 'text-blue-400'
      case 'tasks': return 'text-green-400'
      case 'drive': return 'text-yellow-400'
      case 'snippets': return 'text-purple-400'
      case 'github': return 'text-gray-400'
      default: return 'text-gray-400'
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20 z-50">
      <div className="bg-[#1a1a1a] rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search across all tools..."
              className="flex-1 bg-transparent text-white outline-none"
              autoFocus
            />
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Source filters */}
          <div className="flex gap-2 flex-wrap">
            {['gmail', 'calendar', 'tasks', 'drive', 'snippets'].map(source => (
              <button
                key={source}
                onClick={() => {
                  if (selectedSources.includes(source)) {
                    setSelectedSources(selectedSources.filter(s => s !== source))
                  } else {
                    setSelectedSources([...selectedSources, source])
                  }
                }}
                className={`px-3 py-1 rounded text-xs ${
                  selectedSources.includes(source)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300'
                }`}
              >
                {source}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="text-center text-gray-400 py-8">
              Searching...
            </div>
          )}

          {!loading && results.length === 0 && query && (
            <div className="text-center text-gray-400 py-8">
              No results found
            </div>
          )}

          {!loading && results.length === 0 && !query && (
            <div className="text-center text-gray-400 py-8">
              Type to search across Gmail, Calendar, Tasks, Drive, and more
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-3">
              {results.map((result, i) => (
                <div
                  key={i}
                  className="bg-gray-800 rounded p-3 hover:bg-gray-750 cursor-pointer"
                  onClick={() => {
                    if (result.url) {
                      window.open(result.url, '_blank')
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 ${getSourceColor(result.source)}`}>
                      {getSourceIcon(result.source)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-white truncate">
                          {result.title}
                        </h3>
                        <span className="text-xs text-gray-500 uppercase">
                          {result.source}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2">
                        {result.snippet}
                      </p>
                      {result.date && (
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(result.date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
          Press Enter to search • ESC to close
        </div>
      </div>
    </div>
  )
}
