/**
 * Documents directory auto-sync
 * 
 * Watches a local documents folder and syncs to Google Drive
 * - Poll-based watching (configurable interval)
 * - Bi-directional sync option
 * - Conflict resolution (local wins)
 */

import fs from 'fs'
import path from 'path'
import { watch } from 'fs'
import type { OAuth2Client } from 'google-auth-library'
import type { GoogleAccount } from './auth'
import { searchFiles, uploadFile, getFileContent, updateFile, createFolder } from './drive'

export interface DocsyncConfig {
  enabled: boolean
  localPath: string
  driveFolderId?: string // Remote folder ID on Google Drive
  pollIntervalMs: number // How often to check for changes
  biDirectional: boolean // Sync Drive → local too
}

export interface DocsyncState {
  lastSyncTime: number
  fileHashes: Map<string, string> // filename -> hash for change detection
}

let syncInterval: NodeJS.Timeout | null = null
const fileHashes = new Map<string, string>()

/**
 * Calculate simple hash of file for change detection
 */
function hashFile(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

export async function startDocsync(
  client: OAuth2Client,
  account: GoogleAccount,
  config: DocsyncConfig
): Promise<void> {
  if (!config.enabled) {
    console.log('Docsync disabled')
    return
  }

  if (!fs.existsSync(config.localPath)) {
    console.error(`Documents path not found: ${config.localPath}`)
    return
  }

  console.log(`Starting docsync for ${config.localPath}`)

  // Initial sync
  await syncDocuments(client, account, config)

  // Poll for changes
  syncInterval = setInterval(() => {
    syncDocuments(client, account, config).catch(err => {
      console.error('Docsync error:', err)
    })
  }, config.pollIntervalMs)
}

export function stopDocsync(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.log('Stopped docsync')
  }
}

async function syncDocuments(
  client: OAuth2Client,
  account: GoogleAccount,
  config: DocsyncConfig
): Promise<void> {
  try {
    // Scan local directory
    const localFiles = fs.readdirSync(config.localPath, { withFileTypes: true })

    for (const file of localFiles) {
      if (file.isDirectory()) continue

      const filePath = path.join(config.localPath, file.name)
      const content = fs.readFileSync(filePath, 'utf-8')
      const hash = hashFile(content)
      const prevHash = fileHashes.get(file.name)

      // File changed
      if (hash !== prevHash) {
        console.log(`[Docsync] Changed: ${file.name}`)

        // Upload to Google Drive
        if (config.driveFolderId) {
          const mimeType = getMimeType(file.name)
          const existing = await searchFiles(client, account, {
            query: file.name,
            folderId: config.driveFolderId,
          })

          if (existing.length > 0) {
            // Update existing
            await updateFile(client, account, existing[0].id, {
              content,
              mimeType,
            })
          } else {
            // Create new
            await uploadFile(client, account, {
              name: file.name,
              content,
              mimeType,
              folderId: config.driveFolderId,
            })
          }
        }

        fileHashes.set(file.name, hash)
      }
    }

    // Bi-directional sync: check Drive for new files
    if (config.biDirectional && config.driveFolderId) {
      const driveFiles = await searchFiles(client, account, {
        folderId: config.driveFolderId,
      })

      for (const driveFile of driveFiles) {
        const localFilePath = path.join(config.localPath, driveFile.name)

        // Skip if file exists locally and hash matches
        if (fs.existsSync(localFilePath)) {
          const content = fs.readFileSync(localFilePath, 'utf-8')
          const hash = hashFile(content)
          if (hash === fileHashes.get(driveFile.name)) {
            continue
          }
        }

        // Download from Drive
        console.log(`[Docsync] Downloading: ${driveFile.name}`)
        const result = await getFileContent(client, account, driveFile.id)

        if (result) {
          fs.writeFileSync(localFilePath, result.content, 'utf-8')
          const hash = hashFile(result.content)
          fileHashes.set(driveFile.name, hash)
        }
      }
    }
  } catch (err) {
    console.error('Docsync sync error:', err)
  }
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()

  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/plain',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  return mimeTypes[ext] || 'application/octet-stream'
}

export async function setupDocumentsFolder(
  client: OAuth2Client,
  account: GoogleAccount,
  folderPath: string
): Promise<string | null> {
  // Create a "Hermione Documents" folder on Drive if it doesn't exist
  const existing = await searchFiles(client, account, {
    query: 'Hermione Documents',
    mimeType: 'application/vnd.google-apps.folder',
  })

  if (existing.length > 0) {
    return existing[0].id
  }

  // Create new folder
  const folder = await createFolder(client, account, 'Hermione Documents')
  return folder?.id || null
}
