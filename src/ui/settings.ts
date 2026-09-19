/**
 * 设置面板：底部「设置」按钮 + 全屏弹层（与规则说明书同款式、同入口排）。
 *
 * 提供常见游戏设置的三件事：
 * - 退回主界面（热座需确认，联机则断开本端连接）
 * - 动画演出开关（骰子抛掷 + 船只补间；关掉后状态即时到位）
 * - 调试信息开关（左上角帧率 / draw call 面板）
 * 选项存 localStorage，刷新后保留。
 */
export interface SettingsValues {
  animations: boolean;
  hud: boolean;
}

export interface SettingsOptions {
  initial: SettingsValues;
  onChange(values: SettingsValues): void;
  onReturnHome(): void;
}

export interface SettingsHandle {
  readonly element: HTMLElement;
  dispose(): void;
}

const STORAGE_KEY = 'manila.settings';

export function loadSettings(fallback: SettingsValues): SettingsValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsValues>;
    return {
      animations: parsed.animations ?? fallback.animations,
      hud: parsed.hud ?? fallback.hud,
    };
  } catch {
    return fallback;
  }
}

function save(values: SettingsValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* 隐私模式下存不了也不影响玩 */
  }
}

export function createSettings(options: SettingsOptions): SettingsHandle {
  const element = document.createElement('div');
  element.className = 'settings';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn settings__fab';
  button.textContent = '设 置';

  const overlay = document.createElement('div');
  overlay.className = 'settings__overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="settings__card">
      <h2 class="settings__title">设置</h2>
      <label class="settings__row">
        <span>动画演出<small>骰子抛掷与船只进港/进厂动画</small></span>
        <input type="checkbox" data-role="animations" />
      </label>
      <label class="settings__row">
        <span>调试信息<small>左上角帧率 / draw call 面板</small></span>
        <input type="checkbox" data-role="hud" />
      </label>
      <div class="settings__actions">
        <button type="button" class="btn settings__home">退回主界面</button>
        <button type="button" class="btn btn--primary settings__close">关 闭</button>
      </div>
    </div>
  `;

  const animBox = overlay.querySelector<HTMLInputElement>('[data-role="animations"]');
  const hudBox = overlay.querySelector<HTMLInputElement>('[data-role="hud"]');
  if (!animBox || !hudBox) throw new Error('设置面板缺少节点');

  const values: SettingsValues = { ...options.initial };
  animBox.checked = values.animations;
  hudBox.checked = values.hud;

  function emit(): void {
    save(values);
    options.onChange({ ...values });
  }

  animBox.addEventListener('change', () => {
    values.animations = animBox.checked;
    emit();
  });
  hudBox.addEventListener('change', () => {
    values.hud = hudBox.checked;
    emit();
  });

  overlay.querySelector('.settings__home')?.addEventListener('click', () => {
    if (confirm('退回主界面？当前对局将结束（热座进度不会保留）。')) {
      overlay.hidden = true;
      options.onReturnHome();
    }
  });
  overlay.querySelector('.settings__close')?.addEventListener('click', () => {
    overlay.hidden = true;
  });

  button.addEventListener('click', () => {
    overlay.hidden = false;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  element.append(button, overlay);

  return {
    element,
    dispose() {
      element.remove();
    },
  };
}
