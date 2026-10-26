import { NextRequest, NextResponse } from 'next/server'
import { loadTelegramConfig, sendMessage } from '@/lib/telegram/bot'

export async function POST(req: NextRequest) {
  try {
    const config = loadTelegramConfig()
    
    if (!config) {
      return NextResponse.json({ error: 'Telegram not configured' }, { status: 400 })
    }

    const { chatId, text, parseMode, replyToMessageId } = await req.json()

    if (!chatId || !text) {
      return NextResponse.json({ error: 'Missing chatId or text' }, { status: 400 })
    }

    const message = await sendMessage(config.botToken, chatId, text, {
      parseMode,
      replyToMessageId,
    })

    return NextResponse.json({ success: true, message })
  } catch (err) {
    console.error('Telegram send error:', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
