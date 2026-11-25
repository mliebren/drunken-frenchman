#!/usr/bin/env python3
"""Fallback server if Node.js is not installed:  python3 serve.py [port]"""
import http.server, os, socketserver, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
    print(f"\n  Drunken Frenchman is running at  http://localhost:{PORT}\n  Press Ctrl+C to stop.\n")
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
