# Repository guidance

- Each plugin is a separate npm package. After changing one, run `npm test` and, if defined, `npm run typecheck` in its directory (`npm ci` first if `node_modules` is missing).
- When changing a git-hook-guard rule, add a command it must block and a similar command it must still allow.
