/* =========================================================
   NANPA Tecnologia — main.js v3
   Navegação · atribuição (UTM) · dataLayer/GTM com consentimento
   Formulário de contato · WhatsApp protegido · lightbox
   ========================================================= */
(function () {
    'use strict';

    var body = document.body;
    var PAGE_KEY = body.getAttribute('data-page-key') || '';
    var PAGE_TOPIC = body.getAttribute('data-wa-topic') || 'geral';

    function meta(name) {
        var el = document.querySelector('meta[name="' + name + '"]');
        return el ? (el.getAttribute('content') || '').trim() : '';
    }

    /* ---------------------------------------------------------
       Atribuição: guarda UTMs / gclid e a página de entrada
       durante a sessão, para anexar ao formulário e ao WhatsApp.
       --------------------------------------------------------- */
    var ATTR_KEY = 'nanpa_attr';
    var ATTR_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid'];

    function storageGet(store, key) {
        try { return JSON.parse(window[store].getItem(key) || 'null'); } catch (e) { return null; }
    }
    function storageSet(store, key, value) {
        try { window[store].setItem(key, JSON.stringify(value)); } catch (e) { /* storage indisponível */ }
    }

    function referrerHost() {
        try {
            if (!document.referrer) return '';
            var host = new URL(document.referrer).hostname;
            return host === location.hostname ? '' : host;
        } catch (e) { return ''; }
    }

    var attribution = (function captureAttribution() {
        var params = new URLSearchParams(location.search);
        var found = {};
        ATTR_PARAMS.forEach(function (k) {
            var v = params.get(k);
            if (v) found[k] = v.slice(0, 150);
        });
        var current = storageGet('sessionStorage', ATTR_KEY);
        if (Object.keys(found).length) {
            found.landing_page = location.pathname;
            found.referrer = referrerHost();
            current = found;
            storageSet('sessionStorage', ATTR_KEY, current);
        } else if (!current) {
            current = { landing_page: location.pathname, referrer: referrerHost() };
            storageSet('sessionStorage', ATTR_KEY, current);
        }
        return current || {};
    })();

    /* ---------------------------------------------------------
       Analytics: dataLayer + Consent Mode v2 + GTM (opcional).
       O GTM só é carregado se a meta "gtm-id" estiver preenchida.
       --------------------------------------------------------- */
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }

    var GTM_ID = /^GTM-[A-Z0-9]{4,12}$/.test(meta('gtm-id')) ? meta('gtm-id') : '';
    var CONSENT_KEY = 'nanpa_consent';

    // O consentimento padrão (Consent Mode v2) é definido em js/gtag-init.js,
    // carregado no <head> antes da Google tag.
    var HAS_GTAG = !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]');

    function applyConsent(choice) {
        var v = choice === 'granted' ? 'granted' : 'denied';
        gtag('consent', 'update', {
            ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v
        });
    }

    var storedConsent = null;
    try { storedConsent = localStorage.getItem(CONSENT_KEY); } catch (e) { /* ignore */ }
    if (storedConsent && !HAS_GTAG) applyConsent(storedConsent);

    function track(event, params) {
        var data = { event: event, page_key: PAGE_KEY, page_path: location.pathname };
        if (params) for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) data[k] = params[k];
        window.dataLayer.push(data);
    }

    window.dataLayer.push({
        event: 'nanpa_context',
        page_key: PAGE_KEY,
        lead_landing_page: attribution.landing_page || '',
        lead_utm_source: attribution.utm_source || '',
        lead_utm_medium: attribution.utm_medium || '',
        lead_utm_campaign: attribution.utm_campaign || '',
        lead_utm_term: attribution.utm_term || ''
    });

    if (GTM_ID) {
        window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
        var gtm = document.createElement('script');
        gtm.async = true;
        gtm.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(GTM_ID);
        document.head.appendChild(gtm);
    }

    if (PAGE_KEY.indexOf('lp_') === 0) track('key_page_view', { lp: PAGE_KEY });

    function initCookieBanner() {
        var banner = document.getElementById('cookie-banner');
        var prefs = document.querySelectorAll('.js-cookie-prefs');
        if (!banner || (!GTM_ID && !HAS_GTAG)) return; // sem medição configurada, não há cookies a consentir
        prefs.forEach(function (b) {
            b.hidden = false;
            b.addEventListener('click', function () { banner.hidden = false; });
        });
        if (!storedConsent) banner.hidden = false;
        banner.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-consent]');
            if (!btn) return;
            var choice = btn.getAttribute('data-consent');
            try { localStorage.setItem(CONSENT_KEY, choice); } catch (err) { /* ignore */ }
            applyConsent(choice);
            track('consent_choice', { consent: choice });
            banner.hidden = true;
        });
    }

    /* ---------------------------------------------------------
       Navegação
       --------------------------------------------------------- */
    function initNav() {
        var nav = document.getElementById('site-nav');
        var toggle = document.querySelector('.nav-toggle');
        var dropBtns = document.querySelectorAll('.nav-drop-btn');
        if (!nav || !toggle) return;

        function closeDrops(except) {
            dropBtns.forEach(function (b) {
                if (b === except) return;
                b.setAttribute('aria-expanded', 'false');
                var m = document.getElementById(b.getAttribute('aria-controls'));
                if (m) m.classList.remove('open');
            });
        }
        function closeNav() {
            nav.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Abrir menu');
            body.classList.remove('nav-open');
        }

        toggle.addEventListener('click', function () {
            var open = !nav.classList.contains('open');
            nav.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
            body.classList.toggle('nav-open', open);
        });

        dropBtns.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var menu = document.getElementById(btn.getAttribute('aria-controls'));
                var open = btn.getAttribute('aria-expanded') !== 'true';
                closeDrops(btn);
                btn.setAttribute('aria-expanded', String(open));
                if (menu) menu.classList.toggle('open', open);
            });
        });

        nav.addEventListener('click', function (e) {
            if (e.target.closest('a')) { closeNav(); closeDrops(); }
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.nav-drop')) closeDrops();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeDrops(); closeNav(); }
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth >= 1080) closeNav();
        }, { passive: true });
    }

    /* ---------------------------------------------------------
       Cliques: CTAs, telefone, e-mail, pré-seleção de serviço
       --------------------------------------------------------- */
    function initClickTracking() {
        document.addEventListener('click', function (e) {
            var a = e.target.closest('a, button');
            if (!a) return;
            var href = a.getAttribute('href') || '';
            if (href.indexOf('tel:') === 0) track('phone_click', { cta_location: a.getAttribute('data-cta-location') || '' });
            else if (href.indexOf('mailto:') === 0) track('email_click', {});
            var cta = a.getAttribute('data-cta');
            if (cta) track('cta_click', { cta_id: cta });
            var service = a.getAttribute('data-service');
            if (service) {
                var sel = document.getElementById('f-servico');
                if (sel && sel.querySelector('option[value="' + service + '"]')) sel.value = service;
            }
            var preset = a.getAttribute('data-message');
            var msg = document.getElementById('f-msg');
            if (preset && msg && !msg.value.trim()) msg.value = preset;
        });

        document.querySelectorAll('video[controls]').forEach(function (v) {
            v.addEventListener('play', function () {
                track('video_play', { video: (v.getAttribute('src') || '').split('/').pop() });
            }, { once: true });
        });

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            document.querySelectorAll('video[autoplay], video[data-autoplay]').forEach(function (v) {
                v.removeAttribute('autoplay'); v.removeAttribute('data-autoplay'); v.pause(); v.setAttribute('controls', '');
            });
        }
        // Vídeos sem áudio abaixo da dobra: só carregam e tocam quando ficam visíveis
        var lazyVideos = document.querySelectorAll('video[data-autoplay]');
        if (lazyVideos.length && 'IntersectionObserver' in window) {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    var v = en.target;
                    if (en.isIntersecting) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
                    else v.pause();
                });
            }, { threshold: 0.25 });
            lazyVideos.forEach(function (v) { io.observe(v); });
        }
    }

    /* ---------------------------------------------------------
       reCAPTCHA v3 (carregado sob demanda)
       --------------------------------------------------------- */
    var RC_KEY = (function () {
        var k = meta('recaptcha-sitekey');
        return /^[A-Za-z0-9_-]{20,}$/.test(k) ? k : '';
    })();
    var rcPromise = null;

    function loadRecaptcha() {
        if (!RC_KEY) return Promise.reject(new Error('no-key'));
        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') return Promise.resolve(window.grecaptcha);
        if (rcPromise) return rcPromise;
        rcPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(RC_KEY);
            s.async = true;
            s.onload = function () {
                if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') window.grecaptcha.ready(function () { resolve(window.grecaptcha); });
                else reject(new Error('recaptcha'));
            };
            s.onerror = function () { rcPromise = null; s.remove(); reject(new Error('recaptcha')); };
            document.head.appendChild(s);
        });
        return rcPromise;
    }

    function recaptchaToken(action) {
        return loadRecaptcha().then(function (rc) { return rc.execute(RC_KEY, { action: action }); });
    }

    function attributionPayload() {
        var out = { page: location.pathname };
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'landing_page', 'referrer'].forEach(function (k) {
            if (attribution[k]) out[k] = String(attribution[k]);
        });
        return out;
    }

    /* ---------------------------------------------------------
       WhatsApp: o número fica no servidor; o link só é entregue
       após o reCAPTCHA. A mensagem muda conforme a página e inclui
       discretamente a origem do lead.
       --------------------------------------------------------- */
    function initWhatsApp() {
        var modal = document.getElementById('wa-modal');
        if (!modal) return;
        var feedback = document.getElementById('wa-feedback');
        var openLink = document.getElementById('wa-open-link');
        var retry = document.getElementById('wa-retry');
        var busy = false, timer = null, current = { topic: PAGE_TOPIC, location: '' };

        function setStatus(text, kind) {
            feedback.textContent = text;
            feedback.className = 'modal-feedback' + (kind ? ' ' + kind + '-msg' : '');
        }
        function fail(text) {
            busy = false; clearTimeout(timer);
            setStatus(text, 'error');
            retry.hidden = false;
        }
        function open() { modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); }
        function close() { modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); busy = false; clearTimeout(timer); }

        function done(url) {
            busy = false; clearTimeout(timer);
            openLink.href = url;
            track('whatsapp_lead', { wa_topic: current.topic, cta_location: current.location });
            if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                setStatus('Verificado! Abrindo o WhatsApp…', 'success');
                setTimeout(function () { window.location.href = url; setTimeout(close, 1500); }, 250);
                return;
            }
            var win = window.open(url, '_blank');
            if (win) { try { win.opener = null; } catch (e) { /* ignore */ } setStatus('Verificado! Abrindo o WhatsApp…', 'success'); setTimeout(close, 700); }
            else { setStatus('Verificado! Clique no botão abaixo para abrir:', 'success'); openLink.hidden = false; }
        }

        function start() {
            if (busy) return;
            busy = true;
            retry.hidden = true; openLink.hidden = true; openLink.href = '#';
            setStatus('Verificando…');
            clearTimeout(timer);
            timer = setTimeout(function () { if (busy) fail('A verificação demorou mais que o esperado. Tente novamente.'); }, 20000);
            recaptchaToken('whatsapp')
                .catch(function () { throw new Error('rc'); })
                .then(function (token) {
                    if (!busy) return null;
                    return fetch('/api/whatsapp.php', {
                        method: 'POST',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nanpa-wa' },
                        body: JSON.stringify({ token: token, topic: current.topic, ref: attributionPayload() })
                    });
                })
                .then(function (res) {
                    if (!res) return;
                    return res.json().catch(function () { return null; }).then(function (data) {
                        if (!busy) return;
                        if (!res.ok || !data || !data.ok) {
                            if (res.status === 429) return fail('Muitas tentativas seguidas. Aguarde um minuto e tente novamente.');
                            if (res.status === 403) return fail('Não foi possível confirmar a verificação. Tente novamente ou use o e-mail.');
                            return fail('Serviço temporariamente indisponível. Tente novamente ou use o e-mail.');
                        }
                        var url;
                        try { url = new URL(data.url); } catch (e) { url = null; }
                        if (!url || url.protocol !== 'https:' || url.hostname !== 'wa.me') return fail('Serviço temporariamente indisponível. Use o e-mail.');
                        done(url.href);
                    });
                })
                .catch(function (err) {
                    if (!busy) return;
                    if (err && err.message === 'rc') fail('Não foi possível carregar a verificação. Desative bloqueadores de conteúdo ou use o e-mail.');
                    else fail('Falha de conexão. Verifique sua internet e tente novamente.');
                });
        }

        var warm = function () { loadRecaptcha().catch(function () {}); };
        document.querySelectorAll('.js-wa').forEach(function (el) {
            el.addEventListener('pointerenter', warm, { once: true });
            el.addEventListener('touchstart', warm, { once: true, passive: true });
            el.addEventListener('focus', warm, { once: true });
        });
        document.addEventListener('click', function (e) {
            var el = e.target.closest('.js-wa');
            if (!el) return;
            e.preventDefault();
            current = {
                topic: el.getAttribute('data-wa-topic') || PAGE_TOPIC,
                location: el.getAttribute('data-cta-location') || ''
            };
            track('whatsapp_click', { wa_topic: current.topic, cta_location: current.location });
            open();
            start();
        });
        retry.addEventListener('click', start);
        openLink.addEventListener('click', function () { setTimeout(close, 300); });
        modal.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('active')) close(); });
    }

    /* ---------------------------------------------------------
       Formulário de contato (envio real para /api/contato.php)
       --------------------------------------------------------- */
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function initLeadForms() {
        document.querySelectorAll('.js-lead-form').forEach(function (form) {
            var startedAt = Date.now();
            var status = form.querySelector('.form-status');
            var submit = form.querySelector('button[type="submit"]');
            var submitLabel = submit.textContent;
            var interacted = false;

            form.addEventListener('focusin', function () {
                if (!interacted) { interacted = true; loadRecaptcha().catch(function () {}); track('form_start', { form_id: form.getAttribute('data-form-id') }); }
            });

            function setError(name, msg) {
                var input = form.elements[name];
                if (!input) return;
                var field = input.closest('.field');
                var err = field && field.querySelector('.field-error');
                if (field) field.classList.toggle('invalid', !!msg);
                if (err) err.textContent = msg || '';
                input.setAttribute('aria-invalid', msg ? 'true' : 'false');
            }

            function validate() {
                var ok = true, first = null;
                function check(name, cond, msg) {
                    setError(name, cond ? '' : msg);
                    if (!cond) { ok = false; if (!first) first = form.elements[name]; }
                }
                var v = function (n) { return form.elements[n] ? form.elements[n].value.trim() : ''; };
                var digits = v('phone').replace(/\D/g, '');
                check('name', v('name').length >= 2, 'Informe seu nome.');
                check('phone', digits.length >= 10 && digits.length <= 13, 'Informe um telefone com DDD.');
                check('email', EMAIL_RE.test(v('email')), 'Informe um e-mail válido.');
                check('service', !!v('service'), 'Selecione o tipo de serviço.');
                check('message', v('message').length >= 5, 'Escreva uma mensagem curta.');
                if (first) first.focus();
                return ok;
            }

            form.addEventListener('submit', function (e) {
                e.preventDefault();
                status.textContent = ''; status.className = 'form-status';
                if (form.elements.website && form.elements.website.value) return; // honeypot
                if (!validate()) return;

                submit.disabled = true;
                submit.textContent = 'Enviando…';

                var get = function (n) { return form.elements[n] ? form.elements[n].value.trim() : ''; };
                var payload = {
                    name: get('name'), company: get('company'), phone: get('phone'), email: get('email'),
                    service: get('service'), equipment: get('equipment'), message: get('message'),
                    website: get('website'), elapsed_ms: Date.now() - startedAt,
                    form_id: form.getAttribute('data-form-id') || '', ref: attributionPayload()
                };

                recaptchaToken('contato')
                    .catch(function () { return ''; })
                    .then(function (token) {
                        payload.token = token;
                        return fetch('/api/contato.php', {
                            method: 'POST',
                            credentials: 'same-origin',
                            cache: 'no-store',
                            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nanpa-form' },
                            body: JSON.stringify(payload)
                        });
                    })
                    .then(function (res) {
                        return res.json().catch(function () { return null; }).then(function (data) { return { res: res, data: data }; });
                    })
                    .then(function (r) {
                        if (r.res.ok && r.data && r.data.ok) {
                            track('generate_lead', { form_id: payload.form_id, service_type: payload.service, lead_source: attribution.utm_source || '', lead_campaign: attribution.utm_campaign || '' });
                            showSuccess(form, payload.service);
                            return;
                        }
                        var msg = 'Não foi possível enviar agora. Tente novamente em instantes ou escreva para comercial@nanpatec.com.br.';
                        if (r.res.status === 429) msg = 'Muitas tentativas seguidas. Aguarde alguns minutos ou fale pelo WhatsApp.';
                        else if (r.data && r.data.error === 'validation') msg = 'Confira os campos destacados e tente novamente.';
                        else if (r.data && r.data.error === 'verification_failed') msg = 'Não conseguimos confirmar que você não é um robô. Tente novamente ou fale pelo WhatsApp.';
                        if (r.data && r.data.fields) Object.keys(r.data.fields).forEach(function (k) { setError(k, r.data.fields[k]); });
                        track('form_error', { form_id: payload.form_id, error: (r.data && r.data.error) || String(r.res.status) });
                        throw { userMsg: msg };
                    })
                    .catch(function (err) {
                        status.className = 'form-status is-error';
                        status.textContent = err && err.userMsg ? err.userMsg : 'Falha de conexão. Verifique sua internet e tente novamente.';
                        submit.disabled = false;
                        submit.textContent = submitLabel;
                    });
            });
        });
    }

    function showSuccess(form, service) {
        var topic = service && service !== 'outro' ? service : PAGE_TOPIC;
        form.innerHTML =
            '<div class="form-success" tabindex="-1">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10.5 15 8 12.5"/></svg>' +
            '<h3>Solicitação enviada</h3>' +
            '<p>Recebemos seus dados e vamos retornar pelo telefone ou e-mail informado. Se preferir adiantar, fale agora pelo WhatsApp.</p>' +
            '<div class="btn-row"><a href="#" class="btn btn-wa js-wa" data-wa-topic="' + topic + '" data-cta-location="form_sucesso">Conversar pelo WhatsApp</a></div>' +
            '</div>';
        var box = form.querySelector('.form-success');
        if (box) box.focus();
    }

    /* ---------------------------------------------------------
       Lightbox para fotos com data-full
       --------------------------------------------------------- */
    function initLightbox() {
        var imgs = document.querySelectorAll('img[data-full]');
        if (!imgs.length) return;
        var box = document.createElement('div');
        box.className = 'lightbox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'Imagem ampliada');
        box.innerHTML = '<button class="lightbox-close" type="button" aria-label="Fechar">&times;</button><img alt="">';
        document.body.appendChild(box);
        var big = box.querySelector('img');
        function close() { box.classList.remove('active'); big.removeAttribute('src'); }
        imgs.forEach(function (img) {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', function () {
                big.src = img.getAttribute('data-full');
                big.alt = img.alt;
                box.classList.add('active');
            });
        });
        box.addEventListener('click', function (e) { if (e.target !== big) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }

    function init() {
        document.querySelectorAll('.js-year').forEach(function (el) { el.textContent = new Date().getFullYear(); });
        initNav();
        initClickTracking();
        initWhatsApp();
        initLeadForms();
        initLightbox();
        initCookieBanner();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
