/**
 * 主机保持唤醒：用浏览器 Wake Lock 阻止主机机器在联机期间休眠。
 *
 * 页面被切到后台时锁会被系统释放，回到前台自动重取；
 * 这只保证"页面开着 = 机器不睡"，硬性不睡眠仍需系统电源计划配合。
 */
export interface KeepAwakeHandle {
  readonly supported: boolean;
  /** true=开启保持唤醒；返回是否真正拿到了锁 */
  set(enabled: boolean): Promise<boolean>;
  readonly isOn: () => boolean;
}

export function createKeepAwake(): KeepAwakeHandle {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let enabled = false;
  let sentinel: WakeLockSentinel | null = null;

  async function acquire(): Promise<boolean> {
    if (!supported || !enabled || sentinel) return Boolean(sentinel);
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
        // 系统主动释放（切后台/息屏恢复）时，只要开关还开着就补取
        if (enabled && document.visibilityState === 'visible') void acquire();
      });
      return true;
    } catch {
      return false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && enabled && !sentinel) void acquire();
  });

  return {
    supported,
    isOn: () => Boolean(sentinel),
    async set(on: boolean) {
      enabled = on;
      if (!on) {
        await sentinel?.release().catch(() => undefined);
        sentinel = null;
        return false;
      }
      return acquire();
    },
  };
}
