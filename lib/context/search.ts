/**
 * Smart Context Engine - Unified search across all tools
 * 
 * Searches:
 * - Gmail messages
 * - Calendar events
 * - Tasks
 * - Google Drive files
 * - GitHub issues/PRs
 * - Telegram messages (if stored locally)
 * - Code snippets
 * - Local files
 * 
 * Returns ranked results with relevance scoring
 */

import type { OAuth2Client } from 'google-auth-library'
import type { GoogleAccount } from '../google/auth'
import { getAuthenticatedClient, getActiveAccount } from '../google/auth'
import { searchMessages as searchGmail } from '../google/gmail'
import { searchEvents as searchCalendar } from '../google/calendar'
import { listTasks } from '../google/tasks'
import { searchFiles as searchDrive } from '../google/drive'
import { searchSnippets } from '../github/client'
import fs from 'fs'
import path from 'path'

export interface SearchResult {
  source: 'gmail' | 'calendar' | 'tasks' | 'drive' | 'github' | 'snippets' | 'files'
  type: string
  title: string
  snippet: string
  url?: string
  date?: string
  relevance: number
  metadata?: Record<string, any>
}

export interface ContextItem {
  id: string
  type: 'email' | 'event' | 'task' | 'file' | 'issue' | 'snippet'
  title: string
  content: string
  date: string
  relatedTo?: string[] // IDs of related items
}

/**
 * Search across all integrated tools
 */
export async function unifiedSearch(
  query: string,
  options?: {
    sources?: Array<'gmail' | 'calendar' | 'tasks' | 'drive' | 'github' | 'snippets' | 'files'>
    maxResults?: number
    dateRange?: { start: string; end: string }
  }
): Promise<SearchResult[]> {
  const sources = options?.sources || ['gmail', 'calendar', 'tasks', 'drive', 'snippets']
  const maxPerSource = Math.ceil((options?.maxResults || 20) / sources.length)
  
  const results: SearchResult[] = []

  // Search Gmail
  if (sources.includes('gmail')) {
    try {
      const account = getActiveAccount()
      if (account) {
        const client = getAuthenticatedClient()
        const messages = await searchGmail(client, account, query, maxPerSource)
        
        results.push(...messages.map(msg => ({
          source: 'gmail' as const,
          type: 'email',
          title: msg.subject,
          snippet: msg.snippet,
          url: undefined,
          date: msg.date,
          relevance: calculateRelevance(query, msg.subject + ' ' + msg.snippet),
          metadata: { from: msg.from, to: msg.to, id: msg.id },
        })))
      }
    } catch (err) {
      console.error('Gmail search error:', err)
    }
  }

  // Search Calendar
  if (sources.includes('calendar')) {
    try {
      const account = getActiveAccount()
      if (account) {
        const client = getAuthenticatedClient()
        const events = await searchCalendar(client, account, query, maxPerSource)
        
        results.push(...events.map(event => ({
          source: 'calendar' as const,
          type: 'event',
          title: event.summary,
          snippet: event.description || event.location || '',
          url: event.htmlLink,
          date: event.start,
          relevance: calculateRelevance(query, event.summary + ' ' + (event.description || '')),
          metadata: { start: event.start, end: event.end, location: event.location },
        })))
      }
    } catch (err) {
      console.error('Calendar search error:', err)
    }
  }

  // Search Tasks
  if (sources.includes('tasks')) {
    try {
      const account = getActiveAccount()
      if (account) {
        const client = getAuthenticatedClient()
        const tasks = await listTasks(client, account, { maxResults: maxPerSource })
        
        const filtered = tasks.filter(task => 
          task.title.toLowerCase().includes(query.toLowerCase()) ||
          (task.notes && task.notes.toLowerCase().includes(query.toLowerCase()))
        )
        
        results.push(...filtered.map(task => ({
          source: 'tasks' as const,
          type: 'task',
          title: task.title,
          snippet: task.notes || '',
          date: task.due || '',
          relevance: calculateRelevance(query, task.title + ' ' + (task.notes || '')),
          metadata: { status: task.status, due: task.due },
        })))
      }
    } catch (err) {
      console.error('Tasks search error:', err)
    }
  }

  // Search Drive
  if (sources.includes('drive')) {
    try {
      const account = getActiveAccount()
      if (account) {
        const client = getAuthenticatedClient()
        const files = await searchDrive(client, account, {
          query,
          contentQuery: query,
          maxResults: maxPerSource,
        })
        
        results.push(...files.map(file => ({
          source: 'drive' as const,
          type: 'file',
          title: file.name,
          snippet: `${file.mimeType} • ${formatBytes(file.size)}`,
          url: file.webViewLink,
          date: file.modifiedTime,
          relevance: calculateRelevance(query, file.name),
          metadata: { mimeType: file.mimeType, size: file.size },
        })))
      }
    } catch (err) {
      console.error('Drive search error:', err)
    }
  }

  // Search Snippets
  if (sources.includes('snippets')) {
    try {
      const snippets = searchSnippets(query)
      
      results.push(...snippets.slice(0, maxPerSource).map(snippet => ({
        source: 'snippets' as const,
        type: 'snippet',
        title: snippet.title,
        snippet: snippet.code.slice(0, 100) + '...',
        date: new Date(snippet.createdAt).toISOString(),
        relevance: calculateRelevance(query, snippet.title + ' ' + snippet.code + ' ' + snippet.tags.join(' ')),
        metadata: { language: snippet.language, tags: snippet.tags, id: snippet.id },
      })))
    } catch (err) {
      console.error('Snippets search error:', err)
    }
  }

  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance)

  return results.slice(0, options?.maxResults || 20)
}

/**
 * Calculate relevance score (0-1)
 */
function calculateRelevance(query: string, text: string): number {
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  
  // Exact match in title = highest score
  if (textLower.includes(queryLower)) {
    return 1.0
  }
  
  // Word matching
  const queryWords = queryLower.split(/\s+/)
  const textWords = textLower.split(/\s+/)
  const matches = queryWords.filter(qw => textWords.some(tw => tw.includes(qw)))
  
  return matches.length / queryWords.length
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/**
 * Load related context for a specific item
 * E.g., when opening a task, find related emails, calendar events, files
 */
export async function loadRelatedContext(
  itemId: string,
  itemType: 'email' | 'event' | 'task' | 'file'
): Promise<ContextItem[]> {
  // Extract keywords from the item
  // Search for related items across all sources
  // Return ranked results
  
  // Placeholder implementation
  return []
}

/**
 * Auto-suggest context based on current conversation
 */
export async function suggestContext(
  conversationText: string
): Promise<SearchResult[]> {
  // Extract entities: dates, names, topics
  // Search for relevant items
  // Return proactive suggestions
  
  const keywords = extractKeywords(conversationText)
  
  if (keywords.length === 0) {
    return []
  }
  
  return unifiedSearch(keywords.join(' '), { maxResults: 5 })
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction (can be improved with NLP)
  const words = text.toLowerCase().split(/\s+/)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'])
  
  return words
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5)
}
