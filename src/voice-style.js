// Turns how a message was said (voice-analyser.js) into how it looks and moves: loud voices make
// big, heavy, bouncing letters; soft voices make rounded letters that drift slowly; lively,
// up-and-down voices wobble more. Changes are deliberately small -- the words stay readable.
const lerp = (a, b, k) => a + (b - a) * k

const pickFont = ({loudness, softness}) => {
  if (loudness > 0.72) return 'bold'
  if (softness > 0.6 && loudness < 0.45) return 'maru'
  return 'gothic'
}

const pickColor = ({loudness, softness}) => {
  if (loudness > 0.8) return '#ffe066' // a shout glows warm
  if (softness > 0.65 && loudness < 0.4) return '#fdf1ff' // a whisper is a touch pastel
  return '#ffffff'
}

// A short word or two on screen that tells the speaker their voice did something.
const describe = ({loudness, softness, liveliness}) => {
  if (loudness > 0.72) return '大きな声'
  if (loudness < 0.3) return 'ささやき声'
  if (softness > 0.6) return 'やわらかい声'
  if (liveliness > 0.65) return 'はずむ声'
  return null
}

export const styleFromVoice = (voice) => {
  const {loudness, softness, liveliness} = voice
  // Loud, lively speech pops; everything else floats, slower the softer it was said.
  const bouncy = loudness > 0.62 && liveliness > 0.45
  return {
    fontId: pickFont(voice),
    color: pickColor(voice),
    look: {
      depthRatio: lerp(0.1, 0.24, loudness),
      roughness: lerp(0.35, 0.65, softness),
      emissive: loudness > 0.8 ? 0.25 : 0,
    },
    motion: bouncy ? 'pop' : 'float',
    motionParams: {
      speed: lerp(2.4, 0.9, softness) * lerp(0.9, 1.4, liveliness),
      lift: lerp(0.03, 0.09, liveliness),
      sway: lerp(0.04, 0.16, Math.max(softness, liveliness)),
      bounce: lerp(0.1, 0.24, loudness),
    },
    size: lerp(0.75, 1.6, loudness),
    label: voice.voiced ? describe(voice) : null,
  }
}
