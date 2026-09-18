/**
 * 浏览器侧的 WebSocket 封装：登录、断线自动重连并重新接管座位。
 *
 * 属于 ui/net 的粘合层：只收发协议消息，不做任何规则判定。
 */
import type { ClientMessage, RoomSnapshot, ServerMessage } from './protocol';

export interface NetHandlers {
  readonly onSnapshot: (snapshot: RoomSnapshot) => void;
  readonly onLoginOk: (account: string) => void;
  readonly onError: (message: string) => void;
  /** 连接断开 / 恢复，用于顶栏提示 */
  readonly onConnection: (connected: boolean) => void;
}

/** 根据当前页面推导默认服务端地址：公网 https 站走 Funnel 10000，本地 dev 走 8787 */
export function defaultServerUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const port = location.protocol === 'https:' ? '10000' : '8787';
  return `${proto}://${location.hostname}:${port}`;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryDelay = 800;

  constructor(
    private readonly url: string,
    private readonly account: string,
    private readonly password: string,
    private readonly handlers: NetHandlers,
  ) {
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = 800;
      this.handlers.onConnection(true);
      this.send({ type: 'login', account: this.account, password: this.password });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'login-ok':
          this.handlers.onLoginOk(msg.account);
          break;
        case 'snapshot':
          this.handlers.onSnapshot(msg.snapshot);
          break;
        case 'error':
          this.handlers.onError(msg.message);
          break;
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.handlers.onConnection(false);
      window.setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 4000);
    };

    ws.onerror = () => {
      // onclose 会跟着触发，这里不需要额外动作
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
