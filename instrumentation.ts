/**
 * Runs once when the Next server starts (`npm run dev` / `npm start`).
 * Starts Hermione's VoxCPM2 voice service in the background so it's loaded
 * before she first speaks; it stops with the server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { ensureVox } = await import('./lib/tts/voxcpm')
  ensureVox().catch((err) => console.error('[voxcpm] could not start:', err))
}
