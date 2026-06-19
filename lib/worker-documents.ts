import { Worker, WorkerAttachment, WorkerDocumentKind } from "./types";

export const workerDocumentLabels: Record<WorkerDocumentKind, string> = {
  ID_FRONT: "신분증앞면",
  ID_BACK: "신분증뒷면",
  SAFETY_CERTIFICATE: "기초안전보건교육이수증",
  OTHER: "기타첨부"
};

export const workerDocumentLegacyKeys: Record<WorkerDocumentKind, keyof Pick<Worker, "idCardFrontImage" | "idCardBackImage" | "safetyCertificateImage" | "otherAttachment">> = {
  ID_FRONT: "idCardFrontImage",
  ID_BACK: "idCardBackImage",
  SAFETY_CERTIFICATE: "safetyCertificateImage",
  OTHER: "otherAttachment"
};

export const requiredWorkerDocumentKinds: WorkerDocumentKind[] = ["ID_FRONT", "ID_BACK", "SAFETY_CERTIFICATE"];

export function createWorkerDocumentFileName(worker: Pick<Worker, "name" | "birthDate">, kind: WorkerDocumentKind, uploadedAt: string, originalFileName = "file") {
  const extension = originalFileName.includes(".") ? `.${originalFileName.split(".").pop()}` : "";
  const safeName = (worker.name || "근로자").replace(/[\/:*?"<>|]/g, "_");
  const birthDate = worker.birthDate || "생년월일미입력";
  return `${safeName}_${birthDate}_${workerDocumentLabels[kind]}_${uploadedAt}${extension}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function createWorkerAttachmentFromFile(worker: Worker, kind: WorkerDocumentKind, file: File): Promise<WorkerAttachment> {
  const uploadedAt = new Date().toISOString().slice(0, 10);
  return {
    id: `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    workerId: worker.id,
    kind,
    fileName: createWorkerDocumentFileName(worker, kind, uploadedAt, file.name),
    originalFileName: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl: await readFileAsDataUrl(file),
    uploadedAt
  };
}

export function getWorkerAttachment(worker: Worker, kind: WorkerDocumentKind) {
  return worker.attachments?.find((attachment) => attachment.kind === kind);
}

export function getWorkerDocumentDataUrl(worker: Worker, kind: WorkerDocumentKind) {
  return getWorkerAttachment(worker, kind)?.dataUrl || String(worker[workerDocumentLegacyKeys[kind]] || "");
}

export function upsertWorkerAttachment(worker: Worker, attachment: WorkerAttachment): Worker {
  const legacyKey = workerDocumentLegacyKeys[attachment.kind];
  const nextAttachments = [...(worker.attachments || []).filter((item) => item.kind !== attachment.kind), attachment];
  return { ...worker, attachments: nextAttachments, [legacyKey]: attachment.dataUrl } as Worker;
}

export function removeWorkerAttachment(worker: Worker, kind: WorkerDocumentKind): Worker {
  const legacyKey = workerDocumentLegacyKeys[kind];
  return { ...worker, attachments: (worker.attachments || []).filter((item) => item.kind !== kind), [legacyKey]: undefined } as Worker;
}

function dataUrlToBytes(dataUrl: string) {
  const [, base64 = ""] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

export function downloadWorkerAttachments(worker: Worker) {
  const attachments = worker.attachments || [];
  if (!attachments.length) return false;
  attachments.forEach((attachment) => downloadDataUrl(attachment.dataUrl, attachment.fileName));
  return true;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushBytes(target: number[], bytes: Uint8Array) {
  bytes.forEach((byte) => target.push(byte));
}

export function downloadAttachmentsZip(workers: Worker[], zipFileName = "worker-documents.zip") {
  const files = workers.flatMap((worker) => (worker.attachments || []).map((attachment) => ({
    path: `${(worker.name || worker.workerCode || "worker").replace(/[\/:*?"<>|]/g, "_")}/${attachment.fileName}`,
    bytes: dataUrlToBytes(attachment.dataUrl)
  })));
  if (!files.length) return false;

  const output: number[] = [];
  const centralDirectory: number[] = [];
  files.forEach((file) => {
    const nameBytes = textBytes(file.path);
    const crc = crc32(file.bytes);
    const offset = output.length;
    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, crc);
    writeUint32(output, file.bytes.length);
    writeUint32(output, file.bytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    pushBytes(output, nameBytes);
    pushBytes(output, file.bytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, crc);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, offset);
    pushBytes(centralDirectory, nameBytes);
  });

  const centralOffset = output.length;
  output.push(...centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralOffset);
  writeUint16(output, 0);

  const blob = new Blob([new Uint8Array(output)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipFileName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
