import type { Plugin } from "@opencode/plugin/tui"

const LINK_PATTERN = /\[([^\[\]]*)\]\((https?:\/\/[^\s<>"'`]+)|(https?:\/\/[^\s<>"'`]+)/gi
const TRAILING_PUNCTUATION = /[\],.;:!?}*]+$/

type QuickLink = { url: string; title?: string }

function trimLink(url: string) {
  let depth = 0

  for (let index = 0; index < url.length; index++) {
    if (url[index] === "(") depth++
    if (url[index] !== ")") continue
    if (depth === 0) return url.slice(0, index).replace(TRAILING_PUNCTUATION, "")
    depth--
  }

  return url.replace(TRAILING_PUNCTUATION, "")
}

type Message = ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>[number]

function messageTexts(message: Message) {
  if (message.type === "user") return [message.text]
  if (message.type !== "assistant") return []
  return message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
}

export function extractLinks(messages: Message[]) {
  const found: QuickLink[] = []

  for (const message of messages) {
    for (const text of messageTexts(message)) {
      for (const match of text.matchAll(LINK_PATTERN)) {
        try {
          const raw = match[2] ?? match[3]
          const title = match[1]?.replace(/(?<![\\`])(`+)(?!`)([^`]+)\1(?!`)/g, "$2").trim() || undefined
          const parsed = new URL(trimLink(raw))
          if (parsed.protocol === "http:" || parsed.protocol === "https:") found.push({ url: parsed.href, title })
        } catch {}
      }
    }
  }

  const links = new Map<string, string | undefined>()
  for (const { url, title } of found.reverse()) {
    if (!links.get(url)) links.set(url, title)
  }

  return Array.from(links, ([url, title]) => ({ url, title }))
}
