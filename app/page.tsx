"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Badge, Button, DataTable, Field, Panel, SelectInput, StatCard, TextArea, TextInput, td, th } from "@/components/ui";
import { ageGroupLabel, calculateByRule, ceilWon, createCalculationRule, deductionTypes, getWorkerBaseAmount, formatDateDot, formatNumber, formatWon, getAgeGroupByWorkDate, getAssignedCount, getRequestStatus, isSameMonth, monthKey, normalizeRequestStatuses, withCalculatedAssignment } from "@/lib/calculations";
import { clearAppData, loadAppData, migrateAppData, resetAppData, saveAppData, createId } from "@/lib/storage";
import { createWorkerAttachmentFromFile, deleteWorkerAttachmentStorage, downloadAttachmentsZip, downloadDataUrl, downloadWorkerAttachment, downloadWorkerAttachments, getWorkerAttachment, getWorkerDocumentDataUrl, removeWorkerAttachment, upsertWorkerAttachment, workerDocumentLabels } from "@/lib/worker-documents";
import { AppData, AssignmentStatus, CalculationRule, Client, DeductionType, DocumentStatus, RequestStatus, Site, UserRole, ViewKey, WorkAssignment, WorkRequest, Worker, WorkerAttachment, WorkerDocumentKind } from "@/lib/types";
import { calculatePayrollDeduction } from "@/lib/payrollRules";

const menus: Array<{ key: ViewKey; label: string }> = [
  { key: "dashboard", label: "대시보드" },
  { key: "workers", label: "근로자 관리" },
  { key: "clients", label: "거래현장 관리" },
  { key: "attendance", label: "요청·배치 입력" },
  { key: "settlement", label: "월말 정산" },
  { key: "receivables", label: "전체 미수금 관리" },
  { key: "journal", label: "근로자 개인일지" },
  { key: "rules", label: "계산기준 관리" },
  { key: "settings", label: "설정" },
  { key: "checklist", label: "운영 체크리스트" },
  { key: "help", label: "도움말" }
];

const roleLabels: Record<UserRole, string> = {
  ADMIN: "관리자",
  USER: "일반사용자"
};

function canAccessMenu(data: AppData, viewKey: ViewKey) {
  const role = data.accessControl?.currentRole || "ADMIN";
  const permission = data.accessControl?.menuPermissions.find((item) => item.viewKey === viewKey);
  if (role !== "ADMIN" && data.accessControl?.sensitiveProtectionEnabled && permission?.sensitive) return false;
  return role === "ADMIN" ? permission?.admin !== false : Boolean(permission?.user);
}

const today = "2026-06-19";
const currentMonth = monthKey(new Date());

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const emptyWorker: Worker = {
  id: "",
  workerCode: "",
  name: "",
  birthDate: "1980-01-01",
  ageGroup: "UNDER_60",
  phone: "",
  landline: "",
  mobile: "",
  residentNumber: "",
  address: "",
  registrationDate: today,
  jobType: "",
  career: "",
  certifications: "",
  isOver60: false,
  documentStatus: "미확인",
  memo: "",
  signatureStyle: "STAMP",
  signatureDataUrl: "",
  attachments: []
};

const emptyClient: Client = {
  id: "",
  name: "",
  managerName: "",
  phone: "",
  fax: "",
  email: "",
  email2: "",
  closingDay: 25,
  paymentDay: 10,
  memo: ""
};

const emptySite: Site = {
  id: "",
  clientId: "",
  name: "",
  code: "",
  siteCode: "",
  clientName: "",
  siteName: "",
  displayName: "",
  phone: "",
  fax: "",
  managerName: "",
  managerTitle: "",
  managerPhone: "",
  closingDay: 25,
  paymentDay: 10,
  settlementEmail1: "",
  settlementEmail2: "",
  address: "",
  directions: "",
  memo: "",
  requiresIdCard: false,
  defaultTaskDescription: "",
  defaultUnitPrice: 150000,
  defaultDeductionType: "고용보험",
  invoiceIssueType: "ISSUED",
  invoiceDeductionRate: 0.1,
  deductionOutputBasis: "MONTH_FIRST_DAY",
  healthInsuranceBasis: "CLIENT_BASED",
  healthInsuranceOutputBasis: "MONTH_FIRST_DAY",
  pensionBasis: "MONTH_FIRST_DAY_AND_AMOUNT",
  pensionOutputBasis: "MONTH_FIRST_DAY",
  firstMonthInsuranceHandling: "APPLY",
  pensionThresholdBase: "LABOR_COST_TOTAL",
  pensionMonthlyThreshold: 2200000,
  carryOverPreviousMonth: false,
  isActive: true
};

const emptyRule: CalculationRule = createCalculationRule("", 150000, "고용보험");

function hydrateSite(site: Site, clients: Client[]): Site {
  const client = clients.find((item) => item.id === site.clientId);
  const clientName = site.clientName || client?.name || "";
  const siteName = site.siteName || site.name || "";
  return {
    ...emptySite,
    ...site,
    siteCode: site.siteCode || site.code || "",
    clientName,
    siteName,
    displayName: site.displayName || (clientName && siteName ? `${clientName}(${siteName})` : clientName || siteName),
    phone: site.phone || client?.phone || "",
    managerName: site.managerName || client?.managerName || "",
    closingDay: site.closingDay || client?.closingDay || 25,
    paymentDay: site.paymentDay || client?.paymentDay || 10,
    settlementEmail1: site.settlementEmail1 || client?.email || "",
    defaultTaskDescription: site.defaultTaskDescription || "",
    name: siteName,
    code: site.siteCode || site.code || ""
  };
}

function docTone(status: DocumentStatus) {
  if (status === "완료") return "mint";
  if (status === "일부누락") return "amber";
  return "rose";
}

