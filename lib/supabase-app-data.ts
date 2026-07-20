"use client";

import { migrateAppData } from "./storage";
import type { AppData } from "./types";
import {
  APP_DATA_BUCKET,
  getSupabaseAppConfig,
  getSupabaseAuthHeaders,
  getSupabaseEnvironmentDiagnostics,
  getSupabaseStorageConfig,
  buildSupabaseStorageObjectUrl,
  uploadSupabaseStorageObject,
  downloadSupabaseStorageObject,
  listSupabaseStorageObjects
} from "./supabase";
import type { SupabaseEnvironmentDiagnostics, SupabaseStorageConfig, SupabaseStorageObject } from "./supabase";
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
  kind: "Project" | "Google Login" | "Storage";
  method: "GET" | "HEAD" | "POST" | "PUT";
  ok: boolean;
  status: number | null;
  requestTarget: string;
  requestUrl: string;
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

export interface SupabaseSaveResult {
  path: string;
  currentRequestUrl: string;
  snapshotPath?: string;
  snapshotRequestUrl?: string;
  savedAt: string;
  revision: number;
  data: AppData;
}

export interface SupabaseSnapshotListItem {
  name: string;
  path: string;
  revision: number;
  savedAt: string;
  updatedAt: string;
  size: number;
}

export interface SupabaseSnapshotPreview {
  name: string;
  path: string;
  revision: number;
  exportedAt: string;
  savedAt: string;
  size: number;
  counts: {
    workers: number;
    clients: number;
    sites: number;
    workRequests: number;
    assignments: number;
    receivablePayments: number;
  };
  companyName: string;
  raw: string;
}

export interface SupabaseSnapshotRestoreResult extends SupabaseSaveResult {
  backupPath: string;
  backupRequestUrl: string;
  restoredFromSnapshot: string;
  restoredAt: string;
  restoredBy: string;
  previousRevision: number;
}

export type SupabaseSnapshotRestoreStage = "reading" | "backingUp" | "restoring";

export interface SupabaseTestResult {
  ok: boolean;
  checkedAt: string;
  testPath: string;
  requestUrl: string;
  uploadMethod: "POST";
  uploadUpsert: boolean;
  steps: SupabaseStorageTestStep[];
  message: string;
}

export interface SupabaseStorageTestStep {
  order: number;
  method: "GET" | "HEAD" | "POST" | "PUT";
  requestUrl: string;
  status: number | null;
  message: string;
  error: string;
  errorCode: string;
}

interface SupabaseAppDataPayload {
  source: "worker-settlement-app";
  exportedAt: string;
  schemaVersion: number;
  revision: number;
  data: AppData;
  restoredFromSnapshot?: string;
  restoredAt?: string;
  restoredBy?: string;
  previousRevision?: number;
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
  return `${getOrganizationId()}/current.json`;
}

function getSupabaseSnapshotPath(revision: number, exportedAt: string) {
  const timestamp = exportedAt.replace(/[:.]/g, "-");
  return `${getOrganizationId()}/snapshots/${timestamp}-revision-${revision}.json`;
}

function getSupabaseBeforeRestoreSnapshotPath(revision: number, exportedAt: string) {
  const timestamp = exportedAt.replace(/[:.]/g, "-");
  return `${getOrganizationId()}/snapshots/${timestamp}-revision-${revision}-before-restore.json`;
}

