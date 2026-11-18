// Records the AR view as a video (from Font AR, via TYPO CAM). The AR canvas only holds the camera
// feed and the 3D scene, so each frame is copied onto a separate 2D canvas first, with anything
// extra painted on top by `drawOverlay`; that 2D canvas is what gets recorded. TYPO VOICE adds the
// speaker's voice: `start({audioStream})` records that stream's audio alongside (the recorder
// takes ownership of those tracks and stops them when done). The video lives only in memory, as
// a File the caller holds on to until it's dismissed.

// MP4 first (iOS Safari records it; recent Chrome too), WebM as the fallback for older Chrome/Firefox.
// With audio, the types that name an audio codec too come first (a video-only codec list can make
// the recorder reject the audio track).
const AUDIO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]
const MAX_VIDEO_WIDTH = 720 // downscaled from the (device-pixel) AR canvas to keep encoding light
const FRAME_RATE = 30
const VIDEO_BITS_PER_SECOND = 2_500_000

const pickMimeType = (withAudio = false) => {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return null
  }
  return (withAudio ? AUDIO_MIME_CANDIDATES : MIME_CANDIDATES).find((type) => MediaRecorder.isTypeSupported(type)) || null
}

export const createRunRecorder = ({getSourceCanvas, drawOverlay = () => {}, filePrefix = 'font-ar'}) => {
  const supported = !!pickMimeType()
  let session = null

  const stopTracks = (s) => s.stream.getTracks().forEach((track) => track.stop())
  const cleanup = (s) => {
    stopTracks(s)
    s.canvas.remove()
  }

  const discard = () => {
    const s = session
    session = null
    if (!s) {
      return
    }
    s.recorder.ondataavailable = null
    s.recorder.onstop = null
    if (s.recorder.state !== 'inactive') {
      s.recorder.stop()
    }
    cleanup(s)
  }

  // Begins a fresh recording, throwing away any one still in progress. Never throws: if the
  // browser refuses (an unsupported option, say), there's just no recording for this run.
  const start = ({audioStream = null} = {}) => {
    discard()
    const source = getSourceCanvas()
    const audioTracks = audioStream ? audioStream.getAudioTracks() : []
    const mimeType = pickMimeType(audioTracks.length > 0)
    if (!mimeType || !source || !source.width || !source.height) {
      audioTracks.forEach((track) => track.stop())
      return
    }
    let canvas = null
    try {
      const width = Math.min(source.width, MAX_VIDEO_WIDTH)
      const height = Math.round((width * source.height) / source.width)
      canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      // Kept in the page (invisible, 1px) rather than detached: Safari doesn't reliably feed
      // frames from a canvas that isn't part of the document into a captured stream.
      canvas.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
      document.body.appendChild(canvas)
      const stream = new MediaStream([...canvas.captureStream(FRAME_RATE).getVideoTracks(), ...audioTracks])
      const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND})
      const chunks = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      session = {recorder, stream, canvas, ctx: canvas.getContext('2d'), chunks, source, mimeType}
      recorder.start(1000)
    } catch (error) {
      console.warn('Run recording unavailable:', error)
      session = null
      audioTracks.forEach((track) => track.stop())
      if (canvas) {
        canvas.remove()
      }
    }
  }

  // Call once per rendered frame, after the AR canvas has been drawn for that frame.
  const captureFrame = () => {
    if (!session) {
      return
    }
    const {ctx, canvas, source} = session
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    // The HUD is laid out in CSS pixels; the video is in its own pixel size.
    drawOverlay(ctx, canvas.width / (window.innerWidth || canvas.width))
  }

  // Stops the recording and resolves with the finished video as a File (null if nothing was
  // recording or the browser can't record).
  const finish = () =>
    new Promise((resolve) => {
      const s = session
      if (!s) {
        resolve(null)
        return
      }
      captureFrame() // make sure the very last frame (the one that cleared) is in the video
      session = null
      s.recorder.onstop = () => {
        cleanup(s)
        const baseType = s.mimeType.split(';')[0]
        const extension = baseType === 'video/mp4' ? 'mp4' : 'webm'
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        resolve(s.chunks.length ? new File(s.chunks, `${filePrefix}-${stamp}.${extension}`, {type: baseType}) : null)
      }
      s.recorder.stop()
    })

  return {supported, start, captureFrame, finish, discard, get recording() { return !!session }}
}
