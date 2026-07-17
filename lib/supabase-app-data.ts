"use client";

import { migrateAppData } from "./storage";
import type { AppData } from "./types";
import {
  APP_DATA_BUCKET,
  getSupabaseAppConfig,
  getSupabaseAuthHeaders,
  getSupabaseStorageConfig,
  uploadSupabaseStorageObject,
  downloadSupabaseStorageObject
} from "./supabase";
import type { SupabaseStorageConfig } from "./supabase";

export const SUPABASE_CONFLICT_MESSAGE = "다른 기기에서 더 최신 데이터가 저장되었습니다.\n클라우드 데이터를 먼저 불러온 후 다시 시도하세요.";

export interface SupabaseConnectionResult {
  configured: boolean;
  ok: boolean;
  message: string;
  checkedAt: string;
}

export interface SupabaseSnapshotInfo {
  configured: boolean;
  snapshotFound: boolean;
  revision: number;
  exportedAt: string;
  appDataPath: string;
  checkedAt: string;
  message: string;
}

export interface SupabaseReadResult extends SupabaseSnapshotInfo {
  data: AppData;
}

export interface SupabaseSaveVerification {
  ok: boolean;
  savedAt: string;
  appDataPath: string;
  snapshotPath?: string;
  revision: number;
  counts: {
    workers: number;
    clients: number;
    sites: number;
    workRequests: number;
    assignments: number;
    receivablePayments: number;
  };
}

export interface SupabaseTestResult {
  ok: boolean;
  checkedAt: string;
  testPath: string;
  message: string;
}

interface SupabaseAppDataPayload {
  source: "worker-settlement-app";
  exportedAt: string;
  schemaVersion: number;
  revision: number;
  data: AppData;
}

export class SupabaseRevisionConflictError extends Error {
  constructor(
    readonly localRevision: number,
    readonly cloudRevision: number
  ) {
    super(SUPABASE_CONFLICT_MESSAGE);
    this.name = "SupabaseRevisionConflictError";
  }
}

export function isSupabaseRevisionConflict(error: unknown): error is SupabaseRevisionConflictError {
  return error instanceof SupabaseRevisionConflictError;
}

function getAppDataConfig(): SupabaseStorageConfig | undefined {
  const config = getSupabaseStorageConfig();
  if (!config) return undefined;
  return {
    ...config,
    bucket: APP_DATA_BUCKET
  };
}

function getOrganizationId() {
  return getSupabaseAppConfig()?.organizationId || "local-org";
}

export function getSupabaseAppDataPath() {
  return `${getOrganizationId()}/app-data/current.json`;
}

function getSupabaseSnapshotPath(revision: number, exportedAt: string) {
  const timestamp = exportedAt.replace(/[:.]/g, "-");
  return `${getOrganizationId()}/app-data/snapshots/${timestamp}-revision-${revision}.json`;
}

function getConnectionTestPath() {
  return `${getOrganizationId()}/connection-test/test.json`;
}

function countData(data: AppData) {
  return {
    workers: data.workers.length,
    clients: data.clients.length,
    sites: data.sites.length,
    workRequests: data.workRequests.length,
    assignments: data.assignments.length,
    receivablePayments: data.receivablePayments.length
  };
}

function ensureSameCounts(source: AppData, restored: AppData) {
  const sourceCounts = countData(source);
  const restoredCounts = countData(restored);
  return Object.keys(sourceCounts).every((key) => sourceCounts[key as keyof typeof sourceCounts] === restoredCounts[key as keyof typeof restoredCounts]);
}

function withCloudRevision(data: AppData, revision: number, syncedAt: string): AppData {
  return {
    ...data,
    cloudSync: {
      ...data.cloudSync,
      mode: "SUPABASE_ACTIVE",
      status: "SUCCESS",
      storageProvider: "supabase",
      attachmentProvider: "supabaseStorage",
      localRevision: revision,
      cloudRevision: revision,
      lastSyncedAt: syncedAt,
      lastCloudCheckedAt: syncedAt,
      conflict: false,
      conflictMessage: "",
      lastError: ""
    }
  };
}

function createPayload(data: AppData, revision: number, exportedAt: string): SupabaseAppDataPayload {
  return {
    source: "worker-settlement-app",
    exportedAt,
    schemaVersion: data.schemaVersion,
    revision,
    data: withCloudRevision(data, revision, exportedAt)
  };
}

function parsePayload(raw: string) {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const wrappedData = parsed.data && typeof parsed.data === "object" ? (parsed.data as Partial<AppData>) : undefined;
  const data = migrateAppData(wrappedData || (parsed as Partial<AppData>));
  const revision = wrappedData && typeof parsed.revision === "number" ? parsed.revision : data.cloudSync.localRevision || 0;
  const exportedAt = wrappedData && typeof parsed.exportedAt === "string" ? parsed.exportedAt : data.cloudSync.lastSyncedAt || "";
  return {
    payload: {
      source: "worker-settlement-app" as const,
      exportedAt,
      schemaVersion: data.schemaVersion,
      revision,
      data: withCloudRevision(data, revision, exportedAt)
    },
    raw
  };
}

async function readCurrentPayload() {
  const config = getAppDataConfig();
  if (!config) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
  const path = getSupabaseAppDataPath();
  const blob = await downloadSupabaseStorageObject(path, config);
  if (!blob) return undefined;
  return {
    path,
    ...parsePayload(await blob.text())
  };
}

