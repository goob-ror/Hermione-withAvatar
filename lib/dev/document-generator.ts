/**
 * Document Generation - Auto-generate README, API docs, guides
 * 
 * Generates:
 * - README.md from project structure
 * - API documentation from route handlers
 * - Setup guides
 * - Architecture diagrams (text-based)
 */

import fs from 'fs'
import path from 'path'

export interface ProjectMetadata {
  name: string
  description: string
  version: string
  repository?: string
  author?: string
  license?: string
}

export interface APIEndpoint {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  description: string
  params?: Array<{ name: string; type: string; required: boolean; description: string }>
  responses?: Array<{ status: number; description: string }>
}

export interface DocumentOptions {
  includeSetup?: boolean
  includeFeaturesTable?: boolean
  includeArchitecture?: boolean
  includeContributing?: boolean
}

/**
 * Generate README.md
 */
export function generateReadme(
  metadata: ProjectMetadata,
  features: string[],
  sections?: {
    overview?: string
    installation?: string
    usage?: string
    architecture?: string
  },
  options?: DocumentOptions
): string {
  let readme = `# ${metadata.name}\n\n`

  if (metadata.description) {
    readme += `${metadata.description}\n\n`
  }

  if (options?.includeFeaturesTable && features.length > 0) {
    readme += `## ✨ Features\n\n`
    features.forEach(f => {
      readme += `- ✅ ${f}\n`
    })
    readme += `\n`
  }

  if (sections?.overview) {
    readme += `## Overview\n\n${sections.overview}\n\n`
  }

  if (options?.includeSetup) {
    readme += `## Setup\n\n`
    if (sections?.installation) {
      readme += `${sections.installation}\n\n`
    } else {
      readme += `\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n`
    }
  }

  if (sections?.usage) {
    readme += `## Usage\n\n${sections.usage}\n\n`
  }

  if (sections?.architecture) {
    readme += `## Architecture\n\n${sections.architecture}\n\n`
  }

  if (metadata.repository) {
    readme += `## Repository\n\n[${metadata.repository}](${metadata.repository})\n\n`
  }

  if (metadata.license) {
    readme += `## License\n\n${metadata.license}\n`
  }

  return readme
}

/**
 * Generate API documentation
 */
export function generateApiDocs(endpoints: APIEndpoint[]): string {
  let docs = `# API Documentation\n\n`

  endpoints.forEach(endpoint => {
    docs += `## \`${endpoint.method} ${endpoint.path}\`\n\n`

    if (endpoint.description) {
      docs += `${endpoint.description}\n\n`
    }

    if (endpoint.params && endpoint.params.length > 0) {
      docs += `### Parameters\n\n`
      docs += `| Name | Type | Required | Description |\n`
      docs += `|------|------|----------|-------------|\n`
      endpoint.params.forEach(p => {
        docs += `| ${p.name} | \`${p.type}\` | ${p.required ? 'Yes' : 'No'} | ${p.description} |\n`
      })
      docs += `\n`
    }

    if (endpoint.responses && endpoint.responses.length > 0) {
      docs += `### Responses\n\n`
      endpoint.responses.forEach(r => {
        docs += `- **${r.status}**: ${r.description}\n`
      })
      docs += `\n`
    }
  })

  return docs
}

/**
 * Generate setup guide
 */
export function generateSetupGuide(
  projectName: string,
  steps: Array<{ title: string; instructions: string[] }>,
  troubleshooting?: Array<{ issue: string; solution: string }>
): string {
  let guide = `# ${projectName} Setup Guide\n\n`

  guide += `## Prerequisites\n\n`
  guide += `- Node.js 18+\n`
  guide += `- npm 8+\n`
  guide += `- Git\n\n`

  guide += `## Installation Steps\n\n`
  steps.forEach((step, i) => {
    guide += `### ${i + 1}. ${step.title}\n\n`
    step.instructions.forEach(instr => {
      if (instr.startsWith('$')) {
        guide += `\`\`\`bash\n${instr.slice(1).trim()}\n\`\`\`\n\n`
      } else if (instr.startsWith('code:')) {
        guide += `\`\`\`javascript\n${instr.slice(5).trim()}\n\`\`\`\n\n`
      } else {
        guide += `${instr}\n\n`
      }
    })
  })

  if (troubleshooting && troubleshooting.length > 0) {
    guide += `## Troubleshooting\n\n`
    troubleshooting.forEach(t => {
      guide += `### ${t.issue}\n\n${t.solution}\n\n`
    })
  }

  return guide
}

/**
 * Generate architecture diagram (ASCII)
 */
export function generateArchitectureDiagram(
  layers: Array<{ name: string; components: string[] }>
): string {
  let diagram = `# Architecture Diagram\n\n\`\`\`\n`

  layers.forEach((layer, i) => {
    diagram += `${'═'.repeat(60)}\n`
    diagram += `  ${layer.name.toUpperCase()}\n`
    diagram += `${'═'.repeat(60)}\n\n`

    layer.components.forEach(comp => {
      diagram += `  │ ${comp}\n`
    })

    if (i < layers.length - 1) {
      diagram += `  │\n  ▼\n\n`
    }
  })

  diagram += `\`\`\`\n`

  return diagram
}

/**
 * Generate CHANGELOG entry
 */
export function generateChangelogEntry(
  version: string,
  date: string,
  changes: {
    added?: string[]
    fixed?: string[]
    changed?: string[]
    removed?: string[]
  }
): string {
  let entry = `## [${version}] - ${date}\n\n`

  if (changes.added && changes.added.length > 0) {
    entry += `### Added\n\n`
    changes.added.forEach(c => (entry += `- ${c}\n`))
    entry += `\n`
  }

  if (changes.fixed && changes.fixed.length > 0) {
    entry += `### Fixed\n\n`
    changes.fixed.forEach(c => (entry += `- ${c}\n`))
    entry += `\n`
  }

  if (changes.changed && changes.changed.length > 0) {
    entry += `### Changed\n\n`
    changes.changed.forEach(c => (entry += `- ${c}\n`))
    entry += `\n`
  }

  if (changes.removed && changes.removed.length > 0) {
    entry += `### Removed\n\n`
    changes.removed.forEach(c => (entry += `- ${c}\n`))
    entry += `\n`
  }

  return entry
}

/**
 * Analyze project structure
 */
export function analyzeProjectStructure(rootPath: string): {
  files: number
  directories: number
  languages: Record<string, number>
  mainFiles: string[]
} {
  const stats = {
    files: 0,
    directories: 0,
    languages: {} as Record<string, number>,
    mainFiles: [] as string[],
  }

  function walk(dir: string, depth = 0) {
    if (depth > 3) return // Limit depth

    try {
      const entries = fs.readdirSync(dir)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue

        const fullPath = path.join(dir, entry)
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          stats.directories++
          walk(fullPath, depth + 1)
        } else {
          stats.files++
          const ext = path.extname(entry)
          stats.languages[ext] = (stats.languages[ext] || 0) + 1

          // Track main files
          if (['package.json', 'tsconfig.json', 'README.md', 'dockerfile'].includes(entry)) {
            stats.mainFiles.push(entry)
          }
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }

  walk(rootPath)
  return stats
}
