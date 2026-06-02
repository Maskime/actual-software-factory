import { createServer, type Server } from 'node:http';

export function createHealthServer(port: number): Server {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else {
      res.writeHead(404).end();
    }
  }).listen(port);
}
