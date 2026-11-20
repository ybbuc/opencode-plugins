# OpenCode plugins

Plugins for [OpenCode V2](https://opencode.ai/v2/docs/) that help you write Git commits, track model pricing and account usage, find links without scrolling, and resume a session with one key. Pick the plugins you want; none requires enabling the others.

- **[commit](#commit)** — a commit-writing skill with Git context and message-validation tools.
- **[copilot-usage](#copilot-usage)** — an opt-in local log of finished GitHub Copilot turns.
- **[peak](#peak)** — peak/off-peak pricing status and a countdown in the terminal and desktop app.
- **[quota](#quota)** — account usage, reset times, and usage projections for supported providers.
- **[quick-links](#quick-links)** — search and open links from the active conversation by their titles.
- **[keep-going](#keep-going)** — press Enter on an empty prompt to continue the active session.

## Installation

You need [OpenCode V2](https://opencode.ai/v2/docs/) and Git.

### Install one plugin with OpenCode

OpenCode's native installer supports selecting a repository subdirectory. Run the command for the plugin you want:

**commit**

```sh
opencode plugin add 'github:ybbuc/opencode-plugins#main::path:commit'
```

**peak**

```sh
opencode plugin add 'github:ybbuc/opencode-plugins#main::path:peak'
```

**quota**

```sh
opencode plugin add 'github:ybbuc/opencode-plugins#main::path:quota'
```

**quick-links**

```sh
opencode plugin add 'github:ybbuc/opencode-plugins#main::path:quick-links'
```

**keep-going**

```sh
opencode plugin add 'github:ybbuc/opencode-plugins#main::path:keep-going'
```

`::path:` selects just that plugin's package. The installer adds it to your **global** OpenCode configuration, so it applies across projects. A single installation enables each plugin's terminal and desktop features where available.

See OpenCode's [plugin installation documentation](https://opencode.ai/v2/docs/plugins#manage) for Git URLs, version pinning, and package management.

### Local installation

The desktop bundles are committed to the repository; using them does not require a build.

1. Clone the repository outside OpenCode's automatically discovered plugin directories:

   ```sh
   git clone https://github.com/ybbuc/opencode-plugins.git "$HOME/opencode-plugins"
   ```

   For Quick Links in the terminal, install its runtime dependencies in the checkout first (requires npm):

   ```sh
   npm --prefix "$HOME/opencode-plugins/quick-links" ci --omit=dev
   ```

2. Add **only the plugin you want** to the `plugins` array in `~/.config/opencode/opencode.jsonc` (or `$XDG_CONFIG_HOME/opencode/opencode.jsonc` if set). For example, to enable only `quota`:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": ["{env:HOME}/opencode-plugins/quota"]
   }
   ```

   Replace `quota` with the directory name of the plugin you want. To enable several, add one path per plugin. **Merge this entry into your existing configuration; do not replace unrelated settings.**

3. OpenCode reloads configuration changes automatically. Use `/reload` if you need to force a reload, then check the plugin list:

   ```sh
   opencode plugin list
   ```

Cloning downloads the collection, but only configured plugins are enabled. Each plugin directory is self-contained, so the others need to be present only if you configure them.

For project-only use, put the local path in that project's `opencode.jsonc` instead. For desktop use across windows, use the global configuration shown above.

## commit

Adds the **commit** skill and two helper tools:

| Tool | Purpose |
| --- | --- |
| `commit.context` | Read the branch, recent commit subjects, working-tree changes, untracked files, and possible-secret-file warnings. |
| `commit.check` | Reflow and validate a commit message, then write it to a temporary file for `git commit -F`. |

In a Git repository, ask OpenCode:

```text
Use the commit skill to commit my changes.
```

The skill considers all uncommitted changes by default, proposes separate commits for unrelated changes, and asks you to approve the exact message **before staging or committing**. You can name a subset of files or explicitly request an amend. It does not push.

Messages use conventional-commit-style subjects, a 72-character subject limit, and body wrapping at 70 characters. See the [skill](commit/SKILL.md) and [message format](commit/references/message-format.md) for the full workflow.

## copilot-usage

For eligible top-level turns that used only GitHub Copilot, the plugin sends a transcript with common credentials masked to `github-copilot/claude-haiku-5.5`. Haiku skips trivial work or returns one entry for the local `~/.local/share/copilot-usage-log.md`. The log stays local, but summarization is a separate Copilot call. Enable it explicitly:

```jsonc
{
  "plugins": [
    {
      "package": "{env:HOME}/opencode-plugins/copilot-usage",
      "options": { "enabled": true }
    }
  ]
}
```

Merge this entry into your existing `plugins` array, as in [Local installation](#local-installation). Without `"enabled": true`, the plugin does not subscribe to events.

The plugin never creates the log. Create it yourself, with `Status: active` as its first `Status:` line and `## Entries` as its last heading. Otherwise turns are skipped:

```md
# Copilot usage log

Status: active

## Entries
```

## peak

Shows the selected model's pricing phase and time until the next phase. It appears in the **terminal prompt footer** and as a **desktop composer pill**. For example:

```text
off-peak · 2h 14m
```

Currently supports the `deepseek-v4.1-flash` and `deepseek-v4-pro` model families on these providers:

| Provider ID | Weekday peak windows (UTC) |
| --- | --- |
| `ollama-cloud` | 12:00–18:00 |
| `opencode-go` | 01:00–04:00 and 06:00–10:00 |

Weekends are off-peak for both. The indicator refreshes every minute and stays hidden for unsupported providers or models. No credentials or plugin options are needed for the indicator itself.

The schedules are [hard-coded](peak/peak.ts), not fetched live. Check [Ollama pricing](https://ollama.com/pricing) and [OpenCode Go](https://opencode.ai/v2/docs/console/go/) when pricing policies change.

## quota

Shows usage for the **currently selected provider** in the terminal prompt footer and a desktop composer pill. Percentages show **usage consumed**, not remaining allowance. Illustrative output:

```text
24% · 2h 14m | 38% → 76% · 3d 4h
```

The arrow is a projection of usage at the reset, not an additional quota. Desktop details include usage bars and local reset times, plus purchased Ollama credits when available.

| Provider | Usage shown | Required OpenCode connection |
| --- | --- | --- |
| OpenCode Go (`opencode-go`) | Session, weekly, and monthly limits when available | An account with Go usage limits available in OpenCode |
| Ollama Cloud (`ollama-cloud`) | Session and weekly usage | Ollama Cloud API key |
| GitHub Copilot (`github-copilot`) | Premium-interaction usage and projected usage at reset | GitHub Copilot OAuth login with a finite premium-interaction quota |
| ChatGPT (`openai`) | Session and weekly usage | ChatGPT/Codex OAuth login with an account ID; an OpenAI API key does not provide these subscription quotas |
| Claude Agent (`claude-agent`) | Five-hour session and weekly usage | Claude Code subscription login; Anthropic API keys are not supported |

Connect the provider through OpenCode first; the plugin reuses its stored credentials. There is no separate plugin credential setup, and `quota` works without enabling `peak`.

Claude Agent uses Claude Code's own login: the default macOS `Claude Code-credentials` Keychain entry, or `~/.claude/.credentials.json` on other systems or when Keychain is unavailable. `CLAUDE_CONFIG_DIR` selects a file-backed login instead. The plugin never writes the login itself; when the stored access token has expired it runs `claude auth status`, which lets Claude Code refresh and store the token, then reads it again. A login whose refresh token is dead still needs an interactive `claude` login, and the plugin waits an hour before asking the CLI again.

Usage refreshes on load and every **minute**. Claude backs off for the response's `Retry-After` when the server sends one, else 30 minutes. Countdown and projection displays refresh every minute. Weekly projections for Ollama, ChatGPT, and Claude Agent are desktop-only; Copilot projections appear in both interfaces.

If nothing appears, check the selected provider, its connection, and whether the account exposes the relevant quota. Claude Agent is the exception: an expired or revoked Claude Code login shows `Logged out` rather than a blank footer. Unlimited Copilot premium quotas are not displayed. Failed refreshes keep the last successful reading, so the display can be stale. Provider usage endpoints, including GitHub's internal, ChatGPT's backend, and Claude's undocumented OAuth APIs, can change independently of this plugin.

> **Desktop compatibility:** `peak` and `quota` use OpenCode's experimental GUI plugin API, which can change between releases.

## quick-links

In the terminal or desktop app, run `/links` or choose **Open session links** from the command palette. Type to filter the list, then press Enter to open the selected link in your default browser.

Quick Links lists HTTP and HTTPS links from user and assistant messages, not tool output. Each destination appears once, newest first. Markdown links show their labels alongside the URL, with inline-code markers removed from labels like `rmcp`. Bare links show only the URL.

No shortcut is assigned by default. To add one, replace the Quick Links entry in your `plugins` array with an entry like this:

```jsonc
{
  "package": "github:ybbuc/opencode-plugins#main::path:quick-links",
  "options": { "keybind": "ctrl+shift+o" }
}
```

For a local installation, use your Quick Links directory as `package` instead. Set `keybind` to `false` or `"none"` to disable the shortcut; `/links` still works.

Adapted from [vimtor's opencode-quick-links](https://github.com/vimtor/opencode-plugins/tree/main/packages/opencode-quick-links) under the [MIT license](quick-links/LICENSE).

## keep-going

In the terminal or desktop app, press Enter with the session prompt focused and empty to continue with the same agent and model. The plugin leaves Enter alone when the prompt contains text or is in shell mode. In the desktop app, add text before submitting an attachment-only prompt; Keep Going checks only for text.

By default, the plugin sends `Continue.` without showing it in the conversation. To send a visible `Proceed.` instead, replace the Keep Going entry in your `plugins` array with:

```jsonc
{
  "package": "github:ybbuc/opencode-plugins#main::path:keep-going",
  "options": { "hidden": false, "message": "Proceed." }
}
```

For a local installation, use your Keep Going directory as `package` instead.

Adapted from [vimtor's opencode-keep-going](https://github.com/vimtor/opencode-plugins/tree/main/packages/opencode-keep-going) under the [MIT license](keep-going/LICENSE).

## Updating and removing plugins

### Git-package installations

Once native installation succeeds, check for updates with:

```sh
opencode plugin check
```

Use the same package specifier you installed to update or remove one plugin. For example, for `quota`:

```sh
opencode plugin update 'github:ybbuc/opencode-plugins#main::path:quota'
opencode plugin remove 'github:ybbuc/opencode-plugins#main::path:quota'
```

Replace `quota` with the directory name of the plugin you want. These commands don't update local checkouts.

### Local installations

Update the checkout:

```sh
git -C "$HOME/opencode-plugins" pull --ff-only
```

Then use `/reload` in OpenCode. To remove a local plugin, remove its path from the `plugins` array. The checkout can stay in place for any other plugins you use.
