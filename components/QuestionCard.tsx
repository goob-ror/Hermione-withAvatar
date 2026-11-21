'use client'

import { useId, useState } from 'react'
import { CircleHelp, CornerDownLeft } from 'lucide-react'

export interface QuestionData {
  callId: string
  question: string
  options: { label: string; description?: string }[]
  multiple: boolean
  allowOther: boolean
  /** Set once answered (or skipped) — the card then shows the answer only. */
  answer?: { choices: string[]; other?: string } | 'skipped'
}

/**
 * Hermione's multiple-choice question: radio buttons (or checkboxes when
 * several may be picked), an optional "Other" box, then Submit or Skip.
 */
export function QuestionCard({
  q,
  busy,
  onAnswer,
  eyebrow,
  subtitle,
  submitLabel = 'Submit',
  skipLabel = 'Skip',
  chatHint = true,
}: {
  q: QuestionData
  busy: boolean
  onAnswer: (q: QuestionData, answer: { choices: string[]; other?: string } | 'skipped') => void
  /** Small label above the question (default "Hermione asks"). */
  eyebrow?: string
  /** One line under the question. */
  subtitle?: string
  submitLabel?: string
  skipLabel?: string
  /** Show "or just reply in the chat" (only true for ask_user). */
  chatHint?: boolean
}) {
  const name = useId()
  const [picked, setPicked] = useState<string[]>([])
  const [otherOn, setOtherOn] = useState(false)
  const [other, setOther] = useState('')

  if (q.answer) {
    const summary =
      q.answer === 'skipped'
        ? 'Skipped'
        : [...q.answer.choices, ...(q.answer.other ? [q.answer.other] : [])].join(', ')
    return (
      <div className="question-resolved">
        <CircleHelp className="size-4" />
        <span className="q">{q.question}</span>
        <span className="a">{summary}</span>
      </div>
    )
  }

  const toggle = (label: string) => {
    if (q.multiple) {
      setPicked((p) => (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]))
    } else {
      setPicked([label])
      setOtherOn(false)
    }
  }

  const pickOther = () => {
    if (q.multiple) setOtherOn((on) => !on)
    else {
      setPicked([])
      setOtherOn(true)
    }
  }

  const otherText = otherOn ? other.trim() : ''
  const ready = picked.length > 0 || otherText.length > 0

  const submit = () => {
    if (!ready || busy) return
    onAnswer(q, { choices: picked, ...(otherText ? { other: otherText } : {}) })
  }

  return (
    <form
      className="question-card"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="question-head">
        <CircleHelp className="size-4" />
        <div>
          <span className="eyebrow">{eyebrow ?? (q.multiple ? 'Hermione asks · pick any' : 'Hermione asks')}</span>
          <strong>{q.question}</strong>
          {subtitle && <span className="question-sub">{subtitle}</span>}
        </div>
      </div>

      <div className="question-options" role={q.multiple ? 'group' : 'radiogroup'} aria-label={q.question}>
        {q.options.map((o) => (
          <label key={o.label} className={`question-option ${picked.includes(o.label) ? 'is-on' : ''}`}>
            <input
              type={q.multiple ? 'checkbox' : 'radio'}
              name={name}
              checked={picked.includes(o.label)}
              disabled={busy}
              onChange={() => toggle(o.label)}
            />
            <span>
              <span className="label">{o.label}</span>
              {o.description && <span className="desc">{o.description}</span>}
            </span>
          </label>
        ))}
        {q.allowOther && (
          <label className={`question-option ${otherOn ? 'is-on' : ''}`}>
            <input
              type={q.multiple ? 'checkbox' : 'radio'}
              name={name}
              checked={otherOn}
              disabled={busy}
              onChange={pickOther}
            />
            <span className="grow">
              <span className="label">Other</span>
              {otherOn && (
                <input
                  className="question-other"
                  autoFocus
                  value={other}
                  maxLength={2000}
                  placeholder="Type your answer"
                  disabled={busy}
                  onChange={(e) => setOther(e.target.value)}
                />
              )}
            </span>
          </label>
        )}
      </div>

      <div className="question-actions">
        <span className="hint">
          {chatHint && (
            <>
              or just reply in the chat <CornerDownLeft className="size-3" />
            </>
          )}
        </span>
        <button type="button" className="button button-quiet" disabled={busy} onClick={() => onAnswer(q, 'skipped')}>
          {skipLabel}
        </button>
        <button type="submit" className="button button-approve" disabled={busy || !ready}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
