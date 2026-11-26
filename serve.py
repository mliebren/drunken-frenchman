#!/usr/bin/env python3
"""Fallback server when Node.js is not installed:  python3 serve.py [port] [--no-open]"""
import http.server, os, socketserver, sys, webbrowser

args = [a for a in sys.argv[1:] if a.isdigit()]
START = int(args[0]) if args else 8765
OPEN = "--no-open" not in sys.argv and not os.environ.get("NO_OPEN")
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):  # keep the console quiet
        pass

socketserver.TCPServer.allow_reuse_address = True
httpd = None
for port in range(START, START + 11):  # if the port is busy, try the next one
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
        break
    except OSError:
        continue
if httpd is None:
    sys.exit("No free port found.")
url = f"http://localhost:{port}"
print(f"\n  Drunken Frenchman is running at  {url}\n  Leave this window open while you play. Close it (or press Ctrl+C) to stop.\n")
if OPEN:
    webbrowser.open(url)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
