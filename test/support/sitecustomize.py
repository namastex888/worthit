"""Test-only clock and synthetic hostname; no application code replaces the extractor."""
import os
import socket
import time

time.time = lambda: 1794657600.0  # 2026-11-14T12:00:00Z
socket.gethostname = lambda: os.environ.get('FIXTURE_MACHINE', 'box-a')

def denied(*args, **kwargs):
    raise RuntimeError('fixture attempted an unstubbed network call')

socket.socket.connect = denied
