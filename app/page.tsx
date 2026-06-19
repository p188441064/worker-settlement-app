"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Badge, Button, DataTable, Field, Panel, SelectInput, StatCard, TextArea, TextInput, td, th } from "@/components/ui";
import { ageGroupLabel, calculateByRule, ceilWon, createCalculationRule, deductionTypes, formatDateDot, formatNumber, formatWon, getAgeGroupByWorkDate, getAssignedCount, getRequestStatus, isSameMonth, monthKey, normalizeRequestStatuses, withCalculatedAssignment } from "@/lib/calculations";
import { loadAppData, resetAppData, saveAppData, createId } from "@/lib/storage";
import { AppData, AssignmentStatus, CalculationRule, Client, DeductionType, DocumentStatus, RequestStatus, Site, ViewKey, WorkAssignment, WorkRequest, Worker } from "@/lib/types";
import { calculatePayrollDeduction } from "@/lib/payrollRules";

const menus: Array<{ key: ViewKey; label: string }> = [
  { key: "dashboard", label: "대시보드" },
  { key: "workers", label: "근로자 관리" },
  { key: "clients", label: "거래현장 관리" },
  { key: "attendance", label: "요청·배치 입력" },
  { key: "settlement", label: "월말 정산" },
  { key: "receivables", label: "전체 미수금 관리" },
  { key: "journal", label: "근로자 개인일지" },
  { key: "rules", label: "계산기준 관리" }
];

const today = "2026-06-19";
const currentMonth = monthKey(new Date());

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
  signatureDataUrl: ""
};

const emptyClient: Client = {
  id: "",
  name: "",
  managerName: "",
  phone: "",
  email: "",
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
  const count = [worker.idCardFrontImage, worker.idCardBackImage, worker.safetyCertificateImage].filter(Boolean).length;
  if (count === 3) return "완료";
  if (count > 0) return "일부누락";
  return "미확인";
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
        setData(JSON.parse(String(reader.result)) as AppData);
        alert("JSON 데이터를 불러왔습니다.");
      } catch {
        alert("JSON 형식을 확인해 주세요.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <main className="flex min-h-screen bg-navy-50">
      <aside className="w-64 shrink-0 bg-navy-900 p-5 text-white">
        <div className="mb-8">
          <p className="text-xs font-semibold text-mint-100">내부 업무용 MVP</p>
          <h1 className="mt-2 text-xl font-bold leading-tight">출역·노임 정산 도우미</h1>
        </div>
        <nav className="grid gap-2">
          {menus.map((menu) => (
            <button
              key={menu.key}
              onClick={() => setView(menu.key)}
              className={`rounded-md px-4 py-3 text-left text-sm font-semibold transition ${
                view === menu.key ? "bg-mint-500 text-navy-900" : "text-navy-100 hover:bg-navy-800"
              }`}
            >
              {menu.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between border-b border-navy-100 bg-white px-8">
          <div>
            <p className="text-sm font-semibold text-slate-500">현재 월</p>
            <p className="text-xl font-bold text-navy-900">{selectedMonth}</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/json"
              onChange={importJson}
              className="hidden"
              id="json-import"
            />
            <label htmlFor="json-import" className="flex h-10 cursor-pointer items-center rounded-md border border-navy-100 bg-white px-3 text-sm font-semibold text-navy-800 hover:bg-navy-50">
              JSON 불러오기
            </label>
            <Button variant="secondary" onClick={downloadJson}>JSON 백업</Button>
            <Button variant="danger" onClick={() => confirm("샘플 데이터로 초기화할까요?") && setData(resetAppData())}>localStorage 초기화</Button>
          </div>
        </header>

        <div className="space-y-5 p-8">
          {view === "dashboard" && <Dashboard data={data} selectedMonth={selectedMonth} />}
          {view === "workers" && <WorkersView data={data} updateData={updateData} />}
          {view === "clients" && <ClientsSitesView data={data} updateData={updateData} />}
          {view === "attendance" && <AttendanceView data={data} updateData={updateData} />}
          {view === "settlement" && <SettlementView data={data} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />}
          {view === "receivables" && <ReceivablesView data={data} updateData={updateData} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />}
          {view === "journal" && <WorkerJournalView data={data} />}
          {view === "rules" && <RulesView data={data} updateData={updateData} />}
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
  const completedToday = todayRequests.filter((request) => request.status === "배치완료").length;
  const partialToday = todayRequests.filter((request) => request.status === "일부배치").length;
  const shortageToday = todayRequests.reduce((sum, request) => {
    const assigned = getAssignedCount(request.id, data.assignments);
    return sum + Math.max(request.requestedCount - assigned, 0);
  }, 0);
  const recent = [...requests].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.requestDate.localeCompare(a.requestDate)).slice(0, 10);
  const monthRequestedCount = monthRequests.reduce((sum, request) => sum + request.requestedCount, 0);
  const monthAssignedCount = monthAssignments.length;

  return (
    <>
      <div className="grid grid-cols-6 gap-4">
        <StatCard label="오늘 요청건" value={`${todayRequests.length}건`} />
        <StatCard label="오늘 배치완료" value={`${completedToday}건`} tone="mint" />
        <StatCard label="오늘 일부배치" value={`${partialToday}건`} />
        <StatCard label="오늘 부족 인원" value={`${shortageToday}명`} />
        <StatCard label="월 요청인원" value={`${monthRequestedCount}명`} />
        <StatCard label="월 배치인원" value={`${monthAssignedCount}명`} tone="mint" />
      </div>

      <Panel title="최근 요청건 10건">
        <RequestTable requests={recent} data={data} />
      </Panel>

      <Panel title="오늘 배치 현황표">
        <AssignmentTable assignments={todayAssignments} data={data} />
      </Panel>
    </>
  );
}

function WorkersView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Worker>(emptyWorker);
  const [missingOnly, setMissingOnly] = useState(false);
  const [showApplication, setShowApplication] = useState(false);
  const workers = data.workers
    .map((worker) => ({ ...worker, documentStatus: getWorkerDocumentStatus(worker) }))
    .filter((worker) => [worker.workerCode, worker.name, worker.mobile, worker.phone, worker.address, worker.jobType].join(" ").includes(query))
    .filter((worker) => !missingOnly || worker.documentStatus !== "완료");
  const editing = Boolean(form.id);

  const save = () => {
    if (!form.name.trim()) return alert("근로자명을 입력해 주세요.");
    const worker = {
      ...form,
      id: form.id || createId("w"),
      workerCode: form.workerCode || `W-${String(data.workers.length + 1).padStart(4, "0")}`,
      phone: form.mobile || form.phone,
      documentStatus: getWorkerDocumentStatus(form),
      signatureDataUrl: form.signatureDataUrl || createSignatureDataUrl(form.name, form.signatureStyle)
    };
    updateData({ ...data, workers: editing ? data.workers.map((item) => (item.id === worker.id ? worker : item)) : [...data.workers, worker] });
    setForm(emptyWorker);
  };

  const setResidentNumber = (residentNumber: string) => {
    const birthDate = birthDateFromResidentNumber(residentNumber) || form.birthDate;
    setForm({ ...form, residentNumber, birthDate, ageGroup: getAgeGroupByWorkDate(birthDate, today) });
  };

  const setFile = (key: keyof Pick<Worker, "idCardFrontImage" | "idCardBackImage" | "safetyCertificateImage" | "otherAttachment">, file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const next = { ...form, [key]: String(reader.result) };
      setForm({ ...next, documentStatus: getWorkerDocumentStatus(next as Worker) });
    };
    reader.readAsDataURL(file);
  };

  const downloadFile = (dataUrl?: string, filename = "attachment") => {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
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
    <div className="grid grid-cols-[360px_1fr] gap-5">
      <Panel title={editing ? "근로자 수정" : "근로자 신규 등록"}>
        <div className="grid gap-3">
          <Field label="근로자코드"><TextInput value={form.workerCode || "자동생성"} onChange={(e) => setForm({ ...form, workerCode: e.target.value })} /></Field>
          <Field label="이름"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="주민등록번호"><TextInput value={form.residentNumber} onChange={(e) => setResidentNumber(e.target.value)} placeholder="예: 900101-1******" /></Field>
          <Field label="생년월일 / 만 나이"><TextInput type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value, ageGroup: getAgeGroupByWorkDate(e.target.value, today) })} /></Field>
          <div className="rounded-md bg-mint-50 p-2 text-sm font-bold">{calculateAge(form.birthDate)}세 · {ageGroupLabel(getAgeGroupByWorkDate(form.birthDate, today))}</div>
          <Field label="일반전화"><TextInput value={form.landline} onChange={(e) => setForm({ ...form, landline: e.target.value })} /></Field>
          <Field label="휴대폰"><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value, phone: e.target.value })} /></Field>
          <Field label="주소"><TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Button variant="secondary" onClick={() => alert("주소검색은 다음 단계에서 외부 주소 API 없이 수동입력으로 대체합니다.")}>주소검색</Button>
          <Field label="등록일"><TextInput type="date" value={form.registrationDate} onChange={(e) => setForm({ ...form, registrationDate: e.target.value })} /></Field>
          <Field label="직종"><TextInput value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} /></Field>
          <Field label="경력"><TextInput value={form.career} onChange={(e) => setForm({ ...form, career: e.target.value })} /></Field>
          <Field label="자격증"><TextInput value={form.certifications} onChange={(e) => setForm({ ...form, certifications: e.target.value })} /></Field>
          <Field label="서류상태">
            <SelectInput value={getWorkerDocumentStatus(form)} disabled>
              <option>완료</option><option>일부누락</option><option>미확인</option>
            </SelectInput>
          </Field>
          <WorkerFileField label="신분증 앞면" value={form.idCardFrontImage} onChange={(file) => setFile("idCardFrontImage", file)} onDelete={() => setForm({ ...form, idCardFrontImage: undefined })} onDownload={() => downloadFile(form.idCardFrontImage, `${form.name}_신분증앞면.png`)} />
          <WorkerFileField label="신분증 뒷면" value={form.idCardBackImage} onChange={(file) => setFile("idCardBackImage", file)} onDelete={() => setForm({ ...form, idCardBackImage: undefined })} onDownload={() => downloadFile(form.idCardBackImage, `${form.name}_신분증뒷면.png`)} />
          <WorkerFileField label="기초안전보건교육 이수증" value={form.safetyCertificateImage} onChange={(file) => setFile("safetyCertificateImage", file)} onDelete={() => setForm({ ...form, safetyCertificateImage: undefined })} onDownload={() => downloadFile(form.safetyCertificateImage, `${form.name}_이수증.png`)} />
          <WorkerFileField label="기타 첨부파일" value={form.otherAttachment} onChange={(file) => setFile("otherAttachment", file)} onDelete={() => setForm({ ...form, otherAttachment: undefined })} onDownload={() => downloadFile(form.otherAttachment, `${form.name}_기타첨부.png`)} />
          <Field label="서명 스타일"><SelectInput value={form.signatureStyle} onChange={(e) => setForm({ ...form, signatureStyle: e.target.value as Worker["signatureStyle"], signatureDataUrl: createSignatureDataUrl(form.name, e.target.value as Worker["signatureStyle"]) })}><option value="STAMP">막도장</option><option value="SIGN">전자서명</option></SelectInput></Field>
          <div className="rounded-md border border-navy-100 p-2">{form.signatureDataUrl && <img src={form.signatureDataUrl} alt="서명 미리보기" className="h-20" />}<Button variant="secondary" onClick={() => setForm({ ...form, signatureDataUrl: createSignatureDataUrl(form.name, form.signatureStyle) })}>다시 생성</Button></div>
          <Field label="비고"><TextInput value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save}>{editing ? "수정 저장" : "등록"}</Button>
            <Button variant="secondary" onClick={() => setForm(emptyWorker)}>초기화</Button>
            <Button variant="secondary" onClick={() => setShowApplication((value) => !value)}>신청명세서 미리보기</Button>
            <Button variant="secondary" onClick={() => window.print()}>출력/PDF/인쇄</Button>
          </div>
        </div>
      </Panel>

      <div className="space-y-5">
      {showApplication && (
        <Panel title="근로자 신청명세서 미리보기">
          <WorkerApplicationPreview worker={{ ...form, documentStatus: getWorkerDocumentStatus(form), signatureDataUrl: form.signatureDataUrl || createSignatureDataUrl(form.name, form.signatureStyle) }} />
        </Panel>
      )}

      <Panel title="근로자 목록" actions={<div className="flex items-center gap-2"><label className="text-sm"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> 서류누락</label><TextInput placeholder="코드, 이름, 휴대폰, 주소 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="w-72" /></div>}>
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>근로자코드</th><th className={th}>성명</th><th className={th}>생년월일</th><th className={th}>나이</th><th className={th}>60세 여부</th><th className={th}>휴대폰</th><th className={th}>직종</th><th className={th}>등록일</th><th className={th}>서류상태</th><th className={th}>최근출역일</th><th className={th}>관리</th></tr></thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id}>
                  <td className={td}>{worker.workerCode}</td><td className={td}>{worker.name}</td><td className={td}>{worker.birthDate}</td><td className={td}>{calculateAge(worker.birthDate)}</td><td className={td}>{ageGroupLabel(getAgeGroupByWorkDate(worker.birthDate, today))}</td><td className={td}>{worker.mobile || worker.phone}</td><td className={td}>{worker.jobType}</td><td className={td}>{worker.registrationDate}</td><td className={td}><Badge tone={docTone(worker.documentStatus)}>{worker.documentStatus}</Badge></td><td className={td}>{getLatestWorkDate(worker.id, data.assignments)}</td>
                  <td className={`${td} space-x-2`}><Button variant="secondary" onClick={() => setForm(worker)}>수정</Button><Button variant="danger" onClick={() => remove(worker.id)}>삭제</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Panel>
      </div>
    </div>
  );
}

