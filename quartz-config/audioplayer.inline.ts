document.addEventListener("nav", () => {
  const btn = document.getElementById("listen-note-btn") as HTMLButtonElement | null
  if (!btn) return

  const synth = window.speechSynthesis

  const setPlaying = (playing: boolean) => {
    btn.setAttribute("aria-pressed", playing ? "true" : "false")
    btn.classList.toggle("is-playing", playing)
    const icon = btn.querySelector(".listen-icon")
    const label = btn.querySelector(".listen-label")
    if (icon) icon.textContent = playing ? "■" : "▶"
    if (label) label.textContent = playing ? "Stop" : "Listen"
  }

  const stop = () => {
    if (synth) synth.cancel()
    setPlaying(false)
  }

  const getText = () => {
    const article = document.querySelector("article")
    if (!article) return ""
    const clone = article.cloneNode(true) as HTMLElement
    clone.querySelectorAll("pre, .audio-player, .tag-list, .popover-hint").forEach((el) => el.remove())
    return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim()
  }

  const speak = () => {
    if (!synth) {
      alert(
        "Text-to-speech is not available here. On iPhone use aA → Listen to Page. On Android Chrome use Listen to this page.",
      )
      return
    }

    const text = getText()
    if (!text) return

    stop()

    const chunks = text.match(/[\s\S]{1,380}(?=\s|$)|[\s\S]+/g) || [text]
    let i = 0

    const next = () => {
      if (i >= chunks.length) {
        setPlaying(false)
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[i++])
      utterance.rate = 1.02
      utterance.onend = next
      utterance.onerror = () => setPlaying(false)
      synth.speak(utterance)
    }

    setPlaying(true)
    next()
  }

  const onClick = () => {
    if (synth?.speaking) stop()
    else speak()
  }

  btn.addEventListener("click", onClick)
  window.addCleanup(() => {
    btn.removeEventListener("click", onClick)
    stop()
  })
})
