// git-hook-guard: OpenCode plugin that denies agent shell commands that skip or disable Git hooks.
//
// The detector is ported from Rat Stack's scripts/vcs-command-policy.js:
// https://github.com/joelhooks/rat-stack/blob/main/scripts/vcs-command-policy.js
// Copyright (c) 2026 Joel Hooks. Released under the MIT License; see LICENSE.

import { posix } from "node:path"
import type { Plugin } from "@opencode/plugin"

type Token = { text: string; operator: boolean; assignable: boolean; bare: boolean }
type Segment = { scope: number; tokens: Token[]; substitutions: string[] }

const SEGMENT_BREAKS = new Set([";", "&", "|", "\n"])
const OUTPUT_REDIRECTS = new Set([">", ">>", ">|", ">&"])
const SHELLS = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"])
const DECLARATIONS = new Set(["declare", "export", "local", "readonly", "typeset"])
const SHELL_KEYWORDS = new Set(["!", "{", "}", "do", "done", "elif", "else", "esac", "fi", "if", "then", "until", "while"])

// Wrappers that run the command after them, with the options that consume the next word.
const WRAPPERS = new Map<string, Set<string>>([
  ["command", new Set()],
  ["env", new Set(["-C", "--chdir", "-S", "--split-string", "-u", "--unset"])],
  ["exec", new Set(["-a"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["nohup", new Set()],
  ["sudo", new Set([
    "-C", "-D", "-a", "-c", "-g", "-h", "-p", "-R", "-r", "-T", "-t", "-U", "-u",
    "--chdir", "--chroot", "--close-from", "--command-timeout", "--group", "--host",
    "--login-class", "--other-user", "--prompt", "--role", "--type", "--user", "--auth-type",
  ])],
  ["time", new Set(["-f", "--format", "-o", "--output"])],
  ["timeout", new Set(["-k", "--kill-after", "-s", "--signal"])],
])

const MUTATORS = new Set([
  "chmod", "chown", "cp", "install", "ln", "mkdir", "mv", "rm", "rmdir", "tee", "touch", "truncate", "unlink",
])
const HOOKS_DIRECTORY = /(?:^|\/)\.git\/hooks(?:\/|$)/
const PACKAGE_RUNNERS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "pnpx", "yarn"])
const RUNNER_COMMANDS = new Set(["dlx", "exec", "run", "x"])

const GIT_GLOBALS_WITH_VALUE = new Set([
  "--attr-source", "--exec-path", "--git-dir", "--namespace", "--super-prefix", "--work-tree", "-C",
])

type NoVerifyGrammar = {
  readonly shortestPrefix: number
  readonly shortNoVerify: boolean
  readonly longWithValue: ReadonlySet<string>
  readonly shortWithValue: ReadonlySet<string>
  readonly shortWithAttachedValue: ReadonlySet<string>
}

const COMMIT_GRAMMAR: NoVerifyGrammar = {
  shortestPrefix: "--no-veri".length,
  shortNoVerify: true,
  longWithValue: new Set([
    "--author", "--cleanup", "--date", "--file", "--fixup", "--message", "--pathspec-from-file",
    "--reedit-message", "--reuse-message", "--squash", "--template", "--trailer",
  ]),
  shortWithValue: new Set(["C", "F", "c", "m", "t"]),
  // Short flags whose value can only be attached (`-uno`, `-Skeyid`), so they never consume the next word.
  shortWithAttachedValue: new Set(["S", "u"]),
}

const AM_GRAMMAR: NoVerifyGrammar = {
  shortestPrefix: "--no-v".length,
  shortNoVerify: true,
  longWithValue: new Set([
    "--directory", "--empty", "--exclude", "--include", "--patch-format", "--quoted-cr", "--resolvemsg", "--whitespace",
  ]),
  shortWithValue: new Set(["C", "p"]),
  shortWithAttachedValue: new Set(["S"]),
}

const MERGE_GRAMMAR: NoVerifyGrammar = {
  // `--no-veri` is ambiguous with `--no-verify-signatures`.
  shortestPrefix: "--no-verify".length,
  shortNoVerify: false,
  longWithValue: new Set(["--cleanup", "--file", "--into-name", "--message", "--strategy", "--strategy-option"]),
  shortWithValue: new Set(["F", "X", "m", "s"]),
  shortWithAttachedValue: new Set(["S"]),
}

const REBASE_GRAMMAR: NoVerifyGrammar = {
  shortestPrefix: "--no-veri".length,
  shortNoVerify: false,
  longWithValue: new Set(["--empty", "--exec", "--onto", "--strategy", "--strategy-option", "--whitespace"]),
  shortWithValue: new Set(["C", "X", "s", "x"]),
  shortWithAttachedValue: new Set(["S", "r"]),
}

const PUSH_GRAMMAR: NoVerifyGrammar = {
  shortestPrefix: "--no-veri".length,
  shortNoVerify: false,
  longWithValue: new Set(["--exec", "--push-option", "--receive-pack", "--recurse-submodules", "--repo"]),
  shortWithValue: new Set(["o"]),
  shortWithAttachedValue: new Set(),
}

const PULL_GRAMMAR: NoVerifyGrammar = {
  // `--no-veri` is ambiguous with `--no-verify-signatures`.
  shortestPrefix: "--no-verify".length,
  shortNoVerify: false,
  longWithValue: new Set([
    "--cleanup", "--deepen", "--depth", "--negotiation-tip", "--refmap", "--server-option",
    "--shallow-exclude", "--shallow-since", "--strategy", "--strategy-option", "--upload-pack",
  ]),
  shortWithValue: new Set(["X", "o", "s"]),
  shortWithAttachedValue: new Set(["S", "j"]),
}

const DEFAULT_GRAMMAR: NoVerifyGrammar = {
  shortestPrefix: "--no-veri".length,
  shortNoVerify: false,
  longWithValue: new Set(),
  shortWithValue: new Set(),
  shortWithAttachedValue: new Set(),
}

const NO_VERIFY_GRAMMARS = new Map<string, NoVerifyGrammar>([
  ["am", AM_GRAMMAR],
  ["commit", COMMIT_GRAMMAR],
  ["merge", MERGE_GRAMMAR],
  ["pull", PULL_GRAMMAR],
  ["push", PUSH_GRAMMAR],
  ["rebase", REBASE_GRAMMAR],
])

const CONFIG_READ_OPTIONS = new Set([
  "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "--unset", "--unset-all", "-l",
])
const CONFIG_MODERN_OPERATIONS = new Set([
  "edit", "get", "list", "remove-section", "rename-section", "set", "unset",
])
const CONFIG_OPTIONS_WITH_VALUE = new Set([
  "-f", "--blob", "--comment", "--default", "--file", "--type", "--value",
])

const NO_VERIFY = "--no-verify"
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_NESTING_DEPTH = 8

function segmentsOf(command: string): Segment[] {
  const segments: Segment[] = [{ scope: 0, tokens: [], substitutions: [] }]
  const scopes = [0]
  let nextScope = 0
  let text = ""
  let started = false
  let assignable = true
  let bare = true
  let quote: "'" | '"' | null = null
  const current = () => segments.at(-1)!
  const finish = () => {
    if (started) current().tokens.push({ assignable, bare, operator: false, text })
    text = ""
    started = false
    assignable = true
    bare = true
  }
  const next = () => segments.push({ scope: scopes.at(-1)!, tokens: [], substitutions: [] })

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index)
    if (char === "`" && quote !== "'") {
      let end = index + 1
      for (; end < command.length && command.charAt(end) !== "`"; end += 1) {
        if (command.charAt(end) === "\\") end += 1
      }
      if (end >= command.length) throw new Error("unclosed backtick substitution")
      current().substitutions.push(command.slice(index + 1, end))
      index = end
      text += "$()"
      started = true
      bare = false
    } else if (quote !== null) {
      if (char === quote) quote = null
      else if (char === "\\" && quote === '"' && index + 1 < command.length) {
        text += command.charAt(++index)
      } else text += char
    } else if (char === "'" || char === '"') {
      if (!started) assignable = false
      bare = false
      quote = char
      started = true
    } else if (char === "\\" && index + 1 < command.length) {
      const escaped = command.charAt(++index)
      if (escaped === "\n") continue
      bare = false
      text += escaped
      started = true
    } else if (/\s/.test(char) && char !== "\n") {
      finish()
    } else if (char === "(") {
      finish()
      scopes.push(++nextScope)
      next()
    } else if (char === ")") {
      finish()
      if (scopes.length > 1) scopes.pop()
      next()
    } else if (SEGMENT_BREAKS.has(char)) {
      finish()
      next()
    } else if (char === ">") {
      if (bare && /^\d+$/.test(text)) started = false
      finish()
      const following = command.charAt(index + 1)
      const operator = following === ">" || following === "|" || following === "&" ? `>${following}` : ">"
      index += operator.length - 1
      current().tokens.push({ assignable: false, bare: true, operator: true, text: operator })
    } else {
      text += char
      started = true
    }
  }
  finish()
  return segments
}

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1)

