/**
 * MemoryDashboard Component - Display user profile and agent learnings
 */

'use client'

import { useState, useEffect } from 'react'
import { User, Brain, Zap, Lightbulb, TrendingUp } from 'lucide-react'

interface UserProfile {
  name?: string
  email?: string
  timezone?: string
  preferences: {
    communicationStyle?: 'formal' | 'casual' | 'technical'
    responseLength?: 'brief' | 'detailed'
    focusAreas?: string[]
  }
  metadata: {
    interactionCount: number
  }
}

interface AgentMemory {
  agentName: string
  personality: {
    traits: string[]
    communicationStyle: string
    learnings: string[]
  }
  domainKnowledge: Array<{
    domain: string
    expertise: number
  }>
  skills: Array<{
    skill: string
    proficiency: number
    usageCount: number
  }>
}

interface MemoryDashboardProps {
  open: boolean
  onClose: () => void
}

export default function MemoryDashboard({ open, onClose }: MemoryDashboardProps) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [agentMemory, setAgentMemory] = useState<AgentMemory | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'profile' | 'agent'>('profile')

  useEffect(() => {
    if (open) {
      loadMemory()
    }
  }, [open])

  const loadMemory = async () => {
    try {
      const [userRes, agentRes] = await Promise.all([
        fetch('/api/memory?action=user-profile'),
        fetch('/api/memory?action=agent-memory'),
      ])

      const userData = await userRes.json()
      const agentData = await agentRes.json()

      setUserProfile(userData.profile)
      setAgentMemory(agentData.memory)
    } catch (err) {
      console.error('Failed to load memory:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Agent Memory</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'profile'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <User className="w-4 h-4 inline mr-2" />
            User Profile
          </button>
          <button
            onClick={() => setActiveTab('agent')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'agent'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Brain className="w-4 h-4 inline mr-2" />
            Agent Learning
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : activeTab === 'profile' && userProfile ? (
            <div className="space-y-6">
              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">
                  Basic Information
                </h3>
                <div className="space-y-2 text-sm">
                  {userProfile.name && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Name</span>
                      <span className="text-white">{userProfile.name}</span>
                    </div>
                  )}
                  {userProfile.email && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Email</span>
                      <span className="text-white">{userProfile.email}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-400">Interactions</span>
                    <span className="text-white">{userProfile.metadata.interactionCount}</span>
                  </div>
                </div>
              </div>

              {/* Preferences */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">
                  Communication Preferences
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Style</span>
                    <span className="text-white capitalize">
                      {userProfile.preferences.communicationStyle || 'Not set'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Response Length</span>
                    <span className="text-white capitalize">
                      {userProfile.preferences.responseLength || 'Not set'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Focus Areas */}
              {userProfile.preferences.focusAreas && userProfile.preferences.focusAreas.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    Focus Areas
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {userProfile.preferences.focusAreas.map(area => (
                      <span
                        key={area}
                        className="px-3 py-1 bg-blue-900/30 text-blue-300 rounded text-xs"
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'agent' && agentMemory ? (
            <div className="space-y-6">
              {/* Personality */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Personality Traits
                </h3>
                <div className="flex flex-wrap gap-2">
                  {agentMemory.personality.traits.map(trait => (
                    <span
                      key={trait}
                      className="px-3 py-1 bg-purple-900/30 text-purple-300 rounded text-xs"
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              </div>

              {/* Communication Style */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-2">
                  Communication Style
                </h3>
                <p className="text-sm text-gray-400">
                  {agentMemory.personality.communicationStyle}
                </p>
              </div>

              {/* Learnings */}
              {agentMemory.personality.learnings.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-green-400" />
                    Key Learnings
                  </h3>
                  <div className="space-y-2">
                    {agentMemory.personality.learnings.slice(0, 5).map((learning, i) => (
                      <div key={i} className="text-xs text-gray-400 flex gap-2">
                        <span className="text-green-400">•</span>
                        <span>{learning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expertise */}
              {agentMemory.domainKnowledge.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    Expertise Areas
                  </h3>
                  <div className="space-y-3">
                    {agentMemory.domainKnowledge.slice(0, 5).map(domain => (
                      <div key={domain.domain}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">{domain.domain}</span>
                          <span className="text-blue-300">{domain.expertise}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded h-2">
                          <div
                            className="bg-blue-500 h-2 rounded"
                            style={{ width: `${domain.expertise}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