function ClientsSitesView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const firstSite = data.sites[0] ?? emptySite;
  const [query, setQuery] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState(firstSite.id);
  const [siteForm, setSiteForm] = useState<Site>(firstSite.id ? hydrateSite(firstSite, data.clients) : emptySite);

  const filteredSites = data.sites.filter((site) => {
    const item = hydrateSite(site, data.clients);
    const target = [item.clientName, item.siteName, item.siteCode, item.managerName, item.displayName].join(" ").toLowerCase();
    return target.includes(query.toLowerCase());
  });
  const treeClients = data.clients
    .map((client) => ({
      client,
      sites: filteredSites.filter((site) => site.clientId === client.id || hydrateSite(site, data.clients).clientName === client.name)
    }))
    .filter((group) => group.sites.length > 0 || group.client.name.toLowerCase().includes(query.toLowerCase()));

  const selectSite = (site: Site) => {
    const next = hydrateSite(site, data.clients);
    setSelectedSiteId(next.id);
    setSiteForm(next);
  };

  const startNew = () => {
    setSelectedSiteId("");
    setSiteForm({ ...emptySite, id: "", siteCode: `S-${Date.now().toString().slice(-5)}` });
  };

  const resetForm = () => {
    if (!selectedSiteId) {
      startNew();
      return;
    }
    const selected = data.sites.find((site) => site.id === selectedSiteId);
    if (selected) setSiteForm(hydrateSite(selected, data.clients));
  };

  const saveSite = () => {
    if (!siteForm.clientName.trim()) return alert("거래처명을 입력해 주세요.");
    if (!siteForm.siteName.trim()) return alert("현장명을 입력해 주세요.");

    const existingClient = data.clients.find((client) => client.name === siteForm.clientName.trim());
    const clientId = (existingClient?.id ?? siteForm.clientId) || createId("c");
    const displayName = `${siteForm.clientName.trim()}(${siteForm.siteName.trim()})`;
    const site: Site = {
      ...siteForm,
      id: siteForm.id || createId("s"),
      clientId,
      clientName: siteForm.clientName.trim(),
      siteName: siteForm.siteName.trim(),
      displayName,
      name: siteForm.siteName.trim(),
      code: siteForm.siteCode.trim()
    };
    const syncedClient: Client = {
      id: clientId,
      name: site.clientName,
      managerName: site.managerName,
      phone: site.phone,
      email: site.settlementEmail1,
      closingDay: site.closingDay,
      paymentDay: site.paymentDay,
      memo: site.memo
    };
    const clients = existingClient
      ? data.clients.map((client) => (client.id === clientId ? syncedClient : client))
      : [...data.clients, syncedClient];
    const sites = siteForm.id ? data.sites.map((item) => (item.id === site.id ? site : item)) : [...data.sites, site];

    updateData({ ...data, clients, sites });
    setSelectedSiteId(site.id);
    setSiteForm(site);
  };

  const deleteSite = () => {
    if (!siteForm.id) return;
    if (!confirm("선택한 거래현장을 삭제할까요? 관련 출역내역도 함께 삭제됩니다.")) return;
    const remainingSites = data.sites.filter((site) => site.id !== siteForm.id);
    updateData({
      ...data,
      sites: remainingSites,
      workEntries: data.workEntries.filter((entry) => entry.siteId !== siteForm.id),
      workRequests: data.workRequests.filter((request) => request.siteId !== siteForm.id),
      assignments: data.assignments.filter((assignment) => assignment.siteId !== siteForm.id)
    });
    const next = remainingSites[0] ? hydrateSite(remainingSites[0], data.clients) : emptySite;
    setSelectedSiteId(next.id);
    setSiteForm(next);
  };

  const setFormField = <K extends keyof Site>(key: K, value: Site[K]) => {
    const next = { ...siteForm, [key]: value };
    if (key === "clientName" || key === "siteName") {
      next.displayName = `${next.clientName || ""}${next.siteName ? `(${next.siteName})` : ""}`;
    }
    setSiteForm(next);
  };

  return (
    <div className="grid grid-cols-[340px_1fr] gap-5">
      <Panel title="거래현장 검색">
        <div className="grid gap-3">
          <div className="flex gap-2">
            <TextInput placeholder="거래처명, 현장명, 코드, 담당자" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button variant="secondary" onClick={() => setQuery(query.trim())}>검색</Button>
          </div>
          <div className="h-[620px] overflow-y-auto rounded-md border border-navy-100 bg-white">
            {treeClients.map(({ client, sites }) => (
              <div key={client.id} className="border-b border-navy-100">
                <div className="bg-navy-50 px-3 py-2 text-sm font-black text-navy-900">{client.name}</div>
                {sites.map((site) => {
                  const item = hydrateSite(site, data.clients);
                  const active = selectedSiteId === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => selectSite(site)}
                      className={`block w-full border-t border-navy-100 px-5 py-2 text-left text-sm transition ${
                        active ? "bg-mint-100 text-navy-900" : "hover:bg-navy-50"
                      }`}
                    >
                      <span className="block font-bold">└ {item.siteName}</span>
                      <span className="mt-1 block text-xs text-slate-500">{item.siteCode} · {item.managerName || "담당자 미입력"}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {treeClients.length === 0 && <p className="p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
          </div>
        </div>
      </Panel>

      <Panel
        title="거래현장 상세정보"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={startNew}>신규등록</Button>
            <Button onClick={saveSite}>{siteForm.id ? "수정" : "저장"}</Button>
            <Button variant="danger" onClick={deleteSite} disabled={!siteForm.id}>삭제</Button>
            <Button variant="secondary" onClick={() => alert("출력 기능은 다음 단계에서 구현합니다.")}>출력</Button>
            <Button variant="secondary" onClick={resetForm}>초기화</Button>
          </div>
        }
      >
        <div className="grid grid-cols-4 gap-3">
          <Field label="현장코드"><TextInput value={siteForm.siteCode} onChange={(e) => setFormField("siteCode", e.target.value)} /></Field>
          <Field label="거래처명"><TextInput value={siteForm.clientName} onChange={(e) => setFormField("clientName", e.target.value)} /></Field>
          <Field label="현장명"><TextInput value={siteForm.siteName} onChange={(e) => setFormField("siteName", e.target.value)} /></Field>
          <Field label="표시명"><TextInput value={siteForm.displayName} onChange={(e) => setFormField("displayName", e.target.value)} /></Field>

          <Field label="회사 전화번호"><TextInput value={siteForm.phone} onChange={(e) => setFormField("phone", e.target.value)} /></Field>
          <Field label="팩스번호"><TextInput value={siteForm.fax} onChange={(e) => setFormField("fax", e.target.value)} /></Field>
          <Field label="담당자명"><TextInput value={siteForm.managerName} onChange={(e) => setFormField("managerName", e.target.value)} /></Field>
          <Field label="담당자 직책"><TextInput value={siteForm.managerTitle} onChange={(e) => setFormField("managerTitle", e.target.value)} /></Field>
          <Field label="담당자 연락처"><TextInput value={siteForm.managerPhone} onChange={(e) => setFormField("managerPhone", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="결제일"><TextInput type="number" value={siteForm.paymentDay} onChange={(e) => setFormField("paymentDay", Number(e.target.value))} /></Field>
            <Field label="마감일"><TextInput type="number" value={siteForm.closingDay} onChange={(e) => setFormField("closingDay", Number(e.target.value))} /></Field>
          </div>

          <Field label="정산 이메일 1"><TextInput value={siteForm.settlementEmail1} onChange={(e) => setFormField("settlementEmail1", e.target.value)} /></Field>
          <Field label="정산 이메일 2"><TextInput value={siteForm.settlementEmail2} onChange={(e) => setFormField("settlementEmail2", e.target.value)} /></Field>
          <Field label="기본단가"><TextInput type="number" value={siteForm.defaultUnitPrice} onChange={(e) => setFormField("defaultUnitPrice", Number(e.target.value))} /></Field>
          <Field label="기본공제유형"><DeductionSelect value={siteForm.defaultDeductionType} onChange={(value) => setFormField("defaultDeductionType", value)} /></Field>
          <Field label="계산서 발행 여부">
            <SelectInput value={siteForm.invoiceIssueType} onChange={(e) => setFormField("invoiceIssueType", e.target.value as Site["invoiceIssueType"])}>
              <option value="ISSUED">계산서 발행</option>
              <option value="NOT_ISSUED">계산서 미발행</option>
            </SelectInput>
          </Field>
          <Field label="계산서 차감률"><TextInput type="number" step="0.01" value={siteForm.invoiceDeductionRate} onChange={(e) => setFormField("invoiceDeductionRate", Number(e.target.value))} /></Field>
          <Field label="건강보험 판단 기준">
            <SelectInput value={siteForm.healthInsuranceBasis} onChange={(e) => setFormField("healthInsuranceBasis", e.target.value as Site["healthInsuranceBasis"])}>
              <option value="CLIENT_BASED">거래처 기준</option>
              <option value="SITE_BASED">현장 기준</option>
              <option value="MANUAL">수동</option>
            </SelectInput>
          </Field>
          <Field label="건강보험 출력 기준">
            <SelectInput value={siteForm.healthInsuranceOutputBasis} onChange={(e) => setFormField("healthInsuranceOutputBasis", e.target.value as Site["healthInsuranceOutputBasis"])}>
              <option value="MONTH_FIRST_DAY">매월 1일 기준</option>
              <option value="DATE_BASED">실제 날짜 기준</option>
              <option value="FIRST_MONTH_NOT_APPLY">첫달 미부과</option>
              <option value="MANUAL">수동</option>
            </SelectInput>
          </Field>
          <Field label="국민연금 출력 기준">
            <SelectInput value={siteForm.pensionOutputBasis} onChange={(e) => setFormField("pensionOutputBasis", e.target.value as Site["pensionOutputBasis"])}>
              <option value="MONTH_FIRST_DAY">매월 1일 기준</option>
              <option value="DATE_BASED">실제 날짜 기준</option>
              <option value="FIRST_MONTH_NOT_APPLY">첫달 미부과</option>
              <option value="MANUAL">수동</option>
            </SelectInput>
          </Field>
          <Field label="첫달 보험 처리">
            <SelectInput value={siteForm.firstMonthInsuranceHandling} onChange={(e) => setFormField("firstMonthInsuranceHandling", e.target.value as Site["firstMonthInsuranceHandling"])}>
              <option value="APPLY">첫달도 반영</option>
              <option value="NOT_APPLY">첫달 미부과·비희망</option>
              <option value="MANUAL">수동</option>
            </SelectInput>
          </Field>
          <Field label="국민연금 기준금액"><TextInput type="number" value={siteForm.pensionMonthlyThreshold} onChange={(e) => setFormField("pensionMonthlyThreshold", Number(e.target.value))} /></Field>

          <div className="col-span-2">
            <Field label="주소"><TextInput value={siteForm.address} onChange={(e) => setFormField("address", e.target.value)} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="기본 작업내용"><TextInput value={siteForm.defaultTaskDescription} onChange={(e) => setFormField("defaultTaskDescription", e.target.value)} /></Field>
          </div>

          <div className="col-span-4">
            <Field label="비고"><TextInput value={siteForm.memo} onChange={(e) => setFormField("memo", e.target.value)} /></Field>
          </div>

          <div className="col-span-4">
            <Field label="약도/오시는 길"><TextArea value={siteForm.directions} onChange={(e) => setFormField("directions", e.target.value)} className="min-h-28" /></Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={siteForm.carryOverPreviousMonth} onChange={(e) => setFormField("carryOverPreviousMonth", e.target.checked)} />
            전월 연속근로 반영
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={siteForm.isActive} onChange={(e) => setFormField("isActive", e.target.checked)} />
            활성상태
          </label>
          <div className="col-span-2 flex items-center gap-3 rounded-md bg-navy-50 px-3 text-sm text-navy-800">
            <b>목록 표시</b>
            <span>{siteForm.displayName || "거래처명(현장명)"}</span>
          </div>
        </div>
      </Panel>
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
  const workers = data.workers.filter((worker) => [worker.name, worker.phone].join(" ").includes(workerQuery));
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
    setSelectedRequestId(request.id);
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

  const removeAssignment = (id: string) => {
    if (!confirm("배치내역을 삭제할까요?")) return;
    const assignments = data.assignments.filter((assignment) => assignment.id !== id);
    updateData({ ...data, assignments, workRequests: normalizeRequestStatuses(data.workRequests, assignments) });
  };

  return (
    <div className="space-y-5">
      <Panel title="요청건 등록">
        <div className="grid grid-cols-6 gap-3">
          <Field label="근무일"><TextInput type="date" value={requestForm.workDate} onChange={(e) => setRequestForm({ ...requestForm, workDate: e.target.value })} /></Field>
          <Field label="거래처"><SelectInput value={requestForm.clientId} onChange={(e) => changeRequestClient(e.target.value)}>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</SelectInput></Field>
          <Field label="현장"><SelectInput value={requestForm.siteId} onChange={(e) => changeRequestSite(e.target.value)}>{requestSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput></Field>
          <Field label="요청인원"><TextInput type="number" value={requestForm.requestedCount} onChange={(e) => setRequestForm({ ...requestForm, requestedCount: Number(e.target.value) })} /></Field>
          <Field label="단가"><TextInput type="number" value={requestForm.unitPrice} onChange={(e) => setRequestForm({ ...requestForm, unitPrice: Number(e.target.value) })} /></Field>
          <Field label="공제유형"><DeductionSelect value={requestForm.deductionType} onChange={(value) => setRequestForm({ ...requestForm, deductionType: value })} /></Field>
          <div className="col-span-2"><Field label="작업내용"><TextInput value={requestForm.taskDescription} onChange={(e) => setRequestForm({ ...requestForm, taskDescription: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label="집합장소"><TextInput value={requestForm.meetingPlace} onChange={(e) => setRequestForm({ ...requestForm, meetingPlace: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label="비고"><TextInput value={requestForm.memo} onChange={(e) => setRequestForm({ ...requestForm, memo: e.target.value })} /></Field></div>
          <div className="col-span-6 flex justify-end"><Button onClick={saveRequest}>요청 저장</Button></div>
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
          <div className="grid grid-cols-[380px_1fr] gap-5">
            <div className="rounded-md border border-navy-100 bg-navy-50 p-4 text-sm">
              <p className="text-lg font-bold text-navy-900">{data.clients.find((client) => client.id === selectedRequest.clientId)?.name} / {data.sites.find((site) => site.id === selectedRequest.siteId)?.name}</p>
              <p className="mt-2">근무일: {selectedRequest.workDate}</p>
              <p>작업내용: {selectedRequest.taskDescription}</p>
              <p>요청 {selectedRequest.requestedCount}명 / 배치 {getAssignedCount(selectedRequest.id, data.assignments)}명 / 부족 {Math.max(selectedRequest.requestedCount - getAssignedCount(selectedRequest.id, data.assignments), 0)}명</p>
              <p>집합장소: {selectedRequest.meetingPlace || "-"}</p>
              <div className="mt-3"><StatusBadge status={getRequestStatus(selectedRequest, data.assignments)} /></div>
            </div>
            <div className="grid gap-4">
              <div className="grid grid-cols-6 gap-3">
                <Field label="근로자 검색"><TextInput value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} placeholder="이름 또는 연락처" /></Field>
                <Field label="근로자 선택"><SelectInput value={assignmentForm.workerId} onChange={(e) => setAssignmentForm({ ...assignmentForm, workerId: e.target.value })}><option value="">선택</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} ({worker.phone})</option>)}</SelectInput></Field>
                <Field label="공수"><TextInput type="number" step="0.5" value={assignmentForm.workCount} onChange={(e) => setAssignmentForm({ ...assignmentForm, workCount: Number(e.target.value) })} /></Field>
                <Field label="단가"><TextInput type="number" value={assignmentForm.unitPrice} onChange={(e) => setAssignmentForm({ ...assignmentForm, unitPrice: Number(e.target.value) })} /></Field>
                <Field label="공제유형"><DeductionSelect value={assignmentForm.deductionType} onChange={(value) => setAssignmentForm({ ...assignmentForm, deductionType: value })} /></Field>
                <div className="flex items-end"><Button onClick={saveAssignment} className="w-full">배치 저장</Button></div>
              </div>
              <div className="grid grid-cols-4 gap-2 rounded-md bg-mint-50 p-3 text-sm font-bold">
                <span>실제 단가 {formatWon(assignmentForm.unitPrice)}</span>
                <span>공제기준금액 {"deductionBaseAmount" in preview ? formatWon(preview.deductionBaseAmount) : "-"}</span>
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
                <p><b>적용규칙</b> {"appliedRuleLabel" in preview ? preview.appliedRuleLabel : "-"}</p>
                <p><b>판단사유</b> {"deductionReason" in preview ? preview.deductionReason : "계산기준표 기준 공제액을 미리 계산합니다."}</p>
                {"healthInsuranceReason" in preview && <p><b>건강보험</b> {preview.healthInsuranceReason}</p>}
                {"pensionReason" in preview && <p><b>국민연금</b> {preview.pensionReason}</p>}
              </div>
              <div className="grid grid-cols-7 gap-2 rounded-md border border-navy-100 bg-white p-3">
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
  application: "근로자 신청명세서"
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
    appendClosingSheet(XLSX, book, "근로자신청명세서", buildWorkerApplicationRows(entries, data));
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
        <div className="grid grid-cols-4 gap-3">
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

      <div className="grid grid-cols-6 gap-4">
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
        <WorkerApplicationDocuments data={data} entries={entries} />
      </div>
    </div>
  );
}

const printTh = "border border-slate-400 bg-slate-100 px-2 py-1 text-left font-bold";
const printTd = "border border-slate-400 px-2 py-1";

function PrintPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-page mx-auto max-w-5xl bg-white p-8 text-slate-950 shadow-ledger print:mx-0 print:max-w-none print:p-0 print:shadow-none">
      <h2 className="mb-5 text-center text-2xl font-black tracking-normal">{title}</h2>
      {children}
    </section>
  );
}

function getWorkerGroups(entries: WorkAssignment[]) {
  const groups = new Map<string, WorkAssignment[]>();
  entries.forEach((entry) => groups.set(entry.workerId, [...(groups.get(entry.workerId) ?? []), entry]));
  return Array.from(groups.values());
}

function StatementDocument({ data, entries, client, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; client: Client; site: Site; selectedMonth: string }) {
  const rows = groupStatement(entries, data);
  const displayEntries = entries.map((entry) => getDisplayAssignment(entry, data));
  const totalLabor = displayEntries.reduce((sum, entry) => sum + entry.laborCost, 0);
  const totalDeduction = displayEntries.reduce((sum, entry) => sum + entry.deductionAmount, 0);
  const totalPayment = displayEntries.reduce((sum, entry) => sum + entry.paymentAmount, 0);
  return (
    <PrintPage title={site.invoiceIssueType === "NOT_ISSUED" ? "거래명세서(계산서 미발행)" : "거래명세서"}>
      <table className="mb-4 w-full border-collapse text-sm"><tbody>
        <tr><th className={printTh}>공급자</th><td className={printTd}>{data.companyInfo.companyName}</td><th className={printTh}>거래처</th><td className={printTd}>{client.name}</td></tr>
        <tr><th className={printTh}>현장명</th><td className={printTd}>{site.siteName}</td><th className={printTh}>정산월</th><td className={printTd}>{selectedMonth}</td></tr>
        <tr><th className={printTh}>마감일</th><td className={printTd}>{site.closingDay}일</td><th className={printTh}>결제일</th><td className={printTd}>{site.paymentDay}일</td></tr>
      </tbody></table>
      <table className="w-full border-collapse text-sm"><thead><tr>{["날짜", "현장명", "인원", "총공수", "단가", "노무비", "공제액", "지급액", "비고"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {rows.map((row, index) => <tr key={index}><td className={printTd}>{row.날짜}</td><td className={printTd}>{row.현장명}</td><td className={printTd}>{row.인원}</td><td className={printTd}>{row.총공수}</td><td className={printTd}>{formatWon(Number(row.단가))}</td><td className={printTd}>{formatWon(Number(row["노무비 합계"]))}</td><td className={printTd}>{formatWon(Number(row["공제액 합계"]))}</td><td className={printTd}>{formatWon(Number(row["지급액 합계"]))}</td><td className={printTd}></td></tr>)}
        <tr><th className={printTh} colSpan={5}>합계</th><td className={printTd}>{formatWon(totalLabor)}</td><td className={printTd}>{formatWon(totalDeduction)}</td><td className={printTd}>{formatWon(totalPayment)}</td><td className={printTd}></td></tr>
      </tbody></table>
    </PrintPage>
  );
}

function DailyPayrollDocument({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  const workerGroups = getWorkerGroups(entries);
  return (
    <PrintPage title="일용노무비지급명세서">
      <div className="mb-4 grid grid-cols-3 gap-2 text-sm"><p><b>현장명</b> {site.siteName}</p><p><b>정산월</b> {selectedMonth}</p><p><b>작성일</b> {formatDateDot(today)}</p></div>
      <table className="w-full border-collapse text-xs"><thead><tr>{["성명", "주민등록번호", "주소", "근무일수", "총공수", "노무비", "고용", "건강", "국민연금", "장기요양", "지급액", "서명"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {workerGroups.map((items) => {
          const worker = data.workers.find((item) => item.id === items[0].workerId);
          const displayItems = items.map((item) => getDisplayAssignment(item, data));
          return <tr key={items[0].workerId}><td className={printTd}>{worker?.name}</td><td className={printTd}>{worker?.residentNumber}</td><td className={printTd}>{worker?.address}</td><td className={printTd}>{new Set(items.map((item) => item.workDate)).size}</td><td className={printTd}>{items.reduce((sum, item) => sum + item.workCount, 0)}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.laborCost, 0))}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.employmentInsurance, 0))}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.healthInsurance, 0))}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.nationalPension, 0))}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.longTermCare, 0))}</td><td className={printTd}>{formatWon(displayItems.reduce((sum, item) => sum + item.paymentAmount, 0))}</td><td className={printTd}>{worker?.signatureDataUrl ? <img src={worker.signatureDataUrl} alt="서명" className="h-10 w-20 object-contain" /> : ""}</td></tr>;
        })}
      </tbody></table>
    </PrintPage>
  );
}

