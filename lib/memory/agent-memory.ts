/**
 * Agent Memory System - Persistent knowledge about user and agent
 * 
 * Stores:
 * - User preferences and habits
 * - Agent personality traits learned
 * - Domain knowledge and learnings
 * - Skill improvements over time
 */

import fs from 'fs'
import path from 'path'

export interface UserProfile {
  userId?: string
  name?: string
  email?: string
  timezone?: string
  preferences: {
    communicationStyle?: 'formal' | 'casual' | 'technical'
    responseLength?: 'brief' | 'detailed'
    workHours?: { start: number; end: number } // 0-23
    focusAreas?: string[]
    doNotDisturb?: boolean
  }
  habits: {
    morningRoutine?: string[]
    eveningRoutine?: string[]
    frequentTasks?: Array<{ task: string; frequency: string }>
  }
  metadata: {
    createdAt: number
    lastUpdated: number
    interactionCount: number
  }
}

export interface AgentMemory {
  agentName: string
  personality: {
    traits: string[] // e.g., ["helpful", "efficient", "detail-oriented"]
    communicationStyle: string
    learnings: string[] // Things about how to better serve this user
  }
  domainKnowledge: Array<{
    domain: string
    expertise: number // 0-100
    resources?: string[]
    lastUpdated: number
  }>
  skills: Array<{
    skill: string
    proficiency: number // 0-100
    usageCount: number
    lastUsed: number
  }>
  metadata: {
    createdAt: number
    lastUpdated: number
    conversationCount: number
  }
}

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function memoryDir(): string {
  return path.join(configDir(), 'memory')
}

function userProfileFile(): string {
  return path.join(memoryDir(), 'user-profile.json')
}

function agentMemoryFile(): string {
  return path.join(memoryDir(), 'agent-memory.json')
}

function ensureMemoryDir(): void {
  const dir = memoryDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const memoryCache = {
  userProfile: null as UserProfile | null,
  agentMemory: null as AgentMemory | null,
}

function defaultUserProfile(): UserProfile {
  return {
    preferences: {
      communicationStyle: 'casual',
      responseLength: 'detailed',
      focusAreas: [],
    },
    habits: {
      frequentTasks: [],
    },
    metadata: {
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      interactionCount: 0,
    },
  }
}

function defaultAgentMemory(agentName: string): AgentMemory {
  return {
    agentName,
    personality: {
      traits: ['helpful', 'efficient'],
      communicationStyle: 'professional and warm',
      learnings: [],
    },
    domainKnowledge: [],
    skills: [],
    metadata: {
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      conversationCount: 0,
    },
  }
}

export function loadUserProfile(): UserProfile {
  if (memoryCache.userProfile) {
    return memoryCache.userProfile
  }

  try {
    ensureMemoryDir()
    const file = userProfileFile()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      memoryCache.userProfile = data
      return data
    }
  } catch (err) {
    console.error('Failed to load user profile:', err)
  }

  const profile = defaultUserProfile()
  memoryCache.userProfile = profile
  return profile
}

