import { ComposerPill, Plugin, Style } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { formatRemainingTime, status } from "./peak.ts"

const formatUtcClock = (date: Date) =>
  `${date.toUTCString().slice(0, 3)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`

// The pill has no color field; its phase only reaches CSS through the aria-label it takes from `title`.
const css = `
[data-slot="session-plugin-pill"][aria-label^="peak"] { color: var(--v2-state-fg-warning) }
[data-slot="session-plugin-pill"][aria-label^="off-peak"] { color: var(--v2-state-fg-success) }
`

export default Plugin.define({
  setup(ctx) {
    const [now, setNow] = createSignal(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => clearInterval(timer))

    ctx.add(Style, css)

    ctx.add(ComposerPill, {
      id: "peak",
      show: (input) => {
        const model = input.screen.composer.model()
        if (!model) return

        const nowMs = now()
        const peakState = status(new Date(nowMs), model.providerID, model.modelID)
        if (!peakState) return

        const phase = peakState.isPeak ? "peak" : "off-peak"
        return {
          label: `${phase} · ${formatRemainingTime(peakState.nextTransitionAt.getTime() - nowMs)}`,
          title: `${phase} pricing until ${formatUtcClock(peakState.nextTransitionAt)}`,
        }
      },
    })
  },
})
