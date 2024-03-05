let text = ["Web Developer!", "Programmer!", "Data Analyst!", "Problem Solver!", "Creative!"];

function typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode) {
    const element = document.getElementById('typedText');
    const currentText = textArray[arrayIndex];
    let characters = [...currentText];

    if (deleteMode) {
        if (charIndex >= 0) {
            element.innerHTML = characters.slice(0, charIndex).join('');
            charIndex--;
            setTimeout(function () {
                typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode);
            }, speed);
        } else {
            const nextIndex = (arrayIndex + 1) % textArray.length;
            setTimeout(function () {
                typeWriter(textArray, nextIndex, 0, speed, false);
            }, 500);
        }
    } else {
        if (charIndex <= characters.length) {
            element.innerHTML = characters.slice(0, charIndex).join('');
            charIndex++;
            setTimeout(function () {
                typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode);
            }, speed);
        } else {
            setTimeout(function () {
                typeWriter(textArray, arrayIndex, charIndex, speed, true);
            }, 500);
        }
    }
}

var typingSpeed = 100; // in milliseconds
typeWriter(text, 0, 0, typingSpeed, false);



        document.addEventListener("DOMContentLoaded", function () {
            var menuButton = document.getElementById("menu-button");
            var menuLinks = document.getElementById("menu-links");

            menuButton.addEventListener("click", function () {
                menuLinks.classList.toggle("visible");
            });
        });
