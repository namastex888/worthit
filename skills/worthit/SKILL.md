---
name: worthit
description: Answer questions about AI coding usage, cost and productivity with the worthit CLI — which subscription gave more, tokens and API value per day/week/month, per tool and per model, merged PRs and commits, unused allowance, open vs closed models. Use when the user asks how much they used, what a plan is worth, how this week compares, or which model or tool they lean on.
---

# worthit

`worthit` measures AI coding usage on this machine (and chosen ssh machines): Claude Code, Codex, Antigravity, omp, dsh. Every request is priced at API list rates. Everything is local.

Run it as `worthit` (or `npx worthit`). All commands below print JSON on stdout; errors go to stderr with a non-zero exit code.

## Pick the cheapest command that answers the question

| Need | Command | Cost |
|---|---|---|
| A number from the last run | `worthit get <section>` | instant, no scan |
| Totals over any dates, by tool or model | `worthit days …` | instant, no scan |
| Anything else the store holds | `worthit sql "SELECT …"` | instant, no scan |
| Fresh numbers | `worthit --json` | 5–10 s warm; first run or `--days 90` is longer |

Start with `worthit get` (no argument): it lists the sections and when the data was generated. If `generated_at` is older than the question needs, run `worthit --json` first, then query.

## `worthit get [section[.field…]]`

Parts of the last run. Dots walk into objects and arrays (`plans.0.usd_per_full_week`).

| Section | What it holds |
|---|---|
| `plans` | Per plan: `usd_per_full_week` (API-list dollars one full weekly limit is worth), `times_plan_price`, `proof` (measured, floor, estimate), `stretches`, `meter`, `priced_usd`, `models` |
| `totals` | Last 7 days against the 7 before: output tokens, API value, changes in % |
| `tools` | Per tool, last 7 days: requests, output, cached and fresh input, dollars, where the data came from |
| `months` | Per month and plan: API value used, times the monthly plan price, days tracked |
| `model_mix` | `weeks`, `series` (per model: `share_pct` per week, `change_pts`), `open`, `closed` (share, tokens, dollars, dollars per million output) |
| `git` | Merged PRs, commits, repos, cost per merged PR, per-day series |
| `waste` | Per account week: limit, share used, dollars unused, and why (hit the cap, spent less, still open) |
| `events` | Provider events in the window: resets, limit changes, launches, with source links |
| `game` | Level, XP, streak, personal bests |
| `heat` | Output tokens per weekday and hour |
| `week`, `machines`, `days_scanned`, `generated_at` | What the run covered |

## `worthit days`

Sums from the local store over any period.

```
worthit days --since 2026-10-01 --until 2026-10-31 --group week
worthit days --group month --by tool
worthit days --since 2026-11-01 --by model
worthit days --group week --model opus
worthit days --group day --tool codex --since 2026-11-05
```

- `--group day|week|month` (default day; week is ISO, `2026-W45`)
- `--by total|tool|model` (default total; `total` also returns `merged_prs` and `commits`)
- `--tool claude|codex|google|omp|dsh`, `--model <part of the id>`
- Each row has `api_usd`, `output_tokens`, `days` (days with data in the period), and `requests` unless grouped by model.

## `worthit sql "SELECT …"` and `worthit schema`

One read-only `SELECT` or `WITH` statement over `~/.worthit/worthit.db`. Run `worthit schema` first: it returns every table and column with its meaning. At most 500 rows come back.

```
worthit sql "SELECT day, SUM(api_usd) usd FROM day_provider GROUP BY day ORDER BY usd DESC LIMIT 5"
worthit sql "SELECT day, provider, usd_per_full_week FROM plan_value ORDER BY day"
```

## Fresh run: `worthit --json`

Scans, prices and prints the whole data object (the same sections as `get`). Useful flags:

- `--git yes|no` include merged PRs and commits
- `--hosts all|none|a,b` other machines over ssh (default: the remembered selection)
- `--days N` window to scan (default 21; `--days 90` backfills history once)
- Unchanged log files are served from a cache, so repeat runs are fast.

The human dashboard (`worthit` with no flags) also writes `<date>-worthit.md`, `.png` and `-audit.log` to the current folder. Do not run it for an agent task: use `--json`.

## How to read the numbers

- **API value** is what the same usage would cost at API list prices. It is not what the user paid.
- **`usd_per_full_week`** pools every clean, finished meter stretch of the week: priced dollars divided by meter points consumed. `times_plan_price` divides it by the plan's weekly price ($200/month ≈ $46/week).
- **Proof:** `measured` means every scanned machine on the account was read; `floor` means usage elsewhere may be missing, so the true value is at least this; `estimate` has no meter behind it.
- **Months:** "times plan price" is against one subscription. A user with several accounts on a plan should divide by the number of accounts.
- **Resets** are listed in `events` and never assumed used. Usage counts in the period it happened.
- **omp and dsh** come from the Automagik usagemeter store. omp's own reported cost is used; dsh is priced at the rates those costs imply. Their history only goes back as far as that store (about 30 days).
- **Open vs closed:** open = DeepSeek, GLM, Kimi, Qwen, Llama, Mistral, Gemma, MiniMax. Everything else is closed.
- A partial period is partial: check `days` before comparing months or weeks.

## Answering well

1. Quote the number with its period and unit ("$19,526 of API value in November so far, 12 days").
2. Say when it is a floor or an estimate.
3. For "why" questions, look at `events` for the same dates before guessing.
4. Never invent a number that no command returned; if the store has no data for the period, say so and offer `worthit --json --days 90`.
