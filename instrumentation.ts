/**
 * Runs once when the Next server starts (`npm run dev` / `npm start`).
 * Starts Hermione's VoxCPM2 voice service, adds her recommended default
 * capabilities (first run only), and starts her enabled connectors (MCP
 * servers) — all in the background; they stop with the server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { ensureVox } = await import('./lib/tts/voxcpm')
  ensureVox().catch((err) => console.error('[voxcpm] could not start:', err))
  const { ensureDefaults } = await import('./lib/capabilities/defaults')
  const { ensureConnectors } = await import('./lib/capabilities/connectors')
  ensureDefaults()
    .catch((err) => console.error('[capabilities] defaults:', err))
    .then(() => ensureConnectors())
    .catch((err) => console.error('[connectors] could not start:', err))
}
