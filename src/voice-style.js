// Turns how a message was said (voice-analyser.js) into how it looks and moves. The voice picks
// the typeface -- loud is bold, quiet is thin, fast is condensed, crisp is pop, calm is mincho,
// soft is rounded -- and also the letters' thickness, size and motion: loud voices bounce, soft
// ones drift slowly, lively ones wobble more. The color is the user's own choice.
import {findFont} from './fonts'

const RATE = {min: 4, max: 9} // characters per second of actual voice, mapped to 0..1

const lerp = (a, b, k) => a + (b - a) * k
const clamp01 = (x) => Math.min(1, Math.max(0, x))

// 0..1 how fast the words came, from the recognized text and how long the voice sounded.
const speakingRate = (text, {voicedSeconds}) => {
  const chars = Array.from(text.replace(/[\s、。，．,.!?！？…]/g, '')).length
  if (!chars || voicedSeconds < 0.3) {
    return 0.5
  }
  return clamp01((chars / voicedSeconds - RATE.min) / (RATE.max - RATE.min))
}

// First match wins: the most striking quality of the voice decides the face. `name` is what the
// on-screen tag calls the voice (null: nothing worth pointing out).
const FONT_RULES = [
  {fontId: 'bold', name: '大きな声', test: (v) => v.loudness > 0.72},
  {fontId: 'thin', name: '小さな声', test: (v) => v.loudness < 0.3},
  {fontId: 'condensed', name: '早口', test: (v) => v.rate > 0.65},
  {fontId: 'pop', name: 'ハキハキした声', test: (v) => v.attack > 0.6 && v.softness < 0.5},
  {fontId: 'mincho', name: '落ち着いた声', test: (v) => v.liveliness < 0.4 && v.attack < 0.45 && v.rate < 0.5},
  {fontId: 'maru', name: 'やわらかい声', test: (v) => v.softness > 0.6},
  {fontId: 'gothic', name: null, test: () => true},
]

export const styleFromVoice = (voice, {text = '', color = '#ffffff'} = {}) => {
  const v = {...voice, rate: speakingRate(text, voice)}
  const rule = voice.voiced ? FONT_RULES.find((r) => r.test(v)) : FONT_RULES[FONT_RULES.length - 1]
  const {loudness, softness, liveliness, rate} = v
  // Loud, lively speech pops; everything else floats, slower the softer it was said.
  const bouncy = loudness > 0.62 && liveliness > 0.45
  return {
    fontId: rule.fontId,
    color,
    look: {
      depthRatio: lerp(0.1, 0.24, loudness),
      roughness: lerp(0.35, 0.65, softness),
      emissive: loudness > 0.8 ? 0.25 : 0, // a shout glows a little
    },
    motion: bouncy ? 'pop' : 'float',
    motionParams: {
      speed: lerp(2.4, 0.9, softness) * lerp(0.9, 1.4, liveliness) * lerp(0.9, 1.3, rate),
      lift: lerp(0.03, 0.09, liveliness),
      sway: lerp(0.04, 0.16, Math.max(softness, liveliness)),
      bounce: lerp(0.1, 0.24, loudness),
    },
    size: lerp(0.75, 1.6, loudness),
    label: rule.name ? `${rule.name} · ${findFont(rule.fontId).label}` : null,
  }
}
