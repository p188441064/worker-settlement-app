"use client";

import { deleteSupabaseStorageObject, downloadSupabaseStorageObject, getSupabaseAppConfig, getSupabaseStorageConfig, uploadSupabaseStorageObject } from "./supabase";
import { getCurrentSupabaseAccessToken } from "./supabase-auth";

export type CompanyAssetKind = "seal" | "nameplate";

export const COMPANY_ASSET_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const COMPANY_ASSET_ACCEPT = "image/png,image/jpeg,application/pdf";

const companyAssetFiles: Record<CompanyAssetKind, string> = {
  seal: "seal.png",
  nameplate: "nameplate.png"
};

const companyAssetLabels: Record<CompanyAssetKind, string> = {
  seal: "회사 사용인감",
  nameplate: "회사 명판"
};

export interface UploadedCompanyAsset {
  kind: CompanyAssetKind;
  label: string;
  fileName: string;
  storageBucket: string;
  storagePath: string;
  requestUrl: string;
}

function getOrganizationId() {
  return getSupabaseAppConfig()?.organizationId || "local-org";
}

export function getCompanyAssetLabel(kind: CompanyAssetKind) {
  return companyAssetLabels[kind];
}

export function getCompanyAssetFileName(kind: CompanyAssetKind) {
  return companyAssetFiles[kind];
}

export function getCompanyAssetPath(kind: CompanyAssetKind) {
  return `${getOrganizationId()}/company/${companyAssetFiles[kind]}`;
}

export function validateCompanyAssetFile(file: File) {
  const allowedTypes = ["image/png", "image/jpeg", "application/pdf"];
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".pdf"];
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension));

  if (!allowedTypes.includes(file.type) && !hasAllowedExtension) {
    throw new Error("PNG, JPG/JPEG, PDF 파일만 업로드할 수 있습니다.");
  }
  if (file.size > COMPANY_ASSET_MAX_SIZE_BYTES) {
    throw new Error("파일 크기는 5MB 이하만 업로드할 수 있습니다.");
  }
}

export async function uploadCompanyAssetFile(kind: CompanyAssetKind, file: File): Promise<UploadedCompanyAsset | undefined> {
  validateCompanyAssetFile(file);
  const config = getSupabaseStorageConfig();
  if (!config) return undefined;
  const storagePath = getCompanyAssetPath(kind);
  const uploaded = await uploadSupabaseStorageObject(storagePath, file, config, getCurrentSupabaseAccessToken());
  if (!uploaded) return undefined;
  return {
    kind,
    label: companyAssetLabels[kind],
    fileName: companyAssetFiles[kind],
    storageBucket: uploaded.bucket,
    storagePath: uploaded.path,
    requestUrl: uploaded.requestUrl
  };
}

export async function downloadCompanyAssetFile(path: string) {
  return downloadSupabaseStorageObject(path, undefined, getCurrentSupabaseAccessToken());
}

export async function deleteCompanyAssetFile(path: string) {
  return deleteSupabaseStorageObject(path, undefined, getCurrentSupabaseAccessToken());
}
