// Drunken Frenchman — zero-dependency local web server (Node.js 14+).
// Usage:  node server.js [port] [--no-open]      (default port 8765; tries the next ports if it is busy)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const START_PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8765);
const OPEN_BROWSER = !process.argv.includes('--no-open') && !process.env.NO_OPEN;
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// Open the game in the player's default browser (macOS, Windows or Linux).
function openBrowser(url) {
  if (!OPEN_BROWSER) return;
  const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* if it fails, the URL is printed below anyway */ });
}

// Announce (and open the browser) exactly once, on whichever port we end up with.
server.once('listening', () => {
  const url = `http://localhost:${server.address().port}`;
  console.log(`\n  Drunken Frenchman is running at  ${url}\n  Leave this window open while you play. Close it (or press Ctrl+C) to stop.\n`);
  openBrowser(url);
});

// If the port is taken (for example a previous copy is still running), quietly try the next one.
function listen(port, attemptsLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) return listen(port + 1, attemptsLeft - 1);
    console.error(e.code === 'EADDRINUSE' ? 'No free port found between ' + START_PORT + ' and ' + port + '.' : e);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1');
}
listen(START_PORT, 10);