function DelegationDocument({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  const workerGroups = getWorkerGroups(entries);
  return (
    <PrintPage title="위임장">
      <div className="space-y-3 text-sm leading-7">
        <p>아래 근로자는 {site.siteName} 현장의 {selectedMonth} 노무비 수령 및 관련 정산 업무를 {data.companyInfo.companyName}에 위임합니다.</p>
        <p><b>회사명</b> {data.companyInfo.companyName} / <b>대표자</b> {data.companyInfo.companyRepresentative} / <b>사업자번호</b> {data.companyInfo.businessNumber}</p>
        <p><b>주소</b> {data.companyInfo.companyAddress}</p>
      </div>
      <table className="mt-5 w-full border-collapse text-sm"><thead><tr>{["성명", "주민등록번호", "주소", "지급액", "서명/도장"].map((header) => <th key={header} className={printTh}>{header}</th>)}</tr></thead><tbody>
        {workerGroups.map((items) => {
          const worker = data.workers.find((item) => item.id === items[0].workerId);
          const total = items.map((item) => getDisplayAssignment(item, data)).reduce((sum, item) => sum + item.paymentAmount, 0);
          return <tr key={items[0].workerId}><td className={printTd}>{worker?.name}</td><td className={printTd}>{worker?.residentNumber}</td><td className={printTd}>{worker?.address}</td><td className={printTd}>{formatWon(total)}</td><td className={printTd}>{worker?.signatureDataUrl ? <img src={worker.signatureDataUrl} alt="서명" className="h-12 w-24 object-contain" /> : ""}</td></tr>;
        })}
      </tbody></table>
    </PrintPage>
  );
}

function ReceiptDocuments({ data, entries, site, selectedMonth }: { data: AppData; entries: WorkAssignment[]; site: Site; selectedMonth: string }) {
  return <>{getWorkerGroups(entries).map((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const displayItems = items.map((item) => getDisplayAssignment(item, data));
    const totalPayment = displayItems.reduce((sum, item) => sum + item.paymentAmount, 0);
    return (
      <PrintPage key={items[0].workerId} title="근로자 영수증">
        <table className="mb-5 w-full border-collapse text-sm"><tbody>
          <tr><th className={printTh}>성명</th><td className={printTd}>{worker?.name}</td><th className={printTh}>주민등록번호</th><td className={printTd}>{worker?.residentNumber}</td></tr>
          <tr><th className={printTh}>주소</th><td className={printTd} colSpan={3}>{worker?.address}</td></tr>
          <tr><th className={printTh}>현장명</th><td className={printTd}>{site.siteName}</td><th className={printTh}>정산월</th><td className={printTd}>{selectedMonth}</td></tr>
          <tr><th className={printTh}>근무일수</th><td className={printTd}>{new Set(items.map((item) => item.workDate)).size}일</td><th className={printTh}>수령금액</th><td className={printTd}>{formatWon(totalPayment)}</td></tr>
        </tbody></table>
        <p className="mb-8 text-sm leading-7">상기 금액을 해당 기간 동안의 일용노무비로 정히 수령하였음을 확인합니다.</p>
        <div className="flex items-end justify-end gap-6"><span>수령인: {worker?.name}</span>{worker?.signatureDataUrl && <img src={worker.signatureDataUrl} alt="서명" className="h-20 w-28 object-contain" />}</div>
        <div className="mt-6 grid grid-cols-2 gap-3"><DocumentImage title="신분증 앞면" value={worker?.idCardFrontImage} /><DocumentImage title="신분증 뒷면" value={worker?.idCardBackImage} /></div>
      </PrintPage>
    );
  })}</>;
}

function WorkerApplicationDocuments({ data, entries }: { data: AppData; entries: WorkAssignment[] }) {
  const workerIds = Array.from(new Set(entries.map((entry) => entry.workerId)));
  return <>{workerIds.map((workerId) => {
    const worker = data.workers.find((item) => item.id === workerId);
    if (!worker) return null;
    return (
      <PrintPage key={worker.id} title="근로자 신청명세서">
        <table className="mb-5 w-full border-collapse text-sm"><tbody>
          <tr><th className={printTh}>근로자코드</th><td className={printTd}>{worker.workerCode}</td><th className={printTh}>성명</th><td className={printTd}>{worker.name}</td></tr>
          <tr><th className={printTh}>주민등록번호</th><td className={printTd}>{worker.residentNumber}</td><th className={printTh}>생년월일</th><td className={printTd}>{worker.birthDate}</td></tr>
          <tr><th className={printTh}>연락처</th><td className={printTd}>{worker.mobile || worker.phone}</td><th className={printTh}>등록일</th><td className={printTd}>{worker.registrationDate}</td></tr>
          <tr><th className={printTh}>주소</th><td className={printTd} colSpan={3}>{worker.address}</td></tr>
          <tr><th className={printTh}>직종</th><td className={printTd}>{worker.jobType}</td><th className={printTh}>경력</th><td className={printTd}>{worker.career}</td></tr>
          <tr><th className={printTh}>자격증</th><td className={printTd}>{worker.certifications}</td><th className={printTh}>서류상태</th><td className={printTd}>{getWorkerDocumentStatus(worker)}</td></tr>
        </tbody></table>
        <div className="grid grid-cols-3 gap-3"><DocumentImage title="신분증 앞면" value={worker.idCardFrontImage} /><DocumentImage title="신분증 뒷면" value={worker.idCardBackImage} /><DocumentImage title="이수증" value={worker.safetyCertificateImage} /></div>
        <div className="mt-6 flex items-end justify-end gap-4"><span>작성자: {worker.name}</span>{worker.signatureDataUrl && <img src={worker.signatureDataUrl} alt="서명/도장" className="h-20 w-28 object-contain" />}</div>
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
  const [clientSearch, setClientSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const rows = buildReceivableRows(data, selectedMonth)
    .filter((row) => clientFilter === "all" || row.clientId === clientFilter)
    .filter((row) => row.clientName.toLowerCase().includes(clientSearch.toLowerCase()))
    .filter((row) => row.siteName.toLowerCase().includes(siteSearch.toLowerCase()));
  const selectedRow = rows.find((row) => row.key === selectedKey) ?? rows[0];
  const totalReceivable = rows.reduce((sum, row) => sum + row.balanceAmount, 0);
  const totalClaim = rows.reduce((sum, row) => sum + row.claimAmount, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.paidAmount, 0);
  const clientTotals = data.clients.map((client) => {
    const clientRows = rows.filter((row) => row.clientId === client.id);
    return {
      client,
      balance: clientRows.reduce((sum, row) => sum + row.balanceAmount, 0)
    };
  }).filter((item) => item.balance > 0);
  const siteTotals = rows
    .map((row) => ({ siteId: row.siteId, siteName: row.siteName, balance: row.balanceAmount }))
    .filter((item) => item.balance > 0);

  const savePayment = () => {
    if (!selectedRow) return alert("입금 처리할 현장을 선택해 주세요.");
    const amount = Number(paymentAmount);
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
          memo: ""
        }
      ]
    });
    setPaymentAmount("");
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
      입금일: row.paymentDates,
      상태: row.status,
      비고: row.memo
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), "전체 미수금");
    XLSX.writeFile(book, `전체_미수금_${selectedMonth}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <Panel title="미수금 조회 조건">
        <div className="grid grid-cols-4 gap-3">
          <Field label="마감월"><TextInput type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></Field>
          <Field label="거래처"><SelectInput value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}><option value="all">전체 거래처</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</SelectInput></Field>
          <Field label="거래처 검색"><TextInput value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} /></Field>
          <Field label="현장 검색"><TextInput value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} /></Field>
          <div className="flex items-end"><Button onClick={downloadExcel}>미수금 엑셀 출력</Button></div>
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="전체 청구금액" value={formatWon(totalClaim)} />
        <StatCard label="전체 입금금액" value={formatWon(totalPaid)} tone="mint" />
        <StatCard label="전체 미수금" value={formatWon(totalReceivable)} />
      </div>

      <Panel title="거래처별 미수금 합계">
        <div className="grid grid-cols-4 gap-3">
          {clientTotals.map(({ client, balance }) => (
            <div key={client.id} className="rounded-md border border-navy-100 bg-white p-3">
              <p className="font-bold text-navy-900">{client.name}</p>
              <p className="mt-1 text-lg font-bold text-rose-700">{formatWon(balance)}</p>
            </div>
          ))}
          {clientTotals.length === 0 && <p className="text-sm text-slate-500">미수금이 없습니다.</p>}
        </div>
      </Panel>

      <Panel title="현장별 미수금 합계">
        <div className="grid grid-cols-4 gap-3">
          {siteTotals.map((item) => (
            <div key={item.siteId} className="rounded-md border border-navy-100 bg-white p-3">
              <p className="font-bold text-navy-900">{item.siteName}</p>
              <p className="mt-1 text-lg font-bold text-rose-700">{formatWon(item.balance)}</p>
            </div>
          ))}
          {siteTotals.length === 0 && <p className="text-sm text-slate-500">현장별 미수금이 없습니다.</p>}
        </div>
      </Panel>

      <Panel title="전체 미수금 목록">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["거래처명", "현장명", "청구금액", "입금금액", "미수금액", "계산서", "마감월", "마감일", "결제예정일", "입금일", "상태", "비고"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key} className={selectedRow?.key === row.key ? "bg-mint-50" : ""}><td className={td}><button className="font-bold text-navy-900" onClick={() => setSelectedKey(row.key)}>{row.clientName}</button></td><td className={td}>{row.siteName}</td><td className={td}>{formatWon(row.claimAmount)}</td><td className={td}>{formatWon(row.paidAmount)}</td><td className={td}>{formatWon(row.balanceAmount)}</td><td className={td}>{row.invoiceIssueType === "ISSUED" ? "발행" : "미발행"}</td><td className={td}>{row.closingMonth}</td><td className={td}>{row.closingDay}</td><td className={td}>{row.expectedPaymentDate}</td><td className={td}>{row.paymentDates}</td><td className={td}><ReceivableStatusBadge status={row.status} /></td><td className={td}>{row.memo}</td></tr>)}</tbody>
          </table>
        </DataTable>
      </Panel>

      <Panel title="입금 처리">
        <div className="grid grid-cols-5 gap-3">
          <Field label="선택 현장"><TextInput value={selectedRow ? `${selectedRow.clientName} / ${selectedRow.siteName}` : ""} readOnly /></Field>
          <Field label="미수금액"><TextInput value={selectedRow ? formatWon(selectedRow.balanceAmount) : ""} readOnly /></Field>
          <Field label="입금금액"><TextInput type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field>
          <Field label="입금일"><TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
          <div className="flex items-end"><Button onClick={savePayment}>입금 처리</Button></div>
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
        <div className="grid grid-cols-5 gap-3">
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

      <div className="grid grid-cols-4 gap-4">
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

function RulesView({ data, updateData }: { data: AppData; updateData: (data: AppData) => void }) {
  const [form, setForm] = useState<CalculationRule>(emptyRule);

  const setMoney = (key: keyof CalculationRule, value: number) => {
    const next = { ...form, [key]: ceilWon(value) } as CalculationRule;
    const deductionAmount =
      ceilWon(next.employmentInsurance) +
      ceilWon(next.healthInsurance) +
      ceilWon(next.nationalPension) +
      ceilWon(next.longTermCare);
    setForm({ ...next, laborCost: next.unitPrice, deductionAmount, paymentAmount: next.unitPrice - deductionAmount });
  };

  const save = () => {
    const rule = { ...form, id: form.id || createId("r") };
    updateData({ ...data, calculationRules: form.id ? data.calculationRules.map((item) => (item.id === rule.id ? rule : item)) : [...data.calculationRules, rule] });
    setForm(emptyRule);
  };

  return (
    <div className="grid grid-cols-[380px_1fr] gap-5">
      <Panel title={form.id ? "계산기준 수정" : "계산기준 등록"}>
        <div className="grid gap-3">
          <Field label="공제유형"><DeductionSelect value={form.deductionType} onChange={(value) => setForm(createCalculationRule(form.id, form.unitPrice, value))} /></Field>
          <Field label="나이구분">
            <SelectInput value={form.ageGroup} onChange={(e) => setForm({ ...form, ageGroup: e.target.value as CalculationRule["ageGroup"] })}>
              <option value="ALL">전체</option>
              <option value="UNDER_60">60세 미만</option>
              <option value="OVER_60">60세 이상</option>
            </SelectInput>
          </Field>
          <Field label="단가"><TextInput type="number" value={form.unitPrice} onChange={(e) => setForm(createCalculationRule(form.id, Number(e.target.value), form.deductionType))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="고용보험"><TextInput type="number" value={form.employmentInsurance} onChange={(e) => setMoney("employmentInsurance", Number(e.target.value))} /></Field>
            <Field label="건강보험"><TextInput type="number" value={form.healthInsurance} onChange={(e) => setMoney("healthInsurance", Number(e.target.value))} /></Field>
            <Field label="국민연금"><TextInput type="number" value={form.nationalPension} onChange={(e) => setMoney("nationalPension", Number(e.target.value))} /></Field>
            <Field label="장기요양"><TextInput type="number" value={form.longTermCare} onChange={(e) => setMoney("longTermCare", Number(e.target.value))} /></Field>
          </div>
          <Field label="비고"><TextInput value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          <div className="rounded-md bg-mint-50 p-3 text-sm font-bold text-navy-900">총공제 {formatWon(form.deductionAmount)} / 지급 {formatWon(form.paymentAmount)}</div>
          <div className="flex gap-2"><Button onClick={save}>저장</Button><Button variant="secondary" onClick={() => setForm(emptyRule)}>초기화</Button></div>
        </div>
      </Panel>

      <Panel title="단가별 계산기준 목록">
        <DataTable>
          <table className="w-full border-collapse">
            <thead><tr>{["공제유형", "나이구분", "공제기준금액", "노무비", "고용보험", "건강보험", "국민연금", "장기요양", "총공제액", "지급액", "비고", "관리"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{[...data.calculationRules].sort((a, b) => a.unitPrice - b.unitPrice || a.deductionType.localeCompare(b.deductionType)).map((rule) => <tr key={rule.id}><td className={td}>{rule.deductionType}</td><td className={td}>{ageGroupLabel(rule.ageGroup)}</td><td className={td}>{formatWon(rule.unitPrice)}</td><td className={td}>{formatWon(rule.laborCost)}</td><td className={td}>{formatNumber(rule.employmentInsurance)}</td><td className={td}>{formatNumber(rule.healthInsurance)}</td><td className={td}>{formatNumber(rule.nationalPension)}</td><td className={td}>{formatNumber(rule.longTermCare)}</td><td className={td}>{formatWon(rule.deductionAmount)}</td><td className={td}>{formatWon(rule.paymentAmount)}</td><td className={td}>{rule.memo}</td><td className={`${td} space-x-2`}><Button variant="secondary" onClick={() => setForm(rule)}>수정</Button><Button variant="danger" onClick={() => confirm("계산기준을 삭제할까요?") && updateData({ ...data, calculationRules: data.calculationRules.filter((item) => item.id !== rule.id) })}>삭제</Button></td></tr>)}</tbody>
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
        <thead><tr><th className={th}>근무일</th><th className={th}>거래처</th><th className={th}>현장</th><th className={th}>작업내용</th><th className={th}>요청</th><th className={th}>배치</th><th className={th}>부족</th><th className={th}>단가</th><th className={th}>상태</th></tr></thead>
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
              <td className={td}>{formatWon(request.unitPrice)}</td>
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
      calculationRules: data.calculationRules
    });
  }
  const employmentInsurance = ceilWon(assignment.employmentInsurance || calculated.employmentInsurance || 0);
  const healthInsurance = ceilWon(assignment.healthInsurance || calculated.healthInsurance || 0);
  const nationalPension = ceilWon(assignment.nationalPension || calculated.nationalPension || 0);
  const longTermCare = ceilWon(assignment.longTermCare || calculated.longTermCare || 0);
  const deductionAmount = employmentInsurance + healthInsurance + nationalPension + longTermCare;
  const laborCost = assignment.laborCost || Math.round(assignment.unitPrice * assignment.workCount);
  return {
    ...assignment,
    employmentInsurance,
    healthInsurance,
    nationalPension,
    longTermCare,
    deductionAmount,
    paymentAmount: laborCost - deductionAmount,
    appliedRuleLabel: assignment.appliedRuleLabel || calculated.appliedRuleLabel,
    deductionReason: assignment.deductionReason || calculated.deductionReason,
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
  value,
  onChange,
  onDelete,
  onDownload
}: {
  label: string;
  value?: string;
  onChange: (file?: File) => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-md border border-navy-100 bg-white p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => onChange(event.target.files?.[0])}
          className="w-44 text-xs"
        />
      </div>
      {value ? (
        <div className="flex items-center gap-2">
          <img src={value} alt={label} className="h-16 w-20 rounded border border-navy-100 object-cover" />
          <Button variant="secondary" onClick={onDownload}>다운로드</Button>
          <Button variant="danger" onClick={onDelete}>삭제</Button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">등록된 파일 없음</p>
      )}
    </div>
  );
}

function WorkerApplicationPreview({ worker }: { worker: Worker }) {
  return (
    <div className="mx-auto max-w-3xl border border-navy-200 bg-white p-8 text-navy-900 shadow-sm print:shadow-none">
      <h2 className="mb-6 text-center text-2xl font-black">근로자 신청명세서</h2>
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
      <div className="grid grid-cols-3 gap-3">
        <DocumentImage title="신분증 앞면" value={worker.idCardFrontImage} />
        <DocumentImage title="신분증 뒷면" value={worker.idCardBackImage} />
        <DocumentImage title="이수증" value={worker.safetyCertificateImage} />
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
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(Math.min(paymentDay, lastDay)).padStart(2, "0")}`;
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
        expectedPaymentDate: getExpectedPaymentDate(closingMonth, client?.paymentDay ?? site.paymentDay),
        paymentDates: payments.map((payment) => payment.paymentDate).join(", "),
        memo: site.memo,
        status
      };
    })
    .filter((row) => row.claimAmount > 0 || row.paidAmount > 0);
}