function calculateAge(birthDate: string, atDate = today) {
  const birth = new Date(birthDate);
  const at = new Date(atDate);
  let age = at.getFullYear() - birth.getFullYear();
  const beforeBirthday = at.getMonth() < birth.getMonth() || (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  return beforeBirthday ? age - 1 : age;
}

function birthDateFromResidentNumber(value: string) {
  const numbers = value.replace(/[^0-9]/g, "");
  if (numbers.length < 7) return "";
  const yy = Number(numbers.slice(0, 2));
  const mm = numbers.slice(2, 4);
  const dd = numbers.slice(4, 6);
  const centuryCode = numbers[6];
  const century = ["1", "2", "5", "6"].includes(centuryCode) ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

function createSignatureDataUrl(name: string, style: "STAMP" | "SIGN") {
  const svg =
    style === "STAMP"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="white"/><circle cx="60" cy="60" r="48" fill="none" stroke="#b91c1c" stroke-width="6"/><text x="60" y="70" text-anchor="middle" font-size="28" font-family="serif" fill="#b91c1c">${name || "성명"}</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="white"/><path d="M12 55 C45 15, 80 75, 120 35 S160 45, 170 25" fill="none" stroke="#0b2537" stroke-width="4"/><text x="90" y="48" text-anchor="middle" font-size="24" font-family="cursive" fill="#0b2537">${name || "성명"}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getWorkerDocumentStatus(worker: Worker): DocumentStatus {
  const count = [
    getWorkerDocumentDataUrl(worker, "ID_FRONT"),
    getWorkerDocumentDataUrl(worker, "ID_BACK"),
    getWorkerDocumentDataUrl(worker, "SAFETY_CERTIFICATE")
  ].filter(Boolean).length;
  if (count === 3) return "완료";
  if (count > 0) return "일부누락";
  return "미확인";
}

function getWorkerWorkSummary(workerId: string, data: AppData) {
  const assignments = data.assignments
    .filter((assignment) => assignment.workerId === workerId && assignment.status !== "취소")
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
  const displayAssignments = assignments.map((assignment) => getDisplayAssignment(assignment, data));
  const recentAssignment = displayAssignments[0];
  const recentSite = recentAssignment ? data.sites.find((site) => site.id === recentAssignment.siteId) : undefined;
  return {
    assignments: displayAssignments,
    totalWorkDays: new Set(assignments.map((assignment) => assignment.workDate)).size,
    totalWorkCount: assignments.reduce((sum, assignment) => sum + assignment.workCount, 0),
    totalPaymentAmount: displayAssignments.reduce((sum, assignment) => sum + assignment.paymentAmount, 0),
    recentWorkDate: recentAssignment?.workDate || "",
    recentSiteName: recentSite?.siteName || recentSite?.name || "-"
  };
}

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  useEffect(() => {
    setData(loadAppData());
  }, []);

  useEffect(() => {
    if (data) saveAppData(data);
  }, [data]);

  if (!data) {
    return <main className="grid min-h-screen place-items-center bg-navy-50 text-navy-900">앱 데이터를 준비하고 있습니다.</main>;
  }

  const updateData = (next: AppData) => setData(next);
  const permittedMenus = menus.filter((menu) => canAccessMenu(data, menu.key));

  const changeRole = (role: UserRole) => {
    const accessControl = data.accessControl;
    const firstMenu = menus.find((menu) => canAccessMenu({ ...data, accessControl: { ...accessControl, currentRole: role } }, menu.key));
    setData({ ...data, accessControl: { ...accessControl, currentRole: role } });
    if (firstMenu && !canAccessMenu({ ...data, accessControl: { ...accessControl, currentRole: role } }, view)) setView(firstMenu.key);
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `출역노임정산_백업_${selectedMonth}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = migrateAppData(JSON.parse(String(reader.result)) as Partial<AppData>);
        setData(imported);
        alert("JSON 백업 데이터를 불러왔습니다.");
      } catch {
        alert("JSON 형식을 확인해 주세요.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const clearLocalStorage = () => {
    if (!confirm("브라우저에 저장된 데이터를 초기화할까요? 현재 화면은 샘플 데이터로 다시 불러옵니다.")) return;
    clearAppData();
    setData(loadAppData());
  };

  const createSampleData = () => {
    if (!confirm("현재 데이터를 샘플 데이터로 교체할까요? 필요하면 먼저 JSON 백업을 다운로드해 주세요.")) return;
    setData(resetAppData());
  };

  return (
    <main className="flex min-h-screen flex-col bg-navy-50 lg:flex-row">
      <aside className="w-full shrink-0 bg-navy-900 p-4 text-white lg:w-64 lg:p-5">
        <div className="mb-4 lg:mb-8">
          <p className="text-xs font-semibold text-mint-100">내부 업무용 MVP</p>
          <h1 className="mt-2 text-xl font-bold leading-tight">출역·노임 정산 도우미</h1>
        </div>
        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
          {permittedMenus.map((menu) => (
            <button
              key={menu.key}
              onClick={() => setView(menu.key)}
              className={`rounded-md px-3 py-2 text-left text-xs font-semibold transition sm:text-sm lg:px-4 lg:py-3 ${
                view === menu.key ? "bg-mint-500 text-navy-900" : "text-navy-100 hover:bg-navy-800"
              }`}
            >
              {menu.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex flex-col gap-3 border-b border-navy-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:h-20 lg:px-8 lg:py-0">
          <div>
            <p className="text-sm font-semibold text-slate-500">현재 월 · {roleLabels[data.accessControl?.currentRole || "ADMIN"]}</p>
            <p className="text-xl font-bold text-navy-900">{selectedMonth}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput value={data.accessControl?.currentRole || "ADMIN"} onChange={(event) => changeRole(event.target.value as UserRole)} className="w-32">
              <option value="ADMIN">관리자</option>
              <option value="USER">일반사용자</option>
            </SelectInput>
            <input
              type="file"
              accept="application/json"
              onChange={importJson}
              className="hidden"
              id="json-import"
            />
            <label htmlFor="json-import" className="flex min-h-11 cursor-pointer items-center rounded-md border border-navy-100 bg-white px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50 sm:min-h-10 sm:px-3">
              JSON 불러오기
            </label>
            <Button variant="secondary" onClick={downloadJson}>JSON 백업</Button>
            <Button variant="secondary" onClick={createSampleData}>샘플 데이터 생성</Button>
            <Button variant="danger" onClick={clearLocalStorage}>localStorage 초기화</Button>
          </div>
        </header>

        <div className="space-y-5 p-4 lg:p-8">
          {view === "dashboard" && <Dashboard data={data} selectedMonth={selectedMonth} />}
          {view === "workers" && <WorkersView data={data} updateData={updateData} />}
          {view === "clients" && <ClientsSitesView data={data} updateData={updateData} />}
          {view === "attendance" && <AttendanceView data={data} updateData={updateData} />}
          {view === "settlement" && <SettlementView data={data} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />}
          {view === "receivables" && <ReceivablesView data={data} updateData={updateData} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />}
          {view === "journal" && <WorkerJournalView data={data} />}
          {view === "rules" && <RulesView data={data} updateData={updateData} />}
          {view === "settings" && <SettingsView data={data} updateData={updateData} />}
          {view === "checklist" && <OperationChecklistView data={data} selectedMonth={selectedMonth} />}
          {view === "help" && <HelpView />}
        </div>
      </section>
    </main>
  );
}

function Dashboard({ data, selectedMonth }: { data: AppData; selectedMonth: string }) {
  const requests = normalizeRequestStatuses(data.workRequests, data.assignments);
  const todayRequests = requests.filter((request) => request.workDate === today);
  const todayAssignments = data.assignments.filter((assignment) => assignment.workDate === today && assignment.status !== "취소");
  const monthRequests = requests.filter((request) => isSameMonth(request.workDate, selectedMonth));
  const monthAssignments = data.assignments.filter((assignment) => isSameMonth(assignment.workDate, selectedMonth) && assignment.status !== "취소");
  const todayRequestedCount = todayRequests.reduce((sum, request) => sum + request.requestedCount, 0);
  const todayAssignedCount = todayAssignments.length;
  const shortageToday = todayRequests.reduce((sum, request) => {
    const assigned = getAssignedCount(request.id, data.assignments);
    return sum + Math.max(request.requestedCount - assigned, 0);
  }, 0);
  const monthShortageCount = monthRequests.reduce((sum, request) => {
    const assigned = getAssignedCount(request.id, data.assignments);
    return sum + Math.max(request.requestedCount - assigned, 0);
  }, 0);
  const monthRequestedCount = monthRequests.reduce((sum, request) => sum + request.requestedCount, 0);
  const monthAssignedCount = monthAssignments.length;
  const missingDocumentWorkers = data.workers.filter((worker) => getWorkerDocumentStatus(worker) !== "완료");
  const receivableRows = buildReceivableRows(data, selectedMonth);
  const totalClaim = receivableRows.reduce((sum, row) => sum + row.claimAmount, 0);
  const totalPaid = receivableRows.reduce((sum, row) => sum + row.paidAmount, 0);
  const totalReceivable = receivableRows.reduce((sum, row) => sum + row.balanceAmount, 0);
  const paymentDueRows = receivableRows.filter((row) => row.balanceAmount > 0 && row.expectedPaymentDate >= today);
  const paymentDueAmount = paymentDueRows.reduce((sum, row) => sum + row.balanceAmount, 0);
  const overdueRows = receivableRows.filter((row) => row.balanceAmount > 0 && row.overdueDays > 0);
  const closingWindowEnd = new Date(`${today}T00:00:00`);
  closingWindowEnd.setDate(closingWindowEnd.getDate() + 7);
  const [closingYear, closingMonth] = selectedMonth.split("-").map(Number);
  const closingDueSites = data.sites
    .map((site) => {
      const lastDay = new Date(closingYear, closingMonth, 0).getDate();
      const closingDate = `${selectedMonth}-${String(Math.min(site.closingDay || 25, lastDay)).padStart(2, "0")}`;
      const closingAt = new Date(`${closingDate}T00:00:00`);
      const assignmentCount = monthAssignments.filter((assignment) => assignment.siteId === site.id).length;
      return { site, closingDate, closingAt, assignmentCount };
    })
    .filter((item) => item.assignmentCount > 0 && item.closingDate >= today && item.closingAt <= closingWindowEnd)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const recentRequests = [...requests].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.requestDate.localeCompare(a.requestDate)).slice(0, 8);
  const recentAssignments = [...data.assignments]
    .filter((assignment) => assignment.status !== "취소")
    .sort((a, b) => b.workDate.localeCompare(a.workDate))
    .slice(0, 8);
  const settlementRows = receivableRows
    .filter((row) => row.claimAmount > 0 || row.balanceAmount > 0)
    .sort((a, b) => a.expectedPaymentDate.localeCompare(b.expectedPaymentDate))
    .slice(0, 8);
  const topReceivableClients = data.clients
    .map((client) => {
      const clientRows = receivableRows.filter((row) => row.clientId === client.id);
      return {
        client,
        claim: clientRows.reduce((sum, row) => sum + row.claimAmount, 0),
        paid: clientRows.reduce((sum, row) => sum + row.paidAmount, 0),
        balance: clientRows.reduce((sum, row) => sum + row.balanceAmount, 0),
        overdue: clientRows.reduce((sum, row) => sum + (row.overdueDays > 0 ? row.balanceAmount : 0), 0)
      };
    })
    .filter((item) => item.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);
  const alertWindowEnd = dateKey(closingWindowEnd);
  const paymentAlertRows = paymentDueRows.filter((row) => row.expectedPaymentDate <= alertWindowEnd);
  const operationAlerts = [
    {
      title: "결제예정일 알림",
      count: paymentAlertRows.length,
      tone: paymentAlertRows.length > 0 ? "amber" : "mint",
      summary: paymentAlertRows.length > 0 ? `${paymentAlertRows.length}건 / ${formatWon(paymentAlertRows.reduce((sum, row) => sum + row.balanceAmount, 0))}` : "7일 내 결제예정 없음",
      detail: paymentAlertRows[0] ? `${paymentAlertRows[0].clientName} · ${paymentAlertRows[0].expectedPaymentDate}` : "입금 예정 항목이 안정적입니다."
    },
    {
      title: "마감예정일 알림",
      count: closingDueSites.length,
      tone: closingDueSites.length > 0 ? "amber" : "mint",
      summary: closingDueSites.length > 0 ? `7일 내 ${closingDueSites.length}건` : "7일 내 마감 없음",
      detail: closingDueSites[0] ? `${closingDueSites[0].site.siteName || closingDueSites[0].site.name} · ${closingDueSites[0].closingDate}` : "마감 예정 현장이 없습니다."
    },
    {
      title: "서류 미비 알림",
      count: missingDocumentWorkers.length,
      tone: missingDocumentWorkers.length > 0 ? "amber" : "mint",
      summary: missingDocumentWorkers.length > 0 ? `${missingDocumentWorkers.length}명 확인 필요` : "서류 미비 없음",
      detail: missingDocumentWorkers[0] ? `${missingDocumentWorkers[0].name} 외 ${Math.max(missingDocumentWorkers.length - 1, 0)}명` : "필수 서류 상태가 안정적입니다."
    },
    {
      title: "미수금 연체 알림",
      count: overdueRows.length,
      tone: overdueRows.length > 0 ? "rose" : "mint",
      summary: overdueRows.length > 0 ? `${overdueRows.length}건 / ${formatWon(overdueRows.reduce((sum, row) => sum + row.balanceAmount, 0))}` : "연체 미수금 없음",
      detail: overdueRows[0] ? `${overdueRows[0].clientName} · ${overdueRows[0].overdueDays}일 연체` : "연체 항목이 없습니다."
    }
  ] as const;

  return (
    <>
      <Panel title="운영 알림">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {operationAlerts.map((alert) => (
            <article key={alert.title} className="rounded-md border border-navy-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-black text-navy-900">{alert.title}</h3>
                <Badge tone={alert.tone}>{alert.count > 0 ? "확인필요" : "정상"}</Badge>
              </div>
              <p className="mt-3 text-lg font-black text-navy-900">{alert.summary}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{alert.detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="오늘 요청인원" value={`${todayRequestedCount}명`} />
        <StatCard label="오늘 배치인원" value={`${todayAssignedCount}명`} tone="mint" />
        <StatCard label="부족인원" value={`${shortageToday}명`} />
        <StatCard label="서류 미비 근로자" value={`${missingDocumentWorkers.length}명`} />
        <StatCard label="미수금 합계" value={formatWon(totalReceivable)} />
        <StatCard label="결제 예정 금액" value={formatWon(paymentDueAmount)} tone="mint" />
        <StatCard label="마감 예정 현장" value={`${closingDueSites.length}건`} />
        <StatCard label="월 부족인원" value={`${monthShortageCount}명`} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="월 요청인원" value={`${monthRequestedCount}명`} />
        <StatCard label="월 배치인원" value={`${monthAssignedCount}명`} tone="mint" />
        <StatCard label="월 청구금액" value={formatWon(totalClaim)} />
        <StatCard label="월 입금금액" value={formatWon(totalPaid)} tone="mint" />
      </div>

      <Panel title="마감 예정 현장">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["마감일", "거래처", "현장", "배치인원", "계산서"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
            <tbody>
              {closingDueSites.map((item) => (
                <tr key={item.site.id}>
                  <td className={td}>{item.closingDate}</td>
                  <td className={td}>{data.clients.find((client) => client.id === item.site.clientId)?.name}</td>
                  <td className={td}>{item.site.siteName || item.site.name}</td>
                  <td className={td}>{item.assignmentCount}명</td>
                  <td className={td}>{item.site.invoiceIssueType === "ISSUED" ? "발행" : "미발행"}</td>
                </tr>
              ))}
              {closingDueSites.length === 0 && <tr><td className={td} colSpan={5}>7일 내 마감 예정 현장이 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="거래처별 미수금 상위 5건">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["거래처", "청구금액", "입금금액", "미수금액", "연체금액"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
            <tbody>
              {topReceivableClients.map((item) => (
                <tr key={item.client.id}>
                  <td className={td}>{item.client.name}</td>
                  <td className={td}>{formatWon(item.claim)}</td>
                  <td className={td}>{formatWon(item.paid)}</td>
                  <td className={td}>{formatWon(item.balance)}</td>
                  <td className={td}>{formatWon(item.overdue)}</td>
                </tr>
              ))}
              {topReceivableClients.length === 0 && <tr><td className={td} colSpan={5}>현재 월 미수금이 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="최근 배치/정산 현황">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DataTable>
            <table className="w-full border-collapse">
              <thead><tr>{["근무일", "거래처", "현장", "근로자", "지급액"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
              <tbody>
                {recentAssignments.map((assignment) => {
                  const display = getDisplayAssignment(assignment, data);
                  return (
                    <tr key={assignment.id}>
                      <td className={td}>{display.workDate}</td>
                      <td className={td}>{data.clients.find((client) => client.id === display.clientId)?.name}</td>
                      <td className={td}>{data.sites.find((site) => site.id === display.siteId)?.siteName || data.sites.find((site) => site.id === display.siteId)?.name}</td>
                      <td className={td}>{data.workers.find((worker) => worker.id === display.workerId)?.name}</td>
                      <td className={td}>{formatWon(display.paymentAmount)}</td>
                    </tr>
                  );
                })}
                {recentAssignments.length === 0 && <tr><td className={td} colSpan={5}>최근 배치 내역이 없습니다.</td></tr>}
              </tbody>
            </table>
          </DataTable>
          <DataTable>
            <table className="w-full border-collapse">
              <thead><tr>{["결제예정일", "거래처", "현장", "미수금액", "상태"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
              <tbody>
                {settlementRows.map((row) => (
                  <tr key={row.key}>
                    <td className={td}>{row.expectedPaymentDate}</td>
                    <td className={td}>{row.clientName}</td>
                    <td className={td}>{row.siteName}</td>
                    <td className={td}>{formatWon(row.balanceAmount)}</td>
                    <td className={td}><ReceivableStatusBadge status={row.status} /></td>
                  </tr>
                ))}
                {settlementRows.length === 0 && <tr><td className={td} colSpan={5}>정산/결제 예정 내역이 없습니다.</td></tr>}
              </tbody>
            </table>
          </DataTable>
        </div>
      </Panel>

      <Panel title="최근 요청건 8건">
        <RequestTable requests={recentRequests} data={data} />
      </Panel>

      <Panel title="오늘 배치 현황표">
        <AssignmentTable assignments={todayAssignments} data={data} />
      </Panel>
    </>
  );
}

function OperationChecklistView({ data, selectedMonth }: { data: AppData; selectedMonth: string }) {
  const requests = normalizeRequestStatuses(data.workRequests, data.assignments);
  const todayRequests = requests.filter((request) => request.workDate === today);
  const todayRequestedCount = todayRequests.reduce((sum, request) => sum + request.requestedCount, 0);
  const todayAssignedCount = data.assignments.filter((assignment) => assignment.workDate === today && assignment.status !== "취소").length;
  const todayShortageCount = todayRequests.reduce((sum, request) => sum + Math.max(request.requestedCount - getAssignedCount(request.id, data.assignments), 0), 0);
  const missingDocumentWorkers = data.workers.filter((worker) => getWorkerDocumentStatus(worker) !== "완료");
  const receivableRows = buildReceivableRows(data, selectedMonth);
  const totalReceivable = receivableRows.reduce((sum, row) => sum + row.balanceAmount, 0);
  const paymentDueRows = receivableRows.filter((row) => row.balanceAmount > 0 && row.expectedPaymentDate >= today).sort((a, b) => a.expectedPaymentDate.localeCompare(b.expectedPaymentDate));
  const overdueRows = receivableRows.filter((row) => row.balanceAmount > 0 && row.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
  const closingWindowEnd = new Date(`${today}T00:00:00`);
  closingWindowEnd.setDate(closingWindowEnd.getDate() + 7);
  const [closingYear, closingMonth] = selectedMonth.split("-").map(Number);
  const monthAssignments = data.assignments.filter((assignment) => isSameMonth(assignment.workDate, selectedMonth) && assignment.status !== "취소");
  const closingDueSites = data.sites
    .map((site) => {
      const lastDay = new Date(closingYear, closingMonth, 0).getDate();
      const closingDate = `${selectedMonth}-${String(Math.min(site.closingDay || 25, lastDay)).padStart(2, "0")}`;
      const closingAt = new Date(`${closingDate}T00:00:00`);
      const assignmentCount = monthAssignments.filter((assignment) => assignment.siteId === site.id).length;
      return { site, closingDate, closingAt, assignmentCount };
    })
    .filter((item) => item.assignmentCount > 0 && item.closingDate >= today && item.closingAt <= closingWindowEnd)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));

  const checklistItems = [
    {
      title: "오늘 요청/배치 확인",
      status: todayShortageCount > 0 ? "확인필요" : "정상",
      tone: todayShortageCount > 0 ? "amber" : "mint",
      summary: `요청 ${todayRequestedCount}명 / 배치 ${todayAssignedCount}명 / 부족 ${todayShortageCount}명`,
      action: todayShortageCount > 0 ? "요청·배치 입력에서 부족인원을 보강하세요." : "오늘 요청 대비 배치가 안정적입니다."
    },
    {
      title: "서류 미비 근로자",
      status: missingDocumentWorkers.length > 0 ? "확인필요" : "정상",
      tone: missingDocumentWorkers.length > 0 ? "amber" : "mint",
      summary: `${missingDocumentWorkers.length}명`,
      action: missingDocumentWorkers.length > 0 ? "근로자 관리에서 신분증/이수증 업로드 상태를 확인하세요." : "필수 서류 미비 근로자가 없습니다."
    },
    {
      title: "미수금/결제예정",
      status: totalReceivable > 0 ? "확인필요" : "정상",
      tone: totalReceivable > 0 ? "amber" : "mint",
      summary: `${formatWon(totalReceivable)} / 결제예정 ${paymentDueRows.length}건`,
      action: totalReceivable > 0 ? "전체 미수금 관리에서 입금/부분입금/완납 상태를 업데이트하세요." : "현재 미수금이 없습니다."
    },
    {
      title: "마감 예정 현장",
      status: closingDueSites.length > 0 ? "확인필요" : "정상",
      tone: closingDueSites.length > 0 ? "amber" : "mint",
      summary: `7일 내 ${closingDueSites.length}건`,
      action: closingDueSites.length > 0 ? "월말 정산에서 거래명세서와 지급명세서를 미리 확인하세요." : "7일 내 마감 예정 현장이 없습니다."
    },
    {
      title: "백업 필요 알림",
      status: "권장",
      tone: "slate",
      summary: "오늘 업무 전/후 JSON 백업 권장",
      action: "상단 JSON 백업 버튼으로 운영 데이터를 내려받아 보관하세요."
    }
  ] as const;

  return (
    <div className="space-y-5">
      <Panel title="오늘 운영 체크리스트">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {checklistItems.map((item) => (
            <article key={item.title} className="rounded-md border border-navy-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-black text-navy-900">{item.title}</h3>
                <Badge tone={item.tone}>{item.status}</Badge>
              </div>
              <p className="mt-3 text-lg font-black text-navy-900">{item.summary}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.action}</p>
            </article>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="서류 미비 근로자 확인">
          <div className="grid gap-2">
            {missingDocumentWorkers.slice(0, 8).map((worker) => (
              <div key={worker.id} className="rounded-md border border-navy-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{worker.name}</b>
                  <Badge tone={docTone(getWorkerDocumentStatus(worker))}>{getWorkerDocumentStatus(worker)}</Badge>
                </div>
                <p className="mt-1 text-slate-500">{worker.mobile || worker.phone} / {worker.jobType || "직종 미입력"}</p>
              </div>
            ))}
            {missingDocumentWorkers.length === 0 && <p className="rounded-md bg-mint-50 p-3 text-sm font-bold text-mint-600">서류 미비 근로자가 없습니다.</p>}
          </div>
        </Panel>

        <Panel title="미수금/결제예정 확인">
          <div className="grid gap-2">
            {[...overdueRows, ...paymentDueRows].slice(0, 8).map((row) => (
              <div key={row.key} className="rounded-md border border-navy-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{row.clientName}</b>
                  <ReceivableStatusBadge status={row.status} />
                </div>
                <p className="mt-1 text-slate-600">{row.siteName} / 미수 {formatWon(row.balanceAmount)}</p>
                <p className="text-slate-500">결제예정일 {row.expectedPaymentDate} / 연체 {row.overdueDays}일</p>
              </div>
            ))}
            {overdueRows.length + paymentDueRows.length === 0 && <p className="rounded-md bg-mint-50 p-3 text-sm font-bold text-mint-600">확인할 미수금/결제예정 항목이 없습니다.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="마감 예정 현장">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {closingDueSites.map((item) => (
            <article key={item.site.id} className="rounded-md border border-navy-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>{item.site.siteName || item.site.name}</b>
                <Badge tone="amber">{item.closingDate}</Badge>
              </div>
              <p className="mt-2 text-slate-600">{data.clients.find((client) => client.id === item.site.clientId)?.name}</p>
              <p className="text-slate-500">배치 {item.assignmentCount}건 / 계산서 {item.site.invoiceIssueType === "ISSUED" ? "발행" : "미발행"}</p>
            </article>
          ))}
          {closingDueSites.length === 0 && <p className="rounded-md bg-mint-50 p-3 text-sm font-bold text-mint-600">7일 내 마감 예정 현장이 없습니다.</p>}
        </div>
      </Panel>

      <Panel title="모바일 운영 메모">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <p className="rounded-md bg-navy-50 p-3 text-sm text-slate-700">모바일에서는 체크리스트 카드만 먼저 확인하고, 상세 입력은 필요한 메뉴로 이동해 처리하세요.</p>
          <p className="rounded-md bg-navy-50 p-3 text-sm text-slate-700">마감자료 출력과 대량 엑셀 다운로드는 PC에서 확인하는 것을 권장합니다.</p>
          <p className="rounded-md bg-navy-50 p-3 text-sm text-slate-700">업무 종료 전 JSON 백업을 내려받으면 브라우저 변경이나 장비 교체에 대비할 수 있습니다.</p>
        </div>
      </Panel>
    </div>
  );
}

function WorkersView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Worker>(emptyWorker);
  const [documentFilter, setDocumentFilter] = useState<"ALL" | "COMPLETE" | "MISSING">("ALL");
  const [showApplication, setShowApplication] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const workers = data.workers
    .map((worker) => ({ ...worker, documentStatus: getWorkerDocumentStatus(worker), workSummary: getWorkerWorkSummary(worker.id, data) }))
    .filter((worker) => {
      const residentFront = (worker.residentNumber || "").replace(/[^0-9]/g, "").slice(0, 6);
      const searchable = [worker.workerCode, worker.name, worker.mobile, worker.phone, worker.residentNumber, residentFront, worker.address, worker.jobType]
        .join(" ")
        .toLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery);
    })
    .filter((worker) => documentFilter === "ALL" || (documentFilter === "COMPLETE" ? worker.documentStatus === "완료" : worker.documentStatus !== "완료"));
  const editing = Boolean(form.id);
  const selectedWorkerSummary = form.id ? getWorkerWorkSummary(form.id, data) : undefined;

  const updateWorkerForm = (next: Worker) => setForm({ ...next, documentStatus: getWorkerDocumentStatus(next) });

  const editWorker = (worker: Worker) => {
    const next = {
      ...worker,
      documentStatus: getWorkerDocumentStatus(worker),
      signatureDataUrl: worker.signatureDataUrl || createSignatureDataUrl(worker.name, worker.signatureStyle || "STAMP")
    };
    setForm(next);
    setShowApplication(false);
  };

  const save = () => {
    if (!form.name.trim()) return alert("근로자명을 입력해 주세요.");
    const workerId = form.id || createId("w");
    const worker = {
      ...form,
      id: workerId,
      workerCode: form.workerCode || `W-${String(data.workers.length + 1).padStart(4, "0")}`,
      phone: form.mobile || form.phone,
      attachments: (form.attachments || []).map((attachment) => ({ ...attachment, workerId })),
      documentStatus: getWorkerDocumentStatus(form),
      signatureDataUrl: form.signatureDataUrl || createSignatureDataUrl(form.name, form.signatureStyle)
    };
    updateData({ ...data, workers: editing ? data.workers.map((item) => (item.id === worker.id ? worker : item)) : [...data.workers, worker] });
    setForm(emptyWorker);
    setShowApplication(false);
  };

  const setResidentNumber = (residentNumber: string) => {
    const birthDate = birthDateFromResidentNumber(residentNumber) || form.birthDate;
    updateWorkerForm({ ...form, residentNumber, birthDate, ageGroup: getAgeGroupByWorkDate(birthDate, today) });
  };

  const setFile = async (kind: WorkerDocumentKind, file?: File) => {
    if (!file) return;
    const attachment = await createWorkerAttachmentFromFile({ ...form, id: form.id || "draft-worker" }, kind, file);
    updateWorkerForm(upsertWorkerAttachment(form, attachment));
  };

  const deleteFile = async (kind: WorkerDocumentKind) => {
    const attachment = getWorkerAttachment(form, kind);
    await deleteWorkerAttachmentStorage(attachment);
    updateWorkerForm(removeWorkerAttachment(form, kind));
  };

  const downloadFile = async (kind: WorkerDocumentKind) => {
    const attachment = getWorkerAttachment(form, kind);
    if (attachment) {
      await downloadWorkerAttachment(attachment);
      return;
    }
    const dataUrl = getWorkerDocumentDataUrl(form, kind);
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${form.name || "???"}_${workerDocumentLabels[kind]}.png`);
  };

  const downloadSelectedWorkerFiles = async () => {
    if (!(await downloadWorkerAttachments(form))) alert("????? ????? ????.");
  };

  const downloadAllWorkerFiles = async () => {
    if (!(await downloadAttachmentsZip(data.workers, `?????_????_${today}.zip`))) alert("ZIP?? ????? ????? ????.");
  };

  const printWorkerDocument = () => {
    if (!form.name.trim()) return alert("출력할 근로자를 선택하거나 이름을 입력해 주세요.");
    setShowApplication(true);
    window.setTimeout(() => window.print(), 80);
  };

  const remove = (id: string) => {
    if (!confirm("근로자를 삭제할까요?")) return;
    updateData({
      ...data,
      workers: data.workers.filter((worker) => worker.id !== id),
      workEntries: data.workEntries.filter((entry) => entry.workerId !== id),
      assignments: data.assignments.filter((assignment) => assignment.workerId !== id)
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
      <Panel title={editing ? "근로자 수정" : "근로자 신규 등록"}>
        <div className="grid gap-3">
          <Field label="근로자코드"><TextInput value={form.workerCode || "자동생성"} onChange={(e) => updateWorkerForm({ ...form, workerCode: e.target.value })} /></Field>
          <Field label="이름"><TextInput value={form.name} onChange={(e) => updateWorkerForm({ ...form, name: e.target.value, signatureDataUrl: form.signatureDataUrl ? form.signatureDataUrl : createSignatureDataUrl(e.target.value, form.signatureStyle) })} /></Field>
          <Field label="주민등록번호"><TextInput value={form.residentNumber} onChange={(e) => setResidentNumber(e.target.value)} placeholder="예: 900101-1******" /></Field>
          <Field label="생년월일 / 만 나이"><TextInput type="date" value={form.birthDate} onChange={(e) => updateWorkerForm({ ...form, birthDate: e.target.value, ageGroup: getAgeGroupByWorkDate(e.target.value, today) })} /></Field>
          <div className="rounded-md bg-mint-50 p-2 text-sm font-bold">{calculateAge(form.birthDate)}세 · {ageGroupLabel(getAgeGroupByWorkDate(form.birthDate, today))}</div>
          <Field label="일반전화"><TextInput value={form.landline} onChange={(e) => updateWorkerForm({ ...form, landline: e.target.value })} /></Field>
          <Field label="휴대폰"><TextInput value={form.mobile} onChange={(e) => updateWorkerForm({ ...form, mobile: e.target.value, phone: e.target.value })} /></Field>
          <Field label="주소"><TextInput value={form.address} onChange={(e) => updateWorkerForm({ ...form, address: e.target.value })} /></Field>
          <Button variant="secondary" onClick={() => alert("주소검색은 다음 단계에서 외부 주소 API 없이 수동입력으로 대체합니다.")}>주소검색</Button>
          <Field label="등록일"><TextInput type="date" value={form.registrationDate} onChange={(e) => updateWorkerForm({ ...form, registrationDate: e.target.value })} /></Field>
          <Field label="직종"><TextInput value={form.jobType} onChange={(e) => updateWorkerForm({ ...form, jobType: e.target.value })} /></Field>
          <Field label="경력"><TextInput value={form.career} onChange={(e) => updateWorkerForm({ ...form, career: e.target.value })} /></Field>
          <Field label="자격증"><TextInput value={form.certifications} onChange={(e) => updateWorkerForm({ ...form, certifications: e.target.value })} /></Field>
          <Field label="서류상태">
            <SelectInput value={getWorkerDocumentStatus(form)} disabled>
              <option>완료</option><option>일부누락</option><option>미확인</option>
            </SelectInput>
          </Field>
          <div className="grid gap-2 rounded-md bg-navy-50 p-3 text-xs font-semibold text-slate-600">
            <span>완료 기준: 신분증 앞면, 신분증 뒷면, 이수증이 모두 등록되어야 합니다.</span>
            <span>현재 상태: {getWorkerDocumentStatus(form)}</span>
          </div>
          <WorkerFileField label="신분증 앞면" attachment={getWorkerAttachment(form, "ID_FRONT")} value={getWorkerDocumentDataUrl(form, "ID_FRONT")} onChange={(file) => setFile("ID_FRONT", file)} onDelete={() => deleteFile("ID_FRONT")} onDownload={() => downloadFile("ID_FRONT")} />
          <WorkerFileField label="신분증 뒷면" attachment={getWorkerAttachment(form, "ID_BACK")} value={getWorkerDocumentDataUrl(form, "ID_BACK")} onChange={(file) => setFile("ID_BACK", file)} onDelete={() => deleteFile("ID_BACK")} onDownload={() => downloadFile("ID_BACK")} />
          <WorkerFileField label="기초안전보건교육 이수증" attachment={getWorkerAttachment(form, "SAFETY_CERTIFICATE")} value={getWorkerDocumentDataUrl(form, "SAFETY_CERTIFICATE")} onChange={(file) => setFile("SAFETY_CERTIFICATE", file)} onDelete={() => deleteFile("SAFETY_CERTIFICATE")} onDownload={() => downloadFile("SAFETY_CERTIFICATE")} />
          <WorkerFileField label="기타 첨부파일" attachment={getWorkerAttachment(form, "OTHER")} value={getWorkerDocumentDataUrl(form, "OTHER")} accept="*/*" onChange={(file) => setFile("OTHER", file)} onDelete={() => deleteFile("OTHER")} onDownload={() => downloadFile("OTHER")} />
          <Field label="서명 스타일"><SelectInput value={form.signatureStyle} onChange={(e) => updateWorkerForm({ ...form, signatureStyle: e.target.value as Worker["signatureStyle"], signatureDataUrl: createSignatureDataUrl(form.name, e.target.value as Worker["signatureStyle"]) })}><option value="STAMP">막도장</option><option value="SIGN">전자서명</option></SelectInput></Field>
          <div className="rounded-md border border-navy-100 p-2">
            {form.signatureDataUrl ? <img src={form.signatureDataUrl} alt="서명 미리보기" className="h-20" /> : <p className="mb-2 text-xs text-slate-400">이름 입력 후 자동 생성됩니다.</p>}
            <Button variant="secondary" onClick={() => updateWorkerForm({ ...form, signatureDataUrl: createSignatureDataUrl(form.name, form.signatureStyle) })}>도장/서명 다시 생성</Button>
          </div>
          <Field label="비고"><TextInput value={form.memo} onChange={(e) => updateWorkerForm({ ...form, memo: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save}>{editing ? "수정 저장" : "등록"}</Button>
            <Button variant="secondary" onClick={() => { setForm(emptyWorker); setShowApplication(false); }}>초기화</Button>
            <Button variant="secondary" onClick={() => setShowApplication((value) => !value)}>신상명세서 미리보기</Button>
            <Button variant="secondary" onClick={printWorkerDocument}>신상명세서 출력/PDF</Button>
          </div>
          {selectedWorkerSummary && (
            <div className="grid gap-3 rounded-md border border-navy-100 bg-white p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-md bg-navy-50 p-3 text-sm"><b>총 출역일수</b><p className="mt-1 text-lg font-black text-navy-900">{selectedWorkerSummary.totalWorkDays}일</p></div>
                <div className="rounded-md bg-navy-50 p-3 text-sm"><b>누적 지급액</b><p className="mt-1 text-lg font-black text-navy-900">{formatWon(selectedWorkerSummary.totalPaymentAmount)}</p></div>
                <div className="rounded-md bg-navy-50 p-3 text-sm"><b>최근 출역</b><p className="mt-1 text-sm font-bold text-navy-900">{selectedWorkerSummary.recentWorkDate ? `${formatDateDot(selectedWorkerSummary.recentWorkDate)} / ${selectedWorkerSummary.recentSiteName}` : "-"}</p></div>
              </div>
              <div className="grid gap-2">
                <p className="text-xs font-bold text-slate-500">최근 출역 이력</p>
                {selectedWorkerSummary.assignments.slice(0, 5).map((assignment) => (
                  <div key={assignment.id} className="rounded-md border border-navy-100 p-2 text-xs text-slate-600">
                    <b className="text-navy-900">{formatDateDot(assignment.workDate)}</b> · {data.clients.find((client) => client.id === assignment.clientId)?.name || "-"} / {data.sites.find((site) => site.id === assignment.siteId)?.siteName || data.sites.find((site) => site.id === assignment.siteId)?.name || "-"} · {formatWon(assignment.paymentAmount)}
                  </div>
                ))}
                {selectedWorkerSummary.assignments.length === 0 && <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">출역 이력이 없습니다.</p>}
              </div>
            </div>
          )}
        </div>
      </Panel>

      <div className="space-y-5">
      {showApplication && (
        <Panel title="근로자 신상명세서 미리보기">
          <WorkerApplicationPreview worker={{ ...form, documentStatus: getWorkerDocumentStatus(form), signatureDataUrl: form.signatureDataUrl || createSignatureDataUrl(form.name, form.signatureStyle) }} />
        </Panel>
      )}

      <Panel
        title="근로자 목록"
        actions={
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[160px_1fr]">
            <SelectInput value={documentFilter} onChange={(e) => setDocumentFilter(e.target.value as "ALL" | "COMPLETE" | "MISSING")}>
              <option value="ALL">서류 전체</option>
              <option value="COMPLETE">서류완비</option>
              <option value="MISSING">서류미비</option>
            </SelectInput>
            <TextInput placeholder="이름, 전화번호, 주민번호 앞자리 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        }
      >
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>근로자코드</th><th className={th}>성명</th><th className={th}>생년월일</th><th className={th}>휴대폰</th><th className={th}>서류상태</th><th className={th}>총 출역일수</th><th className={th}>누적 지급액</th><th className={th}>최근 현장</th><th className={th}>최근 출역일</th><th className={th}>관리</th></tr></thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id}>
                  <td className={td}>{worker.workerCode}</td>
                  <td className={td}>{worker.name}</td>
                  <td className={td}>{worker.birthDate}</td>
                  <td className={td}>{worker.mobile || worker.phone}</td>
                  <td className={td}><Badge tone={docTone(worker.documentStatus)}>{worker.documentStatus}</Badge></td>
                  <td className={td}>{worker.workSummary.totalWorkDays}일</td>
                  <td className={td}>{formatWon(worker.workSummary.totalPaymentAmount)}</td>
                  <td className={td}>{worker.workSummary.recentSiteName}</td>
                  <td className={td}>{worker.workSummary.recentWorkDate ? formatDateDot(worker.workSummary.recentWorkDate) : "-"}</td>
                  <td className={`${td} space-x-2`}><Button variant="secondary" onClick={() => editWorker(worker)}>수정</Button><Button variant="danger" onClick={() => remove(worker.id)}>삭제</Button></td>
                </tr>
              ))}
              {workers.length === 0 && <tr><td className={td} colSpan={10}>검색 조건에 맞는 근로자가 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>
      </div>
    </div>
  );
}
function ClientsSitesView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const firstClient = data.clients[0] ?? emptyClient;
  const firstSite = data.sites.find((site) => site.clientId === firstClient.id) ?? data.sites[0] ?? emptySite;
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(firstClient.id);
  const [selectedSiteId, setSelectedSiteId] = useState(firstSite.id);
  const [clientForm, setClientForm] = useState<Client>(firstClient.id ? firstClient : emptyClient);
  const [siteForm, setSiteForm] = useState<Site>(firstSite.id ? hydrateSite(firstSite, data.clients) : { ...emptySite, clientId: firstClient.id, clientName: firstClient.name });

  const filteredClients = data.clients.filter((client) => {
    const clientText = [client.name, client.managerName, client.phone, client.fax, client.email, client.email2, client.memo].join(" ").toLowerCase();
    const siteText = data.sites
      .filter((site) => site.clientId === client.id)
      .map((site) => [site.siteName, site.siteCode, site.managerName, site.phone, site.fax, site.settlementEmail1, site.settlementEmail2].join(" "))
      .join(" ")
      .toLowerCase();
    const target = query.trim().toLowerCase();
    return !target || clientText.includes(target) || siteText.includes(target);
  });

  const treeClients = filteredClients.map((client) => ({
    client,
    sites: data.sites
      .filter((site) => site.clientId === client.id)
      .filter((site) => {
        const target = query.trim().toLowerCase();
        if (!target) return true;
        const item = hydrateSite(site, data.clients);
        return [item.clientName, item.siteName, item.siteCode, item.managerName, item.displayName].join(" ").toLowerCase().includes(target) || client.name.toLowerCase().includes(target);
      })
  }));

  const selectClient = (client: Client) => {
    setSelectedClientId(client.id);
    setClientForm({ ...emptyClient, ...client });
    const first = data.sites.find((site) => site.clientId === client.id);
    if (first) {
      const hydrated = hydrateSite(first, data.clients);
      setSelectedSiteId(hydrated.id);
      setSiteForm(hydrated);
    } else {
      setSelectedSiteId("");
      setSiteForm(createEmptySiteForClient(client));
    }
  };

  const selectSite = (site: Site) => {
    const next = hydrateSite(site, data.clients);
    const client = data.clients.find((item) => item.id === next.clientId);
    if (client) {
      setSelectedClientId(client.id);
      setClientForm({ ...emptyClient, ...client });
    }
    setSelectedSiteId(next.id);
    setSiteForm(next);
  };

  const createEmptySiteForClient = (client = clientForm): Site => ({
    ...emptySite,
    id: "",
    clientId: client.id,
    clientName: client.name,
    siteCode: `S-${Date.now().toString().slice(-5)}`,
    phone: client.phone,
    fax: client.fax,
    settlementEmail1: client.email,
    settlementEmail2: client.email2,
    closingDay: client.closingDay,
    paymentDay: client.paymentDay
  });

  const startNewClient = () => {
    setSelectedClientId("");
    setSelectedSiteId("");
    setClientForm(emptyClient);
    setSiteForm(emptySite);
  };

  const startNewSite = () => {
    if (!clientForm.id) return alert("현장을 등록할 거래처를 먼저 저장하거나 선택해 주세요.");
    setSelectedSiteId("");
    setSiteForm(createEmptySiteForClient(clientForm));
  };

  const setClientField = <K extends keyof Client>(key: K, value: Client[K]) => setClientForm({ ...clientForm, [key]: value });

  const setSiteField = <K extends keyof Site>(key: K, value: Site[K]) => {
    const next = { ...siteForm, [key]: value };
    if (key === "siteName") {
      next.displayName = `${next.clientName || clientForm.name || ""}${next.siteName ? `(${next.siteName})` : ""}`;
      next.name = String(value);
    }
    setSiteForm(next);
  };

  const saveClient = () => {
    if (!clientForm.name.trim()) return alert("거래처명을 입력해 주세요.");
    const client: Client = {
      ...emptyClient,
      ...clientForm,
      id: clientForm.id || createId("c"),
      name: clientForm.name.trim(),
      closingDay: Number(clientForm.closingDay) || 25,
      paymentDay: Number(clientForm.paymentDay) || 10
    };
    const clients = clientForm.id ? data.clients.map((item) => (item.id === client.id ? client : item)) : [...data.clients, client];
    const sites = data.sites.map((site) =>
      site.clientId === client.id
        ? {
            ...site,
            clientName: client.name,
            displayName: `${client.name}(${site.siteName || site.name})`
          }
        : site
    );
    updateData({ ...data, clients, sites });
    setSelectedClientId(client.id);
    setClientForm(client);
    if (!siteForm.clientId) setSiteForm(createEmptySiteForClient(client));
  };

  const deleteClient = () => {
    if (!clientForm.id) return;
    const relatedSiteIds = data.sites.filter((site) => site.clientId === clientForm.id).map((site) => site.id);
    if (!confirm(`거래처와 하위 현장 ${relatedSiteIds.length}개를 삭제할까요? 관련 요청/배치/입금 내역도 함께 삭제됩니다.`)) return;
    const clients = data.clients.filter((client) => client.id !== clientForm.id);
    const sites = data.sites.filter((site) => site.clientId !== clientForm.id);
    updateData({
      ...data,
      clients,
      sites,
      workEntries: data.workEntries.filter((entry) => !relatedSiteIds.includes(entry.siteId)),
      workRequests: data.workRequests.filter((request) => request.clientId !== clientForm.id && !relatedSiteIds.includes(request.siteId)),
      assignments: data.assignments.filter((assignment) => assignment.clientId !== clientForm.id && !relatedSiteIds.includes(assignment.siteId)),
      receivablePayments: data.receivablePayments.filter((payment) => payment.clientId !== clientForm.id && !relatedSiteIds.includes(payment.siteId))
    });
    const next = clients[0] ?? emptyClient;
    setSelectedClientId(next.id);
    setClientForm(next);
    const nextSite = sites.find((site) => site.clientId === next.id);
    setSelectedSiteId(nextSite?.id ?? "");
    setSiteForm(nextSite ? hydrateSite(nextSite, clients) : createEmptySiteForClient(next));
  };

  const saveSite = () => {
    if (!clientForm.id) return alert("거래처를 먼저 선택하거나 저장해 주세요.");
    if (!siteForm.siteName.trim()) return alert("현장명을 입력해 주세요.");
    const siteName = siteForm.siteName.trim();
    const site: Site = {
      ...siteForm,
      id: siteForm.id || createId("s"),
      clientId: clientForm.id,
      clientName: clientForm.name,
      siteName,
      name: siteName,
      siteCode: siteForm.siteCode.trim() || `S-${Date.now().toString().slice(-5)}`,
      code: siteForm.siteCode.trim() || siteForm.code,
      displayName: `${clientForm.name}(${siteName})`,
      closingDay: Number(siteForm.closingDay) || clientForm.closingDay || 25,
      paymentDay: Number(siteForm.paymentDay) || clientForm.paymentDay || 10,
      invoiceDeductionRate: Number(siteForm.invoiceDeductionRate) || 0.1,
      defaultUnitPrice: Number(siteForm.defaultUnitPrice) || 150000,
      pensionMonthlyThreshold: Number(siteForm.pensionMonthlyThreshold) || 2200000
    };
    const sites = siteForm.id ? data.sites.map((item) => (item.id === site.id ? site : item)) : [...data.sites, site];
    updateData({ ...data, sites });
    setSelectedSiteId(site.id);
    setSiteForm(site);
  };

  const deleteSite = () => {
    if (!siteForm.id) return;
    if (!confirm("선택한 현장을 삭제할까요? 관련 요청/배치/입금 내역도 함께 삭제됩니다.")) return;
    const remainingSites = data.sites.filter((site) => site.id !== siteForm.id);
    updateData({
      ...data,
      sites: remainingSites,
      workEntries: data.workEntries.filter((entry) => entry.siteId !== siteForm.id),
      workRequests: data.workRequests.filter((request) => request.siteId !== siteForm.id),
      assignments: data.assignments.filter((assignment) => assignment.siteId !== siteForm.id),
      receivablePayments: data.receivablePayments.filter((payment) => payment.siteId !== siteForm.id)
    });
    const next = remainingSites.find((site) => site.clientId === clientForm.id);
    setSelectedSiteId(next?.id ?? "");
    setSiteForm(next ? hydrateSite(next, data.clients) : createEmptySiteForClient(clientForm));
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
      <Panel title="거래처 · 현장 트리">
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <TextInput placeholder="거래처명, 현장명, 코드, 담당자" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button variant="secondary" onClick={() => setQuery(query.trim())}>검색</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={startNewClient}>거래처 신규</Button>
            <Button variant="secondary" onClick={startNewSite} disabled={!clientForm.id}>현장 신규</Button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto rounded-md border border-navy-100 bg-white xl:h-[700px]">
            {treeClients.map(({ client, sites }) => {
              const clientActive = selectedClientId === client.id;
              return (
                <div key={client.id} className="border-b border-navy-100">
                  <button onClick={() => selectClient(client)} className={`block w-full px-3 py-2 text-left text-sm font-black transition ${clientActive ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-900 hover:bg-navy-100"}`}>
                    {client.name}
                    <span className={`mt-1 block text-xs ${clientActive ? "text-navy-100" : "text-slate-500"}`}>{client.phone || "회사전화 미입력"} · 현장 {sites.length}개</span>
                  </button>
                  {sites.map((site) => {
                    const item = hydrateSite(site, data.clients);
                    const active = selectedSiteId === item.id;
                    return (
                      <button key={item.id} onClick={() => selectSite(site)} className={`block w-full border-t border-navy-100 px-5 py-2 text-left text-sm transition ${active ? "bg-mint-100 text-navy-900" : "hover:bg-navy-50"}`}>
                        <span className="block font-bold">└ {item.siteName}</span>
                        <span className="mt-1 block text-xs text-slate-500">{item.siteCode || "코드 없음"} · {item.invoiceIssueType === "ISSUED" ? "계산서 발행" : "계산서 미발행"}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {treeClients.length === 0 && <p className="p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
          </div>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel title="거래처 상세정보" actions={<div className="flex flex-wrap gap-2"><Button onClick={saveClient}>{clientForm.id ? "거래처 수정" : "거래처 저장"}</Button><Button variant="danger" onClick={deleteClient} disabled={!clientForm.id}>거래처 삭제</Button></div>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="거래처명"><TextInput value={clientForm.name} onChange={(e) => setClientField("name", e.target.value)} /></Field>
            <Field label="담당자명"><TextInput value={clientForm.managerName} onChange={(e) => setClientField("managerName", e.target.value)} /></Field>
            <Field label="회사전화번호"><TextInput value={clientForm.phone} onChange={(e) => setClientField("phone", e.target.value)} /></Field>
            <Field label="팩스번호"><TextInput value={clientForm.fax} onChange={(e) => setClientField("fax", e.target.value)} /></Field>
            <Field label="이메일1"><TextInput value={clientForm.email} onChange={(e) => setClientField("email", e.target.value)} /></Field>
            <Field label="이메일2"><TextInput value={clientForm.email2} onChange={(e) => setClientField("email2", e.target.value)} /></Field>
            <Field label="마감일"><TextInput type="number" value={clientForm.closingDay} onChange={(e) => setClientField("closingDay", Number(e.target.value))} /></Field>
            <Field label="결제일"><TextInput type="number" value={clientForm.paymentDay} onChange={(e) => setClientField("paymentDay", Number(e.target.value))} /></Field>
            <div className="xl:col-span-4"><Field label="비고"><TextInput value={clientForm.memo} onChange={(e) => setClientField("memo", e.target.value)} /></Field></div>
          </div>
        </Panel>

        <Panel title="현장 상세정보" actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={startNewSite} disabled={!clientForm.id}>현장 신규</Button><Button onClick={saveSite} disabled={!clientForm.id}>{siteForm.id ? "현장 수정" : "현장 저장"}</Button><Button variant="danger" onClick={deleteSite} disabled={!siteForm.id}>현장 삭제</Button></div>}>
          {clientForm.id ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="소속 거래처"><TextInput value={clientForm.name} readOnly /></Field>
              <Field label="현장코드"><TextInput value={siteForm.siteCode} onChange={(e) => setSiteField("siteCode", e.target.value)} /></Field>
              <Field label="현장명"><TextInput value={siteForm.siteName} onChange={(e) => setSiteField("siteName", e.target.value)} /></Field>
              <Field label="표시명"><TextInput value={siteForm.displayName} onChange={(e) => setSiteField("displayName", e.target.value)} /></Field>
              <Field label="회사전화번호"><TextInput value={siteForm.phone} onChange={(e) => setSiteField("phone", e.target.value)} /></Field>
              <Field label="팩스번호"><TextInput value={siteForm.fax} onChange={(e) => setSiteField("fax", e.target.value)} /></Field>
              <Field label="담당자명"><TextInput value={siteForm.managerName} onChange={(e) => setSiteField("managerName", e.target.value)} /></Field>
              <Field label="담당자 직책"><TextInput value={siteForm.managerTitle} onChange={(e) => setSiteField("managerTitle", e.target.value)} /></Field>
              <Field label="담당자 연락처"><TextInput value={siteForm.managerPhone} onChange={(e) => setSiteField("managerPhone", e.target.value)} /></Field>
              <Field label="이메일1"><TextInput value={siteForm.settlementEmail1} onChange={(e) => setSiteField("settlementEmail1", e.target.value)} /></Field>
              <Field label="이메일2"><TextInput value={siteForm.settlementEmail2} onChange={(e) => setSiteField("settlementEmail2", e.target.value)} /></Field>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2"><Field label="마감일"><TextInput type="number" value={siteForm.closingDay} onChange={(e) => setSiteField("closingDay", Number(e.target.value))} /></Field><Field label="결제일"><TextInput type="number" value={siteForm.paymentDay} onChange={(e) => setSiteField("paymentDay", Number(e.target.value))} /></Field></div>
              <Field label="기본단가"><TextInput type="number" value={siteForm.defaultUnitPrice} onChange={(e) => setSiteField("defaultUnitPrice", Number(e.target.value))} /></Field>
              <Field label="기본공제유형"><DeductionSelect value={siteForm.defaultDeductionType} onChange={(value) => setSiteField("defaultDeductionType", value)} /></Field>
              <Field label="계산서 발행 여부"><SelectInput value={siteForm.invoiceIssueType} onChange={(e) => setSiteField("invoiceIssueType", e.target.value as Site["invoiceIssueType"])}><option value="ISSUED">계산서 발행</option><option value="NOT_ISSUED">계산서 미발행</option></SelectInput></Field>
              <Field label="알선수수료율"><TextInput type="number" step="0.01" value={siteForm.invoiceDeductionRate} onChange={(e) => setSiteField("invoiceDeductionRate", Number(e.target.value))} /></Field>
              <Field label="건강보험 판단 기준"><SelectInput value={siteForm.healthInsuranceBasis} onChange={(e) => setSiteField("healthInsuranceBasis", e.target.value as Site["healthInsuranceBasis"])}><option value="CLIENT_BASED">거래처 기준</option><option value="SITE_BASED">현장 기준</option><option value="MANUAL">수동</option></SelectInput></Field>
              <Field label="건강보험 출력 기준"><SelectInput value={siteForm.healthInsuranceOutputBasis} onChange={(e) => setSiteField("healthInsuranceOutputBasis", e.target.value as Site["healthInsuranceOutputBasis"])}><option value="MONTH_FIRST_DAY">매월 1일 기준</option><option value="DATE_BASED">실제 날짜 기준</option><option value="FIRST_MONTH_NOT_APPLY">첫달 미부과</option><option value="MANUAL">수동</option></SelectInput></Field>
              <Field label="국민연금 출력 기준"><SelectInput value={siteForm.pensionOutputBasis} onChange={(e) => setSiteField("pensionOutputBasis", e.target.value as Site["pensionOutputBasis"])}><option value="MONTH_FIRST_DAY">매월 1일 기준</option><option value="DATE_BASED">실제 날짜 기준</option><option value="FIRST_MONTH_NOT_APPLY">첫달 미부과</option><option value="MANUAL">수동</option></SelectInput></Field>
              <Field label="첫달 보험 처리"><SelectInput value={siteForm.firstMonthInsuranceHandling} onChange={(e) => setSiteField("firstMonthInsuranceHandling", e.target.value as Site["firstMonthInsuranceHandling"])}><option value="APPLY">첫달도 반영</option><option value="NOT_APPLY">첫달 미부과·비희망</option><option value="MANUAL">수동</option></SelectInput></Field>
              <Field label="국민연금 기준금액"><TextInput type="number" value={siteForm.pensionMonthlyThreshold} onChange={(e) => setSiteField("pensionMonthlyThreshold", Number(e.target.value))} /></Field>
              <div className="xl:col-span-2"><Field label="주소"><TextInput value={siteForm.address} onChange={(e) => setSiteField("address", e.target.value)} /></Field></div>
              <div className="xl:col-span-2"><Field label="기본 작업내용"><TextInput value={siteForm.defaultTaskDescription} onChange={(e) => setSiteField("defaultTaskDescription", e.target.value)} /></Field></div>
              <div className="xl:col-span-4"><Field label="비고"><TextInput value={siteForm.memo} onChange={(e) => setSiteField("memo", e.target.value)} /></Field></div>
              <div className="xl:col-span-4"><Field label="약도/오시는 길"><TextArea value={siteForm.directions} onChange={(e) => setSiteField("directions", e.target.value)} className="min-h-28" /></Field></div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={siteForm.carryOverPreviousMonth} onChange={(e) => setSiteField("carryOverPreviousMonth", e.target.checked)} />전월 연속근로 반영</label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={siteForm.isActive} onChange={(e) => setSiteField("isActive", e.target.checked)} />활성상태</label>
              <div className="xl:col-span-2 flex items-center gap-3 rounded-md bg-navy-50 px-3 text-sm text-navy-800"><b>현장별 정산 연결</b><span>{siteForm.id ? `${clientForm.name} / ${siteForm.siteName}` : "저장 후 월말 정산 현장 선택에 표시됩니다."}</span></div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">거래처를 먼저 선택하거나 저장해 주세요.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
function AttendanceView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const firstClient = data.clients[0]?.id ?? "";
  const firstSite = data.sites.find((site) => site.clientId === firstClient)?.id ?? "";
  const firstSiteData = data.sites.find((site) => site.id === firstSite);
  const [requestForm, setRequestForm] = useState<Omit<WorkRequest, "id" | "status">>({
    requestDate: today,
    workDate: today,
    clientId: firstClient,
    siteId: firstSite,
    taskDescription: firstSiteData?.defaultTaskDescription || "",
    requestedCount: 1,
    unitPrice: firstSiteData?.defaultUnitPrice ?? 150000,
    deductionType: firstSiteData?.defaultDeductionType ?? "고용보험",
    meetingPlace: "",
    memo: ""
  });
  const [selectedRequestId, setSelectedRequestId] = useState(data.workRequests[0]?.id ?? "");
  const [workerQuery, setWorkerQuery] = useState("");
  const [bulkAssignCount, setBulkAssignCount] = useState(1);
  const [assignmentForm, setAssignmentForm] = useState({
    workerId: "",
    unitPrice: data.workRequests[0]?.unitPrice ?? 150000,
    workCount: 1,
    deductionType: data.workRequests[0]?.deductionType ?? ("고용보험" as DeductionType),
    manualEmploymentInsurance: "",
    manualHealthInsurance: "",
    manualNationalPension: "",
    manualLongTermCare: "",
    manualDeductionAmount: "",
    manualPaymentAmount: "",
    manualReason: "",
    memo: ""
  });
  const requestSites = data.sites.filter((site) => site.clientId === requestForm.clientId);
  const requests = normalizeRequestStatuses(data.workRequests, data.assignments).sort((a, b) => b.workDate.localeCompare(a.workDate));
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? requests[0];
  const selectedAssignments = selectedRequest ? data.assignments.filter((assignment) => assignment.requestId === selectedRequest.id && assignment.status !== "취소") : [];
  const selectedAssignedCount = selectedRequest ? getAssignedCount(selectedRequest.id, data.assignments) : 0;
  const selectedShortageCount = selectedRequest ? Math.max(selectedRequest.requestedCount - selectedAssignedCount, 0) : 0;
  const selectedAssignmentRate = selectedRequest && selectedRequest.requestedCount > 0 ? Math.round((selectedAssignedCount / selectedRequest.requestedCount) * 100) : 0;
  const workers = data.workers.filter((worker) => [worker.name, worker.phone, worker.mobile].join(" ").includes(workerQuery));
  const availableWorkers = selectedRequest
    ? workers.filter((worker) => !data.assignments.some((assignment) => assignment.requestId === selectedRequest.id && assignment.workerId === worker.id && assignment.status !== "취소"))
    : workers;
  const previewWorker = data.workers.find((worker) => worker.id === assignmentForm.workerId) ?? data.workers[0];
  const previewSite = selectedRequest ? data.sites.find((site) => site.id === selectedRequest.siteId) : undefined;
  const previewClient = selectedRequest ? data.clients.find((client) => client.id === selectedRequest.clientId) : undefined;
  const preview =
    selectedRequest && previewWorker && previewSite && previewClient
      ? calculatePayrollDeduction({
          worker: previewWorker,
          site: previewSite,
          client: previewClient,
          requestId: selectedRequest.id,
          workerId: previewWorker.id,
          workDate: selectedRequest.workDate,
          clientId: selectedRequest.clientId,
          siteId: selectedRequest.siteId,
          taskDescription: selectedRequest.taskDescription,
          unitPrice: assignmentForm.unitPrice,
          workCount: assignmentForm.workCount,
          deductionType: assignmentForm.deductionType,
          existingAssignments: data.assignments,
          calculationRules: data.calculationRules,
          manual: {
            employmentInsurance: assignmentForm.manualEmploymentInsurance ? Number(assignmentForm.manualEmploymentInsurance) : undefined,
            healthInsurance: assignmentForm.manualHealthInsurance ? Number(assignmentForm.manualHealthInsurance) : undefined,
            nationalPension: assignmentForm.manualNationalPension ? Number(assignmentForm.manualNationalPension) : undefined,
            longTermCare: assignmentForm.manualLongTermCare ? Number(assignmentForm.manualLongTermCare) : undefined,
            deductionAmount: assignmentForm.manualDeductionAmount ? Number(assignmentForm.manualDeductionAmount) : undefined,
            paymentAmount: assignmentForm.manualPaymentAmount ? Number(assignmentForm.manualPaymentAmount) : undefined,
            manualReason: assignmentForm.manualReason
          }
        })
      : calculateByRule(assignmentForm.unitPrice, assignmentForm.workCount, assignmentForm.deductionType, data.calculationRules);

  const changeRequestClient = (clientId: string) => {
    const site = data.sites.find((item) => item.clientId === clientId);
    setRequestForm({
      ...requestForm,
      clientId,
      siteId: site?.id ?? "",
      taskDescription: site?.defaultTaskDescription || requestForm.taskDescription,
      unitPrice: site?.defaultUnitPrice ?? requestForm.unitPrice,
      deductionType: site?.defaultDeductionType ?? requestForm.deductionType
    });
  };

  const changeRequestSite = (siteId: string) => {
    const site = data.sites.find((item) => item.id === siteId);
    setRequestForm({
      ...requestForm,
      siteId,
      taskDescription: site?.defaultTaskDescription || requestForm.taskDescription,
      unitPrice: site?.defaultUnitPrice ?? requestForm.unitPrice,
      deductionType: site?.defaultDeductionType ?? requestForm.deductionType
    });
  };

  const saveRequest = () => {
    if (!requestForm.siteId) return alert("현장을 선택해 주세요.");
    if (!requestForm.taskDescription.trim()) return alert("작업내용을 입력해 주세요.");
    const request: WorkRequest = {
      ...requestForm,
      id: createId("req"),
      status: "배치대기"
    };
    const nextRequests = normalizeRequestStatuses([...data.workRequests, request], data.assignments);
    updateData({ ...data, workRequests: nextRequests });
    setSelectedRequestId(request.id);
    setAssignmentForm({ workerId: "", unitPrice: request.unitPrice, workCount: 1, deductionType: request.deductionType, manualEmploymentInsurance: "", manualHealthInsurance: "", manualNationalPension: "", manualLongTermCare: "", manualDeductionAmount: "", manualPaymentAmount: "", manualReason: "", memo: "" });
  };

  const selectRequest = (request: WorkRequest) => {
    const assigned = getAssignedCount(request.id, data.assignments);
    setSelectedRequestId(request.id);
    setBulkAssignCount(Math.max(request.requestedCount - assigned, 1));
    setAssignmentForm({ workerId: "", unitPrice: request.unitPrice, workCount: 1, deductionType: request.deductionType, manualEmploymentInsurance: "", manualHealthInsurance: "", manualNationalPension: "", manualLongTermCare: "", manualDeductionAmount: "", manualPaymentAmount: "", manualReason: "", memo: "" });
  };

  const saveAssignment = () => {
    if (!selectedRequest) return alert("요청건을 선택해 주세요.");
    if (!assignmentForm.workerId) return alert("근로자를 선택해 주세요.");
    const duplicate = data.assignments.find((assignment) => assignment.requestId === selectedRequest.id && assignment.workerId === assignmentForm.workerId && assignment.status !== "취소");
    if (duplicate && !confirm("같은 요청건에 같은 근로자가 이미 배치되어 있습니다. 그래도 저장할까요?")) return;
    const assignedCount = getAssignedCount(selectedRequest.id, data.assignments);
    if (assignedCount + 1 > selectedRequest.requestedCount && !confirm("배치인원이 요청인원보다 많습니다. 초과 배치로 저장할까요?")) return;

    const worker = data.workers.find((item) => item.id === assignmentForm.workerId);
    const site = data.sites.find((item) => item.id === selectedRequest.siteId);
    const client = data.clients.find((item) => item.id === selectedRequest.clientId);
    if (!worker || !site || !client) return alert("근로자, 거래처, 현장 정보를 확인해 주세요.");
    const assignment = {
      ...calculatePayrollDeduction({
        worker,
        site,
        client,
        requestId: selectedRequest.id,
        workerId: assignmentForm.workerId,
        workDate: selectedRequest.workDate,
        clientId: selectedRequest.clientId,
        siteId: selectedRequest.siteId,
        taskDescription: selectedRequest.taskDescription,
        unitPrice: assignmentForm.unitPrice,
        workCount: assignmentForm.workCount,
        deductionType: assignmentForm.deductionType,
        existingAssignments: data.assignments,
        calculationRules: data.calculationRules,
        manual: {
          employmentInsurance: assignmentForm.manualEmploymentInsurance ? Number(assignmentForm.manualEmploymentInsurance) : undefined,
          healthInsurance: assignmentForm.manualHealthInsurance ? Number(assignmentForm.manualHealthInsurance) : undefined,
          nationalPension: assignmentForm.manualNationalPension ? Number(assignmentForm.manualNationalPension) : undefined,
          longTermCare: assignmentForm.manualLongTermCare ? Number(assignmentForm.manualLongTermCare) : undefined,
          deductionAmount: assignmentForm.manualDeductionAmount ? Number(assignmentForm.manualDeductionAmount) : undefined,
          paymentAmount: assignmentForm.manualPaymentAmount ? Number(assignmentForm.manualPaymentAmount) : undefined,
          manualReason: assignmentForm.manualReason
        }
      }),
      id: createId("as"),
      memo: assignmentForm.memo
    };
    const assignments = [...data.assignments, assignment];
    updateData({ ...data, assignments, workRequests: normalizeRequestStatuses(data.workRequests, assignments) });
    setAssignmentForm({ ...assignmentForm, workerId: "", manualEmploymentInsurance: "", manualHealthInsurance: "", manualNationalPension: "", manualLongTermCare: "", manualDeductionAmount: "", manualPaymentAmount: "", manualReason: "", memo: "" });
  };

  const bulkSaveAssignments = () => {
    if (!selectedRequest) return alert("요청건을 선택해 주세요.");
    const site = data.sites.find((item) => item.id === selectedRequest.siteId);
    const client = data.clients.find((item) => item.id === selectedRequest.clientId);
    if (!site || !client) return alert("거래처, 현장 정보를 확인해 주세요.");
    const targetCount = Math.max(Number(bulkAssignCount) || 0, 0);
    if (targetCount <= 0) return alert("실제 배치인원을 입력해 주세요.");
    const currentAssigned = getAssignedCount(selectedRequest.id, data.assignments);
    if (currentAssigned + targetCount > selectedRequest.requestedCount && !confirm("배치인원이 요청인원보다 많습니다. 초과 배치로 저장할까요?")) return;
    const candidates = availableWorkers.slice(0, targetCount);
    if (candidates.length < targetCount) return alert("배치 가능한 근로자가 부족합니다. 검색 조건이나 근로자 목록을 확인해 주세요.");
    let baseAssignments = data.assignments;
    const newAssignments = candidates.map((worker, index) => {
      const calculated = calculatePayrollDeduction({
        worker,
        site,
        client,
        requestId: selectedRequest.id,
        workerId: worker.id,
        workDate: selectedRequest.workDate,
        clientId: selectedRequest.clientId,
        siteId: selectedRequest.siteId,
        taskDescription: selectedRequest.taskDescription,
        unitPrice: assignmentForm.unitPrice,
        workCount: assignmentForm.workCount,
        deductionType: assignmentForm.deductionType,
        existingAssignments: baseAssignments,
        calculationRules: data.calculationRules
      });
      const assignment = { ...calculated, id: createId(`as${index}`), memo: assignmentForm.memo || "일괄 배치" };
      baseAssignments = [...baseAssignments, assignment];
      return assignment;
    });
    const assignments = [...data.assignments, ...newAssignments];
    updateData({ ...data, assignments, workRequests: normalizeRequestStatuses(data.workRequests, assignments) });
    setBulkAssignCount(Math.max(selectedRequest.requestedCount - currentAssigned - newAssignments.length, 1));
  };

  const removeAssignment = (id: string) => {
    if (!confirm("배치내역을 삭제할까요?")) return;
    const assignments = data.assignments.filter((assignment) => assignment.id !== id);
    updateData({ ...data, assignments, workRequests: normalizeRequestStatuses(data.workRequests, assignments) });
  };

  return (
    <div className="space-y-5">
      <Panel title="요청건 등록">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="근무일"><TextInput type="date" value={requestForm.workDate} onChange={(e) => setRequestForm({ ...requestForm, workDate: e.target.value })} /></Field>
          <Field label="거래처"><SelectInput value={requestForm.clientId} onChange={(e) => changeRequestClient(e.target.value)}>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</SelectInput></Field>
          <Field label="현장"><SelectInput value={requestForm.siteId} onChange={(e) => changeRequestSite(e.target.value)}>{requestSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput></Field>
          <Field label="요청인원"><TextInput type="number" value={requestForm.requestedCount} onChange={(e) => setRequestForm({ ...requestForm, requestedCount: Number(e.target.value) })} /></Field>
          <Field label="단가"><TextInput type="number" value={requestForm.unitPrice} onChange={(e) => setRequestForm({ ...requestForm, unitPrice: Number(e.target.value) })} /></Field>
          <Field label="공제유형"><DeductionSelect value={requestForm.deductionType} onChange={(value) => setRequestForm({ ...requestForm, deductionType: value })} /></Field>
          <div className="xl:col-span-2"><Field label="작업내용"><TextInput value={requestForm.taskDescription} onChange={(e) => setRequestForm({ ...requestForm, taskDescription: e.target.value })} /></Field></div>
          <div className="xl:col-span-2"><Field label="집합장소"><TextInput value={requestForm.meetingPlace} onChange={(e) => setRequestForm({ ...requestForm, meetingPlace: e.target.value })} /></Field></div>
          <div className="xl:col-span-2"><Field label="비고"><TextInput value={requestForm.memo} onChange={(e) => setRequestForm({ ...requestForm, memo: e.target.value })} /></Field></div>
          <div className="xl:col-span-6 flex justify-end"><Button onClick={saveRequest}>요청 저장</Button></div>
        </div>
      </Panel>

      <Panel title="요청건 목록">
        <RequestTable
          requests={requests}
          data={data}
          selectedRequestId={selectedRequest?.id}
          onSelect={selectRequest}
        />
      </Panel>

      <Panel title="근로자 배치">
        {selectedRequest ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_1fr]">
            <div className="rounded-md border border-navy-100 bg-navy-50 p-4 text-sm">
              <p className="text-lg font-bold text-navy-900">{data.clients.find((client) => client.id === selectedRequest.clientId)?.name} / {data.sites.find((site) => site.id === selectedRequest.siteId)?.name}</p>
              <p className="mt-2">근무일: {selectedRequest.workDate}</p>
              <p>작업내용: {selectedRequest.taskDescription}</p>
              <p>요청 {selectedRequest.requestedCount}명 / 배치 {selectedAssignedCount}명 / 부족 {selectedShortageCount}명</p>
              <p>요청 대비 배치율: {selectedAssignmentRate}%</p>
              <p>집합장소: {selectedRequest.meetingPlace || "-"}</p>
              <div className="mt-3 flex flex-wrap gap-2"><StatusBadge status={getRequestStatus(selectedRequest, data.assignments)} /><Badge tone={selectedShortageCount > 0 ? "amber" : "mint"}>{selectedShortageCount > 0 ? `부족 ${selectedShortageCount}명` : "부족 없음"}</Badge></div>
            </div>
            <div className="grid gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <Field label="근로자 검색"><TextInput value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} placeholder="이름 또는 연락처" /></Field>
                <Field label="근로자 선택"><SelectInput value={assignmentForm.workerId} onChange={(e) => setAssignmentForm({ ...assignmentForm, workerId: e.target.value })}><option value="">선택</option>{availableWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} ({worker.mobile || worker.phone})</option>)}</SelectInput></Field>
                <Field label="공수"><TextInput type="number" step="0.5" value={assignmentForm.workCount} onChange={(e) => setAssignmentForm({ ...assignmentForm, workCount: Number(e.target.value) })} /></Field>
                <Field label="단가"><TextInput type="number" value={assignmentForm.unitPrice} onChange={(e) => setAssignmentForm({ ...assignmentForm, unitPrice: Number(e.target.value) })} /></Field>
                <Field label="공제유형"><DeductionSelect value={assignmentForm.deductionType} onChange={(value) => setAssignmentForm({ ...assignmentForm, deductionType: value })} /></Field>
                <div className="flex items-end"><Button onClick={saveAssignment} className="w-full">배치 저장</Button></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 rounded-md border border-navy-100 bg-white p-3">
                <Field label="실제 배치인원"><TextInput type="number" min={1} value={bulkAssignCount} onChange={(e) => setBulkAssignCount(Number(e.target.value))} /></Field>
                <Field label="현재 배치인원"><TextInput value={`${selectedAssignedCount}명`} readOnly /></Field>
                <Field label="부족인원"><TextInput value={`${selectedShortageCount}명`} readOnly /></Field>
                <Field label="배치율"><TextInput value={`${selectedAssignmentRate}%`} readOnly /></Field>
                <Field label="배치 가능 근로자"><TextInput value={`${availableWorkers.length}명`} readOnly /></Field>
                <div className="flex items-end"><Button variant="secondary" onClick={bulkSaveAssignments} className="w-full">실제 배치인원 저장</Button></div>
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-md bg-mint-50 p-3 text-sm font-bold sm:grid-cols-2 xl:grid-cols-4">
                <span>실제 단가 {formatWon(assignmentForm.unitPrice)}</span>
                <span>근로자 기준금액 {"deductionBaseAmount" in preview ? formatWon(preview.deductionBaseAmount) : "-"}</span>
                <span>총공제 {formatWon(preview.deductionAmount)}</span>
                <span>차감지급 {formatWon(preview.paymentAmount)}</span>
                <span>고용 {formatWon("employmentInsurance" in preview ? preview.employmentInsurance : 0)}</span>
                <span>건강 {formatWon("healthInsurance" in preview ? preview.healthInsurance : 0)}</span>
                <span>연금 {formatWon("nationalPension" in preview ? preview.nationalPension : 0)}</span>
                <span>장기요양 {formatWon("longTermCare" in preview ? preview.longTermCare : 0)}</span>
              </div>
              <div className="rounded-md border border-navy-100 bg-white p-3 text-sm text-slate-700">
                <p><b>나이구분</b> {previewWorker ? ageGroupLabel(getAgeGroupByWorkDate(previewWorker.birthDate, selectedRequest.workDate)) : "-"}</p>
                <p><b>계산서 발행 여부</b> {"invoiceIssueType" in preview ? (preview.invoiceIssueType === "ISSUED" ? "계산서 발행" : "계산서 미발행") : "-"}</p>
                <p><b>공제 적용 여부</b> {preview.deductionAmount > 0 ? "적용" : "미적용"}</p>
                <p><b>적용규칙</b> {"appliedRuleLabel" in preview ? preview.appliedRuleLabel : "-"}</p>
                <p><b>판단사유</b> {"deductionReason" in preview ? preview.deductionReason : "계산기준표 기준 공제액을 미리 계산합니다."}</p>
                {"healthInsuranceReason" in preview && <p><b>건강보험</b> {preview.healthInsuranceReason}</p>}
                {"pensionReason" in preview && <p><b>국민연금</b> {preview.pensionReason}</p>}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7 rounded-md border border-navy-100 bg-white p-3">
                <Field label="수동 고용"><TextInput type="number" value={assignmentForm.manualEmploymentInsurance} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualEmploymentInsurance: e.target.value })} /></Field>
                <Field label="수동 건강"><TextInput type="number" value={assignmentForm.manualHealthInsurance} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualHealthInsurance: e.target.value })} /></Field>
                <Field label="수동 연금"><TextInput type="number" value={assignmentForm.manualNationalPension} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualNationalPension: e.target.value })} /></Field>
                <Field label="수동 장기"><TextInput type="number" value={assignmentForm.manualLongTermCare} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualLongTermCare: e.target.value })} /></Field>
                <Field label="수동 총공제"><TextInput type="number" value={assignmentForm.manualDeductionAmount} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualDeductionAmount: e.target.value })} /></Field>
                <Field label="수동 지급"><TextInput type="number" value={assignmentForm.manualPaymentAmount} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualPaymentAmount: e.target.value })} /></Field>
                <Field label="수동 사유"><TextInput value={assignmentForm.manualReason} onChange={(e) => setAssignmentForm({ ...assignmentForm, manualReason: e.target.value })} /></Field>
              </div>
              <AssignmentTable assignments={selectedAssignments} data={data} actions={(assignment) => <Button variant="danger" onClick={() => removeAssignment(assignment.id)}>삭제</Button>} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">요청건을 먼저 등록하거나 선택해 주세요.</p>
        )}
      </Panel>
    </div>
  );
}

