let text = ["Systems Analyst.", "Web Developer.", "Problem Solver.", "Data Analyst.", "Creative."];

function typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode) {
    const element = document.getElementById('typedText');
    const currentText = textArray[arrayIndex];
    let characters = [...currentText];

    if (deleteMode) {
        if (charIndex >= 0) {
            element.innerHTML = characters.slice(0, charIndex).join('');
            charIndex--;
            setTimeout(function () { typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode); }, speed);
        } else {
            const nextIndex = (arrayIndex + 1) % textArray.length;
            setTimeout(function () { typeWriter(textArray, nextIndex, 0, speed, false); }, 500);
        }
    } else {
        if (charIndex <= characters.length) {
            element.innerHTML = characters.slice(0, charIndex).join('');
            charIndex++;
            setTimeout(function () { typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode); }, speed);
        } else {
            setTimeout(function () { typeWriter(textArray, arrayIndex, charIndex, speed, true); }, 1200);
        }
    }
}

typeWriter(text, 0, 0, 80, false);

document.addEventListener("DOMContentLoaded", function () {
    // Mobile menu toggle
    var menuButton = document.getElementById("menu-button");
    var menuLinks = document.getElementById("menu-links");
    if (menuButton && menuLinks) {
        menuButton.addEventListener("click", function () {
            menuLinks.classList.toggle("hidden");
        });
    }

    // Scroll reveal with IntersectionObserver
    var reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var el = entry.target;
                    var parent = el.parentElement;
                    var siblings = parent ? Array.from(parent.children).filter(function (c) { return c.classList.contains('reveal'); }) : [];
                    var index = siblings.indexOf(el);
                    el.style.animationDelay = Math.min(index * 0.08, 0.4) + 's';
                    el.classList.add('visible');
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.01, rootMargin: '0px 0px 200px 0px' });
        reveals.forEach(function (el) { observer.observe(el); });
    } else {
        reveals.forEach(function (el) { el.classList.add('visible'); el.style.animationDelay = '0s'; });
    }
});
