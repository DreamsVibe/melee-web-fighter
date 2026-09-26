// GameCube adapter link. Chrome cannot read the adapter itself: its interface is HID class, which
// WebUSB never lets a page or extension claim. The native helper in helper/ reads it through WinUSB
// (the Zadig driver Slippi and Dolphin use); the service worker runs it with native messaging and
// passes its messages to every subscriber (pages with Fox on them, the settings page) over a
// runtime port named ADAPTER_PORT.

export const ADAPTER_PORT = 'mwf-adapter';
export const NATIVE_HOST = 'com.melee_web_fighter.adapter';

/**
 * Helper states (`starting`, `no-helper`, `helper-forbidden`, `helper-exited` come from the service
 * worker; the rest from the helper).
 */
export type AdapterState =
  | 'starting' | 'no-helper' | 'helper-forbidden' | 'helper-exited'
  | 'waiting' | 'connected' | 'silent' | 'not-found' | 'no-driver' | 'busy' | 'open-failed' | 'disconnected';

export type AdapterMessage =
  | { type: 'status'; s: AdapterState; d: string }
  /** One 37-byte adapter report; `t` is Date.now() when the service worker passed it on. */
  | { type: 'report'; r: number[]; t: number };

/** Short explanation of a state for people, with what to do about it. */
export function describeAdapter(s: AdapterState, detail: string): string {
  switch (s) {
    case 'connected': return 'Adapter connected.';
    case 'waiting': return 'Adapter opened, waiting for it to answer…';
    case 'silent': return 'The adapter is not answering. Unplug it (both cables) and plug it back in.';
    case 'starting': return 'Starting the adapter helper…';
    case 'no-helper': return 'The adapter helper is not installed. Run helper\\install.ps1 (see below).';
    case 'helper-forbidden': return 'The adapter helper is installed for a different extension id. Run helper\\install.ps1 again.';
    case 'helper-exited': return `The adapter helper stopped${detail ? `: ${detail}` : '.'}`;
    case 'not-found': return 'No GameCube adapter plugged in.';
    case 'no-driver': return 'The adapter is plugged in but has no WinUSB driver: set it up with Zadig.';
    case 'busy': return 'Another program has the adapter open (Dolphin, Slippi, melee-unlocked or Steam). Close it.';
    default: return detail || s;
  }
}
