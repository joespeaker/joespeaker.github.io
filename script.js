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
})();
