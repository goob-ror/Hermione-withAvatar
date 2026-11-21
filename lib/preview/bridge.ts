/**
 * The bridge injected into every previewed page. It runs inside the sandboxed
 * iframe and speaks a small postMessage protocol with the console:
 *
 *   console → page   {__hermione:'cmd', id, command, args}
 *   page → console   {__hermione:'res', id, ok, output, navigate?}
 *                    {__hermione:'ready', url, title}
 *                    {__hermione:'navigate', url}          (operator clicked a link)
 *
 * Browsing model (the numbered element table, node identity kept in a WeakMap,
 * act-by-number with freshness and occlusion checks, short settle waits) is
 * adapted from browser-use/jev-ultrafast `snapshot.js` (MIT, © 2026 Browser Use).
 *
 * Written as plain JS inside String.raw: no backticks and no dollar-brace in here.
 */
export interface BridgeOptions {
  /** Running inside a real browser tab (live preview): real navigations are wanted, not intercepted. */
  live?: boolean
}

/** The bridge wrapped in a <script> tag, for the proxied (iframe) preview. */
export function bridgeScript(pageUrl = ''): string {
  return '<script data-hermione-bridge>\n' + bridgeSource(pageUrl) + '\n</script>'
}

/** The bridge as plain JavaScript (injected directly into live-preview tabs). */
export function bridgeSource(pageUrl = '', opts: BridgeOptions = {}): string {
  // The frame is served from the console's own address; this is the page it really is.
  // "<" escaped so a URL can never close the script tag.
  const realUrl = JSON.stringify(pageUrl).replace(/</g, '\\u003c')
  return String.raw`(function () {
  if (window.__hermioneBridge) return
  window.__hermioneBridge = true
  var PAGE_URL = ${realUrl} || location.href
  var LIVE = ${opts.live ? 'true' : 'false'}

  function reply(payload) { try { parent.postMessage(payload, '*') } catch (e) {} }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function short(s, n) { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  function textOf(el) { return el ? clean(el.innerText || el.textContent || '') : '' }
  function describe(el) {
    if (!el || !el.tagName) return 'something'
    var t = textOf(el)
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (t ? ' "' + short(t, 60) + '"' : '')
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // ---------------------------------------------------------------- identity
  // One number per real DOM node, stable for as long as the node exists.
  var IDS = new WeakMap(), NODES = new Map(), GONE = new Set(), NEXT = 1
  function idOf(el) {
    var id = IDS.get(el)
    if (!id) { id = NEXT++; IDS.set(el, id) }
    NODES.set(id, el)
    return id
  }
  // Remember numbers whose element disappeared, so a late action says "gone", not "unknown".
  function prune() { NODES.forEach(function (el, id) { if (!el.isConnected) { NODES.delete(id); GONE.add(id) } }) }

  // ---------------------------------------------------------------- reading
  var INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable="true"],' +
    '[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=menuitemcheckbox],' +
    '[role=menuitemradio],[role=option],[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[onclick]'

  function visible(el) {
    if (!el || !el.isConnected) return false
    if (el.closest('[aria-hidden="true"],[inert]')) return false
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    var r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  function isDisabled(el) { return !!(el.disabled || el.closest('[aria-disabled="true"],fieldset[disabled]')) }

  function roleOf(el) {
    var explicit = clean(el.getAttribute('role')).split(' ')[0]
    if (explicit) return explicit
    var tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return el.multiple ? 'listbox' : 'select'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'label') { var c = el.control; return c ? roleOf(c) : 'clickable' }
    if (tag === 'input') {
      var t = String(el.type || 'text').toLowerCase()
      if (t === 'checkbox' || t === 'radio') return t
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button'
      if (t === 'range') return 'slider'
      if (t === 'number') return 'spinbutton'
      if (t === 'search') return 'searchbox'
      if (t === 'password') return 'password'
      if (t === 'file') return 'file'
      if (el.getAttribute('list')) return 'combobox'
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'clickable'
  }

  function nameOf(el) {
    var ids = clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
    if (ids.length) {
      var byIds = ids.map(function (i) { var n = document.getElementById(i); return n ? textOf(n) : '' }).join(' ')
      if (clean(byIds)) return byIds
    }
    if (clean(el.getAttribute('aria-label'))) return el.getAttribute('aria-label')
    if (el.labels && el.labels.length) {
      var lt = Array.prototype.map.call(el.labels, textOf).join(' ')
      if (clean(lt)) return lt
    }
    var tag = el.tagName.toLowerCase()
    if (tag === 'input' && /^(submit|button|reset)$/i.test(el.type) && el.value) return el.value
    if (tag === 'input' && el.type === 'image' && el.alt) return el.alt
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      var inner = textOf(el)
      if (inner) return inner
      var img = el.querySelector('img[alt]')
      if (img && clean(img.alt)) return img.alt
      var st = el.querySelector('svg title')
      if (st && textOf(st)) return textOf(st)
    }
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || ''
  }

  /** The control a label stands in for (custom checkboxes hide the real input). */
  function controlOf(el) { return el.tagName === 'LABEL' && el.control ? el.control : el }

  function isChecked(el) {
    var c = controlOf(el)
    if (c.checked != null && (c.type === 'checkbox' || c.type === 'radio')) return !!c.checked
    return c.getAttribute('aria-checked') === 'true'
  }

  function stateOf(el, role) {
    var c = controlOf(el), parts = []
    if (role === 'password') parts.push(c.value ? 'filled' : 'empty') // the value itself is never exposed
    else if (role === 'select') {
      var o = c.options[c.selectedIndex]
      parts.push(o ? '"' + short(o.text, 40) + '"' : 'nothing selected')
      if (c.options.length <= 8) parts.push('options: ' + Array.prototype.map.call(c.options, function (x) { return short(x.text, 30) }).join(' | '))
      else parts.push(c.options.length + ' options')
    } else if (role === 'checkbox' || role === 'radio' || role === 'switch') parts.push(isChecked(el) ? 'checked' : 'unchecked')
    else if (/^(textbox|searchbox|combobox|spinbutton|slider)$/.test(role)) {
      var v = c.isContentEditable ? textOf(c) : c.value != null ? c.value : c.getAttribute('aria-valuenow') || ''
      parts.push(v ? '"' + short(v, 50) + '"' : 'empty')
    }
    var exp = c.getAttribute('aria-expanded')
    if (exp) parts.push(exp === 'true' ? 'expanded' : 'collapsed')
    if (c.getAttribute('aria-selected') === 'true') parts.push('selected')
    if (c.getAttribute('aria-pressed') === 'true') parts.push('pressed')
    var cur = c.getAttribute('aria-current')
    if (cur && cur !== 'false') parts.push('current')
    if (c.required) parts.push('required')
    if (role === 'link') {
      var href = el.getAttribute('href') || ''
      if (href && href !== '#' && !/^javascript:/i.test(href)) parts.push('→ ' + short(String(el.href).replace(/^https?:\/\//, ''), 60))
    }
    return parts.join(', ')
  }

  function collect() {
    var vh = innerHeight, out = [], seen = new Set()
    var all = document.querySelectorAll(INTERACTIVE)
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      // A visually hidden checkbox/radio is usually drawn by its label: offer the label.
      if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type) && !visible(el) && el.labels && el.labels[0] && visible(el.labels[0])) el = el.labels[0]
      if (seen.has(el)) continue
      seen.add(el)
      if (!visible(el) || isDisabled(controlOf(el))) continue
      // Click-handler wrappers around real controls are noise.
      if (el.hasAttribute('onclick') && !el.matches('a,button,input,select,textarea,label,[role]') && el.querySelector('a,button,input,select,textarea')) continue
      var role = roleOf(el), name = short(nameOf(el), 70)
      // A control with no name (an unlabelled logo link, an icon wrapper) tells the model nothing.
      if (!name && (role === 'clickable' || role === 'link')) continue
      var r = el.getBoundingClientRect()
      out.push({ el: el, role: role, name: name, where: r.bottom < 0 ? 'above' : r.top > vh ? 'below' : 'view' })
    }
    return out
  }

  function openDialogs() {
    return Array.prototype.filter.call(document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal="true"]'), visible)
  }
  function alertTexts() {
    return Array.prototype.filter.call(document.querySelectorAll('[role=alert],[aria-live="assertive"]'), visible)
      .map(textOf).filter(Boolean).map(function (t) { return short(t, 140) })
  }
  function headingsInView() {
    var out = []
    var hs = document.querySelectorAll('h1,h2,h3,[role=heading]')
    for (var i = 0; i < hs.length && out.length < 6; i++) {
      var r = hs[i].getBoundingClientRect()
      if (r.bottom > 0 && r.top < innerHeight && visible(hs[i]) && textOf(hs[i])) out.push(short(textOf(hs[i]), 70))
    }
    return out
  }

  function snapshot(a) {
    prune()
    var max = Math.min(Math.max(Number(a && a.max) || 60, 10), 150)
    var items = collect()
    var view = items.filter(function (x) { return x.where === 'view' })
    var below = items.filter(function (x) { return x.where === 'below' })
    var above = items.filter(function (x) { return x.where === 'above' })
    var chosen = new Set(view.slice(0, max))
    below.concat(above).forEach(function (x) { if (chosen.size < max) chosen.add(x) })

    var lines = []
    items.forEach(function (x) {
      if (!chosen.has(x)) return
      var state = stateOf(x.el, x.role)
      lines.push('[' + idOf(x.el) + '] ' + x.role + ' "' + x.name + '"' + (state ? ' · ' + state : '') + (x.where === 'view' ? '' : ' (' + x.where + ')'))
    })

    var se = document.scrollingElement || document.documentElement
    var head = [
      'page: ' + (short(document.title, 80) || '(untitled)') + ' — ' + PAGE_URL,
      'view: ' + Math.round(se.scrollTop) + '–' + Math.round(se.scrollTop + innerHeight) + ' of ' + Math.round(se.scrollHeight) + 'px',
    ]
    var dialogs = openDialogs()
    if (dialogs.length) head.push('open dialog: ' + dialogs.map(function (d) { return '"' + short(nameOf(d) || textOf(d), 80) + '"' }).join(', ') + ' (it may cover the page)')
    var alerts = alertTexts()
    if (alerts.length) head.push('alert: ' + alerts.join(' | '))
    var hs = headingsInView()
    if (hs.length) head.push('headings in view: ' + hs.join(' | '))
    var more = items.length - chosen.size
    return head.join('\n') + '\n\nelements (' + chosen.size + (more ? ' of ' + items.length + ' — scroll for more' : '') + '):\n' +
      (lines.join('\n') || '(no interactive elements visible)')
  }

  // ---------------------------------------------------------------- targets
  function StaleError(message) { this.message = message; this.stale = true }

  function targetOf(a) {
    if (a.target == null || a.target === '') return null
    var n = Number(String(a.target).replace(/[^0-9]/g, ''))
    var el = NODES.get(n)
    if (!el && GONE.has(n)) throw new StaleError('element [' + n + '] is gone — the page changed')
    if (!el) throw new StaleError('there is no element [' + a.target + '] — use a number from the latest element list')
    if (!el.isConnected) { NODES.delete(n); GONE.add(n); throw new StaleError('element [' + n + '] is gone — the page changed') }
    if (!visible(el)) throw new StaleError('element [' + n + '] is no longer visible')
    if (isDisabled(controlOf(el))) throw new Error('element [' + n + '] is disabled')
    return el
  }

  /** Scroll into view if needed, then make sure nothing covers the element's centre. */
  function clickPoint(el) {
    var r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center' })
      r = el.getBoundingClientRect()
    }
    var x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    var y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    var top = document.elementFromPoint(x, y)
    var c = controlOf(el)
    var ok = !top || top === el || el.contains(top) || top.contains(el) || top === c ||
      (c.labels && Array.prototype.some.call(c.labels, function (l) { return l === top || l.contains(top) }))
    if (!ok) throw new StaleError('[' + idOf(el) + '] is covered by ' + describe(top) + ' — dismiss that first (often a dialog or cookie banner)')
    return { x: x, y: y }
  }

  function realClick(el, pt) {
    var o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: pt.x, clientY: pt.y, button: 0 }
    try { el.dispatchEvent(new PointerEvent('pointerdown', o)) } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', o))
    try { el.focus({ preventScroll: true }) } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', o)) } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', o))
    el.click()
  }

  function typeInto(el, text) {
    el.focus()
    if (el.isContentEditable) {
      var range = document.createRange()
      range.selectNodeContents(el)
      var sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      if (!document.execCommand('insertText', false, text)) el.textContent = text
      return
    }
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    // Native setter + input events, so React/Vue-controlled fields see the change.
    setter.call(el, '')
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
    setter.call(el, text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function key(el, name) {
    var codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Space: 32 }
    var o = { key: name === 'Space' ? ' ' : name, code: name, keyCode: codes[name] || 0, which: codes[name] || 0, bubbles: true, cancelable: true }
    var down = el.dispatchEvent(new KeyboardEvent('keydown', o))
    el.dispatchEvent(new KeyboardEvent('keyup', o))
    // Synthetic Enter doesn't submit forms on its own — do what the browser would.
    if (name === 'Enter' && down && el.form && /^(INPUT)$/.test(el.tagName)) {
      if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit()
    }
  }

  // ---------------------------------------------------------------- waits
  /** Resolve once the DOM has been quiet for quietMs, or after maxMs. */
  function settle(quietMs, maxMs) {
    return new Promise(function (resolve) {
      var done = false, quiet, cap
      var obs = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(finish, quietMs) })
      function finish() { if (done) return; done = true; obs.disconnect(); clearTimeout(quiet); clearTimeout(cap); resolve() }
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      quiet = setTimeout(finish, quietMs)
      cap = setTimeout(finish, maxMs)
    })
  }
  function waitFor(test, maxMs) {
    var start = Date.now()
    return new Promise(function (resolve) {
      (function poll() {
        var hit = false
        try { hit = test() } catch (e) {}
        if (hit || Date.now() - start >= maxMs) resolve(hit)
        else setTimeout(poll, 25)
      })()
    })
  }
  function autocompletes(el) {
    return roleOf(el) === 'combobox' || el.hasAttribute('aria-autocomplete') || el.hasAttribute('list') ||
      el.hasAttribute('aria-controls') || el.hasAttribute('aria-owns')
  }
  function optionsVisible() {
    return Array.prototype.some.call(document.querySelectorAll('[role=option],[role=listbox] li,datalist option'), visible)
  }

  // ---------------------------------------------------------------- navigation
  // During an agent action, real navigations are caught and handed back so the
  // console reloads them through the preview (and this bridge comes along).
  // Pages that handle the click themselves (SPA routers) call preventDefault
  // first and keep working.
  var ACT = { on: false, navigate: null, blocked: null }
  window.addEventListener('click', function (e) {
    if (LIVE || e.defaultPrevented || e.button !== 0) return
    var a = e.target && e.target.closest && e.target.closest('a[href]')
    if (!a || !/^https?:/i.test(a.href)) return
    if (a.hash && a.href.split('#')[0] === location.href.split('#')[0]) return // same-page anchor
    e.preventDefault()
    if (ACT.on) ACT.navigate = a.href
    else reply({ __hermione: 'navigate', url: a.href }) // the operator clicked a link in the preview
  }, false)
  window.addEventListener('submit', function (e) {
    if (LIVE || !ACT.on || e.defaultPrevented) return
    var form = e.target
    e.preventDefault()
    var method = String(form.getAttribute('method') || 'get').toLowerCase()
    var action = form.action || location.href
    if (method === 'get') {
      var u = new URL(action, location.href)
      var fd
      try { fd = new FormData(form, e.submitter || undefined) } catch (err) { fd = new FormData(form) }
      var params = new URLSearchParams()
      fd.forEach(function (v, k) { if (typeof v === 'string') params.append(k, v) })
      u.search = params.toString()
      ACT.navigate = u.href
    } else {
      ACT.blocked = 'the form sends data with ' + method.toUpperCase() + ' to ' + action + ' — the preview can follow links and search (GET) forms, not post data'
    }
  }, false)
  window.addEventListener('pagehide', function () {
    if (ACT.on && ACT.pendingId) reply({ __hermione: 'res', id: ACT.pendingId, ok: false, output: 'a script navigated the page away mid-action; the preview has left this page. Use page_open to continue.' })
  })

  // ---------------------------------------------------------------- changes
  function observe(el) {
    return {
      url: location.href, title: document.title, count: collect().length,
      dialogs: openDialogs().length, alerts: alertTexts(),
      target: el ? stateOf(el, roleOf(el)) : '',
      focus: document.activeElement,
    }
  }
  function changes(before, after, el) {
    var out = []
    if (after.url !== before.url) out.push('URL → ' + after.url)
    if (after.title !== before.title) out.push('title → "' + short(after.title, 80) + '"')
    if (after.dialogs > before.dialogs) out.push('a dialog opened')
    if (after.dialogs < before.dialogs) out.push('a dialog closed')
    after.alerts.forEach(function (t) { if (before.alerts.indexOf(t) < 0) out.push('alert: ' + t) })
    var d = after.count - before.count
    if (d) out.push((d > 0 ? '+' : '') + d + ' elements')
    if (el && el.isConnected && after.target !== before.target) out.push('[' + idOf(el) + '] now: ' + (after.target || '(changed)'))
    if (el && !el.isConnected) out.push('[' + IDS.get(el) + '] disappeared')
    if (after.focus !== before.focus && after.focus && after.focus !== document.body) out.push('focus: ' + describe(after.focus))
    return out.length ? out.join('; ') : 'no visible change'
  }

  // ---------------------------------------------------------------- legacy selector targeting
  function findByText(needle) {
    var n = clean(needle).toLowerCase()
    if (!n) return null
    var list = Array.prototype.slice.call(document.querySelectorAll('a,button,[role=button],input[type=submit],input[type=button],label,li,span,div,p'))
    for (var i = 0; i < list.length; i++) if (textOf(list[i]).toLowerCase() === n) return list[i]
    for (var j = 0; j < list.length; j++) if (textOf(list[j]).toLowerCase().indexOf(n) !== -1) return list[j]
    return null
  }
  function bySelector(raw) {
    raw = clean(raw)
    if (!raw) return null
    try { var direct = document.querySelector(raw); if (direct) return direct } catch (e) {}
    if (/^[A-Za-z_][\w-]*$/.test(raw)) {
      return document.getElementById(raw) || document.querySelector('[name="' + raw + '"]') ||
        document.querySelector('[aria-label="' + raw + '"]') || document.querySelector('[placeholder="' + raw + '"]')
    }
    return null
  }
  function resolve(a) {
    var el = targetOf(a)
    if (el) return el
    if (a.selector) {
      el = bySelector(a.selector) || findByText(a.selector)
      if (!el) throw new StaleError('no element for "' + a.selector + '" — prefer target numbers from the element list')
      return el
    }
    if (a.text) {
      el = findByText(a.text)
      if (!el) throw new StaleError('no element with text "' + a.text + '" — prefer target numbers from the element list')
      return el
    }
    throw new Error('pass target (an element number from the list)')
  }
  function label(el) { return '[' + idOf(el) + '] ' + roleOf(el) + ' "' + short(nameOf(el), 60) + '"' }

  // ---------------------------------------------------------------- commands
  var READS = {
    snapshot: function (a) { return snapshot(a) },
    title: function () { return document.title },
    url: function () { return location.href },
    text: function (a) { return (document.body ? document.body.innerText : '').slice(0, a.max || 20000) },
    links: function () {
      return Array.prototype.slice.call(document.querySelectorAll('a[href]'), 0, 60)
        .map(function (x) { return '- ' + (short(textOf(x), 80) || '(no text)') + ' → ' + x.href }).join('\n')
    },
    query: function (a) {
      if (!a.selector) throw new Error('query needs a selector')
      var found = document.querySelectorAll(a.selector)
      var out = [found.length + ' match(es) for ' + a.selector]
      for (var i = 0; i < Math.min(found.length, 10); i++) out.push('- ' + describe(found[i]))
      return out.join('\n')
    },
    count: function (a) {
      if (!a.selector) throw new Error('count needs a selector')
      return String(document.querySelectorAll(a.selector).length)
    },
    options: function (a) {
      var el = controlOf(resolve(a))
      if (el.tagName !== 'SELECT') throw new Error(label(el) + ' is not a dropdown')
      return Array.prototype.map.call(el.options, function (o, i) { return (o.selected ? '* ' : '  ') + short(o.text, 80) + (o.value && o.value !== o.text ? ' (value ' + short(o.value, 40) + ')' : '') }).join('\n')
    },
  }

  var ACTIONS = {
    click: async function (a) {
      var el = resolve(a)
      realClick(el, clickPoint(el))
      return { el: el, did: 'clicked ' + label(el), quiet: 120, max: 1200 }
    },
    fill: async function (a) {
      var el = controlOf(resolve(a))
      var value = a.value != null ? String(a.value) : a.text != null && a.target != null ? String(a.text) : ''
      clickPoint(el)
      typeInto(el, value)
      var shown = roleOf(el) === 'password' ? '(hidden)' : '"' + short(value, 60) + '"'
      if (a.submit) key(el, 'Enter')
      // Autocomplete fields: give suggestions a moment to appear.
      if (!a.submit && autocompletes(el)) await waitFor(optionsVisible, 400)
      return { el: el, did: 'typed ' + shown + ' into ' + label(el) + (a.submit ? ' and pressed Enter' : ''), quiet: 100, max: a.submit ? 1200 : 500 }
    },
    select: async function (a) {
      var el = controlOf(resolve(a))
      if (el.tagName !== 'SELECT') throw new Error(label(el) + ' is not a dropdown — click it, then click the option')
      var want = clean(a.value).toLowerCase()
      var opts = Array.prototype.slice.call(el.options)
      var hit = opts.filter(function (o) { return clean(o.text).toLowerCase() === want || String(o.value).toLowerCase() === want })[0] ||
        opts.filter(function (o) { return clean(o.text).toLowerCase().indexOf(want) !== -1 })[0]
      if (!hit) throw new Error('no option "' + a.value + '" in ' + label(el) + '; options: ' + opts.map(function (o) { return short(o.text, 30) }).join(' | '))
      var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(el, hit.value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { el: el, did: 'chose "' + short(hit.text, 60) + '" in ' + label(el), quiet: 100, max: 800 }
    },
    check: async function (a) {
      var el = resolve(a)
      var want = a.checked !== false
      if (isChecked(el) === want) return { el: el, did: label(el) + ' was already ' + (want ? 'checked' : 'unchecked'), quiet: 0, max: 0 }
      realClick(el, clickPoint(el))
      return { el: el, did: (want ? 'checked ' : 'unchecked ') + label(el), quiet: 100, max: 800 }
    },
    press: async function (a) {
      var name = clean(a.key) || 'Enter'
      var el = a.target != null || a.selector || a.text ? resolve(a) : document.activeElement || document.body
      if (el && el.focus) try { el.focus({ preventScroll: true }) } catch (e) {}
      key(el, name)
      return { el: el === document.body ? null : el, did: 'pressed ' + name + (el && el !== document.body ? ' on ' + label(el) : ''), quiet: 120, max: 1200 }
    },
    submit: async function (a) {
      var form = (a.target != null ? controlOf(resolve(a)).form || resolve(a) : null) || (a.selector ? document.querySelector(a.selector) : null) || document.querySelector('form')
      if (!form || form.tagName !== 'FORM') throw new Error('no form found — pass the target of a field or button inside it')
      if (form.requestSubmit) form.requestSubmit(); else form.submit()
      return { el: null, did: 'submitted the form', quiet: 120, max: 1200 }
    },
    scroll: async function (a) {
      var se = document.scrollingElement || document.documentElement
      var dir = clean(a.direction).toLowerCase()
      if (a.target != null) { var el = resolve(a); el.scrollIntoView({ block: 'center' }); return { el: el, did: 'scrolled to ' + label(el), quiet: 100, max: 600 } }
      if (dir === 'top') se.scrollTo(0, 0)
      else if (dir === 'bottom') se.scrollTo(0, se.scrollHeight)
      else if (a.y != null && !dir) se.scrollTo(0, Number(a.y) || 0)
      else se.scrollBy(0, (dir === 'up' ? -1 : 1) * Math.round(innerHeight * 0.85))
      return { el: null, did: 'scrolled ' + (dir || 'down'), quiet: 120, max: 800 } // lazy-loaded content gets a moment
    },
  }

  async function run(data) {
    var a = data.args || {}
    if (READS[data.command]) return { ok: true, output: String(READS[data.command](a)) }
    var action = ACTIONS[data.command]
    if (!action) return { ok: false, output: 'unknown command: ' + data.command }

    var preTarget = null
    try { preTarget = targetOf(a) } catch (e) {}
    var before = observe(preTarget)
    ACT.on = true; ACT.navigate = null; ACT.blocked = null; ACT.pendingId = data.id
    var result
    try {
      result = await action(a)
      if (!ACT.navigate && !ACT.blocked && result.max) await settle(result.quiet, result.max)
    } finally {
      ACT.on = false; ACT.pendingId = null
    }
    if (ACT.navigate) return { ok: true, output: result.did + ' → navigating to ' + ACT.navigate, navigate: ACT.navigate }
    if (ACT.blocked) return { ok: false, output: result.did + ', but ' + ACT.blocked }
    var after = observe(result.el)
    return { ok: true, output: result.did + '\nchanges: ' + changes(before, after, result.el) + '\n\n' + snapshot({}) }
  }

  /** Run a command; failures come back as results (stale targets include a fresh list). */
  function handle(data) {
    return run(data).then(function (res) { return res }, function (err) {
      var msg = String((err && err.message) || err)
      // Stale/covered/missing target: hand back a fresh list so the model can retry in one step.
      if (err && err.stale) msg += '\n\n' + snapshot({})
      return { ok: false, output: msg }
    })
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.__hermione !== 'cmd' || event.source !== parent) return
    handle(data).then(function (res) {
      reply({ __hermione: 'res', id: data.id, ok: res.ok, output: res.output, navigate: res.navigate })
    })
  })

  // Live preview: the server calls this directly in the real tab.
  if (LIVE) window.__hermioneRun = function (command, args) { return handle({ id: 'live', command: command, args: args || {} }) }

  function announce() { reply({ __hermione: 'ready', url: location.href, title: document.title }) }
  if (document.readyState === 'complete') announce()
  else window.addEventListener('load', announce)
})();`
}
