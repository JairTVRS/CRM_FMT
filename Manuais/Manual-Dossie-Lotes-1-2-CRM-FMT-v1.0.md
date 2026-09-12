# Manual de Implantação — Dossiê Executivo, Lotes 1 e 2 (CRM Formatar)

**Versão:** 1.0
**Data:** 27/08/2026
**Projeto:** CRM_FMT — `https://crm-fmt.pages.dev`
**Escopo:** infraestrutura de dados e camada de coleta factual
**Responsável:** Jair Tavares

---

## 1. O que estes lotes entregam

Nenhuma tela ainda. São as fundações sobre as quais o dossiê será construído:

- **Lote 1** — banco D1 para o registro das versões e bucket R2 para os arquivos.
- **Lote 2** — módulos que buscam **dados reais**: CNPJ na Receita Federal, texto do site institucional e presença no Instagram.

A separação entre fato e interpretação começa aqui. Tudo neste lote é dado verificável, obtido de fonte. Nada passa por modelo de IA — isso só acontece no Lote 3.

---

## 2. Arquivos

Extrair na raiz do repositório.

| Arquivo | O que faz |
|---|---|
| `db/schema.sql` | Tabelas `dossies` e `cache_cnpj`, mais a view `dossies_atuais` |
| `functions/api/_lib/cnpj.js` | Consulta cadastral com validação de dígito verificador e fonte alternativa |
| `functions/api/_lib/site.js` | Busca o site, extrai texto legível e metadados |
| `functions/api/_lib/instagram.js` | Coleta a presença digital — manual hoje, Graph API depois |
| `functions/api/_lib/storage.js` | Grava e lê versões do dossiê em D1 e R2 |

Arquivos que começam com `_` não viram rotas no Cloudflare Pages. É a convenção da plataforma para código compartilhado, a mesma do `_middleware.js`.

---

## 3. Configuração

### 3.1 Criar o banco D1

No terminal, na raiz do projeto:

```bash
npx wrangler d1 create crm-formatar
```

Anote o `database_id` que aparece na saída. Depois aplique o esquema:

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/schema.sql
```

Confira se as tabelas foram criadas:

```bash
npx wrangler d1 execute crm-formatar --remote \
  --command="SELECT name FROM sqlite_master WHERE type IN ('table','view')"