function getSupabaseSnapshotPrefix() {
  return `${getOrganizationId()}/snapshots`;
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

function normalizeListedSnapshotPath(prefix: string, object: SupabaseStorageObject) {
  return object.name.startsWith(`${prefix}/`) ? object.name : `${prefix}/${object.name}`;
}

function snapshotFileName(path: string) {
  return path.split("/").pop() || path;
}

function parseSnapshotFileInfo(path: string) {
  const name = snapshotFileName(path);
  const match = name.match(/^(.+)-revision-(\d+)(?:-before-restore)?\.json$/);
  const revision = match ? Number(match[2]) : 0;
  const rawTimestamp = match?.[1] || "";
  const savedAt =
    rawTimestamp.replace(
      /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/,
      (_value, hourPrefix: string, minute: string, second: string, millisecond: string | undefined) =>
        `${hourPrefix}:${minute}:${second}${millisecond ? `.${millisecond}` : ""}Z`
    ) || "";
  return {
    name,
    revision,
    savedAt: Number.isNaN(Date.parse(savedAt)) ? "" : savedAt
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

function isObjectNotFoundDetails(details: { message: string; error: string; errorCode: string }) {
  return `${details.message} ${details.error} ${details.errorCode}`.toLowerCase().includes("object not found");
}

function isStoragePolicyFailureMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("object not found")) return false;
  return (
    normalized.includes("403") ||
    normalized.includes("row-level security") ||
    normalized.includes("rls") ||
    normalized.includes("policy") ||
    normalized.includes("not authorized") ||
    normalized.includes("unauthorized")
  );
}

function checkSupabaseProjectSettings(environment: SupabaseEnvironmentDiagnostics): SupabaseConnectionCheck {
  const ok = environment.urlConfigured && environment.keyConfigured && Boolean(environment.projectRef);
  return {
    kind: "Project",
    method: "GET",
    ok,
    status: null,
    requestTarget: "Supabase project URL and publishable key",
    requestUrl: "",
    message: ok ? "프로젝트 URL과 API 키 설정을 확인했습니다." : "Supabase URL 또는 API 키 설정을 확인해야 합니다.",
    error: "",
    errorCode: ""
  };
}

function checkGoogleLoginSession(): SupabaseConnectionCheck {
  const ok = Boolean(getCurrentSupabaseAccessToken());
  return {
    kind: "Google Login",
    method: "GET",
    ok,
    status: null,
    requestTarget: "Supabase Auth session",
    requestUrl: "",
    message: ok ? "Google 로그인 세션이 확인되었습니다." : "Google 로그인이 필요합니다.",
    error: "",
    errorCode: ""
  };
}

function checkStorageUploadReadiness(projectOk: boolean, loginOk: boolean): SupabaseConnectionCheck {
  const ok = projectOk && loginOk;
  return {
    kind: "Storage",
    method: "POST",
    ok,
    status: null,
    requestTarget: "connection-test/test.json upload",
    requestUrl: "",
    message: ok ? "Storage 업로드 가능 여부는 테스트 저장 버튼으로 확인합니다." : "Project 설정과 Google 로그인을 먼저 확인해야 합니다.",
    error: "",
    errorCode: ""
  };
}

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  const checkedAt = new Date().toISOString();
  const environment = getSupabaseEnvironmentDiagnostics();
  const projectCheck = checkSupabaseProjectSettings(environment);
  const config = getSupabaseStorageConfig();
  const loginCheck = checkGoogleLoginSession();
  const storageUploadCheck = checkStorageUploadReadiness(projectCheck.ok, loginCheck.ok);
  const safeChecks = [projectCheck, loginCheck, storageUploadCheck];
  return {
    configured: Boolean(config),
    ok: Boolean(config) && projectCheck.ok && loginCheck.ok && storageUploadCheck.ok,
    storageApiReachable: storageUploadCheck.ok,
    bucketCheckMessage: "Storage 업로드 가능 여부는 테스트 저장 버튼으로 확인합니다.",
    checkedAt,
    message:
      Boolean(config) && projectCheck.ok && loginCheck.ok
        ? "Project 설정과 Google 로그인 세션을 확인했습니다. Storage 업로드는 테스트 저장 버튼으로 확인합니다."
        : "Project 설정 또는 Google 로그인 상태를 확인해야 합니다.",
    environment,
    checks: safeChecks
  };
}

function isStoragePolicyFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return isStoragePolicyFailureMessage(error.message);
}

export class SupabaseSnapshotOperationError extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SupabaseSnapshotOperationError";
  }
}

export function isSupabaseSnapshotOperationError(error: unknown): error is SupabaseSnapshotOperationError {
  return error instanceof SupabaseSnapshotOperationError;
}

function httpStatusFromError(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : undefined;
}

function normalizeSnapshotError(stage: string, error: unknown) {
  if (isStoragePolicyFailure(error)) return new SupabaseSnapshotOperationError(stage, "스냅샷 접근 권한이 없습니다.", httpStatusFromError(error));
  if (error instanceof SupabaseSnapshotOperationError) return error;
  return new SupabaseSnapshotOperationError(stage, error instanceof Error ? error.message : "스냅샷 작업 중 오류가 발생했습니다.", httpStatusFromError(error));
}

