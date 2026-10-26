/**
 * Google Drive integration for Hermione
 * 
 * Supports:
 * - Search files (by name and content)
 * - List files in folder
 * - Download file content
 * - Upload file
 * - Create folder
 * - Delete file
 * - Share/permissions
 */

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { refreshTokenIfNeeded } from './auth'
import type { GoogleAccount } from './auth'
import { Readable } from 'stream'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: number
  createdTime: string
  modifiedTime: string
  webViewLink?: string
  parents?: string[]
  isFolder: boolean
}

async function ensureValidClient(client: OAuth2Client, account: GoogleAccount): Promise<OAuth2Client> {
  const refreshed = await refreshTokenIfNeeded(account)
  client.setCredentials(refreshed.tokens)
  return client
}

export async function searchFiles(
  client: OAuth2Client,
  account: GoogleAccount,
  options: {
    query?: string // Search by name
    contentQuery?: string // Search by content (full-text)
    mimeType?: string
    folderId?: string
    maxResults?: number
  }
): Promise<DriveFile[]> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  // Build query
  const queryParts: string[] = []
  
  if (options.query) {
    queryParts.push(`name contains '${options.query.replace(/'/g, "\\'")}'`)
  }
  
  if (options.contentQuery) {
    queryParts.push(`fullText contains '${options.contentQuery.replace(/'/g, "\\'")}'`)
  }
  
  if (options.mimeType) {
    queryParts.push(`mimeType = '${options.mimeType}'`)
  }
  
  if (options.folderId) {
    queryParts.push(`'${options.folderId}' in parents`)
  }
  
  queryParts.push('trashed = false')

  const q = queryParts.join(' and ')

  const res = await drive.files.list({
    q,
    pageSize: Math.min(options.maxResults || 20, 100),
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents)',
    orderBy: 'modifiedTime desc',
  })

  if (!res.data.files) {
    return []
  }

  return res.data.files.map((file: any) => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType!,
    size: file.size ? parseInt(file.size) : undefined,
    createdTime: file.createdTime!,
    modifiedTime: file.modifiedTime!,
    webViewLink: file.webViewLink || undefined,
    parents: file.parents,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  }))
}

export async function listFilesInFolder(
  client: OAuth2Client,
  account: GoogleAccount,
  folderId: string,
  maxResults?: number
): Promise<DriveFile[]> {
  return searchFiles(client, account, { folderId, maxResults })
}

export async function getFileContent(
  client: OAuth2Client,
  account: GoogleAccount,
  fileId: string
): Promise<{ content: string; mimeType: string } | null> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  try {
    // Get file metadata first
    const fileMeta = await drive.files.get({
      fileId,
      fields: 'mimeType, name',
    })

    const mimeType = fileMeta.data.mimeType!

    // Handle Google Workspace files (need export)
    if (mimeType.startsWith('application/vnd.google-apps.')) {
      let exportMimeType = 'text/plain'
      
      if (mimeType === 'application/vnd.google-apps.document') {
        exportMimeType = 'text/plain'
      } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportMimeType = 'text/csv'
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        exportMimeType = 'text/plain'
      }

      const res = await drive.files.export({
        fileId,
        mimeType: exportMimeType,
      }, { responseType: 'text' })

      return {
        content: res.data as string,
        mimeType: exportMimeType,
      }
    }

    // Handle regular files
    const res = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'text' })

    return {
      content: res.data as string,
      mimeType,
    }
  } catch (err) {
    console.error('Failed to get file content:', err)
    return null
  }
}

export async function uploadFile(
  client: OAuth2Client,
  account: GoogleAccount,
  options: {
    name: string
    content: string | Buffer
    mimeType: string
    folderId?: string
  }
): Promise<DriveFile | null> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  try {
    const fileMetadata: any = {
      name: options.name,
      mimeType: options.mimeType,
    }

    if (options.folderId) {
      fileMetadata.parents = [options.folderId]
    }

    const media = {
      mimeType: options.mimeType,
      body: Readable.from([options.content]),
    }

    const res = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink',
    })

    return {
      id: res.data.id!,
      name: res.data.name!,
      mimeType: res.data.mimeType!,
      size: res.data.size ? parseInt(res.data.size) : undefined,
      createdTime: res.data.createdTime!,
      modifiedTime: res.data.modifiedTime!,
      webViewLink: res.data.webViewLink || undefined,
      isFolder: false,
    }
  } catch (err) {
    console.error('Failed to upload file:', err)
    return null
  }
}

export async function createFolder(
  client: OAuth2Client,
  account: GoogleAccount,
  name: string,
  parentFolderId?: string
): Promise<DriveFile | null> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  try {
    const fileMetadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }

    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId]
    }

    const res = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name, mimeType, createdTime, modifiedTime, webViewLink',
    })

    return {
      id: res.data.id!,
      name: res.data.name!,
      mimeType: res.data.mimeType!,
      createdTime: res.data.createdTime!,
      modifiedTime: res.data.modifiedTime!,
      webViewLink: res.data.webViewLink || undefined,
      isFolder: true,
    }
  } catch (err) {
    console.error('Failed to create folder:', err)
    return null
  }
}

export async function deleteFile(
  client: OAuth2Client,
  account: GoogleAccount,
  fileId: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  try {
    await drive.files.delete({ fileId })
    return true
  } catch (err) {
    console.error('Failed to delete file:', err)
    return false
  }
}

export async function updateFile(
  client: OAuth2Client,
  account: GoogleAccount,
  fileId: string,
  updates: {
    name?: string
    content?: string | Buffer
    mimeType?: string
  }
): Promise<DriveFile | null> {
  await ensureValidClient(client, account)
  
  const drive = google.drive({ version: 'v3', auth: client })

  try {
    const fileMetadata: any = {}
    if (updates.name) fileMetadata.name = updates.name

    const params: any = {
      fileId,
      requestBody: fileMetadata,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink',
    }

    if (updates.content) {
      params.media = {
        mimeType: updates.mimeType || 'text/plain',
        body: Readable.from([updates.content]),
      }
    }

    const res = await drive.files.update(params)

    return {
      id: res.data.id!,
      name: res.data.name!,
      mimeType: res.data.mimeType!,
      size: res.data.size ? parseInt(res.data.size) : undefined,
      createdTime: res.data.createdTime!,
      modifiedTime: res.data.modifiedTime!,
      webViewLink: res.data.webViewLink || undefined,
      isFolder: res.data.mimeType === 'application/vnd.google-apps.folder',
    }
  } catch (err) {
    console.error('Failed to update file:', err)
    return null
  }
}
