"use client";

import {
  DeductionType,
  InsuranceCalculationBasis,
  IncomeTaxMode,
  Site,
  StatutoryRateTable,
  StatutoryRoundingRule,
  StatutoryWorkerType,
  WorkAssignment,
  Worker
} from "./types";

export interface ApplicableStatutoryRateResult {
  rate?: StatutoryRateTable;
  requestedYear: number;
  sourceYear?: number;
  inherited: boolean;
  message: string;
}

export interface StatutoryDeductionResult {
  employmentInsurance: number;
  healthInsurance: number;
  nationalPension: number;
  longTermCare: number;
  incomeTax: number;
  localIncomeTax: number;
  deductionAmount: number;
  paymentAmount: number;
  applied: boolean;
  requestedYear: number;
  sourceYear?: number;
  inherited: boolean;
  message: string;
  incomeTaxMode?: IncomeTaxMode;
  workerType: StatutoryWorkerType;
  basisSummary: string;
}

export function getApplicableStatutoryRate(
  tables: StatutoryRateTable[],
  year: number,
  workerType: StatutoryWorkerType
): ApplicableStatutoryRateResult {
  const candidates = tables
    .filter((table) => table.workerType === workerType && Number.isFinite(table.effectiveYear))
    .sort((a, b) => b.effectiveYear - a.effectiveYear);
  const exact = candidates.find((table) => table.effectiveYear === year);
  if (exact) {
    return {
      rate: exact,
      requestedYear: year,
      sourceYear: exact.effectiveYear,
      inherited: false,
      message: `${year}년 요율을 적용했습니다.`
    };
  }
  const inherited = candidates.find((table) => table.effectiveYear < year);
  if (inherited) {
    return {
      rate: inherited,
      requestedYear: year,
      sourceYear: inherited.effectiveYear,
      inherited: true,
      message: `${year}년 요율이 없어 ${inherited.effectiveYear}년 요율을 승계 적용했습니다.`
    };
  }
  return {
    requestedYear: year,
    inherited: false,
    message: `${year}년 이전의 ${workerType === "DAILY" ? "일용근로자" : "일반근로자"} 법정 요율이 없어 계산할 수 없습니다.`
  };
}

export function resolveStatutoryWorkerType(worker?: Pick<Worker, "jobType">): StatutoryWorkerType {
  const jobType = worker?.jobType || "";
  return /정규|상용|일반근로|월급|상근/.test(jobType) ? "REGULAR" : "DAILY";
}

export function statutoryWorkerTypeLabel(workerType: StatutoryWorkerType) {
  return workerType === "DAILY" ? "일용근로자" : "일반근로자";
}

export function incomeTaxModeLabel(mode: IncomeTaxMode) {
  return mode === "DAILY_FORMULA" ? "일용근로소득 계산식" : "근로소득 간이세액표";
}

export function insuranceBasisLabel(basis: InsuranceCalculationBasis) {
  if (basis === "DAILY_WAGE") return "일 단가 기준";
  if (basis === "MONTHLY_TOTAL") return "월 보수총액 기준";
  return "기준소득월액 기준";
}

export function roundingRuleLabel(rule: StatutoryRoundingRule) {
  if (rule === "FLOOR_1") return "1원 절사";
  if (rule === "FLOOR_10") return "10원 절사";
  return "반올림";
}

function roundStatutoryAmount(value: number, rule: StatutoryRoundingRule) {
  const safeValue = Number.isFinite(value) ? value : 0;
  if (rule === "FLOOR_1") return Math.floor(safeValue);
  if (rule === "FLOOR_10") return Math.floor(safeValue / 10) * 10;
  return Math.round(safeValue);
}

function sumPrior(assignments: WorkAssignment[], field: keyof Pick<WorkAssignment, "employmentInsurance" | "healthInsurance" | "nationalPension" | "longTermCare" | "incomeTax" | "localIncomeTax">) {
  return assignments.reduce((sum, assignment) => sum + (Number(assignment[field]) || 0), 0);
}