function disablesHooks(assignment: string): boolean {
  const separator = assignment.indexOf("=")
  const name = assignment.slice(0, separator)
  const value = assignment.slice(separator + 1).trim().toLowerCase()
  switch (name) {
    case "LEFTHOOK":
      return value === "0" || value === "false"
    case "HUSKY":
      return value === "0"
    case "LEFTHOOK_EXCLUDE":
    case "LEFTHOOK_BIN":
    case "LEFTHOOK_CONFIG":
      return value !== ""
    case "GIT_CONFIG_PARAMETERS":
      return value.includes("core.hookspath")
    default:
      return /^GIT_CONFIG_KEY_\d+$/.test(name) && value === "core.hookspath"
  }
}

// Split leading assignments and wrappers (`LEFTHOOK=0 sudo -u x env -i git ...`) from the command they run.
function splitPrefix(words: Token[]) {
  const assignments: string[] = []
  const nestedScripts: string[] = []
  let argvAssignments = false
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if ((argvAssignments || word.assignable) && ASSIGNMENT.test(word.text)) {
      assignments.push(word.text)
      index += 1
      continue
    }
    const wrapper = basename(word.text)
    const valueOptions = WRAPPERS.get(wrapper)
    if (!valueOptions) break
    // env and sudo read assignments from argv, so quoting doesn't stop them.
    argvAssignments = wrapper === "env" || wrapper === "sudo"
    index += 1
    while (index < words.length && words[index]!.text.startsWith("-")) {
      const option = words[index]!.text
      index += 1
      if (option === "--") break
      if (wrapper === "env") {
        const attached = option.startsWith("--split-string=")
          ? option.slice("--split-string=".length)
          : option.startsWith("-S") && option.length > 2 ? option.slice(2) : undefined
        if (attached !== undefined) {
          nestedScripts.push(attached)
          continue
        }
      }
      if (!valueOptions.has(option)) continue
      const value = words[index]?.text ?? ""
      index += 1
      if (wrapper === "env" && (option === "-S" || option === "--split-string")) nestedScripts.push(value)
    }
    if (wrapper === "timeout") index += 1
  }
  return { assignments, nestedScripts, words: words.slice(index) }
}

