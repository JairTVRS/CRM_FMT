# Roadmap dos lotes — CRM Formatar

**Atualizado em:** 05/10/2026
**Versão no ar:** 2.42.0 (desde 05/10/2026; migrações 008 a 028 aplicadas no D1 remoto, a 027 e a 028 em 05/10/2026 pelo --command e conferidas; binding **Workers AI** `AI` ligado desde 29/09/2026; Worker `crm-fmt-prospects-diario` com o Cron das 06:00)

Este documento é o ponto de retomada. Registra o que já foi entregue, o
que vem a seguir e o que está travado esperando material.

## ▶ Retomada (01/10/2026)

**Onde paramos (fim de 01/10/2026):** no ar a **2.39.2**. Dois lotes
fechados no mesmo dia:

- **Jornada do lead (JL)**, fechado com a 2.38.2: funil com responsável e
  motivos de perda; agenda (semana, quinzena, mês); reunião com
  iniciar/finalizar, cancelar com motivo, situação automática, resetar e
  histórico; gravação e transcrição; e o **Dossiê da Reunião** — a IA segue
  a instrução .md do tipo de reunião e aponta a linha da transcrição; o CRM
  põe as palavras exatas (`_lib/citacoes.js`) — que vai junto quando o lead
  vira cliente.
- **Dossiê lê as atas + Balança Avaliativa**, fechado com a 2.39.2: a IA lê
  as atas dos últimos 6 meses do ERP (só a parte pública) e o plano de
  ação, e pesa a relação; os números do período são do código. Na ficha do
  cliente, a aba **Documentos de contexto** reúne os três documentos, uma
  linha por documento, com o nome exato do arquivo (`…_v1.html`).

**Validado em produção em 01/10/2026:** reunião presencial real de 24 min
(118 trechos) — Dossiê da Reunião v1 com 27 citações e nenhuma "não
encontrada"; Balança da Zanna Sound com 42 reuniões, 33 ações, 22
evidências e nenhuma "não encontrada".

**05/10/2026 — Lote G (contrato) no ar na 2.40.0** (`b1a8b0a`), passou na frente do N
a pedido do Jair. Respostas dele às 4 perguntas: (a) o modelo é padrão e o
app o monta — o arquivo da Trinta Dezessete serviu só de referência; o km
é do **cadastro do lead** (negociado por lead); os dados do cliente vêm do
lead; (b) formas de preço num **cadastro** (Claude sugeriu 6), com editar,
inativar e excluir — **não exclui se vinculada a lead**; inativa some das
opções; (c) contratada padrão Formatar Consultoria Empresarial Ltda, com
**cadastro** para outros CNPJs; (d) o escopo vem da **proposta**. Depois:
cadastros **só admin**; a forma de preço vale também para as **propostas
novas** (as geradas ficam como estão). Migração **027**. Ver "Entregue".

**Próximos passos, em ordem:**

| # | O quê | Para começar |
|---|---|---|
| 1 | **Lote N — Check-in, NPS/CSAT e Voz do Cliente** | só tem o título: **desenhar com o Jair antes do código** — o que medir (NPS, CSAT, os dois?), quando perguntar (depois de reunião, a cada X meses?), como o cliente responde (link, WhatsApp, o CX registra?), onde aparece (ficha, Balança, painel) |
| 2 | **Contrato: primeiro uso real** | o admin cadastra em Configurações → Empresas contratadas **quem assina pela Formatar** (sem isso o contrato não sai) e confere o endereço da sede (veio do cartão CNPJ: Av. Sete de Setembro, 1470, Apto 301); conferir o texto das cláusulas com o jurídico |
| 3 | **Fase 3 da 2.24.0** — estruturada em 05/10/2026 | Respostas do Jair: (1) pessoa não "some" do ERP — a lista espelha o cadastro do cliente no ERP; quem sai é excluído lá; (2) núcleo do cliente = **carteira ativa** do ERP; (3) a CX **não** cadastra pessoa fora do ERP; (4) filtro por núcleo na lista de clientes **fica** (vindo do ERP). Entregas: **2.42.0** conferência (no ar em 05/10; aguardando o resultado colado pelo Jair) → **2.43.0** aba Stakeholders com as pessoas do ERP e a avaliação presa ao código do contato (migração 029; plano B: e-mail) → **2.44.0** núcleos do cliente pelas carteiras, sai o campo da ficha/conversão e os cadastros Núcleos/Papéis (tabelas ficam). Produção em 05/10: 0 pessoas avaliadas no CRM, 1 cliente com núcleo na ficha, 1 papel — nada relevante a migrar |
| 4 | Teste C da gravação (retomar depois de F5) | quando der — 2 minutos do Jair |

**Ao retomar:** abrir este bloco; se o Jair responder o contrato antes,
o contrato pode passar na frente do N (não depende de desenho).

### Pendências, em ordem

**1. Pequenas** (respondidas pelo Jair em 01/10/2026)

| # | O quê | Estado |
|---|---|---|
| — | ~~Citação 100% fiel no Dossiê da Reunião~~ | **feito na 2.38.3**: a IA aponta a linha (`[37] trecho`) e o CRM põe as palavras exatas da transcrição; o erro de uma letra da IA não chega ao documento |
| 1.1 | Teste C da gravação (retomar depois de F5) | para quando der ("ok", 01/10); nenhuma reunião tem duas gravações ainda |
| — | ~~`LEIAME-progresso.md` vazio~~ | **excluído** em 01/10/2026, a pedido do Jair (o conteúdo da v2.8.1 fica no histórico do git) |
| — | ~~"Não compareceu" pedir observação~~ | **retirado**: "o não compareceu já é a observação" |

