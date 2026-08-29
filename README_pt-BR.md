<div align="center">

# 📥 Social Media Downloader (SMD) — Extensão de Alta Performance para Download de Mídias do Instagram, Facebook e Reddit (Manifest V3)

**Uma extensão modular e de alta fidelidade para o Google Chrome, desenvolvida para descobrir, resolver, multiplexar e empacotar mídias em resolução máxima original do Instagram, Facebook e Reddit sem perda de qualidade.**

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README_pt-BR.md"><b>Português (Brasil)</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-3b82f6?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/Runtime-Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white" alt="Runtime Bun">
  <img src="https://img.shields.io/badge/Plataformas-Instagram_|_Facebook_|_Reddit-ec4899?style=for-the-badge" alt="Plataformas">
  <img src="https://img.shields.io/badge/Resolu%C3%A7%C3%A3o-Qualidade_M%C3%A1xima_Original-22c55e?style=for-the-badge" alt="Resolução Máxima">
  <img src="https://img.shields.io/badge/Idiomas-22_Locales-f59e0b?style=for-the-badge" alt="22 Idiomas">
  <img src="https://img.shields.io/badge/Testes-25_Passando-10b981?style=for-the-badge" alt="25 Testes Passando">
  <img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-6366f1?style=for-the-badge" alt="Licença MIT">
</p>

<br>

<img src="assets/icons/icon.svg" width="128" alt="Social Media Downloader Ícone">

<br>
<br>

</div>

---

## 🌟 Principais Recursos & Arquitetura

- **⚡ Separação Estrita Core / Plugins**:
  - Plugins independentes de primeira classe para **Instagram**, **Facebook** e **Reddit**.
  - O Core genérico gerencia downloads, filas, empacotamento ZIP, sanitização de nomes de arquivos e interface unificada.
  - Zero vazamento entre plugins e sem condicionais de plataforma na infraestrutura genérica.

- **📸 Extração em Resolução Máxima Original de CDN**:
  - **Instagram**: Extração de perfis via Polaris GraphQL, preservação de carrosséis com múltiplos slides, Reels, Stories, Destaques e avatares sem compressão.
  - **Facebook**: Navegação in-page via Comet Router pelas abas de fotos (`photos_of`, `photos_by`, `photos_albums`, álbuns personalizados) com paginação progressiva, coleta DOM/JSON e remoção de parâmetros de corte de CDN preservando assinaturas HMAC.
  - **Reddit**: Descoberta multi-origem via API JSON pública, imagens de alta resolução, galerias, resolução de vídeos RedGifs e desduplicação de crossposts priorizando os de maior pontuação.

- **🎬 Multiplexação de Áudio/Vídeo DASH no Navegador**:
  - Vídeos DASH do Reddit com faixas de áudio e vídeo separadas são pareados e multiplexados diretamente no navegador através do motor MP4 (`RedditVideoMuxer`).
  - Gera arquivos `.mp4` completos e sincronizados com zero dependência de servidores externos.

- **📦 Empacotamento ZIP Offscreen Seguro e Download em Pastas**:
  - Baixe mídias individualmente em pastas organizadas (`Downloads/SMD/...`) ou empacote lotes em arquivos `.ZIP`.
  - Execução via documento offscreen para contornar limites de memória do service worker com teto de segurança de 1GB.

- **🛡️ Segurança, Privacidade e Isolamento de Subframes**:
  - Content scripts e bridges de main-world bloqueiam execução em subframes (`window === window.top`), evitando interferência de iframes internos ou proxies.
  - Sanitização de arquivos remove caracteres proibidos do sistema operacional, nomes DOS reservados, tokens zero-width e caracteres de sobrescrita de direção RTL.

- **🌐 Internacionalização Completa (22 Idiomas)**:
  - Paridade de 100% de chaves e placeholders no sistema nativo de i18n do Chrome para 22 idiomas globais.

---

## 🔌 Plugins de Plataformas Suportadas

| Plataforma | Recursos e Tipos de Mídia | Estratégia de Extração | Guia de Arquitetura |
| :--- | :--- | :--- | :--- |
| **📸 Instagram** | Posts, Carrosséis, Reels, Stories, Destaques, Avatares | Polaris GraphQL + Un-crop de CDN | [Arquitetura Instagram](docs/platforms/instagram/ARCHITECTURE.md) |
| **👥 Facebook** | Álbuns de Fotos, Uploads, Fotos Marcadas, Linha do Tempo, Avatares | Navegação Comet in-page + Coleta DOM/JSON | [Arquitetura Facebook](docs/platforms/facebook/ARCHITECTURE.md) |
| **👽 Reddit** | Imagens, Galerias de Múltiplas Fotos, Vídeos DASH (com Áudio), RedGifs | API JSON Pública + Muxer MP4 no Navegador | [Arquitetura Reddit](docs/platforms/reddit/ARCHITECTURE.md) |

---

## 📁 Estrutura de Pastas de Download

Os downloads são organizados na pasta padrão de downloads do navegador sob a raiz `SMD`:

```text
Downloads/
└── SMD/
    ├── Instagram/
    │   └── @username/
    │       ├── username_2026-08-28_15-30-00_post_shortcode_1.jpg
    │       └── username_2026-08-28_15-30-00_reel_shortcode.mp4
    ├── Facebook/
    │   └── Nome_Do_Perfil/
    │       ├── Profile_Pictures/
    │       ├── Timeline_Photos/
    │       └── Nome_Do_Album/
    └── Reddit/
        └── r_subreddit/
            ├── 2026-08-28_autor_post_id_imagem.png
            └── 2026-08-28_autor_post_id_muxed.mp4
```

Ou em arquivo `.ZIP` consolidado:
```text
Downloads/
└── SMD/
    └── facebook_Nome_Do_Perfil_2026-08-28_15-30-00.zip
```

---

## 🚀 Como Instalar e Usar

1. **Clone o repositório**:
   ```bash
   git clone https://github.com/th3sull1van/social-media-downloader.git
   ```
2. **Abra a Página de Extensões do Chrome**:
   - Acesse `chrome://extensions/` no Google Chrome.
3. **Ative o Modo do Desenvolvedor**:
   - Ative a chave **Modo do desenvolvedor** no canto superior direito.
4. **Carregue a Extensão**:
   - Clique em **Carregar sem compactação** e selecione a pasta raiz deste repositório.
5. **Comece a Baixar**:
   - Acesse qualquer perfil ou publicação no Instagram, Facebook ou Reddit e clique no ícone da extensão ou use os controles sobrepostos na página!

---

## 🧪 Suíte de Testes e Validação Automatizada

O repositório conta com validação estrita e testes automatizados:

```bash
# Instalar dependências
bun install

# Executar gate de validação local completo (replays HAR + typecheck + testes + regras)
bun run validate:local

# Executar gate de validação de CI
bun run validate

# Executar validações individuais
bun test
bun run typecheck
bun run check:manifest
bun run check:dependencies
bun run check:i18n
bun run check:har
```

---

## 📄 Licença

MIT © [th3sull1van](https://github.com/th3sull1van)