function buildStatementRows(entries: WorkAssignment[], data: AppData, clientName: string, site: Site, selectedMonth: string) {
  const grouped = groupStatement(entries, data);
  const rows: Array<Array<string | number>> = [
    [data.companyInfo.companyName],
    [site.invoiceIssueType === "NOT_ISSUED" ? "(미발급) 거래 명세표" : "거래 명세표"],
    ["거래처명", clientName, "현장명", site.siteName],
    ["정산기간", `${selectedMonth}.01`, "~", `${selectedMonth}.말`, "작성일", formatDateDot(new Date().toISOString().slice(0, 10))],
    site.invoiceIssueType === "NOT_ISSUED"
      ? ["날짜", "현장명", "인원", "단가", "수금액", "미수금액", "기타"]
      : ["날짜", "현장명", "인원", "단가", "노임총액", "노무비", "공제액", "지급액", "수수료", "기타"]
  ];
  grouped.forEach((row) => {
    if (site.invoiceIssueType === "NOT_ISSUED") {
      rows.push([String(row.날짜), String(row.현장명), Number(row.인원), Number(row.단가), Number(row["노무비 합계"]), 0, 0]);
    } else {
      rows.push([String(row.날짜), String(row.현장명), Number(row.인원), Number(row.단가), Number(row["노무비 합계"]), Number(row["노무비 합계"]), Number(row["공제액 합계"]), Number(row["지급액 합계"]), 0, 0]);
    }
  });
  const total = entries.reduce((sum, entry) => sum + entry.laborCost, 0);
  rows.push(["합계", "", entries.length, "", total]);
  if (site.invoiceIssueType === "ISSUED") rows.push(["계산서 금액", total]);
  return rows;
}

