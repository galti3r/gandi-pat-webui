#!/usr/bin/env python3
"""Find first available TCP port starting from a given port (default 8001)."""
import socket
import sys

start = int(sys.argv[1]) if len(sys.argv) > 1 else 8001

for port in range(start, start + 100):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(('127.0.0.1', port))
        s.close()
        print(port)
        sys.exit(0)
    except OSError:
        s.close()

print(f'No free port found in range {start}-{start + 99}', file=sys.stderr)
sys.exit(1)
