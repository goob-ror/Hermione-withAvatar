import path from 'path'
import { grantedFolders, isInsideGrantedFolder } from '@/lib/permissions/store'

/**
 * Root lock: every filesystem tool resolves its path through here and is
 * refused if the result escapes AGENT_ROOT (defaults to the project root).
 * Traversal (`..`), absolute paths outside the root, and sibling-prefix tricks
 * (`root-evil/` for `root/`) all fail the relative-path check.
 *
 * Folders the operator explicitly granted in the permissions modal are the one
 * sanctioned exception — resolved by absolute path only, so a granted folder
 * can never be reached by a relative traversal out of the root.
 */
export function agentRoot(): string {
  // turbopackIgnore: the agent root is runtime state, never a build input.
  return path.resolve(/* turbopackIgnore: true */ process.env.AGENT_ROOT || process.cwd())
}

/** Resolve strictly inside the root. Throws on escape. */
export function resolveInRoot(input: string): string {
  const root = agentRoot()
  const raw = (input ?? '.').trim() || '.'
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
  const rel = path.relative(root, abs)

  if (rel === '') return root
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes agent root (${root}): ${input}`)
  }
  return abs
}

/**
 * Resolve a path that may live in the root OR in a folder the operator granted.
 * Used by the read/write tools so an approved folder is genuinely reachable,
 * while everything else still fails the root lock.
 */
export function resolveAllowed(input: string, opts: { need?: 'read' | 'write' } = {}): string {
  const raw = (input ?? '.').trim() || '.'

  try {
    const inRoot = resolveInRoot(raw)
    if (opts.need === 'write') {
      if (isInsideGrantedFolder(inRoot).mode === 'read') {
        throw new Error(`${raw} is granted read-only — ask the operator to allow writes in the permissions modal`)
      }
    }
    return inRoot
  } catch (err) {
    if (!path.isAbsolute(raw)) throw err
  }

  const abs = path.normalize(raw)
  const grant = isInsideGrantedFolder(abs)
  if (!grant.allowed) {
    throw new Error(
      `path is outside the agent root and no folder grant covers it: ${raw}. ` +
        'The operator must add it in the permissions modal first.',
    )
  }
  if (opts.need === 'write' && grant.mode !== 'write') {
    throw new Error(`${raw} is granted read-only — ask the operator to allow writes in the permissions modal`)
  }
  return abs
}

/** Display form used in tool output — relative to root, or absolute if granted. */
export function displayPath(abs: string): string {
  const rel = path.relative(agentRoot(), abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    const grant = isInsideGrantedFolder(abs)
    return grant.allowed ? `${abs} (granted${grant.mode === 'read' ? ', read-only' : ''})` : abs
  }
  return rel.split(path.sep).join('/')
}

/** Every directory the agent may touch, for the prompt and diagnostics. */
export function reachableRoots(): string[] {
  return [agentRoot(), ...grantedFolders().map((f) => f.path)]
}
