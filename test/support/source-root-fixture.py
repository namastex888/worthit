"""Synthetic inputs and separate operator checks; all destinations come from the harness."""
import errno
import json
import os
from pathlib import Path
import sqlite3
import sys

STAMP = '2026-11-13T12:00:00Z'
HOUR = 1794571200000
SCHEMA = '''CREATE TABLE usage (id TEXT PRIMARY KEY, hour_ms INTEGER, harness TEXT,
model TEXT, input_uncached INTEGER, cache_read INTEGER, cache_write_5m INTEGER,
cache_write_1h INTEGER, output INTEGER, reasoning INTEGER, events INTEGER, reported_usd REAL)'''

def put(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(data if isinstance(data, str) else json.dumps(data))

def claude(identifier, output=100, cwd=None):
    return {'timestamp': STAMP, 'sessionId': identifier, 'requestId': identifier,
            'cwd': cwd, 'message': {'id': identifier, 'model': 'claude-sonnet-5-5',
                                  'usage': {'input_tokens': 10, 'output_tokens': output}}}

def database(file, output=30, wal=False):
    file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(file)
    if wal:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA wal_autocheckpoint=0')
    connection.execute(SCHEMA)
    connection.execute('INSERT INTO usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                       ('colliding-row', HOUR, 'omp', 'synthetic-model', 10, 0, 0, 0, output, 0, 1, 1.0))
    connection.commit()
    return connection

def materialize(base):
    home, root = base / 'home', base / 'volume'
    put(home / '.claude/projects/default/usage.jsonl', json.dumps(claude('default-native', 10)) + '\n')
    # A host login is intentional: a future reader must not lend it to root rows.
    put(home / '.claude.json', {'oauthAccount': {'accountUuid': 'synthetic-host-account'}})
    cwd = str(base / 'coincident-host-folder')
    put(Path(cwd) / '.git/config', '[remote "origin"]\nurl = https://forge.invalid/example/coincidence.git\n')
    native = root / 'agents/alpha/.claude/projects/nested/usage.jsonl'
    put(native, json.dumps(claude('root-native', 100, cwd)) + '\n')
    put(root / 'agents/alpha/.claude/session-archive/archive.jsonl', json.dumps(claude('archived-native', 20)) + '\n')
    codex = root / 'agents/beta/.codex/sessions/usage.jsonl'
    records = [
        {'timestamp': STAMP, 'type': 'session_meta', 'payload': {'id': 'synthetic-codex', 'cwd': cwd}},
        {'timestamp': STAMP, 'type': 'turn_context', 'payload': {'model': 'gpt-6.1-sol'}},
        {'timestamp': STAMP, 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
            'total_token_usage': {'input_tokens': 10, 'output_tokens': 40, 'total_tokens': 50},
            'last_token_usage': {'input_tokens': 10, 'output_tokens': 40}}}},
    ]
    put(codex, ''.join(json.dumps(record) + '\n' for record in records))
    put(root / 'agents/beta/.codex/archived_sessions/archive.jsonl', ''.join(
        json.dumps({**record, 'payload': {**record['payload'], **({'id': 'synthetic-codex-archive'} if record['type'] == 'session_meta' else {})}}) + '\n'
        for record in records))
    meter = root / 'meter'
    database(meter / 'meter.db').close()
    put(meter / 'claude-limits.jsonl', json.dumps({'ts': STAMP, 'session': 'synthetic-meter',
        'account': 'synthetic-meter-account', 'model': 'claude-sonnet-5-5',
        'seven_day': {'used_percentage': 100, 'resets_at': 1794657600},
        'five_hour': {'used_percentage': 50, 'resets_at': 1794592800}}) + '\n')
    database(root / 'other-meter/meter.db', 70).close()
    put(root / 'other-meter/claude-limits.jsonl', (meter / 'claude-limits.jsonl').read_text())
    originals = [native, root / 'agents/alpha/.claude/session-archive/archive.jsonl',
                 codex, root / 'agents/beta/.codex/archived_sessions/archive.jsonl',
                 meter / 'meter.db', meter / 'claude-limits.jsonl',
                 root / 'other-meter/meter.db', root / 'other-meter/claude-limits.jsonl']
    links = []
    for original in originals:
        for kind in ('symlink-one', 'symlink-two', 'hardlink-one', 'hardlink-two'):
            alias = original.with_name(kind + '-' + original.name)
            if kind.startswith('symlink'):
                alias.symlink_to(original.name)
            else:
                os.link(original, alias)
            links.append({'original': str(original), 'alias': str(alias), 'kind': kind})
    for source in ('meter', 'other-meter'):
        for suffix in ('symlink-one', 'symlink-two'):
            (root / (source + '-' + suffix)).symlink_to(source, target_is_directory=True)
        for suffix in ('hardlink-one', 'hardlink-two'):
            for name in ('meter.db', 'claude-limits.jsonl'):
                target = root / (source + '-' + suffix) / name
                target.parent.mkdir(exist_ok=True)
                os.link(root / source / name, target)
    sentinels = []
    for relative in ('.claude.json', 'agents/alpha/.claude/.claude.json',
                     'agents/alpha/.claude/.credentials.json', 'agents/beta/.codex/auth.json',
                     '.gemini/settings.json', '.gemini/antigravity/settings.json',
                     '.gemini/antigravity-cli/settings.json'):
        file = root / relative
        put(file, 'harmless-synthetic-sentinel\n')
        symlink, hardlink = file.with_name(file.name + '.symlink'), file.with_name(file.name + '.hardlink')
        symlink.symlink_to(file.name)
        os.link(file, hardlink)
        sentinels.append({'path': str(file), 'aliases': [str(symlink), str(hardlink)]})
    traversal = base / 'separate-boundary'
    put(traversal / 'auth.json', 'harmless-deployment-sentinel\n')
    put(root / 'sibling-secrets/secret.txt', 'harmless-sibling-sentinel\n')
    faults = root / 'faults'
    faults.mkdir()
    (faults / 'escape.jsonl').symlink_to(root / '.claude.json')
    (faults / 'loop.jsonl').symlink_to('loop.jsonl')
    (faults / 'retarget.jsonl').symlink_to(native)
    store = base / 'store'
    store.mkdir(exist_ok=True)
    with sqlite3.connect(store / 'scan-cache.db') as db:
        db.execute('CREATE TABLE folder_project (path TEXT PRIMARY KEY, project TEXT, resolved_at TEXT, ver INTEGER)')
        db.execute('INSERT INTO folder_project VALUES (?,?,?,1)', (cwd, 'forge.invalid/example/poison', STAMP))
    manifest = {'root': str(root), 'native': str(native), 'codex': str(codex), 'meter': str(meter),
                'links': links, 'sentinels': sentinels, 'traversal': str(traversal), 'cwd': cwd}
    put(base / 'manifest.json', manifest)
    print(json.dumps(manifest))

