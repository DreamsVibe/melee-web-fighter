// Content-script side of the bridge iframe: a private MessageChannel to the extension origin.
import { MSG } from '../shared/messages';
import type { FileData } from '../shared/db';

export interface BridgeEvents {
  onChanged?: (paths: string[]) => void;
  onAdapterReport?: (report: Uint8Array) => void;
  onAdapterStatus?: (status: string) => void;
  onSettings?: (settings: Record<string, unknown>) => void;
}

export class BridgeClient {
  readonly files = new Map<string, FileData>();
  private frame: HTMLIFrameElement;
  private port: MessagePort;
  settings: Record<string, unknown> = {};

  constructor(private events: BridgeEvents) {
    const f = document.createElement('iframe');
    f.src = chrome.runtime.getURL('bridge.html');
    f.allow = 'usb';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = ['all:initial', 'position:fixed', 'width:0', 'height:0', 'border:0', 'opacity:0', 'pointer-events:none', 'left:0', 'top:0']
      .map((s) => s + ' !important').join(';');
    this.frame = f;
    const ch = new MessageChannel();
    this.port = ch.port1;
    f.addEventListener('load', () => f.contentWindow?.postMessage({ type: MSG.hello }, new URL(f.src).origin, [ch.port2]), { once: true });
    document.documentElement.appendChild(f);
  }

  /** Resolves once the whole character folder has arrived. */
  load(timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The extension did not answer (the page may block extension frames).')), timeoutMs);
      this.port.onmessageerror = (e) => { console.error('[mwf] bridge message could not be read', e); };
      this.port.onmessage = (e) => {
        const m = e.data;
        switch (m?.type) {
          case MSG.file: for (const f of m.files) this.files.set(f.path, f.data); break;
          case MSG.folderDone: clearTimeout(timer); resolve(); break;
          case MSG.changed:
            for (const p of m.deleted ?? []) this.files.delete(p);
            this.events.onChanged?.(m.paths);
            break;
          case MSG.adapter: this.events.onAdapterReport?.(m.report); break;
          case MSG.adapterStatus: this.events.onAdapterStatus?.(m.status); break;
          case MSG.settings: this.settings = m.settings ?? {}; this.events.onSettings?.(this.settings); break;
        }
      };
      this.port.start();
    });
  }

  destroy(): void {
    this.port.close();
    this.frame.remove();
  }
}
