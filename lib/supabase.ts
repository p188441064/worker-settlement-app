"use client";

export const WORKER_DOCUMENTS_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_WORKER_DOCUMENTS_BUCKET || "worker-documents";
export const APP_DATA_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_APP_DATA_BUCKET || WORKER_DOCUMENTS_BUCKET;

export interface SupabaseStorageConfig {
  url: string;
  publishableKey: string;
  bucket: string;
}

export interface SupabaseEnvironmentDiagnostics {
  urlConfigured: boolean;
  projectRef: string;
  keyConfigured: boolean;
  keyKind: "publishable" | "legacy anon" | "unknown";
  keyPrefix: string;
  keyHasSurroundingWhitespace: boolean;
  keyLength: number;
}

function getRawSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function getRawSupabaseKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

function getKeyKind(key: string): SupabaseEnvironmentDiagnostics["keyKind"] {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("eyJ")) return "legacy anon";
  return "unknown";
}

function getProjectRef(url: string) {
  try {
    const hostname = new URL(url).hostname;
    const [ref] = hostname.split(".");
    return ref || "";
  } catch {
    return "";
  }
}

export function getSupabaseEnvironmentDiagnostics(): SupabaseEnvironmentDiagnostics {
  const rawUrl = getRawSupabaseUrl();
  const rawKey = getRawSupabaseKey();
  const url = rawUrl.trim();
  const key = rawKey.trim();
  return {
    urlConfigured: Boolean(url),
    projectRef: getProjectRef(url),
    keyConfigured: Boolean(key),
    keyKind: getKeyKind(key),
    keyPrefix: key.slice(0, 6),
    keyHasSurroundingWhitespace: rawKey !== key,
    keyLength: rawKey.length
  };
}

export function getSupabaseStorageConfig(): SupabaseStorageConfig | undefined {
  const url = getRawSupabaseUrl().trim();
  const publishableKey = getRawSupabaseKey().trim();
  if (!url || !publishableKey) return undefined;
  return {
    url: url.replace(/\/$/, ""),
    publishableKey,
    bucket: WORKER_DOCUMENTS_BUCKET
  };
}

export function isSupabaseStorageConfigured() {
  return Boolean(getSupabaseStorageConfig());
}

export function buildSupabasePublicUrl(path: string, config = getSupabaseStorageConfig()) {
  if (!config) return "";
  return `${config.url}/storage/v1/object/public/${config.bucket}/${encodeURI(path)}`;
}

export function buildSupabaseStorageObjectUrl(path: string, config = getSupabaseStorageConfig()) {
  if (!config) return "";
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeURI(path)}`;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function readSupabaseStorageErrorDetail(response: Response) {
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return stringFromUnknown(parsed.message) || stringFromUnknown(parsed.error) || stringFromUnknown(parsed.code);
    }
  } catch {
    return "";
  }
  return "";
}

function isSupabaseObjectNotFound(response: Response, detail: string) {
  return response.status === 404 || detail.toLowerCase().includes("object not found");
}

async function createSupabaseStorageError(action: string, response: Response, detail?: string) {
  const errorDetail = detail ?? (await readSupabaseStorageErrorDetail(response));
  return new Error(`Supabase ${action} failed: ${response.status}${errorDetail ? ` ${errorDetail}` : ""}`);
}

export async function uploadSupabaseStorageObject(path: string, file: Blob, config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return undefined;
  const authHeaders = getSupabaseAuthHeaders(config, accessToken);
  if (!authHeaders) return undefined;
  const requestUrl = buildSupabaseStorageObjectUrl(path, config);
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    },
    body: file
  });
  if (!response.ok) throw await createSupabaseStorageError("upload", response);
  return {
    bucket: config.bucket,
    path,
    requestUrl,
    publicUrl: buildSupabasePublicUrl(path, config)
  };
}

export async function downloadSupabaseStorageObject(path: string, config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return undefined;
  const authHeaders = getSupabaseAuthHeaders(config, accessToken);
  if (!authHeaders) return undefined;
  const response = await fetch(buildSupabaseStorageObjectUrl(path, config), {
    headers: authHeaders
  });
  if (!response.ok) {
    const detail = await readSupabaseStorageErrorDetail(response);
    if (isSupabaseObjectNotFound(response, detail)) return undefined;
    throw await createSupabaseStorageError("download", response, detail);
  }
  return response.blob();
}

export async function deleteSupabaseStorageObject(path: string, config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return false;
  const authHeaders = getSupabaseAuthHeaders(config, accessToken);
  if (!authHeaders) return false;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}`, {
    method: "DELETE",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!response.ok) throw await createSupabaseStorageError("delete", response);
  return true;
}

export interface SupabaseAppConfig extends SupabaseStorageConfig {
  organizationId: string;
  dataMode: "local" | "supabase";
  workerDocumentsBucket: string;
  appDataBucket: string;
}

export function getSupabaseAppConfig(): SupabaseAppConfig | undefined {
  const storage = getSupabaseStorageConfig();
  if (!storage) return undefined;
  return {
    ...storage,
    organizationId: process.env.NEXT_PUBLIC_SUPABASE_ORG_ID || "local-org",
    dataMode: process.env.NEXT_PUBLIC_DATA_STORAGE_MODE === "supabase" ? "supabase" : "local",
    workerDocumentsBucket: storage.bucket,
    appDataBucket: APP_DATA_BUCKET
  };
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseAppConfig());
}

export function getSupabaseAuthHeaders(config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return undefined;
  const headers: Record<string, string> = {
    apikey: config.publishableKey
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}
