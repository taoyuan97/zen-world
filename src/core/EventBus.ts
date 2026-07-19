import type { EventMap } from '../data/types';

type Handler<T> = (payload: T) => void;
type AnyHandler = Handler<EventMap[keyof EventMap]>;

/** 极小事件总线：跨层通信唯一通道（TDD §4.3）。 */
export class EventBus {
  private handlers = new Map<keyof EventMap, Set<AnyHandler>>();

  on<K extends keyof EventMap>(event: K, fn: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as AnyHandler);
    return () => this.off(event, fn);
  }

  off<K extends keyof EventMap>(event: K, fn: Handler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(fn as AnyHandler);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.handlers.get(event)?.forEach((fn) => {
      try {
        (fn as Handler<EventMap[K]>)(payload);
      } catch (err) {
        // 单个监听者异常不阻断事件链（ISSUE-M2-001 F1）
        console.error(`[EventBus] handler error on "${String(event)}"`, err);
      }
    });
  }
}
