(function () {
    var root = document.documentElement;
    var toggle = document.getElementById('theme-toggle');
    var header = document.querySelector('.site-header');
    var year = document.getElementById('year');

    if (year) year.textContent = new Date().getFullYear();

    function isDark() {
        var set = root.getAttribute('data-theme');
        if (set) return set === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    if (toggle) {
        toggle.addEventListener('click', function () {
            var next = isDark() ? 'light' : 'dark';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) {}
        });
    }

    if (header) {
        var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 8); };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    // Analytics loads after the page is done and the browser is idle, so it
    // never competes with first paint. Skipped while a page is only prerendered.
    var GA_ID = 'G-JDQKB8TRSR';
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    function loadAnalytics() {
        window.gtag('js', new Date());
        window.gtag('config', GA_ID);
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(s);
    }
    function whenIdle() {
        if ('requestIdleCallback' in window) requestIdleCallback(loadAnalytics, { timeout: 3000 });
        else setTimeout(loadAnalytics, 1200);
    }
    function whenLoaded() {
        if (document.readyState === 'complete') whenIdle();
        else window.addEventListener('load', whenIdle, { once: true });
    }
    if (document.prerendering) document.addEventListener('prerenderingchange', whenLoaded, { once: true });
    else whenLoaded();
})();
