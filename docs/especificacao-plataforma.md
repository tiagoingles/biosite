# Especificação da plataforma de barbearias

Status: **aprovada**, em implementação. Pendências no fim do documento.

## 1. Visão geral

Uma plataforma para barbearias (e depois salões e estéticas) com:
- site público da barbearia (gerado pelo Criador);
- agendamento online com confirmação pelo WhatsApp;
- painel para dono e barbeiros, com agenda, comissões e financeiro;
- assinatura mensal com trial.

## 2. Perfis e acessos

| Perfil | Quem é | Acesso |
|---|---|---|
| **Dono** | Titular da barbearia | Tudo: equipe, comissões, serviços, produtos, despesas, insumos, financeiro, agenda de todos, remanejamentos, confirmações, assinatura |
| **Barbeiro** | Profissional que atende | Própria agenda, disponibilidade, intervalos, aceitar ou recusar pedidos, bloquear horário, registrar serviço e forma de pagamento, ver as próprias comissões |
| **Dono-barbeiro** | Dono que também atende | Une os dois perfis acima |

Regras:
- Cada conta de dono cria uma barbearia. (?) Um dono com mais de uma barbearia não está previsto.
- O dono convida os barbeiros por e-mail. O convite vale 7 dias e só funciona com o e-mail convidado.
- Um barbeiro só vê os próprios dados financeiros.

## 3. Autenticação

- Cadastro e login com e-mail e senha.
- Recuperação de senha por e-mail.
- Login com conta Google.
- Implementação: Supabase Auth, chamado direto pela API REST (sem bibliotecas).
- O Google exige um projeto no Google Cloud e o ID do cliente OAuth configurado no Supabase.

## 4. Agendamento (módulo principal)

### 4.1 Onde aparece
- Botões "Agendar" em todo o site da barbearia.
- Página própria de agendamento.

### 4.2 Como o cliente escolhe
1. Serviço.
2. Profissional. Pode escolher um específico ou "qualquer um".
3. Data e horário, de um de dois jeitos:
   - **Escolho o horário:** informa data e hora, e o sistema mostra se está livre.
   - **Mostrar os horários livres:** o sistema lista os horários disponíveis, com o profissional de cada um.
4. Nome.
5. Envio: abre o WhatsApp da barbearia com a mensagem pronta (serviço, profissional, data, horário, nome e código do pedido) e um pedido de confirmação.

Na versão inicial o número do cliente **não é registrado**. A barbearia vê o nome e o código no próprio WhatsApp e confirma pelo mesmo chat. No Premium, o número é salvo quando o cliente responde (depende da API oficial da Meta).

### 4.3 Fluxo do pedido
`pendente` → (barbeiro ou dono confirma ou recusa) → `confirmado` ou `recusado`. Também existem `cancelado`, `remarcado` e `avulso`.

- Quando um pedido cai para um barbeiro, ele recebe notificação no celular e no painel. Ele aceita ou recusa.
- O dono configura, por barbeiro, se a confirmação final é dele ou do próprio barbeiro.
- Depois de confirmado, o painel mostra um botão que abre o WhatsApp com a mensagem de confirmação.

### 4.4 Disponibilidade do barbeiro
- Grade semanal de horários de trabalho (dias e faixas).
- Intervalos e almoço, cadastrados como bloqueios recorrentes.
- Bloqueio pontual: o barbeiro trava um horário para demanda espontânea.
- A duração de cada serviço define o tamanho do horário ocupado.

### 4.5 Painel do dono
- Agenda de todos os barbeiros, em tempo real.
- Remanejamento: mover um agendamento de horário ou de barbeiro.
- Confirmação e recusa de qualquer pedido.

## 5. Serviços, produtos e fotos

- **Serviço:** nome, preço, duração, insumos utilizados (ver seção 6) e até **5 fotos** e **1 vídeo de até 30 segundos**.
- Validação: o vídeo é verificado pela duração antes do envio, e o tamanho também é limitado no servidor.
- **Produto de venda ao cliente:** nome, preço, estoque com entradas e saídas.

## 6. Financeiro

### 6.1 Registro
- Ao concluir um serviço, o barbeiro registra o serviço prestado, o valor cobrado e a forma de pagamento.
- Venda de produto registra a saída do estoque.

### 6.2 Custos
- **Despesas fixas:** descrição, valor e periodicidade mensal.
- **Insumos:** estoque com entradas (compra) e saídas (uso em serviço ou venda). Cada serviço consome uma quantidade de insumo, e isso gera o custo real.

### 6.3 Comissão
- Configurável por barbeiro.
- Base: serviços, produtos, ou os dois, cada um com seu percentual.

### 6.4 Relatórios
- Visões: diária, semanal, mensal e trimestral.
- Ganhos, gastos, lucro e comissão, por período e por barbeiro.

## 7. Planos e cobrança

| Plano | Preço | Inclui |
|---|---|---|
| **Básico** | R$ 39,90/mês | Todas as funções descritas acima, exceto mensagens automáticas |
| **Premium** | R$ 69,90/mês | Tudo do Básico, mais mensagens automáticas pelo WhatsApp e registro do número do cliente |

- **Taxa de implantação:** R$ 120, paga no ato da contratação.
- **Trial:** 30 dias de uso gratuito após a contratação.
- **Primeira mensalidade:** 60 dias após a contratação.
- **Cobrança:** Stripe, com Pix recorrente (Pix Automático) e cartão.
- **Suspensão por inadimplência:** (?) não definido ainda.

## 8. Mensagens automáticas (Premium)

- Dependem da WhatsApp Cloud API da Meta.
- Exigem conta comercial verificada e modelos de mensagem aprovados.
- Registram o número do cliente quando ele responde.
- Ficam fora da fase inicial.

## 9. Aviso ao barbeiro

- Painel em tempo real e notificação push no celular.
- Sem e-mail para o barbeiro.

## 10. Página de vendas e materiais

- Página de vendas em HTML5, com animações.
- Vídeo promocional com narração e demonstração de uso.
- Vídeo de treinamento para o vendedor presencial.
- Tutoriais curtos para o dono, um por função, e um PDF detalhado.
- Narração: (?) projeto open source "Events Labs" ainda não localizado.

## 11. Infraestrutura

- Hospedagem: Vercel, por enquanto em plano gratuito (protótipo, sem uso comercial). Plano pago antes da primeira cobrança.
- Banco, autenticação e arquivos: Supabase.
- Cobrança: Stripe.
- Mídias: bucket `midia` do Supabase.

## 12. Fases

1. **Acessos e banco** (em andamento): perfis, login (e-mail, recuperação, Google), convites de barbeiros, tabelas base.
2. **Agendamento:** disponibilidade, pedidos, confirmação, notificação, agenda do dono em tempo real, remanejamento.
3. **Serviços e mídias:** cadastro completo de serviços com 5 fotos e 1 vídeo de 30 s.
4. **Financeiro:** registros, despesas fixas, insumos, comissões e relatórios.
5. **Planos e cobrança:** trial, taxa de implantação, Stripe.
6. **Página de vendas e materiais:** página, vídeos, tutoriais e PDF.

Cada fase termina com um checkpoint: você testa antes da próxima.

## 13. Pendências

- Nome da plataforma (para a página de vendas e o material).
- Link do repositório "Events Labs" para a narração.
- ID do cliente OAuth do Google.
- Regra de suspensão por inadimplência.
- Confirmar se um dono pode ter mais de uma barbearia.