function calculateCumulativeAmount(totalBase: number, rate: number, priorAmount: number, roundingRule: StatutoryRoundingRule) {
  const totalDue = roundStatutoryAmount(Math.max(totalBase, 0) * Math.max(rate, 0), roundingRule);
  return Math.max(totalDue - priorAmount, 0);
}

function calculateInsuranceAmount({
  basis,
  rate,
  dailyBase,
  monthlyBase,
  standardMonthlyBase,
  workCount,
  priorAmount,
  roundingRule
}: {
  basis: InsuranceCalculationBasis;
  rate: number;
  dailyBase: number;
  monthlyBase: number;
  standardMonthlyBase: number;
  workCount: number;
  priorAmount: number;
  roundingRule: StatutoryRoundingRule;
}) {
  if (basis === "DAILY_WAGE") {
    return roundStatutoryAmount(Math.max(dailyBase, 0) * Math.max(workCount, 0) * Math.max(rate, 0), roundingRule);
  }
  if (basis === "STANDARD_MONTHLY_INCOME") {
    return calculateCumulativeAmount(standardMonthlyBase, rate, priorAmount, roundingRule);
  }
  return calculateCumulativeAmount(monthlyBase, rate, priorAmount, roundingRule);
}

function calculateDailyIncomeTax({
  rate,
  dailyBase,
  workCount
}: {
  rate: StatutoryRateTable;
  dailyBase: number;
  workCount: number;
}) {
  const taxableDailyIncome = Math.max(dailyBase - rate.dailyIncomeDeductionAmount, 0);
  const calculatedTax = taxableDailyIncome * rate.dailyIncomeTaxRate;
  const taxCredit = calculatedTax * rate.dailyIncomeTaxCreditRate;
  const dailyIncomeTax = roundStatutoryAmount(Math.max(calculatedTax - taxCredit, 0), rate.roundingRule);
  const collectibleDailyTax = dailyIncomeTax < rate.minimumCollectionTaxAmount ? 0 : dailyIncomeTax;
  return collectibleDailyTax * Math.max(workCount, 0);
}

