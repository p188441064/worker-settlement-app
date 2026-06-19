"use client";

import { Worker, WorkerAttachment, WorkerDocumentKind } from "./types";
import { deleteSupabaseStorageObject, downloadSupabaseStorageObject, getSupabaseStorageConfig, uploadSupabaseStorageObject } from "./supabase";

export interface UploadedWorkerDocument {
  storageProvider: "supabase";
  storageBucket: string;
  storagePath: string;
  publicUrl: string;
}

function safePathPart(value: string) {
  return (value || "unknown").replace(/[\\/:*?"<>|\s]+/g, "_");
}

export function buildWorkerDocumentStoragePath(worker: Pick<Worker, "id" | "name" | "birthDate">, kind: WorkerDocumentKind, fileName: string) {
  const workerFolder = `${safePathPart(worker.id || worker.name)}_${safePathPart(worker.name)}_${safePathPart(worker.birthDate)}`;
  return `${workerFolder}/${kind}/${safePathPart(fileName)}`;
}

export async function uploadWorkerDocumentFile(worker: Worker, kind: WorkerDocumentKind, fileName: string, file: File): Promise<UploadedWorkerDocument | undefined> {
  const config = getSupabaseStorageConfig();
  if (!config) return undefined;
  const storagePath = buildWorkerDocumentStoragePath(worker, kind, fileName);
  const uploaded = await uploadSupabaseStorageObject(storagePath, file, config);
  if (!uploaded) return undefined;
  return {
    storageProvider: "supabase",
    storageBucket: uploaded.bucket,
    storagePath: uploaded.path,
    publicUrl: uploaded.publicUrl
  };
}

export async function downloadWorkerDocumentFile(attachment: WorkerAttachment) {
  if (attachment.storageProvider === "supabase" && attachment.storagePath) {
    const blob = await downloadSupabaseStorageObject(attachment.storagePath);
    if (blob) return blob;
  }
  return undefined;
}

export async function deleteWorkerDocumentFile(attachment?: WorkerAttachment) {
  if (!attachment?.storagePath || attachment.storageProvider !== "supabase") return false;
  return deleteSupabaseStorageObject(attachment.storagePath);
}
