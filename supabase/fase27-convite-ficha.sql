-- Fase 27: convite ligado a uma ficha que já está na equipe. Só acréscimos.
--
-- profissional_id: quem aceitar o convite assume essa ficha (com agenda, agendamentos e bloqueios) em vez de
-- ganhar uma ficha nova. Serve para barbearia migrada de outro sistema, em que os barbeiros já estão na equipe
-- antes de ter login. No convite de dono, a ficha é a do dono que também atende: ele entra como dono-barbeiro.
-- Se a ficha sair da equipe, o convite continua valendo e cria uma ficha nova (on delete set null).

alter table public.convites add column if not exists profissional_id uuid references public.profissionais(id) on delete set null;
create index if not exists convites_profissional on public.convites (profissional_id) where profissional_id is not null;
