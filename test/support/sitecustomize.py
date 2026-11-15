"""Test-only clock and synthetic hostname; no application code replaces the extractor."""
import os
import socket
import time
import calendar

_now = calendar.timegm(time.strptime(os.environ.get('FIXTURE_NOW', '2026-11-14T12:00:00Z'), '%Y-%m-%dT%H:%M:%SZ'))
time.time = lambda: float(_now)
socket.gethostname = lambda: os.environ.get('FIXTURE_MACHINE', 'box-a')

def denied(*args, **kwargs):
    raise RuntimeError('fixture attempted an unstubbed network call')

socket.socket.connect = denied
