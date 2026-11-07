/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { formatRemainingTime, status } from "./peak.ts"

export default Plugin.define({
  id: "peak",
  setup(ctx) {
    const [now, setNow] = createSignal(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 60_000)

    ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const model = ctx.ui.model.current()
        if (!model) return null

        const nowMs = now()
        const peakState = status(new Date(nowMs), model.providerID, model.modelID)
        if (!peakState) return null

        return <text>{`${peakState.isPeak ? "peak" : "off-peak"} · ${formatRemainingTime(peakState.nextTransitionAt.getTime() - nowMs)} left`}</text>
      },
    })

    return () => clearInterval(tick)
  },
})
