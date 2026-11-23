-- Fase 33: o WhatsApp automático (integração com a Meta) é só do plano Premium. Por enquanto fica liberado
-- só na Barbearia Modelo, para os testes da integração; nas outras barbearias o cartão some do painel e
-- nada é salvo (decisão do Tiago em 23/11; a Dom Manolo não tinha nenhuma automação ligada).
-- Aditivo: uma coluna (falsa para todas) e a Modelo ligada.
alter table public.barbearias add column if not exists whatsapp_premium boolean not null default false;
update public.barbearias set whatsapp_premium = true where slug = 'barbearia-modelo';
