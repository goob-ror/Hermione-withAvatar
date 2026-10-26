/**
 * Google Calendar integration for Hermione
 * 
 * Supports:
 * - List events (with date range)
 * - Create event
 * - Update event
 * - Delete event
 * - Search events
 */

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { refreshTokenIfNeeded } from './auth'
import type { GoogleAccount } from './auth'

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: string // ISO 8601
  end: string // ISO 8601
  location?: string
  attendees?: string[] // Email addresses
  isAllDay: boolean
  status: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink: string
}

async function ensureValidClient(client: OAuth2Client, account: GoogleAccount): Promise<OAuth2Client> {
  const refreshed = await refreshTokenIfNeeded(account)
  client.setCredentials(refreshed.tokens)
  return client
}

export async function listEvents(
  client: OAuth2Client,
  account: GoogleAccount,
  options?: {
    timeMin?: string // ISO 8601
    timeMax?: string // ISO 8601
    maxResults?: number
    calendarId?: string
  }
): Promise<CalendarEvent[]> {
  await ensureValidClient(client, account)
  
  const calendar = google.calendar({ version: 'v3', auth: client })
  
  const res = await calendar.events.list({
    calendarId: options?.calendarId || 'primary',
    timeMin: options?.timeMin || new Date().toISOString(),
    timeMax: options?.timeMax,
    maxResults: Math.min(options?.maxResults || 20, 100),
    singleEvents: true,
    orderBy: 'startTime',
  })

  if (!res.data.items) {
    return []
  }

  return res.data.items.map((event: any) => ({
    id: event.id!,
    summary: event.summary || '(no title)',
    description: event.description || undefined,
    start: event.start?.dateTime || event.start?.date!,
    end: event.end?.dateTime || event.end?.date!,
    location: event.location || undefined,
    attendees: event.attendees?.map((a: any) => a.email) || [],
    isAllDay: !!event.start?.date,
    status: event.status as 'confirmed' | 'tentative' | 'cancelled',
    htmlLink: event.htmlLink!,
  }))
}

export async function createEvent(
  client: OAuth2Client,
  account: GoogleAccount,
  event: {
    summary: string
    description?: string
    start: string // ISO 8601 or 'YYYY-MM-DD' for all-day
    end: string // ISO 8601 or 'YYYY-MM-DD' for all-day
    location?: string
    attendees?: string[] // Email addresses
    calendarId?: string
  }
): Promise<CalendarEvent> {
  await ensureValidClient(client, account)
  
  const calendar = google.calendar({ version: 'v3', auth: client })

  // Detect all-day events
  const isAllDay = event.start.length === 10 && event.end.length === 10

  const res = await calendar.events.insert({
    calendarId: event.calendarId || 'primary',
    requestBody: {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: isAllDay
        ? { date: event.start }
        : { dateTime: event.start },
      end: isAllDay
        ? { date: event.end }
        : { dateTime: event.end },
      attendees: event.attendees?.map(email => ({ email })),
    },
  })

  return {
    id: res.data.id!,
    summary: res.data.summary!,
    description: res.data.description || undefined,
    start: res.data.start?.dateTime || res.data.start?.date!,
    end: res.data.end?.dateTime || res.data.end?.date!,
    location: res.data.location || undefined,
    attendees: res.data.attendees?.map((a: any) => a.email) || [],
    isAllDay,
    status: res.data.status as 'confirmed' | 'tentative' | 'cancelled',
    htmlLink: res.data.htmlLink!,
  }
}

export async function updateEvent(
  client: OAuth2Client,
  account: GoogleAccount,
  eventId: string,
  updates: {
    summary?: string
    description?: string
    start?: string
    end?: string
    location?: string
    attendees?: string[]
    calendarId?: string
  }
): Promise<CalendarEvent | null> {
  await ensureValidClient(client, account)
  
  const calendar = google.calendar({ version: 'v3', auth: client })

  try {
    const existing = await calendar.events.get({
      calendarId: updates.calendarId || 'primary',
      eventId,
    })

    const isAllDay = !!(existing.data.start?.date)

    const res = await calendar.events.update({
      calendarId: updates.calendarId || 'primary',
      eventId,
      requestBody: {
        summary: updates.summary || existing.data.summary,
        description: updates.description !== undefined ? updates.description : existing.data.description,
        location: updates.location !== undefined ? updates.location : existing.data.location,
        start: updates.start
          ? (isAllDay ? { date: updates.start } : { dateTime: updates.start })
          : existing.data.start,
        end: updates.end
          ? (isAllDay ? { date: updates.end } : { dateTime: updates.end })
          : existing.data.end,
        attendees: updates.attendees
          ? updates.attendees.map(email => ({ email }))
          : existing.data.attendees,
      },
    })

    return {
      id: res.data.id!,
      summary: res.data.summary!,
      description: res.data.description || undefined,
      start: res.data.start?.dateTime || res.data.start?.date!,
      end: res.data.end?.dateTime || res.data.end?.date!,
      location: res.data.location || undefined,
      attendees: res.data.attendees?.map((a: any) => a.email) || [],
      isAllDay,
      status: res.data.status as 'confirmed' | 'tentative' | 'cancelled',
      htmlLink: res.data.htmlLink!,
    }
  } catch (err) {
    console.error('Failed to update event:', err)
    return null
  }
}

export async function deleteEvent(
  client: OAuth2Client,
  account: GoogleAccount,
  eventId: string,
  calendarId?: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const calendar = google.calendar({ version: 'v3', auth: client })

  try {
    await calendar.events.delete({
      calendarId: calendarId || 'primary',
      eventId,
    })
    return true
  } catch (err) {
    console.error('Failed to delete event:', err)
    return false
  }
}

export async function searchEvents(
  client: OAuth2Client,
  account: GoogleAccount,
  query: string,
  maxResults?: number
): Promise<CalendarEvent[]> {
  await ensureValidClient(client, account)
  
  const calendar = google.calendar({ version: 'v3', auth: client })

  const res = await calendar.events.list({
    calendarId: 'primary',
    q: query,
    maxResults: Math.min(maxResults || 20, 100),
    singleEvents: true,
    orderBy: 'startTime',
  })

  if (!res.data.items) {
    return []
  }

  return res.data.items.map((event: any) => ({
    id: event.id!,
    summary: event.summary || '(no title)',
    description: event.description || undefined,
    start: event.start?.dateTime || event.start?.date!,
    end: event.end?.dateTime || event.end?.date!,
    location: event.location || undefined,
    attendees: event.attendees?.map((a: any) => a.email) || [],
    isAllDay: !!event.start?.date,
    status: event.status as 'confirmed' | 'tentative' | 'cancelled',
    htmlLink: event.htmlLink!,
  }))
}

export async function getTodayEvents(
  client: OAuth2Client,
  account: GoogleAccount
): Promise<CalendarEvent[]> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  return listEvents(client, account, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
  })
}

export async function getUpcomingEvents(
  client: OAuth2Client,
  account: GoogleAccount,
  days: number = 7
): Promise<CalendarEvent[]> {
  const now = new Date()
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  return listEvents(client, account, {
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
  })
}
