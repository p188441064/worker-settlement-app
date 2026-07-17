import { AppData, CalculationRule, Client, DeductionType, Site, WorkAssignment, WorkRequest, Worker, WorkerAttachment, WorkerDocumentKind } from "./types";
import { createCalculationRule, normalizeRequestStatuses } from "./calculations";
import { calculatePayrollDeduction } from "./payrollRules";

export const SCHEMA_VERSION = 3;

export const sampleWorkers: Worker[] = [
  { id: "w-001", workerCode: "W-0001", name: "김도윤", birthDate: "1962-04-12", ageGroup: "OVER_60", phone: "010-1000-2001", landline: "02-1000-2001", mobile: "010-1000-2001", residentNumber: "620412-1******", address: "서울시 샘플구 더미로 12", registrationDate: "2026-06-01", jobType: "보통인부", career: "철근 5년", certifications: "기초안전보건교육", documentStatus: "완료", memo: "철근 경력", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-002", workerCode: "W-0002", name: "박민재", birthDate: "1978-09-03", ageGroup: "UNDER_60", phone: "010-1000-2002", landline: "", mobile: "010-1000-2002", residentNumber: "780903-1******", address: "경기도 샘플시 가상동 24", registrationDate: "2026-06-01", jobType: "보통인부", career: "운반 3년", certifications: "", documentStatus: "일부누락", memo: "주간 선호", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-003", workerCode: "W-0003", name: "이서준", birthDate: "1984-11-18", ageGroup: "UNDER_60", phone: "010-1000-2003", landline: "", mobile: "010-1000-2003", residentNumber: "841118-1******", address: "인천시 예시구 테스트로 7", registrationDate: "2026-06-02", jobType: "전기보조", career: "전기 보조 2년", certifications: "기초안전보건교육", documentStatus: "완료", memo: "전기 보조", signatureStyle: "SIGN", signatureDataUrl: "" },
  { id: "w-004", workerCode: "W-0004", name: "최현우", birthDate: "1965-01-22", ageGroup: "OVER_60", phone: "010-1000-2004", landline: "", mobile: "010-1000-2004", residentNumber: "650122-1******", address: "서울시 가상구 테스트길 31", registrationDate: "2026-06-02", jobType: "보통인부", career: "단기", certifications: "", documentStatus: "미확인", memo: "단기 가능", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-005", workerCode: "W-0005", name: "정하준", birthDate: "1990-06-09", ageGroup: "UNDER_60", phone: "010-1000-2005", landline: "", mobile: "010-1000-2005", residentNumber: "900609-1******", address: "경기도 더미시 샘플로 88", registrationDate: "2026-06-03", jobType: "초보", career: "초보", certifications: "기초안전보건교육", documentStatus: "완료", memo: "초보", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-006", workerCode: "W-0006", name: "윤지훈", birthDate: "1972-03-27", ageGroup: "UNDER_60", phone: "010-1000-2006", landline: "", mobile: "010-1000-2006", residentNumber: "720327-1******", address: "서울시 예시구 내부길 16", registrationDate: "2026-06-03", jobType: "목공", career: "목공 4년", certifications: "기초안전보건교육", documentStatus: "완료", memo: "목공 가능", signatureStyle: "SIGN", signatureDataUrl: "" },
  { id: "w-007", workerCode: "W-0007", name: "한유진", birthDate: "1988-12-05", ageGroup: "UNDER_60", phone: "010-1000-2007", landline: "", mobile: "010-1000-2007", residentNumber: "881205-2******", address: "경기도 샘플시 업무로 5", registrationDate: "2026-06-04", jobType: "보통인부", career: "야간 가능", certifications: "", documentStatus: "일부누락", memo: "야간 가능", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-008", workerCode: "W-0008", name: "오태민", birthDate: "1960-08-14", ageGroup: "OVER_60", phone: "010-1000-2008", landline: "", mobile: "010-1000-2008", residentNumber: "600814-1******", address: "인천시 더미구 현장길 42", registrationDate: "2026-06-04", jobType: "운반", career: "운반 8년", certifications: "기초안전보건교육", documentStatus: "완료", memo: "운반 경력", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-009", workerCode: "W-0009", name: "강성민", birthDate: "1981-02-19", ageGroup: "UNDER_60", phone: "010-1000-2009", landline: "", mobile: "010-1000-2009", residentNumber: "810219-1******", address: "서울시 샘플구 장부로 19", registrationDate: "2026-06-05", jobType: "보통인부", career: "확인 필요", certifications: "", documentStatus: "미확인", memo: "확인 필요", signatureStyle: "STAMP", signatureDataUrl: "" },
  { id: "w-010", workerCode: "W-0010", name: "서준호", birthDate: "1975-07-30", ageGroup: "UNDER_60", phone: "010-1000-2010", landline: "", mobile: "010-1000-2010", residentNumber: "750730-1******", address: "경기도 예시시 샘플길 64", registrationDate: "2026-06-05", jobType: "보통인부", career: "고정 가능", certifications: "기초안전보건교육", documentStatus: "완료", memo: "고정 가능", signatureStyle: "SIGN", signatureDataUrl: "" }
];