const setsHooksPath = (setting: string) => setting.split("=")[0]?.trim().toLowerCase() === "core.hookspath"

function findNoVerifyBypass(subcommand: string, args: string[], grammar: NoVerifyGrammar): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === "--") return undefined
    if (arg.startsWith("--")) {
      if (arg.length >= grammar.shortestPrefix && NO_VERIFY.startsWith(arg)) {
        return `\`git ${subcommand} ${arg}\``
      }
      if (grammar.longWithValue.has(arg)) index += 1
      continue
    }
    if (!/^-[^-]/.test(arg)) continue
    for (let flag = 1; flag < arg.length; flag += 1) {
      const char = arg.charAt(flag)
      if (char === "n" && grammar.shortNoVerify) {
        return `\`git ${subcommand} ${arg}\` (\`-n\` is \`--no-verify\`)`
      }
      if (grammar.shortWithAttachedValue.has(char)) break
      if (grammar.shortWithValue.has(char)) {
        if (flag === arg.length - 1) index += 1
        break
      }
    }
  }
  return undefined
}

// Git stops parsing options at the first operand, so a dash-leading word after the key is a value.
function configArguments(args: string[]): { positionals: string[]; read: boolean; modern: boolean } {
  const positionals: string[] = []
  let read = false
  let modern = false
  let index = 0
  const parseOptions = () => {
    while (index < args.length) {
      const arg = args[index]!
      if (arg === "--") {
        positionals.push(...args.slice(index + 1))
        index = args.length
        return
      }
      if (arg === "-" || !arg.startsWith("-")) return
      if (CONFIG_READ_OPTIONS.has(arg)) read = true
      index += CONFIG_OPTIONS_WITH_VALUE.has(arg) ? 2 : 1
    }
  }
  parseOptions()
  if (index < args.length) {
    const operation = args[index]!
    positionals.push(operation)
    index += 1
    modern = CONFIG_MODERN_OPERATIONS.has(operation)
    if (modern) parseOptions()
    positionals.push(...args.slice(index))
  }
  return { positionals, read, modern }
}