**2. Lote JL (jornada do lead): fechado em 01/10/2026**

| Versão | Entrega |
|---|---|
| 2.31.0 a 2.36.1 | Funil, agenda, prospects do ERP, chaves de IA e roteiros, gravação, iniciar/finalizar (ver "Entregue", abaixo) |
| 2.36.2 | **Cancelar com motivo**: os 4 motivos do ERP e observação; o cancelado fica roxo (migração 022) |
| 2.36.3 | **A situação acompanha o cartão**: etiqueta automática; muda só pelos botões; o encerrado não volta (`JA_ENCERRADO`) |
| 2.36.4 | **Resetar e Quinzena**: volta a só agendado no horário cadastrado, apagando o que aconteceu depois (CX responsável, quem iniciou ou admin) |
| 2.36.5 | **Histórico de cada compromisso**: quem, quando e o que mudou, em `agenda_eventos` (migração 023) |
| 2.36.6 | **Transcrição mais rápida e presencial**: trechos de 3–8 s, 3 envios juntos, "Sala" na presencial |
| 2.37.0 | **Recortes e roteiro durante a reunião** (migração 024) — saíram da tela na 2.38.1: "o dossiê já resolve". A `/api/recortes` e a `reuniao_analises` ficam, sem tela |
| 2.38.0 | **Dossiê da Reunião**: instrução .md por tipo nas Configurações (`roteiros.finalidade = dossie_reuniao`); a IA escreve HTML simples; o CRM limpa, confere cada `<q>` (minuto, ou "não encontrada na transcrição") e monta no visual da Formatar, com versões (`dossies_reuniao`, migração 025); corrigida a separação de vozes (lead ≥ 15% da conversa) |
| 2.38.1 | **Tela limpa e ícone**: recortes e roteiro fora da tela; ícone do CRM embutido nos documentos (`_lib/icone.js`) |
| 2.38.2 | **O dossiê vai junto na conversão**: aba **Pré-venda** na ficha do cliente lista os Dossiês da Reunião do lead de origem (`clientes.lead_id`; nada é copiado, os gerados depois também aparecem) |

**Eliminados da fila em 01/10/2026** (decisão do Jair): evento no Google Agenda com o Meet; identificar quem fala pelo Deepgram (custo por hora); voz sem terceiros no navegador. Não voltam sem pedido dele.

**3. Os próximos lotes, na ordem combinada em 01/10/2026**

| # | Entrega | O quê | Depende de |
|---|---|---|---|
| ~~1~~ | ~~**Dossiê lê as atas + Balança Avaliativa**~~ | **FECHADO em 01/10/2026** — no ar na 2.39.0 (01/10/2026, migração 026, `balancas`): aba Balança no cliente; a IA lê as atas dos últimos 6 meses do ERP (só a parte pública — `separarNotasPrivadas` do `_lib/ata.js`) e o plano (`acoes_cx`), com a pré-venda como referência; números do período em código; evidências ancoradas na linha (`_lib/citacoes.js`, módulo comum com o Dossiê da Reunião); instrução padrão V1.0 em `Manuais/Instrucao-Balanca-Avaliativa-V1.0.md` (cópia no código, conferida pela prova) ou a enviada nas Configurações (`roteiros.finalidade = balanca`, tipo `__geral__`). Só a Balança: o Dossiê de Experiência ficou como estava (decisão de 01/10). 1ª geração real (Zanna Sound, 01/10): 42 reuniões, 33 ações, 22 evidências, 0 não encontradas. **2.39.1**: Dossiê de Experiência, Pré-venda e Balança numa aba só, "Documentos de contexto", com o nome exato do arquivo e "Baixar" direto; os três com `_vN` no nome (revisa a decisão de 06/09 de não pôr a versão no nome do Dossiê de Experiência) **2.39.2**: a aba ficou compacta, uma linha por documento | — |
| 2 | **N — Check-in, NPS/CSAT e Voz do Cliente** | Destravado: dependia só do F, entregue na 2.18.0/2.19.0 | nada |
| 3 | **Fase 3 da 2.24.0** | Aposentar o campo de núcleos da ficha e o cadastro de Papéis (vale o Cargo do ERP); amarrar influência/postura ao id do contato do ERP. Leva a próxima migração livre (**029**; a 028 foi da 2.41.0) | o `contacts` do ERP ter id estável |

**4. Travados, esperando material**

| Lote | Entrega | Falta |
|---|---|---|
| **G** | Boas-vindas (a outra metade do G) | o **contrato** saiu na 2.40.0; o documento de boas-vindas segue sem conteúdo definido |
| **J** | Webhooks e notas | endpoint das notas da carteira + estrutura dos webhooks |
| **K** | KPIs Empresariais | endpoint de indicadores |
| **M** | Saúde de CX | J e K |
| **O** | Relatório de Valor Gerado | G e K |
| **P** | Dashboard de CX, CX Review e Expansão | tudo acima |

### Como a gente trabalha (combinado)

Plano primeiro quando o pedido diz "ainda não execute"; com "pode
executar e subir", vai inteiro: migração no D1 remoto **e conferência**,
segredos no Pages, prova (`npm run prova`), captura de tela no Edge sem
janela para mudanças de tela, commit `vX.Y.Z - …`, push e espera o
`/api/config` responder a versão nova. Cada versão entra no topo de
`public/novidades.json` (a `ids.mjs` falha se não entrar). O token do
`wrangler` desta máquina tem escopo de D1 (as migrações 016–020 foram
aplicadas por ele).

**Histórico resolvido:** a chave do hub tem as cinco permissões
(`customers`, `portfolios`, `meetings`, `meeting-types`, `teams`); o
Plano de Ação leu 608 carteiras em 21/09/2026. A migração 012 (plano
gravado) está aplicada.

