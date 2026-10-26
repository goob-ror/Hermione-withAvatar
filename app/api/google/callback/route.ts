import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getUserInfo, addAccount } from '@/lib/google/auth'

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const state = req.nextUrl.searchParams.get('state')

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    // Get user info
    const userInfo = await getUserInfo(tokens.access_token)

    // Save account
    const account = addAccount(userInfo.email, userInfo.name, tokens)

    // Redirect back to app with success message
    const redirectUrl = new URL('http://localhost:3000')
    redirectUrl.searchParams.set('google_auth', 'success')
    redirectUrl.searchParams.set('email', account.email)

    return NextResponse.redirect(redirectUrl)
  } catch (err) {
    console.error('OAuth callback error:', err)
    const redirectUrl = new URL('http://localhost:3000')
    redirectUrl.searchParams.set('google_auth', 'error')
    redirectUrl.searchParams.set('message', 'Authentication failed')

    return NextResponse.redirect(redirectUrl)
  }
}
