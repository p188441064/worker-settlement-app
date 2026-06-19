import {
  AgeGroup,
  CalculationRule,
  DeductionType,
  InvoiceIssueType,
  RequestStatus,
  WorkAssignment,
  WorkEntry,
  WorkRequest
} from "./types";

export const deductionTypes: DeductionType[] = [
  "일반",
  "고용보험",
  "4대보험_60세미만",
  "4대보험_60세이상",
  "8일차_고용연금",
  "8일차_건강보험",
  "기타"
];

export const ageGroups: AgeGroup[] = ["ALL", "UNDER_60", "OVER_60"];

const fallbackRates: Record<DeductionType, { employment: number; health: number; pension: number; care: number }> = {
  일반: { employment: 0, health: 0, pension: 0, care: 0 },
  고용보험: { employment: 0.009, health: 0, pension: 0, care: 0 },
  "4대보험_60세미만": { employment: 0.009, health: 0.03545, pension: 0.045, care: 0.00459 },
  "4대보험_60세이상": { employment: 0.009, health: 0.03545, pension: 0, care: 0.00459 },
  "8일차_고용연금": { employment: 0.009, health: 0, pension: 0.045, care: 0 },
  "8일차_건강보험": { employment: 0.009, health: 0.03545, pension: 0, care: 0.00459 },
  기타: { employment: 0.005, health: 0, pension: 0, care: 0 }
};

export function ceilWon(value: number) {
  return Math.ceil((value || 0) / 10) * 10;
}

export function floorWon(value: number) {
  return Math.floor((value || 0) / 10) * 10;
}

export function getWorkerBaseAmount(unitPrice: number, brokerageFeeRate = 0.1) {
  const brokerageFee = Math.round((unitPrice || 0) * brokerageFeeRate);
  return {
    brokerageFeeRate,
    brokerageFee,
    workerBaseAmount: Math.max(Math.round((unitPrice || 0) - brokerageFee), 0)
  };
}

function getEmploymentRate(deductionType: DeductionType, invoiceIssueType: InvoiceIssueType) {
  if (deductionType === "일반") return 0;
  return invoiceIssueType === "ISSUED" ? 0.009 : 0.01;
}

export function createCalculationRule(
  id: string,
  unitPrice: number,
  deductionType: DeductionType,
  ageGroup: AgeGroup = "ALL",
  memo = "",
  invoiceIssueType: InvoiceIssueType = "NOT_ISSUED",
  brokerageFeeRate = 0.1
): CalculationRule {
  const { brokerageFee, workerBaseAmount } = getWorkerBaseAmount(unitPrice, brokerageFeeRate);
  const rates = fallbackRates[deductionType];
  const laborCost = workerBaseAmount;
  const employmentInsurance = floorWon(workerBaseAmount * getEmploymentRate(deductionType, invoiceIssueType));
  const healthInsurance = floorWon(workerBaseAmount * rates.health);
  const nationalPension = ageGroup === "OVER_60" ? 0 : floorWon(workerBaseAmount * rates.pension);
  const longTermCare = floorWon(workerBaseAmount * rates.care);
  const deductionAmount = employmentInsurance + healthInsurance + nationalPension + longTermCare;

  return {
    id,
    deductionType,
    ageGroup,
    unitPrice,
    brokerageFeeRate,
    brokerageFee,
    workerBaseAmount,
    invoiceIssueType,
    laborCost,
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare,
    deductionAmount,
    paymentAmount: workerBaseAmount - deductionAmount,
    memo
  };
}

