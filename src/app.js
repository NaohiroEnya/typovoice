// app.js is the main entry point for TYPO VOICE: it boots the 8th Wall camera pipeline (unchanged
// from TYPO CAM / Font Photo AR), listens for a spoken message (speech.js) while measuring how it
// was said (voice-analyser.js). The words appear in space as they're recognized (live-text.js via
// scene.js), and once the speaker stops they settle into one message styled by the voice
// (voice-style.js), floating where they were spoken. Each message is recorded as a short video
// with the voice (run-recorder.js), which can be saved or sent along with a link that floats the
// same message in the recipient's space (message-link.js).
import * as THREE from 'three'

import {createScenePipeline} from './scene'
import {createSpeech} from './speech'
import {createVoiceAnalyser, NEUTRAL_VOICE} from './voice-analyser'
import {styleFromVoice} from './voice-style'
import {wrapText} from './wrap'
import {COLORS, DEFAULT_COLOR_ID, findColor} from './colors'
import {createRunRecorder} from './run-recorder'
import {messageToUrl, messageFromUrl, clearMessageFromUrl} from './message-link'

window.THREE = THREE

// A typed message (no voice to measure) gets a little louder with each '!'.
const voiceFromTyping = (text) => {
  const bangs = (text.match(/[!！]/g) || []).length
  return {...NEUTRAL_VOICE, loudness: Math.min(1, NEUTRAL_VOICE.loudness + bangs * 0.2)}
}

// ---------- DOM ----------

const $ = (id) => document.getElementById(id)
const hint = $('hint')
const micButton = $('mic')
const clearButton = $('clear')
const voiceTag = $('voice-tag')
const typeForm = $('type-form')
const typeInput = $('type-input')
const toastEl = $('toast')
const colorButton = $('color-open')
const colorDot = $('color-dot')
const colorRow = $('color-row')
const recBadge = $('rec-badge')
const clipButton = $('clip-open')
const result = $('result')
const resultVideo = $('result-video')
const resultSend = $('result-send')
const resultLink = $('result-link')
const resultClose = $('result-close')
const inbox = $('inbox')

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

// ---------- Color ----------

const COLOR_KEY = 'typovoice.color'
const loadColorId = () => {
  try {
    return localStorage.getItem(COLOR_KEY) || DEFAULT_COLOR_ID
  } catch {
    return DEFAULT_COLOR_ID
  }
}
let colorId = findColor(loadColorId()).id
let selectedMessage = null // options of the placed message the user tapped, if any

COLORS.forEach(({id, label, hex}) => {
  const swatch = document.createElement('button')
  swatch.type = 'button'
  swatch.className = 'swatch'
  swatch.dataset.color = id
  swatch.style.setProperty('--swatch', hex)
  swatch.setAttribute('aria-label', label)
  swatch.addEventListener('click', () => setColor(id))
  colorRow.appendChild(swatch)
})

const renderColor = () => {
  colorDot.style.background = findColor(colorId).hex
  colorRow.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.setAttribute('aria-pressed', swatch.dataset.color === colorId)
  })
}

// The chosen color is used for every new message; a selected message is recolored too.
const setColor = (id) => {
  colorId = id
  try {
    localStorage.setItem(COLOR_KEY, id)
  } catch {
    // private mode etc.: just not remembered
  }
  renderColor()
  if (selectedMessage) {
    selectedMessage = {...selectedMessage, color: findColor(id).hex}
    scene.updateSelected(selectedMessage)
  }
}

const closeColors = () => {
  colorRow.hidden = true
  colorButton.setAttribute('aria-expanded', 'false')
}

const openColors = () => {
  colorRow.hidden = false
  colorButton.setAttribute('aria-expanded', 'true')
  const current = colorRow.querySelector(`[data-color="${colorId}"]`)
  colorRow.scrollLeft = current.offsetLeft - (colorRow.clientWidth - current.offsetWidth) / 2
}

colorButton.addEventListener('click', () => {
  if (colorRow.hidden) {
    openColors()
  } else {
    closeColors()
  }
})

renderColor()

// ---------- Messages ----------

let placedCount = 0
let tagTimer = null
let speechFailed = false // an error was already reported for this attempt
let live = null // the words being spoken, shown in space as they're recognized
let level = 0 // live input level, 0..1

