"use client";

export const WORKER_DOCUMENTS_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_WORKER_DOCUMENTS_BUCKET || "worker-documents";

export interface SupabaseStorageConfig {
  url: string;
  anonKey: string;
  bucket: string;
}

export function getSupabaseStorageConfig(): SupabaseStorageConfig | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  return {
    url: url.replace(/\/$/, ""),
    anonKey,
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

export async function uploadSupabaseStorageObject(path: string, file: File, config = getSupabaseStorageConfig()) {
  if (!config) return undefined;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
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

export async function downloadSupabaseStorageObject(path: string, config = getSupabaseStorageConfig()) {
  if (!config) return undefined;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${encodeURI(path)}`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase download failed: ${response.status}`);
  return response.blob();
}

export async function deleteSupabaseStorageObject(path: string, config = getSupabaseStorageConfig()) {
  if (!config) return false;
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}`, {
    method: "DELETE",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
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
}

export function getSupabaseAppConfig(): SupabaseAppConfig | undefined {
  const storage = getSupabaseStorageConfig();
  if (!storage) return undefined;
  return {
    ...storage,
    organizationId: process.env.NEXT_PUBLIC_SUPABASE_ORG_ID || "local-org",
    dataMode: process.env.NEXT_PUBLIC_DATA_STORAGE_MODE === "supabase" ? "supabase" : "local",
    workerDocumentsBucket: storage.bucket
  };
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseAppConfig());
}
