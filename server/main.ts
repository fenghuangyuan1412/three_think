/**
 * 联机服务端入口：HTTP 健康检查 + WebSocket 房间。
 *
 * 运行：npm run server（tsx 直跑 TS）。端口默认 8787，用环境变量 PORT 覆盖。
 * 账号表放在 server/accounts.json（已 gitignore，公网仓库里只有 example）。
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { createRoom, type AccountEntry, type Room } from './room';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 32 * 1024;
/** 心跳间隔：超过两个周期没回 pong 的连接按死线处理（NAT 静默断连的兜底） */
const HEARTBEAT_MS = 15_000;

/** dist/ 静态托管：让同一个进程既发页面又发 WebSocket，公网链路少一跳 */
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function loadAccounts(): AccountEntry[] {
  const url = new URL('./accounts.json', import.meta.url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(url, 'utf8'));
  } catch {
    console.error('缺少 server/accounts.json —— 复制 accounts.example.json 并填入账号密码。');
    process.exit(1);
  }
  const list = (parsed as { accounts?: unknown }).accounts;
  if (!Array.isArray(list) || list.length === 0) {
    console.error('accounts.json 需要形如 { "accounts": [{ "account", "password", "name" }] } 且非空。');
    process.exit(1);
  }
  return list as AccountEntry[];
}

interface Conn {
  readonly ws: WebSocket;
  readonly id: string;
  account: string | null;
  alive: boolean;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const raw = (req.url ?? '/').split('?')[0] ?? '/';
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const rel = normalize(path === '/' ? '/index.html' : path);
  const file = resolve(DIST, '.' + rel);
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    // 单页应用：未知路径回落到 index.html，交由前端路由
    const fallback = resolve(DIST, 'index.html');
    if (!existsSync(fallback)) {
      res.writeHead(404);
      res.end('缺少 dist/ —— 先 npm run build 再 npm run server。');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    createReadStream(fallback).pipe(res);
    return;
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = extname(file) === '.html' ? 'no-store' : 'public, max-age=86400';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  createReadStream(file).pipe(res);
}

const room: Room = createRoom(loadAccounts());
const conns = new Map<string, Conn>();

function send(conn: Conn, msg: ServerMessage): void {
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
}

function sendError(conn: Conn, code: string, message: string): void {
  send(conn, { type: 'error', code, message });
}

function broadcastSnapshot(): void {
  const snapshot = room.snapshot();
  for (const conn of conns.values()) {
    if (conn.account) send(conn, { type: 'snapshot', snapshot });
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES });

wss.on('connection', (ws) => {
  const conn: Conn = { ws, id: randomUUID(), account: null, alive: true };
  conns.set(conn.id, conn);
  ws.on('pong', () => {
    conn.alive = true;
  });

  ws.on('message', (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      sendError(conn, 'bad-json', '消息不是合法 JSON。');
      return;
    }
    handle(conn, msg);
  });

  ws.on('close', () => {
    conns.delete(conn.id);
    if (conn.account) {
      // 只有该账号最后一条连接断开才算离线
      const stillOpen = [...conns.values()].some((c) => c.account === conn.account);
      if (!stillOpen) {
        room.setOnline(conn.account, false);
        console.log(`离线：${conn.account}`);
        broadcastSnapshot();
      }
    }
  });
});

function handle(conn: Conn, msg: ClientMessage): void {
  if (msg.type === 'login') {
    const result = room.login(msg.account, msg.password);
    if (!result.ok) {
      sendError(conn, result.code, result.message);
      return;
    }
    if (conn.account !== msg.account) {
      // 同一账号重复登录：踢掉旧连接，接管座位
      for (const other of conns.values()) {
        if (other !== conn && other.account === msg.account) other.ws.close(4000, 'replaced');
      }
      conn.account = msg.account;
    }
    room.setOnline(msg.account, true);
    send(conn, { type: 'login-ok', account: msg.account });
    console.log(`上线：${msg.account}`);
    broadcastSnapshot();
    return;
  }

  if (!conn.account) {
    sendError(conn, 'need-login', '请先登录。');
    return;
  }
  const account = conn.account;

  switch (msg.type) {
    case 'start': {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const result = room.start(account, seed);
      if (!result.ok) sendError(conn, result.code, result.message);
      else console.log(`开局：seed=${seed}`);
      broadcastSnapshot();
      break;
    }
    case 'intent': {
      const result = room.applyIntentFrom(account, msg.intent);
      if (!result.ok) sendError(conn, result.code, result.message);
      broadcastSnapshot();
      break;
    }
    case 'reset': {
      const result = room.reset(account);
      if (!result.ok) sendError(conn, result.code, result.message);
      else console.log('回到大厅');
      broadcastSnapshot();
      break;
    }
    case 'reconnect-all': {
      if (account !== room.hostAccount()) {
        sendError(conn, 'not-host', '只有房主可以执行全员重连。');
        break;
      }
      let n = 0;
      for (const other of conns.values()) {
        if (other === conn) continue;
        other.ws.terminate();
        n += 1;
      }
      console.log(`房主 ${account} 触发全员重连，断开 ${n} 条连接`);
      break;
    }
  }
}

setInterval(() => {
  for (const conn of conns.values()) {
    if (!conn.alive) {
      console.log(`心跳超时，断开僵尸连接：${conn.account ?? '未登录'}`);
      conn.ws.terminate();
      continue;
    }
    conn.alive = false;
    conn.ws.ping();
  }
}, HEARTBEAT_MS).unref();

httpServer.listen(PORT, () => {
  console.log(`马尼拉联机服务已启动：ws://localhost:${PORT}（含静态站 ${DIST}）`);
});
