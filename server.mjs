import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
const port = Number(process.env.PORT || 4174);
createServer(async (req, res) => {
  files['/studio.css'] = ['studio.css', 'text/css'];
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const data = await readFile(new URL(`./dist/${file[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(data);
  } catch { res.writeHead(500); res.end('Unable to load interface'); }
}).listen(port, '127.0.0.1', () => console.log(`Manim Educator: http://localhost:${port}`));