const sampleDocumentDataUrl = (label: string, name: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260"><rect width="420" height="260" fill="#fff"/><rect x="18" y="18" width="384" height="224" fill="none" stroke="#0b2537" stroke-width="4"/><text x="210" y="115" text-anchor="middle" font-size="28" font-family="Arial" fill="#0b2537">${label}</text><text x="210" y="160" text-anchor="middle" font-size="24" font-family="Arial" fill="#0b2537">${name}</text></svg>`)}`;

function sampleAttachment(worker: Worker, kind: WorkerDocumentKind, label: string): WorkerAttachment {
  return {
    id: `sample-${worker.id}-${kind}`,
    workerId: worker.id,
    kind,
    fileName: `${worker.name}_${worker.birthDate}_${label}_${worker.registrationDate}.svg`,
    originalFileName: `${label}.svg`,
    mimeType: "image/svg+xml",
    dataUrl: sampleDocumentDataUrl(label, worker.name),
    uploadedAt: worker.registrationDate,
    storageProvider: "local"
  };
}

sampleWorkers.forEach((worker, index) => {
  const attachments = [sampleAttachment(worker, "ID_FRONT", "신분증앞면")];
  if (index % 3 !== 1) attachments.push(sampleAttachment(worker, "ID_BACK", "신분증뒷면"));
  if (index % 4 !== 3) attachments.push(sampleAttachment(worker, "SAFETY_CERTIFICATE", "기초안전보건교육이수증"));
  if (index === 0) attachments.push(sampleAttachment(worker, "OTHER", "기타첨부"));
  worker.attachments = attachments;
  worker.documentStatus = attachments.some((attachment) => attachment.kind === "ID_FRONT") && attachments.some((attachment) => attachment.kind === "ID_BACK") && attachments.some((attachment) => attachment.kind === "SAFETY_CERTIFICATE") ? "완료" : "일부누락";
});
export const sampleClients: Client[] = [
  { id: "c-001", name: "동해건설", managerName: "문상현", phone: "02-2000-3101", fax: "", email: "sample1@example.test", email2: "", closingDay: 25, paymentDay: 10, memo: "월 1회 정산" },
  { id: "c-002", name: "새봄산업", managerName: "류정아", phone: "02-2000-3102", fax: "", email: "sample2@example.test", email2: "", closingDay: 30, paymentDay: 15, memo: "현장별 명세 요청" },
  { id: "c-003", name: "한빛개발", managerName: "남기호", phone: "02-2000-3103", fax: "", email: "sample3@example.test", email2: "", closingDay: 20, paymentDay: 5, memo: "세부 비고 확인" }
];

function site(base: Partial<Site> & Pick<Site, "id" | "clientId" | "clientName" | "siteName" | "siteCode" | "defaultUnitPrice" | "defaultDeductionType" | "invoiceIssueType" | "healthInsuranceOutputBasis">): Site {
  return {
    name: base.siteName,
    code: base.siteCode,
    displayName: `${base.clientName}(${base.siteName})`,
    phone: "02-2000-4000",
    fax: "02-2000-4999",
    managerName: "샘플담당",
    managerTitle: "팀장",
    managerPhone: "010-2000-4000",
    closingDay: 25,
    paymentDay: 10,
    settlementEmail1: "settle@example.test",
    settlementEmail2: "field@example.test",
    address: "서울시 샘플구 현장로 00",
    directions: "샘플역 1번 출구에서 도보 이동\n현장 출입구에서 담당자 확인",
    memo: "",
    requiresIdCard: false,
    defaultTaskDescription: "현장 정리 및 작업 보조",
    isActive: true,
    invoiceStatementIssued: Boolean(base.invoiceStatementIssued),
    invoiceStatementIssuedDate: base.invoiceStatementIssuedDate || "",
    taxInvoiceIssued: Boolean(base.taxInvoiceIssued),
    taxInvoiceIssuedDate: base.taxInvoiceIssuedDate || "",
    invoiceDeductionRate: 0.1,
    deductionOutputBasis: "MONTH_FIRST_DAY",
    healthInsuranceBasis: "CLIENT_BASED",
    pensionBasis: "MONTH_FIRST_DAY_AND_AMOUNT",
    pensionOutputBasis: "MONTH_FIRST_DAY",
    firstMonthInsuranceHandling: "APPLY",
    pensionThresholdBase: "LABOR_COST_TOTAL",
    pensionMonthlyThreshold: 2200000,
    carryOverPreviousMonth: false,
    ...base
  };
}

export const sampleSites: Site[] = [
  site({ id: "s-001", clientId: "c-001", clientName: "동해건설", siteName: "마곡 업무시설 A동", siteCode: "DH-MG-A", defaultUnitPrice: 150000, defaultDeductionType: "고용보험", invoiceIssueType: "ISSUED", healthInsuranceOutputBasis: "MONTH_FIRST_DAY", defaultTaskDescription: "철근 운반 및 현장 정리", requiresIdCard: true }),
  site({ id: "s-002", clientId: "c-001", clientName: "동해건설", siteName: "상암 리모델링", siteCode: "DH-SA-R", defaultUnitPrice: 120000, defaultDeductionType: "일반", invoiceIssueType: "NOT_ISSUED", healthInsuranceOutputBasis: "DATE_BASED", defaultTaskDescription: "리모델링 폐기물 정리" }),
  site({ id: "s-003", clientId: "c-002", clientName: "새봄산업", siteName: "부천 물류센터", siteCode: "SB-BC-L", defaultUnitPrice: 150000, defaultDeductionType: "4대보험_60세미만", invoiceIssueType: "ISSUED", healthInsuranceOutputBasis: "FIRST_MONTH_NOT_APPLY", firstMonthInsuranceHandling: "NOT_APPLY", defaultTaskDescription: "물류센터 자재 정리" }),
  site({ id: "s-004", clientId: "c-002", clientName: "새봄산업", siteName: "시흥 공장 증축", siteCode: "SB-SH-F", defaultUnitPrice: 100000, defaultDeductionType: "고용보험", invoiceIssueType: "NOT_ISSUED", healthInsuranceOutputBasis: "MANUAL", healthInsuranceBasis: "MANUAL", pensionOutputBasis: "MANUAL", defaultTaskDescription: "공장 증축 작업 보조", isActive: false }),
  site({ id: "s-005", clientId: "c-003", clientName: "한빛개발", siteName: "구로 지식산업센터", siteCode: "HB-GR-K", defaultUnitPrice: 140000, defaultDeductionType: "4대보험_60세이상", invoiceIssueType: "ISSUED", healthInsuranceOutputBasis: "MONTH_FIRST_DAY", defaultTaskDescription: "내부 마감 보조", carryOverPreviousMonth: true })
];

const rulePrices = [75000, 90000, 100000, 108000, 120000, 126000, 130000, 135000, 140000, 150000];
const ruleTypes: DeductionType[] = ["일반", "고용보험", "4대보험_60세미만", "4대보험_60세이상", "8일차_고용연금", "8일차_건강보험", "기타"];
export const sampleCalculationRules: CalculationRule[] = rulePrices.flatMap((price) =>
  ruleTypes.flatMap((type) =>
    (["NOT_ISSUED", "ISSUED"] as const).flatMap((invoiceIssueType) => [
      createCalculationRule(`r-${price}-${type}-${invoiceIssueType}-all`, price, type, "ALL", "", invoiceIssueType),
      createCalculationRule(`r-${price}-${type}-${invoiceIssueType}-under`, price, type, "UNDER_60", "", invoiceIssueType),
      createCalculationRule(`r-${price}-${type}-${invoiceIssueType}-over`, price, type, "OVER_60", "", invoiceIssueType)
    ])
  )
);
const requestRows: Array<[string, string, string, string, string, number, number, DeductionType, string]> = [
  ["2026-05-28", "2026-05-29", "c-003", "s-005", "전월 연속근로 테스트", 2, 140000, "고용보험", "후문"],
  ["2026-06-01", "2026-06-01", "c-001", "s-001", "철근 운반", 5, 150000, "고용보험", "북문"],
  ["2026-06-02", "2026-06-02", "c-001", "s-001", "현장 정리", 5, 150000, "고용보험", "북문"],
  ["2026-06-03", "2026-06-03", "c-001", "s-001", "자재 정리", 5, 150000, "고용보험", "북문"],
  ["2026-06-04", "2026-06-04", "c-001", "s-002", "폐기물 정리", 4, 120000, "일반", "관리실"],
  ["2026-06-05", "2026-06-05", "c-002", "s-003", "상하차 지원", 4, 150000, "4대보험_60세미만", "정문"],
  ["2026-06-08", "2026-06-08", "c-002", "s-003", "물류센터 자재 정리", 4, 150000, "4대보험_60세미만", "정문"],
  ["2026-06-09", "2026-06-09", "c-003", "s-005", "내부 마감 보조", 4, 140000, "4대보험_60세이상", "후문"],
  ["2026-06-10", "2026-06-10", "c-003", "s-005", "목공 보조", 4, 140000, "고용보험", "후문"],
  ["2026-06-11", "2026-06-11", "c-001", "s-001", "현장 정리", 5, 150000, "8일차_고용연금", "북문"],
  ["2026-06-12", "2026-06-12", "c-001", "s-001", "자재 이동", 5, 150000, "8일차_건강보험", "북문"],
  ["2026-06-15", "2026-06-15", "c-002", "s-004", "공장 증축 보조", 3, 100000, "고용보험", "정문"]
];

export const sampleWorkRequests: WorkRequest[] = requestRows.map((row, index) => ({
  id: `req-${String(index + 1).padStart(3, "0")}`,
  requestDate: row[0],
  workDate: row[1],
  clientId: row[2],
  siteId: row[3],
  taskDescription: row[4],
  requestedCount: row[5],
  unitPrice: row[6],
  deductionType: row[7],
  meetingPlace: row[8],
  memo: index % 4 === 0 ? "샘플 요청" : "",
  status: "배치대기"
}));

const assignmentRows: Array<[string, string, number?]> = [];
sampleWorkRequests.forEach((request, requestIndex) => {
  const count = requestIndex === 11 ? 2 : request.requestedCount;
  for (let i = 0; i < count; i += 1) {
    assignmentRows.push([request.id, sampleWorkers[(requestIndex + i) % sampleWorkers.length].id, 1]);
  }
});

export const sampleAssignments: WorkAssignment[] = assignmentRows.map((row, index) => {
  const request = sampleWorkRequests.find((item) => item.id === row[0]) ?? sampleWorkRequests[0];
  const siteData = sampleSites.find((item) => item.id === request.siteId) ?? sampleSites[0];
  const clientData = sampleClients.find((item) => item.id === request.clientId) ?? sampleClients[0];
  const worker = sampleWorkers.find((item) => item.id === row[1]) ?? sampleWorkers[0];
  return {
    ...calculatePayrollDeduction({
      worker,
      site: siteData,
      client: clientData,
      requestId: request.id,
      workerId: worker.id,
      workDate: request.workDate,
      clientId: request.clientId,
      siteId: request.siteId,
      taskDescription: request.taskDescription,
      unitPrice: request.unitPrice,
      workCount: row[2] ?? 1,
      deductionType: request.deductionType,
      existingAssignments: [],
      calculationRules: sampleCalculationRules
    }),
    id: `as-${String(index + 1).padStart(3, "0")}`
  };
});

export const sampleData: AppData = {
  schemaVersion: SCHEMA_VERSION,
  workers: sampleWorkers,
  clients: sampleClients,
  sites: sampleSites,
  workEntries: [],
  workRequests: normalizeRequestStatuses(sampleWorkRequests, sampleAssignments),
  assignments: sampleAssignments,
  calculationRules: sampleCalculationRules,
  companyInfo: {
    companyName: "주식회사 샘플인력",
    companyAddress: "서울시 샘플구 샘플로 00",
    companyRepresentative: "홍길동",
    businessNumber: "000-00-00000",
    companyPhone: "02-0000-0000",
    bankAccountText: "샘플은행 000-000000-00-000 예금주: 주식회사 샘플인력"
  },
  accessControl: {
    currentRole: "ADMIN",
    currentUser: {
      id: "local-admin",
      email: "local-admin@example.local",
      name: "Local Admin",
      role: "ADMIN",
      organizationId: "local-org",
      lastLoginAt: ""
    },
    sensitiveProtectionEnabled: false,
    menuPermissions: [
      { viewKey: "dashboard", admin: true, user: true, sensitive: false },
      { viewKey: "workers", admin: true, user: true, sensitive: true },
      { viewKey: "clients", admin: true, user: true, sensitive: false },
      { viewKey: "attendance", admin: true, user: true, sensitive: false },
      { viewKey: "settlement", admin: true, user: false, sensitive: true },
      { viewKey: "receivables", admin: true, user: false, sensitive: true },
      { viewKey: "journal", admin: true, user: true, sensitive: true },
      { viewKey: "rules", admin: true, user: false, sensitive: true },
      { viewKey: "settings", admin: true, user: false, sensitive: true },
      { viewKey: "checklist", admin: true, user: true, sensitive: false },
      { viewKey: "productionTest", admin: true, user: false, sensitive: true },
      { viewKey: "help", admin: true, user: true, sensitive: false }
    ]
  },
  cloudSync: {
    mode: "LOCAL_ONLY",
    status: "IDLE",
    lastSyncedAt: "",
    lastError: "",
    storageProvider: "localStorage",
    attachmentProvider: "localStorage",
    localRevision: 0,
    cloudRevision: 0,
    lastCloudCheckedAt: "",
    conflict: false,
    conflictMessage: ""
  },
  receivablePayments: [
    { id: "rp-001", clientId: "c-001", siteId: "s-001", closingMonth: "2026-06", amount: 300000, paymentDate: "2026-06-20", memo: "샘플 부분입금" }
  ]
};
