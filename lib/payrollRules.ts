import {
  CalculationRule,
  Client,
  Site,
  WorkAssignment,
  Worker,
  DeductionType
} from "./types";
import { ceilWon, findCalculationRule, floorWon, getAgeGroupByWorkDate, getWorkerBaseAmount, isSameMonth } from "./calculations";

export interface ManualDeductionInput {
  employmentInsurance?: number;
  healthInsurance?: number;
  nationalPension?: number;
  longTermCare?: number;
  deductionAmount?: number;
  paymentAmount?: number;
  manualReason?: string;
}

export interface PayrollDeductionInput {
  worker: Worker;
  site: Site;
  client: Client;
  requestId: string;
  workerId: string;
  workDate: string;
  clientId: string;
  siteId: string;
  taskDescription: string;
  unitPrice: number;
  workCount: number;
  deductionType: DeductionType;
  existingAssignments: WorkAssignment[];
  calculationRules: CalculationRule[];
  manual?: ManualDeductionInput;
}

function dateMonthRange(dateText: string) {
  const [year, month] = dateText.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function distinctDays(assignments: WorkAssignment[]) {
  return new Set(assignments.map((assignment) => assignment.workDate)).size;
}

function sumLabor(assignments: WorkAssignment[]) {
  return assignments.reduce((sum, assignment) => sum + assignment.laborCost, 0);
}

function hasPreviousMonthClientWork(workDate: string, clientId: string, workerId: string, assignments: WorkAssignment[]) {
  const date = new Date(workDate);
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  return assignments.some(
    (assignment) =>
      assignment.workerId === workerId &&
      assignment.clientId === clientId &&
      assignment.status !== "취소" &&
      isSameMonth(assignment.workDate, prevKey)
  );
}

export function getDeductionBaseAmount(site: Site, unitPrice: number) {
  const invoiceDeductionRate = site.invoiceDeductionRate ?? 0.1;
  const { brokerageFee, workerBaseAmount } = getWorkerBaseAmount(unitPrice, invoiceDeductionRate);
  const reason =
    site.invoiceIssueType === "ISSUED"
      ? `전자계산서 발행 기준: 단가 ${unitPrice.toLocaleString("ko-KR")}원에서 알선수수료 ${brokerageFee.toLocaleString("ko-KR")}원을 제외한 근로자 기준금액 ${workerBaseAmount.toLocaleString("ko-KR")}원에 발행 공제표를 적용했습니다.`
      : `전자계산서 미발행 기준: 단가 ${unitPrice.toLocaleString("ko-KR")}원에서 알선수수료 ${brokerageFee.toLocaleString("ko-KR")}원을 제외한 근로자 기준금액 ${workerBaseAmount.toLocaleString("ko-KR")}원에 미발행 공제표를 적용했습니다.`;
  return { deductionBaseAmount: workerBaseAmount, invoiceDeductionRate, brokerageFee, reason };
}
export function calculatePayrollDeduction(input: PayrollDeductionInput): WorkAssignment {
  const {
    worker,
    site,
    requestId,
    workerId,
    workDate,
    clientId,
    siteId,
    taskDescription,
    unitPrice,
    workCount,
    deductionType,
    existingAssignments,
    calculationRules,
    manual
  } = input;
  const ageGroup = getAgeGroupByWorkDate(worker.birthDate, workDate);
  const isOver60 = ageGroup === "OVER_60";
  const { deductionBaseAmount, invoiceDeductionRate, reason: invoiceReason } = getDeductionBaseAmount(site, unitPrice);
  const laborCost = Math.round(deductionBaseAmount * workCount);
  const monthAssignments = existingAssignments.filter(
    (assignment) => assignment.workerId === workerId && assignment.status !== "취소" && isSameMonth(assignment.workDate, workDate.slice(0, 7))
  );
  const clientMonthAssignments = monthAssignments.filter((assignment) => assignment.clientId === clientId);
  const siteMonthAssignments = monthAssignments.filter((assignment) => assignment.siteId === siteId);
  const currentStub = {
    workDate,
    laborCost,
    clientId,
    siteId,
    workerId,
    status: "배치완료"
  } as WorkAssignment;
  const clientBasedWorkDays = distinctDays([...clientMonthAssignments, currentStub]);
  const siteBasedWorkDays = distinctDays([...siteMonthAssignments, currentStub]);
  const monthlyClientLaborCost = sumLabor(clientMonthAssignments) + laborCost;
  const monthlySiteLaborCost = sumLabor(siteMonthAssignments) + laborCost;
  const previousMonthWork = site.carryOverPreviousMonth && hasPreviousMonthClientWork(workDate, clientId, workerId, existingAssignments);
  const isFirstInsuranceMonth = clientMonthAssignments.length === 0 && !previousMonthWork;
  const firstMonthInsuranceSkipped =
    site.firstMonthInsuranceHandling === "NOT_APPLY" ||
    site.healthInsuranceOutputBasis === "FIRST_MONTH_NOT_APPLY" ||
    site.pensionOutputBasis === "FIRST_MONTH_NOT_APPLY";

  const rule = findCalculationRule(calculationRules, deductionBaseAmount, deductionType, ageGroup, site.invoiceIssueType);
  const employmentRate = site.invoiceIssueType === "ISSUED" ? 0.009 : 0.01;
  const baseEmployment = rule?.employmentInsurance ?? floorWon(deductionBaseAmount * employmentRate);
  let employmentInsurance = deductionType === "일반" ? 0 : floorWon(baseEmployment * workCount);

  const healthWorkDays = site.healthInsuranceBasis === "SITE_BASED" ? siteBasedWorkDays : clientBasedWorkDays;
  const healthManual = site.healthInsuranceBasis === "MANUAL" || site.healthInsuranceOutputBasis === "MANUAL";
  let healthInsuranceApplied = !healthManual && healthWorkDays >= 8 && !firstMonthInsuranceSkipped;
  let healthInsurance = healthInsuranceApplied ? floorWon((rule?.healthInsurance ?? 0) * workCount) : 0;
  let healthInsuranceReason = healthManual
    ? "건강보험 기준이 수동이므로 자동 계산은 참고값입니다."
    : firstMonthInsuranceSkipped
      ? "첫달 미부과/비희망 설정으로 건강보험 미적용"
      : healthWorkDays >= 8
        ? `${site.healthInsuranceBasis === "SITE_BASED" ? "현장" : "거래처"} 기준 누적근무일수 ${healthWorkDays}일로 건강보험 적용`
        : `${site.healthInsuranceBasis === "SITE_BASED" ? "현장" : "거래처"} 기준 누적근무일수 ${healthWorkDays}일로 건강보험 미적용`;

  const pensionManual = site.pensionOutputBasis === "MANUAL";
  const pensionThresholdLaborCost =
    site.healthInsuranceBasis === "SITE_BASED" ? monthlySiteLaborCost : monthlyClientLaborCost;
  let pensionApplied =
    !pensionManual &&
    !isOver60 &&
    !firstMonthInsuranceSkipped &&
    clientBasedWorkDays >= 8 &&
    pensionThresholdLaborCost >= site.pensionMonthlyThreshold;
  let nationalPension = pensionApplied ? floorWon((rule?.nationalPension ?? 0) * workCount) : 0;
  let pensionReason = pensionManual
    ? "국민연금 기준이 수동이므로 자동 계산은 참고값입니다."
    : isOver60
      ? "60세 이상으로 국민연금 제외"
      : firstMonthInsuranceSkipped
        ? "첫달 미부과/비희망 설정으로 국민연금 미적용"
        : pensionThresholdLaborCost >= site.pensionMonthlyThreshold
          ? `노무비 총액 ${pensionThresholdLaborCost.toLocaleString("ko-KR")}원이 기준금액 ${site.pensionMonthlyThreshold.toLocaleString("ko-KR")}원 이상으로 국민연금 적용 판단`
          : `노무비 총액 ${pensionThresholdLaborCost.toLocaleString("ko-KR")}원이 기준금액 ${site.pensionMonthlyThreshold.toLocaleString("ko-KR")}원 미만으로 국민연금 미적용`;

  const longTermCare = healthInsuranceApplied ? floorWon((rule?.longTermCare ?? 0) * workCount) : 0;

  if (clientBasedWorkDays <= 7) {
    healthInsuranceApplied = false;
    pensionApplied = false;
    healthInsurance = 0;
    nationalPension = 0;
    healthInsuranceReason = `거래처 기준 누적근무일수 ${clientBasedWorkDays}일로 7일 이하 고용보험만 적용`;
    pensionReason = `거래처 기준 누적근무일수 ${clientBasedWorkDays}일로 국민연금 미적용`;
  }

  const isManualDeduction = Boolean(
    manual &&
      [manual.employmentInsurance, manual.healthInsurance, manual.nationalPension, manual.longTermCare, manual.deductionAmount, manual.paymentAmount].some(
        (value) => value !== undefined && !Number.isNaN(value)
      )
  );
  if (isManualDeduction) {
    employmentInsurance = manual?.employmentInsurance !== undefined ? ceilWon(manual.employmentInsurance) : employmentInsurance;
    healthInsurance = manual?.healthInsurance !== undefined ? ceilWon(manual.healthInsurance) : healthInsurance;
    nationalPension = manual?.nationalPension !== undefined ? ceilWon(manual.nationalPension) : nationalPension;
  }
  const finalLongTermCare = isManualDeduction && manual?.longTermCare !== undefined ? ceilWon(manual.longTermCare) : longTermCare;
  const deductionAmount =
    isManualDeduction && manual?.deductionAmount !== undefined
      ? ceilWon(manual.deductionAmount)
      : employmentInsurance + healthInsurance + nationalPension + finalLongTermCare;
  const paymentAmount =
    isManualDeduction && manual?.paymentAmount !== undefined ? manual.paymentAmount : laborCost - deductionAmount;
  const { start, end } = dateMonthRange(workDate);
  const ruleMissingReason = rule
    ? `${deductionBaseAmount.toLocaleString("ko-KR")}원 계산기준표를 적용했습니다.`
    : "공제기준금액에 해당하는 계산기준이 없습니다. 직접 입력해 주세요.";

  return {
    id: "",
    requestId,
    workerId,
    workDate,
    clientId,
    siteId,
    taskDescription,
    unitPrice,
    deductionBaseAmount,
    invoiceIssueType: site.invoiceIssueType,
    invoiceDeductionRate,
    workCount,
    deductionType,
    laborCost,
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare: finalLongTermCare,
    deductionAmount,
    paymentAmount,
    status: "배치완료",
    memo: "",
    appliedRuleLabel: isManualDeduction ? "수동 수정" : clientBasedWorkDays <= 7 ? "7일 이하 고용보험만 적용" : rule ? deductionType : "계산기준 없음",
    deductionReason: isManualDeduction
      ? `사용자가 공제금액을 직접 수정했습니다. ${manual?.manualReason ?? ""}`
      : `${invoiceReason} ${ruleMissingReason}`,
    healthInsuranceApplied,
    healthInsuranceReason,
    healthInsurancePeriodStart: site.healthInsuranceOutputBasis === "DATE_BASED" ? workDate : start,
    healthInsurancePeriodEnd: end,
    healthInsuranceWorkDays: healthWorkDays,
    pensionApplied,
    pensionReason,
    clientBasedWorkDays,
    siteBasedWorkDays,
    monthlyClientLaborCost,
    monthlySiteLaborCost,
    isOver60,
    isManualDeduction,
    healthInsuranceOutputBasis: site.healthInsuranceOutputBasis,
    pensionOutputBasis: site.pensionOutputBasis,
    firstMonthInsuranceHandling: site.firstMonthInsuranceHandling,
    pensionThresholdBase: site.pensionThresholdBase,
    pensionThresholdAmount: site.pensionMonthlyThreshold,
    pensionThresholdLaborCost,
    isFirstInsuranceMonth,
    firstMonthInsuranceSkipped,
    insuranceOutputReason: previousMonthWork ? "전월 같은 거래처 근무내역을 연속근로로 반영했습니다." : invoiceReason,
    manualEmploymentInsurance: manual?.employmentInsurance,
    manualHealthInsurance: manual?.healthInsurance,
    manualNationalPension: manual?.nationalPension,
    manualLongTermCare: manual?.longTermCare,
    manualDeductionAmount: manual?.deductionAmount,
    manualPaymentAmount: manual?.paymentAmount,
    manualReason: manual?.manualReason
  };
}
