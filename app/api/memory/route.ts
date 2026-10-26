import { NextRequest, NextResponse } from 'next/server'
import {
  loadUserProfile,
  saveUserProfile,
  updateUserProfile,
  loadAgentMemory,
  saveAgentMemory,
  recordInteraction,
  recordLearning,
  recordSkillUsage,
  setDomainExpertise,
  getUserPreferences,
  setUserPreference,
  addUserHabit,
  getAgentPersonality,
  getAgentLearnings,
  getTopSkills,
  generateMemorySummary,
} from '@/lib/memory/agent-memory'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'user-profile') {
      const profile = loadUserProfile()
      return NextResponse.json({ profile })
    }

    if (action === 'agent-memory') {
      const memory = loadAgentMemory()
      return NextResponse.json({ memory })
    }

    if (action === 'user-preference') {
      const key = req.nextUrl.searchParams.get('key')
      if (!key) {
        return NextResponse.json({ error: 'Missing key' }, { status: 400 })
      }
      const value = getUserPreferences(key as any)
      return NextResponse.json({ value })
    }

    if (action === 'personality') {
      const personality = getAgentPersonality()
      return NextResponse.json({ personality })
    }

    if (action === 'learnings') {
      const learnings = getAgentLearnings()
      return NextResponse.json({ learnings })
    }

    if (action === 'top-skills') {
      const limit = parseInt(req.nextUrl.searchParams.get('limit') || '5')
      const skills = getTopSkills(limit)
      return NextResponse.json({ skills })
    }

    if (action === 'summary') {
      const summary = generateMemorySummary()
      return NextResponse.json({ summary })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Memory GET error:', err)
    return NextResponse.json({ error: 'Failed to get memory' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const body = await req.json()

    if (action === 'update-user-profile') {
      const profile = updateUserProfile(body)
      return NextResponse.json({ success: true, profile })
    }

    if (action === 'save-agent-memory') {
      saveAgentMemory(body)
      return NextResponse.json({ success: true })
    }

    if (action === 'record-interaction') {
      recordInteraction()
      return NextResponse.json({ success: true })
    }

    if (action === 'record-learning') {
      const learning = body.learning
      if (!learning) {
        return NextResponse.json({ error: 'Missing learning' }, { status: 400 })
      }
      recordLearning(learning)
      return NextResponse.json({ success: true })
    }

    if (action === 'record-skill') {
      const skill = body.skill
      const proficiencyIncrease = body.proficiencyIncrease || 5
      if (!skill) {
        return NextResponse.json({ error: 'Missing skill' }, { status: 400 })
      }
      recordSkillUsage(skill, proficiencyIncrease)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-domain-expertise') {
      const domain = body.domain
      const level = body.level
      const resources = body.resources
      if (!domain || level === undefined) {
        return NextResponse.json({ error: 'Missing domain or level' }, { status: 400 })
      }
      setDomainExpertise(domain, level, resources)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-user-preference') {
      const key = body.key
      const value = body.value
      if (!key) {
        return NextResponse.json({ error: 'Missing key' }, { status: 400 })
      }
      setUserPreference(key, value)
      return NextResponse.json({ success: true })
    }

    if (action === 'add-user-habit') {
      const category = body.category
      const habit = body.habit
      if (!category || !habit) {
        return NextResponse.json({ error: 'Missing category or habit' }, { status: 400 })
      }
      addUserHabit(category, habit)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Memory POST error:', err)
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 })
  }
}
