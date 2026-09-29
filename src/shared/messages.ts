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
  settings: 'mwf:settings',
  /** worker → stage page: the stage-select shortcut was pressed while it's the active tab. */
  stageMenu: 'mwf:stage-menu',
} as const;
