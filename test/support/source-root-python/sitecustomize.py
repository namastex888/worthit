"""Test instrumentation, not an extra-root policy implementation.

Records Python opens, probes, enumeration and SQLite connection requests. SQLite's
C-level sidecar opens are not Python calls; WAL tests also check immutable bytes.
No path/content from this private trace is printed by the fixture runner.
"""
import builtins
import calendar
import functools
import io
import json
import os
import socket
import sys
import time

_open = builtins.open
_stat = os.stat
_trace = os.environ.get('SOURCE_ROOT_TRACE')
_busy = False

def record(operation, name, outcome='attempt'):
    global _busy
    if not _trace or _busy or isinstance(name, int):
        return
    _busy = True
    try:
        path = os.fsdecode(name)
        try:
            identity = _stat(path[5:].split('?')[0] if path.startswith('file:') else name)
            dev, ino = str(identity.st_dev), str(identity.st_ino)
        except OSError:
            dev = ino = None
        with _open(_trace, 'a') as out:
            out.write(json.dumps({'actor': os.environ.get('SOURCE_ROOT_ACTOR', 'scanner'),
                                  'machine': os.environ.get('FIXTURE_MACHINE', 'fixture-reader'),
                                  'op': operation, 'path': path, 'outcome': outcome,
                                  'dev': dev, 'ino': ino}) + '\n')
    finally:
        _busy = False

def traced(fn, operation):
    @functools.wraps(fn)
    def call(name='.', *args, **kwargs):
        record(operation, name)
        if operation == 'scandir' and os.environ.get('SOURCE_ROOT_INTERRUPT') == os.fsdecode(name):
            raise OSError(5, 'synthetic interrupted enumeration')
        try:
            result = fn(name, *args, **kwargs)
        except OSError as error:
            record(operation, name, 'errno:' + str(error.errno))
            raise
        record(operation, name, 'returned')
        return result
    return call

builtins.open = traced(builtins.open, 'open')
io.open = traced(io.open, 'open')
for _name in ('open', 'stat', 'lstat', 'access', 'scandir', 'listdir', 'readlink'):
    setattr(os, _name, traced(getattr(os, _name), _name))

def audit(event, args):
    if event == 'sqlite3.connect':
        record('sqlite-connect', args[0])

sys.addaudithook(audit)
_now = calendar.timegm(time.strptime(os.environ.get('FIXTURE_NOW', '2026-11-14T12:00:00Z'), '%Y-%m-%dT%H:%M:%SZ'))
time.time = lambda: float(_now)
socket.gethostname = lambda: os.environ.get('FIXTURE_MACHINE', 'fixture-reader')

def no_network(*args, **kwargs):
    raise RuntimeError('source roots fixture: unstubbed network call')

socket.socket.connect = no_network
