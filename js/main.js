/* =======================================
   NANPA Tecnologia — Main JavaScript
   ======================================= */

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initScrollAnimations();
    initTestimonialSlider();
    initCounters();
    initParallax();
    initContactForm();
    initSmoothScroll();
    initLightbox();
    initCaptchaVerification();
});

/* ---- Navigation ---- */
function initNavigation() {
    const navbar = document.querySelector('.navbar');
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Scroll effect — add background on scroll
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const scrollY = window.scrollY;
        navbar.classList.toggle('scrolled', scrollY > 50);
        lastScroll = scrollY;
    }, { passive: true });

    // Create nav overlay backdrop (tap outside to close)
    const navOverlay = document.createElement('div');
    navOverlay.className = 'nav-overlay';
    document.body.appendChild(navOverlay);

    // Helper: close mobile menu
    const closeMenu = () => {
        navMenu.classList.remove('open');
        navToggle.classList.remove('active');
        navOverlay.classList.remove('visible');
        document.body.classList.remove('nav-open');
        document.body.style.overflow = '';
    };

    // Mobile menu toggle
    navToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('open');
        navToggle.classList.toggle('active');
        navOverlay.classList.toggle('visible', isOpen);
        document.body.classList.toggle('nav-open', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close menu on overlay tap
    navOverlay.addEventListener('click', closeMenu);

    // Close mobile menu on link click
    navLinks.forEach(link => {
        link.addEventListener('click', closeMenu);
    });

    // Also close on CTA click
    const navCta = document.querySelector('.nav-cta');
    if (navCta) {
        navCta.addEventListener('click', closeMenu);
    }

    // Scroll Spy — highlight active nav link
    const sections = document.querySelectorAll('section[id]');
    const observerOptions = {
        root: null,
        rootMargin: '-20% 0px -80% 0px',
        threshold: 0
    };

    const scrollSpyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                navLinks.forEach(link => {
                    link.classList.toggle('active',
                        link.getAttribute('href') === `#${id}`
                    );
                });
            }
        });
    }, observerOptions);

    sections.forEach(section => scrollSpyObserver.observe(section));
}

/* ---- Scroll Reveal Animations ---- */
function initScrollAnimations() {
    const revealElements = document.querySelectorAll(
        '.reveal, .reveal-left, .reveal-right, .reveal-stagger'
    );

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Once revealed, stop observing for performance
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: '0px 0px -60px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
}

/* ---- Testimonial Slider ---- */
function initTestimonialSlider() {
    const track = document.getElementById('testimonial-track');
    const dots = document.querySelectorAll('.testimonial-dot');
    if (!track || dots.length === 0) return;

    let currentSlide = 0;
    const totalSlides = dots.length;
    let autoPlayTimer;

    function goToSlide(index) {
        currentSlide = ((index % totalSlides) + totalSlides) % totalSlides;
        track.style.transform = `translateX(-${currentSlide * 100}%)`;
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentSlide);
        });
    }

    function startAutoPlay() {
        stopAutoPlay();
        autoPlayTimer = setInterval(() => {
            goToSlide(currentSlide + 1);
        }, 5000);
    }

    function stopAutoPlay() {
        if (autoPlayTimer) clearInterval(autoPlayTimer);
    }

    // Dot click handlers
    dots.forEach((dot, i) => {
        dot.addEventListener('click', () => {
            goToSlide(i);
            startAutoPlay(); // Reset timer on manual navigation
        });
    });

    // Touch/swipe support
    let touchStartX = 0;
    let touchEndX = 0;

    track.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        stopAutoPlay();
    }, { passive: true });

    track.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
            goToSlide(diff > 0 ? currentSlide + 1 : currentSlide - 1);
        }
        startAutoPlay();
    }, { passive: true });

    startAutoPlay();
}

