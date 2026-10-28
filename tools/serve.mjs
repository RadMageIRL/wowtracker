// The local development server: node tools/serve.mjs [dir] [port]
// Defaults: the repo root on port 8080 (port 0 picks a free one), so edits show on reload with no
// build step; `node tools/serve.mjs dist` previews the production build. Sends a Date header so the
// clock check runs, and answers news.json from Blizzard's World of Warcraft news list, because that
// list does not allow cross-origin reads from the page. Also used by tests/smoke.mjs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
const UPSTREAM = 'https://news.blizzard.com/en-us/api/feed/world-of-warcraft';
const NEWS_CACHE_MS = 5 * 60000;

/**
 * Options:
 *   sendDate: false omits the Date header (browser tests run on a simulated clock);
 *   news: 'proxy' (default) passes news.json through to Blizzard, 'off' answers 404, or
 *         { body, status } answers with that body (tests never reach Blizzard).
 */
export function serve(dir, port = 0, { sendDate = true, news = 'proxy' } = {}) {
  const root = resolve(dir);
  let cached = null;
  async function newsBody() {
    if (cached && Date.now() - cached.at < NEWS_CACHE_MS) return cached;
    const res = await fetch(UPSTREAM, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    cached = { at: Date.now(), body: Buffer.from(await res.arrayBuffer()) };
    return cached;
  }
  const server = createServer(async (req, res) => {
    res.sendDate = sendDate;
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/news.json')) {
        if (news === 'off') { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
        const body = typeof news === 'object' ? Buffer.from(news.body) : (await newsBody()).body;
        res.writeHead(typeof news === 'object' && news.status ? news.status : 200, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      // Only what the site is made of: never local research, tools, tests or git internals.
      const rel = file.slice(root.length + 1).split(sep);
      if (['local', 'tools', 'tests', 'data', '.git', 'node_modules'].includes(rel[0])) throw new Error('not served');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      if (!res.headersSent) res.writeHead(/upstream|fetch|abort|timeout/i.test(String(e && e.message)) ? 502 : 404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const dir = process.argv[2] || '.';
  const { port } = await serve(dir, Number(process.argv[3] || 8080));
  console.log(`Serving ${resolve(dir)} at http://127.0.0.1:${port}/  (Ctrl+C to stop)`);
}