export function findCalculationRule(
  rules: CalculationRule[],
  workerBaseAmount: number,
  deductionType: DeductionType,
  ageGroup: AgeGroup,
  invoiceIssueType: InvoiceIssueType
) {
  return (
    rules.find((rule) => (rule.workerBaseAmount ?? rule.laborCost ?? rule.unitPrice) === workerBaseAmount && rule.deductionType === deductionType && rule.ageGroup === ageGroup && (rule.invoiceIssueType ?? "NOT_ISSUED") === invoiceIssueType) ??
    rules.find((rule) => (rule.workerBaseAmount ?? rule.laborCost ?? rule.unitPrice) === workerBaseAmount && rule.deductionType === deductionType && rule.ageGroup === "ALL" && (rule.invoiceIssueType ?? "NOT_ISSUED") === invoiceIssueType) ??
    rules.find((rule) => (rule.workerBaseAmount ?? rule.laborCost ?? rule.unitPrice) === workerBaseAmount && rule.deductionType === deductionType && rule.ageGroup === ageGroup) ??
    rules.find((rule) => (rule.workerBaseAmount ?? rule.laborCost ?? rule.unitPrice) === workerBaseAmount && rule.deductionType === deductionType && rule.ageGroup === "ALL")
  );
}
export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isSameMonth(dateText: string, targetMonth: string) {
  return dateText.slice(0, 7) === targetMonth;
}

