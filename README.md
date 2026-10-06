# Estética Derma Solução — site

Site institucional de alta conversão da **Estética Derma Solução** (estética facial regenerativa, Centro de Florianópolis).
Foco: levar a visitante ao **WhatsApp com a mensagem já pronta** com o menor atrito possível.

## Estrutura

```
public/                 site estático (HTML/CSS/JS puro, sem framework)
  index.html            página principal (landing page)
  privacidade.html      política de privacidade (LGPD)
  404.html
  assets/brand/         logo vetorial (logo.svg, logo-white.svg, logo-mark.svg) + recorte da foto
  assets/img/           fotos otimizadas (WebP + JPEG), ícones, imagem de compartilhamento
  assets/fonts/         fontes auto-hospedadas (Bodoni Moda + Manrope, subset latino)
  _headers              cabeçalhos de segurança para Netlify/Cloudflare Pages
server/server.js        servidor Node sem dependências: arquivos estáticos + API de leads
test/                   testes (node:test)
tools/build_logo.py     gera a logo vetorial a partir das fontes
```

## Rodando localmente

Requer Node 20+. Não há dependências para instalar.

```bash
npm run dev     # http://localhost:3000 (sem HSTS/upgrade-insecure para funcionar em http)
npm test        # 12 testes: cabeçalhos, path traversal, validação, rate limit…
npm start       # produção
```

Variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | porta e interface |
| `DATA_DIR` | `./data` | onde os leads são gravados (`leads.ndjson`, permissão 600) |
| `LEAD_WEBHOOK_URL` | — | opcional: encaminha cada lead (ex.: n8n, Make, Zapier → e-mail/planilha) |
| `TRUST_PROXY` | `0` | `1` se estiver atrás de proxy/CDN (usa `X-Forwarded-For`) |
| `ALLOWED_ORIGINS` | — | origens extras aceitas no POST, separadas por vírgula |
| `HTTPS_HEADERS` | `1` | `0` desliga HSTS/upgrade-insecure (só para desenvolvimento) |

### Deploy

- **Com backend (recomendado):** `docker build -t derma . && docker run -p 3000:3000 -v $PWD/data:/app/data derma`
  atrás de um proxy com HTTPS (Caddy, Nginx, Render, Railway, Fly.io…).
- **Somente estático:** publique a pasta `public/` (Netlify, Cloudflare Pages, Vercel, GitHub Pages).
  O formulário continua funcionando: se `/api/lead` não existir, a visitante vai direto ao WhatsApp.

## Conversão

- CTA principal acima da dobra + botão flutuante (desktop) + barra fixa "Ligar / Agendar" (mobile).
- Todos os CTAs abrem o WhatsApp com **mensagem contextual** (por objetivo, por tratamento, por seção).
- Seção "Qual é o seu objetivo?" segmenta a visitante pela dor (acne, manchas, flacidez…).
- Prova social real: nota 5,0, 192 avaliações e depoimentos do Google.
- Formulário curto (nome, WhatsApp, objetivo, período) que salva o lead e abre o WhatsApp preenchido.
- Eventos no `dataLayer` (`cta_click`, `generate_lead`, `map_load`) prontos para GTM/GA4.
- Performance: sem frameworks, fontes subset com `preload`, imagens WebP com dimensões fixas
  (sem layout shift), mapa do Google carregado só sob demanda.
- SEO local: título/descrição, Open Graph, dados estruturados `HealthAndBeautyBusiness`, sitemap e robots.

## Segurança

- **CSP restritiva** (`script-src 'self'`, sem inline), `frame-ancestors 'none'`, HSTS, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP.
- Servidor sem dependências de terceiros (nada de supply chain), bloqueio de *path traversal* e dotfiles,
  apenas GET/HEAD nos estáticos, limites de tempo e de tamanho de URL.
- API de leads: só `application/json`, checagem de **Origin** (anti-CSRF), corpo máx. 4 KB,
  **rate limit** por IP (5 a cada 10 min), validação estrita por lista branca, remoção de caracteres de controle,
  **honeypot** e tempo mínimo de preenchimento contra bots.
- LGPD: consentimento explícito, IP armazenado só como hash diário, política de privacidade, mapa do Google
  só carrega com clique. Lembre de apagar leads antigos (a política promete até 12 meses).

## Logo

A logo foi **recriada em vetor** a partir do letreiro dourado da segunda foto (anéis entrelaçados, traço
caligráfico, monograma "Ds" e o nome em arco), com o texto convertido em curvas. Assim ela fica nítida em
qualquer tamanho e não depende de fontes instaladas. Para regerar:

```bash
pip install fonttools brotli
python3 tools/build_logo.py --fonts <pasta com Parisienne-Regular.ttf e Cinzel[wght].ttf> --out public/assets/brand
```

`public/assets/brand/logo-recorte-original.png` é o recorte direto da foto, com fundo transparente, para
referência. A mão e o reflexo do letreiro atrapalham o recorte, por isso o site usa a versão vetorial.
Se a clínica tiver o arquivo original da logo (AI/PDF/SVG do designer), basta substituir os SVGs.

## Antes de publicar: confirmar com a clínica

- [ ] **Domínio:** troque `https://www.esteticadermasolucao.com.br` (canonical, OG, JSON-LD, sitemap, robots).
- [ ] **Horário de funcionamento:** o site diz "com hora marcada, até as 20h". Confirme dias e horários
      e, se quiser, adicione `openingHoursSpecification` ao JSON-LD.
- [ ] **Lista de tratamentos:** confirme os protocolos oferecidos e os textos de cada um.
- [ ] Instagram, CNPJ e e-mail, se quiser exibir no rodapé.
- [ ] Ao instalar GA4/Meta Pixel, libere os domínios na CSP (`server/server.js` e `public/_headers`).
- [ ] Fotos de antes/depois, se usar, só com autorização por escrito das clientes.
