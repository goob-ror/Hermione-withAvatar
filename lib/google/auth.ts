/**
 * Google OAuth2 client for multi-account support
 * 
 * Supports:
 * - Multiple Google accounts (work/personal)
 * - Gmail, Calendar, Drive, Tasks
 * - Token refresh
 * - Account switching
 */

import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export interface GoogleAccount {
  id: string // UUID
  email: string
  displayName: string
  scopes: string[]
  tokens: {
    access_token: string
    refresh_token: string
    expiry_date: number
  }
  createdAt: number
  lastUsed: number
}

export interface GoogleAccountsStore {
  version: 1
  accounts: GoogleAccount[]
  activeAccountId: string | null
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function accountsFile(): string {
  return path.join(configDir(), 'google-accounts.json')
}

function loadAccounts(): GoogleAccountsStore {
  try {
    const file = accountsFile()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load Google accounts:', err)
  }

  return {
    version: 1,
    accounts: [],
    activeAccountId: null,
  }
}

function saveAccounts(store: GoogleAccountsStore): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(accountsFile(), JSON.stringify(store, null, 2), 'utf-8')
}

export function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback'

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env')
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function generateAuthUrl(): string {
  const oauth2Client = getOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
}

export async function exchangeCodeForTokens(code: string): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens in OAuth response')
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
  }
}

export async function getUserInfo(accessToken: string): Promise<{ email: string; name: string }> {
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({ access_token: accessToken })

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const { data } = await oauth2.userinfo.get()

  return {
    email: data.email || 'unknown@gmail.com',
    name: data.name || 'Unknown User',
  }
}

export function addAccount(email: string, displayName: string, tokens: GoogleAccount['tokens']): GoogleAccount {
  const store = loadAccounts()

  const existing = store.accounts.find(a => a.email === email)
  if (existing) {
    existing.tokens = tokens
    existing.lastUsed = Date.now()
    saveAccounts(store)
    return existing
  }

  const account: GoogleAccount = {
    id: `google-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email,
    displayName,
    scopes: SCOPES,
    tokens,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  }

  store.accounts.push(account)
  
  if (!store.activeAccountId) {
    store.activeAccountId = account.id
  }

  saveAccounts(store)
  return account
}

export function listAccounts(): GoogleAccount[] {
  const store = loadAccounts()
  return store.accounts.map(a => ({
    ...a,
    tokens: {
      access_token: '••••••••',
      refresh_token: '••••••••',
      expiry_date: a.tokens.expiry_date,
    },
  }))
}

export function getAccount(accountId: string): GoogleAccount | null {
  const store = loadAccounts()
  return store.accounts.find(a => a.id === accountId) || null
}

export function getActiveAccount(): GoogleAccount | null {
  const store = loadAccounts()
  if (!store.activeAccountId) return null
  return store.accounts.find(a => a.id === store.activeAccountId) || null
}

export function setActiveAccount(accountId: string): boolean {
  const store = loadAccounts()
  const account = store.accounts.find(a => a.id === accountId)
  
  if (!account) return false
  
  store.activeAccountId = accountId
  account.lastUsed = Date.now()
  saveAccounts(store)
  return true
}

export function removeAccount(accountId: string): boolean {
  const store = loadAccounts()
  const index = store.accounts.findIndex(a => a.id === accountId)
  
  if (index === -1) return false
  
  store.accounts.splice(index, 1)
  
  if (store.activeAccountId === accountId) {
    store.activeAccountId = store.accounts[0]?.id || null
  }
  
  saveAccounts(store)
  return true
}

export async function refreshTokenIfNeeded(account: GoogleAccount): Promise<GoogleAccount> {
  const now = Date.now()
  const bufferMs = 5 * 60 * 1000

  if (account.tokens.expiry_date > now + bufferMs) {
    return account
  }

  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({
    refresh_token: account.tokens.refresh_token,
  })

  const { credentials } = await oauth2Client.refreshAccessToken()
  
  account.tokens = {
    access_token: credentials.access_token!,
    refresh_token: credentials.refresh_token || account.tokens.refresh_token,
    expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
  }

  const store = loadAccounts()
  const index = store.accounts.findIndex(a => a.id === account.id)
  if (index !== -1) {
    store.accounts[index] = account
    saveAccounts(store)
  }

  return account
}

export function getAuthenticatedClient(accountId?: string): OAuth2Client {
  const account = accountId ? getAccount(accountId) : getActiveAccount()
  
  if (!account) {
    throw new Error('No Google account found. Please authenticate first.')
  }

  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials(account.tokens)
  
  return oauth2Client
}
