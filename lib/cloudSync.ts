"use client";

import { AppData, CloudSyncConfig, CloudUser, UserRole, WorkerAttachment } from "./types";
import { DatabaseStorageAdapter, StorageCollectionKey, SupabaseMigrationTables, collectWorkerDocuments } from "./storageService";
import { getSupabaseAppConfig, isSupabaseConfigured } from "./supabase";

export interface CloudSyncPlan {
  mode: CloudSyncConfig["mode"];
  canReadCloud: boolean;
  canWriteCloud: boolean;
  shouldUseSupabaseStorage: boolean;
  reason: string;
}

export interface CloudBackupPayload {
  exportedAt: string;
  user: CloudUser;
  data: AppData;
  tables: SupabaseMigrationTables;
}

export function createDefaultCloudUser(role: UserRole = "ADMIN"): CloudUser {
  return {
    id: "local-admin",
    email: "local-admin@example.local",
    name: "Local Admin",
    role,
    organizationId: "local-org",
    lastLoginAt: ""
  };
}

export function createDefaultCloudSyncConfig(): CloudSyncConfig {
  return {
    mode: "LOCAL_ONLY",
    status: "IDLE",
    lastSyncedAt: "",
    lastError: "",
    storageProvider: "localStorage",
    attachmentProvider: "localStorage"
  };
}

export function getCloudSyncPlan(config: CloudSyncConfig = createDefaultCloudSyncConfig()): CloudSyncPlan {
  const supabaseReady = isSupabaseConfigured();
  const appConfig = getSupabaseAppConfig();
  const mode = supabaseReady ? config.mode : "LOCAL_ONLY";
  const canUseCloud = supabaseReady && mode !== "LOCAL_ONLY";
  return {
    mode,
    canReadCloud: canUseCloud,
    canWriteCloud: canUseCloud && mode === "SUPABASE_ACTIVE",
    shouldUseSupabaseStorage: Boolean(appConfig?.workerDocumentsBucket) && config.attachmentProvider === "supabaseStorage",
    reason: canUseCloud ? "Supabase configuration is available." : "Using localStorage until Supabase URL, anon key, and mode are configured."
  };
}

export function createCloudBackupPayload(data: AppData, tables: SupabaseMigrationTables): CloudBackupPayload {
  return {
    exportedAt: new Date().toISOString(),
    user: data.accessControl.currentUser,
    data,
    tables
  };
}

export function buildWorkerDocumentStoragePath(user: CloudUser, workerId: string, attachment: Pick<WorkerAttachment, "kind" | "fileName" | "uploadedAt">) {
  const uploadedAt = attachment.uploadedAt || new Date().toISOString().slice(0, 10);
  const safeFileName = attachment.fileName.replace(/[\\/:*?"<>|]/g, "_");
  return `${user.organizationId}/workers/${workerId}/${uploadedAt}_${attachment.kind}_${safeFileName}`;
}

export class CloudDataSyncService {
  constructor(private readonly adapter: DatabaseStorageAdapter) {}

  async pullTables() {
    const tables: StorageCollectionKey[] = ["clients", "sites", "workers", "assignments", "settlements", "documents"];
    const entries = await Promise.all(tables.map(async (table) => [table, await this.adapter.loadTable(table)] as const));
    return Object.fromEntries(entries) as Record<StorageCollectionKey, unknown[]>;
  }

  async pushTables(tables: SupabaseMigrationTables) {
    await this.adapter.upsertTable("clients", tables.clients);
    await this.adapter.upsertTable("sites", tables.sites);
    await this.adapter.upsertTable("workers", tables.workers);
    await this.adapter.upsertTable("assignments", tables.assignments);
    await this.adapter.upsertTable("settlements", tables.settlements);
    await this.adapter.upsertTable("documents", tables.documents);
  }

  collectDocuments(data: AppData) {
    return collectWorkerDocuments(data.workers);
  }
}
