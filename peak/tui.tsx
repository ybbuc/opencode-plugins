/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { remaining, status } from "./peak.ts"

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

        const at = now()
        const state = status(new Date(at), model.providerID, model.modelID)
        if (!state) return null

        return <text>{`${state.peak ? "peak" : "off-peak"} · ${remaining(state.until.getTime() - at)} left`}</text>
      },
    })

    return () => clearInterval(tick)
  },
})
