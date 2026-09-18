/**
 * 开始界面：模式选择 —— 本地热座（选人数与玩家名）或联机（账号密码登录）。
 *
 * 属于 ui/ 层（agent.md §3）：只收集玩家意愿，产出一次 onStart / onOnlineLogin 回调，
 * 不直接改对局状态 —— 真正建局由 app.ts 调用 core/game.ts 完成，
 * 联机建局则由服务端完成。
 */
import { ACCOMPLICES_BY_PLAYER_COUNT, SUPPORTED_PLAYER_COUNTS } from '../config/constants';
import { defaultServerUrl } from '../net/client';

export interface OnlineCredentials {
  readonly url: string;
  readonly account: string;
  readonly password: string;
}

export interface StartScreenOptions {
  readonly onStart: (playerCount: number, names: readonly string[]) => void;
  readonly onOnlineLogin: (creds: OnlineCredentials) => void;
}

export interface StartScreenHandle {
  readonly element: HTMLElement;
  /** 服务端拒绝登录时把错误显示回联机面板 */
  setOnlineError(message: string): void;
  dispose(): void;
}

const URL_STORAGE_KEY = 'manila.server-url';

export function createStartScreen(options: StartScreenOptions): StartScreenHandle {
  const element = document.createElement('div');
  element.className = 'overlay';
  element.innerHTML = `
    <div class="overlay__card">
      <p class="overlay__eyebrow">three_think · 第一版</p>
      <h1 class="overlay__title">马尼拉</h1>
      <p class="overlay__subtitle">
        1821 年，马尼拉港的黑市贸易。竞标港务长的办事处，
        决定这一航程装载哪些货物、平底船从哪里出发。
      </p>

      <div class="mode-tabs" role="tablist">
        <button type="button" class="mode-tabs__tab is-active" data-role="tab-hotseat" role="tab" aria-selected="true">本地热座</button>
        <button type="button" class="mode-tabs__tab" data-role="tab-online" role="tab" aria-selected="false">联机</button>
      </div>

      <div data-role="hotseat-panel">
        <div class="overlay__section">
          <p class="overlay__label">游戏人数</p>
          <div class="count-picker" role="radiogroup" aria-label="游戏人数"></div>
          <p class="overlay__note" data-role="count-note"></p>
        </div>

        <div class="overlay__section">
          <p class="overlay__label">玩家</p>
          <div class="name-list" data-role="names"></div>
        </div>

        <button class="btn btn--primary btn--wide" data-role="start">开始游戏</button>

        <p class="overlay__footnote">
          本地热座模式：3–5 人轮流在同一台设备上操作。
          完整一局可玩；行动牌与登船细节为后续版本内容。
        </p>
      </div>

      <div data-role="online-panel" hidden>
        <div class="overlay__section">
          <p class="overlay__label">服务器地址</p>
          <input class="text-input" type="text" data-role="server-url" spellcheck="false" />
        </div>
        <div class="overlay__section">
          <p class="overlay__label">账号</p>
          <div class="online-form">
            <input class="text-input" type="text" data-role="account" placeholder="例如 xiaoming" autocomplete="username" spellcheck="false" />
            <input class="text-input" type="password" data-role="password" placeholder="密码" autocomplete="current-password" />
          </div>
        </div>
        <p class="auction__error" data-role="online-error" hidden></p>
        <button class="btn btn--primary btn--wide" data-role="login">登录进入大厅</button>
        <p class="overlay__footnote">
          联机模式：使用组织者发的账号登录，开局时随机分配到五种颜色的座位之一。
          断线会自动重连接回原座位。
        </p>
      </div>
    </div>
  `;

  const picker = element.querySelector<HTMLElement>('.count-picker');
  const noteEl = element.querySelector<HTMLElement>('[data-role="count-note"]');
  const namesEl = element.querySelector<HTMLElement>('[data-role="names"]');
  const startBtn = element.querySelector<HTMLButtonElement>('[data-role="start"]');
  const tabHotseat = element.querySelector<HTMLButtonElement>('[data-role="tab-hotseat"]');
  const tabOnline = element.querySelector<HTMLButtonElement>('[data-role="tab-online"]');
  const hotseatPanel = element.querySelector<HTMLElement>('[data-role="hotseat-panel"]');
  const onlinePanel = element.querySelector<HTMLElement>('[data-role="online-panel"]');
  const urlInput = element.querySelector<HTMLInputElement>('[data-role="server-url"]');
  const accountInput = element.querySelector<HTMLInputElement>('[data-role="account"]');
  const passwordInput = element.querySelector<HTMLInputElement>('[data-role="password"]');
  const onlineErrorEl = element.querySelector<HTMLElement>('[data-role="online-error"]');
  const loginBtn = element.querySelector<HTMLButtonElement>('[data-role="login"]');
  if (
    !picker || !noteEl || !namesEl || !startBtn ||
    !tabHotseat || !tabOnline || !hotseatPanel || !onlinePanel ||
    !urlInput || !accountInput || !passwordInput || !onlineErrorEl || !loginBtn
  ) {
    throw new Error('开始界面结构不完整');
  }

  let playerCount = 4;
  const names: string[] = [];

  urlInput.value = localStorage.getItem(URL_STORAGE_KEY) ?? defaultServerUrl();

  // 本标签页登录过就预填，方便断线后刷新快速重连
  try {
    const saved = sessionStorage.getItem('manila.online-creds');
    if (saved) {
      const creds = JSON.parse(saved) as Partial<OnlineCredentials>;
      if (creds.account) accountInput.value = creds.account;
      if (creds.password) passwordInput.value = creds.password;
      if (creds.url) urlInput.value = creds.url;
    }
  } catch {
    /* 预填失败不影响使用 */
  }

  function showTab(online: boolean): void {
    tabHotseat!.classList.toggle('is-active', !online);
    tabOnline!.classList.toggle('is-active', online);
    tabHotseat!.setAttribute('aria-selected', String(!online));
    tabOnline!.setAttribute('aria-selected', String(online));
    hotseatPanel!.hidden = online;
    onlinePanel!.hidden = !online;
  }

  tabHotseat.addEventListener('click', () => showTab(false));
  tabOnline.addEventListener('click', () => showTab(true));

  loginBtn.addEventListener('click', () => {
    const url = urlInput!.value.trim();
    const account = accountInput!.value.trim();
    const password = passwordInput!.value;
    if (!url || !account || !password) {
      onlineErrorEl!.hidden = false;
      onlineErrorEl!.textContent = '服务器地址、账号、密码都要填。';
      return;
    }
    localStorage.setItem(URL_STORAGE_KEY, url);
    onlineErrorEl!.hidden = true;
    options.onOnlineLogin({ url, account, password });
  });

  for (const count of SUPPORTED_PLAYER_COUNTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'count-picker__option';
    button.textContent = `${count} 人`;
    button.setAttribute('role', 'radio');
    button.addEventListener('click', () => {
      playerCount = count;
      syncCount();
    });
    picker.appendChild(button);
  }

  function syncCount(): void {
    picker?.querySelectorAll<HTMLButtonElement>('.count-picker__option').forEach((button, i) => {
      const count = SUPPORTED_PLAYER_COUNTS[i];
      const active = count === playerCount;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
    });

    const accomplices = ACCOMPLICES_BY_PLAYER_COUNT[playerCount] ?? 3;
    noteEl!.textContent = `每人 ${accomplices} 个小弟、30 元披索、2 张股份。`;
    renderNames();
  }

  function renderNames(): void {
    namesEl!.replaceChildren();
    for (let i = 0; i < playerCount; i += 1) {
      const row = document.createElement('label');
      row.className = 'name-row';

      const dot = document.createElement('span');
      dot.className = `name-row__dot name-row__dot--${i + 1}`;

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 12;
      input.placeholder = `玩家 ${i + 1}`;
      input.value = names[i] ?? '';
      input.addEventListener('input', () => {
        names[i] = input.value;
      });

      row.append(dot, input);
      namesEl!.appendChild(row);
    }
  }

  startBtn.addEventListener('click', () => {
    const finalNames = Array.from({ length: playerCount }, (_, i) => names[i]?.trim() || `玩家 ${i + 1}`);
    options.onStart(playerCount, finalNames);
  });

  syncCount();

  return {
    element,

    setOnlineError(message) {
      onlineErrorEl.hidden = false;
      onlineErrorEl.textContent = message;
    },

    dispose() {
      element.remove();
    },
  };
}
