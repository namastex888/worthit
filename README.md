# worthit

What your AI coding subscription is really worth. One command, everything local.

## For humans

```sh
npx worthit
```

![worthit running: three questions, a live scan, then the dashboard](https://raw.githubusercontent.com/namastex888/worthit/dev/docs/demo.gif)

The recording is `npx worthit --demo`: the whole run on sample data. Needs Node 22.5+ and Python 3.

The creature in the right corner is the hardware pet: it reads this machine's CPU, memory, network, disk, temperature and power once a second and gets more nervous the harder the run works it. Push it far enough and it pops. The last line shows what the run cost: watts, energy, data moved.

## For agents

Install the skill (the full guide) into whatever agent you use. `npx worthit` also asks "Install the worthit skill?" on its first run and does this for you:

```sh
npx skills add namastex888/worthit
```

Every command prints JSON and reads only local files:

```sh
worthit --json                   # scan now, print the week's data (no UI, no model)
worthit get                      # sections of the last run, no scan
worthit get plans                # one section; dots walk in: plans.0.usd_per_full_week
worthit days --group month --by tool             # daily history, grouped: day|week|month by total|tool|model
worthit days --since 2026-11-01 --by model
worthit sql "SELECT day, SUM(api_usd) FROM day_provider GROUP BY day"   # one read-only SELECT on the local store
worthit schema                   # tables and columns, with meanings
worthit --skill                  # print the full guide
worthit install-skill            # install the skill into your coding agents
worthit --demo                   # the whole run on sample data
```

Flags for a scan (`worthit` or `worthit --json`):

| Flag | What it does |
|---|---|
| `--git yes\|no` | count commits and merged PRs |
| `--ai claude\|codex\|omp\|dsh\|no` | which agent writes the summary; `no` = tables only |
| `--ask "question"` | answer one question about the data, then exit |
| `--hosts all\|none\|a,b` | also read your saved ssh machines, in parallel |
| `--days 21` | how far back to scan |
| `--fresh` | rewrite the summary even if nothing changed |
| `--no-files` | do not write the `.md`, `.png` and audit log |

A normal run writes `./<date>-worthit.md`, `./<date>-worthit.png` and `./<date>-worthit-audit.log`. Its store is `~/.worthit/`.

MIT. Releases: every merge into `dev` cuts a version; `make publish` puts it on npm.
