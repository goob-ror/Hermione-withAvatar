import { NextRequest, NextResponse } from 'next/server'
import { loadTelegramConfig, saveTelegramConfig, getMe, sendMessage } from '@/lib/telegram/bot'

export async function GET(req: NextRequest) {
  try {
    const config = loadTelegramConfig()
    
    if (!config) {
      return NextResponse.json({ configured: false })
    }

    // Verify token by calling getMe
    try {
      const bot = await getMe(config.botToken)
      return NextResponse.json({
        configured: true,
        botUsername: bot.username,
        botName: bot.first_name,
      })
    } catch (err) {
      return NextResponse.json({
        configured: true,
        error: 'Invalid bot token',
      })
    }
  } catch (err) {
    console.error('Telegram config error:', err)
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { botToken, allowedChatIds } = await req.json()

    if (!botToken) {
      return NextResponse.json({ error: 'Missing bot token' }, { status: 400 })
    }

    // Verify token
    try {
      const bot = await getMe(botToken)
      
      saveTelegramConfig({
        botToken,
        allowedChatIds: allowedChatIds || [],
      })

      return NextResponse.json({
        success: true,
        botUsername: bot.username,
        botName: bot.first_name,
      })
    } catch (err) {
      return NextResponse.json({ error: 'Invalid bot token' }, { status: 400 })
    }
  } catch (err) {
    console.error('Telegram config POST error:', err)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const config = loadTelegramConfig()
    if (config) {
      saveTelegramConfig({ botToken: '', allowedChatIds: [] })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Telegram config DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 })
  }
}