/* ---- Counter Animations ---- */
function initCounters() {
    const counters = document.querySelectorAll('.stat-number');
    if (counters.length === 0) return;

    let hasAnimated = false;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !hasAnimated) {
                hasAnimated = true;
                animateCounters(counters);
                observer.disconnect();
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

function animateCounters(counters) {
    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-target'), 10);
        const suffix = counter.getAttribute('data-suffix') || '';
        const duration = 2000;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(eased * target);

            counter.textContent = current + suffix;

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                counter.textContent = target + suffix;
            }
        }

        requestAnimationFrame(update);
    });
}

/* ---- Parallax ---- */
function initParallax() {
    const heroBg = document.querySelector('.hero-bg');
    if (!heroBg) return;

    let ticking = false;

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const scrollY = window.scrollY;
                if (scrollY < window.innerHeight) {
                    heroBg.style.transform = `translateY(${scrollY * 0.3}px)`;
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

/* ---- Contact Form ---- */
function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // Check Anti-Bot Honeypot field
        const honeypot = form.querySelector('[name="b_address_hp"]');
        if (honeypot && honeypot.value.trim() !== '') {
            // Automated bot detected -> silently block submission
            return;
        }

        const btn = form.querySelector('.btn-submit');
        const originalText = btn.innerHTML;

        btn.innerHTML = '<span style="position:relative;z-index:1">Enviando...</span>';
        btn.disabled = true;
        btn.style.opacity = '0.7';

        setTimeout(() => {
            btn.innerHTML = '<span style="position:relative;z-index:1">✓ Mensagem Enviada!</span>';
            btn.style.opacity = '1';
            btn.style.background = 'linear-gradient(135deg, #4ecdc4, #2b7de9)';

            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.background = '';
                form.reset();
            }, 3000);
        }, 1200);
    });
}