```

Devem aparecer `dossies`, `cache_cnpj` e `dossies_atuais`.

### 3.2 Criar o bucket R2

```bash
npx wrangler r2 bucket create crm-formatar-dossies
```

O R2 tem camada gratuita generosa. Cada dossiê ocupa cerca de 30 KB, então mesmo milhares de versões ficam dentro dela.

### 3.3 Ligar os dois ao Pages

No painel: **Workers & Pages → crm-fmt → Settings → Associações** (aquela seção que aparece logo abaixo de Variáveis e segredos).

| Tipo | Nome da variável | Recurso |
|---|---|---|
| Banco de dados D1 | `DB` | `crm-formatar` |
| Bucket R2 | `DOSSIES` | `crm-formatar-dossies` |

Os nomes `DB` e `DOSSIES` são os que o código usa (`env.DB`, `env.DOSSIES`). Se preferir outros, ajuste em `storage.js`.

Como acontece com as variáveis de ambiente, **as associações só valem a partir do próximo deploy**.

---

## 4. Decisões técnicas

**O dossiê é chaveado por CNPJ, não por lead.** Os leads ainda não persistem em produção — é o item 2 do plano, em aberto. Chavear por CNPJ resolve o problema hoje: dois consultores analisando a mesma empresa encontram o mesmo documento, mesmo sem cadastro de lead compartilhado.

**Gerar de novo nunca sobrescreve.** Cada geração cria a versão seguinte e a anterior permanece consultável. O `UNIQUE (cnpj, versao)` garante isso no nível do banco, não só na aplicação.

**A ordem de escrita é R2 primeiro, D1 depois.** Se o R2 falhar, nada é registrado. Se o D1 falhar depois do R2, sobra um arquivo órfão — desperdício de bytes, mas nunca um registro apontando para arquivo inexistente, que quebraria a leitura.

**O JSON estruturado é guardado junto com o HTML.** Permite reprocessar o template no futuro — mudar o layout do dossiê, corrigir um cálculo — sem chamar a IA de novo e sem gastar tokens.

**Cache de CNPJ por 30 dias.** Dado cadastral muda pouco. Evita consultar a Receita a cada nova versão do mesmo lead.

**Duas fontes de CNPJ.** BrasilAPI como principal, OpenCNPJ quando a primeira falha. Nenhuma exige token. A resposta é normalizada para um formato único, então o template não precisa saber de onde veio.

**Nenhum módulo de coleta lança exceção.** Site fora do ar, CNPJ não encontrado, Instagram indisponível — todos devolvem `{ ok: false, erro }`. O dossiê deve conseguir ser gerado com informação parcial, sinalizando o que faltou, em vez de falhar inteiro.

---

## 5. Sobre o Instagram

O módulo tem duas implementações atrás da mesma interface, escolhidas por variável de ambiente:

```
INSTAGRAM_FONTE=manual      # padrão — o consultor cola bio e legendas
INSTAGRAM_FONTE=graph_api   # quando o app da Meta for aprovado
```

Com `graph_api`, também são necessárias `IG_BUSINESS_ACCOUNT_ID` e `INSTAGRAM_ACCESS_TOKEN` (esta como Secret).

O app **CRM Formatar** (ID `1415964077067177`) já existe e está vinculado ao portfólio da Formatar, com o credenciamento de Provedor de Tecnologia concluído. Faltam a Verificação da empresa e a Análise do app.

Dois comportamentos que valem conhecer:

Se a Graph API estiver ativa mas o perfil do lead for **pessoal** em vez de Business ou Creator, a Meta recusa a consulta. Nesse caso o módulo **cai automaticamente para o conteúdo colado manualmente**, se houver, em vez de deixar a seção vazia. O aviso do fallback fica registrado.

O campo `origem` acompanha o dado até o documento final. O dossiê sempre declara se a informação de Instagram veio da API ou foi informada pelo consultor.

**Não há caminho de scraping neste módulo, e não haverá.** O Instagram bloqueia acesso não autenticado, e a consequência de insistir é o banimento da conta da Formatar.

---

## 6. Verificação

Os módulos foram testados com rede simulada — 40 casos, todos passando:

- Validação de CNPJ com dígito verificador real, rejeição de repetidos e de máscara inválida
- Normalização das duas fontes para o mesmo formato
- Queda para a fonte alternativa quando a primeira retorna erro
- CNPJ inexistente, rede fora do ar e tempo esgotado sem lançar exceção
- Remoção de script e style, decodificação de entidades HTML, preservação de parágrafos
- Recusa de conteúdo não-HTML e de URL com protocolo perigoso
- Instagram: extração de usuário a partir de URL, arroba ou nome puro
- Graph API com sucesso, e queda para manual quando o perfil é pessoal

O esquema SQL foi validado contra SQLite real: a view `dossies_atuais` retorna corretamente a última versão de cada CNPJ, o `UNIQUE (cnpj, versao)` bloqueia duplicata e o upsert do cache não duplica linha.

---

## 7. O que vem a seguir

**Lote 3** — `functions/api/dossier.js` e o schema JSON. Orquestra a coleta, monta o contexto factual, chama o provedor de IA e valida a resposta.

**Lote 4** — o template que transforma JSON no HTML do modelo aprovado, mais o CSS de impressão.

**Lote 5** — modal com iframe isolado, progresso por etapa, campo de colagem do Instagram, histórico de versões e os botões de baixar e imprimir.

---

## 8. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 27/08/2026 | Jair Tavares | Versão inicial. Esquema D1 com versionamento por CNPJ, bucket R2, módulos de consulta de CNPJ, leitura de site e coleta de Instagram com provedor plugável. |
