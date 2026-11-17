-- Fase 16: o convite (dono ou barbeiro) cria a conta já confirmada, sem depender do e-mail do Supabase.
-- O link do convite vai pelo WhatsApp e vale como confirmação. Aditivo: só cria uma função de consulta.

-- Diz se já existe conta para um e-mail e se ela está confirmada. Só o servidor (service_role) chama.
create or replace function public.conta_por_email(p_email text)
returns table (id uuid, confirmado boolean)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, (u.email_confirmed_at is not null) as confirmado
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at
  limit 1
$$;

revoke all on function public.conta_por_email(text) from public, anon, authenticated;
grant execute on function public.conta_por_email(text) to service_role;