function configSetsHooksPath(args: string[]): boolean {
  const { positionals, read, modern } = configArguments(args)
  if (read) return false
  const [operation, key] = positionals
  if (modern) return operation === "set" && setsHooksPath(key ?? "")
  if (operation === undefined || !setsHooksPath(operation)) return false
  return operation.includes("=") || positionals.length > 1
}

function findGitBypass(args: string[]): string | undefined {
  let index = 0
  while (index < args.length && args[index]!.startsWith("-")) {
    const option = args[index]!
    let setting: string | undefined
    if (option === "-c" || option === "--config-env") {
      setting = args[index + 1] ?? ""
      index += 2
    } else if (option.startsWith("-c")) {
      setting = option.slice(2)
      index += 1
    } else if (option.startsWith("--config-env=")) {
      setting = option.slice("--config-env=".length)
      index += 1
    } else {
      index += GIT_GLOBALS_WITH_VALUE.has(option) ? 2 : 1
    }
    if (setting !== undefined && setsHooksPath(setting)) {
      return `\`git ${option.startsWith("--") ? "--config-env" : "-c"} core.hooksPath\``
    }
  }

  const [subcommand = "", ...rest] = args.slice(index)
  if (subcommand === "config" && configSetsHooksPath(rest)) return "`git config core.hooksPath`"
  return findNoVerifyBypass(subcommand, rest, NO_VERIFY_GRAMMARS.get(subcommand) ?? DEFAULT_GRAMMAR)
}

