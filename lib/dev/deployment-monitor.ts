/**
 * Deployment Monitor - Track CI/CD status, deployment health
 * 
 * Monitors:
 * - GitHub Actions workflows
 * - Vercel deployments
 * - Railway deployments
 * - Docker container status
 * - Health endpoints
 */

import https from 'https'
import http from 'http'

export interface DeploymentStatus {
  platform: 'github' | 'vercel' | 'railway' | 'docker' | 'custom'
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled'
  url?: string
  startedAt?: string
  completedAt?: string
  duration?: number
  logs?: string
}

export interface HealthCheck {
  endpoint: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTime?: number
  statusCode?: number
  error?: string
}

/**
 * Check GitHub Actions workflow status
 */
export async function checkGitHubWorkflow(
  token: string,
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<DeploymentStatus | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=1`,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'Hermione-AI',
        Accept: 'application/vnd.github.v3+json',
      },
    }

    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed.workflow_runs || parsed.workflow_runs.length === 0) {
            resolve(null)
            return
          }

          const run = parsed.workflow_runs[0]
          resolve({
            platform: 'github',
            status: run.status === 'completed' ? run.conclusion : run.status,
            url: run.html_url,
            startedAt: run.created_at,
            completedAt: run.updated_at,
            duration: run.run_duration_ms,
          })
        } catch (err) {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Check Vercel deployment status
 */
export async function checkVercelDeployment(
  token: string,
  projectId: string
): Promise<DeploymentStatus | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.vercel.com',
      path: `/v6/deployments?projectId=${projectId}&limit=1`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }

    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed.deployments || parsed.deployments.length === 0) {
            resolve(null)
            return
          }

          const deployment = parsed.deployments[0]
          resolve({
            platform: 'vercel',
            status: deployment.state === 'READY' ? 'success' : deployment.state.toLowerCase(),
            url: deployment.url ? `https://${deployment.url}` : undefined,
            startedAt: new Date(deployment.created).toISOString(),
            completedAt: deployment.ready ? new Date(deployment.ready).toISOString() : undefined,
          })
        } catch (err) {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Check Railway deployment status
 */
export async function checkRailwayDeployment(
  token: string,
  projectId: string,
  environmentId: string
): Promise<DeploymentStatus | null> {
  return new Promise((resolve) => {
    const query = `
      query {
        deployments(input: {
          projectId: "${projectId}",
          environmentId: "${environmentId}"
        }) {
          edges {
            node {
              id
              status
              url
              createdAt
              updatedAt
            }
          }
        }
      }
    `

    const postData = JSON.stringify({ query })

    const options = {
      hostname: 'backboard.railway.app',
      path: '/graphql/v2',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const edges = parsed.data?.deployments?.edges
          if (!edges || edges.length === 0) {
            resolve(null)
            return
          }

          const deployment = edges[0].node
          resolve({
            platform: 'railway',
            status: deployment.status.toLowerCase(),
            url: deployment.url,
            startedAt: deployment.createdAt,
            completedAt: deployment.updatedAt,
          })
        } catch (err) {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.write(postData)
    req.end()
  })
}

/**
 * Check health endpoint
 */
export async function checkHealthEndpoint(
  endpoint: string,
  timeout: number = 5000
): Promise<HealthCheck> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const url = new URL(endpoint)
    const protocol = url.protocol === 'https:' ? https : http

    const req = protocol.get(endpoint, (res) => {
      const responseTime = Date.now() - startTime
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        resolve({
          endpoint,
          status: res.statusCode === 200 ? 'healthy' : 'unhealthy',
          responseTime,
          statusCode: res.statusCode,
        })
      })
    })

    req.setTimeout(timeout, () => {
      req.destroy()
      resolve({
        endpoint,
        status: 'unhealthy',
        error: 'Timeout',
      })
    })

    req.on('error', (err) => {
      resolve({
        endpoint,
        status: 'unhealthy',
        error: err.message,
      })
    })
  })
}

/**
 * Monitor multiple deployments
 */
export async function monitorAllDeployments(config: {
  github?: { token: string; owner: string; repo: string; branch?: string }
  vercel?: { token: string; projectId: string }
  railway?: { token: string; projectId: string; environmentId: string }
  healthEndpoints?: string[]
}): Promise<{
  deployments: DeploymentStatus[]
  health: HealthCheck[]
  overallStatus: 'healthy' | 'degraded' | 'down'
}> {
  const deployments: DeploymentStatus[] = []
  const health: HealthCheck[] = []

  // Check GitHub
  if (config.github) {
    const status = await checkGitHubWorkflow(
      config.github.token,
      config.github.owner,
      config.github.repo,
      config.github.branch
    )
    if (status) deployments.push(status)
  }

  // Check Vercel
  if (config.vercel) {
    const status = await checkVercelDeployment(config.vercel.token, config.vercel.projectId)
    if (status) deployments.push(status)
  }

  // Check Railway
  if (config.railway) {
    const status = await checkRailwayDeployment(
      config.railway.token,
      config.railway.projectId,
      config.railway.environmentId
    )
    if (status) deployments.push(status)
  }

  // Check health endpoints
  if (config.healthEndpoints) {
    for (const endpoint of config.healthEndpoints) {
      const check = await checkHealthEndpoint(endpoint)
      health.push(check)
    }
  }

  // Determine overall status
  let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy'

  const hasFailures = deployments.some(d => d.status === 'failure')
  const hasUnhealthy = health.some(h => h.status === 'unhealthy')

  if (hasFailures || hasUnhealthy) {
    overallStatus = health.every(h => h.status === 'unhealthy') ? 'down' : 'degraded'
  }

  return { deployments, health, overallStatus }
}

/**
 * Format status report
 */
export function formatStatusReport(result: {
  deployments: DeploymentStatus[]
  health: HealthCheck[]
  overallStatus: string
}): string {
  let report = `# Deployment Status\n\n`

  report += `**Overall**: ${result.overallStatus.toUpperCase()}\n\n`

  if (result.deployments.length > 0) {
    report += `## Deployments\n\n`
    result.deployments.forEach(d => {
      const icon = d.status === 'success' ? '✅' : d.status === 'failure' ? '❌' : '🔄'
      report += `- ${icon} **${d.platform}**: ${d.status}`
      if (d.url) report += ` ([View](${d.url}))`
      report += `\n`
    })
    report += `\n`
  }

  if (result.health.length > 0) {
    report += `## Health Checks\n\n`
    result.health.forEach(h => {
      const icon = h.status === 'healthy' ? '✅' : '❌'
      report += `- ${icon} ${h.endpoint}`
      if (h.responseTime) report += ` (${h.responseTime}ms)`
      if (h.error) report += ` - ${h.error}`
      report += `\n`
    })
    report += `\n`
  }

  return report
}
