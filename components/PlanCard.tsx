'use client'

import { Check } from 'lucide-react'

export interface PlanItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Hermione's live task checklist: a spinner on the step she's working on,
 * a dashed circle for steps to come, a check for finished ones.
 * `live` = the run is still going (otherwise an in-progress step stops spinning).
 */
export function PlanCard({ items, live }: { items: PlanItem[]; live: boolean }) {
  const done = items.filter((i) => i.status === 'completed').length
  return (
    <div className="plan-card" role="list" aria-label={`Plan: ${done} of ${items.length} steps done`}>
      {items.map((it, i) => (
        <div key={`${i}-${it.content}`} role="listitem" className={`plan-item is-${it.status}`}>
          <span className="plan-mark" aria-hidden>
            {it.status === 'completed' ? (
              <Check className="size-3" strokeWidth={3} />
            ) : it.status === 'in_progress' && live ? (
              <span className="plan-spinner" />
            ) : null}
          </span>
          <span className="plan-text">{it.content}</span>
          <span className="sr-only">
            {it.status === 'completed' ? '(done)' : it.status === 'in_progress' ? '(in progress)' : '(to do)'}
          </span>
        </div>
      ))}
    </div>
  )
}
