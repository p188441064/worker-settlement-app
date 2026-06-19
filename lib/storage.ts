"use client";

import { AppData, CalculationRule, Client, Site, WorkAssignment, WorkEntry, WorkRequest, Worker, WorkerAttachment, WorkerDocumentKind } from "./types";
import { SCHEMA_VERSION, sampleData } from "./sample-data";
import { ceilWon, getWorkerBaseAmount, normalizeRequestStatuses } from "./calculations";
import { calculatePayrollDeduction } from "./payrollRules";
import { createLocalStorageService } from "./storageService";

export const STORAGE_KEY = "worker-settlement-app-data-v1";
export const storageService = createLocalStorageService(STORAGE_KEY, SCHEMA_VERSION);

export function loadAppData(): AppData {
  if (typeof window === "undefined") return sampleData;
  return storageService.loadAppData({
    fallbackData: sampleData,
    migrate: migrateAppData,
    onCorruptData: () => alert("저장된 구버전 데이터를 읽기 어려워 새 샘플 데이터로 초기화했습니다.")
  });
}

export function saveAppData(data: AppData) {
  storageService.saveAppData(data);
}

export function resetAppData() {
  return storageService.resetAppData(sampleData);
}

export function clearAppData() {
  storageService.clearAppData();
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function migrateClient(client: Partial<Client>): Client {
  return {
    id: client.id || createId("c"),
    name: client.name || "샘플 거래처",
    managerName: client.managerName || "",
    phone: client.phone || "",
    fax: client.fax || "",
    email: client.email || "",
    email2: client.email2 || "",
    closingDay: client.closingDay || 25,
    paymentDay: client.paymentDay || 10,
    memo: client.memo || ""
  };
}
function createSignatureDataUrl(name: string, style: "STAMP" | "SIGN") {
  const svg =
    style === "STAMP"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="white"/><circle cx="60" cy="60" r="48" fill="none" stroke="#b91c1c" stroke-width="6"/><text x="60" y="70" text-anchor="middle" font-size="28" font-family="serif" fill="#b91c1c">${name}</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="white"/><path d="M12 55 C45 15, 80 75, 120 35 S160 45, 170 25" fill="none" stroke="#0b2537" stroke-width="4"/><text x="90" y="48" text-anchor="middle" font-size="24" font-family="cursive" fill="#0b2537">${name}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const legacyWorkerDocuments: Array<{ kind: WorkerDocumentKind; key: keyof Pick<Worker, "idCardFrontImage" | "idCardBackImage" | "safetyCertificateImage" | "otherAttachment">; label: string }> = [
  { kind: "ID_FRONT", key: "idCardFrontImage", label: "신분증앞면" },
  { kind: "ID_BACK", key: "idCardBackImage", label: "신분증뒷면" },
  { kind: "SAFETY_CERTIFICATE", key: "safetyCertificateImage", label: "기초안전보건교육이수증" },
  { kind: "OTHER", key: "otherAttachment", label: "기타첨부" }
];

function makeLegacyWorkerAttachment(worker: Partial<Worker>, workerId: string, kind: WorkerDocumentKind, dataUrl?: string, label = "첨부파일"): WorkerAttachment | undefined {
  if (!dataUrl) return undefined;
  const uploadedAt = worker.registrationDate || new Date().toISOString().slice(0, 10);
  const safeName = (worker.name || "근로자").replace(/[\/:*?"<>|]/g, "_");
  const birthDate = worker.birthDate || "생년월일미입력";
  const extension = dataUrl.startsWith("data:image/jpeg") ? "jpg" : dataUrl.startsWith("data:image/png") ? "png" : "dat";
  return {
    id: `wa-legacy-${workerId}-${kind}`,
    workerId,
    kind,
    fileName: `${safeName}_${birthDate}_${label}_${uploadedAt}.${extension}`,
    originalFileName: `${label}.${extension}`,
    mimeType: dataUrl.startsWith("data:") ? dataUrl.slice(5, dataUrl.indexOf(";")) || "application/octet-stream" : "application/octet-stream",
    dataUrl,
    uploadedAt
  };
}

function migrateWorkerAttachments(worker: Partial<Worker>, workerId: string): WorkerAttachment[] {
  const attachments = (worker.attachments || []).map((attachment) => ({
    ...attachment,
    id: attachment.id || `wa-${workerId}-${attachment.kind}`,
    workerId: attachment.workerId || workerId,
    fileName: attachment.fileName || `${worker.name || "???"}_${worker.birthDate || "생년월일미입력"}_${attachment.kind}_${attachment.uploadedAt || new Date().toISOString().slice(0, 10)}`,
    originalFileName: attachment.originalFileName || attachment.fileName || "attachment",
    mimeType: attachment.mimeType || "application/octet-stream",
    uploadedAt: attachment.uploadedAt || worker.registrationDate || new Date().toISOString().slice(0, 10)
  }));

  legacyWorkerDocuments.forEach(({ kind, key, label }) => {
    if (attachments.some((attachment) => attachment.kind === kind)) return;
    const legacy = makeLegacyWorkerAttachment(worker, workerId, kind, worker[key] as string | undefined, label);
    if (legacy) attachments.push(legacy);
  });

  return attachments;
}

function migrateWorker(worker: Partial<Worker>): Worker {
  const workerId = worker.id || createId("w");
  const birthDate = worker.birthDate || "1980-01-01";
  const birthYear = Number(birthDate.slice(0, 4));
  const name = worker.name || "샘플근로자";
  const attachments = migrateWorkerAttachments(worker, workerId);
  const hasFront = attachments.some((attachment) => attachment.kind === "ID_FRONT") || Boolean(worker.idCardFrontImage);
  const hasBack = attachments.some((attachment) => attachment.kind === "ID_BACK") || Boolean(worker.idCardBackImage);
  const hasCert = attachments.some((attachment) => attachment.kind === "SAFETY_CERTIFICATE") || Boolean(worker.safetyCertificateImage);
  const documentStatus = hasFront && hasBack && hasCert ? "완료" : hasFront || hasBack || hasCert ? "일부누락" : worker.documentStatus || "미확인";

  return {
    id: workerId,
    workerCode: worker.workerCode || `W-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    name,
    birthDate,
    ageGroup: worker.ageGroup || (birthYear <= 1966 ? "OVER_60" : "UNDER_60"),
    phone: worker.phone || worker.mobile || "010-0000-0000",
    landline: worker.landline || "",
    mobile: worker.mobile || worker.phone || "010-0000-0000",
    residentNumber: worker.residentNumber || `${birthDate.replaceAll("-", "").slice(2)}-*******`,
    address: worker.address || "샘플 주소",
    registrationDate: worker.registrationDate || new Date().toISOString().slice(0, 10),
    jobType: worker.jobType || "일용",
    career: worker.career || "",
    certifications: worker.certifications || "",
    documentStatus,
    memo: worker.memo || "",
    idCardFrontImage: worker.idCardFrontImage,
    idCardBackImage: worker.idCardBackImage,
    safetyCertificateImage: worker.safetyCertificateImage,
    otherAttachment: worker.otherAttachment,
    attachments,
    signatureStyle: worker.signatureStyle || "STAMP",
    signatureDataUrl: worker.signatureDataUrl || createSignatureDataUrl(name, worker.signatureStyle || "STAMP")
  };
}

function migrateSite(site: Partial<Site>, clientName = ""): Site {
  const siteName = site.siteName || site.name || "샘플 현장";
  const resolvedClientName = site.clientName || clientName || "샘플 거래처";
  return {
    id: site.id || createId("s"),
    clientId: site.clientId || "c-001",
    name: siteName,
    code: site.siteCode || site.code || "",
    siteCode: site.siteCode || site.code || "",
    clientName: resolvedClientName,
    siteName,
    displayName: site.displayName || `${resolvedClientName}(${siteName})`,
    phone: site.phone || "",
    fax: site.fax || "",
    managerName: site.managerName || "",
    managerTitle: site.managerTitle || "",
    managerPhone: site.managerPhone || "",
    closingDay: site.closingDay || 25,
    paymentDay: site.paymentDay || 10,
    settlementEmail1: site.settlementEmail1 || "",
    settlementEmail2: site.settlementEmail2 || "",
    address: site.address || "",
    directions: site.directions || "",
    memo: site.memo || "",
    requiresIdCard: false,
    defaultUnitPrice: site.defaultUnitPrice || 150000,
    defaultDeductionType: site.defaultDeductionType || "고용보험",
    defaultTaskDescription: site.defaultTaskDescription || "현장 정리 및 작업 보조",
    isActive: site.isActive ?? true,
    invoiceIssueType: site.invoiceIssueType || "ISSUED",
    invoiceDeductionRate: site.invoiceDeductionRate ?? 0.1,
    deductionOutputBasis: site.deductionOutputBasis || "MONTH_FIRST_DAY",
    healthInsuranceBasis: site.healthInsuranceBasis || "CLIENT_BASED",
    healthInsuranceOutputBasis: site.healthInsuranceOutputBasis || "MONTH_FIRST_DAY",
    pensionBasis: site.pensionBasis || "MONTH_FIRST_DAY_AND_AMOUNT",
    pensionOutputBasis: site.pensionOutputBasis || "MONTH_FIRST_DAY",
    firstMonthInsuranceHandling: site.firstMonthInsuranceHandling || "APPLY",
    pensionThresholdBase: site.pensionThresholdBase || "LABOR_COST_TOTAL",
    pensionMonthlyThreshold: site.pensionMonthlyThreshold || 2200000,
    carryOverPreviousMonth: Boolean(site.carryOverPreviousMonth)
  };
}

function migrateRule(rule: Partial<CalculationRule>): CalculationRule {
  const unitPrice = rule.unitPrice || 150000;
  const brokerageFeeRate = rule.brokerageFeeRate ?? 0.1;
  const base = getWorkerBaseAmount(unitPrice, brokerageFeeRate);
  const workerBaseAmount = rule.workerBaseAmount ?? base.workerBaseAmount;
  const brokerageFee = rule.brokerageFee ?? base.brokerageFee;
  const invoiceIssueType = rule.invoiceIssueType || "NOT_ISSUED";
  const employmentInsurance = ceilWon(rule.employmentInsurance || 0);
  const healthInsurance = ceilWon(rule.healthInsurance || 0);
  const nationalPension = ceilWon(rule.nationalPension || 0);
  const longTermCare = ceilWon(rule.longTermCare || 0);
  const deductionAmount = rule.deductionAmount ?? employmentInsurance + healthInsurance + nationalPension + longTermCare;
  return {
    id: rule.id || createId("r"),
    deductionType: rule.deductionType || "고용보험",
    ageGroup: rule.ageGroup || "ALL",
    unitPrice,
    brokerageFeeRate,
    brokerageFee,
    workerBaseAmount,
    invoiceIssueType,
    laborCost: rule.laborCost || workerBaseAmount,
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare,
    deductionAmount,
    paymentAmount: rule.paymentAmount ?? workerBaseAmount - deductionAmount,
    memo: rule.memo || ""
  };
}
function convertEntriesToRequestsAndAssignments(data: AppData, entries: WorkEntry[]) {
  const requests: WorkRequest[] = [];
  const assignments: WorkAssignment[] = [];
  entries.forEach((entry, index) => {
    const requestId = `migrated-req-${entry.id || index}`;
    const site = data.sites.find((item) => item.id === entry.siteId) || data.sites[0];
    const client = data.clients.find((item) => item.id === entry.clientId) || data.clients[0];
    const worker = data.workers.find((item) => item.id === entry.workerId) || data.workers[0];
    requests.push({
      id: requestId,
      requestDate: entry.workDate,
      workDate: entry.workDate,
      clientId: entry.clientId,
      siteId: entry.siteId,
      taskDescription: "기존 출역 데이터",
      requestedCount: 1,
      unitPrice: entry.unitPrice,
      deductionType: entry.deductionType,
      meetingPlace: "",
      memo: entry.memo,
      status: "배치대기"
    });
    assignments.push({
      ...calculatePayrollDeduction({
        worker,
        site,
        client,
        requestId,
        workerId: entry.workerId,
        workDate: entry.workDate,
        clientId: entry.clientId,
        siteId: entry.siteId,
        taskDescription: "기존 출역 데이터",
        unitPrice: entry.unitPrice,
        workCount: entry.workCount,
        deductionType: entry.deductionType,
        existingAssignments: assignments,
        calculationRules: data.calculationRules
      }),
      id: `migrated-as-${entry.id || index}`,
      memo: entry.memo
    });
  });
  return { requests, assignments };
}

function migrateCompanyInfo(companyInfo: Partial<AppData["companyInfo"]> | undefined): AppData["companyInfo"] {
  return {
    ...sampleData.companyInfo,
    ...(companyInfo || {}),
    companyName: companyInfo?.companyName || sampleData.companyInfo.companyName,
    companyAddress: companyInfo?.companyAddress || sampleData.companyInfo.companyAddress,
    companyRepresentative: companyInfo?.companyRepresentative || sampleData.companyInfo.companyRepresentative,
    businessNumber: companyInfo?.businessNumber || sampleData.companyInfo.businessNumber,
    companyPhone: companyInfo?.companyPhone || sampleData.companyInfo.companyPhone || "",
    bankAccountText: companyInfo?.bankAccountText || sampleData.companyInfo.bankAccountText
  };
}

function migrateAccessControl(accessControl: Partial<AppData["accessControl"]> | undefined): AppData["accessControl"] {
  const samplePermissions = sampleData.accessControl.menuPermissions;
  const incoming = accessControl?.menuPermissions || [];
  return {
    currentRole: accessControl?.currentRole || "ADMIN",
    menuPermissions: samplePermissions.map((permission) => ({
      ...permission,
      ...(incoming.find((item) => item.viewKey === permission.viewKey) || {})
    }))
  };
}

export function migrateAppData(partial: Partial<AppData>): AppData {
  const clients = (partial.clients?.length ? partial.clients : sampleData.clients).map(migrateClient);
  const workers = (partial.workers?.length ? partial.workers : sampleData.workers).map(migrateWorker);
  const sites = (partial.sites?.length ? partial.sites : sampleData.sites).map((site) => {
    const client = clients.find((item) => item.id === site.clientId);
    return migrateSite(site, client?.name);
  });
  const calculationRules = (partial.calculationRules?.length ? partial.calculationRules : sampleData.calculationRules).map(migrateRule);
  let data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    workers,
    clients,
    sites,
    workEntries: partial.workEntries || [],
    workRequests: partial.workRequests || [],
    assignments: partial.assignments || [],
    calculationRules,
    companyInfo: migrateCompanyInfo(partial.companyInfo),
    accessControl: migrateAccessControl(partial.accessControl),
    receivablePayments: partial.receivablePayments || []
  };
  if (!data.workRequests.length && !data.assignments.length && data.workEntries.length) {
    const converted = convertEntriesToRequestsAndAssignments(data, data.workEntries);
    data = { ...data, workRequests: converted.requests, assignments: converted.assignments };
  }
  if (!data.workRequests.length) data.workRequests = sampleData.workRequests;
  if (!data.assignments.length) data.assignments = sampleData.assignments;
  data.workRequests = normalizeRequestStatuses(data.workRequests, data.assignments);
  data.assignments = data.assignments.map((assignment) => ({
    ...sampleData.assignments[0],
    ...assignment,
    invoiceIssueType: assignment.invoiceIssueType || sites.find((site) => site.id === assignment.siteId)?.invoiceIssueType || "ISSUED",
    invoiceDeductionRate: assignment.invoiceDeductionRate ?? sites.find((site) => site.id === assignment.siteId)?.invoiceDeductionRate ?? 0.1,
    deductionBaseAmount: assignment.deductionBaseAmount || getWorkerBaseAmount(assignment.unitPrice, assignment.invoiceDeductionRate ?? 0.1).workerBaseAmount,
    employmentInsurance: assignment.employmentInsurance ?? 0,
    healthInsurance: assignment.healthInsurance ?? 0,
    nationalPension: assignment.nationalPension ?? 0,
    longTermCare: assignment.longTermCare ?? 0
  }));
  return data;
}