export function calculateStatutoryDeductions({
  rateTables,
  workDate,
  workerType,
  deductionType,
  deductionBaseAmount,
  laborCost,
  workCount,
  monthlyEmploymentBase,
  monthlyHealthBase,
  monthlyPensionBase,
  standardMonthlyBase,
  priorAssignments,
  healthInsuranceApplied,
  pensionApplied,
  roundingFallback = "FLOOR_10"
}: {
  rateTables: StatutoryRateTable[];
  workDate: string;
  workerType: StatutoryWorkerType;
  deductionType: DeductionType;
  deductionBaseAmount: number;
  laborCost: number;
  workCount: number;
  monthlyEmploymentBase: number;
  monthlyHealthBase: number;
  monthlyPensionBase: number;
  standardMonthlyBase: number;
  priorAssignments: WorkAssignment[];
  healthInsuranceApplied: boolean;
  pensionApplied: boolean;
  roundingFallback?: StatutoryRoundingRule;
}): StatutoryDeductionResult {
  const requestedYear = Number(workDate.slice(0, 4));
  const lookup = getApplicableStatutoryRate(rateTables, requestedYear, workerType);
  if (!lookup.rate) {
    return {
      employmentInsurance: 0,
      healthInsurance: 0,
      nationalPension: 0,
      longTermCare: 0,
      incomeTax: 0,
      localIncomeTax: 0,
      deductionAmount: 0,
      paymentAmount: laborCost,
      applied: false,
      requestedYear,
      inherited: false,
      message: lookup.message,
      workerType,
      basisSummary: ""
    };
  }

  const rate = lookup.rate;
  const roundingRule = rate.roundingRule || roundingFallback;
  const employmentInsurance =
    deductionType === "일반"
      ? 0
      : calculateInsuranceAmount({
          basis: rate.employmentInsuranceBasis,
          rate: rate.employmentInsuranceEmployeeRate,
          dailyBase: deductionBaseAmount,
          monthlyBase: monthlyEmploymentBase,
          standardMonthlyBase,
          workCount,
          priorAmount: sumPrior(priorAssignments, "employmentInsurance"),
          roundingRule
        });
  const healthInsurance = healthInsuranceApplied
    ? calculateInsuranceAmount({
        basis: rate.healthInsuranceBasis,
        rate: rate.healthInsuranceEmployeeRate,
        dailyBase: deductionBaseAmount,
        monthlyBase: monthlyHealthBase,
        standardMonthlyBase,
        workCount,
        priorAmount: sumPrior(priorAssignments, "healthInsurance"),
        roundingRule
      })
    : 0;
  const nationalPension = pensionApplied
    ? calculateInsuranceAmount({
        basis: rate.nationalPensionBasis,
        rate: rate.nationalPensionEmployeeRate,
        dailyBase: deductionBaseAmount,
        monthlyBase: monthlyPensionBase,
        standardMonthlyBase,
        workCount,
        priorAmount: sumPrior(priorAssignments, "nationalPension"),
        roundingRule
      })
    : 0;
  const longTermCare = healthInsuranceApplied ? roundStatutoryAmount(healthInsurance * Math.max(rate.longTermCareRate, 0), roundingRule) : 0;

  let incomeTax = 0;
  let incomeTaxMessage = "";
  if (workerType === "DAILY" && rate.incomeTaxMode === "DAILY_FORMULA") {
    incomeTax = calculateDailyIncomeTax({ rate, dailyBase: deductionBaseAmount, workCount });
  } else {
    incomeTaxMessage = "일반근로자 간이세액표가 아직 연결되지 않아 소득세는 수동 입력 또는 미지원 상태입니다.";
  }
  const localIncomeTax = roundStatutoryAmount(incomeTax * Math.max(rate.localIncomeTaxRate, 0), roundingRule);
  const deductionAmount = employmentInsurance + healthInsurance + nationalPension + longTermCare + incomeTax + localIncomeTax;
  const basisSummary = [
    `고용 ${insuranceBasisLabel(rate.employmentInsuranceBasis)}`,
    `건강 ${insuranceBasisLabel(rate.healthInsuranceBasis)}`,
    `연금 ${insuranceBasisLabel(rate.nationalPensionBasis)}`
  ].join(" · ");

  return {
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare,
    incomeTax,
    localIncomeTax,
    deductionAmount,
    paymentAmount: laborCost - deductionAmount,
    applied: true,
    requestedYear,
    sourceYear: lookup.sourceYear,
    inherited: lookup.inherited,
    message: [lookup.message, incomeTaxMessage].filter(Boolean).join(" "),
    incomeTaxMode: rate.incomeTaxMode,
    workerType,
    basisSummary
  };
}

export function createEmptyStatutoryRateTable(id: string, year: number, workerType: StatutoryWorkerType = "DAILY"): StatutoryRateTable {
  return {
    id,
    effectiveYear: year,
    workerType,
    incomeTaxMode: workerType === "DAILY" ? "DAILY_FORMULA" : "MONTHLY_TABLE",
    dailyIncomeDeductionAmount: 0,
    dailyIncomeTaxRate: 0,
    dailyIncomeTaxCreditRate: 0,
    minimumCollectionTaxAmount: 0,
    localIncomeTaxRate: 0,
    employmentInsuranceEmployeeRate: 0,
    healthInsuranceEmployeeRate: 0,
    nationalPensionEmployeeRate: 0,
    longTermCareRate: 0,
    employmentInsuranceBasis: "DAILY_WAGE",
    healthInsuranceBasis: "MONTHLY_TOTAL",
    nationalPensionBasis: "STANDARD_MONTHLY_INCOME",
    roundingRule: "FLOOR_10",
    effectiveFrom: `${year}-01-01`,
    note: ""
  };
}
