type Listener = (payload: any) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Record<string, Set<Listener>> = {};

  connect(url: string) {
    if (this.ws) this.ws.close();
    this.ws = new WebSocket(url);
    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as any);
        if (msg && msg.type) this.emit(msg.type, msg.payload);
      } catch {
        // ignore
      }
    };
    this.ws.onclose = () => { this.emit('disconnect', null); };
    this.ws.onopen = () => { this.emit('connect', null); };
  }

  send(type: string, payload?: any) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  addListener(type: string, cb: Listener) {
    if (!this.listeners[type]) this.listeners[type] = new Set();
    this.listeners[type].add(cb);
  }

  removeListener(type: string, cb: Listener) {
    this.listeners[type]?.delete(cb);
  }

  private emit(type: string, payload: any) {
    this.listeners[type]?.forEach((cb) => cb(payload));
  }
}

export const ws = new WebSocketService();
export function useWebSocket() { return ws; } // simple helper to keep your imports stable
