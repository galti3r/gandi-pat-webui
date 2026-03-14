#!/usr/bin/env python3
"""
Reverse proxy for Gandi LiveDNS API.

Serves dist/ as static files and proxies /v5/* requests to
https://api.gandi.net/v5/* with the Authorization header forwarded.

Usage:
    python3 cors-proxy.py [--port 8000] [--bind 127.0.0.1] [--dist-dir dist]

Python stdlib only — no external dependencies.
"""
import argparse
import http.server
import os
import re
import signal
import sys
import urllib.error
import urllib.request

GANDI_API = 'https://api.gandi.net'
GANDI_ID = 'https://id.gandi.net'
_HASHED_ASSET_RE = re.compile(r'\.[a-f0-9]{8}\.(css|js|json)$')
MAX_BODY_SIZE = 10 * 1024 * 1024  # 10MB
FORWARDED_RESPONSE_HEADERS = (
    'Content-Type', 'Retry-After', 'Total-Count', 'Link',
    'X-Ratelimit-Limit', 'X-Ratelimit-Remaining',
)


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Serve static files from dist_dir, proxy /v5/* to Gandi API."""

    dist_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.dist_dir, **kwargs)

    def do_GET(self):
        if self.path == '/healthz':
            self._healthz()
        elif self.path == '/tokeninfo':
            self._proxy_tokeninfo()
        elif self.path.startswith('/v5/'):
            self._proxy()
        else:
            super().do_GET()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _healthz(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'ok')

    def _proxy_tokeninfo(self):
        target_url = GANDI_ID + '/tokeninfo'

        headers = {}
        if self.headers.get('Authorization'):
            headers['Authorization'] = self.headers['Authorization']

        req = urllib.request.Request(
            target_url,
            headers=headers,
            method='GET',
        )

        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type')
                if ct:
                    self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            ct = e.headers.get('Content-Type')
            if ct:
                self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except urllib.error.URLError:
            msg = b'Upstream API unreachable'
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        except BrokenPipeError:
            pass

    def _proxy(self):
        # Path validation — only /v5/ paths allowed
        if not self.path.startswith('/v5/'):
            self.send_error(403, 'Only /v5/ paths are allowed')
            return
        if '..' in self.path:
            self.send_error(400, 'Invalid path')
            return

        # Body size limit
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > MAX_BODY_SIZE:
            self.send_error(413, 'Request body too large')
            return

        target_url = GANDI_API + self.path

        # Read request body if present
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Build upstream request
        headers = {}
        if self.headers.get('Authorization'):
            headers['Authorization'] = self.headers['Authorization']
        if self.headers.get('Content-Type'):
            headers['Content-Type'] = self.headers['Content-Type']
        if self.headers.get('Accept'):
            headers['Accept'] = self.headers['Accept']

        req = urllib.request.Request(
            target_url,
            data=body,
            headers=headers,
            method=self.command,
        )

        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                for key in FORWARDED_RESPONSE_HEADERS:
                    val = resp.headers.get(key)
                    if val:
                        self.send_header(key, val)
                self.send_header('Content-Length', str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            for key in FORWARDED_RESPONSE_HEADERS:
                val = e.headers.get(key)
                if val:
                    self.send_header(key, val)
            self.send_header('Content-Length', str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except urllib.error.URLError:
            msg = b'Upstream API unreachable'
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        except BrokenPipeError:
            pass

    def end_headers(self):
        path = self.path.split('?')[0]
        if _HASHED_ASSET_RE.search(path):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        elif path in ('/', '/index.html'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def address_string(self):
        """Return client IP: X-Forwarded-For > X-Real-IP > socket IP.

        Container bridge IPs (10.x, 172.16-31.x) are replaced with '-'
        since they carry no useful information.
        """
        forwarded = self.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        real_ip = self.headers.get('X-Real-IP')
        if real_ip:
            return real_ip.strip()
        ip = super().address_string()
        if ip.startswith('10.') or re.match(r'^172\.(1[6-9]|2\d|3[01])\.', ip):
            return '-'
        return ip

    def log_message(self, format, *args):
        sys.stderr.write('%s - - [%s] %s\n' % (
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        ))


def main():
    parser = argparse.ArgumentParser(description='Reverse proxy for Gandi API')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)), help='Listen port (default: $PORT or 8000)')
    parser.add_argument('--bind', default='127.0.0.1', help='Bind address (default: 127.0.0.1)')
    parser.add_argument('--dist-dir', default=None, help='Static files directory (default: dist/)')
    args = parser.parse_args()

    if args.dist_dir:
        ProxyHandler.dist_dir = os.path.abspath(args.dist_dir)

    server = http.server.HTTPServer((args.bind, args.port), ProxyHandler)

    def _shutdown(*_args):
        # Set the flag directly — calling server.shutdown() from a signal
        # handler deadlocks because it waits for serve_forever() to exit,
        # but the handler blocks the main thread running serve_forever().
        server._BaseServer__shutdown_request = True

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    print(f'Serving {ProxyHandler.dist_dir} on http://{args.bind}:{args.port}', flush=True)
    print(f'Proxying /v5/* -> {GANDI_API}/v5/*', flush=True)
    print(f'Proxying /tokeninfo -> {GANDI_ID}/tokeninfo', flush=True)
    server.serve_forever()
    server.server_close()
    print('\nStopped.', flush=True)


if __name__ == '__main__':
    main()
