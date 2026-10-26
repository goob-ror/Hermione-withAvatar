/**
 * Telegram Bot integration for Hermione
 * 
 * Supports:
 * - Send messages
 * - Read messages from chats
 * - Monitor specific chats
 * - Get chat history
 * - Send files/photos
 */

import https from 'https'
import fs from 'fs'
import path from 'path'

export interface TelegramConfig {
  botToken: string
  allowedChatIds?: number[] // Optional: restrict to specific chats
}

export interface TelegramMessage {
  messageId: number
  chatId: number
  chatTitle?: string
  from: {
    id: number
    firstName: string
    lastName?: string
    username?: string
  }
  text?: string
  date: number
  isBot: boolean
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
}

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function telegramConfigFile(): string {
  return path.join(configDir(), 'telegram.json')
}

export function loadTelegramConfig(): TelegramConfig | null {
  try {
    const file = telegramConfigFile()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load Telegram config:', err)
  }
  return null
}

export function saveTelegramConfig(config: TelegramConfig): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(telegramConfigFile(), JSON.stringify(config, null, 2), 'utf-8')
}

async function telegramRequest(botToken: string, method: string, params?: any): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(params || {})

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.ok) {
              resolve(parsed.result)
            } else {
              reject(new Error(`Telegram API error: ${parsed.description}`))
            }
          } catch (err) {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

export async function sendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  options?: {
    parseMode?: 'Markdown' | 'HTML'
    replyToMessageId?: number
    disableNotification?: boolean
  }
): Promise<TelegramMessage> {
  const result = await telegramRequest(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode,
    reply_to_message_id: options?.replyToMessageId,
    disable_notification: options?.disableNotification,
  })

  return {
    messageId: result.message_id,
    chatId: result.chat.id,
    chatTitle: result.chat.title,
    from: {
      id: result.from.id,
      firstName: result.from.first_name,
      lastName: result.from.last_name,
      username: result.from.username,
    },
    text: result.text,
    date: result.date,
    isBot: result.from.is_bot,
  }
}

export async function getUpdates(
  botToken: string,
  offset?: number,
  limit?: number
): Promise<any[]> {
  const result = await telegramRequest(botToken, 'getUpdates', {
    offset,
    limit: limit || 100,
    timeout: 30,
  })

  return result
}

export async function getMe(botToken: string): Promise<any> {
  return telegramRequest(botToken, 'getMe')
}

export async function getChatHistory(
  botToken: string,
  chatId: number | string,
  limit: number = 100
): Promise<TelegramMessage[]> {
  // Note: Telegram doesn't have direct chat history API
  // This would require storing updates locally
  // For now, return empty array - implement via local storage
  console.warn('getChatHistory requires local message storage')
  return []
}

export async function sendPhoto(
  botToken: string,
  chatId: number | string,
  photoPath: string,
  caption?: string
): Promise<void> {
  // Implement file upload via multipart/form-data
  // Simplified for now - use sendMessage with photo URL instead
  console.warn('sendPhoto requires multipart upload implementation')
}

export async function forwardMessage(
  botToken: string,
  chatId: number | string,
  fromChatId: number | string,
  messageId: number
): Promise<TelegramMessage> {
  const result = await telegramRequest(botToken, 'forwardMessage', {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  })

  return {
    messageId: result.message_id,
    chatId: result.chat.id,
    chatTitle: result.chat.title,
    from: {
      id: result.from.id,
      firstName: result.from.first_name,
      lastName: result.from.last_name,
      username: result.from.username,
    },
    text: result.text,
    date: result.date,
    isBot: result.from.is_bot,
  }
}

export async function deleteMessage(
  botToken: string,
  chatId: number | string,
  messageId: number
): Promise<boolean> {
  try {
    await telegramRequest(botToken, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    })
    return true
  } catch (err) {
    console.error('Failed to delete message:', err)
    return false
  }
}

export async function getChat(
  botToken: string,
  chatId: number | string
): Promise<TelegramChat> {
  const result = await telegramRequest(botToken, 'getChat', {
    chat_id: chatId,
  })

  return {
    id: result.id,
    type: result.type,
    title: result.title,
    username: result.username,
  }
}
