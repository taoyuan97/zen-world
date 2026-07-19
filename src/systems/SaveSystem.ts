import type { HillSave, SaveData } from '../data/types';

const STORAGE_KEY = 'zen-world-save-v1';
const BACKUP_KEY = 'zen-world-save-v1.bak';
const WRITE_DEBOUNCE_MS = 300;

/** localStorage 存档：防抖写入 + 损坏备份重置（TDD §6.1）。 */
export class SaveSystem {
  private _data: SaveData;
  private writeTimer: number | null = null;

  constructor(private readonly hillIds: string[]) {
    this._data = this.load();
  }

  get data(): SaveData {
    return this._data;
  }

  private createDefault(): SaveData {
    const hills: Record<string, HillSave> = {};
    for (const id of this.hillIds) {
      hills[id] = { lit: false, sessions: 0, totalSeconds: 0 };
    }
    return {
      version: 1,
      hills,
      stats: { totalSessions: 0, totalSeconds: 0 },
      settings: { muted: false, onboardingSeen: false },
    };
  }

  load(): SaveData {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return this.createDefault();
    }
    if (!raw) return this.createDefault();

    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== 1 || typeof parsed.hills !== 'object' || parsed.hills === null) {
        throw new Error('存档结构不符');
      }
      const data = this.createDefault();
      for (const id of this.hillIds) {
        const h = parsed.hills[id];
        if (h) {
          data.hills[id] = {
            lit: !!h.lit,
            firstLitAt: h.firstLitAt,
            sessions: h.sessions ?? 0,
            totalSeconds: h.totalSeconds ?? 0,
          };
        }
      }
      data.stats = {
        totalSessions: parsed.stats?.totalSessions ?? 0,
        totalSeconds: parsed.stats?.totalSeconds ?? 0,
        finaleSeen: !!parsed.stats?.finaleSeen,
      };
      data.settings = {
        muted: !!parsed.settings?.muted,
        onboardingSeen: !!parsed.settings?.onboardingSeen,
      };
      return data;
    } catch (err) {
      console.error('[SaveSystem] 存档损坏，已备份原值并重置', err);
      try {
        localStorage.setItem(BACKUP_KEY, raw);
      } catch {
        /* 存储不可用时静默 */
      }
      return this.createDefault();
    }
  }

  isLit(hillId: string): boolean {
    return !!this._data.hills[hillId]?.lit;
  }

  litCount(): number {
    return this.hillIds.filter((id) => this.isLit(id)).length;
  }

  /** 冥想完成时调用（M2 接入会话系统；M1 仅调试面板使用）。 */
  markLit(hillId: string, sessionSeconds = 0): void {
    const hill = this._data.hills[hillId];
    if (!hill) return;
    if (!hill.lit) {
      hill.lit = true;
      hill.firstLitAt = new Date().toISOString();
    }
    if (sessionSeconds > 0) this.addSession(hillId, sessionSeconds);
    else this.scheduleWrite();
  }

  addSession(hillId: string, sessionSeconds: number): void {
    const hill = this._data.hills[hillId];
    if (!hill) return;
    hill.sessions += 1;
    hill.totalSeconds += sessionSeconds;
    this._data.stats.totalSessions += 1;
    this._data.stats.totalSeconds += sessionSeconds;
    this.scheduleWrite();
  }

  /** 仅供 ?debug 面板切换点亮状态。 */
  debugSetLit(hillId: string, lit: boolean): void {
    const hill = this._data.hills[hillId];
    if (!hill) return;
    hill.lit = lit;
    if (lit && !hill.firstLitAt) hill.firstLitAt = new Date().toISOString();
    if (!lit) delete hill.firstLitAt;
    this.scheduleWrite();
  }

  setMuted(muted: boolean): void {
    this._data.settings.muted = muted;
    this.scheduleWrite();
  }

  setOnboardingSeen(): void {
    this._data.settings.onboardingSeen = true;
    this.scheduleWrite();
  }

  /** M4：10/10 全局演出只播一次。 */
  setFinaleSeen(): void {
    this._data.stats.finaleSeen = true;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (err) {
      console.error('[SaveSystem] 写入失败', err);
    }
  }
}
