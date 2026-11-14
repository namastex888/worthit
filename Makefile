# worthit: versions are cut by CI when a pull request merges into dev (.github/workflows/release.yml).
# The only manual step is npm, which asks for a fingerprint:
#
#   make publish     publish the newest release to npm as `worthit` and `usagemeter`
#   make status      the newest release, and which names already carry it on npm
#   make check       the gates CI and the release run

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.PHONY: check status publish
NAMES := worthit usagemeter

node_modules: package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund
	@touch node_modules

check: node_modules
	node scripts/version.mjs check
	for f in bin/*.mjs src/*.mjs scripts/*.mjs; do node --check "$$f"; done
	python3 -m py_compile core/extract_usage.py core/weekly.py core/pricing.py core/merge_scans.py
	node test/run-fixtures.mjs
	node bin/worthit.mjs --version
	node bin/worthit.mjs schema > /dev/null
	node bin/worthit.mjs --skill > /dev/null
	npm pack --dry-run > /dev/null 2>&1
	@echo "check: ok"

status:
	@git fetch -q --tags origin; \
	tag=$$(git tag --list 'v0.*' --sort=-v:refname | grep -E '^v0\.[0-9]+\.0$$' | head -1 || true); \
	if [ -z "$$tag" ]; then echo "no release yet: merge a pull request into dev"; exit 0; fi; \
	echo "newest release: $$tag"; \
	for name in $(NAMES); do \
	  if [ "$$(npm view "$$name@$${tag#v}" version 2>/dev/null || true)" = "$${tag#v}" ]; then echo "  $$name@$${tag#v}: on npm"; else echo "  $$name@$${tag#v}: not on npm yet (make publish)"; fi; \
	done

# Publishes exactly what the release tag holds, from a clean copy: the working tree is never touched,
# and a name that already carries the version is skipped, so running it twice is safe.
publish:
	@git fetch -q --tags origin; \
	tag=$$(git tag --list 'v0.*' --sort=-v:refname | grep -E '^v0\.[0-9]+\.0$$' | head -1 || true); \
	if [ -z "$$tag" ]; then echo "no release yet: merge a pull request into dev first"; exit 1; fi; \
	ver=$${tag#v}; dir=$$(mktemp -d); trap 'rm -rf "$$dir"' EXIT; \
	git archive "$$tag" | tar -x -C "$$dir"; cd "$$dir"; \
	for name in $(NAMES); do \
	  if [ "$$(npm view "$$name@$$ver" version 2>/dev/null || true)" = "$$ver" ]; then echo "$$name@$$ver is already on npm"; continue; fi; \
	  npm pkg set name="$$name"; \
	  echo; echo "Publishing $$name@$$ver. A browser window opens: approve it with your fingerprint."; \
	  npm publish --auth-type=web --access public; \
	done; \
	echo; echo "Done. Try it: npx worthit@$$ver --version"
