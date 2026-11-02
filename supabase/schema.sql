-- Fase 1: contas, perfis, profissionais e convites.
-- Rodar no SQL Editor do Supabase. Apaga a versão de teste de "barbearias" (sem dados reais).
-- Acesso: as rotas da API usam a chave service_role. O RLS fica ligado sem políticas,
-- então o navegador nunca lê essas tabelas diretamente.

drop table if exists barbearias cascade;

create table barbearias (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  nome text not null,
  criado_em timestamptz not null default now()
);

-- Um usuário tem um perfil, que liga a conta a uma barbearia.
-- papel: 'dono' (administra), 'barbeiro' (atende) ou 'dono_barbeiro' (administra e atende).
create table perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  papel text not null check (papel in ('dono', 'barbeiro', 'dono_barbeiro')),
  nome text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists perfis_barbearia on perfis (barbearia_id);

-- Quem atende na barbearia (agenda, comissão). Pode ou não ter login próprio.
create table profissionais (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  perfil_user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists profissionais_barbearia on profissionais (barbearia_id);

-- Convite enviado pelo dono por e-mail. Vale só para o e-mail convidado.
create table convites (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  email text not null,
  token text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  aceito_em timestamptz
);

-- Pedidos de horário feitos no site (a fase 2 liga esta tabela à barbearia por id).
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  codigo text not null,
  servico text not null,
  profissional text not null,
  dia date not null,
  horario text not null,
  cliente text not null,
  observacao text not null default '',
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmado', 'recusado', 'cancelado', 'avulso')),
  criado_em timestamptz not null default now(),
  unique (slug, codigo)
);
create index if not exists pedidos_slug_dia on pedidos (slug, dia);

alter table barbearias enable row level security;
alter table perfis enable row level security;
alter table profissionais enable row level security;
alter table convites enable row level security;
alter table pedidos enable row level security;

-- Bucket público "midia" para fotos e vídeos dos serviços (o site precisa exibir os arquivos).
-- Criar pelo painel: Storage > New bucket > nome "midia" > Public bucket marcado.
