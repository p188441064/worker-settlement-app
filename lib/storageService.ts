"use client";

import { AppData, Site, WorkAssignment, WorkRequest, Worker, WorkerAttachment } from "./types";

export type AppDataMigrator = (data: Partial<AppData>) => AppData;

export interface StorageAdapter {
  loadRaw(): string | null;
  saveRaw(value: string): void;
  removeRaw(): void;
}

export interface LoadAppDataOptions {
  fallbackData: AppData;
  migrate: AppDataMigrator;
  onInitialized?: (data: AppData) => void;
  onCorruptData?: () => void;
}

export interface AppStorageService {
  loadAppData(options: LoadAppDataOptions): AppData;
  saveAppData(data: AppData): void;
  resetAppData(fallbackData: AppData): AppData;
  clearAppData(): void;
  saveWorkers(data: AppData, workers: Worker[]): AppData;
  saveSites(data: AppData, sites: Site[]): AppData;
  saveRequests(data: AppData, workRequests: WorkRequest[]): AppData;
  saveAssignments(data: AppData, assignments: WorkAssignment[]): AppData;
  saveSettlementData(data: AppData, assignments: WorkAssignment[]): AppData;
  saveWorkerAttachments(data: AppData, workerId: string, attachments: WorkerAttachment[]): AppData;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly storageKey: string) {}

  loadRaw() {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(this.storageKey);
  }

  saveRaw(value: string) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(this.storageKey, value);
  }

  removeRaw() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(this.storageKey);
  }
}

export class LocalAppStorageService implements AppStorageService {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly schemaVersion: number
  ) {}

  loadAppData({ fallbackData, migrate, onInitialized, onCorruptData }: LoadAppDataOptions) {
    const stored = this.adapter.loadRaw();
    if (!stored) {
      this.saveAppData(fallbackData);
      onInitialized?.(fallbackData);
      return fallbackData;
    }

    try {
      const migrated = migrate(JSON.parse(stored) as Partial<AppData>);
      this.saveAppData(migrated);
      return migrated;
    } catch {
      this.saveAppData(fallbackData);
      onCorruptData?.();
      return fallbackData;
    }
  }

  saveAppData(data: AppData) {
    this.adapter.saveRaw(JSON.stringify({ ...data, schemaVersion: this.schemaVersion }));
  }

  resetAppData(fallbackData: AppData) {
    this.saveAppData(fallbackData);
    return fallbackData;
  }

  clearAppData() {
    this.adapter.removeRaw();
  }

  saveWorkers(data: AppData, workers: Worker[]) {
    return this.saveAndReturn({ ...data, workers });
  }

  saveSites(data: AppData, sites: Site[]) {
    return this.saveAndReturn({ ...data, sites });
  }

  saveRequests(data: AppData, workRequests: WorkRequest[]) {
    return this.saveAndReturn({ ...data, workRequests });
  }

  saveAssignments(data: AppData, assignments: WorkAssignment[]) {
    return this.saveAndReturn({ ...data, assignments });
  }

  saveSettlementData(data: AppData, assignments: WorkAssignment[]) {
    return this.saveAssignments(data, assignments);
  }

  saveWorkerAttachments(data: AppData, workerId: string, attachments: WorkerAttachment[]) {
    return this.saveWorkers(
      data,
      data.workers.map((worker) => (worker.id === workerId ? { ...worker, attachments } : worker))
    );
  }

  private saveAndReturn(data: AppData) {
    this.saveAppData(data);
    return data;
  }
}

export function createLocalStorageService(storageKey: string, schemaVersion: number) {
  return new LocalAppStorageService(new LocalStorageAdapter(storageKey), schemaVersion);
}