---

## Onde estamos

O CRM deixou de ser só captação e passou a ter **duas trilhas no mesmo
produto**: o funil comercial (lead) e o relacionamento com cliente ativo
(CX). São dois pipelines separados — captar cliente e cuidar de cliente
são processos diferentes.

A área de CX da Formatar existe e é a dona da segunda trilha.

### Entregue

| Lote | Versão | Entrega |
|---|---|---|
| A | 2.9.0 | Base do funil: campos, advisors, tags e etapas |
| B | 2.10.0 | Importação de planilhas |
| **C** | **2.11.0** | **Quadro kanban genérico por pipeline**, classificação 1–6, arraste com suporte a toque, correção do Canal que não gravava |
| **D** | **2.12.0** | **Gaveta lateral** e ficha completa com a aba do Funil |
| **E** | **2.13.0** | **Gerador de documentos** e proposta comercial; paleta oficial da marca |
| **H** | **2.14.0** | **Jornada do cliente**, clientes, núcleos e papéis (2.14.1 corrigiu a proposta) |
| **L** | **2.15.0** | **Mapa de stakeholders e Dossiê de Experiência** — consumidor de verdade dos papéis criados no H |
| — | **2.16.0** | **Ajustes de tela** — calendário abre pelo campo, busca de CEP no ViaCEP, e a análise falsa da IA removida |
| — | **2.17.0** | **Versionamento num módulo só** — os três geradores passam a compartilhar `_lib/versionamento.js`; a proposta ganha registro de falha (migração 009) |
| **F¹** | **2.18.0** | **O lead vira cliente** — conversão a partir de "Finalizado", com tela de setup |
| **F²** | **2.19.0** | **Os clientes do ERP na Jornada** — lista ao vivo, "sem jornada" com um clique para começar, trava do CNPJ e vínculo do `erp_id` |
| — | **2.20.0** | **Trazer todos de uma vez** — a carteira inteira do ERP entra na jornada em lotes transacionais |
| **I** | **2.21.0** | **Reuniões, atas e plano de ação em 5W2H** — parser do manual v2.3, tela própria com a fila de ações de todas as carteiras (migração 010) |
| — | **2.21.1** | **Correção do cartão que parou de abrir** — uma segunda `registroPorId` declarada na 2.19.0 sombreava a primeira e travava os dois quadros |
| — | **2.22.0** | **As permissões do hub todas de uma vez**, filtros do Plano de Ação nunca vazios e o nome padrão dos documentos (`Dossie_Prospeccao_Cliente_2026_09`) |
| — | **2.23.0** | **A sessão para de cair** (403 do hub não é mais expulsão), guarda contra afirmação sem fonte no dossiê, `etapa_desde` (migração 011) e nome de arquivo pelo fantasia |
| — | **2.23.2** | **A importação lê a planilha que existe** — uma aba só com aviso que ensina a reexibir a oculta, cabeçalho procurado em vez de assumido na linha 1, `.xls`/`.xlsb`, modelo gerado no navegador, etapa vinda do `Status2` e etapas novas confirmadas na prévia |
| — | **2.24.0** | **A conta é do ERP, o CRM anota por cima** — identidade, classificação, pessoas e núcleos lidos ao vivo do hub no Dossiê de Experiência; três estados em vez de dois (tem / não tem / **não perguntei**) e guarda em código contra afirmar o vazio não conferido |
| — | **2.25.0** | **O plano de ação é gravado e se edita** — tabela compacta, todo campo editável com um clique, histórico de cada alteração (quem, quando, de → para, à mão ou pela ata), e carga incremental: só as reuniões novas desde a última carga (migração 012). Absorve o "Lote 6" corretivo |
| — | **2.26.0** | **Painel do plano** — rosca por prazo, gargalos de cadastro e abertas por núcleo, tudo filtrando a tabela; colunas ordenáveis; a carga para de parar no 429 do hub |
| — | **2.27.0** | **Sessão de 7 dias** (Lote 4, opção B) — cookie HttpOnly assinado pelo servidor, renovado a cada abertura; o hub segue conferindo o cadastro a cada 5 min |
| — | **2.28.0** | **Colunas do plano por usuário** — engrenagem com arrastar, mostrar/esconder, ordenar e linhas por página, salvas no servidor por e-mail (migração 013) |
| — | **2.28.1** | **Uma rolagem só** — a tela do plano cabe na janela, só a tabela rola, painel mais baixo e recolhível |
| — | **2.29.0** | **Datas e tipo de ação** — prazo da ata lido em 01/01/2026 ("dez/26" = último dia do mês), "Quando" e "Data prevista" numa coluna só, e Tipo de ação Operacional/Tática/Estratégica (migração 014) |
| — | **2.30.0** | **A reunião é do ERP** — cabeçalho da ata não é mais conferido onde o ERP já deu a informação, responsável = participantes da reunião quando a ata não nomeia, status do cliente em coluna e filtro (padrão: ativos) (migração 015) |
| — | **2.30.1** | Menu: "Jornada" passa a ser "Jornada do cliente" |
| **JL¹** | **2.31.0** | **Funil arrumado** — CX responsável (quem cadastrou, trocável entre quem usa o CRM), admin pelo grupo do hub, motivos de perda obrigatórios (5 modelos, só admin edita), encerramento em ganho/perdido, "Finalizado" vira "Contrato emitido" e a conversão ao arrastar volta a existir (migração 016) |
| — | **2.31.1** | **Admin pelo id do grupo** — a permissão `hub:user-groups:read` fica fechada (abre a árvore de acesso do hub); o CRM compara o id do grupo, que já vem com o usuário |
| **JL²** | **2.32.0** | **Agenda do lead** — reuniões (tipos do hub, Time Vendas; local online/presencial/externo; dossiê dentro) e contatos; remarcar preserva o histórico; próximo contato derivado da agenda; visão Agenda semana/mês; aba Agenda na ficha; selo "sem agenda" (migração 017) |
| — | **2.32.1** | A escolha do lead na agenda vira lista clicável (era `<datalist>`, que extensões de preenchimento escondiam); título do mês com a inicial maiúscula só no mês |
| **JL³** | **2.33.0** | **Prospects do ERP, 1× por dia** — Worker com Cron às 06:00 chama o CRM pelo `CRON_SECRET`; novo vira lead em Novo Lead, canal ERP, sem responsável; mesmo CNPJ vincula; excluído não volta; "Importar agora" para admin (migração 018) |
| **JL⁴** | **2.34.0** | **Chaves de IA e roteiros** — provedor em uso no servidor (valia por navegador, e o dossiê o ignorava); chave cadastrada pelo admin, cifrada (AES-GCM, `CHAVES_SECRET`), nunca devolvida à tela, a do painel vale primeiro; roteiro .md por tipo de reunião, versionado, visível na reunião (migração 019) |
| — | **2.34.1** | **Barra do topo** — tema, configurações e o usuário (iniciais, menu com Sair) no canto superior direito; barra lateral só com o menu, mais estreita; **tema claro por padrão**, o escuro lembrado por navegador |
| — | **2.34.2** | **A versão no canto inferior esquerdo** e, ao clicar, "O que mudou" (`public/novidades.json`, conferido pela `ids.mjs` contra o package.json) |
| **JL⁵** | **2.35.0** | **Gravação e transcrição da reunião** — consentimento registrado; no computador, microfone e áudio da aba separados (Formatar / Lead); pedaços de 20 s em WAV 16 kHz, transcritos pelo Workers AI (ou OpenAI) e descartados — só o texto fica; encerrar marca a reunião como realizada; a gravação fica presa à versão do roteiro (migração 020) |
| **JL⁶** | **2.36.0** | **Iniciar e finalizar a reunião** (pedido de 30/09/2026) — "Iniciar reunião" guarda a hora real e já começa a transcrever (com o consentimento marcado; sem ele, começa sem gravar); "Finalizar" guarda o fim e a torna realizada (a lista não pula mais o fim); **uma em andamento por pessoa** (API + índice único da migração 021; admin finaliza a de outra pessoa); em andamento não se cancela, remarca nem exclui; aviso verde no canto leva à reunião aberta, com "Retomar a gravação"; cartões da agenda no formato do Painel de Operações, amarelo/vermelho/verde/verde-claro, redesenhados a cada minuto |
| — | **2.36.1** | **Janela larga e gravação refeita** — janela da reunião em duas colunas (campos 4 por linha à esquerda; dossiê e andamento à direita), sem rolar em 1280×800; consentimento já marcado; áudio sem escolha: microfone + **tela inteira com áudio do sistema**; captura por **AudioWorklet** (a antiga perdia ~35% do som com a aba em segundo plano — razão medida 1,002 na nova); pedaço fecha na **pausa** (6–15 s); **texto provisório crescendo** a cada ~3 s (`provisorio: true`, não salvo; não pede com a aba do CRM escondida); filtros: outra escrita (islandês), eco da dica, palavra repetida, pedaço com < 0,8 s de voz; medidores de volume e aviso de som mudo |
| — | **2.36.2–2.36.6** | **A agenda completa** — cancelar com motivo (roxo), situação automática, resetar, quinzena, histórico de cada compromisso (`agenda_eventos`), transcrição mais rápida e "Sala" na presencial (migrações 022 e 023) |
| — | **2.37.0** | **Recortes e roteiro durante a reunião** — conferidos palavra por palavra contra a transcrição (migração 024); saíram da tela na 2.38.1 |
| **JL⁷** | **2.38.0** | **Dossiê da Reunião** — instrução .md por tipo nas Configurações, conteúdo da IA limpo e com as citações conferidas, visual da Formatar, versões (migração 025) |
| — | **2.38.1–2.38.2** | Tela da reunião limpa, ícone do CRM nos documentos e a aba **Pré-venda** no cliente — **fecha o lote JL** (01/10/2026) |
| — | **2.39.0–2.39.2** | **Balança Avaliativa** e a aba **Documentos de contexto** no cliente (01/10/2026) |
| **G** | **2.40.0** | **Contrato** (05/10/2026) — aba Contrato no lead (km, forma de preço, contratada, quem assina pelo cliente); o app monta o contrato padrão (`_lib/contrato-template.js`) com o escopo e os valores da **última proposta**, valores por extenso (`_lib/extenso.js`), o que falta listado antes de gerar (`prepararContrato`, `_lib/contrato.js`), versões (`contratos`, quarto consumidor do `_lib/versionamento.js`); cadastros **Formas de preço** (texto com marcadores, `_lib/forma-preco.js`) e **Empresas contratadas** nas Configurações, só admin, inativar e excluir só sem lead vinculado; a proposta nova usa o km do lead e traz a forma numa folha própria; o contrato aparece em Documentos de contexto do cliente (migração 027; prova `contrato.mjs`, 73) |
| — | **2.40.1** | **Contrato sem sair da aba** (05/10/2026) — endereço do cliente (espelho da aba Contato & Endereço, CEP pelo ViaCEP), bloco da proposta com o resumo e "Gerar proposta agora", "Salvar e conferir" |
| — | **2.41.0** | **Histórico do lead** (05/10/2026, pedido do Jair) — relógio no topo da ficha; quem, quando, campo por campo de → para (`lead_eventos`, migração 028, `_lib/lead-eventos.js`); entram criar, alterar, mover no quadro, proposta e contrato gerados, conversão e exclusão; salvar sem mudar nada não registra; o histórico nunca derruba o salvamento (prova `historico.mjs`, 22) |
| — | **2.41.1** | **Contrato: tudo editável na aba** (05/10/2026) — CNPJ/CPF espelhado na aba Contrato (lead do ERP sem CNPJ não salvava); escopo e os valores que a forma de preço usa editáveis no bloco Proposta; lista do que falta aponta para a aba; corrigido o "—" escrito no campo de CNPJ vazio |
| — | **2.41.2** | **Endereço do cadastro** (05/10/2026) — rodapé da proposta e do contrato e assinatura da proposta vêm de Empresas contratadas (a do lead ou a padrão; `buscarContratadaDoLead`/`enderecoDaContratada` em `_lib/contrato.js`); o fixo `FORMATAR.endereco` fica só de reserva (e no Dossiê de Experiência) |
| — | **2.42.0** | **Conferência das pessoas no ERP** (05/10/2026, 1ª entrega da Fase 3 da 2.24.0) — cartão admin nas Configurações (`/api/hub-diagnostico`, `_lib/diagnostico-pessoas.js`): pede `contacts`, `stakeholders` e `/customers/{id}/stakeholders` e descreve só a forma (campos, quantidades, quantos com código), nunca valores (prova `diagnostico.mjs`, 14) |