async function readSnapshotPayload(path: string) {
  const config = getAppDataConfig();
  if (!config) throw new SupabaseSnapshotOperationError("설정 확인", "Supabase URL 또는 publishable key가 설정되지 않았습니다.");
  const blob = await downloadSupabaseStorageObject(path, config, getCurrentSupabaseAccessToken());
  if (!blob) throw new SupabaseSnapshotOperationError("스냅샷 읽기", "선택한 스냅샷 파일을 찾을 수 없습니다.", 404);
  return {
    path,
    ...parsePayload(await blob.text())
  };
}

export async function listSupabaseSnapshots(): Promise<SupabaseSnapshotListItem[]> {
  const config = getAppDataConfig();
  if (!config) throw new SupabaseSnapshotOperationError("스냅샷 목록 조회", "Supabase URL 또는 publishable key가 설정되지 않았습니다.");
  const prefix = getSupabaseSnapshotPrefix();
  try {
    const objects = await listSupabaseStorageObjects(prefix, config, getCurrentSupabaseAccessToken());
    return objects
      .filter((object) => object.name.endsWith(".json"))
      .map((object) => {
        const path = normalizeListedSnapshotPath(prefix, object);
        const info = parseSnapshotFileInfo(path);
        return {
          name: info.name,
          path,
          revision: info.revision,
          savedAt: info.savedAt || object.updated_at || object.created_at || "",
          updatedAt: object.updated_at || object.created_at || "",
          size: object.metadata?.size || object.metadata?.contentLength || 0
        };
      })
      .sort((a, b) => (Date.parse(b.savedAt || b.updatedAt) || 0) - (Date.parse(a.savedAt || a.updatedAt) || 0));
  } catch (error) {
    throw normalizeSnapshotError("스냅샷 목록 조회", error);
  }
}

export async function previewSupabaseSnapshot(path: string): Promise<SupabaseSnapshotPreview> {
  try {
    const snapshot = await readSnapshotPayload(path);
    const info = parseSnapshotFileInfo(path);
    return {
      name: info.name,
      path,
      revision: snapshot.payload.revision,
      exportedAt: snapshot.payload.exportedAt,
      savedAt: info.savedAt || snapshot.payload.exportedAt,
      size: new Blob([snapshot.raw]).size,
      counts: countData(snapshot.payload.data),
      companyName: snapshot.payload.data.companyInfo.companyName || "-",
      raw: snapshot.raw
    };
  } catch (error) {
    throw normalizeSnapshotError("스냅샷 미리보기", error);
  }
}

export async function downloadSupabaseSnapshotJson(path: string) {
  try {
    const snapshot = await readSnapshotPayload(path);
    return {
      name: snapshotFileName(path),
      raw: snapshot.raw
    };
  } catch (error) {
    throw normalizeSnapshotError("스냅샷 JSON 다운로드", error);
  }
}

