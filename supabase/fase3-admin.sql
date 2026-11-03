-- Admin da plataforma e publicação de sites pelo Criador.
-- Rodar no SQL Editor do Supabase (ou aplicar como migração).

-- Contas que administram todos os sites (você). Não ligadas a uma barbearia.
create table if not exists plataforma_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table plataforma_admins enable row level security;

-- Usuário de teste de cada site, para mostrar o painel aos vendedores.
alter table barbearias add column if not exists teste_user_id uuid references auth.users(id) on delete set null;

-- Convite pode ser de barbeiro (padrão) ou de dono (o dono do site cria o próprio perfil).
alter table convites add column if not exists papel text not null default 'barbeiro'
  check (papel in ('barbeiro', 'dono'));

-- Libera o painel de admin para a sua conta
insert into plataforma_admins (user_id)
select id from auth.users where email = 'tiagoingles@gmail.com'
on conflict do nothing;
