"""Capture a real sized stdout PTY; stdin stays closed, so this is not an interactive session."""
import errno
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

columns, status_file, *command = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 1000, int(columns), 0, 0))
child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave)
os.close(slave)
deadline = time.monotonic() + 25
captured = bytearray()
try:
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
            child.kill()
            raise TimeoutError('CLI PTY capture timed out')
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            break  # Linux PTYs report EIO when the slave closes.
        if not chunk:
            break
        captured.extend(chunk)
    code = child.wait(timeout=5)
    with open(status_file, 'w') as handle:
        json.dump({'cli_exit': code, 'stdout_tty': True, 'columns': int(columns)}, handle)
    sys.stdout.buffer.write(captured)
    sys.exit(code)
finally:
    os.close(master)
    if child.poll() is None:
        child.kill()
        child.wait()
