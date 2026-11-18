// Speech-to-text for one short message at a time, via the browser's Web Speech API (iOS Safari
// 14.5+, Chrome on Android/desktop). `start()` listens until the speaker pauses (the browser ends
// the session itself) or `stop()` is called; meanwhile `onInterim` gets the words recognized so
// far, and `onEnd` gets the whole message once it's over ('' if nothing was understood).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition

export const createSpeech = ({lang = 'ja-JP', onInterim, onEnd, onError}) => {
  let recognition = null
  let finalText = ''
  let interimText = ''

  const start = () => {
    if (!Recognition || recognition) {
      return
    }
    finalText = ''
    interimText = ''
    recognition = new Recognition()
    recognition.lang = lang
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      interimText = interim
      onInterim(finalText + interimText)
    }
    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' just mean nothing was said; onend still follows.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        onError(event.error)
      }
    }
    recognition.onend = () => {
      recognition = null
      // Safari sometimes ends without ever marking the last result final; keep what was heard.
      onEnd((finalText || interimText).trim())
    }
    recognition.start()
  }

  const stop = () => {
    if (recognition) {
      recognition.stop()
    }
  }

  return {
    supported: !!Recognition,
    start,
    stop,
    get listening() {
      return !!recognition
    },
  }
}
