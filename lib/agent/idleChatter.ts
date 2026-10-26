/**
 * Idle Chatter Subagent
 *
 * Runs in parallel while the main agent thinks. Emits brief, character-consistent
 * remarks and poses based on SOUL.md. These are surfaced to the UI as overlays
 * while the avatar is in 'focused' state.
 *
 * Remarks:
 * - Random interval: 2-8 seconds
 * - Character: pulled from SOUL.md "Idle Chatter & Thinking Commentary"
 * - Avatar pose: matched to the remark (lookupPoseForRemark)
 *
 * Start on mainAgent 'focused' → stop when mainAgent moves to 'idle' or 'alert'.
 */

const THINKING_PHRASES = [
  'Just a second…',
  'Let me think about that.',
  'Hmm, working it out…',
  'One moment.',
  'Parsing that now.',
  'Hang tight.',
  'Still here, still thinking.',
  'Turning that over in my head…',
]

const POSE_MAP: Record<string, { pose: string; mood: string }> = {
  'Just a second…': { pose: 'glance_up', mood: 'curious' },
  'Let me think about that.': { pose: 'eyes_closed', mood: 'thoughtful' },
  'Hmm, working it out…': { pose: 'squint', mood: 'concentrating' },
  'One moment.': { pose: 'held_still', mood: 'attentive' },
  'Parsing that now.': { pose: 'forward_alert', mood: 'processing' },
  'Hang tight.': { pose: 'relaxed', mood: 'patient' },
  'Still here, still thinking.': { pose: 'sway', mood: 'engaged' },
  'Turning that over in my head…': { pose: 'tilted_head', mood: 'thoughtful' },
}

interface IdleChatterEvent {
  type: 'remark'
  text: string
  pose: string
  mood: string
  durationMs: number
}

/**
 * Start the idle chatter loop. Yields remarks at random intervals.
 * Stop by setting `shouldStop.value = true`.
 */
export async function* idleChatterLoop(shouldStop: { value: boolean }) {
  while (!shouldStop.value) {
    // Random delay: 2–8 seconds
    const delayMs = Math.random() * 6000 + 2000
    await new Promise((r) => setTimeout(r, delayMs))

    if (shouldStop.value) break

    // Pick a random phrase
    const remark = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]
    const { pose, mood } = POSE_MAP[remark] || { pose: 'neutral', mood: 'idle' }

    yield {
      type: 'remark',
      text: remark,
      pose,
      mood,
      durationMs: 1500 + Math.random() * 1500, // 1.5–3s display time
    } as IdleChatterEvent
  }
}