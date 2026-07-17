"use client";

export const WORKER_DOCUMENTS_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_WORKER_DOCUMENTS_BUCKET || "worker-documents";
export const APP_DATA_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_APP_DATA_BUCKET || WORKER_DOCUMENTS_BUCKET;

export interface SupabaseStorageConfig {
  url: string;
  publishableKey: string;
  bucket: string;
}

export function getSupabaseStorageConfig(): SupabaseStorageConfig | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

export async function uploadSupabaseStorageObject(path: string, file: Blob, config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return undefined;
  const authHeaders = getSupabaseAuthHeaders(config, accessToken);
  if (!authHeaders) return undefined;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    },
    body: file
  });
  if (!response.ok) throw new Error(`Supabase upload failed: ${response.status}`);
  return {
    bucket: config.bucket,
    path,
    publicUrl: buildSupabasePublicUrl(path, config)
  };
}

export async function downloadSupabaseStorageObject(path: string, config = getSupabaseStorageConfig(), accessToken?: string) {
  if (!config) return undefined;
  const authHeaders = getSupabaseAuthHeaders(config, accessToken);
  if (!authHeaders) return undefined;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${encodeURI(path)}`, {
    headers: authHeaders
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Supabase download failed: ${response.status}`);
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
  if (!response.ok) throw new Error(`Supabase delete failed: ${response.status}`);
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
