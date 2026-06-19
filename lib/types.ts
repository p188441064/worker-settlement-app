export type DocumentStatus = "완료" | "일부누락" | "미확인";
export type AgeGroup = "UNDER_60" | "OVER_60" | "ALL";

export type DeductionType =
  | "일반"
  | "고용보험"
  | "4대보험_60세미만"
  | "4대보험_60세이상"
  | "8일차_고용연금"
  | "8일차_건강보험"
  | "기타";

export type InvoiceIssueType = "ISSUED" | "NOT_ISSUED";
export type WorkerDocumentKind = "ID_FRONT" | "ID_BACK" | "SAFETY_CERTIFICATE" | "OTHER";
export type DeductionOutputBasis = "FIRST_OUTPUT" | "MONTH_FIRST_DAY";
export type InsuranceBasis = "CLIENT_BASED" | "SITE_BASED" | "MANUAL";
export type InsuranceOutputBasis = "MONTH_FIRST_DAY" | "DATE_BASED" | "FIRST_MONTH_NOT_APPLY" | "MANUAL";
export type PensionBasis = "MONTH_FIRST_DAY_AND_AMOUNT";
export type FirstMonthInsuranceHandling = "APPLY" | "NOT_APPLY" | "MANUAL";
export type PensionThresholdBase = "LABOR_COST_TOTAL";
export type RequestStatus = "배치대기" | "일부배치" | "배치완료" | "초과배치" | "취소";
export type AssignmentStatus = "배치완료" | "대기" | "취소";

export interface WorkerAttachment {
  id: string;
  workerId: string;
  kind: WorkerDocumentKind;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  dataUrl: string;
  uploadedAt: string;
  storageProvider?: "local" | "supabase";
  storageBucket?: string;
  storagePath?: string;
  publicUrl?: string;
}

export interface Worker {
  id: string;
  workerCode: string;
  name: string;
  birthDate: string;
  ageGroup: Exclude<AgeGroup, "ALL">;
  phone: string;
  landline: string;
  mobile: string;
  residentNumber: string;
  address: string;
  registrationDate: string;
  jobType: string;
  career: string;
  certifications: string;
  documentStatus: DocumentStatus;
  memo: string;
  idCardFrontImage?: string;
  idCardBackImage?: string;
  safetyCertificateImage?: string;
  otherAttachment?: string;
  attachments?: WorkerAttachment[];
  signatureStyle: "STAMP" | "SIGN";
  signatureDataUrl: string;
  isOver60?: boolean;
}

export interface Client {
  id: string;
  name: string;
  managerName: string;
  phone: string;
  fax: string;
  email: string;
  email2: string;
  closingDay: number;
  paymentDay: number;
  memo: string;
}

export interface Site {
  id: string;
  clientId: string;
  name: string;
  code: string;
  siteCode: string;
  clientName: string;
  siteName: string;
  displayName: string;
  phone: string;
  fax: string;
  managerName: string;
  managerTitle: string;
  managerPhone: string;
  closingDay: number;
  paymentDay: number;
  settlementEmail1: string;
  settlementEmail2: string;
  address: string;
  directions: string;
  memo: string;
  requiresIdCard: boolean;
  defaultUnitPrice: number;
  defaultDeductionType: DeductionType;
  defaultTaskDescription: string;
  isActive: boolean;
  invoiceIssueType: InvoiceIssueType;
  invoiceDeductionRate: number;
  deductionOutputBasis: DeductionOutputBasis;
  healthInsuranceBasis: InsuranceBasis;
  healthInsuranceOutputBasis: InsuranceOutputBasis;
  pensionBasis: PensionBasis;
  pensionOutputBasis: InsuranceOutputBasis;
  firstMonthInsuranceHandling: FirstMonthInsuranceHandling;
  pensionThresholdBase: PensionThresholdBase;
  pensionMonthlyThreshold: number;
  carryOverPreviousMonth: boolean;
}

export interface WorkRequest {
  id: string;
  requestDate: string;
  workDate: string;
  clientId: string;
  siteId: string;
  taskDescription: string;
  requestedCount: number;
  unitPrice: number;
  deductionType: DeductionType;
  meetingPlace: string;
  memo: string;
  status: RequestStatus;
}