**A versão segue a ordem de ENTREGA, não a do plano.** O H saiu como
2.14.0 e o L como 2.15.0, embora o plano original os numerasse mais à
frente. Quando o F sair, será a próxima da fila — não a 2.15.

### A seguir: o lote da jornada do lead (JL)

Decidido com o usuário entre 28/09/2026 e a entrega da 2.31.0. Foco:
**organizar o setor de CX**, que conduz o lead da entrada até o contrato
emitido ou a perda. Uma versão por entrega, cada uma testável sozinha.

| Versão | Entrega | Depende de |
|---|---|---|
| ~~2.31.0~~ | ~~Funil arrumado~~ — entregue (2.31.1: admin pelo id do grupo) | migração 016 |
| ~~2.32.0~~ | ~~Agenda do lead~~ — entregue (o Time "Vendas" já está no hub) | — |
| ~~2.33.0~~ | ~~Prospects do ERP, 1× por dia~~ — entregue | — |
| ~~2.34.0~~ | ~~Chaves de IA e roteiros~~ — entregue | o binding Workers AI no painel (para a 2.35.0) |
| ~~2.35.0~~ | ~~Gravação e transcrição ao vivo~~ — entregue | um transcritor: binding Workers AI ou chave OpenAI |
| ~~2.36.0~~ | ~~Iniciar e finalizar a reunião~~ — entregue em 30/09/2026 | migração 021 |
| ~~2.36.1~~ | ~~Janela larga e gravação refeita (texto crescendo, eco da dica)~~ — entregue em 30/09/2026 | — |
| **2.37.0** | **Recortes e insights durante a reunião** — frases do lead que captam a expectativa, conferidas por código contra a transcrição; perguntas do roteiro ainda não cobertas | 2.35.0 |
| **2.38.0** | **Laudo pós-reunião** — HTML versionado, visível para todos, **só registra** (não mexe no lead); vai com o lead na conversão, como histórico da pré-venda | 2.35.0 |
| depois | Evento no Google Agenda com link do Meet | OAuth com escopo de agenda |