export function formatWon(value: number) {
  return `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
}

export function formatNumber(value: number) {
  return Math.round(value || 0).toLocaleString("ko-KR");
}

export function formatDateDot(dateText: string) {
  return dateText ? dateText.replaceAll("-", ".") : "";
}

export function getAgeGroupByWorkDate(birthDate: string, workDate: string): Exclude<AgeGroup, "ALL"> {
  const birth = new Date(birthDate);
  const work = new Date(workDate);
  let age = work.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    work.getMonth() < birth.getMonth() ||
    (work.getMonth() === birth.getMonth() && work.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 60 ? "OVER_60" : "UNDER_60";
}

export function ageGroupLabel(ageGroup: AgeGroup) {
  if (ageGroup === "OVER_60") return "60세 이상";
  if (ageGroup === "UNDER_60") return "60세 미만";
  return "전체";
}

export function getAssignedCount(requestId: string, assignments: WorkAssignment[]) {
  return assignments.filter((assignment) => assignment.requestId === requestId && assignment.status !== "취소").length;
}

export function getRequestStatus(request: WorkRequest, assignments: WorkAssignment[]): RequestStatus {
  if (request.status === "취소") return "취소";
  const assignedCount = getAssignedCount(request.id, assignments);
  if (assignedCount === 0) return "배치대기";
  if (assignedCount < request.requestedCount) return "일부배치";
  if (assignedCount === request.requestedCount) return "배치완료";
  return "초과배치";
}

export function normalizeRequestStatuses(requests: WorkRequest[], assignments: WorkAssignment[]) {
  return requests.map((request) => ({ ...request, status: getRequestStatus(request, assignments) }));
}

export function calculateByRule(
  unitPrice: number,
  workCount: number,
  deductionType: DeductionType,
  rules: CalculationRule[],
  manualDeductionAmount?: number
) {
  const { workerBaseAmount } = getWorkerBaseAmount(unitPrice);
  const laborCost = Math.round(workerBaseAmount * workCount);
  const rule =
    rules.find((item) => (item.workerBaseAmount ?? item.laborCost ?? item.unitPrice) === workerBaseAmount && item.deductionType === deductionType && item.ageGroup === "ALL") ??
    rules.find((item) => (item.workerBaseAmount ?? item.laborCost ?? item.unitPrice) === workerBaseAmount && item.deductionType === deductionType);
  const deductionAmount =
    manualDeductionAmount !== undefined
      ? ceilWon(manualDeductionAmount)
      : rule
        ? floorWon(rule.employmentInsurance * workCount) +
          floorWon(rule.healthInsurance * workCount) +
          floorWon(rule.nationalPension * workCount) +
          floorWon(rule.longTermCare * workCount)
        : 0;
  return {
    laborCost,
    deductionAmount,
    paymentAmount: laborCost - deductionAmount,
    employmentInsurance: rule ? floorWon(rule.employmentInsurance * workCount) : 0,
    healthInsurance: rule ? floorWon(rule.healthInsurance * workCount) : 0,
    nationalPension: rule ? floorWon(rule.nationalPension * workCount) : 0,
    longTermCare: rule ? floorWon(rule.longTermCare * workCount) : 0,
    matchedRule: Boolean(rule)
  };
}

export function withCalculatedWorkEntry(
  input: Omit<WorkEntry, "laborCost" | "deductionAmount" | "paymentAmount">,
  rules: CalculationRule[]
): WorkEntry {
  const calculated = calculateByRule(input.unitPrice, input.workCount, input.deductionType, rules);
  return {
    ...input,
    laborCost: calculated.laborCost,
    deductionAmount: calculated.deductionAmount,
    paymentAmount: calculated.paymentAmount
  };
}

export function withCalculatedAssignment(
  input: Omit<WorkAssignment, "laborCost" | "deductionAmount" | "paymentAmount">,
  rules: CalculationRule[]
): WorkAssignment {
  const calculated = calculateByRule(input.unitPrice, input.workCount, input.deductionType, rules);
  const deductionBaseAmount = input.deductionBaseAmount ?? getWorkerBaseAmount(input.unitPrice, input.invoiceDeductionRate ?? 0.1).workerBaseAmount;
  return {
    ...input,
    deductionBaseAmount,
    invoiceIssueType: input.invoiceIssueType ?? "NOT_ISSUED",
    invoiceDeductionRate: input.invoiceDeductionRate ?? 0.1,
    laborCost: calculated.laborCost,
    employmentInsurance: input.employmentInsurance ?? calculated.employmentInsurance,
    healthInsurance: input.healthInsurance ?? calculated.healthInsurance,
    nationalPension: input.nationalPension ?? calculated.nationalPension,
    longTermCare: input.longTermCare ?? calculated.longTermCare,
    deductionAmount: calculated.deductionAmount,
    paymentAmount: calculated.paymentAmount,
    appliedRuleLabel: input.appliedRuleLabel ?? deductionTypeLabel(input.deductionType),
    deductionReason: input.deductionReason ?? "",
    healthInsuranceApplied: input.healthInsuranceApplied ?? calculated.healthInsurance > 0,
    healthInsuranceReason: input.healthInsuranceReason ?? "",
    healthInsurancePeriodStart: input.healthInsurancePeriodStart ?? input.workDate,
    healthInsurancePeriodEnd: input.healthInsurancePeriodEnd ?? input.workDate,
    healthInsuranceWorkDays: input.healthInsuranceWorkDays ?? 1,
    pensionApplied: input.pensionApplied ?? calculated.nationalPension > 0,
    pensionReason: input.pensionReason ?? "",
    clientBasedWorkDays: input.clientBasedWorkDays ?? 1,
    siteBasedWorkDays: input.siteBasedWorkDays ?? 1,
    monthlyClientLaborCost: input.monthlyClientLaborCost ?? calculated.laborCost,
    monthlySiteLaborCost: input.monthlySiteLaborCost ?? calculated.laborCost,
    isOver60: input.isOver60 ?? false,
    isManualDeduction: input.isManualDeduction ?? false,
    healthInsuranceOutputBasis: input.healthInsuranceOutputBasis ?? "MONTH_FIRST_DAY",
    pensionOutputBasis: input.pensionOutputBasis ?? "MONTH_FIRST_DAY",
    firstMonthInsuranceHandling: input.firstMonthInsuranceHandling ?? "APPLY",
    pensionThresholdBase: input.pensionThresholdBase ?? "LABOR_COST_TOTAL",
    pensionThresholdAmount: input.pensionThresholdAmount ?? 2200000,
    pensionThresholdLaborCost: input.pensionThresholdLaborCost ?? calculated.laborCost,
    isFirstInsuranceMonth: input.isFirstInsuranceMonth ?? false,
    firstMonthInsuranceSkipped: input.firstMonthInsuranceSkipped ?? false,
    insuranceOutputReason: input.insuranceOutputReason ?? ""
  };
}

function deductionTypeLabel(type: DeductionType) {
  return type;
}