function buildDailyPayrollRows(entries: WorkAssignment[], data: AppData, selectedMonth: string) {
  const days = Array.from({ length: 31 }, (_, index) => `${index + 1}일`);
  const rows: Array<Array<string | number>> = [
    ["일용노무비지급명세서"],
    ["정산월", selectedMonth],
    ["직종", "성명", "주민등록번호", "주소", "연락처", ...days, "근무일수", "단가", "소득세/주민세", "고용보험", "건강보험", "국민연금", "장기요양", "차감지급액", "서명"]
  ];
  const groups = new Map<string, WorkAssignment[]>();
  entries.forEach((entry) => groups.set(`${entry.workerId}-${entry.unitPrice}-${entry.deductionType}`, [...(groups.get(`${entry.workerId}-${entry.unitPrice}-${entry.deductionType}`) ?? []), entry]));
  groups.forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const displayItems = items.map((item) => getDisplayAssignment(item, data));
    const dayValues = Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return items.filter((item) => item.workDate.endsWith(`-${day}`)).reduce((sum, item) => sum + item.workCount, 0) || "";
    });
    rows.push(["일용", worker?.name ?? "", worker?.residentNumber ?? "", worker?.address ?? "", worker?.phone ?? "", ...dayValues, new Set(items.map((item) => item.workDate)).size, items[0].unitPrice, 0, displayItems.reduce((sum, item) => sum + item.employmentInsurance, 0), displayItems.reduce((sum, item) => sum + item.healthInsurance, 0), displayItems.reduce((sum, item) => sum + item.nationalPension, 0), displayItems.reduce((sum, item) => sum + item.longTermCare, 0), displayItems.reduce((sum, item) => sum + item.paymentAmount, 0), worker?.signatureDataUrl ? "서명/도장 생성" : ""]);
  });
  const displayEntries = entries.map((item) => getDisplayAssignment(item, data));
  rows.push(["소계", "", "", "", "", ...Array(31).fill(""), "", "", 0, displayEntries.reduce((sum, item) => sum + item.employmentInsurance, 0), displayEntries.reduce((sum, item) => sum + item.healthInsurance, 0), displayEntries.reduce((sum, item) => sum + item.nationalPension, 0), displayEntries.reduce((sum, item) => sum + item.longTermCare, 0), displayEntries.reduce((sum, item) => sum + item.paymentAmount, 0), ""]);
  return rows;
}