**Decisões que valem para o lote:**

- **A agenda do lead mora no CRM.** O ERP só entra quando o lead vira
  cliente. As reuniões de venda **não entram no Painel de Operações** do
  ERP — decidido: "para o painel de operações será sem comercial".
- **Admin = grupo do hub**: Planejamento e Controle de Produção, Sócios —
  comparados pelo **id**. `hub:user-groups:read` fica **fechada**: abre a
  árvore de acesso dos usuários do hub.
- **Ficamos na Cloudflare.** Cogitou-se a Vercel pelo agendamento; o Cron
  Trigger de um Worker resolve, e a troca custaria o D1 e o plano pago
  (o Hobby da Vercel não permite uso comercial).

### Depois do lote

> **Consolidado em 29/09/2026** em "▶ Retomada → Pendências, em ordem", no topo. O texto abaixo é o histórico das decisões; os números de versão citados nele já foram tomados por outras entregas.

**A ordem mudou duas vezes**, sempre pela mesma razão: entregar o que não
depende de material externo. Em 04/09 o H passou na frente do F; em 05/09
o L passou na frente do I. Os lotes abaixo não têm mais versão reservada
— ganham a próxima quando saírem.

**Os dois proximos ja estao desenhados**, decididos com o usuario em
07/09/2026:

| Versao | Entrega | Depende de |
|---|---|---|
| **2.24.0 — ENTREGUE em 15/09/2026, Fases 1 e 2** | **Identidade do ERP, avaliacao do CRM** — as pessoas vem do `contacts` de `/customers` e a ligacao delas com o nucleo sai do `customerParticipants` das reunioes; o CRM nao cria nem renomeia pessoa. Nucleo, no dossie, e o **Time** | nada — as quatro permissoes ja estavam na chave |
| **Fase 3** | **Proxima migracao livre** (era 012; a 2.25.0, a 2.28.0, a 2.29.0, a 2.30.0 e a 2.31.0 tomaram os números) — aposentar o campo de nucleos da ficha e o cadastro de **Papeis** (vale o Cargo do ERP), e amarrar influencia/postura ao id do contato do ERP em vez de casar por e-mail em tempo de leitura | escopo de D1 no `wrangler`, e o `contacts` ter id estavel — que a primeira geracao real responde |
| **2.31.0** (era 2.25.0) | **O dossie le as atas** + **Balanca Avaliativa**, aba propria no cliente: positivos e negativos lado a lado, cada um ancorado em acao, ata ou registro com data | nada — `hub:meetings:read` ja esta na chave |

