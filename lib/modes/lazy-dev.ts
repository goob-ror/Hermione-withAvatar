/**
 * Lazy Senior Dev Mode — YAGNI-first coding assistant
 * 
 * Detects code-related tasks and offers to enable a minimal-code bias:
 * - YAGNI (You Ain't Gonna Need It)
 * - Reuse stdlib over adding dependencies
 * - Deletion over addition
 * - Simplify existing code instead of adding features
 */

export interface LazyDevSettings {
  mode: 'auto' | 'always' | 'never'
  sessionAsked: boolean // Track if we've asked this session
  sessionEnabled: boolean // Current session state
}

const CODE_KEYWORDS = [
  'code', 'refactor', 'implement', 'debug', 'fix', 'optimize',
  'PR', 'pull request', 'commit', 'review', 'function', 'class',
  'method', 'bug', 'error', 'test', 'deploy', 'build', 'compile',
  'algorithm', 'architecture', 'design pattern', 'API', 'endpoint'
]

export function detectCodeTask(message: string): boolean {
  const lower = message.toLowerCase()
  return CODE_KEYWORDS.some(keyword => lower.includes(keyword))
}

export function shouldAskLazyMode(settings: LazyDevSettings, userMessage: string): boolean {
  // Never ask if mode is 'always' or 'never'
  if (settings.mode !== 'auto') return false
  
  // Don't ask twice in same session
  if (settings.sessionAsked) return false
  
  // Ask if message contains code task
  return detectCodeTask(userMessage)
}

export function getLazyDevPrompt(): string {
  return `
# LAZY SENIOR DEV MODE ACTIVE

Apply minimal-code philosophy:

**YAGNI (You Ain't Gonna Need It)**
- Don't add features unless explicitly requested
- Remove unused code aggressively
- Simplify over-engineered solutions

**Stdlib First**
- Use built-in libraries before adding dependencies
- Avoid npm/pip packages unless necessary
- Standard library is fast, tested, and stable

**Deletion > Addition**
- Can this be solved by removing code?
- Merge duplicate logic
- Inline one-use abstractions

**Concrete over Abstract**
- No premature generalization
- Write specific solutions first
- Extract patterns only after 3+ repetitions

**Show, Don't Tell**
- Provide working code, minimal explanation
- Assume the developer understands basics
- Focus on the non-obvious parts

When given a code task:
1. Look for code to DELETE first
2. Check if stdlib solves it
3. Write the minimal version
4. Stop when it works
`.trim()
}

export function formatLazyModePromptMessage(): string {
  return `🧑‍💻 **Code task detected**

Enable **Lazy Senior Dev Mode**? (YAGNI, stdlib-first, minimal code)

This mode biases toward:
• Deleting code over adding
• Using stdlib over dependencies  
• Simplifying over complexity

You can toggle this anytime in Settings.`
}
