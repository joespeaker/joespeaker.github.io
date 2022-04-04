/*!
 * Start Bootstrap - Resume v7.0.5 (https://startbootstrap.com/theme/resume)
 * Copyright 2013-2022 Start Bootstrap
 * Licensed under MIT (https://github.com/StartBootstrap/startbootstrap-resume/blob/master/LICENSE)
 */
//
// Scripts
// 


window.addEventListener('DOMContentLoaded', event => {

    // Activate Bootstrap scrollspy on the main nav element
    const sideNav = document.body.querySelector('#sideNav');
    if (sideNav) {
        new bootstrap.ScrollSpy(document.body, {
            target: '#sideNav',
            offset: 74,
        });
    };

    // Collapse responsive navbar when toggler is visible
    const navbarToggler = document.body.querySelector('.navbar-toggler');
    const responsiveNavItems = [].slice.call(
        document.querySelectorAll('#navbarResponsive .nav-link')
    );
    responsiveNavItems.map(function(responsiveNavItem) {
        responsiveNavItem.addEventListener('click', () => {
            if (window.getComputedStyle(navbarToggler).display !== 'none') {
                navbarToggler.click();
            }
        });
    });

});

let darkmode = 0;
function darkMode() {
    let bg = document.getElementById("page-top");
    let link = document.getElementsByTagName("a")
    let text = document.getElementsByClassName("text-primary");
    let nav = document.getElementsByClassName("nav-link");
    if(darkmode == 0) {
        bg.classList.add("document");
        for(let i = 0; i < link.length; i++){
            link[i].classList.add("darkmode");
        }
        for(let i = 0; i < nav.length; i++){
            if(nav[i].getElementsByClassName("darkmode")){
                nav[i].classList.remove("darkmode");
            }
        }
        for(let i = 0; i < text.length; i++){
            text[i].classList.add("darkmode");
        }
        darkmode++;
    } else {
        bg.classList.remove("document");
        for(let i = 0; i < link.length; i++){
            link[i].classList.remove("darkmode");
        }
        for(let i = 0; i < text.length; i++){
            text[i].classList.remove("darkmode");
        }
        darkmode--;
    }
}

