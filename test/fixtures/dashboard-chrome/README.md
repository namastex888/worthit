# Dashboard screenshot isolation (#64)

The real CLI scans synthetic local sources with hosts, git and AI disabled, then
reaches its dashboard screenshot spawn. PR79's executable Chrome stub captures
its actual argv and HTML and writes a synthetic PNG before returning success or
exit 2. A narrow test-only preload injects a thrown synchronous spawn error and
pins the dashboard deadline. No Chrome or default browser profile is opened.
Each call must use the card's network flags
and a unique private profile; cleanup must remove its own scratch on all three
paths while preserving an unrelated sentinel. Scratch must be private (0700).
The card's actual async spawn uses the same executable stub and is pinned
separately, including its existing scale, size and accepted PNG. HTML/CSS must contain
no HTTP(S) resource or `@import`, so network suppression does not alter drawing.

The fixture uses allowlisted synthetic homes, stores, configs and temporary roots;
no SSH, forge, meter or agent command is called. `make check` discovers this case.
