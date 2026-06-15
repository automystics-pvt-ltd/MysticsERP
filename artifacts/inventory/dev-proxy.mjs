// Transparent HTTP + WebSocket proxy: localhost:5000 → localhost:18174
// Lets Replit's external :80 preview (local :5000) show the Vite dev server
// while the artifact workflow continues to open the expected port 18174.
import http from 'http';
import net from 'net';

const TARGET = 18174;
const LISTEN = 5000;
const RETRY_MS = 500;
const RETRY_MAX = 60;

let retries = 0;

function startProxy() {
  const server = http.createServer((req, res) => {
    const proxyReq = http.request(
      { hostname: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    proxyReq.on('error', () => { try { res.destroy(); } catch (_) {} });
    req.pipe(proxyReq, { end: true });
  });

  server.on('upgrade', (req, socket, head) => {
    const conn = net.connect(TARGET, '127.0.0.1', () => {
      const hdrs = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      conn.write(`${req.method} ${req.url} HTTP/1.1\r\n${hdrs}\r\n\r\n`);
      if (head && head.length) conn.write(head);
      socket.pipe(conn);
      conn.pipe(socket);
    });
    conn.on('error', () => { try { socket.destroy(); } catch (_) {} });
    socket.on('error', () => { try { conn.destroy(); } catch (_) {} });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries < RETRY_MAX) {
      retries++;
      setTimeout(startProxy, RETRY_MS);
    } else {
      console.error('dev-proxy error:', err.message);
      process.exit(1);
    }
  });

  server.listen(LISTEN, '0.0.0.0', () => {
    console.log(`dev-proxy: :${LISTEN} → :${TARGET}`);
  });
}

startProxy();
