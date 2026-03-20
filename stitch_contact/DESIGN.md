# Design System Strategy: The Kinetic Architect

## 1. Overview & Creative North Star
**Creative North Star: "The Kinetic Architect"**
This design system moves beyond the "static resume" by treating digital space as a living, architectural blueprint. It is defined by high-contrast precision, expansive whitespace, and a sophisticated interplay between deep void (`background`) and vibrant, neon-infused data points. 

To break the "template" look, we employ **Intentional Asymmetry**. For example, a hero section might feature a `display-lg` headline anchored to the far left, while the supporting `body-lg` text is pushed to a 12-column grid’s right-inner track. We utilize overlapping elements—such as a `primary` accented geometric pattern bleeding behind a `surface-container` card—to create a sense of three-dimensional depth and motion.

## 2. Colors & Surface Philosophy
The palette is a high-performance dark mode, utilizing `primary` (#aaffdc) and `secondary` (#669dff) as "light sources" against a cold, technical void.

*   **The "No-Line" Rule:** Direct structural separation must never use 1px solid borders. To separate a "Work Experience" section from "Education," shift the background from `surface` (#0a0e14) to `surface-container-low` (#0f141a). The eye should perceive change through tonal shifts, not "boxes."
*   **Surface Hierarchy & Nesting:** Treat the UI as layers of high-grade polycarbonate. 
    *   *Level 0:* `surface-dim` (Background)
    *   *Level 1:* `surface-container` (Main content areas)
    *   *Level 2:* `surface-container-highest` (Interactive cards/modals)
*   **The "Glass & Gradient" Rule:** Floating navigation or "Quick View" widgets must use Glassmorphism. Apply `surface-variant` at 60% opacity with a `20px` backdrop-blur. 
*   **Signature Textures:** Main CTAs should not be flat. Use a subtle linear gradient from `primary` (#aaffdc) to `primary_dim` (#00edb4) at a 135-degree angle to provide a "lit" technological glow.

## 3. Typography: Editorial Precision
The system pairs the technical sharpness of **Space Grotesk** with the humanistic clarity of **Manrope**.

*   **Display & Headlines (Space Grotesk):** These are your architectural anchors. Use `display-lg` for your name or key impact metrics. The bold, stylized nature of Space Grotesk communicates innovation. Use tight letter-spacing (-0.02em) for a "locked-in" professional look.
*   **Body & Labels (Manrope):** All functional information—descriptions, dates, and lists—uses Manrope. This provides a readable contrast to the "loud" headings. 
*   **Visual Hierarchy:** Establish a "70/30" weight ratio. 70% of the page should feel light and airy (generous line heights in `body-lg`), while 30% feels dense and authoritative (bold `headline-sm` for section titles).

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are too "organic" for this tech-forward aesthetic. We use **Tonal Layering** to define space.

*   **The Layering Principle:** To lift a "Project Card," do not use a shadow. Instead, place a `surface-container-high` card on a `surface` background. The subtle increase in brightness creates a perceived lift.
*   **Ambient Shadows:** If a floating element (like a mobile FAB) requires a shadow, use a large `48px` blur with 6% opacity, using the `secondary` (#669dff) color as the shadow tint. This mimics a blue-toned light reflecting off a dark surface.
*   **The "Ghost Border" Fallback:** For accessibility in form inputs, use the `outline-variant` (#44484f) at **15% opacity**. This provides a "hint" of a container without breaking the expansive, borderless feel.

## 5. Components

### Buttons
*   **Primary:** Gradient of `primary` to `primary_dim`. Text in `on_primary_fixed` (Deep Green). 0.25rem (`DEFAULT`) roundedness.
*   **Secondary:** Ghost style. No background, `outline` border at 20% opacity, text in `secondary`.
*   **Interaction:** On hover, a Primary button should trigger a `4px` "glow" using the `primary` color at 30% opacity.

### Cards & Experience Items
*   **Strict Rule:** No dividers. Separate job titles from descriptions using `spacing-4` (1.4rem) of whitespace.
*   **Layout:** Use `surface-container-low` for the card body. On hover, transition the background to `surface-container-high` and shift the `primary` accent icon `4px` to the top-right.

### Chips (Skills & Tech Stack)
*   **Style:** `surface-container-highest` background with `label-md` text in `on_surface_variant`. 
*   **Shape:** Use `full` (pill) roundedness for a modern, fluid feel that contrasts against the sharp typography.

### Input Fields
*   **State:** Default state is a `surface-container-lowest` block. On focus, the bottom edge gains a `2px` "underline" of `secondary` (#669dff) and the background shifts to `surface-variant`.

## 6. Do’s and Don’ts

### Do:
*   **Do** use `spacing-16` or `spacing-20` for section margins. This design system lives and breathes through "uncomfortable" amounts of whitespace.
*   **Do** use `secondary_container` (#005bc0) for subtle backgrounds behind `tertiary` (#74e0ff) text to create high-contrast "Power Tags."
*   **Do** incorporate "Data-Viz" elements—small geometric patterns using the `outline` token at 10% opacity to fill large empty voids behind text.

### Don’t:
*   **Don’t** use pure white (#ffffff) for text. Use `on_surface` (#f1f3fc) to reduce eye strain in dark mode.
*   **Don’t** use standard 1px borders to separate content. If you feel the need for a line, use a background color shift instead.
*   **Don’t** center-align long blocks of text. Stick to a sophisticated, left-aligned editorial grid to maintain the "Architect" feel.