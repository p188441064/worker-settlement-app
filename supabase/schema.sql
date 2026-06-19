-- Supabase database migration draft for worker-settlement-app
-- This schema keeps the current localStorage JSON backup/import flow intact while
-- preparing normalized tables for a later DB-backed storage adapter.

create extension if not exists pgcrypto;

create table if not exists public.workers (
  id text primary key,
  worker_code text not null,
  name text not null,
  birth_date date,
  resident_number text,
  phone text,
  landline text,
  mobile text,
  address text,
  registration_date date,
  job_type text,
  career text,
  certifications text,
  document_status text not null default '미확인',
  signature_style text not null default 'STAMP',
  signature_data_url text,
  memo text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id text primary key,
  name text not null,
  manager_name text,
  phone text,
  fax text,
  email text,
  email2 text,
  closing_day integer not null default 25,
  payment_day integer not null default 10,
  memo text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  site_code text,
  site_name text not null,
  display_name text,
  phone text,
  fax text,
  manager_name text,
  manager_title text,
  manager_phone text,
  settlement_email1 text,
  settlement_email2 text,
  closing_day integer not null default 25,
  payment_day integer not null default 10,
  default_unit_price integer not null default 150000,
  default_deduction_type text,
  default_task_description text,
  invoice_issue_type text not null default 'ISSUED',
  invoice_statement_issued boolean not null default false,
  invoice_statement_issued_date date,
  tax_invoice_issued boolean not null default false,
  tax_invoice_issued_date date,
  invoice_deduction_rate numeric(6,4) not null default 0.1,
  is_active boolean not null default true,
  memo text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id text primary key,
  request_id text,
  worker_id text not null references public.workers(id) on delete restrict,
  client_id text not null references public.clients(id) on delete restrict,
  site_id text not null references public.sites(id) on delete restrict,
  work_date date not null,
  task_description text,
  unit_price integer not null default 0,
  work_count numeric(8,2) not null default 1,
  deduction_type text,
  labor_cost integer not null default 0,
  deduction_amount integer not null default 0,
  payment_amount integer not null default 0,
  status text not null default '배치완료',
  memo text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id text primary key default gen_random_uuid()::text,
  client_id text not null references public.clients(id) on delete cascade,
  site_id text not null references public.sites(id) on delete cascade,
  closing_month text not null,
  claim_amount integer not null default 0,
  paid_amount integer not null default 0,
  balance_amount integer not null default 0,
  expected_payment_date date,
  status text not null default '미수',
  invoice_statement_issued boolean not null default false,
  invoice_statement_issued_date date,
  tax_invoice_issued boolean not null default false,
  tax_invoice_issued_date date,
  memo text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, closing_month)
);

create table if not exists public.documents (
  id text primary key,
  worker_id text not null references public.workers(id) on delete cascade,
  kind text not null,
  file_name text not null,
  original_file_name text,
  mime_type text,
  storage_provider text not null default 'supabase',
  storage_bucket text not null default 'worker-documents',
  storage_path text,
  public_url text,
  uploaded_at date,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sites_client_id on public.sites(client_id);
create index if not exists idx_assignments_work_date on public.assignments(work_date);
create index if not exists idx_assignments_worker_id on public.assignments(worker_id);
create index if not exists idx_assignments_site_month on public.assignments(site_id, work_date);
create index if not exists idx_settlements_closing_month on public.settlements(closing_month);
create index if not exists idx_documents_worker_id on public.documents(worker_id);

-- RLS policy draft: enable when authentication/roles are finalized.
-- alter table public.workers enable row level security;
-- alter table public.clients enable row level security;
-- alter table public.sites enable row level security;
-- alter table public.assignments enable row level security;
-- alter table public.settlements enable row level security;
-- alter table public.documents enable row level security;
