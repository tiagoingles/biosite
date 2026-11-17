-- Fase 17: formulário inicial da implantação. O admin gera um link, o dono da barbearia preenche pelo
-- celular (dados da loja, e-mail do login, serviços, produtos, insumos, equipe com comissão, fotos) e as
-- respostas chegam no painel do admin, prontas para o Criador e para o cadastro.
-- Aditivo: só cria a tabela, uma função e uma coluna nova em convites. RLS ligado sem políticas:
-- só o servidor (service_role) lê e escreve.

create table if not exists public.formularios (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (token ~ '^[0-9a-f]{48}$'),
  nome text not null default '' check (char_length(nome) <= 120),
  whatsapp text not null default '' check (char_length(whatsapp) <= 20),
  status text not null default 'aberto' check (status in ('aberto', 'enviado', 'importado', 'arquivado')),
  dados jsonb not null default '{}'::jsonb,
  midias int not null default 0 check (midias >= 0),
  lead_id uuid references public.leads(id) on delete set null,
  barbearia_id uuid references public.barbearias(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  enviado_em timestamptz,
  importado_em timestamptz,
  expira_em timestamptz not null default (now() + interval '60 days')
);
create index if not exists formularios_criado on public.formularios (criado_em desc);
alter table public.formularios enable row level security;

-- Conta um envio de foto ou vídeo do formulário (no máximo p_max) e devolve o id do formulário.
-- Devolve null se o link não vale mais (arquivado, importado, vencido) ou se passou do limite.
create or replace function public.formulario_midia(p_token text, p_max int)
returns uuid
language sql
security definer
set search_path = public
as $$
  update formularios set midias = midias + 1
  where token = p_token and status in ('aberto', 'enviado') and expira_em > now() and midias < p_max
  returning id
$$;
revoke all on function public.formulario_midia(text, int) from public, anon, authenticated;
grant execute on function public.formulario_midia(text, int) to service_role;

-- Comissão combinada no formulário: vai no convite do barbeiro e entra no cadastro quando ele aceita
alter table public.convites add column if not exists comissao_pct numeric(5,2)
  check (comissao_pct is null or comissao_pct between 0 and 100);
