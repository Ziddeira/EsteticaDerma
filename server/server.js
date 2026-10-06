"use strict";
/**
 * Servidor da Estética Derma Solução.
 *
 * - Zero dependências de terceiros (menos superfície de ataque na cadeia de suprimentos).
 * - Serve os arquivos de /public com cabeçalhos de segurança (CSP, HSTS etc.),
 *   cache adequado e compressão.
 * - POST /api/lead: recebe pedidos de agendamento com validação estrita,
 *   honeypot, checagem de origem, limite de tamanho e rate limit por IP.
 */
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".svg", ".txt", ".xml"]);

const CSP_BASE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.google.com https://maps.google.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];
const buildCsp = (https) => (https ? [...CSP_BASE, "upgrade-insecure-requests"] : CSP_BASE).join("; ");

function securityHeaders({ https }) {
  const h = {
    "Content-Security-Policy": buildCsp(https),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (https) h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  return h;
}

/* ---------------- Validação do lead ---------------- */
const OBJETIVOS = new Set([
  "Limpeza de pele",
  "Acne e oleosidade",
  "Manchas e tom irregular",
  "Linhas finas e flacidez",
  "Cicatrizes de acne",
  "Poros e textura",
  "Pele opaca e desidratada",
  "Ainda não sei, quero uma avaliação",
]);
const PERIODOS = new Set(["", "Manhã", "Tarde", "Noite"]);
// remove caracteres de controle (exceto quebra de linha na mensagem)
const clean = (s, keepNewlines = false) =>
  String(s)
    .normalize("NFC")
    .replace(keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .trim();

function validateLead(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid_body" };
  const { nome, whatsapp, objetivo, periodo = "", mensagem = "", consentimento, website = "", elapsed } = body;

  // Honeypot e tempo mínimo de preenchimento: bots recebem "ok" silencioso.
  if (typeof website !== "string" || website.length > 0) return { spam: true };
  if (typeof elapsed === "number" && elapsed < 2500) return { spam: true };

  if (typeof nome !== "string" || typeof whatsapp !== "string" || typeof objetivo !== "string") return { error: "invalid_fields" };
  if (typeof periodo !== "string" || typeof mensagem !== "string") return { error: "invalid_fields" };

  const n = clean(nome);
  if (n.length < 2 || n.length > 80 || !/^[\p{L}\p{M}' .-]+$/u.test(n)) return { error: "invalid_nome" };

  const digits = whatsapp.replace(/\D/g, "");
  if (!/^[1-9]{2}9?\d{8}$/.test(digits)) return { error: "invalid_whatsapp" };

  if (!OBJETIVOS.has(objetivo)) return { error: "invalid_objetivo" };
  if (!PERIODOS.has(periodo)) return { error: "invalid_periodo" };

  const m = clean(mensagem, true);
  if (m.length > 500) return { error: "invalid_mensagem" };
  if (consentimento !== true) return { error: "consent_required" };

  return { lead: { nome: n, whatsapp: digits, objetivo, periodo, mensagem: m } };
}

/* ---------------- Rate limit simples em memória ---------------- */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return {
    check(key) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || now - e.start > windowMs) {
        if (hits.size > 50_000) hits.clear(); // proteção de memória
        e = { start: now, count: 0 };
        hits.set(key, e);
      }
      e.count += 1;
      return { allowed: e.count <= max, retryAfter: Math.ceil((e.start + windowMs - now) / 1000) };
    },
    stop() { clearInterval(sweep); },
  };
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) tooLarge = true;
    req.on("data", (c) => {
      if (tooLarge) return; // descarta o restante sem guardar em memória
      size += c.length;
      if (size > limit) tooLarge = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("too_large"), { status: 413 }));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("bad_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/* ---------------- Servidor ---------------- */
function createServer(opts = {}) {
  const config = {
    publicDir: opts.publicDir || PUBLIC_DIR,
    dataDir: opts.dataDir || process.env.DATA_DIR || path.resolve(__dirname, "..", "data"),
    https: opts.https ?? process.env.HTTPS_HEADERS !== "0",
    trustProxy: opts.trustProxy ?? process.env.TRUST_PROXY === "1",
    allowedOrigins: (opts.allowedOrigins || process.env.ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    webhookUrl: opts.webhookUrl ?? process.env.LEAD_WEBHOOK_URL ?? "",
    rate: opts.rate || { windowMs: 10 * 60 * 1000, max: 5 },
    log: opts.log ?? ((...a) => console.log(...a)),
  };
  const limiter = createRateLimiter(config.rate);
  const baseHeaders = securityHeaders(config);
  const gzCache = new Map();

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...baseHeaders, ...headers });
    res.end(body);
  }
  function sendJson(res, status, obj, headers = {}) {
    send(res, status, JSON.stringify(obj), { "Content-Type": MIME[".json"], "Cache-Control": "no-store", ...headers });
  }

  function clientIp(req) {
    if (config.trustProxy) {
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "unknown";
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return false; // navegadores sempre enviam Origin em POST com fetch
    if (config.allowedOrigins.includes(origin)) return true;
    try {
      const u = new URL(origin);
      const host = (req.headers["x-forwarded-host"] && config.trustProxy) ? req.headers["x-forwarded-host"] : req.headers.host;
      return u.host === host;
    } catch {
      return false;
    }
  }

  async function storeLead(lead, req) {
    const record = {
      id: crypto.randomUUID(),
      recebido_em: new Date().toISOString(),
      ...lead,
      // IP anonimizado (LGPD: minimização de dados)
      ip_hash: crypto.createHash("sha256").update(clientIp(req) + new Date().toISOString().slice(0, 10)).digest("hex").slice(0, 16),
    };
    await fsp.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    await fsp.appendFile(path.join(config.dataDir, "leads.ndjson"), JSON.stringify(record) + "\n", { mode: 0o600 });

    if (config.webhookUrl) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        signal: ctrl.signal,
      }).catch((e) => config.log("webhook falhou:", e.message)).finally(() => clearTimeout(t));
    }
    return record;
  }

  async function handleLead(req, res) {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
    if (!originAllowed(req)) return sendJson(res, 403, { ok: false, error: "forbidden_origin" });
    const ctype = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (ctype !== "application/json") return sendJson(res, 415, { ok: false, error: "unsupported_media_type" });

    const rl = limiter.check(clientIp(req));
    if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "too_many_requests" }, { "Retry-After": String(rl.retryAfter) });

    let body;
    try {
      body = await readJson(req, 4 * 1024);
    } catch (e) {
      return sendJson(res, e.status || 400, { ok: false, error: e.message });
    }
    const result = validateLead(body);
    if (result.spam) return sendJson(res, 200, { ok: true });
    if (result.error) return sendJson(res, 422, { ok: false, error: result.error });

    try {
      await storeLead(result.lead, req);
    } catch (e) {
      config.log("erro ao salvar lead:", e.message);
      return sendJson(res, 500, { ok: false, error: "storage_error" });
    }
    return sendJson(res, 201, { ok: true });
  }

  async function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD", "Content-Type": MIME[".txt"] });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      return send(res, 400, "Bad Request", { "Content-Type": MIME[".txt"] });
    }
    if (pathname.includes("\0")) return send(res, 400, "Bad Request", { "Content-Type": MIME[".txt"] });
    if (pathname.endsWith("/")) pathname += "index.html";

    // Bloqueia dotfiles e garante que o caminho fique dentro de /public
    if (pathname.split("/").some((seg) => seg.startsWith(".") && seg !== ".well-known")) return notFound(res, req);
    const filePath = path.resolve(config.publicDir, "." + pathname);
    if (filePath !== config.publicDir && !filePath.startsWith(config.publicDir + path.sep)) return notFound(res, req);

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return notFound(res, req);
    }
    if (!stat.isFile()) return notFound(res, req);

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext];
    if (!type) return notFound(res, req);

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      "Content-Type": type,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "Cache-Control": ext === ".html" ? "no-cache"
        : pathname.startsWith("/assets/") ? "public, max-age=2592000" : "public, max-age=86400",
      Vary: "Accept-Encoding",
    };
    if (req.headers["if-none-match"] === etag) return send(res, 304, null, headers);

    const accepts = String(req.headers["accept-encoding"] || "");
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accepts)) {
      let gz = gzCache.get(filePath);
      if (!gz || gz.etag !== etag) {
        gz = { etag, buf: zlib.gzipSync(await fsp.readFile(filePath), { level: 9 }) };
        gzCache.set(filePath, gz);
      }
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = gz.buf.length;
      return send(res, 200, req.method === "HEAD" ? null : gz.buf, headers);
    }
    headers["Content-Length"] = stat.size;
    res.writeHead(200, { ...baseHeaders, ...headers });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
  }

  async function notFound(res, req) {
    const page = path.join(config.publicDir, "404.html");
    try {
      const html = await fsp.readFile(page);
      return send(res, 404, req.method === "HEAD" ? null : html, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    } catch {
      return send(res, 404, "Not Found", { "Content-Type": MIME[".txt"] });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url || "/";
      if (url.length > 2048) return send(res, 414, "URI Too Long", { "Content-Type": MIME[".txt"] });
      if (url === "/healthz") return sendJson(res, 200, { ok: true });
      if (url === "/api/lead" || url.startsWith("/api/lead?")) return await handleLead(req, res);
      if (url.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "not_found" });
      return await handleStatic(req, res);
    } catch (e) {
      config.log("erro:", e.message);
      if (!res.headersSent) send(res, 500, "Internal Server Error", { "Content-Type": MIME[".txt"] });
      else res.destroy();
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.on("close", () => limiter.stop());
  return server;
}

module.exports = { createServer, validateLead, buildCsp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => console.log(`Estética Derma Solução no ar: http://localhost:${port}`));
}
