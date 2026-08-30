---
target: "popup in-page da extensão: overlay in-page, integração visual, hierarquia, acessibilidade, estados, espaçamento e responsividade"
total_score: 18
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 2
timestamp: 2026-08-29T23-05-48Z
slug: src-content-inpage-overlay-css
---
# Crítica de Design — Overlay In-Page (SMD)

**Method: dual-agent (A: CritiqueAssessmentA · B: CritiqueAssessmentB)**

Target: src/content/inpage_overlay.css + src/content/content.js:1760-2130 (overlay in-page gerado em shadow DOM), avaliado via harness estático .impeccable/critique/inpage_overlay_harness.html.

## Design Health Score

| # | Heurística | Score | Problema-chave |
|---|-----------|-------|-----------|
| 1 | Visibilidade do status do sistema | 2 | Sem guarda de download em andamento; badge do FAB ambíguo (total vs. selecionados); progresso sem granularidade por item |
| 2 | Match com o mundo real | 3 | "Scan", "Posts", "ZIP Archive", "In Folders" — vocabulário correto do domínio |
| 3 | Controle e liberdade do usuário | 1 | Sem Esc para fechar, sem undo, "Stop Scan" instantâneo e irreversível |
| 4 | Consistência e padrões | 3 | Tema accent recolore o conjunto inteiro coherentemente; ARIA ausente quebra convenções de modal |
| 5 | Prevenção de erros | 2 | Duplo clique no Download dispara job duplicado; sem preview de magnitude |
| 6 | Reconhecimento em vez de memória | 3 | Contagens vivas nas tabs e no botão; sem tooltip nos quick-scans |
| 7 | Flexibilidade e eficiência | 1 | Zero aceleradores de teclado para o persona de arquivamento em massa |
| 8 | Design estético e minimalista | 3 | Chrome silencioso e correto; 3 fileiras de controles acima do grid comem espaço |
| 9 | Recuperação de erros | 0 | Nenhum estado de erro existe no design system nem no CSS |
| 10 | Ajuda e documentação | n/a | Superfície Operate; tabs/labels autodocumentados |
| **Total** | | **18/36** | **Precisa de trabalho** |

(n/a: heurística 10; máximo aplicável = 36)

## Veredito de Especificidade de Design

**LLM (Avaliação A):** Autêntico, não intercambiável por categoria. A composição materializa "The Darkroom Archive": superfícies near-black onde a mídia é a única cor; a One Accent Rule operacionalizada como switch de tema único (FAB, primário, seleção, check, progresso, chip); verde só no ato de salvar; vermelho só no stop. Grid de mídia com tags de formato/resolução é o pixel mais específico do produto. Momentos mais genéricos: fileira de 5 quick-scans (Instagram) e 5 filter tabs.

**Varredura determinística (Avaliação B):** CLI em modo degradado (regex, parser HTML indisponível): 2 findings, ambos falsos positivos do harness (broken-image: avatar sem src no espelho estático; design-system-color #ddd: cor do stand-in da página hospedeira). Overlay injetado no DOM real renderizado: 0 anti-patterns com estilos computados. O detector não avalia ARIA; os P0 de acessibilidade vieram da Avaliação A e foram confirmados por probe no shadow DOM renderizado: 0 role, 0 aria-modal, 0 tablist em 17 botões.

## Problemas Prioritários

**[P0] Nenhum estado de erro no design** (Heurística 9: 0)
- Por quê: scan quebrado, 403 de CDN, quota do chrome.downloads, spinner eterno — tudo invisível. PRODUCT.md declara "honest empty/error states"; só o empty existe.
- Correção: variante `--error` do smd-status-box (ponto halt-red + mensagem + Retry) e variante de falha no smd-progress-card com Retry. Estender updateScanStatusUI (content.js:2016-2024) e updateDownloadProgressUI (:2165-2191).
- Comando: $impeccable harden

**[P0] Acessibilidade do modal: sem role="dialog", sem Esc, sem focus trap** (confirmado no DOM renderizado: 0 roles, 17 botões)
- Por quê: usuário de teclado/screen reader não fecha o modal senão tabulando até o ×; Esc é convenção universal; grid items são divs clicáveis sem role="button"/aria-pressed; tabs sem role="tablist".
- Correção: role="dialog" aria-modal="true" aria-labelledby="smd-target-title" no overlay; aria-label (i18n) no fechar; keydown handler (Esc fecha, Tab preso); roles nas tabs e grid items.
- Comando: $impeccable harden

**[P1] Sem guarda de download em andamento** (content.js:1975-1983, 2158-2161)
- Por quê: duplo clique no "Download (87)" enfileira dois jobs/ZIPs.
- Correção: state.isDownloading setada no clique, limpa em COMPLETED/CANCELLED/FAILED; botão desabilitado enquanto baixa.
- Comando: $impeccable harden

**[P1] Momentos de alto risco sem preview de magnitude ou consequência**
- Por quê: clique cego para 500 itens sem tamanho/destino; "Stop Scan" e "Cancel" idênticos visualmente com consequências diferentes.
- Correção: confirm step para N > 25 com contagem/tamanho/destino; texto do cancel: "Cancelar — manter 47 de 126".
- Comando: $impeccable clarify + $impeccable harden

**[P3] Grid sem virtualização para arquivos grandes** (renderModalGrid, content.js:2009+)
- Por quê: 500+ cards no DOM; stutter no persona-alvo.
- Correção: windowing por IntersectionObserver.
- Comando: $impeccable optimize

## Persona Red Flags

**O Arquivista (persona-alvo):** sem preview de magnitude no Download; sem range-select ou "selecionar só vídeos"; zero aceleradores de teclado; conclusão silenciosa sem recibo; DOM pesado em 500+ itens.

**O Novo Usuário Cauteloso:** "HD Profile Pic" opaco sem tooltip; primeiro scan que falha = spinner eterno, sem recuperação; modal inoperante por teclado; FAB em bottom: 84px; right: 24px sobrepõe a barra de ações do Instagram no mobile web (confirmado em captura 390px).

**O Curador Multiplataforma:** chip de plataforma é identidade pura (sem re-detectar/trocar alvo); sets de tabs diferentes por plataforma sem âncora comum; deduplicação declarada sem affordance no modal.

## Observações Menores

- Contraste: text-muted #6e6e77 sobre #18181b ≈ 3.64:1 — falha AA (corpo do empty state); #9e9ea7 (6.93:1) e #fff sobre #e1306c (4.84:1) passam.
- Responsividade 390px (capturada): scanner bar quebra em 2 linhas; rótulos do segmentado e do botão Download quebram em 2 linhas. Trocar wrap por scroll horizontal.
- Sem :focus-visible estilizado: outline nativo some no #18181b.
- Botão fechar (×, 22px) com alvo de toque pequeno.
- Divergências harness × produção: badge do FAB (selecionados vs. total — content.js:2012-2013) e aria-label="Close" (harness tem, produção não).
- Chrome consome ~260px verticais; viewports baixos deixam o grid com ~2 fileiras.

## Questões Para Considerar

- Se a última memória de um arquivo de 500 itens é um "Download complete" silencioso, a promessa de fidelidade byte-accurate sobrevive na lembrança — ou o silêncio soa como "confie em mim" quando o usuário quer evidência?
- O chip de plataforma deveria ser funcional (re-detectar alvo, resumo de contagem) ou a mentalidade "a página em que estou = o alvo" o torna cromo redundante?
- Em que ponto o cromo do modal se torna o produto e o arquivo se torna o cromo? A densidade de operador serve o usuário escolhendo 12 itens — ou só o escolhendo 240?
