document.addEventListener("nav", () => {
  const btn = document.getElementById("listen-note-btn") as HTMLButtonElement | null
  const hint = document.querySelector(".listen-hint") as HTMLElement | null
  if (!btn) return

  const synth = window.speechSynthesis
  let playing = false
  let timer: number | undefined

  const setHint = (text: string) => {
    if (hint) hint.textContent = text
  }

  const setPlaying = (on: boolean) => {
    playing = on
    btn.setAttribute("aria-pressed", on ? "true" : "false")
    btn.classList.toggle("is-playing", on)
    const icon = btn.querySelector(".listen-icon")
    const label = btn.querySelector(".listen-label")
    if (icon) icon.textContent = on ? "■" : "▶"
    if (label) label.textContent = on ? "Stop" : "Listen"
  }

  const pickVoice = () => {
    const voices = synth?.getVoices?.() || []
    return (
      voices.find((v) => /en-US/i.test(v.lang) && /google/i.test(v.name)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      voices[0] ||
      null
    )
  }

  // Warm the voice list; Android Chrome often returns [] until this runs.
  try {
    synth?.getVoices?.()
  } catch {
    /* ignore */
  }
  synth?.addEventListener?.("voiceschanged", () => pickVoice())

  const stop = () => {
    if (timer) window.clearTimeout(timer)
    try {
      synth?.cancel()
    } catch {
      /* ignore */
    }
    setPlaying(false)
    setHint("Stopped. Tap Listen to start again.")
  }

  const getText = () => {
    const article = document.querySelector("article")
    if (!article) return ""
    const clone = article.cloneNode(true) as HTMLElement
    clone.querySelectorAll("pre, .audio-player, .tag-list").forEach((el) => el.remove())
    return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim()
  }

  const speak = () => {
    if (!synth) {
      setHint("This browser has no speech engine. Use Chrome menu → Listen to this page.")
      return
    }

    const text = getText()
    if (!text) {
      setHint("No readable text found on this page.")
      return
    }

    const chunks = text.match(/[\s\S]{1,220}(?=\s|$)|[\s\S]+/g) || [text]
    let i = 0
    const voice = pickVoice()

    const next = () => {
      if (!playing) return
      if (i >= chunks.length) {
        setPlaying(false)
        setHint("Finished.")
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[i++])
      utterance.lang = voice?.lang || "en-US"
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 1
      if (voice) utterance.voice = voice
      utterance.onend = next
      utterance.onerror = (ev) => {
        setPlaying(false)
        setHint(`Speech failed (${ev.error || "unknown"}). Use Chrome ⋮ → Listen to this page.`)
      }
      synth.speak(utterance)
    }

    setPlaying(true)
    setHint(voice ? `Speaking with ${voice.name}…` : "Speaking… keep the screen on.")

    // Android Chrome drops speak() if it follows cancel() in the same tick.
    try {
      synth.cancel()
    } catch {
      /* ignore */
    }
    timer = window.setTimeout(() => {
      if (synth.paused) {
        try {
          synth.resume()
        } catch {
          /* ignore */
        }
      }
      next()
    }, 120)
  }

  const onClick = (ev: Event) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (playing || synth?.speaking) stop()
    else speak()
  }

  btn.addEventListener("click", onClick)
  window.addCleanup(() => {
    btn.removeEventListener("click", onClick)
    if (timer) window.clearTimeout(timer)
    try {
      synth?.cancel()
    } catch {
      /* ignore */
    }
  })
})
