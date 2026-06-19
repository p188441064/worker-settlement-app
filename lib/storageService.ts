"use client";

import {
  AppData,
  Client,
  ReceivablePayment,
  Site,
  WorkAssignment,
  WorkRequest,
  Worker,
  WorkerAttachment
} from "./types";

export type AppDataMigrator = (data: Partial<AppData>) => AppData;
export type StorageCollectionKey = "workers" | "clients" | "sites" | "assignments" | "settlements" | "documents";

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

export interface AppDataSnapshot {
  schemaVersion: number;
  workers: Worker[];
  clients: Client[];
  sites: Site[];
  workRequests: WorkRequest[];
  assignments: WorkAssignment[];
  settlements: ReceivablePayment[];
  documents: WorkerAttachment[];
}

export interface SupabaseMigrationTables {
  workers: Worker[];
  clients: Client[];
  sites: Site[];
  assignments: WorkAssignment[];
  settlements: ReceivablePayment[];
  documents: WorkerAttachment[];
}

export interface DatabaseStorageAdapter {
  loadTable<T>(table: StorageCollectionKey): Promise<T[]>;
  upsertTable<T>(table: StorageCollectionKey, rows: T[]): Promise<void>;
  deleteFromTable(table: StorageCollectionKey, ids: string[]): Promise<void>;
}

export interface AppStorageService {
  loadAppData(options: LoadAppDataOptions): AppData;
  saveAppData(data: AppData): void;
  exportAppData(data: AppData): string;
  importAppData(raw: string, migrate: AppDataMigrator): AppData;
  resetAppData(fallbackData: AppData): AppData;
  clearAppData(): void;
  toSnapshot(data: AppData): AppDataSnapshot;
  toSupabaseTables(data: AppData): SupabaseMigrationTables;
  saveWorkers(data: AppData, workers: Worker[]): AppData;
  saveClients(data: AppData, clients: Client[]): AppData;
  saveSites(data: AppData, sites: Site[]): AppData;
  saveRequests(data: AppData, workRequests: WorkRequest[]): AppData;
  saveAssignments(data: AppData, assignments: WorkAssignment[]): AppData;
  saveSettlements(data: AppData, settlements: ReceivablePayment[]): AppData;
  saveSettlementData(data: AppData, assignments: WorkAssignment[]): AppData;
  saveWorkerAttachments(data: AppData, workerId: string, attachments: WorkerAttachment[]): AppData;
  saveDocuments(data: AppData, documents: WorkerAttachment[]): AppData;
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

export class SupabaseAppStorageService implements DatabaseStorageAdapter {
  async loadTable<T>(_table: StorageCollectionKey): Promise<T[]> {
    throw new Error("Supabase DB adapter is not connected yet. Use LocalAppStorageService until env/auth setup is finalized.");
  }

  async upsertTable<T>(_table: StorageCollectionKey, _rows: T[]): Promise<void> {
    throw new Error("Supabase DB adapter is not connected yet. Use LocalAppStorageService until env/auth setup is finalized.");
  }

  async deleteFromTable(_table: StorageCollectionKey, _ids: string[]): Promise<void> {
    throw new Error("Supabase DB adapter is not connected yet. Use LocalAppStorageService until env/auth setup is finalized.");
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
    this.adapter.saveRaw(this.exportAppData(data));
  }

  exportAppData(data: AppData) {
    return JSON.stringify({ ...data, schemaVersion: this.schemaVersion });
  }

  importAppData(raw: string, migrate: AppDataMigrator) {
    const migrated = migrate(JSON.parse(raw) as Partial<AppData>);
    this.saveAppData(migrated);
    return migrated;
  }

  resetAppData(fallbackData: AppData) {
    this.saveAppData(fallbackData);
    return fallbackData;
  }

  clearAppData() {
    this.adapter.removeRaw();
  }

  toSnapshot(data: AppData): AppDataSnapshot {
    return {
      schemaVersion: this.schemaVersion,
      workers: data.workers,
      clients: data.clients,
      sites: data.sites,
      workRequests: data.workRequests,
      assignments: data.assignments,
      settlements: data.receivablePayments,
      documents: collectWorkerDocuments(data.workers)
    };
  }

  toSupabaseTables(data: AppData): SupabaseMigrationTables {
    const snapshot = this.toSnapshot(data);
    return {
      workers: snapshot.workers,
      clients: snapshot.clients,
      sites: snapshot.sites,
      assignments: snapshot.assignments,
      settlements: snapshot.settlements,
      documents: snapshot.documents
    };
  }

  saveWorkers(data: AppData, workers: Worker[]) {
    return this.saveAndReturn({ ...data, workers });
  }

  saveClients(data: AppData, clients: Client[]) {
    return this.saveAndReturn({ ...data, clients });
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

  saveSettlements(data: AppData, settlements: ReceivablePayment[]) {
    return this.saveAndReturn({ ...data, receivablePayments: settlements });
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

  saveDocuments(data: AppData, documents: WorkerAttachment[]) {
    const documentsByWorker = documents.reduce<Record<string, WorkerAttachment[]>>((map, document) => {
      map[document.workerId] = [...(map[document.workerId] || []), document];
      return map;
    }, {});

    return this.saveWorkers(
      data,
      data.workers.map((worker) => ({ ...worker, attachments: documentsByWorker[worker.id] || worker.attachments || [] }))
    );
  }

  private saveAndReturn(data: AppData) {
    this.saveAppData(data);
    return data;
  }
}

export function collectWorkerDocuments(workers: Worker[]) {
  return workers.flatMap((worker) => (worker.attachments || []).map((attachment) => ({ ...attachment, workerId: attachment.workerId || worker.id })));
}

export function createLocalStorageService(storageKey: string, schemaVersion: number) {
  return new LocalAppStorageService(new LocalStorageAdapter(storageKey), schemaVersion);
}
