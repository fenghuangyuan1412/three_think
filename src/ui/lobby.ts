/**
 * 联机大厅：登录成功后、开局前的等待界面。
 *
 * 属于 ui/ 层：只渲染服务端快照（在线名单、座位分配、房主标识），
 * 并把「开局 / 重开」的意愿回调给 app.ts，由它发协议消息。
 */
import type { RoomSnapshot } from '../net/protocol';

export interface LobbyOptions {
  readonly myAccount: string;
  readonly onStart: () => void;
  readonly onReset: () => void;
}

export interface LobbyHandle {
  readonly element: HTMLElement;
  render(snapshot: RoomSnapshot, connectionOk: boolean, notice: string | null): void;
  dispose(): void;
}

const SEAT_COLORS: Record<string, string> = {
  p1: '#d9a441',
  p2: '#4aa39a',
  p3: '#c4614f',
  p4: '#6f83c9',
  p5: '#9a6fbd',
};

export function createLobby(options: LobbyOptions): LobbyHandle {
  const element = document.createElement('div');
  element.className = 'overlay';
  element.innerHTML = `
    <div class="overlay__card">
      <p class="overlay__eyebrow">联机大厅</p>
      <h1 class="overlay__title">等风也等船</h1>
      <p class="overlay__subtitle" data-role="hint"></p>
      <p class="auction__error" data-role="notice" hidden></p>
      <ul class="lobby-list" data-role="seats"></ul>
      <button class="btn btn--primary btn--wide" data-role="action" hidden></button>
      <p class="overlay__footnote">开局时在线玩家会被随机分配到五种颜色座位之一；断线会自动重连接回原座位。</p>
    </div>
  `;

  const hintEl = element.querySelector<HTMLElement>('[data-role="hint"]');
  const noticeEl = element.querySelector<HTMLElement>('[data-role="notice"]');
  const seatsEl = element.querySelector<HTMLUListElement>('[data-role="seats"]');
  const actionBtn = element.querySelector<HTMLButtonElement>('[data-role="action"]');
  if (!hintEl || !noticeEl || !seatsEl || !actionBtn) throw new Error('大厅结构不完整');

  actionBtn.addEventListener('click', () => {
    if (actionBtn.dataset.action === 'reset') options.onReset();
    else options.onStart();
  });

  return {
    element,

    render(snapshot, connectionOk, notice) {
      hintEl.textContent = connectionOk
        ? snapshot.roomPhase === 'lobby'
          ? '人齐（3–5 人在线）后由房主开局。'
          : snapshot.roomPhase === 'over'
            ? '本局已结束。'
            : '对局进行中，等待最新状态…'
        : '与服务器的连接断开，正在自动重连…';

      noticeEl.hidden = !notice;
      if (notice) noticeEl.textContent = notice;

      const onlineCount = snapshot.seats.filter((s) => s.online).length;
      seatsEl.replaceChildren(
        ...snapshot.seats.map((s) => {
          const li = document.createElement('li');
          li.className = 'lobby-seat';
          const dot = document.createElement('span');
          dot.className = 'player__dot';
          if (s.seat) dot.style.background = SEAT_COLORS[s.seat] ?? '#888';
          else dot.style.background = '#3a3f47';
          const name = document.createElement('span');
          name.className = 'player__name';
          name.textContent = `${s.displayName}${s.account === options.myAccount ? '（你）' : ''}`;
          li.append(dot, name);

          const tags = document.createElement('span');
          tags.className = 'player__tags';
          if (s.account === snapshot.hostAccount) tags.appendChild(tagOf('房主', 'tag--master'));
          if (s.seat) tags.appendChild(tagOf(s.seat, 'tag--share'));
          tags.appendChild(tagOf(s.online ? '在线' : '离线', s.online ? 'tag--turn' : 'tag--passed'));
          li.appendChild(tags);
          return li;
        }),
      );

      const isHost = snapshot.hostAccount === options.myAccount;
      if (snapshot.roomPhase === 'lobby') {
        actionBtn.hidden = !isHost;
        actionBtn.textContent = `开局（当前 ${onlineCount} 人在线）`;
        actionBtn.dataset.action = 'start';
      } else if (snapshot.roomPhase === 'over') {
        actionBtn.hidden = !isHost;
        actionBtn.textContent = '回到大厅重开';
        actionBtn.dataset.action = 'reset';
      } else {
        actionBtn.hidden = true;
      }
    },

    dispose() {
      element.remove();
    },
  };
}

function tagOf(text: string, className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `tag ${className}`;
  span.textContent = text;
  return span;
}
