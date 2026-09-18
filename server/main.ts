/**
 * 联机服务端入口：HTTP 健康检查 + WebSocket 房间。
 *
 * 运行：npm run server（tsx 直跑 TS）。端口默认 8787，用环境变量 PORT 覆盖。
 * 账号表放在 server/accounts.json（已 gitignore，公网仓库里只有 example）。
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { createRoom, type AccountEntry, type Room } from './room';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 32 * 1024;

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
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES });

wss.on('connection', (ws) => {
  const conn: Conn = { ws, id: randomUUID(), account: null };
  conns.set(conn.id, conn);

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
  }
}

httpServer.listen(PORT, () => {
  console.log(`马尼拉联机服务已启动：ws://localhost:${PORT}`);
});
