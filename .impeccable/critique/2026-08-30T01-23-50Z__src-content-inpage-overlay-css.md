---
target: "popup in-page da extensão: overlay in-page, integração visual, hierarquia, acessibilidade, estados, espaçamento e responsividade"
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-30T01-23-50Z
slug: src-content-inpage-overlay-css
---
# Crítica de Design (Re-run) — Overlay In-Page (SMD)

**Method: dual-agent (A: Critique2A · B: Critique2B)**

Target: src/content/content.js (overlay in-page) + src/content/inpage_overlay.css, re-run após rodadas harden+polish.

## Design Health Score

| # | Heurística | Score | (antes) | Problema-chave |
|---|-----------|-------|---------|----------------|
| 1 | Visibilidade do status | 3 | 2 | Sem estimativa de tempo/tamanho em lotes grandes; recibo rastreia só o último download individual |
| 2 | Match com o mundo real | 4 | 3 | Copy orienta a recuperação ("Use Folders mode", "The page may have changed") |
| 3 | Controle e liberdade | 3 | 3 | Sem undo do deselect-all; cancelamento irreversível |
| 4 | Consistência e padrões | 4 | 3 | Tokens corrigidos; 2 cores ad-hoc fora da rampa (#e0e0e4, #f1b8ba) |
| 5 | Prevenção de erros | 2 | 2 | Guarda anti-duplo-clique ok; sem preview de magnitude N>25 (carregado) |
| 6 | Reconhecimento | 3 | 3 | Contagens vivas e tags; estado do filtro some ao rolar |
| 7 | Flexibilidade e eficiência | 2 | 2 | Esc/Enter/Space existem; sem setas no radiogroup/tabs, sem roving tabindex |
| 8 | Estética minimalista | 4 | 3 | Erro = faixa discreta com dot; recibo = 1 botão outline; zero cores novas |
| 9 | Recuperação de erros | 3 | 2 | 7 fluxos de scan + FAILED/FAILED_SIZE com Retry; auto-dismiss de 6s inconsistente |
| 10 | Ajuda e documentação | 1 | n/a | Microcopy inline auto-documenta; sem entry point de ajuda |
| **Total** | | **29/40** | 18/36 | **Bom** |

(Nota: o resumo do Avaliador A dizia 23/36, mas a própria tabela soma 29/40; adotada a tabela. Like-for-like H1–H9: 28 vs 18.)

## Veredito de Especificidade

Grounded — acima de intercambiável. Grid assinatura com seleção por borda accent; One Accent Rule estrutural; Status-Only Color intacta (Retry/recibo sem vermelho); copy específica do produto; recibo ancorado em chrome.downloads.show real. Detector (modo degradado persistente — parser modules ausentes): 2 findings, ambos falsos positivos do harness (avatar estático; #ddd do stand-in do host). Evidência de browser complementar (sessão pai, rounds anteriores): 0 anti-patterns no runtime injetado; probes estruturais confirmam ARIA e comportamentos de teclado.

## Problemas Prioritários

**[P1] Modelo de teclado incompleto** — content.js:1921-1929, 2025-2036, 2171; css:493. Radiogroup com radios display:none (setas mortas), tabs sem roving tabindex, grid com tabindex=0 por card (500 cards = pântano de Tab). Correção: roving tabindex + setas no grid/tabs; radiogroup com arrow keys. Comando: $impeccable harden.

**[P1] Status de scan sem associação programática; erro de START_DOWNLOAD no lugar errado** — content.js:1866-1872, 2055-2058. Box aria-live sem associação; falha de canal de download renderiza no status de scan. Correção: aria-describedby; erro de START_DOWNLOAD no progress card/banner próprio. Comando: $impeccable harden.

**[P2] Recibo inconsistente entre formatos** — content.js:2296-2301; DownloadManager.js:352-361. Jobs individuais ancoram no último sucesso (arbitrário); zero sucessos = sem recibo. Correção: recibo por contagem com âncora estável; falha total = estado de erro. Comando: $impeccable harden.

**[P2] Sem preview de magnitude antes de download em massa** (carregado) — content.js:2005-2021. Correção: confirm step N>25 com contagem/destino/formato. Comando: $impeccable clarify.

**[P3] Cores ad-hoc e labels AT pobres** — css:220, 250, 456, 287; content.js:2173-2174. #e0e0e4/#f1b8ba fora da rampa; aria-label do grid item sem tipo/carrossel. Correção: tokenizar; label "Video 1080x1350"/"Carousel 3/5". Comando: $impeccable polish.

## Persona Red Flags

**Arquivista em massa:** sem virtualização (renderModalGrid anexa todo card, content.js:2219-2224); sem confirmação de magnitude; Retry do job inteiro.

**Teclado/AT:** radiogroup+tabs+500 cards tabbable; status sem associação; "Media item" nu — operável mas desconfortável.

**Instagram mobile 390px:** scanner 1 linha ok; fechar 32px ok; FAB bottom:84px/right:24px sobre a barra do Instagram ainda não verificado com captura real; 5 bandas fixas (~230px) + 90vh comem o grid.

## Observações Menores

- Auto-dismiss 6s só no avatar-scan (content.js:836); 6 outros fluxos mantêm o erro — inconsistente.
- #8b8b93 sobre #141417 = 3.64:1 (só contexto popup, confirmado).
- Retry re-clica o footer sem gestão de foco (content.js:1966-1968).
- Harness adiciona aria-label uniforme; produção usa por dimensão.
- Título do modal é o único heading.
- Normalização do progress card #1f1f23 confirmada (css:549).

## Questões Para Considerar

- Status text sozinho ancora confiança num download de 10 minutos — ou bytes/tempo precisa ser primeira classe?
- Retry do job inteiro vs. re-enfileiramento individual dos (N failed) a partir do recibo?
- O pântano de Tab dos 500 cards torna a virtualização correção de acessibilidade, não só de performance?