function buildReceiptRows(entries: WorkAssignment[], data: AppData, site: Site, selectedMonth: string) {
  const rows: Array<Array<string | number>> = [];
  const groups = new Map<string, WorkAssignment[]>();
  entries.forEach((entry) => groups.set(entry.workerId, [...(groups.get(entry.workerId) ?? []), entry]));
  groups.forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const displayItems = items.map((item) => getDisplayAssignment(item, data));
    rows.push(["영수증"], ["성명", worker?.name ?? "", "주민등록번호", worker?.residentNumber ?? ""], ["주소", worker?.address ?? ""], ["정산기간", selectedMonth, "현장명", site.siteName], ["근무일수", new Set(items.map((item) => item.workDate)).size, "지급금액", displayItems.reduce((sum, item) => sum + item.paymentAmount, 0)], ["상기 금액을 해당 기간 동안 현장 노임으로 정히 영수함"], ["수령인", worker?.name ?? "", "서명/도장", worker?.signatureDataUrl ? "생성됨" : ""], ["신분증사본 영역", worker?.idCardFrontImage ? "앞면 등록" : "앞면 미등록", worker?.idCardBackImage ? "뒷면 등록" : "뒷면 미등록"], [], [], []);
  });
  return rows;
}

function buildDelegationRows(entries: WorkAssignment[], data: AppData, site: Site, selectedMonth: string) {
  const rows: Array<Array<string | number>> = [["위임장"], ["회사 주소", data.companyInfo.companyAddress], ["상호", data.companyInfo.companyName, "대표자", data.companyInfo.companyRepresentative], ["사업자등록번호", data.companyInfo.businessNumber, "계좌정보", data.companyInfo.bankAccountText], ["위임 문구", "아래 근로자는 해당 현장 노임 수령 및 관련 업무를 위임합니다."], ["현장명", site.siteName, "근무기간", selectedMonth], ["이름", "주민등록번호", "주소", "지급액", "서명"]];
  const groups = new Map<string, WorkAssignment[]>();
  entries.forEach((entry) => groups.set(entry.workerId, [...(groups.get(entry.workerId) ?? []), entry]));
  groups.forEach((items) => {
    const worker = data.workers.find((item) => item.id === items[0].workerId);
    const displayItems = items.map((item) => getDisplayAssignment(item, data));
    rows.push([worker?.name ?? "", worker?.residentNumber ?? "", worker?.address ?? "", displayItems.reduce((sum, item) => sum + item.paymentAmount, 0), worker?.signatureDataUrl ? "서명/도장 생성" : ""]);
  });
  rows.push(["합계", "", "", entries.map((item) => getDisplayAssignment(item, data)).reduce((sum, item) => sum + item.paymentAmount, 0), ""]);
  return rows;
}