// While speaking, the words are plain (in the chosen color); the voice's style lands when the
// message is finished.
const liveStyle = () => {
  const {fontId, color, look} = styleFromVoice(NEUTRAL_VOICE, {color: findColor(colorId).hex})
  return {fontId, color, look}
}

const flashTag = (label) => {
  voiceTag.textContent = label || ''
  clearTimeout(tagTimer)
  tagTimer = setTimeout(() => {
    voiceTag.textContent = ''
  }, 1600)
}

// `pose`: where the live words were, so the finished message replaces them in place. Resolves
// with the placed message's options (for its recording and link), or null.
const showMessage = async (text, voice, pose = null) => {
  const wrapped = wrapText(text)
  if (!wrapped) {
    return null
  }
  const message = {text: wrapped, ...styleFromVoice(voice, {text, color: findColor(colorId).hex})}
  const placed = await scene.spawnInFront(message, pose)
  if (!placed) {
    toast('カメラの準備ができてから、もう一度試してください')
    return null
  }
  flashTag(message.label)
  return message
}

// ---------- Recording (Phase 3) ----------

// Each message is recorded from the moment the mic is tapped -- voice, words popping in, the
// styled message landing -- until it has floated for TAIL_SECONDS more.
const TAIL_SECONDS = 2.5
const MAX_CLIP_SECONDS = 30

