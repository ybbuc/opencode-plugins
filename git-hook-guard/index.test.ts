// Self-check for the git-hook-guard plugin: `npm test`.
import { test } from "node:test"
import assert from "node:assert/strict"
import plugin, { findDenial, findHookBypass, stripHookBypasses } from "./index.ts"

const allowed = [
  'git commit -m "no-verify docs"',
  "git commit -m n",
  "git commit -mn",
  "git commit -m --no-verify",
  "git commit -am fix",
  "git commit -uno -m x",
  "git commit -- -n",
  "git commit --verbose",
  'git commit -m "if then; do git commit -n; fi"',
  "git merge -n feature",
  "git merge --no-veri feature",
  "git merge -m --no-verify feature",
  "git push -n origin main",
  "git rebase -n main",
  "git pull -n",
  "git pull --no-veri",
  "git am --directory --no-verify patch.mbox",
  "git push",
  "git log --oneline",
  "git config --get core.hooksPath",
  "git config core.hooksPath",
  "git config --unset core.hooksPath",
  "git config unset core.hooksPath",
  "git config get core.hooksPath",
  "git config get --default /dev/null core.hooksPath",
  "git config --show-origin get core.hooksPath",
  "git config --show-origin --get core.hooksPath",
  "git config --show-origin core.hooksPath",
  "git config --show-origin --unset core.hooksPath",
  "git config -- core.hooksPath",
  "git config -- get core.hooksPath",
  "git config -- set core.hooksPath /dev/null",
  "git config -f .git/config get core.hooksPath",
  "git config get --type bool core.hooksPath",
  "git config --global --list",
  "git config user.name \"A B\"",
  "git config --global user.name \"A B\"",
  "git config set user.name \"A B\"",
  "cat .git/hooks/pre-commit",
  "ls -la .git/hooks",
  "grep -n lefthook .git/hooks/pre-commit | head",
  "nl .git/hooks/pre-commit",
  "git diff .git/hooks/pre-commit",
  'git commit -m "rm -rf .git/hooks"',
  "cp .git/hooks/pre-commit /tmp/backup",
  "sed -n p .git/hooks/pre-commit",
  "sed -ne 's/i/x/' .git/hooks/pre-commit",
  "sed -e 's/i/x/' .git/hooks/pre-commit",
  "sed --expression='s/i/x/' .git/hooks/pre-commit",
  "sed -f /tmp/insert.sed .git/hooks/pre-commit",
  "sed -i 's/x/y/' build.txt",
  "find .git/hooks -exec cat {} +",
  "find .git/hooks -exec grep -n hook {} \\;",
  "find .git/hooks -execdir cat {} \\;",
  "find .git/hooks -execdir grep -n hook pre-commit \\;",
  "find . -name '*.log' -exec rm {} +",
  "dd if=.git/hooks/pre-commit of=/tmp/backup",
  "cd .git/hooks && cat pre-commit",
  "cd .git/hooks && nl pre-commit",
  "cd .git/hooks && cd .. && cat hooks/pre-commit",
  "(cd .git/hooks && cat pre-commit); rm -rf build",
  "(cd .git/hooks); rm -rf build",
  "(cd .git/hooks); (rm -rf build)",
  "`git status`",
  "`cd .git/hooks` && rm -rf build",
  "`cd .git/hooks` && rm pre-commit",
  "`cd .git/hooks`; rm -rf build",
  "`cd /tmp` `rm -rf build`",
  "`cd .git/hooks` `rm pre-commit`",
  "echo \"`git status`\"",
  "echo '`git commit -n`'",
  "cd /tmp/project/.git/hooks && cd ../../build && rm old.log",
  "cd .git/hooks > /dev/null && cd ../.. && rm old.log",
  'bash -c "cat .git/hooks/pre-commit"',
  "echo LEFTHOOK=0",
  'echo "LEFTHOOK=0"',
  "printf '%s\\n' LEFTHOOK=0",
  "LEFTHOOK=1 git commit -m x",
  "LEFTHOOK_EXCLUDE= git commit -m x",
  "export LEFTHOOK_QUIET=meta",
  "lefthook install",
  "pnpm exec lefthook run pre-commit",
  "echo lefthook uninstall",
  "grep -n lefthook uninstall README.md",
  'git commit -m "lefthook uninstall"',
  'bash -c "git commit -m x"',
  "sudo -u root git status",
  "sudo --user root git status",
  "sudo -a pam git status",
  "sudo -c default git status",
  "sudo --login-class staff git status",
  "sudo --chroot /tmp/jail git status",
  "command -v git",
  "env -S 'git status'",
  "env --split-string='git status'",
  "git --attr-source HEAD status",
  'git -c user.name="A B" commit -m x',
  "/usr/bin/git -C ../other log",
  "if true; then git commit -m x; fi",
  "while false; do git status; done",
  "! git status",
  "echo 'then git commit -n'",
  "{ git status; }",
]