export interface WorkAssignment {
  id: string;
  requestId: string;
  workerId: string;
  workDate: string;
  clientId: string;
  siteId: string;
  taskDescription: string;
  unitPrice: number;
  deductionBaseAmount: number;
  invoiceIssueType: InvoiceIssueType;
  invoiceDeductionRate: number;
  workCount: number;
  deductionType: DeductionType;
  laborCost: number;
  employmentInsurance: number;
  healthInsurance: number;
  nationalPension: number;
  longTermCare: number;
  deductionAmount: number;
  paymentAmount: number;
  status: AssignmentStatus;
  memo: string;
  appliedRuleLabel: string;
  deductionReason: string;
  healthInsuranceApplied: boolean;
  healthInsuranceReason: string;
  healthInsurancePeriodStart: string;
  healthInsurancePeriodEnd: string;
  healthInsuranceWorkDays: number;
  pensionApplied: boolean;
  pensionReason: string;
  clientBasedWorkDays: number;
  siteBasedWorkDays: number;
  monthlyClientLaborCost: number;
  monthlySiteLaborCost: number;
  isOver60: boolean;
  isManualDeduction: boolean;
  healthInsuranceOutputBasis: InsuranceOutputBasis;
  pensionOutputBasis: InsuranceOutputBasis;
  firstMonthInsuranceHandling: FirstMonthInsuranceHandling;
  pensionThresholdBase: PensionThresholdBase;
  pensionThresholdAmount: number;
  pensionThresholdLaborCost: number;
  isFirstInsuranceMonth: boolean;
  firstMonthInsuranceSkipped: boolean;
  insuranceOutputReason: string;
  manualEmploymentInsurance?: number;
  manualHealthInsurance?: number;
  manualNationalPension?: number;
  manualLongTermCare?: number;
  manualDeductionAmount?: number;
  manualPaymentAmount?: number;
  manualReason?: string;
}

export interface WorkEntry {
  id: string;
  workDate: string;
  clientId: string;
  siteId: string;
  workerId: string;
  unitPrice: number;
  workCount: number;
  deductionType: DeductionType;
  laborCost: number;
  deductionAmount: number;
  paymentAmount: number;
  memo: string;
}

export interface CalculationRule {
  id: string;
  deductionType: DeductionType;
  ageGroup: AgeGroup;
  unitPrice: number;
  brokerageFeeRate: number;
  brokerageFee: number;
  workerBaseAmount: number;
  invoiceIssueType: InvoiceIssueType;
  laborCost: number;
  employmentInsurance: number;
  healthInsurance: number;
  nationalPension: number;
  longTermCare: number;
  deductionAmount: number;
  paymentAmount: number;
  memo: string;
}

export type UserRole = "ADMIN" | "USER";

export interface MenuPermission {
  viewKey: ViewKey;
  admin: boolean;
  user: boolean;
  sensitive?: boolean;
}

export interface AccessControl {
  currentRole: UserRole;
  menuPermissions: MenuPermission[];
  sensitiveProtectionEnabled?: boolean;
}

export interface CompanyInfo {
  companyName: string;
  companyAddress: string;
  companyRepresentative: string;
  businessNumber: string;
  companyPhone: string;
  bankAccountText: string;
}

export interface ReceivablePayment {
  id: string;
  clientId: string;
  siteId: string;
  closingMonth: string;
  amount: number;
  paymentDate: string;
  memo: string;
}

export interface AppData {
  schemaVersion: number;
  workers: Worker[];
  clients: Client[];
  sites: Site[];
  workEntries: WorkEntry[];
  workRequests: WorkRequest[];
  assignments: WorkAssignment[];
  calculationRules: CalculationRule[];
  companyInfo: CompanyInfo;
  accessControl: AccessControl;
  receivablePayments: ReceivablePayment[];
}

export type ViewKey = "dashboard" | "workers" | "clients" | "attendance" | "settlement" | "receivables" | "journal" | "rules" | "settings" | "help";
