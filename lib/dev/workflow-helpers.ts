/**
 * Development Workflow Helpers
 * 
 * Generates:
 * - PR templates with checklist
 * - Issue templates for bugs/features
 * - Commit message templates
 * - Pre-commit hooks setup
 * - Development guidelines
 */

export interface PRTemplate {
  title: string
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'test' | 'perf'
  description: string
  relatedIssue?: number
  checklist: string[]
  breaking: boolean
}

export interface IssueTemplate {
  type: 'bug' | 'feature' | 'question'
  title: string
  description: string
  labels?: string[]
  assignee?: string
}

/**
 * Generate PR template markdown
 */
export function generatePRTemplate(pr: PRTemplate): string {
  let template = `# ${pr.title}\n\n`

  template += `## Type\n${pr.type}\n\n`

  template += `## Description\n${pr.description}\n\n`

  if (pr.relatedIssue) {
    template += `## Related Issue\nFixes #${pr.relatedIssue}\n\n`
  }

  template += `## Checklist\n\n`
  pr.checklist.forEach(item => {
    template += `- [ ] ${item}\n`
  })
  template += `\n`

  if (pr.breaking) {
    template += `## ⚠️ Breaking Changes\nThis PR introduces breaking changes. Please ensure:\n`
    template += `- [ ] Migration guide is documented\n`
    template += `- [ ] Version bump is appropriate\n`
    template += `- [ ] Changelog is updated\n\n`
  }

  return template
}

/**
 * Generate GitHub PR template file content
 */
export function generateGitHubPRTemplate(): string {
  return `## Description
Please include a summary of the changes and related context.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issue
Fixes #(issue)

## How Has This Been Tested?
Please describe the tests that you ran to verify your changes.

## Checklist
- [ ] My code follows the project's code style
- [ ] I have self-reviewed my code
- [ ] I have commented complex areas of my code
- [ ] I have made corresponding changes to documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix/feature works
`
}

/**
 * Generate GitHub issue templates
 */
export function generateBugIssueTemplate(): string {
  return `---
name: Bug Report
about: Report a bug to help us improve
title: '[BUG] '
labels: 'bug'
---

## Description
A clear and concise description of what the bug is.

## Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What you expected to happen.

## Actual Behavior
What actually happened.

## Screenshots
If applicable, add screenshots.

## Environment
- OS: [e.g. macOS, Windows, Linux]
- Node.js version: [e.g. 18.0.0]
- Package version: [e.g. 0.6.0]

## Additional Context
Add any other context about the problem here.
`
}

export function generateFeatureIssueTemplate(): string {
  return `---
name: Feature Request
about: Suggest an idea for this project
title: '[FEATURE] '
labels: 'enhancement'
---

## Description
A clear and concise description of what the feature is.

## Problem Statement
What problem does this feature solve?

## Proposed Solution
How should this feature work?

## Alternative Solutions
Are there alternative approaches?

## Additional Context
Add any other context or screenshots about the feature request.
`
}

/**
 * Generate conventional commit template
 */
export function generateCommitTemplate(): string {
  return `# <type>(<scope>): <subject>
#
# <body>
#
# <footer>
#
# type: feat, fix, docs, style, refactor, perf, test, chore, ci
# scope: component or feature affected
# subject: imperative, lowercase, no period, max 50 chars
# body: explain what and why, wrap at 72 chars
# footer: reference issues (Fixes #123, Closes #456)
`
}

/**
 * Generate pre-commit hook script
 */
export function generatePreCommitHook(): string {
  return `#!/bin/bash

# Pre-commit hook - run linting and tests before commit

echo "🔍 Running pre-commit checks..."

# Run linter
echo "📝 Linting files..."
npm run lint --quiet
if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Please fix errors before committing."
  exit 1
fi

# Run typecheck
echo "🔎 Type checking..."
npm run typecheck
if [ $? -ne 0 ]; then
  echo "❌ Type check failed. Please fix errors before committing."
  exit 1
fi

# Run tests
echo "✅ Running tests..."
npm run test --watch=false --passWithNoTests 2>/dev/null
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Please fix errors before committing."
  exit 1
fi

echo "✨ All checks passed! Commit proceeding..."
exit 0
`
}

