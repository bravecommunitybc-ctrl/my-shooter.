type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used to decouple systems (round ↔ ui ↔ audio ↔ ai). */
export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Handler<never>[]>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(handler as Handler<never>);
    return () => {
      const l = this.handlers.get(type);
      if (l) l.splice(l.indexOf(handler as Handler<never>), 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const h of list.slice()) (h as Handler<Events[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
