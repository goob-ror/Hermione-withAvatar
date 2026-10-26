import { NextRequest, NextResponse } from 'next/server'
import {
  listAccounts,
  getActiveAccount,
  setActiveAccount,
  removeAccount,
  generateAuthUrl,
  getAccount,
} from '@/lib/google/auth'

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  try {
    if (action === 'list') {
      const accounts = listAccounts()
      const active = getActiveAccount()
      return NextResponse.json({
        accounts,
        activeAccountId: active?.id,
      })
    }

    if (action === 'auth-url') {
      const url = generateAuthUrl()
      return NextResponse.json({ authUrl: url })
    }

    if (action === 'active') {
      const active = getActiveAccount()
      if (!active) {
        return NextResponse.json({ account: null })
      }

      return NextResponse.json({
        account: {
          id: active.id,
          email: active.email,
          displayName: active.displayName,
        },
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Google accounts error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  try {
    if (action === 'set-active') {
      const { accountId } = await req.json()

      if (!accountId) {
        return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
      }

      const success = setActiveAccount(accountId)

      if (!success) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      const active = getActiveAccount()
      return NextResponse.json({
        success: true,
        account: {
          id: active?.id,
          email: active?.email,
          displayName: active?.displayName,
        },
      })
    }

    if (action === 'remove') {
      const { accountId } = await req.json()

      if (!accountId) {
        return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
      }

      const success = removeAccount(accountId)

      if (!success) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Google accounts POST error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