export function saveUserProfile(profile: UserProfile): void {
  memoryCache.userProfile = profile
  profile.metadata.lastUpdated = Date.now()

  try {
    ensureMemoryDir()
    fs.writeFileSync(userProfileFile(), JSON.stringify(profile, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save user profile:', err)
  }
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const profile = loadUserProfile()
  const updated = { ...profile, ...updates }
  updated.metadata.lastUpdated = Date.now()
  saveUserProfile(updated)
  return updated
}

export function loadAgentMemory(agentName: string = 'Hermione'): AgentMemory {
  if (memoryCache.agentMemory) {
    return memoryCache.agentMemory
  }

  try {
    ensureMemoryDir()
    const file = agentMemoryFile()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      memoryCache.agentMemory = data
      return data
    }
  } catch (err) {
    console.error('Failed to load agent memory:', err)
  }

  const memory = defaultAgentMemory(agentName)
  memoryCache.agentMemory = memory
  return memory
}

export function saveAgentMemory(memory: AgentMemory): void {
  memoryCache.agentMemory = memory
  memory.metadata.lastUpdated = Date.now()

  try {
    ensureMemoryDir()
    fs.writeFileSync(agentMemoryFile(), JSON.stringify(memory, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save agent memory:', err)
  }
}

export function recordInteraction(): void {
  const profile = loadUserProfile()
  profile.metadata.interactionCount++
  profile.metadata.lastUpdated = Date.now()
  saveUserProfile(profile)

  const memory = loadAgentMemory()
  memory.metadata.conversationCount++
  memory.metadata.lastUpdated = Date.now()
  saveAgentMemory(memory)
}

export function recordLearning(learning: string): void {
  const memory = loadAgentMemory()
  if (!memory.personality.learnings.includes(learning)) {
    memory.personality.learnings.push(learning)
  }
  memory.metadata.lastUpdated = Date.now()
  saveAgentMemory(memory)
}

export function recordSkillUsage(skill: string, proficiencyIncrease: number = 5): void {
  const memory = loadAgentMemory()

  let skillRecord = memory.skills.find(s => s.skill === skill)
  if (!skillRecord) {
    skillRecord = {
      skill,
      proficiency: 0,
      usageCount: 0,
      lastUsed: Date.now(),
    }
    memory.skills.push(skillRecord)
  }

  skillRecord.usageCount++
  skillRecord.lastUsed = Date.now()
  skillRecord.proficiency = Math.min(100, skillRecord.proficiency + proficiencyIncrease)

  memory.metadata.lastUpdated = Date.now()
  saveAgentMemory(memory)
}

export function setDomainExpertise(domain: string, level: number, resources?: string[]): void {
  const memory = loadAgentMemory()

  let domainRecord = memory.domainKnowledge.find(d => d.domain === domain)
  if (!domainRecord) {
    domainRecord = {
      domain,
      expertise: 0,
      lastUpdated: Date.now(),
    }
    memory.domainKnowledge.push(domainRecord)
  }

  domainRecord.expertise = Math.min(100, Math.max(0, level))
  domainRecord.lastUpdated = Date.now()
  if (resources) {
    domainRecord.resources = resources
  }

  memory.metadata.lastUpdated = Date.now()
  saveAgentMemory(memory)
}

export function getUserPreferences(key: keyof UserProfile['preferences']): any {
  const profile = loadUserProfile()
  return profile.preferences[key]
}

export function setUserPreference(key: keyof UserProfile['preferences'], value: any): void {
  const profile = loadUserProfile()
  profile.preferences[key] = value
  profile.metadata.lastUpdated = Date.now()
  saveUserProfile(profile)
}

export function addUserHabit(category: keyof UserProfile['habits'], habit: any): void {
  const profile = loadUserProfile()
  const habits = profile.habits[category]
  if (Array.isArray(habits)) {
    if (!habits.includes(habit)) {
      habits.push(habit)
    }
  }
  profile.metadata.lastUpdated = Date.now()
  saveUserProfile(profile)
}

export function getAgentPersonality(): string {
  const memory = loadAgentMemory()
  const traits = memory.personality.traits.join(', ')
  const style = memory.personality.communicationStyle
  return `${style} (${traits})`
}

export function getAgentLearnings(): string[] {
  const memory = loadAgentMemory()
  return memory.personality.learnings
}

export function getTopSkills(limit: number = 5): AgentMemory['skills'] {
  const memory = loadAgentMemory()
  return memory.skills
    .sort((a, b) => b.proficiency - a.proficiency)
    .slice(0, limit)
}

/**
 * Generate a memory summary for context injection
 */
export function generateMemorySummary(): string {
  const userProfile = loadUserProfile()
  const agentMemory = loadAgentMemory()

  let summary = '## Agent Memory Summary\n\n'

  // User info
  if (userProfile.name) {
    summary += `**User**: ${userProfile.name}\n`
  }
  if (userProfile.preferences.communicationStyle) {
    summary += `**Preferred Communication**: ${userProfile.preferences.communicationStyle}\n`
  }
  if (userProfile.preferences.focusAreas?.length) {
    summary += `**Focus Areas**: ${userProfile.preferences.focusAreas.join(', ')}\n`
  }

  // Agent personality
  summary += `\n**Agent Personality**: ${getAgentPersonality()}\n`

  // Top learnings
  if (agentMemory.personality.learnings.length > 0) {
    summary += `\n**Key Learnings**:\n`
    agentMemory.personality.learnings.slice(0, 3).forEach(l => {
      summary += `- ${l}\n`
    })
  }

  // Expertise
  const topDomains = agentMemory.domainKnowledge
    .filter(d => d.expertise > 60)
    .sort((a, b) => b.expertise - a.expertise)
    .slice(0, 3)

  if (topDomains.length > 0) {
    summary += `\n**Expertise Areas**:\n`
    topDomains.forEach(d => {
      summary += `- ${d.domain} (${d.expertise}%)\n`
    })
  }

  return summary
}
