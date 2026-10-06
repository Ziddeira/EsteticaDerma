/* Estética Derma Solução — interações do site.
   Sem dependências externas; tudo funciona sem JS (links do WhatsApp apontam
   para o número), e o script só melhora a experiência. */
(function () {
  "use strict";

  var WHATSAPP = "5548991248451";
  var doc = document.documentElement;
  doc.classList.add("js");

  function waUrl(message) {
    return "https://wa.me/" + WHATSAPP + (message ? "?text=" + encodeURIComponent(message) : "");
  }

  /* Eventos de conversão: compatível com GTM/GA4 (dataLayer) se for instalado. */
  function track(name, data) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: name };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    window.dataLayer.push(payload);
  }

  /* Mensagem pronta em cada CTA do WhatsApp */
  document.querySelectorAll("[data-wa]").forEach(function (a) {
    a.href = waUrl(a.getAttribute("data-wa"));
  });
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-track]");
    if (el && el.tagName === "A") track("cta_click", { cta: el.getAttribute("data-track"), href: el.href });
  });

  /* Header: sombra ao rolar + barra fixa no mobile */
  var header = document.querySelector("[data-header]");
  var bar = document.querySelector("[data-mobile-bar]");
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 8);
    if (bar) bar.classList.toggle("is-visible", y > 520);
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* Menu mobile */
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  function setMenu(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".sr-only").textContent = open ? "Fechar menu" : "Abrir menu";
    nav.classList.toggle("is-open", open);
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () { setMenu(toggle.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
  }

  /* Animações de entrada */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* Mapa: só carrega o Google Maps quando a pessoa pede (privacidade + desempenho) */
  var mapBtn = document.querySelector("[data-map-load]");
  if (mapBtn) {
    mapBtn.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      iframe.src = "https://www.google.com/maps?q=" +
        encodeURIComponent("Estética Derma Solução, R. dos Ilhéus, 38 - Centro, Florianópolis - SC, 88010-560") +
        "&output=embed";
      iframe.title = "Mapa: Estética Derma Solução, R. dos Ilhéus, 38, Centro, Florianópolis";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      mapBtn.replaceWith(iframe);
      track("map_load");
    });
  }

  /* Ano no rodapé */
  var year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  /* Formulário de agendamento */
  var form = document.querySelector("[data-lead-form]");
  if (!form) return;
  var status = form.querySelector("[data-form-status]");
  var phone = form.elements.whatsapp;
  var startedAt = Date.now();

  phone.addEventListener("input", function () {
    var d = phone.value.replace(/\D/g, "").slice(0, 11);
    var out = d;
    if (d.length > 2) out = "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length > 7) out = "(" + d.slice(0, 2) + ") " + d.slice(2, d.length - 4) + "-" + d.slice(-4);
    phone.value = out;
  });

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "form__status" + (kind ? " is-" + kind : "");
  }

  function validate() {
    var errors = [];
    var nome = form.elements.nome;
    var objetivo = form.elements.objetivo;
    var consent = form.elements.consentimento;
    var digits = phone.value.replace(/\D/g, "");

    [nome, phone, objetivo].forEach(function (el) { el.removeAttribute("aria-invalid"); });
    consent.closest(".consent").classList.remove("is-invalid");

    if (nome.value.trim().length < 2) { nome.setAttribute("aria-invalid", "true"); errors.push(nome); }
    if (digits.length < 10 || digits.length > 11) { phone.setAttribute("aria-invalid", "true"); errors.push(phone); }
    if (!objetivo.value) { objetivo.setAttribute("aria-invalid", "true"); errors.push(objetivo); }
    if (!consent.checked) { consent.closest(".consent").classList.add("is-invalid"); errors.push(consent); }
    return errors;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errors = validate();
    if (errors.length) {
      setStatus("Confira os campos destacados para continuar.", "error");
      errors[0].focus();
      return;
    }

    var periodoEl = form.querySelector("input[name=periodo]:checked");
    var data = {
      nome: form.elements.nome.value.trim(),
      whatsapp: phone.value.replace(/\D/g, ""),
      objetivo: form.elements.objetivo.value,
      periodo: periodoEl ? periodoEl.value : "",
      mensagem: form.elements.mensagem.value.trim(),
      consentimento: true,
      website: form.elements.website.value,
      elapsed: Date.now() - startedAt
    };

    var text = "Olá, Leila! Sou " + data.nome + " e vim pelo site.\n" +
      "Objetivo: " + data.objetivo + "\n" +
      (data.periodo ? "Melhor período: " + data.periodo + "\n" : "") +
      (data.mensagem ? "Observações: " + data.mensagem + "\n" : "") +
      "Gostaria de agendar minha avaliação.";
    var target = waUrl(text);

    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    setStatus("Abrindo o WhatsApp…", "ok");
    track("generate_lead", { objetivo: data.objetivo });

    /* Registra o contato no servidor (se houver backend). Em hospedagem
       estática ou se a API falhar, a pessoa segue para o WhatsApp do mesmo jeito. */
    var done = false;
    function go() {
      if (done) return;
      done = true;
      btn.disabled = false;
      window.location.href = target;
    }
    var timer = setTimeout(go, 2500);
    try {
      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "same-origin",
        keepalive: true
      }).then(function () { clearTimeout(timer); go(); }, function () { clearTimeout(timer); go(); });
    } catch (err) {
      clearTimeout(timer);
      go();
    }
  });
})();
