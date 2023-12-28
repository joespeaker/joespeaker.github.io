
let text = ["Web Developer!", "Programmer!", "Data Analyst!", "Problem Solver!", "Creative!"];
 // Function to create typewriter effect with typing and backspacing
 function typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode) {
    const element = document.getElementById('typedText');
    const currentText = textArray[arrayIndex];

    if (deleteMode) {
      // Backspacing
      if (charIndex >= 0) {
        element.innerHTML = currentText.substring(0, charIndex);
        charIndex--;
        setTimeout(function() {
          typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode);
        }, speed);
      } else {
        // Switch to typing mode after backspacing is complete
        const nextIndex = (arrayIndex + 1) % textArray.length;
        setTimeout(function() {
          typeWriter(textArray, nextIndex, 0, speed, false);
        }, 500); // 500ms pause before typing the next string
      }
    } else {
      // Typing
      if (charIndex <= currentText.length) {
        element.innerHTML = currentText.substring(0, charIndex);
        charIndex++;
        setTimeout(function() {
          typeWriter(textArray, arrayIndex, charIndex, speed, deleteMode);
        }, speed);
      } else {
        // Switch to backspacing mode after typing is complete
        setTimeout(function() {
          typeWriter(textArray, arrayIndex, charIndex, speed, true);
        }, 500); // 500ms pause before backspacing
      }
    }
  }

  // Your list of texts and typing speed (adjust as needed)
  var typingSpeed = 100; // in milliseconds

  // Start the typewriter effect with the first string in the list
  typeWriter(text, 0, 0, typingSpeed, false);