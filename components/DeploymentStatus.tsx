/**
 * DeploymentStatus Component - Monitor deployments and health
 */

'use client'

import { useState, useEffect } from 'react'
import { Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react'

interface Deployment {
  platform: string
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled'
  url?: string
  startedAt?: string
  completedAt?: string
}

interface HealthCheck {
  endpoint: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTime?: number
  error?: string
}

interface DeploymentStatusProps {
  open: boolean
  onClose: () => void
}

export default function DeploymentStatus({ open, onClose }: DeploymentStatusProps) {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [health, setHealth] = useState<HealthCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [overallStatus, setOverallStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy')

  useEffect(() => {
    if (open) {
      loadStatus()
      const interval = setInterval(loadStatus, 30000) // Refresh every 30s
      return () => clearInterval(interval)
    }
  }, [open])

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/dev/deployment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github: {
            token: process.env.NEXT_PUBLIC_GITHUB_TOKEN,
            owner: 'your-org',
            repo: 'your-repo',
          },
          healthEndpoints: [
            'http://localhost:3000/api/health',
          ],
        }),
      })

      const data = await res.json()
      if (data.result) {
        setDeployments(data.result.deployments || [])
        setHealth(data.result.health || [])
        setOverallStatus(data.result.overallStatus)
      }
    } catch (err) {
      console.error('Failed to load deployment status:', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-400" />
      case 'failure':
        return <AlertCircle className="w-5 h-5 text-red-400" />
      case 'running':
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-400" />
      default:
        return <Activity className="w-5 h-5 text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-400'
      case 'healthy':
        return 'text-green-400'
      case 'failure':
        return 'text-red-400'
      case 'unhealthy':
        return 'text-red-400'
      case 'running':
      case 'pending':
        return 'text-yellow-400'
      default:
        return 'text-gray-400'
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Deployment Status</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Status Bar */}
        <div className="p-4 border-b border-gray-700 bg-gray-900">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Overall Status</span>
            <span className={`text-sm font-semibold ${getStatusColor(overallStatus)}`}>
              {overallStatus.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : (
            <div className="space-y-6">
              {/* Deployments */}
              {deployments.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    Deployments
                  </h3>
                  <div className="space-y-2">
                    {deployments.map((deployment, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3 bg-gray-800 rounded"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(deployment.status)}
                          <div>
                            <p className="text-white text-sm capitalize">
                              {deployment.platform}
                            </p>
                            {deployment.url && (
                              <a
                                href={deployment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:underline"
                              >
                                View
                              </a>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs font-medium ${getStatusColor(deployment.status)}`}>
                          {deployment.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Health Checks */}
              {health.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    Health Checks
                  </h3>
                  <div className="space-y-2">
                    {health.map((check, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3 bg-gray-800 rounded"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(check.status)}
                          <div>
                            <p className="text-white text-sm truncate">
                              {check.endpoint}
                            </p>
                            {check.responseTime && (
                              <p className="text-xs text-gray-400">
                                {check.responseTime}ms
                              </p>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs font-medium ${getStatusColor(check.status)}`}>
                          {check.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deployments.length === 0 && health.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  No deployments configured
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
          Updates every 30 seconds
        </div>
      </div>
    </div>
  )
}