A 2.31.0 nao depende da 2.24.0. Se o `contacts` der problema, a ordem
inverte. Com o plano gravado (2.25.0), ela pode ler as acoes do banco em
vez de reler as atas.

**Reversao registrada:** em 05/09 eu deixei `contacts` fora do `fields`
do `/customers`, com a justificativa de que "a ficha do CRM tem os seus".
A premissa estava errada — para cliente, o dono dos contatos e o ERP,
como ja valia para a lista de clientes e para as atas. O principio "o CRM
nao replica o ERP" estava aplicado em todo lugar menos ali.

| Lote | Entrega | Depende de |
|---|---|---|
| **G** | **Contrato e boas-vindas** — reaproveitam a casca do Lote E; cadastro das empresas contratadas; qualificação do representante preenchida na geração | template do contrato |
| **J** | **Webhooks e notas** — recepção assinada, protocolo de 6 passos nas notas de Erro | endpoint de notas + webhooks |
| **K** | **KPIs Empresariais** — série contínua com marco zero | endpoint de indicadores |
| **M** | **Saúde de CX** — Saúde e Aderência do ERP mais a camada de percepção | F, I, J, K |
| **N** | **Check-in, NPS/CSAT e Voz do Cliente** | F |
| **O** | **Relatório de Valor Gerado** | G, K |
| **P** | **Dashboard de CX**, pauta da CX Review e Expansão | tudo |

### A chave do hub: o que já vale e o que ainda falta

> **Resolvido.** As cinco permissões foram concedidas e o Lote I saiu entre a 2.21.0 e a 2.30.0. Seção mantida como histórico.

**O Lote F está fechado, e funcionando de verdade.** O escopo
`hub:customers:read` foi cadastrado e os clientes do ERP listam na
Jornada — deixou de ser promessa contra dublê.

**O Lote I ainda não.** Faltam quatro escopos na mesma chave:

| Permissão | Para quê |
|---|---|
| `hub:portfolios:read` | as carteiras |
| `hub:meetings:read` | as reuniões e as atas |
| `hub:meeting-types:read` | os tipos de reunião (os núcleos) |
| `hub:teams:read` | os times |

Até a 2.21.0 a tela nomeava **uma por vez**: cada ida ao painel da
Cloudflare revelava a seguinte, quatro viagens para um problema só. A
2.22.0 consulta as cinco fontes com `Promise.allSettled` e lista todas as
que faltam de uma vez. É diagnóstico, não conveniência — a mesma lição do
incidente da migração 007.

Destravado o I, destravam-se por tabela o M e o N.

**Três caminhos para um cliente chegar à trilha de CX**, e os três
existem: o lead finalizado que converte (2.18.0), o ativo do ERP que
aparece sozinho (2.19.0) e o cadastro manual (Lote H).

---

## Travado, esperando material

> A lista viva está no topo ("Pendências, em ordem", grupo 4). A linha da chave do hub saiu em 29/09/2026: resolvida.

| O quê | Bloqueia |
|---|---|
| **Endpoint das notas da carteira** (em desenvolvimento) | J |
| **Estrutura dos webhooks** | J |
| **Endpoint de indicadores** (em desenvolvimento) | K |
| **Template do contrato em Word** | G |

O contrato do endpoint de clientes **deixou de faltar**: veio da
documentação em 05/09/2026 e está implementado. `GET /customers`,
permissão `hub:customers:read`, `fields` obrigatório, filtro `status`
com `prospect|ad_hoc|active|inactive`, e resposta `{ size, data[] }`.

O que resta é **cadastrar a chave** — passo operacional, não de código.

---

## Decisões que valem para os próximos lotes

**O CRM não replica o ERP.** Lê ao vivo e guarda só o que anota por cima.
Onde há protocolo de CX sobre uma nota do ERP, o CRM guarda o estado do
protocolo, não o conteúdo da nota.

**A API do hub é somente leitura por ora.** Escrita é possível, mas ficou
decidido não usar — escrita de mão dupla cria divergência difícil de
rastrear.

**Lead finalizado não vira cliente sozinho.** Abre a conversão, e só com
o setup feito grava.

**Todo cliente de CX tem que existir no ERP.** Se o CNPJ não estiver lá,
o CRM barra e avisa. Cliente inativado no ERP é inativado no CX, mas
segue consultável na aba Inativos.

**Expansão é acréscimo de produto ou serviço** à entrega — não gera
contrato novo nem volta ao funil.

**Três níveis que não se confundem:** Time é agrupamento interno
(Governança, Operações); Tipo de Reunião é o núcleo de atendimento
(Logística, Estoque, Conselho Gestor); Carteira é cliente + tipo de
reunião. **A sequência de AÇÃO da ata é por carteira.**

**A jornada é do cliente; a saúde é da carteira.** No nível do cliente
vale a pior das carteiras — nunca a média, que esconderia o vermelho.

**Dois dossiês distintos:** o Executivo é pré-venda e existe; o de
Experiência é pós-venda e vem no Lote L.

**O 5W2H do plano de ação é meio da ata, meio do CRM.** Decidido em
06/09/2026. A ata dá três dos sete campos — What (a descrição da AÇÃO),
Who (`Resp.:`) e When (`Prazo:`). Why, Where, How e How much **não
existem no texto** e são preenchidos pela CX.

