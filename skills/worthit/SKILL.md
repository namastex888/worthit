---
name: worthit
description: Answer questions about AI coding usage, cost and productivity with the worthit CLI — which subscription gave more, tokens and API value per day/week/month, per tool and per model, merged PRs and commits, unused allowance, open vs closed models — and turn any of it into a ready-to-post card and text with `worthit share`. Use when the user asks how much they used, what a plan is worth, how this week compares, which model or tool they lean on, or wants to share or post a stat.
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
| `plans` | Per plan: `usd_per_full_week` (API-list dollars one full weekly limit is worth), `times_plan_price`, `proof` (measured, floor), `stretches`, `meter`, `priced_usd`, `models`, `history` (earlier 7-day blocks, oldest first, then this week), `weeks` (the same with dates and gaps: `weeks_ago`, `to`, `usd`, up to 12; a missing week had no meter reading), `change_vs_last_week_pct`, and when machines without a meter log were busy in the same hours: `other_machines_usd`, `usd_per_full_week_all_machines` (an upper figure) |
| `totals` | Last 7 days against the 7 before: output tokens, API value, changes in % |
| `tools` | Per tool, last 7 days: requests, output, cached and fresh input, dollars, where the data came from |
| `months` | Per month and plan: API value used, times the monthly plan price, days tracked |
| `model_mix` | `weeks`, `series` (per model: `share_pct` per week, `change_pts`), `open`, `closed` (share, tokens, dollars, dollars per million output) |
| `git` | Merged PRs, commits, repos, cost per merged PR, per-day series, `sources` (GitHub, the usagemeter store, Gitea when `tea` is logged in, and every GitLab host `glab` is logged in to) |
| `delivery` | What the merged PRs were, read from each title prefix (`feat:`, `fix:`, `docs:` ...): `kinds` ranked for this week with last week beside it, `features`, `usd_per_feature`, `fix_share_pct`, and `days` (14), `weeks` (12) and `months` with features, fixes, cost and cost per feature. A null cost means that period was not fully scanned. Compare a person with their own earlier weeks, not with other people |
| `waste` | One row per plan: limit, share used, dollars unused, dollars still open (`at_risk_usd`), and why. Several accounts on one plan are summed into one row (`accounts`, `account_weeks`), named like `ChatGPT Pro 200 (×4)` |
| `events` | Provider events in the window: resets, limit changes, launches, with source links |
| `game` | Level, XP, streak, personal bests |
| `heat` | Output tokens per weekday and hour |
| `week`, `machines`, `days_scanned`, `generated_at` | What the run covered |
| `machines_missing`, `machines_left_out` | Machines that gave no answer this run (`saved_scan_at` set = their last saved scan was used) and saved machines with usage left out. Either one not empty = the week may be undercounted and every plan is a floor |
| `machines_retained` | Older scans kept for machines that answered with less data. Each row names `machine` (SSH alias or `this machine`), `days_kept` (distinct local days) and `units` (`day`, `provider`). Each machine/local-day/provider keeps the whole scan unit with higher API-list USD at this run's prices, then total tokens; fresh wins a full tie. Mention the named machines and days kept. Any retained unit intersecting this week makes every plan a floor and `change_vs_last_week_pct` null: later lost hours remain unknown |

When `machines_retained` has a unit inside this week, that week's totals are a lower bound too.

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
- **Proof:** `measured` is read from the plan's own meter with every selected machine answering; `floor` means usage elsewhere may be missing, so the true value is at least this. Say "at least" for a floor and do not compare a floor week to week.
- **One account on several machines** draws the same meter line on each; worthit joins those lines into one stretch. Use on machines that keep no meter log cannot be tied to an account: it is left out of `usd_per_full_week` and counted only in `usd_per_full_week_all_machines`.
- **Week over week** compares 7-day blocks counted back from now, each pooled the same way.
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

## Sharing a stat

`worthit share <topic>` turns the last finished run into a post for X. It does not scan and it never posts.

```
worthit share allowance     # weekly limits per plan and whether they moved
worthit share open          # open vs closed models
worthit share models        # the models used, most to least
worthit share value         # the best plan: dollars per weekly limit and times its price
worthit share ranking       # all plans side by side
worthit share waste         # allowance paid for and not used
worthit share "what each merged PR cost me"     # anything else: the person's agent writes it from the data
```

Piped (as you run it), it prints JSON: `{topic, written_by, text, characters, image, url, data_generated_at, warnings}`.

- `text` is the suggested post. `image` is the card (`./<date>-worthit-share-<topic>.png`). `url` opens X with the text filled in.
- X's link cannot carry an image: tell the person to attach or paste the card.
- Free text is written by the person's own agent; if any number in it is not in the data, worthit falls back to the built-in `allowance` post and says so in `warnings`.
- `--ai no` keeps it to the built-in topics. `--demo` uses sample data.
- Inside the worthit screen the person can simply type it in the question bar ("share my open model stats"): the card and the post appear there and enter opens X.

## Helping the person

1. **A question about usage:** answer from `get`, `days` or `sql`; run `worthit --json` first only when `generated_at` is too old for the question.
2. **"Share this", "make me a post", "what should I post":** if they did not say what, offer the six topics in one line each. Run `worthit share <topic>`, then show them the `text`, the `image` path and the `url`, and repeat any `warnings`. Offer to adjust the wording yourself; keep every number exactly as in `text`.
3. **A weekly habit** (for example a Monday allowance post): `worthit --json` to refresh, then `worthit share allowance`.
4. **Never** post for them, open a browser for them unless asked, or read their logs yourself: worthit is the only reader.
5. If `worthit share` says there is no finished run, run `worthit --json` once and try again.
