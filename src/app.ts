/**
 * 应用装配：把 core（规则）、render（画面）、ui（界面）接起来。
 *
 * 分层的粘合点就在这里 —— 它是唯一同时认识三层的文件，
 * 而 core / render / ui 三者之间互不依赖（agent.md §3）。
 *
 * 两种运行形态：
 * - 本地热座：applyIntent 在本机跑（原路径）。
 * - 联机：core 在服务端权威执行，本机只发意图、收快照、照单渲染。
 */
import { GOODS } from './config/board-layout';
import { applyIntent, createGame, startVoyage, type GameState, type Intent } from './core/game';
import type { PlayerId } from './core/types';
import { NetClient } from './net/client';
import type { RoomSnapshot } from './net/protocol';
import { createAccomplices } from './render/accomplices';
import { createBoard } from './render/board';
import { installDevHook } from './render/dev-hook';
import { createDice } from './render/dice';
import { disposeLabelTextures } from './render/labels';
import { disposeSkins } from './render/skins';
import { createScene } from './render/scene';
import { skew } from './render/coords';
import { goodHexCss } from './render/resources';
import { createGamePanel, type GamePanelHandle } from './ui/game-panel';
import { createGameOverOverlay } from './ui/phase-views';
import { createHud } from './ui/hud';
import { createKeepAwake } from './ui/keep-awake';
import { createLobby, type LobbyHandle } from './ui/lobby';
import { createNegotiation, type NegotiationHandle } from './ui/negotiation';
import { createRulebook } from './ui/rulebook';
import { createSettings, loadSettings, type SettingsValues } from './ui/settings';
import { createStartScreen, type OnlineCredentials, type StartScreenHandle } from './ui/start-screen';

