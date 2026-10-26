/**
 * Gmail integration for Hermione
 * 
 * Supports:
 * - List messages (with pagination)
 * - Search (subject, from, to, body, before, after)
 * - Read full message
 * - Send email
 * - Mark as read/unread/trash
 */

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { refreshTokenIfNeeded } from './auth'
import type { GoogleAccount } from './auth'

export interface GmailMessage {
  id: string
  threadId: string
  snippet: string
  from: string
  to: string
  subject: string
  date: string
  isUnread: boolean
  labels: string[]
}

export interface GmailFullMessage extends GmailMessage {
  body: string
  headers: Record<string, string>
}

async function ensureValidClient(client: OAuth2Client, account: GoogleAccount): Promise<OAuth2Client> {
  const refreshed = await refreshTokenIfNeeded(account)
  client.setCredentials(refreshed.tokens)
  return client
}

export async function listMessages(
  client: OAuth2Client,
  account: GoogleAccount,
  options?: {
    query?: string
    maxResults?: number
    pageToken?: string
  }
): Promise<{ messages: GmailMessage[]; nextPageToken?: string }> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: options?.query || '',
    maxResults: Math.min(options?.maxResults || 20, 100),
    pageToken: options?.pageToken,
  })

  if (!res.data.messages) {
    return { messages: [], nextPageToken: res.data.nextPageToken || undefined }
  }

  const messages: GmailMessage[] = []

  for (const msg of res.data.messages) {
    try {
      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      })

      const headers = fullMsg.data.payload?.headers || []
      const headerMap = Object.fromEntries(headers.map((h: any) => [h.name, h.value]))

      messages.push({
        id: msg.id!,
        threadId: msg.threadId!,
        snippet: fullMsg.data.snippet || '',
        from: headerMap.From || 'unknown',
        to: headerMap.To || '',
        subject: headerMap.Subject || '(no subject)',
        date: headerMap.Date || '',
        isUnread: fullMsg.data.labelIds?.includes('UNREAD') || false,
        labels: fullMsg.data.labelIds || [],
      })
    } catch (err) {
      console.error('Failed to fetch message:', err)
    }
  }

  return { messages, nextPageToken: res.data.nextPageToken || undefined }
}

export async function getMessage(
  client: OAuth2Client,
  account: GoogleAccount,
  messageId: string
): Promise<GmailFullMessage | null> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    })

    const headers = res.data.payload?.headers || []
    const headerMap = Object.fromEntries(headers.map((h: any) => [h.name, h.value]))

    // Extract body
    let body = ''
    if (res.data.payload?.parts) {
      for (const part of res.data.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8')
          break
        }
      }
    } else if (res.data.payload?.body?.data) {
      body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf-8')
    }

    return {
      id: messageId,
      threadId: res.data.threadId!,
      snippet: res.data.snippet || '',
      from: headerMap.From || 'unknown',
      to: headerMap.To || '',
      subject: headerMap.Subject || '(no subject)',
      date: headerMap.Date || '',
      body,
      headers: headerMap,
      isUnread: res.data.labelIds?.includes('UNREAD') || false,
      labels: res.data.labelIds || [],
    }
  } catch (err) {
    console.error('Failed to fetch full message:', err)
    return null
  }
}

export async function searchMessages(
  client: OAuth2Client,
  account: GoogleAccount,
  query: string,
  maxResults?: number
): Promise<GmailMessage[]> {
  const result = await listMessages(client, account, {
    query,
    maxResults: maxResults || 20,
  })
  return result.messages
}

export async function sendMessage(
  client: OAuth2Client,
  account: GoogleAccount,
  options: {
    to: string
    subject: string
    body: string
    cc?: string
    bcc?: string
  }
): Promise<{ messageId: string; threadId: string }> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })

  // Build email
  const email = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    options.cc ? `Cc: ${options.cc}` : '',
    options.bcc ? `Bcc: ${options.bcc}` : '',
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    options.body,
  ]
    .filter(Boolean)
    .join('\n')

  const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
    },
  })

  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
  }
}

export async function markAsRead(
  client: OAuth2Client,
  account: GoogleAccount,
  messageId: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    })
    return true
  } catch (err) {
    console.error('Failed to mark as read:', err)
    return false
  }
}

export async function markAsUnread(
  client: OAuth2Client,
  account: GoogleAccount,
  messageId: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: ['UNREAD'],
      },
    })
    return true
  } catch (err) {
    console.error('Failed to mark as unread:', err)
    return false
  }
}

export async function deleteMessage(
  client: OAuth2Client,
  account: GoogleAccount,
  messageId: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  try {
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId,
    })
    return true
  } catch (err) {
    console.error('Failed to delete message:', err)
    return false
  }
}

export async function getUnreadCount(
  client: OAuth2Client,
  account: GoogleAccount
): Promise<number> {
  await ensureValidClient(client, account)
  
  const gmail = google.gmail({ version: 'v1', auth: client })
  
  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 1,
    })
    return res.data.resultSizeEstimate || 0
  } catch (err) {
    console.error('Failed to get unread count:', err)
    return 0
  }
}
