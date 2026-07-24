import type { ExportFile } from '../export/exporter.js';
import type { SyncKind } from '../domain/types.js';

export interface WrittenFile {
  name: string;
  bytes: number;
  /** Adapter-specific location (path, Drive file id, URL) for the UI to show. */
  location?: string;
}

export interface SyncContext {
  /** Absolute directory that `local` targets are confined to. */
  syncRoot: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  /** Injectable so adapters are testable without touching the network. */
  fetchImpl: typeof fetch;
}

export interface SyncAdapter {
  kind: SyncKind;
  /** Human-readable summary of where this target writes, shown in the UI. */
  describe(config: Record<string, unknown>): string;
  /** Validates and normalizes user-supplied config before it is stored. */
  normalizeConfig(config: Record<string, unknown>): Record<string, unknown>;
  requiredSecrets: string[];
  write(files: ExportFile[], ctx: SyncContext): Promise<WrittenFile[]>;
}
