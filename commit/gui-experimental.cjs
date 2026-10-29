"use strict"
const { Command, Plugin } = require("@opencode/plugin/gui")

module.exports = Plugin.define({
  setup(ctx) {
    ctx.add(Command, () => ({
      id: "commit",
      title: "Commit working tree",
      section: "session",
      bind: "mod+shift+c",
      slash: { name: "commit" },
      enabled: ctx.sessions.current() !== undefined,
      run: () => {
        const session = ctx.sessions.current()
        if (!session) return false

        void (async () => {
          const skills = await ctx.client.skill.list()
          const skill = skills.data.find((entry) => entry.name === "commit")
          if (!skill) {
            ctx.toast.show({ title: "Commit", description: "No commit skill loaded", variant: "error" })
            return
          }

          await ctx.client.experimental.session.skill({ sessionID: session.id, id: skill.id })
        })()
      },
    }))
  },
})