function buildWorkerApplicationRows(entries: WorkAssignment[], data: AppData) {
  const rows: Array<Array<string | number>> = [];
  const workerIds = Array.from(new Set(entries.map((entry) => entry.workerId)));
  workerIds.forEach((workerId) => {
    const worker = data.workers.find((item) => item.id === workerId);
    if (!worker) return;
    rows.push(
      ["근로자 신청명세서"],
      ["근로자코드", worker.workerCode, "성명", worker.name],
      ["주민등록번호", worker.residentNumber, "생년월일", worker.birthDate],
      ["전화번호", worker.landline, "휴대폰", worker.mobile || worker.phone],
      ["주소", worker.address],
      ["등록일", worker.registrationDate, "직종", worker.jobType],
      ["경력", worker.career, "자격증", worker.certifications],
      ["서류상태", getWorkerDocumentStatus(worker)],
      ["신분증 앞면", worker.idCardFrontImage ? "등록" : "미등록", "신분증 뒷면", worker.idCardBackImage ? "등록" : "미등록"],
      ["이수증", worker.safetyCertificateImage ? "등록" : "미등록", "기타첨부", worker.otherAttachment ? "등록" : "미등록"],
      ["자동 서명/도장", worker.signatureDataUrl ? "생성됨" : "미생성"],
      ["확인문구", "상기 내용으로 근로자 등록 및 해당 현장 마감자료 제출을 확인합니다."],
      [],
      [],
      []
    );
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
