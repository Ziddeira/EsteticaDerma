"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, validateLead } = require("../server/server.js");

let server;
let base;
let dataDir;

const validLead = {
  nome: "Maria Souza",
  whatsapp: "48991234567",
  objetivo: "Limpeza de pele",
  periodo: "Tarde",
  mensagem: "Pele sensível",
  consentimento: true,
  website: "",
  elapsed: 9000,
};

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "eds-test-"));
  server = createServer({ dataDir, rate: { windowMs: 60_000, max: 3 }, log: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function postLead(body, headers = {}) {
  return fetch(base + "/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, "X-Forwarded-For": "", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("serve a página inicial com cabeçalhos de segurança", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("strict-transport-security"), /max-age=\d+/);
  assert.match(await res.text(), /Estética Derma Solução/);
});

test("todos os assets referenciados no HTML existem", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href|srcset)="(\/[^"#]+)/g)) {
    for (const part of m[1].split(",")) refs.add(part.trim().split(/\s+/)[0]);
  }
  assert.ok(refs.size > 10);
  for (const ref of refs) {
    const res = await fetch(base + ref);
    assert.equal(res.status, 200, `asset ausente: ${ref}`);
    await res.arrayBuffer();
  }
});

test("bloqueia path traversal e dotfiles", async () => {
  for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fserver%2fserver.js", "/.env", "/assets/../../server/server.js"]) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
    await res.text();
  }
});

test("rejeita métodos não permitidos em arquivos estáticos", async () => {
  const res = await fetch(base + "/", { method: "DELETE" });
  assert.equal(res.status, 405);
  await res.text();
});

test("comprime HTML com gzip e responde 304 com ETag", async () => {
  const res = await fetch(base + "/");
  const etag = res.headers.get("etag");
  assert.ok(etag);
  await res.text();
  const res2 = await fetch(base + "/", { headers: { "If-None-Match": etag } });
  assert.equal(res2.status, 304);
});

test("validateLead aceita dados válidos e normaliza o telefone", () => {
  const r = validateLead({ ...validLead, whatsapp: "(48) 99123-4567" });
  assert.equal(r.lead.whatsapp, "48991234567");
});

test("validateLead rejeita campos inválidos", () => {
  assert.equal(validateLead({ ...validLead, nome: "<script>" }).error, "invalid_nome");
  assert.equal(validateLead({ ...validLead, whatsapp: "123" }).error, "invalid_whatsapp");
  assert.equal(validateLead({ ...validLead, objetivo: "Outro" }).error, "invalid_objetivo");
  assert.equal(validateLead({ ...validLead, periodo: "Madrugada" }).error, "invalid_periodo");
  assert.equal(validateLead({ ...validLead, mensagem: "x".repeat(501) }).error, "invalid_mensagem");
  assert.equal(validateLead({ ...validLead, consentimento: "true" }).error, "consent_required");
  assert.equal(validateLead({ ...validLead, nome: { $ne: 1 } }).error, "invalid_fields");
  assert.equal(validateLead([]).error, "invalid_body");
});

test("validateLead trata honeypot e envio rápido demais como spam", () => {
  assert.equal(validateLead({ ...validLead, website: "http://spam" }).spam, true);
  assert.equal(validateLead({ ...validLead, elapsed: 300 }).spam, true);
});

test("POST /api/lead salva o contato válido", async () => {
  const res = await postLead(validLead);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
  const lines = fs.readFileSync(path.join(dataDir, "leads.ndjson"), "utf8").trim().split("\n");
  const rec = JSON.parse(lines.at(-1));
  assert.equal(rec.nome, "Maria Souza");
  assert.equal(rec.whatsapp, "48991234567");
  assert.ok(rec.ip_hash && !rec.ip_hash.includes("127.0.0.1"));
  assert.equal(fs.statSync(path.join(dataDir, "leads.ndjson")).mode & 0o777, 0o600);
});

test("POST /api/lead exige mesma origem e JSON", async () => {
  let res = await postLead(validLead, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
  await res.text();
  res = await fetch(base + "/api/lead", { method: "POST", headers: { Origin: base, "Content-Type": "text/plain" }, body: "x" });
  assert.equal(res.status, 415);
  await res.text();
});

test("POST /api/lead rejeita corpo grande e JSON inválido", async () => {
  let res = await postLead("{bad json");
  assert.equal(res.status, 400);
  await res.text();
  res = await postLead({ ...validLead, mensagem: "x".repeat(10_000) });
  assert.equal(res.status, 413);
  await res.text();
});

test("POST /api/lead aplica rate limit por IP", async () => {
  // limite = 3 por janela; requisições anteriores deste IP já contam
  let last;
  for (let i = 0; i < 5; i++) {
    last = await postLead({ ...validLead, objetivo: "Inválido" });
    await last.text();
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});