export function bootApp(root: HTMLElement): void {
  root.replaceChildren();

  const stage = document.createElement('div');
  stage.className = 'stage';
  root.appendChild(stage);

  const scene = createScene(stage);
  const board = createBoard();
  scene.scene.add(board.group);

  const accomplices = createAccomplices();
  scene.scene.add(accomplices.group);

  // 船只移动补间 + 骰子抛掷演出
  const dice = createDice(goodHexCss);
  scene.scene.add(dice.group);
  const diceCenter = skew({ x: 0, z: -6.8 });
  scene.onFrame((delta) => {
    board.update(delta);
    dice.update(delta);
  });

  // 仅开发环境：暴露取景检测，供浏览器验证脚本断言棋盘未被截断
  if (import.meta.env.DEV) {
    installDevHook(scene.scene, scene.camera, scene.renderer);
  }

  const hud = createHud();
  root.appendChild(hud.element);
  scene.onStats((stats) => hud.update(stats));

  // 底部入口排：规则说明书 + 设置（板面不放玩法说明）
  const fabBar = document.createElement('div');
  fabBar.className = 'fab-bar';
  const rulebook = createRulebook();
  fabBar.appendChild(rulebook.element);

  let settings: SettingsValues = loadSettings({ animations: true, hud: true });
  hud.element.style.display = settings.hud ? '' : 'none';
  const settingsPanel = createSettings({
    initial: settings,
    onChange: (next) => {
      settings = next;
      hud.element.style.display = next.hud ? '' : 'none';
    },
    onReturnHome: returnHome,
  });
  fabBar.appendChild(settingsPanel.element);
  root.appendChild(fabBar);

  /** 把 core 的状态同步到画面 */
  let lastDiceKey: string | null = null;

  /** 游戏结束演出：只在「进入 game-over」这一刻弹一次 */
  let gameOverOverlay: HTMLElement | null = null;
  let lastPhase: GameState['phase'] | null = null;

  function closeGameOverOverlay(): void {
    gameOverOverlay?.remove();
    gameOverOverlay = null;
  }

  function maybePlayGameOver(next: GameState): void {
    if (next.phase === 'game-over' && lastPhase !== 'game-over') {
      closeGameOverOverlay();
      gameOverOverlay = createGameOverOverlay(next, closeGameOverOverlay);
      root.appendChild(gameOverOverlay);
    } else if (next.phase !== 'game-over' && gameOverOverlay) {
      closeGameOverOverlay();
    }
    lastPhase = next.phase;
  }

  // 谈判浮层：阶段一进来就挂上，离开阶段即撤；操作走当前会话的意图通道
  let negotiation: NegotiationHandle | null = null;
  let currentEmit: ((intent: Intent) => void) | null = null;
  let currentYou: PlayerId | null = null;

  function syncNegotiation(next: GameState): void {
    if (next.phase === 'negotiation' && currentEmit) {
      negotiation ??= createNegotiation({ you: currentYou, onIntent: (i) => currentEmit?.(i) });
      if (!negotiation.element.isConnected) root.appendChild(negotiation.element);
      negotiation.render(next);
    } else if (next.phase !== 'negotiation' && negotiation) {
      negotiation.dispose();
      negotiation = null;
    }
  }

  function closeSessionOverlays(): void {
    closeGameOverOverlay();
    negotiation?.dispose();
    negotiation = null;
    currentEmit = null;
    lastPhase = null;
  }

  function syncView(next: GameState, immediate = false): void {
    const noAnim = immediate || !settings.animations;
    maybePlayGameOver(next);
    syncNegotiation(next);
    // 结算统一进港演出：航行阶段（含谈判/领航员）里已抵达的船先在 13 格候补，payout 才跃入港湾/船厂
    const showDocked =
      next.phase !== 'placement' &&
      next.phase !== 'negotiation' &&
      next.phase !== 'pilot' &&
      next.phase !== 'pirate-boarding' &&
      next.phase !== 'movement';
    board.syncBoats(next.boats, noAnim, showDocked);

    accomplices.sync(next.placements, next.players, board, next.boats);

    // 价格标记：GOODS 的下标与价格轨的行一一对应
    GOODS.forEach((good, index) => {
      board.setPriceIndex(index, next.priceIndex[good.id] ?? 0);
    });

    // 骰子演出：state.dice 变了才抛一次；开局/重连或关闭演出时只记不播
    const diceKey = next.dice ? next.dice.map((d) => `${d.good}:${d.pips}`).join('|') : null;
    if (next.dice && diceKey !== lastDiceKey && !noAnim) dice.throw(next.dice, diceCenter);
    lastDiceKey = diceKey;
  }

  // ---------------------------------------------------------------- 开始屏

  let startScreen: StartScreenHandle | null = null;

  /** 当前对局（热座或联机）的清场函数，由 startHotseat / startOnline 赋值 */
  let leaveSession: (() => void) | null = null;

  /** 设置面板「退回主界面」：结束当前对局回到开始屏 */
  function returnHome(): void {
    closeSessionOverlays();
    leaveSession?.();
    leaveSession = null;
    showStartScreen();
  }

  function showStartScreen(): void {
    const screen = createStartScreen({
      onStart: startHotseat,
      onOnlineLogin: startOnline,
    });
    startScreen = screen;
    root.appendChild(screen.element);
  }

  function leaveStartScreen(): void {
    startScreen?.dispose();
    startScreen = null;
  }

  // ---------------------------------------------------------------- 热座

  function startHotseat(playerCount: number, names: readonly string[]): void {
    leaveStartScreen();

    let state: GameState | null = null;
    let panel: GamePanelHandle | null = null;

    function handleIntent(intent: Intent): void {
      if (!state || !panel) return;
      const outcome = applyIntent(state, intent);
      if (!outcome.ok) {
        panel.render(state, outcome.error.message);
        return;
      }
      state = outcome.state;
      syncView(state, intent.type === 'master-launch' || intent.type === 'master-load');
      panel.render(state, null);
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    hud.setSeed(seed);

    state = startVoyage(createGame({ playerCount, names, seed }));
    currentYou = null;
    currentEmit = handleIntent;
    syncView(state, true);

    panel = createGamePanel({ onIntent: handleIntent });
    root.appendChild(panel.element);
    panel.render(state, null);

    leaveSession = () => {
      closeSessionOverlays();
      panel?.dispose();
      panel = null;
      state = null;
    };
  }

  // ---------------------------------------------------------------- 联机

  function startOnline(creds: OnlineCredentials): void {
    sessionStorage.setItem('manila.online-creds', JSON.stringify(creds));

    let panel: GamePanelHandle | null = null;
    let lobby: LobbyHandle | null = null;
    let bar: HTMLElement | null = null;
    let mySeat: PlayerId | null = null;
    let connectionOk = false;
    let lastSnapshot: RoomSnapshot | null = null;
    let notice: string | null = null;
    const keepAwake = createKeepAwake();

    const net = new NetClient(creds.url, creds.account, creds.password, {
      onLoginOk: () => leaveStartScreen(),
      onReplaced: () => showReplacedNotice(),
      onConnection: (ok) => {
        connectionOk = ok;
        redraw();
      },
      onError: (message) => {
        notice = message;
        redraw();
      },
      onSnapshot: (snapshot) => {
        notice = null;
        lastSnapshot = snapshot;
        mySeat = snapshot.seats.find((s) => s.account === creds.account)?.seat ?? null;
        currentYou = mySeat;

        if (snapshot.roomPhase === 'lobby' || !snapshot.state) {
          panel?.dispose();
          panel = null;
          ensureLobby();
          lobby!.render(snapshot, connectionOk, notice);
          notice = null;
          renderBar(snapshot);
          return;
        }

        disposeLobby();
        const state = snapshot.state;
        if (!panel) {
          hud.setSeed(state.seed);
          panel = createGamePanel({
            you: mySeat,
            onIntent: (intent) => net.send({ type: 'intent', intent }),
          });
          root.appendChild(panel.element);
          syncView(state, true);
        }
        syncView(state);
        panel.render(state, notice);
        notice = null;
        renderBar(snapshot);
      },
    });

    currentEmit = (intent) => net.send({ type: 'intent', intent });

    leaveSession = () => {
      closeSessionOverlays();
      net.close();
      panel?.dispose();
      panel = null;
      disposeLobby();
      bar?.remove();
      bar = null;
    };

    function showReplacedNotice(): void {
      panel?.dispose();
      panel = null;
      disposeLobby();
      bar?.remove();
      bar = null;
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const card = document.createElement('div');
      card.className = 'overlay__card';
      const title = document.createElement('h1');
      title.className = 'overlay__title';
      title.textContent = '该账号已在别处登录';
      const hint = document.createElement('p');
      hint.className = 'overlay__subtitle';
      hint.textContent = `账号 ${creds.account} 的另一条连接接管了座位，本页已下线。为避免互相顶号，本页不再自动重连。`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary btn--wide';
      btn.textContent = '刷新重新登录';
      btn.addEventListener('click', () => location.reload());
      card.append(title, hint, btn);
      overlay.appendChild(card);
      root.appendChild(overlay);
    }

    function ensureLobby(): void {
      lobby ??= createLobby({
        myAccount: creds.account,
        onStart: () => net.send({ type: 'start' }),
        onReset: () => net.send({ type: 'reset' }),
      });
      if (!lobby.element.isConnected) root.appendChild(lobby.element);
    }

    function disposeLobby(): void {
      lobby?.dispose();
      lobby = null;
    }

    /** 联机顶栏：我是谁、连接状态；局终时房主可重开 */
    function renderBar(snapshot: RoomSnapshot): void {
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'online-bar';
        root.appendChild(bar);
      }
      bar.replaceChildren();

      const me = snapshot.seats.find((s) => s.account === creds.account);
      const who = document.createElement('span');
      who.textContent = `联机 · ${me?.displayName ?? creds.account}` +
        (me?.seat ? ` · 座位 ${me.seat}` : ' · 旁观') +
        (snapshot.hostAccount === creds.account ? ' · 房主' : '');
      bar.appendChild(who);

      const status = document.createElement('span');
      status.className = connectionOk ? 'online-bar__ok' : 'online-bar__bad';
      status.textContent = connectionOk ? '已连接' : '断线重连中…';
      bar.appendChild(status);

      if (snapshot.hostAccount === creds.account) {
        const wake = document.createElement('button');
        wake.type = 'button';
        wake.className = 'btn btn--sm' + (keepAwake.isOn() ? ' btn--primary' : '');
        wake.textContent = keepAwake.isOn() ? '保持主机唤醒：开' : '保持主机唤醒：关';
        wake.title = keepAwake.supported
          ? '开着本页时阻止主机电脑休眠；切到后台会自动补取锁'
          : '当前浏览器不支持 Wake Lock，请在系统电源设置里关闭睡眠';
        wake.addEventListener('click', () => {
          const turningOn = !keepAwake.isOn();
          void keepAwake.set(turningOn).then((ok) => {
            if (turningOn && !ok && keepAwake.supported) alert('系统拒绝了唤醒锁，请改电源设置为不睡眠。');
            renderBar(snapshot);
          });
        });
        bar.appendChild(wake);

        const rescue = document.createElement('button');
        rescue.type = 'button';
        rescue.className = 'btn btn--sm';
        rescue.textContent = '全员重连救援';
        rescue.title = '断开其他人的所有连接（含幽灵/卡死端），他们的页面会自动重连并接回原座位；不影响你自己的连接';
        rescue.addEventListener('click', () => net.send({ type: 'reconnect-all' }));
        bar.appendChild(rescue);
      }

      if (snapshot.roomPhase !== 'lobby' && snapshot.hostAccount === creds.account) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'btn btn--sm';
        reset.textContent = snapshot.roomPhase === 'over' ? '回到大厅重开' : '放弃本局回大厅';
        reset.addEventListener('click', () => net.send({ type: 'reset' }));
        bar.appendChild(reset);
      }
    }

    function redraw(): void {
      if (!lastSnapshot) {
        if (!connectionOk) notice ??= '正在连接服务器…';
        return;
      }
      if (lobby && lastSnapshot.roomPhase === 'lobby') {
        lobby.render(lastSnapshot, connectionOk, notice);
        notice = null;
      } else if (panel && lastSnapshot.state) {
        panel.render(lastSnapshot.state, notice);
        notice = null;
      }
    }
  }

  showStartScreen();

  // 页面卸载时释放贴图与材质，避免显存泄漏
  window.addEventListener(
    'beforeunload',
    () => {
      accomplices.dispose();
      dice.dispose();
      board.dispose();
      disposeLabelTextures();
      disposeSkins();
      scene.dispose();
    },
    { once: true },
  );
}
