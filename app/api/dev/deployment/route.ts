import { NextRequest, NextResponse } from 'next/server'
import {
  checkGitHubWorkflow,
  checkVercelDeployment,
  checkRailwayDeployment,
  checkHealthEndpoint,
  monitorAllDeployments,
  formatStatusReport,
} from '@/lib/dev/deployment-monitor'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'github') {
      const token = req.nextUrl.searchParams.get('token')
      const owner = req.nextUrl.searchParams.get('owner')
      const repo = req.nextUrl.searchParams.get('repo')
      const branch = req.nextUrl.searchParams.get('branch') || 'main'

      if (!token || !owner || !repo) {
        return NextResponse.json({ error: 'Missing required params' }, { status: 400 })
      }

      const status = await checkGitHubWorkflow(token, owner, repo, branch)
      return NextResponse.json({ status })
    }

    if (action === 'vercel') {
      const token = req.nextUrl.searchParams.get('token')
      const projectId = req.nextUrl.searchParams.get('projectId')

      if (!token || !projectId) {
        return NextResponse.json({ error: 'Missing required params' }, { status: 400 })
      }

      const status = await checkVercelDeployment(token, projectId)
      return NextResponse.json({ status })
    }

    if (action === 'railway') {
      const token = req.nextUrl.searchParams.get('token')
      const projectId = req.nextUrl.searchParams.get('projectId')
      const environmentId = req.nextUrl.searchParams.get('environmentId')

      if (!token || !projectId || !environmentId) {
        return NextResponse.json({ error: 'Missing required params' }, { status: 400 })
      }

      const status = await checkRailwayDeployment(token, projectId, environmentId)
      return NextResponse.json({ status })
    }

    if (action === 'health') {
      const endpoint = req.nextUrl.searchParams.get('endpoint')

      if (!endpoint) {
        return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
      }

      const health = await checkHealthEndpoint(endpoint)
      return NextResponse.json({ health })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Deployment monitor error:', err)
    return NextResponse.json({ error: 'Failed to check deployment' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'monitor-all') {
      const config = await req.json()
      const result = await monitorAllDeployments(config)
      const report = formatStatusReport(result)
      
      return NextResponse.json({ 
        success: true, 
        result,
        report 
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Deployment monitor POST error:', err)
    return NextResponse.json({ error: 'Failed to monitor deployments' }, { status: 500 })
  }
}
