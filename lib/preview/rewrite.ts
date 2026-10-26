// Rewrites a fetched page so it can be rendered *inside* the console as a
// same-origin iframe the parent can script. That same-origin property is the
// whole reason the agent can act on the page without a native browser control.

/**
 * Injected into every previewed page. Speaks a tiny postMessage protocol with
 * the console: the parent sends {__hermione:'cmd', id, command, args}, this
 * replies {__hermione:'res', id, ok, output}.
 */
export function bridgeScript(): string {
  return String.raw`<script data-hermione-bridge>
(function () {
  if (window.__hermioneBridge) return
  window.__hermioneBridge = true

  function reply(payload) {
    try { parent.postMessage(payload, '*') } catch (e) {}
  }

  function textOf(el) {
    if (!el) return ''
    return String(el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
  }

  function describe(el) {
    if (!el) return 'nothing'
    var tag = el.tagName ? el.tagName.toLowerCase() : 'node'
    var id = el.id ? '#' + el.id : ''
    var t = textOf(el).slice(0, 120)
    return tag + id + (t ? ' "' + t + '"' : '')
  }

  function candidates() {
    return Array.prototype.slice.call(
      document.querySelectorAll('a,button,[role=button],input[type=submit],input[type=button],label,li,span,div,p'),
    )
  }

  function findByText(needle) {
    var n = String(needle || '').toLowerCase().trim()
    if (!n) return null
    var list = candidates()
    for (var i = 0; i < list.length; i++) {
      if (textOf(list[i]).toLowerCase() === n) return list[i]
    }
    for (var j = 0; j < list.length; j++) {
      if (textOf(list[j]).toLowerCase().indexOf(n) !== -1) return list[j]
    }
    return null
  }

  function pick(args) {
    if (args.selector) {
      var el = resolveSelector(args.selector)
      if (!el) {
        var byText = findByText(args.selector)
        if (byText) return byText
        throw new Error(
          'no element for "' + args.selector + '" (tried CSS, #id, [name], aria-label and visible text)',
        )
      }
      return el
    }
    if (args.text) {
      var found = findByText(args.text)
      if (!found) throw new Error('no element contains text "' + args.text + '"')
      return found
    }
    throw new Error('pass either selector or text')
  }

  // Models routinely send a bare id/label ("name") instead of a CSS selector.
  function resolveSelector(selector) {
    var raw = String(selector || '').trim()
    if (!raw) return null
    try {
      var direct = document.querySelector(raw)
      if (direct) return direct
    } catch (e) {
      // invalid CSS — fall through to the heuristics
    }
    if (/^[A-Za-z_][\w-]*$/.test(raw)) {
      var byId = document.getElementById(raw)
      if (byId) return byId
      var byName = document.querySelector('[name="' + raw + '"]')
      if (byName) return byName
      var byLabel = document.querySelector('[aria-label="' + raw + '"]')
      if (byLabel) return byLabel
      var byPlaceholder = document.querySelector('[placeholder="' + raw + '"]')
      if (byPlaceholder) return byPlaceholder
    }
    return null
  }

  function setValue(el, value) {
    var proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
    var setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  var HANDLERS = {
    title: function () {
      return document.title
    },
    url: function () {
      return location.href
    },
    text: function (a) {
      var body = document.body
      return (body ? body.innerText : '').slice(0, a.max || 20000)
    },
    html: function (a) {
      var root = document.documentElement
      return (root ? root.outerHTML : '').slice(0, a.max || 20000)
    },
    links: function () {
      var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]')).slice(0, 60)
      return anchors
        .map(function (a) {
          return '- ' + (textOf(a).slice(0, 80) || '(no text)') + ' → ' + a.href
        })
        .join('\n')
    },
    query: function (a) {
      if (!a.selector) throw new Error('query needs a selector')
      var found = document.querySelectorAll(a.selector)
      if (!found.length) return '0 matches for ' + a.selector
      var out = [found.length + ' match(es) for ' + a.selector]
      for (var i = 0; i < Math.min(found.length, 10); i++) {
        out.push('- ' + describe(found[i]))
      }
      return out.join('\n')
    },
    click: function (a) {
      var el = pick(a)
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' })
      el.click()
      return 'clicked ' + describe(el)
    },
    fill: function (a) {
      var el = pick(a)
      var v = a.value != null ? a.value : a.text != null ? a.text : ''
      setValue(el, String(v))
      return 'filled ' + describe(el) + ' with "' + String(v) + '"'
    },
    submit: function (a) {
      var form = a.selector ? document.querySelector(a.selector) : null
      if (!form) form = document.querySelector('form')
      if (!form) throw new Error('no form on the page')
      if (form.requestSubmit) form.requestSubmit()
      else form.submit()
      return 'submitted form'
    },
    scroll: function (a) {
      var y = Number(a.y || 0)
      window.scrollTo(0, y)
      return 'scrolled to y=' + y
    },
    count: function (a) {
      if (!a.selector) throw new Error('count needs a selector')
      return String(document.querySelectorAll(a.selector).length)
    },
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.__hermione !== 'cmd') return
    var handler = HANDLERS[data.command]
    if (!handler) {
      reply({ __hermione: 'res', id: data.id, ok: false, output: 'unknown command: ' + data.command })
      return
    }

    // Read-only commands already return the thing being asked for; anything
    // that can change the DOM echoes the page text afterwards so the model
    // sees the result of its own action instead of a stale snapshot.
    var ECHOES = { click: 1, fill: 1, submit: 1, scroll: 1 }

    try {
      var out = handler(data.args || {})
      var extra = ''
      if (ECHOES[data.command] && document.body) {
        var live = String(document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
        extra = '\n\n--- page text after the action ---\n' + live.slice(0, 3000)
      }
      reply({ __hermione: 'res', id: data.id, ok: true, output: String(out) + extra })
    } catch (err) {
      reply({ __hermione: 'res', id: data.id, ok: false, output: String((err && err.message) || err) })
    }
  })

  function announce() {
    reply({ __hermione: 'ready', url: location.href, title: document.title })
  }

  if (document.readyState === 'complete') announce()
  else window.addEventListener('load', announce)
})();
</script>`
}

/**
 * Strip the bits that would stop this document rendering in a frame, pin
 * relative URLs to the real origin with <base>, and append the bridge.
 */
export function rewriteHtml(html: string, pageUrl: string): string {
  let out = html

  // CSP metas would block our inline bridge (and any external asset).
  out = out.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')

  // A page-provided <base> would fight ours.
  out = out.replace(/<base\b[^>]*>/gi, '')

  let baseHref = pageUrl
  try {
    baseHref = new URL('.', pageUrl).href
  } catch {
    // keep the raw url
  }
  const base = `<base href="${escapeAttr(baseHref)}">`

  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (match) => `${match}\n${base}`)
  } else {
    out = `${base}\n${out}`
  }

  const bridge = bridgeScript()
  if (/<\/body\s*>/i.test(out)) {
    out = out.replace(/<\/body\s*>/i, `${bridge}\n</body>`)
  } else {
    out = `${out}\n${bridge}`
  }

  return out
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