/**
 * Generate development guidelines
 */
export function generateDevelopmentGuidelines(projectName: string): string {
  return `# ${projectName} Development Guidelines

## Code Style
- Use TypeScript for all code
- Follow ESLint configuration
- Use Prettier for formatting
- Max line length: 100 characters
- Use meaningful variable names

## Commit Messages
Use conventional commits:
- \`feat:\` New feature
- \`fix:\` Bug fix
- \`docs:\` Documentation
- \`style:\` Code style (no logic change)
- \`refactor:\` Refactor (no feature/bug change)
- \`perf:\` Performance improvement
- \`test:\` Test addition/modification
- \`chore:\` Build/dependency changes

Example: \`feat(api): add user authentication endpoint\`

## Pull Request Process
1. Create feature branch: \`git checkout -b feat/feature-name\`
2. Make changes and commit with conventional messages
3. Push to remote: \`git push origin feat/feature-name\`
4. Open PR with description and linked issues
5. Address review comments
6. Wait for CI/CD to pass
7. Squash commits if needed
8. Merge when approved

## Testing
- Write tests for new features
- Maintain >80% code coverage
- Run \`npm run test\` before committing
- Test edge cases and error scenarios

## Documentation
- Update README for new features
- Document API changes
- Add JSDoc comments for complex functions
- Keep CHANGELOG.md updated

## Code Review
- Respond to feedback promptly
- Explain rationale for decisions
- Be respectful and constructive
- Learn from suggestions

## Performance
- Use RTK compression for large outputs
- Optimize database queries
- Cache frequently accessed data
- Monitor bundle size

## Security
- Never commit secrets or API keys
- Validate user input
- Use parameterized queries
- Follow OWASP guidelines
`
}

/**
 * Generate workflow automation config (GitHub Actions)
 */
export function generateGitHubActionsConfig(): string {
  return `name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run test

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - name: Deploy
        if: github.ref == 'refs/heads/main'
        run: npm run deploy
`
}

/**
 * Generate complete workflow setup
 */
export function generateCompleteWorkflow(projectName: string): Record<string, string> {
  return {
    'DEVELOPMENT.md': generateDevelopmentGuidelines(projectName),
    'COMMIT_TEMPLATE': generateCommitTemplate(),
    'pre-commit-hook.sh': generatePreCommitHook(),
    '.github/workflows/ci.yml': generateGitHubActionsConfig(),
    '.github/pull_request_template.md': generateGitHubPRTemplate(),
    '.github/ISSUE_TEMPLATE/bug.md': generateBugIssueTemplate(),
    '.github/ISSUE_TEMPLATE/feature.md': generateFeatureIssueTemplate(),
  }
}

/**
 * Generate project setup checklist
 */
export function generateSetupChecklist(): string {
  return `# Project Setup Checklist

## Initial Setup
- [ ] Clone repository
- [ ] Install dependencies: \`npm install\`
- [ ] Copy \`.env.example\` to \`.env.local\`
- [ ] Configure environment variables
- [ ] Run migrations/setup: \`npm run setup\`

## Development Environment
- [ ] Install Node.js 18+
- [ ] Install recommended VS Code extensions
- [ ] Configure Git hooks: \`npm run setup-hooks\`
- [ ] Set up Git config: \`git config user.name\` and \`git config user.email\`

## Local Testing
- [ ] Run: \`npm run dev\`
- [ ] Run tests: \`npm run test\`
- [ ] Run linter: \`npm run lint\`
- [ ] Run type check: \`npm run typecheck\`

## Documentation
- [ ] Read README.md
- [ ] Read DEVELOPMENT.md
- [ ] Read relevant architecture docs
- [ ] Review API documentation

## Pre-Commit
- [ ] Set up pre-commit hooks
- [ ] Verify git hooks are executable
- [ ] Test hook functionality

## Ready to Code!
- [ ] Create feature branch
- [ ] Start developing
- [ ] Commit with conventional messages
- [ ] Push and open PR
`
}
