Here is a detailed UI specification designed for an AI or frontend developer to recreate these two onboarding wizard screens pixel-by-pixel using modern UI frameworks (such as React, HTML/CSS, or Tailwind CSS).

---

## 1. Global Page Layout & Theme

* **Background Color**: `#F8F9FA` (Very light grey/off-white)
* **Font Family**: Sans-serif (`Inter`, `System UI`, or `Arial`)
* **Page Alignment**: Flexbox column, centered horizontally, `max-width: 800px` container.
* **Padding**: `32px` top/bottom, `16px` left/right.

---

## 2. Shared Component: Stepper Header

Located at the top of both screens, centered.

* **Progress Bar**:
* Connected by a horizontal gray line (`2px` height, color `#E0E0E0`, background behind step circles).
* `3` step indicators evenly spaced horizontally (`width: 300px` to `400px` total).


* **Step Circles**:
* Size: `36px x 36px` round circle with bold white text centered.
* **Active/Completed State (Green)**: Background `#00B856`, Text `1` or `2` in `#FFFFFF`.
* **Inactive State (Grey)**: Background `#E2E7EC`, Text `2` or `3` in `#FFFFFF`.


* **Step Labels** (Positioned directly under each circle):
* Font Size: `13px`, Font Weight: `700` (Bold), Color: `#333333`.
* Step 1: `Start`
* Step 2: `Preview`
* Step 3: `Finish`


* **Divider**: A full-width subtle line (`1px` height, color `#E5E8EC`) separates the stepper bar from the main card below.

---

## 3. Screen 1: "Start / Increase Page Speed" (Image 2)

### A. Stepper State

* **Step 1**: Active (Green circle `#00B856` with text `1`)
* **Step 2**: Inactive (Grey circle `#E2E7EC` with text `2`)
* **Step 3**: Inactive (Grey circle `#E2E7EC` with text `3`)

### B. Main Card Container

* **Background**: `#FFFFFF`
* **Border**: `1px solid #E5E8EC`
* **Border Radius**: `4px`
* **Padding**: `0px` outer, with internal section dividers.

### C. Main Card Content (Top to Bottom)

1. **Header Section**:
* **Text**: `Let's increase your page speed 😊`
* **Typography**: Size `24px`, Weight `700`, Color `#222222`, centered text with smiling emoji.
* **Padding**: `24px` top/bottom.
* **Bottom Border**: Light divider line (`1px solid #E5E8EC`).


2. **Callout Banner (Green Info Box)**:
* **Container**: `margin: 24px auto`, `max-width: 90%`, `padding: 16px 20px`, `background-color: #E8F8F0` (light mint/green).
* **Top Border**: `4px solid #00C853` (vibrant green accent border on top border edge).
* **Border Radius**: `4px` (bottom/left/right).
* **Layout**: Flexbox row, `align-items: flex-start`, `gap: 12px`.
* **Icon**: Green circle with a white/green checkmark icon (`✔`).
* **Text Content**:
* **Title**: `How is this app FREE when other apps charge $99 for this?` (Bold, `15px`, dark slate `#1E3A2B`).
* **Body**: `Since 2015, we've aimed to support the Shopify community and it's merchants as best as we can.` (Regular weight, `13px`, color `#4A5568`).




3. **Center Illustration**:
* **Graphic**: Minimalist rocket vector launching upward.
* **Rocket Color Palette**: Blue hull (`#3B82F6`), dark blue fins, white circle center badge, yellow/orange flame (`#F59E0B`), launching from light blue smoke/clouds (`#E0F2FE`) with small 4-point sparkle stars (`✨`) surrounding it.
* **Margin**: `32px auto 20px auto`, centered.


4. **Toggle Switch Section**:
* **Instruction Text**: `Improve the Speed of your Store and increase Conversions by switching this ON 👇`
* Font size: `16px`, color `#333333`, centered.
* Note: "ON" has a slight light-gray badge border or box background.


* **Toggle Switch Element**:
* Pill shape: `width: 60px`, `height: 30px`, `border-radius: 999px`, background color `#00C853` (Active green).
* Content: White text `"ON"` on the left side, white round knob (`24px x 24px`) slid to the right side.
* Margin: `16px auto`.




5. **Action CTA**:
* **Button Text**: `Continue ➔`
* **Typography**: Font size `22px`, Weight `700` (Bold), Color `#111827`.
* **Style**: Text-only button / clean link style centered at the bottom of the card with `margin-top: 32px`, `margin-bottom: 24px`.



---

## 4. Screen 2: "Preview / Test App" (Image 1)

### A. Stepper State

* **Step 1**: Active (Green circle `#00B856` with text `1`)
* **Step 2**: Active (Green circle `#00B856` with text `2`)
* **Step 3**: Inactive (Grey circle `#E2E7EC` with text `3`)

### B. Main Card Content (Top to Bottom)

1. **Header Section**:
* **Text**: `Preview your store to test the app`
* **Typography**: Size `24px`, Weight `700`, Color `#222222`, centered text.
* **Padding**: `24px` top/bottom.
* **Bottom Border**: Light divider line (`1px solid #E5E8EC`).


2. **Notice Banner (Yellow Warning Box)**:
* **Container**: `margin: 24px auto`, `max-width: 90%`, `padding: 16px 20px`, `background-color: #FFF9D6` (pale yellow/cream).
* **Top Border**: `4px solid #E2B000` or `#EAB308` (gold accent border on top border edge).
* **Border Radius**: `4px`.
* **Layout**: Flexbox row with top-left warning icon (`ⓘ` inside yellow circle).
* **Header Line**: `👉 IMPORTANT NOTICE 👈`
* Font Size: `15px`, Weight `800` (Extra bold), Color `#2D3748`.


* **Paragraph 1**: `This app preloads links to increase speed - ` **`IT WILL NOT HELP WITH SPEED SCORES`**
* Text in bold must be underlined and emphasized.


* **Paragraph 2**: `This app works on the ` **`SECOND`** ` page load. To see the app work, click a couple of links on your store and come back.`
* Word "SECOND" is bolded in all caps.


* **Paragraph 3**: `Your site will be faster but ` **`apps like Gmetrix or Google Page Speed won't show any increase or decrease in score.`**
* Ending phrase in bold.


* **Typography Details**: Font size `13px`, line height `1.6`, color `#4A5568`.


3. **Center Instruction Text**:
* **Text**: `Preview your Store and Come Back`
* **Style**: Centered text, font size `18px`, weight `500`, color `#333333`.
* **Margin**: `48px auto 48px auto`.



---

## 5. Page Footer (Present Below Card)

* **Layout**: Centered flexbox column, `margin-top: 40px`, `gap: 8px`.
* **Brand Logo**:
* Logo Icon: Circular dark grey icon containing a white rocket ship.
* Primary Text: `BOOSTER APPS` (Bold sans-serif, size `20px`, dark grey `#4A5568`).
* Secondary Text: `SKYROCKET YOUR SHOPIFY SALES` (Sub-heading in light grey outline/sans-serif font, size `11px`, all caps).


* **Social Proof Text**:
* `Proudly powering over 800,000 Shopify Stores. Made in Dublin, Ireland ☘️`
* Font size: `12px`, Color: `#718096`, Shamrock emoji at the end.


* **Footer Link**:
* `Terms of use`
* Font size: `12px`, Color: `#2B6CB0` (Blue), underlined on hover/default.