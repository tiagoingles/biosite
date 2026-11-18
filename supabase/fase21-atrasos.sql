-- Fase 21: gestão de atrasos. Avisos perto da hora (cliente chegando, cliente atrasado), "Chegou" no
-- atendimento e o lembrete no celular do cliente que pediu no site. Aditivo: uma coluna, duas tabelas,
-- duas extensões do Supabase e dois agendamentos.

-- Hora em que o cliente chegou (o "Chegou" do painel). Sem ela, 10 min depois do horário sai o aviso de atraso.
alter table public.pedidos add column if not exists chegou_em timestamptz;

-- Cada aviso sai uma vez só por atendimento
create table if not exists public.avisos_pedido (
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('chega', 'cliente30', 'atraso', 'cliente_atraso')),
  enviado_em timestamptz not null default now(),
  primary key (pedido_id, tipo)
);

-- Lembrete no celular do cliente (Web Push), ligado na tela de "pedido feito" do site
create table if not exists public.push_clientes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth_key text not null check (char_length(auth_key) <= 100),
  criado_em timestamptz not null default now(),
  unique (pedido_id, endpoint)
);

alter table public.avisos_pedido enable row level security;
alter table public.push_clientes enable row level security;

-- Relógio dos avisos: o próprio banco chama a rota a cada 5 minutos (pg_cron + pg_net, do Supabase)
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'biosite-avisos-perto-da-hora',
  '*/5 * * * *',
  $$ select net.http_get(url := 'https://barbeirotop.com.br/api/config?lembretes=proximos', timeout_milliseconds := 20000) $$
);

-- Faxina: o histórico das execuções e os avisos e lembretes de dias passados não crescem para sempre
select cron.schedule(
  'biosite-faxina-avisos',
  '17 6 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '3 days';
    delete from public.avisos_pedido where enviado_em < now() - interval '7 days';
    delete from public.push_clientes where criado_em < now() - interval '70 days';
  $$
);
