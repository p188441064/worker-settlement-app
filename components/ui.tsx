import { Children, isValidElement, ReactElement, ReactNode } from "react";

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-navy-100 bg-white shadow-ledger">
      <div className="flex min-h-14 flex-col items-start gap-2 border-b border-navy-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
        {actions && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">{actions}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, tone = "navy" }: { label: string; value: string; tone?: "navy" | "mint" }) {
  return (
    <div className="rounded-lg border border-navy-100 bg-white p-4 shadow-ledger">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={tone === "mint" ? "mt-2 text-xl font-bold text-mint-600 sm:text-2xl" : "mt-2 text-xl font-bold text-navy-900 sm:text-2xl"}>
        {value}
      </p>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "mint" | "amber" | "rose" | "slate" }) {
  const tones = {
    mint: "bg-mint-100 text-mint-600",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    slate: "bg-slate-100 text-slate-700"
  };

  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 sm:min-h-10 sm:text-sm ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 sm:min-h-20 sm:text-sm ${props.className ?? ""}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 sm:min-h-10 sm:text-sm ${props.className ?? ""}`}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const variants = {
    primary: "bg-navy-900 text-white hover:bg-navy-800",
    secondary: "border border-navy-100 bg-white text-navy-800 hover:bg-navy-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700"
  };

  return (
    <button
      {...props}
      className={`min-h-11 max-w-full min-w-0 whitespace-normal rounded-md px-4 py-2 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:px-3 ${variants[variant]} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-semibold leading-5 text-slate-600">
      {label}
      {children}
    </label>
  );
}

type TableElement = ReactElement<{ children?: ReactNode }>;

function isElementWithChildren(value: ReactNode): value is TableElement {
  return isValidElement<{ children?: ReactNode }>(value);
}

function elementName(element: TableElement) {
  return typeof element.type === "string" ? element.type : "";
}

function findElementByName(children: ReactNode, name: string): TableElement | undefined {
  return Children.toArray(children).find((child): child is TableElement => isElementWithChildren(child) && elementName(child) === name);
}

function getCellRows(section?: TableElement) {
  if (!section) return [];
  return Children.toArray(section.props.children)
    .filter((row): row is TableElement => isElementWithChildren(row) && elementName(row) === "tr")
    .map((row) => Children.toArray(row.props.children).filter((cell): cell is TableElement => isElementWithChildren(cell)));
}

function getHeaderLabels(table: TableElement, columnCount: number) {
  const headerRow = getCellRows(findElementByName(table.props.children, "thead"))[0] || [];
  return Array.from({ length: columnCount }, (_, index) => headerRow[index]?.props.children || `항목 ${index + 1}`);
}

function MobileTableCards({ children }: { children: ReactNode }) {
  const table = Children.toArray(children).find((child): child is TableElement => isElementWithChildren(child) && elementName(child) === "table");
  if (!table) return null;

  const rows = getCellRows(findElementByName(table.props.children, "tbody"));
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = getHeaderLabels(table, maxColumns);
  if (!rows.length) return <p className="rounded-md border border-navy-100 bg-white p-4 text-sm text-slate-500">표시할 데이터가 없습니다.</p>;

  return (
    <div className="grid gap-3 md:hidden print:hidden">
      {rows.map((row, rowIndex) => {
        const primaryCells = row.slice(0, 3);
        const detailCells = row.slice(3);
        return (
          <article key={rowIndex} className="rounded-md border border-navy-100 bg-white p-3 shadow-sm">
            <div className="grid gap-2">
              {primaryCells.map((cell, cellIndex) => (
                <div key={cellIndex} className={cellIndex === 0 ? "text-base font-bold text-navy-900" : "text-sm text-slate-700"}>
                  <span className="mr-2 text-xs font-semibold text-slate-500">{headers[cellIndex]}</span>
                  <span className="break-words">{cell.props.children}</span>
                </div>
              ))}
            </div>
            {detailCells.length > 0 && (
              <details className="mt-3 rounded-md bg-slate-50 p-2 text-sm text-slate-700">
                <summary className="min-h-10 cursor-pointer list-none rounded-md px-2 py-2 font-bold text-navy-800">상세정보</summary>
                <div className="mt-1 grid gap-2">
                  {detailCells.map((cell, index) => {
                    const cellIndex = index + primaryCells.length;
                    return (
                      <div key={cellIndex} className="grid gap-1 border-t border-slate-200 pt-2 first:border-t-0 first:pt-0">
                        <span className="text-xs font-semibold text-slate-500">{headers[cellIndex]}</span>
                        <div className="min-w-0 break-words">{cell.props.children}</div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <>
      <MobileTableCards>{children}</MobileTableCards>
      <div className="hidden w-full overflow-x-auto rounded-md border border-navy-100 md:block print:block [-webkit-overflow-scrolling:touch]">{children}</div>
    </>
  );
}

export const th = "whitespace-nowrap bg-navy-50 px-3 py-2 text-left text-xs font-bold text-navy-800";
export const td = "whitespace-nowrap border-t border-navy-100 px-3 py-2 text-sm text-slate-700";
