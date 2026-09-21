# Manual — v2.29.0: datas padronizadas e tipo de ação

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.29.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Migração 014, antes do deploy:**

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-014-tipo-de-acao.sql
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('acoes_cx') WHERE name = 'tipo_acao'"
```

**Não é segura de rodar duas vezes** (`ALTER TABLE ADD COLUMN`). Se
aparecer `duplicate column name`, já foi aplicada.

A Fase 3 da 2.24.0 passa a ser a **migração 015**.

---

## 2. O que mudou

Três pedidos de 21/09/2026.

### 2.1 Datas no formato 01/01/2026

O `Prazo:` da ata é texto livre, e o CRM só entendia `dd/mm/aa` exato:
99% das ações no ar estavam "sem data prevista". O consultor escreve
"08/10/26." (com ponto), "dez/26", "5–9/10/26", "PARA SEMANA 5 A 9/10".

A leitura nova (`dataPrevistaDoPrazo`, em `_lib/plano.js`):

| Escrito na ata | Data prevista | Regra |
|---|---|---|
| `08/10/26.` | 08/10/2026 | pontuação no fim não atrapalha |
| `5–9/10/26` | 09/10/2026 | intervalo: vale o fim |
| `PARA SEMANA 5 A 9/10` | 09/10/2026 | sem ano: o ano da reunião |
| `dez/26.` | **31/12/2026** | mês e ano: **o último dia do mês** |
| `Outubro de 2026` | 31/10/2026 | mês por extenso |
| `a definir.`, `próxima` | — | continua sem data |

**"dez/26 = 31/12/2026" é uma convenção, não um fato da ata.** Se a CX
discordar, basta editar a data na tabela — a edição vale, e fica no
histórico. A leitura estrita do `_lib/ata.js`, que alimenta o dossiê,
não mudou.

**As ações já gravadas** são corrigidas na primeira carga depois do
deploy, uma vez só, pelo texto que já estava gravado — e cada correção
entra no histórico como feita "pela ata". Onde a CX já tinha posto uma
data, ela fica.

Consequência esperada: o número de **atrasadas vai subir** no painel.
Não é regressão — são ações que já estavam atrasadas e o CRM não sabia,
porque não lia a data.

### 2.2 "Quando" e "Data prevista" viraram uma coluna só

Fica **Data prevista**, sempre em 01/01/2026. Quando o texto da ata não
vira data ("a definir"), ele aparece na célula em cinza e itálico, como
dica; clicar define a data. Passar o mouse sobre uma data mostra o que
estava escrito na ata.

Quem tinha "Quando" na configuração de colunas não precisa fazer nada: a
coluna some sozinha.

### 2.3 Tipo de ação

Coluna nova: **Operacional**, **Tática** ou **Estratégica**. Clicar abre
a lista; "— não classificada" limpa. Toda mudança vai para o histórico.

A CX classifica — a ata não tem isso e o CRM não deduz do texto, pela
mesma razão do 5W2H: classificação não confirmada vira verdade com o
tempo. Entra na busca, ordena pelo cabeçalho e aparece na engrenagem.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-014-tipo-de-acao.sql` | Coluna `tipo_acao` |
| `functions/api/_lib/plano.js` | `dataPrevistaDoPrazo`, correção das gravadas, `TIPOS_DE_ACAO` |
| `public/js/plano-acao.js`, `cx.css` | Coluna Tipo de ação; "Quando" sai; dica do prazo da ata |
| `dev/prova/plano.mjs` | +18 conferências (105 no total) |

---

## 4. Como verificar

1. Ctrl+F5 e esperar a carga terminar ("Atas lidas até hoje").
2. A coluna "Quando" sumiu; "Data prevista" mostra 31/12/2026 onde a ata
   dizia "dez/26".
3. O 🕘 de uma dessas ações mostra "Data prevista: vazio → 31/12/2026",
   pela ata.
4. Clicar em "Tipo de ação" e escolher Estratégica.
