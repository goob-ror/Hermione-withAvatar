'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { FolderOpen, History } from 'lucide-react'

interface Suggestion {
  path: string
  name: string
  recent: boolean
}

/** The "@…" being typed right before the caret, if any. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = before.match(/(?:^|\s)@("[^"]*|[^\s"]*)$/)
  if (!m) return null
  return { start: caret - m[1].length - 1, query: m[1].replace(/^"/, '') }
}

/** What to insert for a picked folder: quoted when it has spaces. */
export const mentionText = (p: string) => (/\s/.test(p) ? `@"${p}" ` : `@${p} `)

/**
 * The composer's @ folder menu: type "@" and part of a folder name or path;
 * pick a folder and Hermione works in it for this session. Returns the menu to
 * render (positioned above the box) and a keydown handler to call first.
 */
export function useFolderMention(value: string, setValue: (v: string) => void, ref: RefObject<HTMLTextAreaElement | null>) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow the caret: open the menu while an "@…" is being typed.
  useEffect(() => {
    const el = ref.current
    const m = el ? mentionAtCaret(value, el.selectionStart ?? value.length) : null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the text box
    setMention(m)
  }, [value, ref])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!mention) return
    timer.current = setTimeout(() => {
      fetch(`/api/workspace?q=${encodeURIComponent(mention.query)}`)
        .then((r) => r.json())
        .then((d) => {
          setItems(Array.isArray(d.suggestions) ? d.suggestions : [])
          setActive(0)
        })
        .catch(() => setItems([]))
    }, 140)
  }, [mention])

  const open = !!mention && items.length > 0

  const pick = (s: Suggestion) => {
    if (!mention) return
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const next = `${value.slice(0, mention.start)}${mentionText(s.path)}${value.slice(caret)}`
    setValue(next)
    setMention(null)
    setItems([])
    requestAnimationFrame(() => {
      const pos = mention.start + mentionText(s.path).length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  /** Call first in the box's onKeyDown; true = the menu used the key. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(items[active])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setItems([])
      return true
    }
    return false
  }

  const menu = open ? (
    <div className="mention-menu" role="listbox" aria-label="Project folders">
      <div className="mention-head">Work in a folder — Hermione uses it as the project for this chat</div>
      {items.map((s, i) => (
        <button
          key={s.path}
          type="button"
          role="option"
          aria-selected={i === active}
          className={i === active ? 'is-on' : ''}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(s)
          }}
          onMouseEnter={() => setActive(i)}
        >
          {s.recent ? <History className="size-3.5 flex-none" /> : <FolderOpen className="size-3.5 flex-none" />}
          <strong>{s.name}</strong>
          <span>{s.path}</span>
        </button>
      ))}
    </div>
  ) : null

  return { menu, onKeyDown }
}
