/** Replaced at build time: true for --dev/--watch builds. */
declare const DEV: boolean;

// File System Access API parts Chrome has and TypeScript's DOM library doesn't yet (the updater).
interface FileSystemHandle {
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface Window {
  showDirectoryPicker(opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
}
