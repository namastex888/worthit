# worthit

Is your AI coding subscription worth it? One command scans the session logs already on your machine, prices every request at API list rates, and shows which plan gave you more.

```sh
npx worthit        # same tool: npx usagemeter
```

Works with Claude Code, Codex and Antigravity. Needs Node 22.5+ and Python 3.

## What you get

- **Which plan gave more**: API-list-price dollars per full weekly limit, and how many times the plan price that is.
- **Your week**: output tokens, API value used, merged PRs, commits, cost per merged PR, each against the 7 days before.
- **Subscription waste**: allowance you left unused, per account. A week that closed under the limit says "you spent less"; the provider is not blamed for it.
- **Level, XP, streak**: a small daily history in `~/.worthit/history.json` (one row per day, no prompts, no code).
- Three files in the current folder: `<date>-worthit.md`, `<date>-worthit.png`, `<date>-worthit-audit.log`.

## Options

| Flag | What it does |
|---|---|
| `--json` | Headless: print the data as JSON, no UI. For agents and scripts. |
| `--git yes\|no` | Count merged PRs and commits (uses `gh` and the usagemeter store). |
| `--ai no\|claude\|codex` | Who composes the dashboard. `no` = data tables only. `claude` = Haiku 5.5, `codex` = GPT-6 Luna, both medium reasoning, through your own CLI login. |
| `--ask "question"` | Answer one question about your usage, drawn as blocks. |
| `--days N` | Days of logs to scan (default 21). |
| `--hosts all\|none\|a,b` | Other machines to include, from your saved ssh hosts. Scanned in parallel with the same read-only script piped in; nothing is installed there (it leaves only its scan cache in `~/.worthit`). Without the flag, a checklist asks once and the choice is remembered. |
| `--no-files` | Do not write the three files. |
| `--fresh` | Ask the model for a new report even when the data has not changed. |

Without flags, three arrow-key questions ask the same things, with the recommended answer preselected.

## Caching

- **Logs:** a log file that has not changed since the last run is not read again, and a file that only grew is read from where it stopped. The cache (`~/.worthit/scan-cache.db`, on each scanned machine) keeps only the token counts, model names and timestamps the scanner uses: no prompts, no code. `WORTHIT_NO_CACHE=1` turns it off.
- **Report:** when the data the report is built from is the same as last time, the saved report is shown and the model is not called.

## How it is measured

1. Every request in your local logs is priced at the provider's API list rate: input, cached input, cache writes, output including thinking. Prices are in `core/prices.json`.
2. A plan's number is the priced usage inside one stretch of its weekly meter, divided by the meter points that stretch consumed, times 100.
3. Each number carries its proof level:
   - **measured**: the provider's own meter was read at both ends of the stretch.
   - **floor**: usage on machines that were not scanned is missing, so the real value is at least this.
   - **estimate**: no meter; derived from when the cap was hit.

The no-AI run prints data tables only. With `--ai`, the model receives the week's data as JSON and may only choose blocks and write the one-line verdict and the summary; every number on screen is drawn from the data by the tool.

## Privacy

Everything runs on your machine. The audit log lists every file read, command run, network request and file written. Network use: the usagemeter download (checksum verified), your own `gh` login for merged PRs, and, only if you pick `--ai`, your own Claude or Codex CLI with the week's data.

## Improve the method

The pricing and window logic is in `core/weekly.py`; the scanner is `core/extract_usage.py`. Issues and pull requests with a better algorithm are welcome: include the audit log section that shows the case.

MIT