Foi recusada a alternativa de a IA sugeri-los a partir do contexto:
sugestão não confirmada vira verdade com o tempo, e este é um plano que
as pessoas cobram umas das outras.

**A chave da anotação é (carteira + número da ação)**, não a reunião. O
manual v2.3 diz que o ID nasce e morre com a ação e que a sequência é por
carteira; a mesma AÇÃO 7 reaparece nas atas seguintes até ser encerrada.
Chavear por reunião perderia a anotação na semana seguinte — justamente
quando ela passa a valer.

**A ata mais recente manda:** ação encerrada sai do plano, então o que
está na última ata é o que continua aberto.

**O CRM numera as ações por CLIENTE; a ata numera por tipo de reunião.**
Decidido em 06/09/2026. Um cliente com três carteiras tem três "AÇÃO 1"
no ERP. O identificador do CRM é `N.M` — N é a sequência do cliente, M é
o número da ação no núcleo.

O N é **gravado na primeira vez que a ação é vista e nunca reaproveitado**.
Calculado na hora, renumeraria quando uma ação fechasse, e o identificador
mudaria de significado. Consequência assumida: a leitura do plano escreve.

**O nome do núcleo vem do ERP** (`GET /meeting-types`), não do cabeçalho
da ata — o cadastro é dono do nome, e a ata é a reserva para quando o
tipo de reunião não estiver na lista. O **Time** vem do `GET /teams`, e
os três níveis chegam à tela sem se confundir: Time é o agrupamento
interno da Formatar, núcleo é o tipo de reunião no cliente, carteira é
cliente + núcleo.

**`participants` são os funcionários da Formatar; `customerParticipants`
são os do cliente.** Confirmado em 06/09/2026. Importa porque a presença
do cliente nas reuniões é insumo do Health Score.

**O hub é dono da lista de clientes ativos; o CRM anota por cima.**
Decidido em 05/09/2026, ao verificar a Jornada em navegador. A Jornada
passa a listar os clientes ativos do hub **ao vivo**, e a linha de
`clientes` no CRM guarda só a camada de jornada — etapa, núcleos,
stakeholders, observações. Cliente que existe no hub e ainda não tem
linha no CRM aparece como **"sem jornada definida"**, e não some da tela.

É a leitura coerente com a decisão que já estava aqui — o CRM não replica
o ERP, lê ao vivo — e **muda o que o Lote F precisa ser**: ele deixa de
ser "converter lead em cliente e cadastrar" para ser "ligar o lead
convertido a um cliente que o hub já conhece". A tabela `clientes`
continua existindo, mas deixa de ser a fonte de quem é cliente.

Implementado na 2.19.0. O cruzamento é **por CNPJ**, não por `erp_id`:
enquanto o vínculo não é gravado, o CNPJ é a única coisa que os dois
lados têm em comum — e é por isso que a ficha exige CNPJ e recusa CPF.

**"Sem ERP" e "sem jornada" não são a mesma coisa**, e a tela não pode
deixar parecer que são: o primeiro é cadastro que ninguém conferiu contra
o ERP; o segundo é cliente confirmado lá cuja jornada ainda não começou.

**No endereço, o CEP manda.** Decidido em 05/09/2026. Quando a consulta
de CNPJ (Receita) e a de CEP (ViaCEP) discordarem, vence o CEP: é a
intenção mais recente e mais específica de quem está digitando. A Receita
segue preenchendo o que a base de CEP não tem — o número do imóvel, que é
justamente o que só a pessoa sabe.

**Cliente sem `erp_id` é cadastro manual não conferido, não é cliente
fora do ERP.** São coisas diferentes, e o cartão do quadro diz "sem ERP"
para que uma não passe pela outra enquanto a trava do Lote F não existe.

---

## Incidente: a migração 006 ficou para trás

Descoberto em 04/09/2026, ao ler o esquema remoto antes de aplicar a
007: a tabela `propostas` **não existia em produção**, embora o Lote E
tenha subido na v2.13.0 no dia anterior. A geração de proposta estava
quebrada no ar desde então. Corrigido na v2.14.1.

**A convenção passa a ter duas metades**, não uma: migração antes do
deploy **e conferência depois de aplicar**. Um
`SELECT name FROM sqlite_master` custa segundos e teria pego isso.

**A lição maior é outra.** O erro na tela dizia só "Falha ao gerar a
proposta". A causa real — `no such table: propostas` — vinha na
resposta da API, no campo `details`, e o front a descartava. O bug de
banco durou um dia; o bug de diagnóstico é que o tornou invisível.
Mensagem de erro que engole a causa não protege ninguém numa
ferramenta interna: só transfere o trabalho de descobrir para quem tem
menos meios de fazê-lo.

---

## Incidente: o prompt proibia, o modelo escreveu assim mesmo

Em 07/09/2026, o primeiro Dossie de Experiencia gerado sobre um cliente
real afirmou, com **CONFIANCA ALTA**, que a ALPHATEX estava "estagnada na
etapa de Diagnostico ha mais de 83 meses". Tambem escreveu "percepcao de
baixa entrega da Formatar" e apoiou um risco em "sem registro de pessoas
ou reunioes".

O prompt proibia as tres coisas, com todas as letras. Proibia falar de
reunioes e de percepcao, e proibia tratar a ausencia de mapa como risco
do cliente.

Duas causas, e as duas importam:

**O dado nao existia.** O CRM sabia `data_inicio` (2019, o contrato) e a
etapa atual (posta na importacao em massa do dia anterior). Nao sabia
desde quando o cliente estava naquela etapa — e o vazio e onde a
inferencia entra. Corrigido com `etapa_desde` (migracao 011), onde nulo
significa "nao sei" e o contexto declara isso ao modelo.

