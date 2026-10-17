-- CURO Automation Manager MVP · Bandeja multicanal de prospectos
-- Ejecutar una sola vez en Supabase SQL Editor del proyecto "Curo group Plataforma".
create extension if not exists pgcrypto;

create table if not exists public.automate_leads (
  id uuid primary key default gen_random_uuid(),
  contact_name text,
  email text,
  phone text,
  organization_name text,
  sector text,
  process_affected text,
  problem text,
  desired_outcome text,
  channel text not null default 'otro' check (channel in ('web','email','instagram','tiktok','linkedin','youtube','telefono','referido','campana','otro')),
  source_detail text,
  campaign text,
  status text not null default 'nuevo' check (status in ('nuevo','pendiente','contactado','diagnostico','propuesta','cliente','descartado')),
  consent_contact boolean not null default false,
  next_follow_up_at timestamptz,
  notes text,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automate_leads_status_updated_idx on public.automate_leads (status, updated_at desc);
create index if not exists automate_leads_channel_created_idx on public.automate_leads (channel, created_at desc);
create index if not exists automate_leads_email_idx on public.automate_leads (lower(email)) where email is not null;

alter table public.automate_leads enable row level security;
-- La API usa la service role solo después de comprobar que el usuario autenticado es admin.
-- No se habilitan políticas de lectura/escritura directa desde el navegador.
revoke all on public.automate_leads from anon, authenticated;
grant all on public.automate_leads to service_role;
