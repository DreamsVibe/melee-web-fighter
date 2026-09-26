// Message names shared by the extension's parts. Plain strings so they survive structured clone.
export const MSG = {
  toggle: 'mwf:toggle',
  /** content → bridge: hello over the private MessageChannel. */
  hello: 'mwf:hello',
  /** bridge → content: one file of the character folder (path + bytes). */
  file: 'mwf:file',
  /** bridge → content: the whole folder has been sent. */
  folderDone: 'mwf:folder-done',
  /** bridge → content: an override or setting changed; reload these paths. */
  changed: 'mwf:changed',
  /** bridge → content: a raw 37-byte GameCube adapter report. */
  adapter: 'mwf:adapter',
  /** bridge → content: adapter status text for the debug display. */
  adapterStatus: 'mwf:adapter-status',
  settings: 'mwf:settings',
} as const;