function resolvePath(cwd: string | null, word: string): string | null {
  if (word === "" || word.startsWith("-") || /[$`~{}]/.test(word)) return null
  if (word.startsWith("/")) return posix.normalize(word)
  return cwd === null ? null : posix.join(cwd, word)
}

const SED_OPTIONS_WITH_VALUE = new Set(["--expression", "--file", "--line-length"])

// Sed bundles short flags (`-Ei`, `-ni`); `e`, `f` and `l` end the bundle with a value.
function sedInPlace(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === "--") break
    if (arg.startsWith("--")) {
      if (arg === "--in-place" || arg.startsWith("--in-place=")) return true
      if (SED_OPTIONS_WITH_VALUE.has(arg)) index += 1
      continue
    }
    if (!arg.startsWith("-") || arg === "-") continue
    for (let flag = 1; flag < arg.length; flag += 1) {
      const char = arg.charAt(flag)
      if (char === "i") return true
      if (char === "e" || char === "f") {
        if (flag === arg.length - 1) index += 1
        break
      }
      if (char === "l") {
        if (flag === arg.length - 1 && /^\d+$/.test(args[index + 1] ?? "")) index += 1
        break
      }
    }
  }
  return false
}

const FIND_PATH_PREDICATES = new Set(["-ipath", "-iwholename", "-path", "-wholename"])
const isMutatingProgram = (program: string) => MUTATORS.has(basename(program))

function findMutatesHooks(args: string[], cwd: string | null): boolean {
  const targetsHooks = (path: string) => HOOKS_DIRECTORY.test(resolvePath(cwd, path) ?? path)
  const roots: string[] = []
  let index = 0
  while (index < args.length && /^-[HLP]$/.test(args[index]!)) index += 1
  while (index < args.length && !args[index]!.startsWith("-") && args[index] !== "!" && args[index] !== "(") {
    roots.push(args[index]!)
    index += 1
  }
  if (roots.length === 0) roots.push(".")
  for (let scan = index; scan + 1 < args.length; scan += 1) {
    if (FIND_PATH_PREDICATES.has(args[scan]!)) roots.push(args[scan + 1]!)
  }
  if (args.includes("-delete") && roots.some(targetsHooks)) return true

  for (; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg !== "-exec" && arg !== "-execdir") continue
    const execdir = arg === "-execdir"
    const command: string[] = []
    for (index += 1; index < args.length && args[index] !== ";" && args[index] !== "+"; index += 1) {
      command.push(args[index]!)
    }
    const [program = "", ...rest] = command
    if (!isMutatingProgram(program)) continue
    if (rest.some((word) => word !== "{}" && targetsHooks(word))) return true
    if (!roots.some(targetsHooks)) continue
    if (rest.includes("{}")) return true
    // -execdir runs in the matched directory, so relative targets resolve inside the hook tree.
    if (execdir && rest.some((word) => !word.startsWith("-") && !word.startsWith("/"))) return true
  }
  return false
}

function mutatesHooks(segment: Token[], program: string, args: string[], cwd: string | null): boolean {
  const targetsHooks = (path: string) => HOOKS_DIRECTORY.test(resolvePath(cwd, path) ?? path)
  for (let index = 0; index + 1 < segment.length; index += 1) {
    const token = segment[index]!
    if (!token.operator || !OUTPUT_REDIRECTS.has(token.text)) continue
    const target = segment[index + 1]!
    if (!target.operator && targetsHooks(target.text)) return true
  }

  if (program === "dd") return args.some((arg) => arg.startsWith("of=") && targetsHooks(arg.slice(3)))
  if (program === "sed") {
    if (!sedInPlace(args)) return false
  } else if (program === "find") {
    return findMutatesHooks(args, cwd)
  } else if (!MUTATORS.has(program)) return false

  const targets = args.filter((arg) => !arg.startsWith("-"))
  if (program === "cp" || program === "install" || program === "ln" || program === "mv") {
    const directory = args.findIndex((arg) => arg === "-t" || arg === "--target-directory")
    const attached = args.find((arg) => arg.startsWith("--target-directory=") || /^-t./.test(arg))
    const destination = attached ? attached.replace(/^(--target-directory=|-t)/, "") : args[directory + 1]
    if (program !== "mv") return targetsHooks((attached || directory >= 0 ? destination : targets.at(-1)) ?? "")
    if ((attached || directory >= 0) && targetsHooks(destination ?? "")) return true
  }
  return targets.some(targetsHooks)
}

function isLefthookUninstall(program: string, args: string[]): boolean {
  if (program === "lefthook") return args.includes("uninstall")
  if (!PACKAGE_RUNNERS.has(program)) return false
  let index = 0
  while (index < args.length && (args[index]!.startsWith("-") || RUNNER_COMMANDS.has(args[index]!))) index += 1
  return basename(args[index] ?? "") === "lefthook" && args.slice(index + 1).includes("uninstall")
}

function commandPrefix(segment: Token[]) {
  const words: Token[] = []
  for (let index = 0; index < segment.length; index += 1) {
    const token = segment[index]!
    if (token.operator) {
      if (!segment[index + 1]?.operator) index += 1
    } else if (words.length || !token.bare || !SHELL_KEYWORDS.has(token.text)) {
      words.push(token)
    }
  }
  const prefix = splitPrefix(words)
  const [program = "", ...args] = prefix.words.map((token) => token.text)
  return { ...prefix, program, name: basename(program), args }
}

function findSegmentBypass(
  segment: Token[], prefix: ReturnType<typeof commandPrefix>, depth: number, cwd: string | null,
): string | undefined {
  const { name, args } = prefix
  const assignment = prefix.assignments.find(disablesHooks)
  if (assignment) return `\`${assignment}\``
  for (const script of prefix.nestedScripts) {
    const found = scanCommand(script, depth + 1, cwd)
    if (found) return found
  }
  if (mutatesHooks(segment, name, args, cwd)) return "a change under `.git/hooks`"

  if (name === "git") return findGitBypass(args)
  if (DECLARATIONS.has(name)) {
    const declared = prefix.words.slice(1).find((token) => ASSIGNMENT.test(token.text) && disablesHooks(token.text))
    return declared && `\`${name} ${declared.text}\``
  }
  if (isLefthookUninstall(name, args)) return "`lefthook uninstall`"
  if (SHELLS.has(name)) {
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    return script === -1 ? undefined : scanCommand(args[script + 1] ?? "", depth + 1, cwd)
  }
  if (name === "eval") return scanCommand(args.join(" "), depth + 1, cwd)
  return undefined
}

/**
 * Describe the first way `command` skips or disables Git hooks, or return undefined if it doesn't.
 * Throws when the command nests shells too deeply to check.
 */
export function findHookBypass(command: string): string | undefined {
  return scanCommand(command, 0, ".")
}

function scanCommand(command: string, depth: number, cwd: string | null): string | undefined {
  if (depth > MAX_NESTING_DEPTH) throw new Error(`shell nesting is deeper than ${MAX_NESTING_DEPTH} levels`)
  const directories = new Map<number, string | null>()
  let directory = cwd
  // shortcut: literal cd only; use a shell AST if branch-specific paths need to be tracked.
  for (const segment of segmentsOf(command)) {
    if (directories.has(segment.scope)) directory = directories.get(segment.scope)!
    for (const substitution of segment.substitutions) {
      const found = scanCommand(substitution, depth + 1, directory)
      if (found) return found
    }
    const prefix = commandPrefix(segment.tokens)
    const found = findSegmentBypass(segment.tokens, prefix, depth, directory)
    if (found) return found
    if (prefix.program === "cd") {
      const { args } = prefix
      const targets = args[0] === "--" ? args.slice(1) : args
      directory = targets.length === 1 ? resolvePath(directory, targets[0]!) : null
    }
    directories.set(segment.scope, directory)
  }
  return undefined
}

export function denialMessage(bypass: string): string {
  return (
    `Blocked: this command skips Git hooks (found ${bypass}). ` +
    "Drop the bypass, run the command again, read the hook output, and fix what fails. " +
    "Ask the user before changing hook configuration such as lefthook.yml, core.hooksPath, or .git/hooks."
  )
}

/** Check every candidate command; fail closed if any of them can't be checked. */
export function findDenial(commands: readonly string[]): string | undefined {
  for (const command of commands) {
    let bypass: string | undefined
    try {
      bypass = findHookBypass(command)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return `Blocked: git-hook-guard couldn't check this command for Git hook bypasses (${reason}). Rewrite it as plain, unnested commands.`
    }
    if (bypass) return denialMessage(bypass)
  }
  return undefined
}

// Inherited variables that disable hooks for every command OpenCode runs.
export function stripHookBypasses(env: Record<string, string | undefined>): void {
  for (const name of ["LEFTHOOK", "HUSKY", "LEFTHOOK_EXCLUDE", "LEFTHOOK_BIN", "LEFTHOOK_CONFIG"]) {
    const value = env[name]
    if (value !== undefined && disablesHooks(`${name}=${value}`)) delete env[name]
  }
  // GIT_CONFIG_* overrides stay put: dropping one indexed entry safely would mean renumbering the rest.
}

const MAX_TRACKED_CALLS = 200

const plugin = {
  id: "git-hook-guard",

  async setup(ctx) {
    // Permission resources are scanner output and can drop parts of a command (`export LEFTHOOK=0 && ...`
    // yields only the second half), so keep each shell call's full command for the evaluate hook.
    const callIDToCommand = new Map<string, string>()

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell") return
      const command = (event.input as { command?: unknown } | undefined)?.command
      if (typeof command !== "string") return
      callIDToCommand.set(event.id, command)
      if (callIDToCommand.size > MAX_TRACKED_CALLS) callIDToCommand.delete(callIDToCommand.keys().next().value!)
    })

    await ctx.tool.hook("execute.after", (event) => {
      callIDToCommand.delete(event.id)
    })

    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== "shell" || event.effect === "deny") return
      const fullCommand = event.source ? callIDToCommand.get(event.source.id) : undefined
      const message = findDenial(fullCommand === undefined ? event.resources : [fullCommand, ...event.resources])
      if (!message) return
      event.effect = "deny"
      event.message = message
    })

    await ctx.shell.hook("create.before", (event) => {
      stripHookBypasses(event.env)
    })
  },
} satisfies Plugin.Plugin

export default plugin