function assertRevisionMatches(localRevision: number, cloudRevision: number) {
  if (localRevision !== cloudRevision) throw new SupabaseRevisionConflictError(localRevision, cloudRevision);
}

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  const checkedAt = new Date().toISOString();
  const config = getSupabaseStorageConfig();
  const headers = getSupabaseAuthHeaders(config);
  if (!config || !headers) {
    return {
      configured: false,
      ok: false,
      checkedAt,
      message: "Supabase URL 또는 publishable key가 설정되지 않았습니다."
    };
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/`, { headers });
    if (!response.ok) {
      return {
        configured: true,
        ok: false,
        checkedAt,
        message: `Supabase 응답 오류: ${response.status}`
      };
    }

    return {
      configured: true,
      ok: true,
      checkedAt,
      message: "Supabase 연결이 확인되었습니다."
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      checkedAt,
      message: error instanceof Error ? error.message : "Supabase 연결 확인 중 오류가 발생했습니다."
    };
  }
}

export async function getSupabaseSnapshotInfo(): Promise<SupabaseSnapshotInfo> {
  const checkedAt = new Date().toISOString();
  const appDataPath = getSupabaseAppDataPath();
  if (!getAppDataConfig()) {
    return {
      configured: false,
      snapshotFound: false,
      revision: 0,
      exportedAt: "",
      appDataPath,
      checkedAt,
      message: "Supabase URL 또는 publishable key가 설정되지 않았습니다."
    };
  }

  const current = await readCurrentPayload();
  if (!current) {
    return {
      configured: true,
      snapshotFound: false,
      revision: 0,
      exportedAt: "",
      appDataPath,
      checkedAt,
      message: "아직 저장된 클라우드 데이터가 없습니다."
    };
  }

  return {
    configured: true,
    snapshotFound: true,
    revision: current.payload.revision,
    exportedAt: current.payload.exportedAt,
    appDataPath,
    checkedAt,
    message: "클라우드 데이터 revision을 확인했습니다."
  };
}

export async function testSupabaseStorageConnection(): Promise<SupabaseTestResult> {
  const config = getAppDataConfig();
  if (!config) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
  const checkedAt = new Date().toISOString();
  const testPath = getConnectionTestPath();
  const payload = {
    source: "worker-settlement-app",
    type: "connection-test",
    checkedAt
  };
  await uploadSupabaseStorageObject(testPath, new Blob([JSON.stringify(payload)], { type: "application/json" }), config);
  const restored = await downloadSupabaseStorageObject(testPath, config);
  if (!restored) throw new Error("Supabase 테스트 파일을 다시 읽지 못했습니다.");
  const parsed = JSON.parse(await restored.text()) as Partial<typeof payload>;
  if (parsed.checkedAt !== checkedAt) throw new Error("Supabase 테스트 파일 내용이 일치하지 않습니다.");
  return {
    ok: true,
    checkedAt,
    testPath,
    message: "Supabase 테스트 파일 저장과 읽기 확인이 완료되었습니다."
  };
}

export async function loadAppDataFromSupabase(): Promise<SupabaseReadResult | undefined> {
  const current = await readCurrentPayload();
  if (!current) return undefined;
  const checkedAt = new Date().toISOString();
  return {
    configured: true,
    snapshotFound: true,
    revision: current.payload.revision,
    exportedAt: current.payload.exportedAt,
    appDataPath: current.path,
    checkedAt,
    message: "클라우드 최신 데이터를 불러왔습니다.",
    data: withCloudRevision(current.payload.data, current.payload.revision, current.payload.exportedAt || checkedAt)
  };
}

export async function saveAppDataToSupabase(data: AppData) {
  const config = getAppDataConfig();
  if (!config) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");

  const current = await readCurrentPayload();
  const cloudRevision = current?.payload.revision ?? 0;
  const localRevision = data.cloudSync.localRevision || 0;
  assertRevisionMatches(localRevision, cloudRevision);

  const savedAt = new Date().toISOString();
  const nextRevision = cloudRevision + 1;
  let snapshotPath: string | undefined;
  if (current) {
    snapshotPath = getSupabaseSnapshotPath(cloudRevision, current.payload.exportedAt || savedAt);
    await uploadSupabaseStorageObject(snapshotPath, new Blob([current.raw], { type: "application/json" }), config);
  }

  const payload = createPayload(data, nextRevision, savedAt);
  const path = getSupabaseAppDataPath();
  await uploadSupabaseStorageObject(path, new Blob([JSON.stringify(payload)], { type: "application/json" }), config);
  return {
    path,
    snapshotPath,
    savedAt,
    revision: nextRevision,
    data: payload.data
  };
}

export async function saveAndVerifyAppDataToSupabase(data: AppData): Promise<SupabaseSaveVerification> {
  const saved = await saveAppDataToSupabase(data);
  const restored = await loadAppDataFromSupabase();
  if (!restored) throw new Error("Supabase에 저장한 데이터를 다시 읽지 못했습니다.");
  if (restored.revision !== saved.revision) throw new Error("Supabase 저장 후 읽은 revision이 일치하지 않습니다.");
  if (!ensureSameCounts(saved.data, restored.data)) throw new Error("Supabase 저장 후 읽은 데이터 건수가 현재 데이터와 다릅니다.");
  return {
    ok: true,
    savedAt: saved.savedAt,
    appDataPath: saved.path,
    snapshotPath: saved.snapshotPath,
    revision: saved.revision,
    counts: countData(restored.data)
  };
}