export async function restoreSupabaseSnapshot(
  path: string,
  restoredBy: string,
  onProgress?: (stage: SupabaseSnapshotRestoreStage) => void
): Promise<SupabaseSnapshotRestoreResult> {
  const config = getAppDataConfig();
  if (!config) throw new SupabaseSnapshotOperationError("설정 확인", "Supabase URL 또는 publishable key가 설정되지 않았습니다.");

  let snapshot: Awaited<ReturnType<typeof readSnapshotPayload>>;
  let current: Awaited<ReturnType<typeof readCurrentPayload>>;
  try {
    onProgress?.("reading");
    snapshot = await readSnapshotPayload(path);
  } catch (error) {
    throw normalizeSnapshotError("복원 대상 스냅샷 읽기", error);
  }

  try {
    current = await readCurrentPayload();
  } catch (error) {
    throw normalizeSnapshotError("현재 current.json 읽기", error);
  }
  if (!current) throw new SupabaseSnapshotOperationError("현재 current.json 읽기", "복원 전 백업할 current.json이 없습니다.", 404);

  const restoredAt = new Date().toISOString();
  const previousRevision = current.payload.revision || 0;
  const backupPath = getSupabaseBeforeRestoreSnapshotPath(previousRevision, restoredAt);
  const backupRequestUrl = buildSupabaseStorageObjectUrl(backupPath, config);
  try {
    onProgress?.("backingUp");
    await uploadSupabaseStorageObject(backupPath, new Blob([current.raw], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
  } catch (error) {
    throw normalizeSnapshotError("복원 전 current.json 백업", error);
  }

  const nextRevision = previousRevision + 1;
  const restoredData = withCloudRevision(snapshot.payload.data, nextRevision, restoredAt);
  const payload: SupabaseAppDataPayload = {
    source: "worker-settlement-app",
    exportedAt: restoredAt,
    schemaVersion: restoredData.schemaVersion,
    revision: nextRevision,
    data: restoredData,
    restoredFromSnapshot: path,
    restoredAt,
    restoredBy,
    previousRevision
  };
  const currentPath = getSupabaseAppDataPath();
  const currentRequestUrl = buildSupabaseStorageObjectUrl(currentPath, config);
  try {
    onProgress?.("restoring");
    await uploadSupabaseStorageObject(currentPath, new Blob([JSON.stringify(payload)], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
  } catch (error) {
    throw normalizeSnapshotError("current.json 복원 저장", error);
  }

  return {
    path: currentPath,
    currentRequestUrl,
    snapshotPath: backupPath,
    snapshotRequestUrl: backupRequestUrl,
    backupPath,
    backupRequestUrl,
    savedAt: restoredAt,
    revision: nextRevision,
    data: restoredData,
    restoredFromSnapshot: path,
    restoredAt,
    restoredBy,
    previousRevision
  };
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
  const requestUrl = buildSupabaseStorageObjectUrl(testPath, config);
  const steps: SupabaseStorageTestStep[] = [];
  try {
    const accessToken = getCurrentSupabaseAccessToken();
    const headers = getSupabaseAuthHeaders(config, accessToken);
    if (!headers) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
    const uploadResponse = await fetch(requestUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-upsert": "true"
      },
      body: JSON.stringify(payload)
    });
    const uploadDetails = await parseSupabaseResponse(uploadResponse);
    steps.push({
      order: 1,
      method: "POST",
      requestUrl,
      status: uploadResponse.status,
      message: isObjectNotFoundDetails(uploadDetails) ? "파일이 없어 새로 생성합니다." : uploadDetails.message,
      error: uploadDetails.error,
      errorCode: uploadDetails.errorCode
    });
    if (!uploadResponse.ok) {
      if (isStoragePolicyFailureMessage(`${uploadResponse.status} ${uploadDetails.message} ${uploadDetails.error} ${uploadDetails.errorCode}`)) {
        throw new Error("Storage 접근 정책이 아직 설정되지 않았습니다.");
      }
      throw new Error(`Supabase 테스트 파일 업로드 실패: HTTP ${uploadResponse.status} ${uploadDetails.message || uploadDetails.error || uploadDetails.errorCode}`);
    }
  } catch (error) {
    if (isStoragePolicyFailure(error)) throw new Error("Storage 접근 정책이 아직 설정되지 않았습니다.");
    throw error;
  }
  return {
    ok: true,
    checkedAt,
    testPath,
    requestUrl,
    uploadMethod: "POST",
    uploadUpsert: true,
    steps,
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

export async function saveAppDataToSupabase(data: AppData): Promise<SupabaseSaveResult> {
  const config = getAppDataConfig();
  if (!config) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");

  const current = await readCurrentPayload();
  const cloudRevision = current?.payload.revision ?? 0;
  const localRevision = data.cloudSync.localRevision || 0;
  assertRevisionMatches(localRevision, cloudRevision);

  const savedAt = new Date().toISOString();
  const nextRevision = cloudRevision + 1;
  let snapshotPath: string | undefined;
  let snapshotRequestUrl: string | undefined;
  if (current) {
    snapshotPath = getSupabaseSnapshotPath(cloudRevision, current.payload.exportedAt || savedAt);
    snapshotRequestUrl = buildSupabaseStorageObjectUrl(snapshotPath, config);
    await uploadSupabaseStorageObject(snapshotPath, new Blob([current.raw], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
  }

  const payload = createPayload(data, nextRevision, savedAt);
  const path = getSupabaseAppDataPath();
  const currentRequestUrl = buildSupabaseStorageObjectUrl(path, config);
  await uploadSupabaseStorageObject(path, new Blob([JSON.stringify(payload)], { type: "application/json" }), config, getCurrentSupabaseAccessToken());
  return {
    path,
    currentRequestUrl,
    snapshotPath,
    snapshotRequestUrl,
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
