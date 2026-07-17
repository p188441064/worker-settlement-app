"use client";

import { migrateAppData } from "./storage";
import type { AppData } from "./types";
import {
  APP_DATA_BUCKET,
  getSupabaseAppConfig,
  getSupabaseAuthHeaders,
  getSupabaseEnvironmentDiagnostics,
  getSupabaseStorageConfig,
  uploadSupabaseStorageObject,
  downloadSupabaseStorageObject
} from "./supabase";
import type { SupabaseEnvironmentDiagnostics, SupabaseStorageConfig } from "./supabase";
import { getCurrentSupabaseAccessToken } from "./supabase-auth";

export const SUPABASE_CONFLICT_MESSAGE = "다른 기기에서 더 최신 데이터가 저장되었습니다.\n클라우드 데이터를 먼저 불러온 후 다시 시도하세요.";

export interface SupabaseConnectionResult {
  configured: boolean;
  ok: boolean;
  storageApiReachable: boolean;
  bucketCheckMessage: string;
  message: string;
  checkedAt: string;
  environment: SupabaseEnvironmentDiagnostics;
  checks: SupabaseConnectionCheck[];
}

export interface SupabaseConnectionCheck {
  kind: "Project" | "Storage";
  ok: boolean;
  status: number | null;
  requestTarget: string;
  message: string;
  error: string;
  errorCode: string;
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
  const blob = await downloadSupabaseStorageObject(path, config, getCurrentSupabaseAccessToken());
  if (!blob) return undefined;
  return {
    path,
    ...parsePayload(await blob.text())
  };
}

function assertRevisionMatches(localRevision: number, cloudRevision: number) {
  if (localRevision !== cloudRevision) throw new SupabaseRevisionConflictError(localRevision, cloudRevision);
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function parseSupabaseResponse(response: Response) {
  const fallbackMessage = response.ok ? "요청이 성공했습니다." : `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return { message: fallbackMessage, error: "", errorCode: "" };
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      message: stringFromUnknown(parsed.message) || stringFromUnknown(parsed.msg) || fallbackMessage,
      error: stringFromUnknown(parsed.error),
      errorCode: stringFromUnknown(parsed.error_code) || stringFromUnknown(parsed.code)
    };
  } catch {
    return { message: fallbackMessage, error: "", errorCode: "" };
  }
}

async function checkSupabaseEndpoint(kind: SupabaseConnectionCheck["kind"], requestTarget: string, url: string, headers: Record<string, string>): Promise<SupabaseConnectionCheck> {
  try {
    const response = await fetch(url, { headers, cache: "no-store" });
    const details = await parseSupabaseResponse(response);
    return {
      kind,
      ok: response.ok,
      status: response.status,
      requestTarget,
      ...details
    };
  } catch (error) {
    return {
      kind,
      ok: false,
      status: null,
      requestTarget,
      message: error instanceof Error ? error.message : "요청 중 오류가 발생했습니다.",
      error: "",
      errorCode: ""
    };
  }
}

function markHttpResponseAsStorageReachable(check: SupabaseConnectionCheck): SupabaseConnectionCheck {
  if (check.status === null) return check;
  const maybeBucketHiddenByPolicy = `${check.message} ${check.error} ${check.errorCode}`.toLowerCase().includes("bucket not found");
  return {
    ...check,
    ok: true,
    message: maybeBucketHiddenByPolicy
      ? "Storage API가 응답했습니다. 버킷 존재 여부는 권한 설정 전이라 판단하지 않습니다."
      : check.message || "Storage API가 응답했습니다.",
    error: maybeBucketHiddenByPolicy ? "" : check.error
  };
}

function checkSupabaseProjectSettings(environment: SupabaseEnvironmentDiagnostics): SupabaseConnectionCheck {
  const ok = environment.urlConfigured && environment.keyConfigured && Boolean(environment.projectRef);
  return {
    kind: "Project",
    ok,
    status: null,
    requestTarget: "Supabase project URL and publishable key",
    message: ok ? "프로젝트 URL과 API 키 설정을 확인했습니다." : "Supabase URL 또는 API 키 설정을 확인해야 합니다.",
    error: "",
    errorCode: ""
  };
}

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  const checkedAt = new Date().toISOString();
  const environment = getSupabaseEnvironmentDiagnostics();
  const projectCheck = checkSupabaseProjectSettings(environment);
  const config = getSupabaseStorageConfig();
  const headers = getSupabaseAuthHeaders(config, getCurrentSupabaseAccessToken());
  if (!config || !headers) {
    return {
      configured: false,
      ok: false,
      storageApiReachable: false,
      bucketCheckMessage: "로그인과 Storage 정책 설정 전이라 버킷 존재 여부는 확인하지 않습니다.",
      checkedAt,
      message: "Supabase URL 또는 publishable key가 설정되지 않았습니다.",
      environment,
      checks: [projectCheck]
    };
  }

  const rawStorageCheck = await checkSupabaseEndpoint(
    "Storage",
    "Storage /storage/v1/object/{bucket}/connection-test/test.json",
    `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/connection-test/test.json`,
    headers
  );
  const storageCheck = markHttpResponseAsStorageReachable(rawStorageCheck);
  const storageApiReachable = storageCheck.status !== null;
  const checks = [projectCheck, storageCheck];

  return {
    configured: true,
    ok: projectCheck.ok && storageApiReachable,
    storageApiReachable,
    bucketCheckMessage: "로그인과 Storage 정책 설정 전이라 버킷 존재 여부는 확인하지 않습니다.",
    checkedAt,
    message: storageApiReachable
      ? "Supabase 프로젝트 설정과 Storage API 응답을 확인했습니다."
      : "Storage API 응답을 확인하지 못했습니다.",
    environment,
    checks
  };
}

function isStoragePolicyFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("403") ||
    message.includes("row-level security") ||
    message.includes("rls") ||
    message.includes("policy") ||
    message.includes("not authorized") ||
    message.includes("unauthorized")
  );
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
  try {
    const accessToken = getCurrentSupabaseAccessToken();
    await uploadSupabaseStorageObject(testPath, new Blob([JSON.stringify(payload)], { type: "application/json" }), config, accessToken);
    const restored = await downloadSupabaseStorageObject(testPath, config, accessToken);
    if (!restored) throw new Error("Supabase 테스트 파일을 다시 읽지 못했습니다.");
    const parsed = JSON.parse(await restored.text()) as Partial<typeof payload>;
    if (parsed.checkedAt !== checkedAt) throw new Error("Supabase 테스트 파일 내용이 일치하지 않습니다.");
  } catch (error) {
    if (isStoragePolicyFailure(error)) throw new Error("Storage 접근 정책이 아직 설정되지 않았습니다.");
    throw error;
  }
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
    await uploadSupabaseStorageObject(snapshotPath, new Blob([current.raw], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
  }

  const payload = createPayload(data, nextRevision, savedAt);
  const path = getSupabaseAppDataPath();
  await uploadSupabaseStorageObject(path, new Blob([JSON.stringify(payload)], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
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
