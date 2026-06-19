import { ReactNode } from "react";

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-navy-100 bg-white shadow-ledger">
      <div className="flex min-h-14 items-center justify-between border-b border-navy-100 px-5 py-3">
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, tone = "navy" }: { label: string; value: string; tone?: "navy" | "mint" }) {
  return (
    <div className="rounded-lg border border-navy-100 bg-white p-4 shadow-ledger">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={tone === "mint" ? "mt-2 text-2xl font-bold text-mint-600" : "mt-2 text-2xl font-bold text-navy-900"}>
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
      className={`h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 ${props.className ?? ""}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mint-500 focus:ring-2 focus:ring-mint-100 ${props.className ?? ""}`}
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
      className={`h-10 rounded-md px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-600">
      {label}
      {children}
    </label>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-md border border-navy-100">{children}</div>;
}

export const th = "whitespace-nowrap bg-navy-50 px-3 py-2 text-left text-xs font-bold text-navy-800";
export const td = "whitespace-nowrap border-t border-navy-100 px-3 py-2 text-sm text-slate-700";
