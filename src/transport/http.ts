import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import type { RewardService } from '../application/rewardService.js';
import { isUserId } from '../infra/ids.js';
import { SlidingWindowLimiter } from '../infra/rateLimit.js';
import { parseMatchEvent } from '../protocol/validate.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 32_768) throw new Error('TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin ?? '*';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('x-content-type-options', 'nosniff');
}

function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

async function serveStatic(webRoot: string, urlPath: string, res: ServerResponse): Promise<boolean> {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = resolve(webRoot, normalize('.' + requested));
  if (!resolved.startsWith(resolve(webRoot))) return false;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return false;
    const type = MIME[extname(resolved)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
    });
    createReadStream(resolved).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export function createRewardServer(service: RewardService, webRoot: string) {
  const limiter = new SlidingWindowLimiter(40, 10_000);
  const rateDisabled = process.env['RATE_LIMIT_DISABLED'] === '1';

  return createServer(async (req, res) => {
    cors(req, res);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (req.method === 'POST' && !rateDisabled && !limiter.allow(clientKey(req), Date.now())) {
        send(res, 429, { kind: 'REJECTED', code: 'RATE_LIMITED' });
        return;
      }

      if (req.method === 'GET' && path === '/health') {
        send(res, 200, { ok: true, service: 'rally' });
        return;
      }
      if (req.method === 'GET' && path === '/api/rules') {
        send(res, 200, service.rules());
        return;
      }
      if (req.method === 'GET' && path === '/api/players') {
        send(res, 200, { players: service.listPlayers() });
        return;
      }
      if (req.method === 'GET' && path === '/api/feed') {
        send(res, 200, { grants: service.feed() });
        return;
      }
      if (req.method === 'GET' && (path.startsWith('/api/state/') || path.startsWith('/state/'))) {
        const userId = decodeURIComponent(path.replace(/^\/api/, '').slice('/state/'.length));
        if (!isUserId(userId)) {
          send(res, 400, { kind: 'REJECTED', code: 'INVALID_USER' });
          return;
        }
        send(res, 200, service.snapshot(userId));
        return;
      }
      if (req.method === 'POST' && (path === '/api/matches' || path === '/matches')) {
        const parsed = parseMatchEvent(await readJson(req));
        if (!parsed.ok) {
          send(res, 400, { kind: 'REJECTED', code: parsed.code });
          return;
        }
        const result = await service.ingest(parsed.event);
        send(res, result.kind === 'REJECTED' ? 400 : 200, result);
        return;
      }
      if (req.method === 'POST' && path === '/api/reset') {
        send(res, 200, await service.reset());
        return;
      }
      if (req.method === 'POST' && path === '/api/lab/t0') {
        const body = (await readJson(req)) as { userId?: string };
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        if (!isUserId(userId)) {
          send(res, 400, { kind: 'REJECTED', code: 'INVALID_USER' });
          return;
        }
        send(res, 200, await service.labT0(userId));
        return;
      }

      if (req.method === 'GET') {
        const served = await serveStatic(webRoot, path, res);
        if (served) return;
        if (path === '/' || extname(path) === '') {
          const fallback = await serveStatic(webRoot, '/index.html', res);
          if (fallback) return;
        }
      }

      send(res, 404, { kind: 'REJECTED', code: 'NOT_FOUND' });
    } catch {
      send(res, 400, { kind: 'REJECTED', code: 'BAD_REQUEST' });
    }
  });
}
