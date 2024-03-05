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
    let link = document.getElementsByTagName("a");
    let text = document.getElementsByClassName("text-primary");
    let p = document.getElementsByTagName("p");
    let h2 = document.getElementsByTagName("h2");
    let h3 = document.getElementsByTagName("h3");
    let li = document.getElementsByTagName("li");
    let dont = document.getElementsByClassName("no");
    let kinda = document.getElementsByClassName("kinda")
    if(darkmode == 0) {
        bg.classList.add("document");
        for(let i = 0; i < link.length; i++){
            link[i].classList.add("darkmode");
            link[i].classList.add("underline1")
            link[i].classList.remove("underline")
        }
        for(let i = 0; i < text.length; i++){
            text[i].classList.add("darkmode");
        }
        for(let i = 0; i < p.length; i++){
            p[i].classList.add("darkermode");
        }
        for(let i = 0; i < h2.length; i++){
            h2[i].classList.add("darkermode");
        }
        for(let i = 0; i < h3.length; i++){
            h3[i].classList.add("darkermode");
        }
        for(let i = 0; i < li.length; i++){
                li[i].classList.add("darkmode");
        }
        for(let i = 0; i < dont.length; i++){
            if(dont[i].getElementsByClassName("darkmode")){
                dont[i].classList.remove("darkmode");
            }
        }
        for(let i = 0; i < kinda.length; i++){
            if(kinda[i].getElementsByClassName("underline1")){
                kinda[i].classList.remove("underline1");
            }
        }
        darkmode++;
    } else {
        bg.classList.remove("document");
        for(let i = 0; i < link.length; i++){
            link[i].classList.remove("darkmode");
            link[i].classList.remove("underline1")
            link[i].classList.add("underline")
        }
        for(let i = 0; i < text.length; i++){
            text[i].classList.remove("darkmode");
        }
        for(let i = 0; i < p.length; i++){
            p[i].classList.remove("darkermode");
        }
        for(let i = 0; i < h2.length; i++){
            h2[i].classList.remove("darkermode");
        }
        for(let i = 0; i < h3.length; i++){
            h3[i].classList.remove("darkermode");
        }
        for(let i = 0; i < h3.length; i++){
            h3[i].classList.remove("darkermode");
        }for(let i = 0; i < li.length; i++){
            li[i].classList.remove("darkmode");
        }
        for(let i = 0; i < kinda.length; i++){
            if(kinda[i].getElementsByClassName("underline")){
                kinda[i].classList.remove("underline");
            }
        }
        darkmode--;
    }
}

$(document).on("scroll", function() {
    var pageTop = $(document).scrollTop();
    var pageBottom = pageTop + $(window).height();
    var tags = $(".tag");
  
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      if ($(tag).position().top < pageBottom) {
        $(tag).addClass("visible");
      } else {
        $(tag).removeClass("visible");
      }
    }
  });
