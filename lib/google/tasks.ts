/**
 * Google Tasks integration for Hermione
 * 
 * Supports:
 * - List tasks
 * - Create task
 * - Update task
 * - Delete task
 * - Mark complete/incomplete
 * - Task lists management
 */

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { refreshTokenIfNeeded } from './auth'
import type { GoogleAccount } from './auth'

export interface Task {
  id: string
  title: string
  notes?: string
  due?: string // RFC 3339 format
  completed?: string
  status: 'needsAction' | 'completed'
  position: string
  parent?: string // Parent task ID for subtasks
}

export interface TaskList {
  id: string
  title: string
}

async function ensureValidClient(client: OAuth2Client, account: GoogleAccount): Promise<OAuth2Client> {
  const refreshed = await refreshTokenIfNeeded(account)
  client.setCredentials(refreshed.tokens)
  return client
}

export async function listTaskLists(
  client: OAuth2Client,
  account: GoogleAccount
): Promise<TaskList[]> {
  await ensureValidClient(client, account)
  
  const tasks = google.tasks({ version: 'v1', auth: client })
  
  const res = await tasks.tasklists.list()

  if (!res.data.items) {
    return []
  }

  return res.data.items.map((list: any) => ({
    id: list.id!,
    title: list.title!,
  }))
}

export async function listTasks(
  client: OAuth2Client,
  account: GoogleAccount,
  options?: {
    taskListId?: string
    showCompleted?: boolean
    showDeleted?: boolean
    maxResults?: number
  }
): Promise<Task[]> {
  await ensureValidClient(client, account)
  
  const taskApi = google.tasks({ version: 'v1', auth: client })
  
  const res = await taskApi.tasks.list({
    tasklist: options?.taskListId || '@default',
    showCompleted: options?.showCompleted !== false,
    showDeleted: options?.showDeleted !== false,
    maxResults: Math.min(options?.maxResults || 20, 100),
  })

  if (!res.data.items) {
    return []
  }

  return res.data.items.map((task: any) => ({
    id: task.id!,
    title: task.title!,
    notes: task.notes || undefined,
    due: task.due || undefined,
    completed: task.completed || undefined,
    status: task.status as 'needsAction' | 'completed',
    position: task.position!,
    parent: task.parent || undefined,
  }))
}

export async function createTask(
  client: OAuth2Client,
  account: GoogleAccount,
  task: {
    title: string
    notes?: string
    due?: string // RFC 3339 format (e.g., '2026-10-26T23:59:59.000Z')
    taskListId?: string
    parent?: string // Parent task ID for subtasks
  }
): Promise<Task> {
  await ensureValidClient(client, account)
  
  const taskApi = google.tasks({ version: 'v1', auth: client })

  const res = await taskApi.tasks.insert({
    tasklist: task.taskListId || '@default',
    requestBody: {
      title: task.title,
      notes: task.notes,
      due: task.due,
      parent: task.parent,
    },
  })

  return {
    id: res.data.id!,
    title: res.data.title!,
    notes: res.data.notes || undefined,
    due: res.data.due || undefined,
    completed: res.data.completed || undefined,
    status: res.data.status as 'needsAction' | 'completed',
    position: res.data.position!,
    parent: res.data.parent || undefined,
  }
}

export async function updateTask(
  client: OAuth2Client,
  account: GoogleAccount,
  taskId: string,
  updates: {
    title?: string
    notes?: string
    due?: string
    status?: 'needsAction' | 'completed'
    taskListId?: string
  }
): Promise<Task | null> {
  await ensureValidClient(client, account)
  
  const taskApi = google.tasks({ version: 'v1', auth: client })

  try {
    const existing = await taskApi.tasks.get({
      tasklist: updates.taskListId || '@default',
      task: taskId,
    })

    const res = await taskApi.tasks.update({
      tasklist: updates.taskListId || '@default',
      task: taskId,
      requestBody: {
        title: updates.title !== undefined ? updates.title : existing.data.title,
        notes: updates.notes !== undefined ? updates.notes : existing.data.notes,
        due: updates.due !== undefined ? updates.due : existing.data.due,
        status: updates.status !== undefined ? updates.status : existing.data.status,
      },
    })

    return {
      id: res.data.id!,
      title: res.data.title!,
      notes: res.data.notes || undefined,
      due: res.data.due || undefined,
      completed: res.data.completed || undefined,
      status: res.data.status as 'needsAction' | 'completed',
      position: res.data.position!,
      parent: res.data.parent || undefined,
    }
  } catch (err) {
    console.error('Failed to update task:', err)
    return null
  }
}

export async function deleteTask(
  client: OAuth2Client,
  account: GoogleAccount,
  taskId: string,
  taskListId?: string
): Promise<boolean> {
  await ensureValidClient(client, account)
  
  const taskApi = google.tasks({ version: 'v1', auth: client })

  try {
    await taskApi.tasks.delete({
      tasklist: taskListId || '@default',
      task: taskId,
    })
    return true
  } catch (err) {
    console.error('Failed to delete task:', err)
    return false
  }
}

export async function markComplete(
  client: OAuth2Client,
  account: GoogleAccount,
  taskId: string,
  taskListId?: string
): Promise<Task | null> {
  return updateTask(client, account, taskId, {
    status: 'completed',
    taskListId,
  })
}

export async function markIncomplete(
  client: OAuth2Client,
  account: GoogleAccount,
  taskId: string,
  taskListId?: string
): Promise<Task | null> {
  return updateTask(client, account, taskId, {
    status: 'needsAction',
    taskListId,
  })
}

export async function getOverdueTasks(
  client: OAuth2Client,
  account: GoogleAccount,
  taskListId?: string
): Promise<Task[]> {
  const tasks = await listTasks(client, account, {
    taskListId,
    showCompleted: false,
  })

  const now = new Date()
  return tasks.filter(task => {
    if (!task.due) return false
    const dueDate = new Date(task.due)
    return dueDate < now
  })
}

export async function getDueToday(
  client: OAuth2Client,
  account: GoogleAccount,
  taskListId?: string
): Promise<Task[]> {
  const tasks = await listTasks(client, account, {
    taskListId,
    showCompleted: false,
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return tasks.filter(task => {
    if (!task.due) return false
    const dueDate = new Date(task.due)
    return dueDate >= today && dueDate < tomorrow
  })
}
