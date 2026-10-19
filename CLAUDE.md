## Node.js

Node is managed by **fnm** (installed via Chocolatey). The version is pinned in `.node-version`. Agent shells don't load the user's profile, so `node`/`npm` are **not on PATH** until you activate fnm in the same command:

- PowerShell: `fnm env --shell powershell | Out-String | Invoke-Expression; fnm use --silent-if-unchanged; npm test`
- Git Bash: `eval "$(fnm env --shell bash)" && fnm use --silent-if-unchanged && npm test`
- One-off alternative: `fnm exec node ...` (on Windows, call `npm.cmd`/`npx.cmd` — `fnm exec npm` fails to find the program).

Shell state doesn't persist between tool calls, so prefix every node/npm command. If `fnm use` says the version isn't installed, run `fnm install` (reads `.node-version`).

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/` (created lazily). See `docs/agents/domain.md`.
