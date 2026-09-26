// Official GameCube controller adapter (WUP-028) over WebUSB. Same protocol as Dolphin/Slippi and
// melee-unlocked's port/runtime/host/gc_adapter.cpp: write 0x13 to start, read 37-byte reports.
// Needs the WinUSB driver on Windows (Zadig) and a one-time pairing from the settings page.

export const ADAPTER_FILTER: USBDeviceFilter = { vendorId: 0x057e, productId: 0x0337 };

export type AdapterStatus =
  | 'unsupported'      // WebUSB is not available in this context
  | 'not-paired'       // no permission yet: pair it from the settings page
  | 'open-failed'      // found but could not be opened: driver missing or another program has it
  | 'connected'
  | 'disconnected';

export class AdapterReader {
  private device: USBDevice | null = null;
  private running = false;

  constructor(private onReport: (r: Uint8Array) => void, private onStatus: (s: AdapterStatus, detail?: string) => void) {}

  async start(): Promise<void> {
    if (!('usb' in navigator)) { this.onStatus('unsupported'); return; }
    navigator.usb.addEventListener('connect', (e) => { if (!this.device) void this.open((e as USBConnectionEvent).device); });
    navigator.usb.addEventListener('disconnect', (e) => {
      if ((e as USBConnectionEvent).device === this.device) { this.running = false; this.device = null; this.onStatus('disconnected'); }
    });
    try {
      const devices = await navigator.usb.getDevices();
      const found = devices.find((d) => d.vendorId === ADAPTER_FILTER.vendorId && d.productId === ADAPTER_FILTER.productId);
      if (!found) { this.onStatus('not-paired'); return; }
      await this.open(found);
    } catch (err) {
      this.onStatus('unsupported', String(err));
    }
  }

  private async open(device: USBDevice): Promise<void> {
    if (device.vendorId !== ADAPTER_FILTER.vendorId || device.productId !== ADAPTER_FILTER.productId) return;
    try {
      await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      // Find the interface with an interrupt IN/OUT pair (third-party adapters differ, see gc_adapter.cpp).
      let iface = 0, epIn = 1, epOut = 2;
      for (const i of device.configuration!.interfaces) {
        for (const alt of i.alternates) {
          const inn = alt.endpoints.find((e) => e.type === 'interrupt' && e.direction === 'in');
          const out = alt.endpoints.find((e) => e.type === 'interrupt' && e.direction === 'out');
          if (inn && out) { iface = i.interfaceNumber; epIn = inn.endpointNumber; epOut = out.endpointNumber; }
        }
      }
      await device.claimInterface(iface);
      await device.transferOut(epOut, new Uint8Array([0x13]));
      this.device = device;
      this.running = true;
      this.onStatus('connected');
      void this.loop(device, epIn, epOut);
    } catch (err) {
      this.onStatus('open-failed', String((err as Error).message ?? err));
    }
  }

  private async loop(device: USBDevice, epIn: number, epOut: number): Promise<void> {
    let silent = 0;
    while (this.running && this.device === device) {
      try {
        const r = await device.transferIn(epIn, 37);
        if (r.data && r.data.byteLength === 37 && r.data.getUint8(0) === 0x21) {
          silent = 0;
          this.onReport(new Uint8Array(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + 37)));
        } else if (++silent > 100) {
          silent = 0;
          await device.transferOut(epOut, new Uint8Array([0x13]));
        }
      } catch (err) {
        if (!this.running) return;
        this.running = false;
        this.device = null;
        this.onStatus('disconnected', String((err as Error).message ?? err));
        return;
      }
    }
  }

  stop(): void {
    this.running = false;
    void this.device?.close().catch(() => {});
    this.device = null;
  }
}
