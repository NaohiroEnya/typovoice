// app.js is the main entry point for TYPO VOICE: it boots the 8th Wall camera pipeline (unchanged
// from TYPO CAM / Font Photo AR), listens for a spoken message (speech.js), and hands the
// recognized words to the AR scene (scene.js), which floats them in front of the camera.
import * as THREE from 'three'

import {createScenePipeline} from './scene'
import {createSpeech} from './speech'

window.THREE = THREE

const MAX_CHARS = 40
const CHARS_PER_LINE = 8
const BREAK_AFTER = /[\s、。，．,.!?！？…ー〜]/

// Phase 1: every message looks the same -- plain white gothic, floating.
const messageStyle = () => ({
  fontId: 'gothic',
  color: '#ffffff',
  look: {depthRatio: 0.16, roughness: 0.45},
  motion: 'float',
  size: 1,
})

// Breaks a message into short lines so it reads as a block rather than one long strip,
// preferring to break right after punctuation or a space near the end of each line.
const wrapText = (text) => {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_CHARS)
  const lines = []
  while (chars.length > CHARS_PER_LINE) {
    let cut = CHARS_PER_LINE
    for (let i = CHARS_PER_LINE; i > CHARS_PER_LINE - 3; i -= 1) {
      if (BREAK_AFTER.test(chars[i - 1])) {
        cut = i
        break
      }
    }
    lines.push(chars.splice(0, cut).join('').trim())
  }
  lines.push(chars.join('').trim())
  return lines.filter(Boolean).join('\n')
}

// ---------- DOM ----------

const $ = (id) => document.getElementById(id)
const caption = $('caption')
const hint = $('hint')
const micButton = $('mic')
const clearButton = $('clear')
const typeForm = $('type-form')
const typeInput = $('type-input')
const toastEl = $('toast')

let toastTimer = null
const toast = (message, ms = 2400) => {
  toastEl.textContent = message
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.hidden = true
  }, ms)
}

const setListening = (listening) => {
  document.body.classList.toggle('listening', listening)
  micButton.setAttribute('aria-label', listening ? '話し終える' : '話す')
  hint.textContent = listening ? '話し終えたらもう一度タップ' : 'タップして話す'
}

// ---------- Messages ----------

let placedCount = 0
let captionTimer = null
let speechFailed = false // an error was already reported for this attempt

const showMessage = async (text) => {
  const wrapped = wrapText(text)
  if (!wrapped) {
    caption.textContent = ''
    return
  }
  caption.textContent = text
  const placed = await scene.spawnInFront({text: wrapped, ...messageStyle()})
  if (!placed) {
    toast('カメラの準備ができてから、もう一度試してください')
  }
  // The caption has done its job once the words are floating in the scene.
  clearTimeout(captionTimer)
  captionTimer = setTimeout(() => {
    caption.textContent = ''
  }, 1200)
}

const speech = createSpeech({
  onInterim: (text) => {
    clearTimeout(captionTimer)
    caption.textContent = text
  },
  onEnd: (text) => {
    setListening(false)
    if (text) {
      showMessage(text)
    } else {
      caption.textContent = ''
      if (!speechFailed) {
        toast('うまく聞き取れませんでした')
      }
    }
  },
  onError: (error) => {
    speechFailed = true
    toast(error === 'not-allowed' || error === 'service-not-allowed'
      ? 'マイクの使用を許可してください'
      : '音声認識が使えませんでした')
  },
})

micButton.addEventListener('click', () => {
  if (!speech.supported) {
    typeForm.hidden = !typeForm.hidden
    if (!typeForm.hidden) {
      typeInput.focus()
    }
    return
  }
  if (speech.listening) {
    speech.stop()
  } else {
    caption.textContent = ''
    speechFailed = false
    setListening(true)
    speech.start()
  }
})

typeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = typeInput.value
  typeInput.value = ''
  typeForm.hidden = true
  typeInput.blur()
  showMessage(text)
})

clearButton.addEventListener('click', () => {
  scene.clearAll()
  placedCount = 0
  clearButton.hidden = true
})

if (!speech.supported) {
  hint.textContent = 'タップして入力(このブラウザは音声認識に未対応)'
}

// ---------- AR scene ----------

const scene = createScenePipeline({
  // Text only ever appears by voice, so tapping empty space places nothing; tapping a message
  // still selects it so it can be dragged / pinched like in TYPO CAM.
  getPlacementOptions: () => null,
  onNeedText: () => {},
  onPlaced: () => {
    placedCount += 1
    clearButton.hidden = placedCount === 0
  },
  onSelectionChange: () => {},
  onScaleChange: () => {},
  onFrameRendered: () => {},
})

const onxrloaded = () => {
  XR8.addCameraPipelineModules([  // Add camera pipeline modules.
    // Existing pipeline modules.
    XR8.GlTextureRenderer.pipelineModule(),      // Draws the camera feed.
    XR8.Threejs.pipelineModule(),                // Creates a ThreeJS AR Scene.
    XR8.XrController.pipelineModule(),           // Enables SLAM tracking.
    LandingPage.pipelineModule(),         // Detects unsupported browsers and gives hints.
    XRExtras.FullWindowCanvas.pipelineModule(),  // Modifies the canvas to fill the window.
    XRExtras.Loading.pipelineModule(),           // Manages the loading screen on startup.
    XRExtras.RuntimeError.pipelineModule(),      // Shows an error image on runtime error.
    // Custom pipeline module: message placement + motion. Added last so its onRender runs after
    // the Threejs module has already drawn the camera + AR scene for this frame.
    scene.pipelineModule,
  ])

  const canvas = document.getElementById('camerafeed')
  // Open the camera and start running the camera run loop.
  XR8.run({canvas})
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
