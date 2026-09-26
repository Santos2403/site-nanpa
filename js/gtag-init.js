/* Google tag (gtag.js) — NANPA Tecnologia
   Equivale ao snippet oficial do Google Ads; fica em arquivo externo porque a
   Content-Security-Policy do site bloqueia scripts inline.
   O consentimento padrão (Consent Mode v2) precisa vir antes do 'config'. */
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }

gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
});
try {
    var nanpaConsent = localStorage.getItem('nanpa_consent');
    if (nanpaConsent === 'granted') {
        gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
    }
} catch (e) { /* storage indisponível */ }

gtag('js', new Date());
gtag('config', 'AW-362399380');