// A small signature in the corner of every video, so a forwarded clip says where it came from.
const drawWatermark = (ctx, scale) => {
  const size = Math.round(13 * scale)
  ctx.save()
  ctx.font = `700 ${size}px -apple-system, 'Hiragino Sans', sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
  ctx.shadowBlur = 4 * scale
  ctx.textBaseline = 'bottom'
  ctx.fillText('TYPO VOICE', 14 * scale, ctx.canvas.height - 14 * scale)
  ctx.restore()
}

const recorder = createRunRecorder({
  getSourceCanvas: () => document.getElementById('camerafeed'),
  drawOverlay: drawWatermark,
  filePrefix: 'typovoice',
})
let take = null // the recording in progress: {timer, message (once it has landed)}
let clip = null // the latest finished recording: {file, message, url}

const startTake = (audioStream = null) => {
  recorder.start({audioStream})
  if (!recorder.recording) {
    return
  }
  recBadge.hidden = false
  take = {timer: setTimeout(() => endTake(null), MAX_CLIP_SECONDS * 1000)}
}

// Stops the recording; with a message, keeps it as the latest clip, otherwise throws it away.
const endTake = async (message) => {
  if (!take) {
    return
  }
  clearTimeout(take.timer)
  take = null
  recBadge.hidden = true
  if (!message) {
    recorder.discard()
    return
  }
  const file = await recorder.finish()
  if (file) {
    setClip({file, message})
  }
}

// Lets the message float a little longer on camera, then stops.
const endTakeAfterTail = (message) => {
  if (take) {
    clearTimeout(take.timer)
    take.message = message
    take.timer = setTimeout(() => endTake(message), TAIL_SECONDS * 1000)
  }
}

const setClip = (next) => {
  if (clip) {
    URL.revokeObjectURL(clip.url)
  }
  clip = {...next, url: URL.createObjectURL(next.file)}
  clipButton.classList.remove('is-empty')
  clipButton.classList.remove('is-new')
  void clipButton.offsetWidth // restart the "new clip" bounce
  clipButton.classList.add('is-new')
}

// ---------- Sending (Phase 4) ----------

const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({files: [file]}))

const openResult = () => {
  if (!clip) {
    return
  }
  closeColors()
  resultSend.textContent = canShareFile(clip.file) ? '動画を送る・保存' : '動画を保存'
  resultVideo.src = clip.url
  result.hidden = false
  // Opened by a tap, so playing with sound is allowed; fall back to muted if it isn't.
  resultVideo.muted = false
  resultVideo.play().catch(() => {
    resultVideo.muted = true
    resultVideo.play().catch(() => {})
  })
}

const closeResult = () => {
  resultVideo.pause()
  result.hidden = true
}

const download = (file) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// The video, through the share sheet where files can be shared (iOS: LINE, Messages, "Save
// Video"...), otherwise downloaded.
const sendVideo = async () => {
  const {file} = clip
  if (canShareFile(file)) {
    try {
      await navigator.share({files: [file], title: 'TYPO VOICE'})
    } catch (error) {
      if (error.name !== 'AbortError') {
        download(file)
      }
    }
    return
  }
  download(file)
  toast('動画を保存しました')
}

// A link that floats the same message in the recipient's own space.
const sendLink = async () => {
  const url = messageToUrl(clip.message)
  const text = `「${clip.message.text.replace(/\n/g, '')}」 声のメッセージが届いています`
  if (navigator.share) {
    try {
      await navigator.share({title: 'TYPO VOICE', text, url})
      return
    } catch (error) {
      if (error.name === 'AbortError') {
        return
      }
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast('リンクをコピーしました')
  } catch {
    window.prompt('このリンクをコピーして送ってください', url)
  }
}

clipButton.addEventListener('click', openResult)
resultClose.addEventListener('click', closeResult)
resultSend.addEventListener('click', sendVideo)
resultLink.addEventListener('click', sendLink)

// Opened from someone's link: show what arrived, and float it here on a tap.
const received = messageFromUrl()
if (received) {
  $('inbox-text').textContent = received.text.replace(/\n/g, '')
  $('inbox-label').textContent = received.label
  inbox.hidden = false
  $('inbox-place').addEventListener('click', async () => {
    const placed = await scene.spawnInFront(received)
    if (!placed) {
      toast('カメラの準備ができてから、もう一度タップしてください')
      return
    }
    inbox.hidden = true
    clearMessageFromUrl()
    flashTag(received.label)
  })
}

const analyser = createVoiceAnalyser({
  onLevel: (value) => {
    level = value
    micButton.style.setProperty('--level', value.toFixed(3))
  },
})
// Turned off for good if opening the mic for analysis keeps speech recognition from hearing
// (a browser that allows only one capture at a time); messages then just use the neutral style.
let analyserEnabled = analyser.supported

const speech = createSpeech({
  onInterim: (text) => {
    if (live) {
      live.setText(text)
    }
  },
  onEnd: async (text) => {
    setListening(false)
    const voice = analyser.stop()
    const pose = live && live.pose
    if (live) {
      live.finish()
      live = null
    }
    if (text) {
      const message = await showMessage(text, voice, pose)
      if (message) {
        endTakeAfterTail(message)
      } else {
        endTake(null)
      }
    } else {
      endTake(null)
      if (!speechFailed) {
        toast('うまく聞き取れませんでした')
      }
    }
  },
  onError: (error) => {
    speechFailed = true
    if (error === 'audio-capture' && analyserEnabled) {
      analyserEnabled = false
      toast('もう一度話してみてください')
      return
    }
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
    speechFailed = false
    voiceTag.textContent = ''
    closeColors()
    if (take) {
      endTake(take.message) // the previous message's tail: keep what was recorded so far
    }
    live = scene.startLive(liveStyle(), () => level)
    setListening(true)
    // Recognition first, while still inside the tap: some browsers only start it from a gesture.
    speech.start()
    if (analyserEnabled) {
      // The recording gets its own copy of the mic, since the analyser lets go of it as soon as
      // the speaker stops while the recording runs on through the tail.
      analyser.start().then((stream) => {
        if (speech.listening) {
          startTake(stream && new MediaStream(stream.getAudioTracks().map((track) => track.clone())))
        }
      })
    } else {
      startTake()
    }
  }
})

typeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = typeInput.value
  typeInput.value = ''
  typeForm.hidden = true
  typeInput.blur()
  if (take) {
    endTake(take.message)
  }
  startTake()
  showMessage(text, voiceFromTyping(text)).then((message) => {
    if (message) {
      endTakeAfterTail(message)
    } else {
      endTake(null)
    }
  })
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
  // Tapping a placed message selects it so the color row can recolor it (and it can be dragged /
  // pinched like in TYPO CAM); tapping empty space deselects.
  onSelectionChange: (options) => {
    selectedMessage = options
    if (options) {
      const match = COLORS.find((c) => c.hex === options.color)
      if (match) {
        colorId = match.id
        renderColor()
      }
      openColors()
    }
  },
  onScaleChange: () => {},
  onFrameRendered: () => recorder.captureFrame(),
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