const blocked = [
  "git commit --no-verify -m x",
  "git commit --no-veri -m x",
  "git commit --no-verif -m x",
  "git commit -n -m x",
  'git commit -anm "msg"',
  "git commit -m x -n",
  'git commit -m"msg" -n',
  "git commit '-n' -m x",
  "git am -n patch.mbox",
  "git am -3n patch.mbox",
  "git am --no-v patch.mbox",
  "git am --no-ver patch.mbox",
  "git am --no-verify patch.mbox",
  "git am --directory .git --no-verify patch.mbox",
  "git push --no-verify",
  "git push origin main --no-verify",
  "git push --no-veri origin main",
  "git merge --no-verify feature",
  "git rebase --no-verify main",
  "git rebase --no-veri main",
  "git pull --no-verify",
  "git pull -s recursive --no-verify",
  "git p4 submit --no-verify",
  "git p4 submit --no-veri",
  "git custom --no-verify",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git -ccore.hooksPath=/dev/null commit -m x",
  "git -c core.hookspath=/dev/null commit -m x",
  "git --config-env=core.hooksPath=EMPTY commit -m x",
  "git config core.hooksPath /dev/null",
  "git config core.hooksPath -x",
  "git config core.hooksPath --unset",
  "git config core.hooksPath --get",
  "git config --add core.hooksPath -x",
  "git config --global core.hooksPath --unset",
  "git config -f .git/config core.hooksPath /dev/null",
  "git config --global core.hooksPath /tmp/none",
  "git config set core.hooksPath /tmp/none",
  "git config set -- core.hooksPath /dev/null",
  "git config --local --add core.hooksPath x",
  "git config core.hooksPath list",
  "git config core.hooksPath get",
  "git config core.hooksPath unset",
  "git config set core.hooksPath list",
  "git config --add core.hooksPath list",
  "git config -- core.hooksPath --get",
  "git config set --comment --get core.hooksPath /dev/null",
  "git config set --comment 'hook path' core.hooksPath /dev/null",
  "git config --show-origin set core.hooksPath /tmp/none",
  "git config --show-origin core.hooksPath /dev/null",
  "git config --show-origin core.hooksPath list",
  "LEFTHOOK=0 git commit -m x",
  "LEFTHOOK=false git commit -m x",
  'LEFTHOOK="0" git commit -m x',
  "HUSKY=0 git commit -m x",
  "LEFTHOOK_EXCLUDE=lint git commit -m x",
  "LEFTHOOK_BIN=true git commit -m x",
  "LEFTHOOK_CONFIG=/dev/null git push",
  "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x",
  "LEFTHOOK=0",
  "export LEFTHOOK=0",
  "export LEFTHOOK=0 && git commit -m x",
  'export "HUSKY=0"',
  "env LEFTHOOK=0 git commit -m x",
  'env "LEFTHOOK=0" git commit -m x',
  "env -i PATH=/usr/bin LEFTHOOK=0 git commit -m x",
  "env -S 'LEFTHOOK=0 git commit -m x'",
  "env -S'LEFTHOOK=0 git commit -m x'",
  "env --split-string='LEFTHOOK=0 git commit -m x'",
  "env --split-string 'LEFTHOOK=0 git commit -m x'",
  "lefthook uninstall",
  "pnpm exec lefthook uninstall",
  "pnpm dlx lefthook uninstall",
  "npx lefthook uninstall",
  "npm exec lefthook uninstall",
  "bunx lefthook uninstall",
  "./node_modules/.bin/lefthook uninstall",
  "rm .git/hooks/pre-commit",
  "rm -rf .git/hooks",
  "echo 'exit 0' > .git/hooks/pre-commit",
  "cat /dev/null >> .git/hooks/pre-push",
  "cp /dev/null .git/hooks/pre-commit",
  "cp --target-directory .git/hooks pre-commit",
  "chmod -x .git/hooks/pre-commit",
  "find .git/hooks -delete",
  "find .git/hooks -exec rm {} +",
  "find .git/hooks -exec chmod -x {} \\;",
  "find .git/hooks -execdir mv {} {}.bak \\;",
  "find .git/hooks -execdir rm pre-commit \\;",
  "find . -path .git/hooks -exec rm {} +",
  "find . -exec rm .git/hooks/pre-commit \\;",
  "cd .git/hooks && find . -exec rm {} +",
  "cd .git/hooks && find -exec rm {} +",
  "mv .git/hooks/pre-commit /tmp/pre-commit",
  "touch .git/hooks/pre-commit",
  "tee .git/hooks/pre-commit",
  "sed -i 's/check/skip/' .git/hooks/pre-commit",
  "sed -Ei 's/check/skip/' .git/hooks/pre-commit",
  "sed -ni p .git/hooks/pre-commit",
  "sed -i.bak 's/x/y/' .git/hooks/pre-commit",
  "sed --in-place=.bak 's/x/y/' .git/hooks/pre-commit",
  "sed -e 's/x/y/' -i .git/hooks/pre-commit",
  "sed 's/x/y/' -i .git/hooks/pre-commit",
  "dd if=/dev/null of=.git/hooks/pre-commit",
  "2>/dev/null rm .git/hooks/pre-commit",
  "cd .git/hooks && rm pre-commit",
  "cd .git/hooks && rm -rf *",
  "cd .git/hooks && cat pre-commit; echo x > pre-commit",
  "cd .git/hooks && echo x >> pre-commit",
  "cd .git/hooks >/dev/null && rm pre-commit",
  "cd .git/hooks && mv pre-commit pre-commit.bak",
  "cd .git/hooks && find . -delete",
  "cd .git/hooks && find -delete",
  "cd .git/hooks && cd .. && rm hooks/pre-commit",
  "(cd .git/hooks && rm pre-commit)",
  "cd .git/hooks && (rm pre-commit)",
  "cd /tmp/project/.git/hooks && cd .. && rm hooks/pre-commit",
  "`git commit -n -m x`",
  "`cd .git/hooks && rm pre-commit`",
  "`cd .git/hooks && cd .. && rm hooks/pre-commit`",
  "cd .git/hooks && `rm pre-commit`",
  "cd .git/hooks && `cd .. && rm hooks/pre-commit`",
  "cd .git/hooks && echo `cd ..`; rm pre-commit",
  "echo \"`git commit -n -m x`\"",
  "cd .git/hooks && echo \"`rm pre-commit`\"",
  "git commit -m \"prefix `printf text` suffix\" -n",
  'bash -c "git commit -n -m x"',
  "sh -c 'git commit --no-verify -m x'",
  'bash -lc "LEFTHOOK=0 git commit -m x"',
  `bash -c "sh -c 'git commit -n -m x'"`,
  'eval "git commit -n -m x"',
  'zsh -c "rm .git/hooks/pre-commit"',
  'bash -c "echo" > .git/hooks/pre-commit',
  "env git commit -n -m x",
  "git \\\ncommit -n -m x",
  "command git commit -n -m x",
  "sudo git commit --no-verify -m x",
  "sudo -u root git commit -n -m x",
  "sudo --user root git commit -n -m x",
  "sudo -a pam git commit -n -m x",
  "sudo -c default git commit --no-verify -m x",
  "sudo --login-class staff git commit -n -m x",
  "sudo --chroot /tmp/jail git commit -n -m x",
  "sudo --chdir /tmp git commit --no-verify -m x",
  "sudo --auth-type pam git commit -n -m x",
  "nohup git push --no-verify",
  "time git commit -n -m x",
  "timeout 30 git commit -n -m x",
  "nice -n 10 git commit -n -m x",
  "git --attr-source HEAD commit -n -m x",
  "if true; then git commit -n -m x; fi",
  "if false; then :; else git commit -n -m x; fi",
  "if false; then :; elif git commit -n; then :; fi",
  "while false; do git commit -n -m x; done",
  "until false; do git commit -n -m x; done",
  "! git commit -n -m x",
  "{ git commit -n -m x; }",
  "cd x && git commit -n -m x",
  "(cd x && git commit -n -m x)",
  "git status; git commit -n -m x",
  "git status\ngit commit -n -m x",
  "echo $(git commit -n -m x)",
  "/usr/bin/git commit --no-verify -m x",
  "git -C ../other commit -n -m x",
  "git --git-dir=.git --work-tree=. commit -n -m x",
]