def operator(file):
    # The caller separately attests existence before installing the boundary.
    # Never read contents, including on the deliberately readable failure control.
    result = {'access': os.access(file, os.R_OK)}
    try:
        os.stat(file)
        result['stat'] = 'exists'
    except OSError as error:
        result['stat'] = errno.errorcode.get(error.errno, str(error.errno))
    try:
        fd = os.open(file, os.O_RDONLY)
    except OSError as error:
        result['open'] = errno.errorcode.get(error.errno, str(error.errno))
        result['boundary'] = 'verified' if error.errno in (errno.EACCES, errno.EPERM) else 'unverified'
    else:
        os.close(fd)
        result.update(open='opened-unread', boundary='failed')
    print(json.dumps(result))

if __name__ == '__main__':
    mode, destination = sys.argv[1:3]
    if mode == 'materialize':
        materialize(Path(destination))
    elif mode == 'operator':
        operator(destination)
    elif mode == 'forbidden':
        # Deliberately bad scanner code: trace must catch even a denied open.
        try:
            with open(destination) as file:
                file.read(0)
        except PermissionError:
            pass
    elif mode == 'wal':
        db = database(Path(destination), wal=True)
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE usage SET output=999')
        print('WAL_READY', flush=True)
        sys.stdin.readline()
        db.rollback()
        db.close()
    else:
        raise SystemExit('unknown source-root fixture helper mode')
