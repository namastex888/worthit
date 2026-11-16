# Dashboard screenshot isolation (#64)

The real CLI scans synthetic local sources with hosts, git and AI disabled, then
reaches its dashboard screenshot spawn. A test-only preload captures its actual
argv and HTML before returning success, exit 2 or a thrown spawn error. No Chrome
or default browser profile is opened. Each call must use the card's network flags
and a unique private profile; cleanup must remove its own scratch on all three
paths while preserving an unrelated sentinel. The card's actual async spawn is
pinned separately, including its existing scale and size. HTML/CSS must contain
no HTTP(S) resource or `@import`, so network suppression does not alter drawing.

The fixture uses allowlisted synthetic homes, stores, configs and temporary roots;
no SSH, forge, meter or agent command is called. `make check` discovers this case.
