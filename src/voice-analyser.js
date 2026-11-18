// Listens to the microphone alongside speech recognition and sums up *how* something was said:
// how loud (loudness), how soft / breathy rather than bright and sharp (softness), and how much
// the volume jumps around (liveliness), each 0..1. While listening, `onLevel` gets the live input
// level (0..1) every frame for the mic button's halo.
const FFT_SIZE = 2048
const GATE_DB = -52 // frames quieter than this are silence between words, not voice
const LOUD = {min: -42, max: -14} // mean voiced level (dBFS) mapped to loudness 0..1
const BRIGHT = {min: 900, max: 2600} // spectral centroid (Hz) mapped to softness 1..0
const LIVELY = {min: 0.25, max: 0.9} // coefficient of variation of the voiced level -> 0..1

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const normalize = (x, {min, max}) => clamp01((x - min) / (max - min))
const toDb = (rms) => 20 * Math.log10(Math.max(rms, 1e-8))
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length

export const NEUTRAL_VOICE = {loudness: 0.5, softness: 0.5, liveliness: 0.5, voiced: false}

export const createVoiceAnalyser = ({onLevel = () => {}} = {}) => {
  let context = null
  let session = null

  // Must be called from a user gesture (the mic tap) so the AudioContext may start. Resolves
  // with the mic stream (Phase 3 records it), or null if the mic can't be opened.
  const start = async () => {
    stop()
    try {
      // Created / resumed before the first await, while still inside the user's tap.
      context = context || new (window.AudioContext || window.webkitAudioContext)()
      context.resume()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: false, autoGainControl: false},
      })
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      session = {
        stream,
        source,
        analyser,
        wave: new Float32Array(analyser.fftSize),
        spectrum: new Float32Array(analyser.frequencyBinCount),
        levels: [], // voiced frames' RMS
        centroids: [], // voiced frames' spectral centroid, Hz
        frame: 0,
      }
      tick()
      return stream
    } catch (error) {
      console.warn('Voice analysis unavailable:', error)
      session = null
      return null
    }
  }

  const tick = () => {
    const s = session
    if (!s) {
      return
    }
    s.analyser.getFloatTimeDomainData(s.wave)
    let sum = 0
    for (let i = 0; i < s.wave.length; i += 1) {
      sum += s.wave[i] * s.wave[i]
    }
    const rms = Math.sqrt(sum / s.wave.length)
    const db = toDb(rms)
    onLevel(normalize(db, {min: GATE_DB, max: LOUD.max}))

    if (db > GATE_DB) {
      s.levels.push(rms)
      s.analyser.getFloatFrequencyData(s.spectrum)
      const binHz = context.sampleRate / s.analyser.fftSize
      let weighted = 0
      let total = 0
      // 80 Hz - 8 kHz: where the voice is; skips hum below and hiss above.
      for (let i = Math.ceil(80 / binHz); i < Math.min(s.spectrum.length, 8000 / binHz); i += 1) {
        const magnitude = 10 ** (s.spectrum[i] / 20)
        weighted += magnitude * i * binHz
        total += magnitude
      }
      if (total > 0) {
        s.centroids.push(weighted / total)
      }
    }
    s.frame = requestAnimationFrame(tick)
  }

  // Stops listening and resolves the summary of what was heard (NEUTRAL_VOICE if too little).
  const stop = () => {
    const s = session
    session = null
    if (!s) {
      return NEUTRAL_VOICE
    }
    cancelAnimationFrame(s.frame)
    s.source.disconnect()
    s.stream.getTracks().forEach((track) => track.stop())
    onLevel(0)
    if (s.levels.length < 8) {
      return NEUTRAL_VOICE
    }
    const levelMean = mean(s.levels)
    const levelSd = Math.sqrt(mean(s.levels.map((x) => (x - levelMean) ** 2)))
    return {
      loudness: normalize(toDb(levelMean), LOUD),
      softness: s.centroids.length ? 1 - normalize(mean(s.centroids), BRIGHT) : 0.5,
      liveliness: normalize(levelSd / levelMean, LIVELY),
      voiced: true,
    }
  }

  return {
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    start,
    stop,
  }
}
