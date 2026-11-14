"""Install literal synthetic source logs into one temporary machine home."""
import pathlib
import shutil
import sqlite3
import sys

source, home = map(pathlib.Path, sys.argv[1:])
files = {
    'claude.jsonl': '.claude/projects/example/usage.jsonl',
    'codex.jsonl': '.codex/sessions/usage.jsonl',
    'antigravity.jsonl': f'.gemini/antigravity/brain/example-{source.name}/.system_generated/logs/transcript.jsonl',
    'claude-limits.jsonl': '.meter/claude-limits.jsonl',
}
for name, destination in files.items():
    target = home / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / name, target)
with sqlite3.connect(home / '.meter/meter.db') as db:
    db.executescript((source / 'meter.sql').read_text())