type ClosingDocKey = "statement" | "payroll" | "delegation" | "receipt" | "application";

const closingDocLabels: Record<ClosingDocKey, string> = {
  statement: "거래명세서",
  payroll: "일용노무비지급명세서",
  delegation: "위임장",
  receipt: "근로자영수증",
  application: "근로자 신상명세서"
};

function SettlementView({ data, selectedMonth, setSelectedMonth }: { data: AppData; selectedMonth: string; setSelectedMonth: (month: string) => void }) {
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? "");
  const [siteId, setSiteId] = useState("all");
  const [previewDoc, setPreviewDoc] = useState<ClosingDocKey>("statement");
  const sites = data.sites.filter((site) => site.clientId === clientId);
  const entries = data.assignments.filter((entry) => entry.status !== "취소" && isSameMonth(entry.workDate, selectedMonth) && entry.clientId === clientId && (siteId === "all" || entry.siteId === siteId));
  const statement = useMemo(() => groupStatement(entries, data), [entries, data]);
  const payroll = useMemo(() => groupPayroll(entries, data), [entries, data]);
  const selectedSite = data.sites.find((site) => site.id === siteId) ?? sites[0];
  const selectedClient = data.clients.find((client) => client.id === clientId);
  const canExportClosing = Boolean(selectedClient && selectedSite && siteId !== "all");
  const totalLabor = entries.reduce((sum, entry) => sum + entry.laborCost, 0);
  const totalDeduction = entries.reduce((sum, entry) => sum + entry.deductionAmount, 0);
  const totalPayment = entries.reduce((sum, entry) => sum + entry.paymentAmount, 0);
  const totalWorkCount = entries.reduce((sum, entry) => sum + entry.workCount, 0);
  const workerCount = new Set(entries.map((entry) => entry.workerId)).size;
  const missingDocuments = countMissingClosingDocuments(entries, data);

  const downloadExcel = async (rows: Record<string, string | number>[], name: string) => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 18 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, name);
    XLSX.writeFile(book, `${name}_${selectedMonth}.xlsx`);
  };

  const appendClosingSheet = (XLSX: typeof import("xlsx"), book: import("xlsx").WorkBook, name: string, rows: Array<Array<string | number>>) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = Array.from({ length: Math.max(...rows.map((row) => row.length), 1) }, () => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
  };

  const downloadClosingWorkbook = async () => {
    if (!selectedClient || !selectedSite || siteId === "all") return alert("마감자료 출력은 특정 현장을 선택해 주세요.");
    if (!entries.length) return alert("선택한 조건에 출력할 배치 내역이 없습니다.");
    if (missingDocuments > 0 && !confirm(`서류 누락 근로자 ${missingDocuments}명이 있습니다. 그래도 마감자료를 출력할까요?`)) return;
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    appendClosingSheet(XLSX, book, "거래명세서", buildStatementRows(entries, data, selectedClient.name, selectedSite, selectedMonth));
    appendClosingSheet(XLSX, book, "일용노무비지급명세서", buildDailyPayrollRows(entries, data, selectedMonth));
    appendClosingSheet(XLSX, book, "위임장", buildDelegationRows(entries, data, selectedSite, selectedMonth));
    appendClosingSheet(XLSX, book, "근로자영수증", buildReceiptRows(entries, data, selectedSite, selectedMonth));
    appendClosingSheet(XLSX, book, "근로자신상명세서", buildWorkerProfileRows(entries, data));
    XLSX.writeFile(book, `${selectedClient.name}_${selectedSite.siteName}_${selectedMonth}_마감자료.xlsx`);
  };

  const printClosingDocuments = () => {
    if (!canExportClosing) return alert("PDF/인쇄는 특정 현장을 선택해 주세요.");
    if (!entries.length) return alert("선택한 조건에 출력할 배치 내역이 없습니다.");
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div className="space-y-5">
      <Panel title="정산 조건">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="정산월"><TextInput type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></Field>
          <Field label="거래처"><SelectInput value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId("all"); }}>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</SelectInput></Field>
          <Field label="현장"><SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="all">전체 현장</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput></Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={() => downloadExcel(statement, "거래명세서")}>거래명세서 엑셀</Button>
            <Button onClick={() => downloadExcel(payroll, "노임대장")}>노임대장 엑셀</Button>
            <Button onClick={downloadClosingWorkbook} disabled={!canExportClosing}>마감자료 5종 엑셀</Button>
            <Button variant="secondary" onClick={printClosingDocuments} disabled={!canExportClosing}>PDF/인쇄</Button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="총 인원" value={`${workerCount}명`} />
        <StatCard label="총 공수" value={`${totalWorkCount}`} />
        <StatCard label="총 노무비" value={formatWon(totalLabor)} tone="mint" />
        <StatCard label="총 공제액" value={formatWon(totalDeduction)} />
        <StatCard label="총 지급액" value={formatWon(totalPayment)} tone="mint" />
        <StatCard label="서류 누락" value={`${missingDocuments}명`} />
      </div>

      <Panel title="마감자료 미리보기">
        <div className="mb-4 flex flex-wrap gap-2 no-print">
          {(Object.keys(closingDocLabels) as ClosingDocKey[]).map((key) => (
            <Button key={key} variant={previewDoc === key ? "primary" : "secondary"} onClick={() => setPreviewDoc(key)}>
              {closingDocLabels[key]}
            </Button>
          ))}
        </div>
        {canExportClosing && selectedClient && selectedSite ? (
          <ClosingDocumentsPreview activeDoc={previewDoc} data={data} entries={entries} selectedClient={selectedClient} selectedSite={selectedSite} selectedMonth={selectedMonth} />
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            마감자료 미리보기와 PDF/인쇄는 거래처와 특정 현장을 선택하면 활성화됩니다.
          </div>
        )}
      </Panel>

      <Panel title="거래명세서 집계">
        <DataTable>
          <table className="w-full border-collapse"><thead><tr>{["날짜", "현장명", "인원", "총공수", "단가", "노무비 합계", "공제액 합계", "지급액 합계"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>{statement.map((row, index) => <tr key={index}><td className={td}>{row.날짜}</td><td className={td}>{row.현장명}</td><td className={td}>{row.인원}</td><td className={td}>{row.총공수}</td><td className={td}>{formatWon(Number(row.단가))}</td><td className={td}>{formatWon(Number(row["노무비 합계"]))}</td><td className={td}>{formatWon(Number(row["공제액 합계"]))}</td><td className={td}>{formatWon(Number(row["지급액 합계"]))}</td></tr>)}</tbody></table>
        </DataTable>
      </Panel>

      <Panel title="노임대장 집계">
        <DataTable>
          <table className="w-full border-collapse"><thead><tr>{["근로자명", "연락처", "근무일수", "총공수", "노무비 합계", "공제액 합계", "지급액 합계"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>{payroll.map((row, index) => <tr key={index}><td className={td}>{row.근로자명}</td><td className={td}>{row.연락처}</td><td className={td}>{row.근무일수}</td><td className={td}>{row.총공수}</td><td className={td}>{formatWon(Number(row["노무비 합계"]))}</td><td className={td}>{formatWon(Number(row["공제액 합계"]))}</td><td className={td}>{formatWon(Number(row["지급액 합계"]))}</td></tr>)}</tbody></table>
        </DataTable>
      </Panel>
    </div>
  );
}

function countMissingClosingDocuments(entries: WorkAssignment[], data: AppData) {
  const workerIds = Array.from(new Set(entries.map((entry) => entry.workerId)));
  return workerIds.filter((workerId) => {
    const worker = data.workers.find((item) => item.id === workerId);
    return worker ? getWorkerDocumentStatus(worker) !== "완료" : false;
  }).length;
}

function ClosingDocumentsPreview({
  activeDoc,
  data,
  entries,
  selectedClient,
  selectedSite,
  selectedMonth
}: {
  activeDoc: ClosingDocKey;
  data: AppData;
  entries: WorkAssignment[];
  selectedClient: Client;
  selectedSite: Site;
  selectedMonth: string;
}) {
  return (
    <div className="print-area">
      <div className={`closing-doc ${activeDoc === "statement" ? "block" : "hidden"}`}>
        <StatementDocument data={data} entries={entries} client={selectedClient} site={selectedSite} selectedMonth={selectedMonth} />
      </div>
      <div className={`closing-doc ${activeDoc === "payroll" ? "block" : "hidden"}`}>
        <DailyPayrollDocument data={data} entries={entries} site={selectedSite} selectedMonth={selectedMonth} />
      </div>
      <div className={`closing-doc ${activeDoc === "delegation" ? "block" : "hidden"}`}>
        <DelegationDocument data={data} entries={entries} site={selectedSite} selectedMonth={selectedMonth} />
      </div>
      <div className={`closing-doc ${activeDoc === "receipt" ? "block" : "hidden"}`}>
        <ReceiptDocuments data={data} entries={entries} site={selectedSite} selectedMonth={selectedMonth} />
      </div>
      <div className={`closing-doc ${activeDoc === "application" ? "block" : "hidden"}`}>
        <WorkerProfileDocuments data={data} entries={entries} />
      </div>
    </div>
  );
}

const printTh = "border border-slate-400 bg-slate-100 px-2 py-1 text-left font-bold";
const printTd = "border border-slate-400 px-2 py-1";

function getWorkerGroups(entries: WorkAssignment[]) {
  const groups = new Map<string, WorkAssignment[]>();
  entries.forEach((entry) => groups.set(entry.workerId, [...(groups.get(entry.workerId) ?? []), entry]));
  return Array.from(groups.values()).sort((a, b) => a[0].workerId.localeCompare(b[0].workerId));
}

function getClosingPeriodLabel(selectedMonth: string) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${selectedMonth}-01 ~ ${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
}

function getWorkerTotal(items: WorkAssignment[], data: AppData) {
  const displayItems = items.map((item) => getDisplayAssignment(item, data));
  return {
    workDays: new Set(items.map((item) => item.workDate)).size,
    workCount: items.reduce((sum, item) => sum + item.workCount, 0),
    laborCost: displayItems.reduce((sum, item) => sum + item.laborCost, 0),
    employmentInsurance: displayItems.reduce((sum, item) => sum + item.employmentInsurance, 0),
    healthInsurance: displayItems.reduce((sum, item) => sum + item.healthInsurance, 0),
    nationalPension: displayItems.reduce((sum, item) => sum + item.nationalPension, 0),
    longTermCare: displayItems.reduce((sum, item) => sum + item.longTermCare, 0),
    deductionAmount: displayItems.reduce((sum, item) => sum + item.deductionAmount, 0),
    paymentAmount: displayItems.reduce((sum, item) => sum + item.paymentAmount, 0)
  };
}

function getStatementRows(entries: WorkAssignment[], data: AppData, site: Site) {
  const map = new Map<string, { date: string; siteName: string; workerCount: number; workCount: number; unitPrice: number; grossLabor: number; laborCost: number; serviceFee: number; etcAmount: number; totalAmount: number }>();
  entries.forEach((entry) => {
    const display = getDisplayAssignment(entry, data);
    const siteName = data.sites.find((item) => item.id === entry.siteId)?.siteName || data.sites.find((item) => item.id === entry.siteId)?.name || site.siteName;
    const key = `${entry.workDate}-${entry.siteId}-${entry.unitPrice}`;
    const current = map.get(key) ?? { date: entry.workDate, siteName, workerCount: 0, workCount: 0, unitPrice: entry.unitPrice, grossLabor: 0, laborCost: 0, serviceFee: 0, etcAmount: 0, totalAmount: 0 };
    const grossLabor = display.laborCost;
    const laborCost = site.invoiceIssueType === "ISSUED" ? Math.round(grossLabor * (1 - (site.invoiceDeductionRate ?? 0))) : grossLabor;
    const serviceFee = site.invoiceIssueType === "ISSUED" ? grossLabor - laborCost : 0;
    current.workerCount += 1;
    current.workCount += display.workCount;
    current.grossLabor += grossLabor;
    current.laborCost += laborCost;
    current.serviceFee += serviceFee;
    current.totalAmount += grossLabor;
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date) || a.siteName.localeCompare(b.siteName));
}

function getDocumentStatusLabel(worker?: Worker) {
  return worker ? getWorkerDocumentStatus(worker) : "미등록";
}

function PrintPage({ title, subtitle, orientation = "portrait", companyInfo, children }: { title: string; subtitle?: string; orientation?: "portrait" | "landscape"; companyInfo?: AppData["companyInfo"]; children: ReactNode }) {
  return (
    <section className={`print-page print-paper ${orientation === "landscape" ? "print-landscape" : ""}`}>
      <div className="mb-5 border-b-2 border-slate-900 pb-3 text-center">
        {companyInfo && <p className="mb-1 text-xs font-semibold text-slate-500">{companyInfo.companyName} ? {companyInfo.businessNumber} ? {companyInfo.companyPhone}</p>}
        <h2 className="text-2xl font-black tracking-normal">{title}</h2>
        {subtitle && <p className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</p>}
      </div>
      {children}
      {companyInfo && (
        <div className="mt-6 border-t border-slate-300 pt-2 text-[11px] text-slate-500">
          {companyInfo.companyName} / ?? {companyInfo.companyRepresentative} / {companyInfo.companyAddress} / {companyInfo.bankAccountText}
        </div>
      )}
    </section>
  );
}

function StatementDocument({ data, entries, client, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; client: Client; site: Site; selectedMonth: string }) {
  const rows = getStatementRows(entries, data, site);
  const totals = rows.reduce((sum, row) => ({
    workerCount: sum.workerCount + row.workerCount,
    workCount: sum.workCount + row.workCount,
    grossLabor: sum.grossLabor + row.grossLabor,
    laborCost: sum.laborCost + row.laborCost,
    serviceFee: sum.serviceFee + row.serviceFee,
    etcAmount: sum.etcAmount + row.etcAmount,
    totalAmount: sum.totalAmount + row.totalAmount
  }), { workerCount: 0, workCount: 0, grossLabor: 0, laborCost: 0, serviceFee: 0, etcAmount: 0, totalAmount: 0 });
  return (
    <PrintPage title="거래명세서" subtitle={`${client.name} / ${site.siteName} / ${getClosingPeriodLabel(selectedMonth)}`}>
      <table className="mb-4 w-full border-collapse text-sm"><tbody>
        <tr><th className={printTh}>공급자</th><td className={printTd}>{data.companyInfo.companyName}</td><th className={printTh}>거래처</th><td className={printTd}>{client.name}</td></tr>
        <tr><th className={printTh}>사업자번호</th><td className={printTd}>{data.companyInfo.businessNumber}</td><th className={printTh}>연락처</th><td className={printTd}>{data.companyInfo.companyPhone}</td></tr>
        <tr><th className={printTh}>현장명</th><td className={printTd}>{site.siteName}</td><th className={printTh}>계산서</th><td className={printTd}>{site.invoiceIssueType === "ISSUED" ? `발행 / 수수료율 ${Math.round((site.invoiceDeductionRate ?? 0) * 100)}%` : "미발행"}</td></tr>
        <tr><th className={printTh}>마감일</th><td className={printTd}>{site.closingDay}일</td><th className={printTh}>결제일</th><td className={printTd}>{site.paymentDay}일</td></tr>
      </tbody></table>
      <table className="w-full border-collapse text-sm"><thead><tr>{["날짜", "현장명", "인원", "단가", "노임총액", "노무비", "수수료", "기타", "합계"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {rows.map((row, index) => <tr key={index}><td className={printTd}>{formatDateDot(row.date)}</td><td className={printTd}>{row.siteName}</td><td className={printTd}>{row.workerCount}</td><td className={printTd}>{formatWon(row.unitPrice)}</td><td className={printTd}>{formatWon(row.grossLabor)}</td><td className={printTd}>{formatWon(row.laborCost)}</td><td className={printTd}>{formatWon(row.serviceFee)}</td><td className={printTd}>{formatWon(row.etcAmount)}</td><td className={printTd}>{formatWon(row.totalAmount)}</td></tr>)}
        <tr><th className={printTh} colSpan={2}>합계</th><td className={printTd}>{totals.workerCount}</td><td className={printTd}></td><td className={printTd}>{formatWon(totals.grossLabor)}</td><td className={printTd}>{formatWon(totals.laborCost)}</td><td className={printTd}>{formatWon(totals.serviceFee)}</td><td className={printTd}>{formatWon(totals.etcAmount)}</td><td className={printTd}>{formatWon(totals.totalAmount)}</td></tr>
      </tbody></table>
      <div className="mt-6 grid grid-cols-2 gap-8 text-sm"><p>작성일: {formatDateDot(today)}</p><p className="text-right">확인: ____________________</p></div>
    </PrintPage>
  );
}

function DailyPayrollDocument({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  const workerGroups = getWorkerGroups(entries);
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));
  return (
    <PrintPage title="일용노무비지급명세서" subtitle={`${site.siteName} / ${getClosingPeriodLabel(selectedMonth)}`} orientation="landscape">
      <table className="w-full border-collapse text-[10px] leading-tight"><thead><tr>{["성명", "연락처", "주민등록번호", "주소", ...days.map((day) => `${Number(day)}일`), "일수", "공수", "노임총액", "고용", "건강", "국민연금", "장기요양", "차감지급액", "서명"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {workerGroups.map((items) => {
          const worker = data.workers.find((item) => item.id === items[0].workerId);
          const total = getWorkerTotal(items, data);
          const dayValues = days.map((day) => items.filter((item) => item.workDate.endsWith(`-${day}`)).reduce((sum, item) => sum + item.workCount, 0));
          return <tr key={items[0].workerId}><td className={printTd}>{worker?.name}</td><td className={printTd}>{worker?.mobile || worker?.phone}</td><td className={printTd}>{worker?.residentNumber}</td><td className={`${printTd} max-w-40 whitespace-normal`}>{worker?.address}</td>{dayValues.map((value, index) => <td key={index} className={`${printTd} text-center`}>{value || ""}</td>)}<td className={printTd}>{total.workDays}</td><td className={printTd}>{total.workCount}</td><td className={printTd}>{formatWon(total.laborCost)}</td><td className={printTd}>{formatWon(total.employmentInsurance)}</td><td className={printTd}>{formatWon(total.healthInsurance)}</td><td className={printTd}>{formatWon(total.nationalPension)}</td><td className={printTd}>{formatWon(total.longTermCare)}</td><td className={printTd}>{formatWon(total.paymentAmount)}</td><td className={printTd}>{worker?.signatureDataUrl ? <img src={worker.signatureDataUrl} alt="서명" className="h-9 w-16 object-contain" /> : ""}</td></tr>;
        })}
      </tbody></table>
    </PrintPage>
  );
}

function DelegationDocument({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  const workerGroups = getWorkerGroups(entries);
  return (
    <PrintPage title="위임장" subtitle={`${site.siteName} / ${getClosingPeriodLabel(selectedMonth)}`}>
      <div className="space-y-3 text-sm leading-7">
        <p>아래 근로자는 해당 현장의 일용노무비 수령 및 정산자료 제출 업무를 {data.companyInfo.companyName}에 위임합니다.</p>
        <p><b>회사명</b> {data.companyInfo.companyName} / <b>대표자</b> {data.companyInfo.companyRepresentative} / <b>사업자번호</b> {data.companyInfo.businessNumber}</p>
        <p><b>주소</b> {data.companyInfo.companyAddress} / <b>연락처</b> {data.companyInfo.companyPhone}</p>
      </div>
      <table className="mt-5 w-full border-collapse text-sm"><thead><tr>{["성명", "주민등록번호", "주소", "지급액", "서명/도장"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {workerGroups.map((items) => {
          const worker = data.workers.find((item) => item.id === items[0].workerId);
          const total = getWorkerTotal(items, data);
          return <tr key={items[0].workerId}><td className={printTd}>{worker?.name}</td><td className={printTd}>{worker?.residentNumber}</td><td className={printTd}>{worker?.address}</td><td className={printTd}>{formatWon(total.paymentAmount)}</td><td className={printTd}>{worker?.signatureDataUrl ? <img src={worker.signatureDataUrl} alt="서명" className="h-12 w-24 object-contain" /> : ""}</td></tr>;
        })}
      </tbody></table>
      <p className="mt-8 text-right text-sm">작성일: {formatDateDot(today)}</p>
    </PrintPage>
  );
}

function ReceiptDocuments({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  return <>{getWorkerGroups(entries).map((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const total = getWorkerTotal(items, data);
    return (
      <PrintPage key={items[0].workerId} title="근로자 영수증" subtitle={`${site.siteName} / ${getClosingPeriodLabel(selectedMonth)}`}>
        <table className="mb-5 w-full border-collapse text-sm"><tbody>
          <tr><th className={printTh}>성명</th><td className={printTd}>{worker?.name}</td><th className={printTh}>주민등록번호</th><td className={printTd}>{worker?.residentNumber}</td></tr>
          <tr><th className={printTh}>주소</th><td className={printTd} colSpan={3}>{worker?.address}</td></tr>
          <tr><th className={printTh}>근무일수</th><td className={printTd}>{total.workDays}일</td><th className={printTh}>총 공수</th><td className={printTd}>{total.workCount}</td></tr>
          <tr><th className={printTh}>노임총액</th><td className={printTd}>{formatWon(total.laborCost)}</td><th className={printTh}>공제액</th><td className={printTd}>{formatWon(total.deductionAmount)}</td></tr>
          <tr><th className={printTh}>수령금액</th><td className={printTd} colSpan={3}>{formatWon(total.paymentAmount)}</td></tr>
        </tbody></table>
        <p className="mb-8 text-sm leading-7">상기 금액을 해당 기간 동안의 일용노무비로 정히 수령하였음을 확인합니다.</p>
        <div className="flex items-end justify-end gap-6"><span>수령인: {worker?.name}</span>{worker?.signatureDataUrl && <img src={worker.signatureDataUrl} alt="서명" className="h-20 w-28 object-contain" />}</div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"><DocumentImage title="신분증 앞면" value={worker ? getWorkerDocumentDataUrl(worker, "ID_FRONT") : undefined} /><DocumentImage title="신분증 뒷면" value={worker ? getWorkerDocumentDataUrl(worker, "ID_BACK") : undefined} /></div>
      </PrintPage>
    );
  })}</>;
}

function WorkerProfileDocuments({ data, entries }: { data: AppData; entries: WorkAssignment[] }) {
  const workerIds = Array.from(new Set(entries.map((entry) => entry.workerId)));
  return <>{workerIds.map((workerId) => {
    const worker = data.workers.find((item) => item.id === workerId);
    if (!worker) return null;
    return (
      <PrintPage key={worker.id} title="근로자 신상명세서" subtitle={`근로자코드 ${worker.workerCode || "자동생성"}`}>
        <table className="mb-5 w-full border-collapse text-sm"><tbody>
          <tr><th className={printTh}>성명</th><td className={printTd}>{worker.name}</td><th className={printTh}>주민등록번호</th><td className={printTd}>{worker.residentNumber}</td></tr>
          <tr><th className={printTh}>생년월일</th><td className={printTd}>{worker.birthDate}</td><th className={printTh}>연락처</th><td className={printTd}>{worker.mobile || worker.phone}</td></tr>
          <tr><th className={printTh}>주소</th><td className={printTd} colSpan={3}>{worker.address}</td></tr>
          <tr><th className={printTh}>직종</th><td className={printTd}>{worker.jobType}</td><th className={printTh}>경력</th><td className={printTd}>{worker.career}</td></tr>
          <tr><th className={printTh}>자격증</th><td className={printTd}>{worker.certifications}</td><th className={printTh}>서류상태</th><td className={printTd}>{getDocumentStatusLabel(worker)}</td></tr>
        </tbody></table>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><DocumentImage title="신분증 앞면" value={getWorkerDocumentDataUrl(worker, "ID_FRONT")} /><DocumentImage title="신분증 뒷면" value={getWorkerDocumentDataUrl(worker, "ID_BACK")} /><DocumentImage title="이수증" value={getWorkerDocumentDataUrl(worker, "SAFETY_CERTIFICATE")} /></div>
        <div className="mt-6 flex items-end justify-end gap-4"><span>신청인: {worker.name}</span>{worker.signatureDataUrl && <img src={worker.signatureDataUrl} alt="서명/도장" className="h-20 w-28 object-contain" />}</div>
      </PrintPage>
    );
  })}</>;
}
function ReceivablesView({
  data,
  updateData,
  selectedMonth,
  setSelectedMonth
}: {
  data: AppData;
  updateData: (data: AppData) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}) {
  const [clientFilter, setClientFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMemo, setPaymentMemo] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const rows = buildReceivableRows(data, selectedMonth)
    .filter((row) => clientFilter === "all" || row.clientId === clientFilter)
    .filter((row) => row.clientName.toLowerCase().includes(clientSearch.toLowerCase()))
    .filter((row) => row.siteName.toLowerCase().includes(siteSearch.toLowerCase()));
  const selectedRow = rows.find((row) => row.key === selectedKey) ?? rows[0];
  const selectedSite = selectedRow ? data.sites.find((site) => site.id === selectedRow.siteId) : undefined;
  const totalReceivable = rows.reduce((sum, row) => sum + row.balanceAmount, 0);
  const totalClaim = rows.reduce((sum, row) => sum + row.claimAmount, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.paidAmount, 0);
  const overdueReceivable = rows.reduce((sum, row) => sum + (row.overdueDays > 0 ? row.balanceAmount : 0), 0);
  const overdueCount = rows.filter((row) => row.balanceAmount > 0 && row.overdueDays > 0).length;
  const clientTotals = data.clients.map((client) => {
    const clientRows = rows.filter((row) => row.clientId === client.id);
    return {
      client,
      claim: clientRows.reduce((sum, row) => sum + row.claimAmount, 0),
      paid: clientRows.reduce((sum, row) => sum + row.paidAmount, 0),
      balance: clientRows.reduce((sum, row) => sum + row.balanceAmount, 0),
      overdue: clientRows.reduce((sum, row) => sum + (row.overdueDays > 0 ? row.balanceAmount : 0), 0)
    };
  }).filter((item) => item.claim > 0 || item.paid > 0 || item.balance > 0);
  const siteTotals = rows
    .map((row) => ({ siteId: row.siteId, siteName: row.siteName, claim: row.claimAmount, paid: row.paidAmount, balance: row.balanceAmount, overdueDays: row.overdueDays }))
    .filter((item) => item.claim > 0 || item.paid > 0 || item.balance > 0);
  const paymentHistory = selectedRow
    ? data.receivablePayments
      .filter((payment) => payment.siteId === selectedRow.siteId && payment.closingMonth === selectedMonth)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
    : [];

  const addPayment = (amount: number, memo = paymentMemo) => {
    if (!selectedRow) return alert("입금 처리할 현장을 선택해 주세요.");
    if (!amount || amount <= 0) return alert("입금금액을 입력해 주세요.");
    updateData({
      ...data,
      receivablePayments: [
        ...data.receivablePayments,
        {
          id: createId("rp"),
          clientId: selectedRow.clientId,
          siteId: selectedRow.siteId,
          closingMonth: selectedMonth,
          amount,
          paymentDate,
          memo
        }
      ]
    });
    setPaymentAmount("");
    setPaymentMemo("");
  };

  const savePayment = () => addPayment(Number(paymentAmount));
  const saveFullPayment = () => {
    if (!selectedRow) return alert("완납 처리할 현장을 선택해 주세요.");
    if (selectedRow.balanceAmount <= 0) return alert("이미 완납된 현장입니다.");
    addPayment(selectedRow.balanceAmount, paymentMemo || "완납 처리");
  };

  const updatePaymentDay = (paymentDay: number) => {
    if (!selectedRow || !selectedSite) return;
    const safeDay = Math.min(Math.max(paymentDay || 1, 1), 31);
    updateData({
      ...data,
      sites: data.sites.map((site) => site.id === selectedRow.siteId ? { ...site, paymentDay: safeDay } : site)
    });
  };

  const downloadExcel = async () => {
    const XLSX = await import("xlsx");
    const sheetRows = rows.map((row) => ({
      거래처명: row.clientName,
      현장명: row.siteName,
      청구금액: row.claimAmount,
      입금금액: row.paidAmount,
      미수금액: row.balanceAmount,
      계산서발행여부: row.invoiceIssueType === "ISSUED" ? "계산서 발행" : "계산서 미발행",
      마감월: row.closingMonth,
      마감일: row.closingDay,
      결제예정일: row.expectedPaymentDate,
      연체일수: row.overdueDays,
      입금일: row.paymentDates,
      상태: row.status,
      비고: row.memo
    }));
    const clientSheetRows = clientTotals.map((item) => ({
      거래처명: item.client.name,
      청구금액: item.claim,
      입금금액: item.paid,
      미수금액: item.balance,
      연체금액: item.overdue
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), "전체 미수금");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(clientSheetRows), "거래처별 합계");
    XLSX.writeFile(book, `전체_미수금_${selectedMonth}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <Panel title="미수금 조회 조건">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="마감월"><TextInput type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></Field>
          <Field label="거래처"><SelectInput value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}><option value="all">전체 거래처</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</SelectInput></Field>
          <Field label="거래처 검색"><TextInput value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} /></Field>
          <Field label="현장 검색"><TextInput value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} /></Field>
          <div className="flex items-end"><Button onClick={downloadExcel}>미수금 엑셀 출력</Button></div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="전체 청구금액" value={formatWon(totalClaim)} />
        <StatCard label="전체 입금금액" value={formatWon(totalPaid)} tone="mint" />
        <StatCard label="전체 미수금" value={formatWon(totalReceivable)} />
        <StatCard label="연체 미수금" value={formatWon(overdueReceivable)} />
        <StatCard label="연체 현장" value={`${overdueCount}건`} />
      </div>

      <Panel title="거래처별 미수금 합계">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["거래처명", "청구금액", "입금금액", "미수금액", "연체금액"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
            <tbody>
              {clientTotals.map((item) => (
                <tr key={item.client.id}>
                  <td className={td}>{item.client.name}</td>
                  <td className={td}>{formatWon(item.claim)}</td>
                  <td className={td}>{formatWon(item.paid)}</td>
                  <td className={td}>{formatWon(item.balance)}</td>
                  <td className={td}>{formatWon(item.overdue)}</td>
                </tr>
              ))}
              {clientTotals.length === 0 && <tr><td className={td} colSpan={5}>미수금 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="현장별 미수금 합계">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["현장명", "청구금액", "입금금액", "미수금액", "연체일수"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
            <tbody>
              {siteTotals.map((item) => (
                <tr key={item.siteId}>
                  <td className={td}>{item.siteName}</td>
                  <td className={td}>{formatWon(item.claim)}</td>
                  <td className={td}>{formatWon(item.paid)}</td>
                  <td className={td}>{formatWon(item.balance)}</td>
                  <td className={td}>{item.overdueDays > 0 ? `${item.overdueDays}일` : "-"}</td>
                </tr>
              ))}
              {siteTotals.length === 0 && <tr><td className={td} colSpan={5}>현장별 미수금이 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="전체 미수금 목록">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["거래처명", "현장명", "청구금액", "입금금액", "미수금액", "계산서", "마감월", "마감일", "결제예정일", "연체일수", "입금일", "상태", "비고"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key} className={selectedRow?.key === row.key ? "bg-mint-50" : ""}><td className={td}><button className="font-bold text-navy-900" onClick={() => setSelectedKey(row.key)}>{row.clientName}</button></td><td className={td}>{row.siteName}</td><td className={td}>{formatWon(row.claimAmount)}</td><td className={td}>{formatWon(row.paidAmount)}</td><td className={td}>{formatWon(row.balanceAmount)}</td><td className={td}>{row.invoiceIssueType === "ISSUED" ? "발행" : "미발행"}</td><td className={td}>{row.closingMonth}</td><td className={td}>{row.closingDay}</td><td className={td}>{row.expectedPaymentDate}</td><td className={td}>{row.overdueDays > 0 ? `${row.overdueDays}일` : "-"}</td><td className={td}>{row.paymentDates}</td><td className={td}><ReceivableStatusBadge status={row.status} /></td><td className={td}>{row.memo}</td></tr>)}</tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="입금 및 결제예정일 관리">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="선택 현장"><TextInput value={selectedRow ? `${selectedRow.clientName} / ${selectedRow.siteName}` : ""} readOnly /></Field>
          <Field label="미수금액"><TextInput value={selectedRow ? formatWon(selectedRow.balanceAmount) : ""} readOnly /></Field>
          <Field label="결제예정일"><TextInput value={selectedRow?.expectedPaymentDate ?? ""} readOnly /></Field>
          <Field label="결제일"><TextInput type="number" min={1} max={31} value={selectedSite?.paymentDay ?? selectedRow?.paymentDay ?? ""} onChange={(e) => updatePaymentDay(Number(e.target.value))} /></Field>
          <Field label="입금금액"><TextInput type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field>
          <Field label="입금일"><TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
          <Field label="입금메모"><TextInput value={paymentMemo} onChange={(e) => setPaymentMemo(e.target.value)} /></Field>
          <div className="flex items-end gap-2"><Button onClick={savePayment}>부분입금 처리</Button><Button variant="secondary" onClick={saveFullPayment}>완납 처리</Button></div>
        </div>
        <div className="mt-4 rounded-md border border-navy-100 bg-white p-3">
          <p className="mb-2 text-sm font-bold text-navy-900">선택 현장 입금 이력</p>
          <DataTable>
            <table className="w-full border-collapse">
              <thead><tr>{["입금일", "입금금액", "메모"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
              <tbody>
                {paymentHistory.map((payment) => <tr key={payment.id}><td className={td}>{payment.paymentDate}</td><td className={td}>{formatWon(payment.amount)}</td><td className={td}>{payment.memo}</td></tr>)}
                {paymentHistory.length === 0 && <tr><td className={td} colSpan={3}>입금 이력이 없습니다.</td></tr>}
              </tbody>
            </table>
          </DataTable>
        </div>
      </Panel>
    </div>
  );
}

function WorkerJournalView({ data }: { data: AppData }) {
  const [workerId, setWorkerId] = useState(data.workers[0]?.id ?? "");
  const [startDate, setStartDate] = useState(`${currentMonth}-01`);
  const [endDate, setEndDate] = useState(today);
  const [siteId, setSiteId] = useState("all");
  const worker = data.workers.find((item) => item.id === workerId);
  const rows = data.assignments
    .filter((assignment) => assignment.status !== "취소")
    .filter((assignment) => assignment.workerId === workerId)
    .filter((assignment) => assignment.workDate >= startDate && assignment.workDate <= endDate)
    .filter((assignment) => siteId === "all" || assignment.siteId === siteId)
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map((assignment) => {
      const client = data.clients.find((item) => item.id === assignment.clientId);
      const site = data.sites.find((item) => item.id === assignment.siteId);
      return {
        assignment,
        clientName: client?.name ?? "",
        siteName: site?.siteName || site?.name || "",
        siteCode: site?.siteCode || site?.code || "",
        jobType: worker?.jobType || "일용",
        taskDescription: assignment.taskDescription,
        laborCost: assignment.laborCost,
        deductionAmount: assignment.deductionAmount,
        paymentAmount: assignment.paymentAmount,
        memo: assignment.memo
      };
    });
  const workerSiteIds = Array.from(new Set(data.assignments.filter((assignment) => assignment.workerId === workerId).map((assignment) => assignment.siteId)));
  const workerSites = data.sites.filter((site) => workerSiteIds.includes(site.id));
  const workDays = new Set(rows.map((row) => row.assignment.workDate)).size;
  const totalLabor = rows.reduce((sum, row) => sum + row.laborCost, 0);
  const totalDeduction = rows.reduce((sum, row) => sum + row.deductionAmount, 0);
  const totalPayment = rows.reduce((sum, row) => sum + row.paymentAmount, 0);

  const downloadExcel = async () => {
    const XLSX = await import("xlsx");
    const sheetRows = rows.map((row) => ({
      근무일자: formatDateDot(row.assignment.workDate),
      거래처명: row.clientName,
      현장명: row.siteName,
      현장코드: row.siteCode,
      근무직종: row.jobType,
      작업내용: row.taskDescription,
      일급여: row.laborCost,
      공제금액: row.deductionAmount,
      실지급액: row.paymentAmount,
      비고: row.memo
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), "개인근무일지");
    XLSX.writeFile(book, `${worker?.name ?? "근로자"}_${startDate}_${endDate}_개인근무일지.xlsx`);
  };

  const printJournal = () => window.print();

  return (
    <div className="space-y-5">
      <Panel title="근로자 개인일지 조회조건">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="근로자 선택">
            <SelectInput value={workerId} onChange={(event) => { setWorkerId(event.target.value); setSiteId("all"); }}>
              {data.workers.map((item) => <option key={item.id} value={item.id}>{item.workerCode} {item.name}</option>)}
            </SelectInput>
          </Field>
          <Field label="시작일"><TextInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
          <Field label="종료일"><TextInput type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          <Field label="현장명">
            <SelectInput value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="all">전체 현장</option>
              {workerSites.map((site) => <option key={site.id} value={site.id}>{site.siteName || site.name}</option>)}
            </SelectInput>
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={downloadExcel}>개인근무일지 엑셀</Button>
            <Button variant="secondary" onClick={printJournal}>인쇄/PDF</Button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="근무일수" value={`${workDays}일`} />
        <StatCard label="총 노무비" value={formatWon(totalLabor)} tone="mint" />
        <StatCard label="총 공제액" value={formatWon(totalDeduction)} />
        <StatCard label="총 지급액" value={formatWon(totalPayment)} tone="mint" />
      </div>

      <Panel title={`${worker?.name ?? "근로자"} 개인 근무일지`}>
        <DataTable>
          <table className="w-full border-collapse">
            <thead>
              <tr>{["근무일자", "거래처명", "현장명", "현장코드", "근무직종", "작업내용", "일급여", "공제금액", "실지급액", "비고"].map((header) => <th key={header} className={th}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.assignment.id}>
                  <td className={td}>{formatDateDot(row.assignment.workDate)}</td>
                  <td className={td}>{row.clientName}</td>
                  <td className={td}>{row.siteName}</td>
                  <td className={td}>{row.siteCode}</td>
                  <td className={td}>{row.jobType}</td>
                  <td className={td}>{row.taskDescription}</td>
                  <td className={td}>{formatWon(row.laborCost)}</td>
                  <td className={td}>{formatWon(row.deductionAmount)}</td>
                  <td className={td}>{formatWon(row.paymentAmount)}</td>
                  <td className={td}>{row.memo}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className={td} colSpan={10}>조회된 근무이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </DataTable>
      </Panel>
    </div>
  );
}

function SettingsView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const updateCompanyInfo = (key: keyof AppData["companyInfo"], value: string) => {
    updateData({ ...data, companyInfo: { ...data.companyInfo, [key]: value } });
  };

  const updatePermission = (viewKey: ViewKey, role: UserRole, checked: boolean) => {
    const accessControl = data.accessControl;
    updateData({
      ...data,
      accessControl: {
        ...accessControl,
        menuPermissions: accessControl.menuPermissions.map((permission) =>
          permission.viewKey === viewKey ? { ...permission, [role === "ADMIN" ? "admin" : "user"]: checked } : permission
        )
      }
    });
  };

  const updateSensitivePermission = (viewKey: ViewKey, checked: boolean) => {
    const accessControl = data.accessControl;
    updateData({
      ...data,
      accessControl: {
        ...accessControl,
        menuPermissions: accessControl.menuPermissions.map((permission) =>
          permission.viewKey === viewKey ? { ...permission, sensitive: checked } : permission
        )
      }
    });
  };

  const updateSensitiveProtection = (checked: boolean) => {
    updateData({ ...data, accessControl: { ...data.accessControl, sensitiveProtectionEnabled: checked } });
  };

  const accessControl = data.accessControl;

  return (
    <div className="space-y-5">
      <Panel title="회사 기본정보 관리">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="업체명"><TextInput value={data.companyInfo.companyName} onChange={(event) => updateCompanyInfo("companyName", event.target.value)} /></Field>
          <Field label="사업자번호"><TextInput value={data.companyInfo.businessNumber} onChange={(event) => updateCompanyInfo("businessNumber", event.target.value)} /></Field>
          <Field label="대표자"><TextInput value={data.companyInfo.companyRepresentative} onChange={(event) => updateCompanyInfo("companyRepresentative", event.target.value)} /></Field>
          <Field label="연락처"><TextInput value={data.companyInfo.companyPhone} onChange={(event) => updateCompanyInfo("companyPhone", event.target.value)} /></Field>
          <div className="lg:col-span-2"><Field label="주소"><TextInput value={data.companyInfo.companyAddress} onChange={(event) => updateCompanyInfo("companyAddress", event.target.value)} /></Field></div>
          <div className="xl:col-span-2 lg:col-span-3"><Field label="입금계좌/비고"><TextInput value={data.companyInfo.bankAccountText} onChange={(event) => updateCompanyInfo("bankAccountText", event.target.value)} /></Field></div>
        </div>
      </Panel>

      <Panel title="역할 및 메뉴 접근 권한">
        <div className="mb-3 grid grid-cols-1 gap-3 rounded-md bg-navy-50 p-3 text-sm font-bold text-navy-900 sm:grid-cols-3">
          <span>?? ??: {roleLabels[accessControl.currentRole]}</span>
          <span>???: ?? ?? ?? ??</span>
          <span>?????: ??? ??? ??</span>
        </div>
        <label className="mb-3 flex min-h-11 items-center gap-2 rounded-md border border-navy-100 bg-white px-3 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={Boolean(accessControl.sensitiveProtectionEnabled)} onChange={(event) => updateSensitiveProtection(event.target.checked)} />
          ???? ?? ?? ??
        </label>
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["??", "??? ??", "????? ??", "????"].map((header) => <th key={header} className={th}>{header}</th>)}</tr></thead>
            <tbody>
              {menus.map((menu) => {
                const permission = accessControl.menuPermissions.find((item) => item.viewKey === menu.key);
                return (
                  <tr key={menu.key}>
                    <td className={td}>{menu.label}</td>
                    <td className={td}><input type="checkbox" checked={permission?.admin !== false} onChange={(event) => updatePermission(menu.key, "ADMIN", event.target.checked)} /></td>
                    <td className={td}><input type="checkbox" checked={Boolean(permission?.user)} onChange={(event) => updatePermission(menu.key, "USER", event.target.checked)} /></td>
                    <td className={td}><input type="checkbox" checked={Boolean(permission?.sensitive)} onChange={(event) => updateSensitivePermission(menu.key, event.target.checked)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </Panel>
    </div>
  );
}

function HelpView() {
  const sections = [
    {
      title: "처음 사용하는 순서",
      items: [
        "설정에서 회사 기본정보와 권한 구조를 먼저 확인합니다.",
        "거래현장 관리에서 거래처를 등록한 뒤, 해당 거래처의 현장을 추가합니다.",
        "근로자 관리에서 근로자 기본정보와 필수 서류를 등록합니다.",
        "요청·배치 입력에서 날짜별 요청인원과 실제 배치 근로자를 입력합니다.",
        "월말 정산에서 현장별 정산자료를 확인하고 출력합니다.",
        "전체 미수금 관리에서 청구/입금/미수 상태를 계속 확인합니다."
      ]
    },
    {
      title: "거래처/현장 등록",
      items: [
        "거래처 신규 버튼으로 업체명, 연락처, 이메일, 마감일, 결제일을 저장합니다.",
        "거래처를 선택한 뒤 현장 신규 버튼으로 현장명, 담당자, 계산서 발행 여부를 저장합니다.",
        "현장 기본 단가와 공제 유형은 요청·배치 입력 시 자동 기본값으로 사용됩니다.",
        "좌측 트리에서 거래처를 누르면 하위 현장 목록이 표시되고, 현장을 누르면 상세정보를 수정할 수 있습니다."
      ]
    },
    {
      title: "근로자 등록 및 서류 업로드",
      items: [
        "근로자 이름, 생년월일, 연락처, 주소, 직종을 입력한 뒤 등록합니다.",
        "신분증 앞면, 신분증 뒷면, 기초안전보건교육 이수증, 기타 첨부파일을 각각 업로드할 수 있습니다.",
        "이미지 파일은 썸네일로 미리 볼 수 있고, 파일명/업로드일을 확인할 수 있습니다.",
        "서류상태는 필수 서류 등록 여부에 따라 자동으로 완료/일부누락/미확인으로 판단됩니다.",
        "도장/서명은 이름 기준으로 자동 생성되며 신상명세서 출력에 반영됩니다."
      ]
    },
    {
      title: "요청·배치 입력",
      items: [
        "요청건 등록에서 근무일, 거래처, 현장, 요청인원, 단가, 공제유형을 입력합니다.",
        "요청건을 선택한 뒤 근로자를 선택해 실제 배치내역을 저장합니다.",
        "배치인원, 부족인원, 요청 대비 배치율은 자동 계산됩니다.",
        "일괄 배치는 실제 배치인원을 입력하면 가능한 근로자 목록에서 한 번에 배치합니다.",
        "공제 판단 사유와 수동 공제 입력값은 배치 저장 전 미리 확인할 수 있습니다."
      ]
    },
    {
      title: "정산/마감/미수금 관리",
      items: [
        "월말 정산에서 정산월, 거래처, 현장을 선택하면 거래명세서와 지급명세서 자료가 생성됩니다.",
        "마감자료 5종 엑셀 다운로드와 PDF/인쇄 미리보기를 사용할 수 있습니다.",
        "전체 미수금 관리에서는 거래처별 청구금액, 입금금액, 미수금액, 결제예정일, 연체일수를 확인합니다.",
        "부분입금은 입금액을 누적해 처리하고, 잔액이 0원이 되면 완납 상태로 표시됩니다.",
        "대시보드에는 미수금 합계, 결제 예정 금액, 부족인원, 서류 미비 근로자 등이 연결됩니다."
      ]
    },
    {
      title: "백업/복원",
      items: [
        "상단 JSON 백업 버튼으로 현재 데이터를 파일로 내려받습니다.",
        "JSON 불러오기 버튼으로 백업 파일을 복원할 수 있습니다.",
        "첨부파일 Base64 데이터와 Supabase Storage 메타데이터도 백업 데이터에 포함됩니다.",
        "샘플 데이터 생성은 테스트용이며, 운영 데이터가 있는 경우 사용 전 백업을 권장합니다.",
        "localStorage 초기화는 현재 브라우저의 로컬 데이터를 지우므로 신중히 사용합니다."
      ]
    },
    {
      title: "모바일 사용 안내",
      items: [
        "모바일에서는 입력폼이 1열 카드형으로 표시됩니다.",
        "표는 모바일에서 카드 리스트로 바뀌며, 상세정보를 눌러 숨은 항목을 확인합니다.",
        "출력물 미리보기는 PC/A4 기준 레이아웃을 유지하므로 최종 인쇄는 PC 사용을 권장합니다.",
        "첨부파일 업로드는 휴대폰 카메라/앨범 파일 선택을 사용할 수 있습니다.",
        "긴 버튼과 라벨은 줄바꿈되므로 화면을 가로로 밀지 않고 세로 스크롤로 사용합니다."
      ]
    }
  ];

  return (
    <div className="space-y-5">
      <Panel title="운영자 사용 가이드">
        <div className="rounded-md bg-navy-50 p-4 text-sm leading-7 text-navy-900">
          <p className="font-bold">이 화면은 처음 사용하는 운영자가 업무 순서대로 앱을 설정하고 운용할 수 있도록 만든 도움말입니다.</p>
          <p className="mt-1 text-slate-600">운영 전에는 회사정보, 거래처/현장, 근로자 서류, 백업 상태를 먼저 확인해 주세요.</p>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sections.map((section, index) => (
          <Panel key={section.title} title={`${index + 1}. ${section.title}`}>
            <ol className="space-y-2 text-sm leading-6 text-slate-700">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex} className="rounded-md border border-navy-100 bg-white px-3 py-2">
                  {item}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>

      <Panel title="운영 전 체크리스트">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {["회사정보 저장", "거래처/현장 등록", "근로자 서류 확인", "JSON 백업 다운로드", "요청/배치 입력 테스트", "정산자료 출력 테스트", "미수금 상태 확인", "모바일 화면 확인"].map((item) => (
            <label key={item} className="flex min-h-11 items-center gap-2 rounded-md border border-navy-100 px-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" />
              {item}
            </label>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RulesView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const [form, setForm] = useState<CalculationRule>(emptyRule);

  const recalculateRule = (next: Partial<CalculationRule>) => {
    const unitPrice = next.unitPrice ?? form.unitPrice;
    const brokerageFeeRate = next.brokerageFeeRate ?? form.brokerageFeeRate ?? 0.1;
    const invoiceIssueType = next.invoiceIssueType ?? form.invoiceIssueType ?? "NOT_ISSUED";
    const base = getWorkerBaseAmount(unitPrice, brokerageFeeRate);
    const employmentInsurance = ceilWon(next.employmentInsurance ?? form.employmentInsurance ?? 0);
    const healthInsurance = ceilWon(next.healthInsurance ?? form.healthInsurance ?? 0);
    const nationalPension = ceilWon(next.nationalPension ?? form.nationalPension ?? 0);
    const longTermCare = ceilWon(next.longTermCare ?? form.longTermCare ?? 0);
    const deductionAmount = employmentInsurance + healthInsurance + nationalPension + longTermCare;
    return {
      ...form,
      ...next,
      unitPrice,
      brokerageFeeRate,
      brokerageFee: base.brokerageFee,
      workerBaseAmount: base.workerBaseAmount,
      invoiceIssueType,
      laborCost: base.workerBaseAmount,
      employmentInsurance,
      healthInsurance,
      nationalPension,
      longTermCare,
      deductionAmount,
      paymentAmount: base.workerBaseAmount - deductionAmount
    } as CalculationRule;
  };

  const resetByFormula = (next: Partial<CalculationRule>) => {
    const unitPrice = next.unitPrice ?? form.unitPrice;
    const deductionType = next.deductionType ?? form.deductionType;
    const ageGroup = next.ageGroup ?? form.ageGroup;
    const memo = next.memo ?? form.memo;
    const invoiceIssueType = next.invoiceIssueType ?? form.invoiceIssueType ?? "NOT_ISSUED";
    const brokerageFeeRate = next.brokerageFeeRate ?? form.brokerageFeeRate ?? 0.1;
    setForm(createCalculationRule(form.id, unitPrice, deductionType, ageGroup, memo, invoiceIssueType, brokerageFeeRate));
  };

  const setMoney = (key: keyof Pick<CalculationRule, "employmentInsurance" | "healthInsurance" | "nationalPension" | "longTermCare">, value: number) => {
    setForm(recalculateRule({ [key]: value } as Partial<CalculationRule>));
  };

  const save = () => {
    const rule = { ...recalculateRule(form), id: form.id || createId("r") };
    updateData({ ...data, calculationRules: form.id ? data.calculationRules.map((item) => (item.id === rule.id ? rule : item)) : [...data.calculationRules, rule] });
    setForm(emptyRule);
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_1fr]">
      <Panel title={form.id ? "계산기준 수정" : "계산기준 등록"}>
        <div className="grid gap-3">
          <Field label="공제유형"><DeductionSelect value={form.deductionType} onChange={(value) => resetByFormula({ deductionType: value })} /></Field>
          <Field label="나이구분">
            <SelectInput value={form.ageGroup} onChange={(e) => resetByFormula({ ageGroup: e.target.value as CalculationRule["ageGroup"] })}>
              <option value="ALL">전체</option>
              <option value="UNDER_60">60세 미만</option>
              <option value="OVER_60">60세 이상</option>
            </SelectInput>
          </Field>
          <Field label="단가"><TextInput type="number" value={form.unitPrice} onChange={(e) => resetByFormula({ unitPrice: Number(e.target.value) })} /></Field>
          <Field label="알선수수료율"><TextInput type="number" step="0.01" value={form.brokerageFeeRate ?? 0.1} onChange={(e) => resetByFormula({ brokerageFeeRate: Number(e.target.value) })} /></Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-md bg-navy-50 p-3 text-sm font-bold text-navy-900">
            <span>알선수수료 {formatWon(form.brokerageFee)}</span>
            <span>근로자 기준금액 {formatWon(form.workerBaseAmount)}</span>
          </div>
          <Field label="전자계산서 발행 여부">
            <SelectInput value={form.invoiceIssueType ?? "NOT_ISSUED"} onChange={(e) => resetByFormula({ invoiceIssueType: e.target.value as CalculationRule["invoiceIssueType"] })}>
              <option value="NOT_ISSUED">전자계산서(면세) 미발행</option>
              <option value="ISSUED">전자계산서(면세) 발행</option>
            </SelectInput>
          </Field>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field label="고용공제"><TextInput type="number" value={form.employmentInsurance} onChange={(e) => setMoney("employmentInsurance", Number(e.target.value))} /></Field>
            <Field label="건강보험"><TextInput type="number" value={form.healthInsurance} onChange={(e) => setMoney("healthInsurance", Number(e.target.value))} /></Field>
            <Field label="국민연금"><TextInput type="number" value={form.nationalPension} onChange={(e) => setMoney("nationalPension", Number(e.target.value))} /></Field>
            <Field label="장기요양"><TextInput type="number" value={form.longTermCare} onChange={(e) => setMoney("longTermCare", Number(e.target.value))} /></Field>
          </div>
          <Field label="비고"><TextInput value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          <div className="rounded-md bg-mint-50 p-3 text-sm font-bold text-navy-900">총공제액 {formatWon(form.deductionAmount)} / 최종 지급액 {formatWon(form.paymentAmount)}</div>
          <div className="flex flex-wrap gap-2"><Button onClick={save}>저장</Button><Button variant="secondary" onClick={() => setForm(emptyRule)}>초기화</Button></div>
        </div>
      </Panel>

      <Panel title="단가별 계산기준 목록">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["공제유형", "나이구분", "단가", "수수료율", "알선수수료", "근로자 기준금액", "전자계산서", "고용공제", "건강보험", "국민연금", "장기요양", "총공제액", "최종 지급액", "비고", "관리"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{[...data.calculationRules].sort((a, b) => a.unitPrice - b.unitPrice || (a.invoiceIssueType ?? "").localeCompare(b.invoiceIssueType ?? "") || a.deductionType.localeCompare(b.deductionType)).map((rule) => {
              const base = getWorkerBaseAmount(rule.unitPrice, rule.brokerageFeeRate ?? 0.1);
              const displayRule = { ...rule, brokerageFee: rule.brokerageFee ?? base.brokerageFee, workerBaseAmount: rule.workerBaseAmount ?? base.workerBaseAmount, brokerageFeeRate: rule.brokerageFeeRate ?? 0.1, invoiceIssueType: rule.invoiceIssueType ?? "NOT_ISSUED" };
              return <tr key={rule.id}><td className={td}>{displayRule.deductionType}</td><td className={td}>{ageGroupLabel(displayRule.ageGroup)}</td><td className={td}>{formatWon(displayRule.unitPrice)}</td><td className={td}>{Math.round(displayRule.brokerageFeeRate * 100)}%</td><td className={td}>{formatWon(displayRule.brokerageFee)}</td><td className={td}>{formatWon(displayRule.workerBaseAmount)}</td><td className={td}>{displayRule.invoiceIssueType === "ISSUED" ? "발행" : "미발행"}</td><td className={td}>{formatNumber(displayRule.employmentInsurance)}</td><td className={td}>{formatNumber(displayRule.healthInsurance)}</td><td className={td}>{formatNumber(displayRule.nationalPension)}</td><td className={td}>{formatNumber(displayRule.longTermCare)}</td><td className={td}>{formatWon(displayRule.deductionAmount)}</td><td className={td}>{formatWon(displayRule.paymentAmount)}</td><td className={td}>{displayRule.memo}</td><td className={`${td} space-x-2`}><Button variant="secondary" onClick={() => setForm(displayRule)}>수정</Button><Button variant="danger" onClick={() => confirm("계산기준을 삭제할까요?") && updateData({ ...data, calculationRules: data.calculationRules.filter((item) => item.id !== rule.id) })}>삭제</Button></td></tr>;
            })}</tbody>
          </table>
        </DataTable>
      </Panel>
    </div>
  );
}
function RequestTable({
  requests,
  data,
  selectedRequestId,
  onSelect
}: {
  requests: WorkRequest[];
  data: AppData;
  selectedRequestId?: string;
  onSelect?: (request: WorkRequest) => void;
}) {
  return (
    <DataTable>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>근무일</th><th className={th}>거래처</th><th className={th}>현장</th><th className={th}>작업내용</th><th className={th}>요청</th><th className={th}>배치</th><th className={th}>부족</th><th className={th}>배치율</th><th className={th}>단가</th><th className={th}>공제</th><th className={th}>상태</th></tr></thead>
        <tbody>
          {requests.map((request) => {
            const assigned = getAssignedCount(request.id, data.assignments);
            return (
            <tr key={request.id} className={selectedRequestId === request.id ? "bg-mint-50" : ""}>
              <td className={td}>{request.workDate}</td>
              <td className={td}>{data.clients.find((client) => client.id === request.clientId)?.name}</td>
              <td className={td}>{data.sites.find((site) => site.id === request.siteId)?.name}</td>
              <td className={td}>{onSelect ? <button className="font-bold text-navy-900" onClick={() => onSelect(request)}>{request.taskDescription}</button> : request.taskDescription}</td>
              <td className={td}>{request.requestedCount}</td>
              <td className={td}>{assigned}</td>
              <td className={td}>{Math.max(request.requestedCount - assigned, 0)}</td>
              <td className={td}>{request.requestedCount > 0 ? `${Math.round((assigned / request.requestedCount) * 100)}%` : "0%"}</td>
              <td className={td}>{formatWon(request.unitPrice)}</td>
              <td className={td}>{request.deductionType}</td>
              <td className={td}><StatusBadge status={getRequestStatus(request, data.assignments)} /></td>
            </tr>
          )})}
        </tbody>
      </table>
    </DataTable>
  );
}

function getDisplayAssignment(assignment: WorkAssignment, data: AppData) {
  const worker = data.workers.find((item) => item.id === assignment.workerId);
  const site = data.sites.find((item) => item.id === assignment.siteId);
  const client = data.clients.find((item) => item.id === assignment.clientId);
  let calculated = assignment;
  if (worker && site && client) {
    calculated = calculatePayrollDeduction({
      worker,
      site,
      client,
      requestId: assignment.requestId,
      workerId: assignment.workerId,
      workDate: assignment.workDate,
      clientId: assignment.clientId,
      siteId: assignment.siteId,
      taskDescription: assignment.taskDescription,
      unitPrice: assignment.unitPrice,
      workCount: assignment.workCount,
      deductionType: assignment.deductionType,
      existingAssignments: data.assignments.filter((item) => item.id !== assignment.id),
      calculationRules: data.calculationRules,
      manual: assignment.isManualDeduction
        ? {
            employmentInsurance: assignment.manualEmploymentInsurance ?? assignment.employmentInsurance,
            healthInsurance: assignment.manualHealthInsurance ?? assignment.healthInsurance,
            nationalPension: assignment.manualNationalPension ?? assignment.nationalPension,
            longTermCare: assignment.manualLongTermCare ?? assignment.longTermCare,
            deductionAmount: assignment.manualDeductionAmount,
            paymentAmount: assignment.manualPaymentAmount,
            manualReason: assignment.manualReason
          }
        : undefined
    });
  }
  const employmentInsurance = calculated.employmentInsurance || 0;
  const healthInsurance = calculated.healthInsurance || 0;
  const nationalPension = calculated.nationalPension || 0;
  const longTermCare = calculated.longTermCare || 0;
  const deductionAmount = calculated.deductionAmount ?? employmentInsurance + healthInsurance + nationalPension + longTermCare;
  const laborCost = calculated.laborCost || Math.round((calculated.deductionBaseAmount || assignment.unitPrice) * assignment.workCount);
  return {
    ...assignment,
    deductionBaseAmount: calculated.deductionBaseAmount || assignment.deductionBaseAmount,
    invoiceIssueType: calculated.invoiceIssueType || assignment.invoiceIssueType,
    invoiceDeductionRate: calculated.invoiceDeductionRate ?? assignment.invoiceDeductionRate,
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare,
    deductionAmount,
    paymentAmount: calculated.paymentAmount ?? laborCost - deductionAmount,
    appliedRuleLabel: calculated.appliedRuleLabel || assignment.appliedRuleLabel,
    deductionReason: calculated.deductionReason || assignment.deductionReason,
    laborCost
  };
}
function AssignmentTable({ assignments, data, actions }: { assignments: WorkAssignment[]; data: AppData; actions?: (assignment: WorkAssignment) => ReactNode }) {
  return (
    <DataTable>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["근무일", "거래처", "현장", "근로자", "작업내용", "실제단가", "공수", "노무비", "고용", "건강", "연금", "장기", "총공제", "지급액", "적용규칙", "판단사유"].map((header) => (
              <th key={header} className={th}>{header}</th>
            ))}
            {actions && <th className={th}>관리</th>}
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => {
            const display = getDisplayAssignment(assignment, data);
            return (
              <tr key={assignment.id}>
                <td className={td}>{formatDateDot(display.workDate)}</td>
                <td className={td}>{data.clients.find((client) => client.id === display.clientId)?.name}</td>
                <td className={td}>{data.sites.find((site) => site.id === display.siteId)?.name}</td>
                <td className={td}>{data.workers.find((worker) => worker.id === display.workerId)?.name}</td>
                <td className={td}>{display.taskDescription}</td>
                <td className={td}>{formatWon(display.unitPrice)}</td>
                <td className={td}>{display.workCount}</td>
                <td className={td}>{formatWon(display.laborCost)}</td>
                <td className={td}>{formatWon(display.employmentInsurance)}</td>
                <td className={td}>{formatWon(display.healthInsurance)}</td>
                <td className={td}>{formatWon(display.nationalPension)}</td>
                <td className={td}>{formatWon(display.longTermCare)}</td>
                <td className={td}>{formatWon(display.deductionAmount)}</td>
                <td className={td}>{formatWon(display.paymentAmount)}</td>
                <td className={`${td} min-w-36 font-semibold text-navy-900`}>{display.appliedRuleLabel}</td>
                <td className={`${td} min-w-72 text-xs leading-relaxed text-slate-600`}>{display.deductionReason}</td>
                {actions && <td className={td}>{actions(assignment)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTable>
  );
}

function StatusBadge({ status }: { status: RequestStatus | AssignmentStatus }) {
  if (status === "배치완료") return <Badge tone="mint">{status}</Badge>;
  if (status === "일부배치") return <Badge tone="amber">{status}</Badge>;
  if (status === "초과배치") return <Badge tone="rose">{status}</Badge>;
  if (status === "취소") return <Badge tone="rose">{status}</Badge>;
  return <Badge tone="slate">{status}</Badge>;
}

function WorkerFileField({
  label,
  attachment,
  value,
  accept = "image/*",
  onChange,
  onDelete,
  onDownload
}: {
  label: string;
  attachment?: WorkerAttachment;
  value?: string;
  accept?: string;
  onChange: (file?: File) => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const isImage = Boolean(value && (value.startsWith("data:image") || attachment?.mimeType.startsWith("image/")));
  return (
    <div className="rounded-md border border-navy-100 bg-white p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <input
          type="file"
          accept={accept}
          onChange={(event) => onChange(event.target.files?.[0])}
          className="w-full text-xs sm:w-52"
        />
      </div>
      {value ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {isImage ? <img src={value} alt={label} className="h-20 w-28 rounded border border-navy-100 object-cover" /> : <div className="flex h-20 w-28 items-center justify-center rounded border border-navy-100 bg-slate-50 text-xs font-bold text-slate-500">FILE</div>}
          <div className="min-w-0 flex-1 text-xs text-slate-600">
            <p className="truncate font-bold text-navy-900">{attachment?.fileName || "저장된 첨부파일"}</p>
            <p>??: {label}</p>
            <p>업로드일: {attachment?.uploadedAt || "-"}</p>
            {attachment?.originalFileName && <p className="truncate">??: {attachment.originalFileName}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onDownload}>다운로드</Button>
            <Button variant="danger" onClick={onDelete}>??</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">??? ?? ??</p>
      )}
    </div>
  );
}

function WorkerApplicationPreview({ worker }: { worker: Worker }) {
  return (
    <div className="print-area print-page print-paper mx-auto max-w-3xl border border-navy-200 bg-white p-8 text-navy-900 shadow-sm print:shadow-none">
      <h2 className="mb-6 text-center text-2xl font-black">근로자 신상명세서</h2>
      <table className="mb-5 w-full border-collapse text-sm">
        <tbody>
          {[
            ["근로자코드", worker.workerCode || "자동생성", "성명", worker.name],
            ["주민등록번호", worker.residentNumber, "생년월일", worker.birthDate],
            ["일반전화", worker.landline, "휴대폰", worker.mobile || worker.phone],
            ["주소", worker.address, "등록일", worker.registrationDate],
            ["직종", worker.jobType, "경력", worker.career],
            ["자격증", worker.certifications, "서류상태", getWorkerDocumentStatus(worker)]
          ].map((row, index) => (
            <tr key={index}>
              <th className="border border-navy-200 bg-navy-50 px-3 py-2 text-left">{row[0]}</th>
              <td className="border border-navy-200 px-3 py-2">{row[1]}</td>
              <th className="border border-navy-200 bg-navy-50 px-3 py-2 text-left">{row[2]}</th>
              <td className="border border-navy-200 px-3 py-2">{row[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DocumentImage title="신분증 앞면" value={getWorkerDocumentDataUrl(worker, "ID_FRONT")} />
        <DocumentImage title="신분증 뒷면" value={getWorkerDocumentDataUrl(worker, "ID_BACK")} />
        <DocumentImage title="이수증" value={getWorkerDocumentDataUrl(worker, "SAFETY_CERTIFICATE")} />
      </div>
      <p className="mt-6 border-t border-navy-200 pt-4 text-sm">상기 내용으로 근로자 등록을 신청하며, 제출 서류는 업무 검수용 샘플 데이터 기준으로 관리합니다.</p>
      <div className="mt-6 flex items-end justify-end gap-4">
        <span className="text-sm font-bold">작성자: {worker.name || "근로자"}</span>
        {worker.signatureDataUrl && <img src={worker.signatureDataUrl} alt="서명/도장" className="h-20 w-28 object-contain" />}
      </div>
    </div>
  );
}

function DocumentImage({ title, value }: { title: string; value?: string }) {
  return (
    <div className="min-h-40 rounded-md border border-navy-200 p-2">
      <p className="mb-2 text-xs font-bold text-slate-500">{title}</p>
      {value ? <img src={value} alt={title} className="h-32 w-full object-contain" /> : <div className="grid h-32 place-items-center bg-navy-50 text-xs text-slate-400">미등록</div>}
    </div>
  );
}

function getLatestWorkDate(workerId: string, assignments: WorkAssignment[]) {
  const dates = assignments
    .filter((assignment) => assignment.workerId === workerId && assignment.status !== "취소")
    .map((assignment) => assignment.workDate)
    .sort();
  return dates.length ? formatDateDot(dates[dates.length - 1]) : "-";
}

type ReceivableStatus = "미수" | "부분입금" | "완납";

function ReceivableStatusBadge({ status }: { status: ReceivableStatus }) {
  if (status === "완납") return <Badge tone="mint">{status}</Badge>;
  if (status === "부분입금") return <Badge tone="amber">{status}</Badge>;
  return <Badge tone="rose">{status}</Badge>;
}

function DeductionSelect({ value, onChange }: { value: DeductionType; onChange: (value: DeductionType) => void }) {
  return <SelectInput value={value} onChange={(event) => onChange(event.target.value as DeductionType)}>{deductionTypes.map((type) => <option key={type}>{type}</option>)}</SelectInput>;
}

function getExpectedPaymentDate(closingMonth: string, paymentDay: number) {
  const [year, month] = closingMonth.split("-").map(Number);
  const next = new Date(year, month, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(Math.min(Math.max(paymentDay || 1, 1), lastDay)).padStart(2, "0")}`;
}

function getOverdueDays(expectedPaymentDate: string, basisDate = today) {
  const expected = new Date(`${expectedPaymentDate}T00:00:00`);
  const basis = new Date(`${basisDate}T00:00:00`);
  const diff = Math.floor((basis.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function buildReceivableRows(data: AppData, closingMonth: string) {
  return data.sites
    .map((site) => {
      const client = data.clients.find((item) => item.id === site.clientId);
      const assignments = data.assignments.filter((assignment) => assignment.siteId === site.id && assignment.status !== "취소" && isSameMonth(assignment.workDate, closingMonth));
      const claimAmount = assignments.reduce((sum, assignment) => sum + assignment.laborCost, 0);
      const payments = data.receivablePayments.filter((payment) => payment.siteId === site.id && payment.closingMonth === closingMonth);
      const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const balanceAmount = Math.max(claimAmount - paidAmount, 0);
      const status: ReceivableStatus = balanceAmount <= 0 && claimAmount > 0 ? "완납" : paidAmount > 0 ? "부분입금" : "미수";
      const paymentDay = site.paymentDay || client?.paymentDay || 10;
      const expectedPaymentDate = getExpectedPaymentDate(closingMonth, paymentDay);
      return {
        key: `${site.id}-${closingMonth}`,
        clientId: site.clientId,
        siteId: site.id,
        clientName: client?.name ?? site.clientName,
        siteName: site.siteName,
        claimAmount,
        paidAmount,
        balanceAmount,
        invoiceIssueType: site.invoiceIssueType,
        closingMonth,
        closingDay: `${site.closingDay}일`,
        paymentDay,
        expectedPaymentDate,
        overdueDays: balanceAmount > 0 ? getOverdueDays(expectedPaymentDate) : 0,
        paymentDates: payments.map((payment) => payment.paymentDate).join(", "),
        memo: site.memo,
        status
      };
    })
    .filter((row) => row.claimAmount > 0 || row.paidAmount > 0);
}

function buildStatementRows(entries: WorkAssignment[], data: AppData, clientName: string, site: Site, selectedMonth: string) {
  const rows: Array<Array<string | number>> = [
    ["거래명세서"],
    ["거래처명", clientName, "현장명", site.siteName, "정산기간", getClosingPeriodLabel(selectedMonth)],
    ["계산서", site.invoiceIssueType === "ISSUED" ? "발행" : "미발행", "수수료율", site.invoiceIssueType === "ISSUED" ? `${Math.round((site.invoiceDeductionRate ?? 0) * 100)}%` : "-"],
    ["날짜", "현장명", "인원", "단가", "노임총액", "노무비", "수수료", "기타", "합계"]
  ];
  const statementRows = getStatementRows(entries, data, site);
  statementRows.forEach((row) => rows.push([formatDateDot(row.date), row.siteName, row.workerCount, row.unitPrice, row.grossLabor, row.laborCost, row.serviceFee, row.etcAmount, row.totalAmount]));
  rows.push(["합계", "", statementRows.reduce((sum, row) => sum + row.workerCount, 0), "", statementRows.reduce((sum, row) => sum + row.grossLabor, 0), statementRows.reduce((sum, row) => sum + row.laborCost, 0), statementRows.reduce((sum, row) => sum + row.serviceFee, 0), statementRows.reduce((sum, row) => sum + row.etcAmount, 0), statementRows.reduce((sum, row) => sum + row.totalAmount, 0)]);
  return rows;
}

function buildDailyPayrollRows(entries: WorkAssignment[], data: AppData, selectedMonth: string) {
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));
  const rows: Array<Array<string | number>> = [
    ["일용노무비지급명세서"],
    ["정산기간", getClosingPeriodLabel(selectedMonth)],
    ["성명", "연락처", "주민등록번호", "주소", ...days.map((day) => `${Number(day)}일`), "근무일수", "총공수", "노임총액", "고용보험", "건강보험", "국민연금", "장기요양", "공제합계", "차감지급액", "서명"]
  ];
  getWorkerGroups(entries).forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const total = getWorkerTotal(items, data);
    const dayValues = days.map((day) => items.filter((item) => item.workDate.endsWith(`-${day}`)).reduce((sum, item) => sum + item.workCount, 0) || "");
    rows.push([worker?.name ?? "", worker?.mobile || worker?.phone || "", worker?.residentNumber ?? "", worker?.address ?? "", ...dayValues, total.workDays, total.workCount, total.laborCost, total.employmentInsurance, total.healthInsurance, total.nationalPension, total.longTermCare, total.deductionAmount, total.paymentAmount, worker?.signatureDataUrl ? "서명/도장 생성" : ""]);
  });
  return rows;
}

function buildReceiptRows(entries: WorkAssignment[], data: AppData, site: Site, selectedMonth: string) {
  const rows: Array<Array<string | number>> = [];
  getWorkerGroups(entries).forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const total = getWorkerTotal(items, data);
    rows.push(["근로자 영수증"], ["성명", worker?.name ?? "", "주민등록번호", worker?.residentNumber ?? ""], ["주소", worker?.address ?? ""], ["현장명", site.siteName, "정산기간", getClosingPeriodLabel(selectedMonth)], ["근무일수", total.workDays, "총공수", total.workCount], ["노임총액", total.laborCost, "공제액", total.deductionAmount], ["수령금액", total.paymentAmount], ["수령인", worker?.name ?? "", "서명/도장", worker?.signatureDataUrl ? "생성됨" : ""], ["신분증 앞면", worker?.idCardFrontImage ? "등록" : "미등록", "신분증 뒷면", worker?.idCardBackImage ? "등록" : "미등록"], [], []);
  });
  return rows;
}

function buildDelegationRows(entries: WorkAssignment[], data: AppData, site: Site, selectedMonth: string) {
  const rows: Array<Array<string | number>> = [["위임장"], ["회사명", data.companyInfo.companyName, "대표자", data.companyInfo.companyRepresentative], ["사업자등록번호", data.companyInfo.businessNumber, "연락처", data.companyInfo.companyPhone], ["주소", data.companyInfo.companyAddress], ["현장명", site.siteName, "정산기간", getClosingPeriodLabel(selectedMonth)], ["성명", "주민등록번호", "주소", "지급액", "서명/도장"]];
  getWorkerGroups(entries).forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const total = getWorkerTotal(items, data);
    rows.push([worker?.name ?? "", worker?.residentNumber ?? "", worker?.address ?? "", total.paymentAmount, worker?.signatureDataUrl ? "생성됨" : ""]);
  });
  rows.push(["합계", "", "", getWorkerGroups(entries).reduce((sum, items) => sum + getWorkerTotal(items, data).paymentAmount, 0), ""]);
  return rows;
}

function buildWorkerProfileRows(entries: WorkAssignment[], data: AppData) {
  const rows: Array<Array<string | number>> = [];
  const workerIds = Array.from(new Set(entries.map((entry) => entry.workerId)));
  workerIds.forEach((workerId) => {
    const worker = data.workers.find((item) => item.id === workerId);
    if (!worker) return;
    rows.push(["근로자 신상명세서"], ["근로자코드", worker.workerCode, "성명", worker.name], ["주민등록번호", worker.residentNumber, "생년월일", worker.birthDate], ["연락처", worker.mobile || worker.phone, "등록일", worker.registrationDate], ["주소", worker.address], ["직종", worker.jobType, "경력", worker.career], ["자격증", worker.certifications, "서류상태", getWorkerDocumentStatus(worker)], ["신분증 앞면", worker.idCardFrontImage ? "등록" : "미등록", "신분증 뒷면", worker.idCardBackImage ? "등록" : "미등록"], ["이수증", worker.safetyCertificateImage ? "등록" : "미등록", "자동 서명/도장", worker.signatureDataUrl ? "생성됨" : "미생성"], [], []);
  });
  return rows;
}
function groupStatement(entries: WorkAssignment[], data: AppData) {
  const map = new Map<string, Record<string, string | number>>();
  entries.forEach((entry) => {
    const display = getDisplayAssignment(entry, data);
    const siteName = data.sites.find((site) => site.id === entry.siteId)?.name ?? "";
    const key = `${entry.workDate}-${entry.siteId}-${entry.unitPrice}`;
    const current = map.get(key) ?? { 날짜: entry.workDate, 현장명: siteName, 인원: 0, 총공수: 0, 단가: entry.unitPrice, "노무비 합계": 0, "공제액 합계": 0, "지급액 합계": 0 };
    current.인원 = Number(current.인원) + 1;
    current.총공수 = Number(current.총공수) + display.workCount;
    current["노무비 합계"] = Number(current["노무비 합계"]) + display.laborCost;
    current["공제액 합계"] = Number(current["공제액 합계"]) + display.deductionAmount;
    current["지급액 합계"] = Number(current["지급액 합계"]) + display.paymentAmount;
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => String(a.날짜).localeCompare(String(b.날짜)));
}

function groupPayroll(entries: WorkAssignment[], data: AppData) {
  const map = new Map<string, Record<string, string | number>>();
  entries.forEach((entry) => {
    const display = getDisplayAssignment(entry, data);
    const worker = data.workers.find((item) => item.id === entry.workerId);
    const current = map.get(entry.workerId) ?? { 근로자명: worker?.name ?? "", 연락처: worker?.phone ?? "", 근무일수: 0, 총공수: 0, "노무비 합계": 0, "공제액 합계": 0, "지급액 합계": 0 };
    current.근무일수 = Number(current.근무일수) + 1;
    current.총공수 = Number(current.총공수) + display.workCount;
    current["노무비 합계"] = Number(current["노무비 합계"]) + display.laborCost;
    current["공제액 합계"] = Number(current["공제액 합계"]) + display.deductionAmount;
    current["지급액 합계"] = Number(current["지급액 합계"]) + display.paymentAmount;
    map.set(entry.workerId, current);
  });
  return Array.from(map.values()).sort((a, b) => String(a.근로자명).localeCompare(String(b.근로자명)));
}
