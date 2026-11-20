'use client'

import { QuestionCard, type QuestionData } from '@/components/QuestionCard'
import { REASONS, type ReasonId } from '@/lib/feedback/reasons'

/**
 * The form that opens under a reply after 👎: what went wrong (pick any, or
 * Other with your own words). Same look as Hermione's ask_user card.
 */
export function ReplyFeedback({
  replyKey,
  onSubmit,
  onClose,
}: {
  replyKey: string
  onSubmit: (reasons: ReasonId[], other?: string) => void
  onClose: () => void
}) {
  const q: QuestionData = {
    callId: `feedback-${replyKey}`,
    question: 'What went wrong with this answer?',
    options: REASONS.map((r) => ({ label: r.label })),
    multiple: true,
    allowOther: true,
  }
  return (
    <QuestionCard
      q={q}
      busy={false}
      eyebrow="Feedback · pick any"
      subtitle="Hermione proposes a lesson when the same problem comes up twice. You approve it in the Memory Bank."
      submitLabel="Send feedback"
      skipLabel="Not now"
      chatHint={false}
      onAnswer={(_, answer) => {
        if (answer === 'skipped') return onClose()
        const reasons = answer.choices
          .map((label) => REASONS.find((r) => r.label === label)?.id)
          .filter((id): id is ReasonId => !!id)
        onSubmit(reasons, answer.other)
      }}
    />
  )
}