test("allows commands that leave hooks alone", () => {
  for (const command of allowed) assert.equal(findHookBypass(command), undefined, command)
})

test("blocks commands that skip or disable hooks", () => {
  for (const command of blocked) assert.ok(findHookBypass(command), command)
})

test("names the bypass it found", () => {
  assert.equal(findHookBypass("git commit -anm x"), "`git commit -anm` (`-n` is `--no-verify`)")
  assert.equal(findHookBypass("git am -n patch.mbox"), "`git am -n` (`-n` is `--no-verify`)")
  assert.equal(findHookBypass("FOO=1 LEFTHOOK=0 git commit -m x"), "`LEFTHOOK=0`")
  assert.equal(findHookBypass("git -c core.hooksPath=/dev/null commit"), "`git -c core.hooksPath`")
  assert.equal(findHookBypass("git push --no-verify"), "`git push --no-verify`")
  assert.match(findDenial(["git status", "git commit -n"]) ?? "", /^Blocked: this command skips Git hooks \(found `git commit -n`/)
  assert.equal(findDenial(allowed), undefined)
})

test("fails closed when a command can't be checked", () => {
  let command = "git commit -n"
  for (let depth = 0; depth < 12; depth += 1) command = `bash -c ${JSON.stringify(command)}`
  assert.throws(() => findHookBypass(command), /nesting/)
  assert.match(findDenial([command]) ?? "", /couldn't check this command/)
  assert.match(findDenial(["echo `printf text"]) ?? "", /unclosed backtick substitution/)
})

test("strips inherited variables that disable hooks, and only those", () => {
  const env: Record<string, string | undefined> = {
    LEFTHOOK: "0",
    HUSKY: "1",
    LEFTHOOK_EXCLUDE: "lint",
    LEFTHOOK_BIN: "true",
    LEFTHOOK_CONFIG: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    PATH: "/bin",
  }
  stripHookBypasses(env)
  assert.deepEqual(env, {
    HUSKY: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    PATH: "/bin",
  })
})

type HookCallback = (event: Record<string, unknown>) => unknown

function fakeContext() {
  const hooks = new Map<string, HookCallback>()
  const hook = (name: string, callback: HookCallback): Promise<{ dispose: () => Promise<void> }> => {
    hooks.set(name, callback)
    return Promise.resolve({ dispose: async () => {} })
  }
  const context = {
    tool: { hook },
    permission: { hook },
    shell: { hook },
  } as unknown as Parameters<typeof plugin.setup>[0]
  return { context, hooks }
}

test("denies bypasses in the original shell command or scanner resources", async () => {
  const { context, hooks } = fakeContext()
  await plugin.setup(context)
  const before = hooks.get("execute.before")!
  const evaluate = hooks.get("evaluate")!

  await before({ tool: "shell", id: "call-1", input: { command: "export LEFTHOOK=0 && git commit -m x" } })
  const shortened = {
    action: "shell",
    resources: ["git commit -m x"],
    source: { type: "tool", id: "call-1" },
    effect: "ask",
    message: "",
  }
  await evaluate(shortened)
  assert.equal(shortened.effect, "deny")
  assert.match(shortened.message, /export LEFTHOOK=0/)

  const scannerOnly = { action: "shell", resources: ["git commit -n"], effect: "allow", message: "" }
  await evaluate(scannerOnly)
  assert.equal(scannerOnly.effect, "deny")
  assert.match(scannerOnly.message, /git commit -n/)

  const allowedEvent = { action: "shell", resources: ["git status"], effect: "allow" }
  await evaluate(allowedEvent)
  assert.equal(allowedEvent.effect, "allow")
})

test("removes inherited hook overrides before creating the shell", async () => {
  const { context, hooks } = fakeContext()
  await plugin.setup(context)
  const env: Record<string, string | undefined> = {
    LEFTHOOK: "0",
    HUSKY: "1",
    LEFTHOOK_CONFIG: "/dev/null",
  }
  await hooks.get("create.before")!({ command: "git status", cwd: "/tmp", shell: "bash", timeout: 1000, env })
  assert.deepEqual(env, { HUSKY: "1" })
})
