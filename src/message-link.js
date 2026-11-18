// A message as a link: the words and the style the voice gave them (font, color, size, motion)
// packed into the URL's #fragment, so the recipient's TYPO VOICE can float the same message in
// their own space. The fragment never reaches a server. The voice itself isn't in the link -- it
// travels in the recorded video.
import {findFont} from './fonts'

const KEY = 'm'
const MAX_TEXT = 80
const round = (x) => Math.round(x * 1000) / 1000
const roundAll = (object) => Object.fromEntries(Object.entries(object || {}).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))

// base64url of UTF-8 JSON
const encode = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const decode = (text) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// `message`: the options a message was spawned with ({text, fontId, color, look, motion,
// motionParams, size, label}).
export const messageToUrl = ({text, fontId, color, look, motion, motionParams, size, label}) => {
  const payload = {t: text, f: fontId, c: color, k: roundAll(look), m: motion, p: roundAll(motionParams), s: round(size), l: label || ''}
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = `${KEY}=${encode(payload)}`
  return url.toString()
}

// The message in this page's link, or null. Anything malformed or unknown falls back to defaults
// rather than failing, so an old or hand-edited link still shows the words.
export const messageFromUrl = () => {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const raw = params.get(KEY)
  if (!raw) {
    return null
  }
  try {
    const p = decode(raw)
    const text = String(p.t || '').slice(0, MAX_TEXT)
    if (!text.trim()) {
      return null
    }
    return {
      text,
      fontId: findFont(p.f).id,
      color: /^#[0-9a-f]{6}$/i.test(p.c) ? p.c : '#ffffff',
      look: typeof p.k === 'object' ? p.k : {},
      motion: p.m === 'pop' ? 'pop' : 'float',
      motionParams: typeof p.p === 'object' ? p.p : {},
      size: Math.min(2, Math.max(0.5, Number(p.s) || 1)),
      label: typeof p.l === 'string' ? p.l.slice(0, 40) : '',
    }
  } catch {
    return null
  }
}

// Drops the message from the address bar once it's been received, so a reload doesn't repeat it.
export const clearMessageFromUrl = () => {
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
