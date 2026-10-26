/**
 * RTK (Reduced Token Kit) — Compress tool outputs to reduce input tokens by 60-90%.
 * 
 * Targets: git, grep, ls, tree, logs, large text output.
 * Compression strategies:
 * - Remove timestamps, permissions, metadata
 * - Collapse repetition (e.g., 50 identical errors → "error appears 50x")
 * - Summarize large outputs (line count, pattern detection)
 * - Extract signal (filenames, hashes, key lines)
 */

export interface CompressionStats {
  originalBytes: number
  compressedBytes: number
  reductionPercent: number
}

export function compressTerminalOutput(raw: string, tool?: string): { text: string; stats: CompressionStats } {
  const originalBytes = Buffer.byteLength(raw, 'utf-8')
  
  // Detect command type from context
  const isGitLog = raw.includes('commit ') && raw.includes('Author:')
  const isGrep = raw.match(/^\d+[-:]/) // line numbers
  const isLs = raw.match(/^(total|d?-|l?)/)
  const isTree = raw.match(/^\./) || raw.includes('├──')
  const isLogs = raw.match(/\[\d{2}:\d{2}:\d{2}\]|ERROR|WARN|INFO|DEBUG/)

  let compressed = raw

  if (isGitLog) {
    compressed = compressGitLog(raw)
  } else if (isGrep) {
    compressed = compressGrep(raw)
  } else if (isLs) {
    compressed = compressLs(raw)
  } else if (isTree) {
    compressed = compressTree(raw)
  } else if (isLogs) {
    compressed = compressLogs(raw)
  } else {
    // Generic: collapse long lines, remove empty space
    compressed = compressGeneric(raw)
  }

  const compressedBytes = Buffer.byteLength(compressed, 'utf-8')
  const reductionPercent = Math.round(((originalBytes - compressedBytes) / originalBytes) * 100)

  return {
    text: compressed,
    stats: { originalBytes, compressedBytes, reductionPercent },
  }
}

function compressGitLog(raw: string): string {
  // Extract: commit hash, author, date (1 line per commit)
  const lines = raw.split('\n')
  const result: string[] = []
  let currentCommit = ''

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      if (currentCommit) result.push(currentCommit)
      const hash = line.slice(7, 13) // First 6 chars of hash
      currentCommit = `${hash}`
    } else if (line.startsWith('Author:')) {
      const author = line.slice(8).split('<')[0].trim()
      currentCommit += ` | ${author}`
    } else if (line.startsWith('Date:')) {
      const date = line.slice(6).trim()
      currentCommit += ` | ${date}`
    } else if (line.trim() && !line.startsWith(' ')) {
      // Subject line
      currentCommit += ` | ${line.slice(4, 50)}`
    }
  }

  if (currentCommit) result.push(currentCommit)
  return result.join('\n')
}

function compressGrep(raw: string): string {
  // Keep: filename:line_number:match
  // Drop: everything else
  const lines = raw.split('\n')
  const unique = new Map<string, number>()

  for (const line of lines) {
    if (!line.trim()) continue
    // Extract match pattern (everything after line number)
    const match = line.replace(/:\d+:.*/, ':N:...')
    unique.set(match, (unique.get(match) || 0) + 1)
  }

  const result: string[] = []
  for (const [line, count] of unique.entries()) {
    if (count > 5) {
      result.push(`[Pattern appears ${count}x] ${line}`)
    } else {
      result.push(line)
    }
  }

  return result.slice(0, 20).join('\n') + (result.length > 20 ? `\n... and ${result.length - 20} more matches` : '')
}

function compressLs(raw: string): string {
  // Keep: filename, size (drop perms, owner, date)
  const lines = raw.split('\n')
  const result: string[] = []

  for (const line of lines) {
    if (line.startsWith('total')) {
      result.push(line)
      continue
    }

    // Parse: drwxr-xr-x 1 user group 4096 Oct 25 12:34 filename
    const parts = line.split(/\s+/)
    if (parts.length < 9) continue

    const isDir = parts[0].startsWith('d') ? '/' : ''
    const size = parts[4]
    const name = parts.slice(8).join(' ')

    result.push(`${name}${isDir} (${size}B)`)
  }

  return result.join('\n')
}

function compressTree(raw: string): string {
  // Collapse deep levels, show count instead
  const lines = raw.split('\n')
  const result: string[] = []
  let depth = 0

  for (const line of lines) {
    const level = (line.match(/^[\s│├└─]*/)?.[0] || '').length / 4
    
    // Keep max 3 levels deep
    if (level > 3) {
      if (!line.includes('[collapsed]')) {
        const indent = '    '.repeat(3)
        result.push(`${indent}[collapsed]`)
      }
      continue
    }

    result.push(line)
  }

  return result.slice(0, 30).join('\n') + (result.length > 30 ? '\n... (truncated)' : '')
}

function compressLogs(raw: string): string {
  // Group by log level, collapse duplicates
  const lines = raw.split('\n')
  const levelCounts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 }
  const samples: { [key: string]: string[] } = { ERROR: [], WARN: [], INFO: [], DEBUG: [] }

  for (const line of lines) {
    if (line.includes('ERROR')) {
      levelCounts.ERROR++
      if (samples.ERROR.length < 2) samples.ERROR.push(line.slice(0, 100))
    } else if (line.includes('WARN')) {
      levelCounts.WARN++
      if (samples.WARN.length < 2) samples.WARN.push(line.slice(0, 100))
    } else if (line.includes('INFO')) {
      levelCounts.INFO++
      if (samples.INFO.length < 1) samples.INFO.push(line.slice(0, 100))
    } else if (line.includes('DEBUG')) {
      levelCounts.DEBUG++
    }
  }

  const result: string[] = []
  for (const [level, count] of Object.entries(levelCounts)) {
    if (count > 0) {
      result.push(`${level}: ${count}x`)
      if (samples[level].length > 0) {
        result.push(`  Sample: ${samples[level][0]}`)
      }
    }
  }

  return result.join('\n')
}

function compressGeneric(raw: string): string {
  // Remove empty lines, truncate very long lines, collapse whitespace
  const lines = raw
    .split('\n')
    .filter(l => l.trim())
    .map(l => (l.length > 120 ? l.slice(0, 120) + '…' : l))

  return lines.slice(0, 50).join('\n') + (lines.length > 50 ? `\n... (${lines.length - 50} more lines)` : '')
}

export function compressFileContent(content: string): string {
  // For large file reads
  if (content.length < 5000) return content

  const lines = content.split('\n')
  if (lines.length > 100) {
    return lines.slice(0, 30).join('\n') + `\n\n[... ${lines.length - 60} lines omitted ...]\n\n` + lines.slice(-30).join('\n')
  }

  return content
}
