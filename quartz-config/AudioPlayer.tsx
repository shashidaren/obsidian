import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// @ts-ignore
import script from "./scripts/audioplayer.inline"
import styles from "./styles/audioplayer.scss"

const AudioPlayer: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return (
    <div class={classNames(displayClass, "audio-player")}>
      <button id="listen-note-btn" class="listen-note-btn" type="button" aria-pressed="false">
        <span class="listen-icon" aria-hidden="true">
          ▶
        </span>
        <span class="listen-label">Listen</span>
      </button>
      <p class="listen-hint">Tap Listen. On Android keep Chrome in the foreground and volume up.</p>
    </div>
  )
}

AudioPlayer.afterDOMLoaded = script
AudioPlayer.css = styles

export default (() => AudioPlayer) satisfies QuartzComponentConstructor
