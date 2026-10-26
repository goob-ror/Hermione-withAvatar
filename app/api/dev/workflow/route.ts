import { NextRequest, NextResponse } from 'next/server'
import {
  generatePRTemplate,
  generateGitHubPRTemplate,
  generateBugIssueTemplate,
  generateFeatureIssueTemplate,
  generateCommitTemplate,
  generatePreCommitHook,
  generateDevelopmentGuidelines,
  generateGitHubActionsConfig,
  generateCompleteWorkflow,
  generateSetupChecklist,
} from '@/lib/dev/workflow-helpers'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'pr-template') {
      const template = generateGitHubPRTemplate()
      return NextResponse.json({ success: true, content: template })
    }

    if (action === 'bug-template') {
      const template = generateBugIssueTemplate()
      return NextResponse.json({ success: true, content: template })
    }

    if (action === 'feature-template') {
      const template = generateFeatureIssueTemplate()
      return NextResponse.json({ success: true, content: template })
    }

    if (action === 'commit-template') {
      const template = generateCommitTemplate()
      return NextResponse.json({ success: true, content: template })
    }

    if (action === 'pre-commit-hook') {
      const script = generatePreCommitHook()
      return NextResponse.json({ success: true, content: script })
    }

    if (action === 'github-actions') {
      const config = generateGitHubActionsConfig()
      return NextResponse.json({ success: true, content: config })
    }

    if (action === 'setup-checklist') {
      const checklist = generateSetupChecklist()
      return NextResponse.json({ success: true, content: checklist })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Workflow helpers GET error:', err)
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const body = await req.json()

    if (action === 'custom-pr') {
      const pr = generatePRTemplate(body)
      return NextResponse.json({ success: true, content: pr })
    }

    if (action === 'dev-guidelines') {
      const { projectName } = body
      if (!projectName) {
        return NextResponse.json({ error: 'Missing projectName' }, { status: 400 })
      }
      const guidelines = generateDevelopmentGuidelines(projectName)
      return NextResponse.json({ success: true, content: guidelines })
    }

    if (action === 'complete-workflow') {
      const { projectName } = body
      if (!projectName) {
        return NextResponse.json({ error: 'Missing projectName' }, { status: 400 })
      }
      const workflow = generateCompleteWorkflow(projectName)
      return NextResponse.json({ success: true, files: workflow })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Workflow helpers POST error:', err)
    return NextResponse.json({ error: 'Failed to generate workflow' }, { status: 500 })
  }
}
