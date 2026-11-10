import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Parse and validate a JSON request body.
 *
 *   const parsed = await parseBody(req, Schema)
 *   if (!parsed.ok) return parsed.response   // 400 with field-level messages
 *   parsed.data                              // fully typed
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) }
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    return { ok: false, response: NextResponse.json({ error: 'invalid request', issues }, { status: 400 }) }
  }
  return { ok: true, data: result.data }
}

/** Trimmed, non-empty string with a sane length cap. */
export const id = (max = 200) => z.string().trim().min(1).max(max)

export const ThinkingEffort = z.enum(['off', 'low', 'medium', 'high'])
export const Mode = z.enum(['chat', 'forge'])