**A guarda so existia no prompt.** Instrucao em prompt e pedido, nao
garantia. Este documento nomeia pessoas de um cliente real e e lido como
se fosse apurado; o que ele afirma passa agora por `filtrarPorFontes`,
que descarta todo item apoiado em fonte que o CRM nao tem — e **declara**
o descarte, porque sumir em silencio seria trocar um defeito por outro
mais dificil de ver.

**A regra geral que fica:** onde saida de IA vira documento com o nome da
Formatar, a conferencia e codigo, nao instrucao. Vale para o Dossie
Executivo, para a Balanca Avaliativa e para o que vier depois. E o mesmo
principio da analise falsa removida na 2.16.0, agora com mecanismo.

---

## Incidente: uma função sombreou a outra e o quadro parou de abrir

Na v2.19.0 declarei uma segunda `registroPorId` no mesmo escopo de
`public/js/quadro.js`. A última declaração vence, e a minha comparava o
id com `===` estrito — mas o `dataset.id` do cartão é **texto** e o `id`
do registro é **número**. Nunca casava.

O efeito não ficou no quadro. Sem abrir o cartão não se chega à ficha, e
sem a ficha não se chega ao Dossiê Executivo nem à proposta: um erro de
uma linha tornou inalcançável meia trilha comercial. **Ficou assim de
05/09 a 06/09** e travou o trabalho do lado do usuário.

Nada apontou para o defeito porque não houve erro — a função existia e
retornava `null`, que o código trata como "cartão sem registro". Falha
silenciosa em JavaScript não é exceção: é o comportamento normal de
sombreamento de escopo.

**O que passou a existir:** a prova `ids.mjs` falha se qualquer arquivo
do front declarar duas funções com o mesmo nome. Foi verificada
injetando uma duplicata falsa — guarda que não se viu falhar não é
guarda. As funções legitimamente repetidas entre arquivos (`renderizar`,
`iniciar`) estão numa lista de conhecidas.

**A lição:** o front é feito de scripts clássicos sem empacotador, e
todos partilham o mesmo escopo global. Não há linter no caminho do
deploy, e a redeclaração é legal na linguagem. Enquanto for assim, a
prova é o único lugar onde isso pode ser pego.

### A mesma família, achada na 2.31.0: a conversão ao arrastar nunca disparou

Dentro de `Quadro.criar({ ..., aoMover })`, o arraste declarava
`function aoMover(ev)` — o tratador do ponteiro. A declaração interna
esconde o parâmetro, e a linha que devia oferecer a conversão depois de
gravar o movimento chamava o tratador do ponteiro, que saía no primeiro
`if`. **A oferta de conversão ao soltar em "Finalizado" nunca funcionou**
desde que foi escrita; só o botão da ficha convertia.

A guarda da v2.19.0 não pegava porque não havia duas funções com o mesmo
nome — havia uma função e um parâmetro. Achado lendo o código para a
2.31.0, não por sintoma.

**O que passou a existir:** a `ids.mjs` confere que nenhum parâmetro de
`Quadro.criar()` é escondido por função interna. Verificada contra o
código antigo, onde falha.

---

## Dívidas técnicas registradas

> **01/10/2026, Jair:** "por hora sem problemas de acessos" — os perfis de acesso seguem sem urgência.

**Perfis de acesso não existem.** Aceitável enquanto só uma pessoa usa o
CX. O Dossiê de Experiência e o mapa de stakeholders guardam juízo sobre
pessoas nomeadas do cliente — quando a equipe crescer, isso vira
requisito, não melhoria.

**O `server.js` local não acompanha as rotas das Functions** desde a
migração para o Cloudflare. Para testar, use `npx wrangler pages dev` ou
o ambiente publicado, não `npm start`.

**Contrato e proposta divergem entre si** nos documentos atuais: km a
R$ 1,60 no contrato e R$ 1,75 na proposta; a rescisão da proposta
acrescenta "acerto proporcional aos serviços já implantados". No Lote G
os dois passam a sair do mesmo formulário — mas qual texto vale é
decisão de quem responde pelo jurídico.

~~**O versionamento de documento tem três implementações irmãs.**~~
**PAGA na 2.17.0.** Está tudo no `_lib/versionamento.js`, uma fábrica
parametrizada por tabela e coluna-chave. O contrato do Lote G será o
quarto consumidor quase de graça.

A comparação lado a lado revelou dois defeitos que ninguém veria lendo
uma cópia só, e os dois foram corrigidos junto: **a proposta era a única
que não registrava falha** (migração 009), e **o `dados_json` do
Executivo guardava `versao: null`**, o que faria um reprocessamento do
template renderizar capa sem versão.

**Os rótulos de influência e postura estão duplicados** entre o
`_lib/schema-dossie-cx.js` e o `public/js/stakeholders.js`. É inevitável
enquanto as Functions forem módulos ES e o front for script clássico —
mas se um rótulo mudar, mudam os dois, e nada avisa.

**Perfis de acesso ficaram mais caros de novo com o Lote L.** O que era
previsão agora está no banco: a tabela `stakeholders` guarda juízo da
Formatar sobre pessoas nomeadas do cliente — "resistente", "não
avaliada", observações escritas à mão — e o Dossiê de Experiência imprime
isso num documento. Continua aceitável porque só uma pessoa usa o CX. Na
segunda pessoa, vira requisito.

**A ficha do cliente é um modal próprio, não a gaveta do lead.** As duas
têm pouco em comum além de nome e documento; um formulário com metade dos
campos ocultos por trilha seria mais difícil de manter que dois
formulários honestos. Se a sobreposição crescer, reavaliar.