/* ---- WhatsApp protegido: Google reCAPTCHA v3 + validacao no servidor ---- */
function initCaptchaVerification() {
    const modal = document.getElementById('captcha-modal');
    if (!modal) return;

    const overlay  = document.getElementById('captcha-overlay');
    const closeBtn = document.getElementById('captcha-close');
    const retryBtn = document.getElementById('captcha-btn');
    const openLink = document.getElementById('wa-open-link');
    const feedback = document.getElementById('captcha-feedback');
    const triggers = document.querySelectorAll('.wa-captcha-link');

    const metaKey  = (document.querySelector('meta[name="recaptcha-sitekey"]') || {}).content || '';
    const siteKey  = /^[A-Za-z0-9_-]{20,}$/.test(metaKey) && !metaKey.startsWith('COLOQUE') ? metaKey : '';

    let scriptPromise = null;
    let busy = false;
    let timeoutId = null;

    function loadRecaptcha() {
        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') return Promise.resolve(window.grecaptcha);
        if (scriptPromise) return scriptPromise;
        scriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(siteKey);
            script.async = true;
            script.onload = () => {
                if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
                    window.grecaptcha.ready(() => resolve(window.grecaptcha));
                } else if (window.grecaptcha) { resolve(window.grecaptcha); }
                else { reject(new Error('recaptcha')); }
            };
            script.onerror = () => { scriptPromise = null; script.remove(); reject(new Error('recaptcha')); };
            document.head.appendChild(script);
        });
        return scriptPromise;
    }

    function setStatus(text, kind) {
        if (!feedback) return;
        feedback.textContent = text;
        feedback.className = 'captcha-feedback' + (kind ? ' ' + kind + '-msg' : '');
    }

    function showError(text) { busy = false; clearTimeout(timeoutId); setStatus(text, 'error'); if (retryBtn) retryBtn.hidden = false; }

    function openModal() { modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }

    function closeModal() { modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; clearTimeout(timeoutId); busy = false; }

    const GENERIC_ERROR = 'Servico temporariamente indisponivel. Tente novamente ou use nosso e-mail.';

    async function requestWhatsAppUrl(token) {
        let res;
        try {
            res = await fetch('/api/whatsapp', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nanpa-wa' },
                body: JSON.stringify({ token }),
            });
        } catch { return showError('Falha de conexao. Verifique sua internet e tente novamente.'); }
        if (!busy) return;

        let data = null;
        try { data = await res.json(); } catch {}

        if (!res.ok || !data || !data.ok) {
            console.warn('[NANPA WhatsApp Error]', res.status, data);
            if (res.status === 429) return showError('Muitas tentativas seguidas. Aguarde um minuto e tente novamente.');
            if (res.status === 403) return showError('Nao foi possivel confirmar a verificacao. Tente novamente.');
            return showError(GENERIC_ERROR);
        }

        let target = null;
        try { target = new URL(data.url); } catch {}
        if (!target || target.protocol !== 'https:' || target.hostname !== 'wa.me') return showError(GENERIC_ERROR);

        busy = false; clearTimeout(timeoutId);
        if (openLink) openLink.href = target.href;

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
            setStatus('V Verificado! Abrindo WhatsApp...', 'success');
            setTimeout(() => { window.location.href = target.href; setTimeout(closeModal, 1200); }, 300);
            return;
        }
        const win = window.open(target.href, '_blank');
        if (win) { try { win.opener = null; } catch {} setStatus('V Verificado! Abrindo WhatsApp...', 'success'); setTimeout(closeModal, 600); }
        else { setStatus('V Verificado! Clique no botao abaixo para abrir:', 'success'); if (openLink) openLink.hidden = false; }
    }

    async function startVerification() {
        if (busy) return;
        busy = true;
        if (retryBtn) retryBtn.hidden = true;
        if (openLink) { openLink.hidden = true; openLink.href = '#'; }
        setStatus('Verificando conexao segura...');
        if (!siteKey) return showError('Verificacao indisponivel no momento. Use nosso e-mail para contato.');
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => { if (busy) showError('A verificacao demorou mais que o esperado. Tente novamente.'); }, 20000);
        let rc;
        try { rc = await loadRecaptcha(); }
        catch { return showError('Nao foi possivel carregar a verificacao. Verifique bloqueadores de conteudo e tente novamente.'); }
        if (!busy) return;
        let token;
        try { token = await rc.execute(siteKey, { action: 'whatsapp' }); }
        catch { return showError('Falha na verificacao. Tente novamente.'); }
        if (!busy) return;
        await requestWhatsAppUrl(token);
    }

    const warmUp = () => { if (siteKey) loadRecaptcha().catch(() => {}); };
    triggers.forEach(link => {
        link.addEventListener('pointerenter', warmUp, { once: true });
        link.addEventListener('touchstart', warmUp, { once: true, passive: true });
        link.addEventListener('focus', warmUp, { once: true });
        link.addEventListener('click', e => { e.preventDefault(); openModal(); startVerification(); });
    });

    if (openLink) { openLink.addEventListener('click', e => { if (openLink.getAttribute('href') === '#') { e.preventDefault(); return; } setTimeout(closeModal, 300); }); }
    if (retryBtn) retryBtn.addEventListener('click', startVerification);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay)  overlay.addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && modal.classList.contains('active')) closeModal(); });
}

/* ---- Lightbox (Click to Enlarge) ---- */
function initLightbox() {
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = `
        <button class="lightbox-close" aria-label="Fechar">&times;</button>
        <img class="lightbox-img" src="" alt="">
    `;
    document.body.appendChild(lightbox);

    const lightboxImg = lightbox.querySelector('.lightbox-img');
    const closeBtn = lightbox.querySelector('.lightbox-close');

    function openLightbox(img) {
        lightboxImg.src = img.currentSrc || img.src;
        lightboxImg.alt = img.alt || '';
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    document.querySelectorAll('.work-image img, .product-image img, .duct-gallery-card img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(img));
    });

    closeBtn.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) closeLightbox();
    });
}

/* ---- Smooth Scroll ---- */
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]:not(.wa-captcha-link)').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                const offsetTop = target.offsetTop - 80;
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}
