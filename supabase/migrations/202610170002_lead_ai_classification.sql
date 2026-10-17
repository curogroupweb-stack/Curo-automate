-- Clasificación asistida por IA de prospectos; no sobrescribe los datos confirmados.
alter table public.automate_leads
  add column if not exists ai_classification jsonb,
  add column if not exists ai_classification_status text not null default 'pendiente'
    check (ai_classification_status in ('pendiente','sugerida','revisada','error')),
  add column if not exists ai_classified_at timestamptz;

create index if not exists automate_leads_ai_status_idx
  on public.automate_leads (ai_classification_status, updated_at desc);
