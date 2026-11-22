# Design research: what we took, and what we refused

Seven references, studied by opening them, interacting with them and reading how they are built. For each: what it does, which part is worth taking, and what is deliberately left behind. The last section turns that into rules for the two places the work lands: the public landing page, and the app people sign in to.

The one hard line: **scroll-driven storytelling belongs on the landing page and nowhere else.** The landing page is read once, top to bottom, by someone deciding whether to care. The app is used, repeatedly, by someone who needs to find a car, read a number and act. An element that moves when the page scrolls, or that waits to be scrolled to, is in the way there. Inside the app, motion answers an action (a click, a hover, a key) and finishes in well under half a second.

## The four sites

### Kivo (kivoagentic.ai): show the product working, not a picture of it

- **What it does.** The hero *is* a running product: tabs for four domains, and under them a live execution trace, where each agent shows Think, Pick the tool, Execute, with real-looking tool names (`catalog.search`). Below that, an analytics panel whose KPIs are the product's real outputs. The page never describes the product; it plays it.
- **Take.** The trace-as-hero idea, and tool names as proof. We already ship this (`site/LiveRun.jsx`).
- **Take next.** Make the *app* feel the same way: when an owner or an operator starts an agent run, show the same think / tool / result trace, live, instead of a spinner.
- **Refuse.** The long scroll to explain agents. Kivo needs it; our product is one story (a warning becomes a repair) and does not.

### Badgey (badgey.marcoluthi.com): objects you can pick up

- **What it does.** A calm, near-white page with one huge phrase ("Wear your name.") and badges that hang and swing around it, so the product's physical metaphor is felt before it is read. The phone is a pinned device whose contents flip as you scroll. Restraint everywhere: one idea per screen, no chrome.
- **Take.** Physicality. Things on the page have weight: they follow the pointer, can be dragged, and settle on a spring. We use it for the sensor cards around our hero: draggable, springy, and each one real (a reading a car actually reports).
- **Take.** The restraint. One claim per screen.
- **Refuse.** The pinned, scroll-flipped device as a pattern for anything interactive. It is lovely to watch and impossible to use.

### Congrue (congrue.ai): prove it with a toggle

- **What it does.** Charcoal background, one electric lime accent, monospace micro-labels ("ONE JOB"), hairline vertical rules framing the page like a drawing sheet. The proof is a table with a **BY HAND / WITH CONGRUE** switch: flip it and the quote total counts up from one line item to the whole system. The visitor does the persuading.
- **Take.** The before/after switch with a number that moves. It is the strongest idea in the set, and it maps exactly onto ours: what waiting costs against what fixing early costs. We build it as a real calculator on our own repair-versus-breakdown figures.
- **Take.** Hairline frame rules, mono micro-labels, segmented filter chips.
- **Refuse.** Dark-only, and the lime. Our palette stays daylight with real colour on the landing page, and tone-based (green, amber, red) in the app, where colour carries meaning.

### SimpleSketche (simplesketche.nyc): the page as an experience

- **What it does.** A loader that is a brand moment (an ink drop and a bilingual percentage counter), then a drag-to-explore canvas with "drag | scroll" as its only instruction.
- **Take.** Almost nothing. One idea: the loading state can have character. Our app's loading state gets a small, quick mark animation instead of grey blocks alone.
- **Refuse.** Everything else. It is an art piece: slow to load (it was still loading ten seconds in), and it hides its content behind exploration. A service customer in a car park will not tolerate either.

## The three libraries

These are catalogues of single interactions, not designs. We use them as a parts bin and rewrite each part on our own tokens, with `prefers-reduced-motion` respected, rather than pasting them in.

### React Bits

Taken: **Spotlight Card** (cursor-following glow; already in `fx/spotlight.js`), **Magnet** (`fx/Magnetic.jsx`), **Count Up**, **Animated List** (rows that animate in and re-order), **Tilted Card**, **Border Glow**, and from its "Micro" set **Hold Button**, **Swipe Toast** and **Slide Commit** (confirmation by effort, for actions that must not be an accident).
Refused: the shader and cursor-takeover backgrounds (Splash Cursor, Ripple Distortion, Liquid Ether). Striking, expensive, and they fight the content.

### Magic UI

Taken: **Number Ticker**, **Border Beam** (a light that travels the edge of the one thing that is live), **Animated Beam** (a line that pulses between nodes, for the team-lead-to-helpers diagram), **Bento Grid**, **Animated List**, **Shimmer Button**, **Marquee**.
Refused: Globe, Meteors, Confetti, Particles, Icon Cloud: decoration with no information in it.

### Uiverse

Taken: nothing wholesale; it is user-submitted CSS of uneven quality. Taken as a reminder that the best small touches are pure CSS: a switch that squishes, a button that sinks when pressed, a loader made of the brand mark. Those are cheap, accessible and always on.

## What this means for the product

### The landing page (read once, scroll allowed)

1. **A calculator, not a claim.** "What waiting costs": choose a part, move how long you ignore the warning, flip *Fix it early / Wait for the breakdown*, and the rupee total, a bar and a countdown move. Figures are the real repair and breakdown costs the product quotes. (Congrue's switch, our data.)
2. **Objects with weight in the hero.** Sensor cards around the headline that can be dragged and settle on a spring (Badgey). Decorative to a screen reader; the same facts appear as text.
3. **Proof of the team as a diagram.** An animated beam from the team lead to each helper, with a helper's allowed and refused actions on hover (Magic UI's Animated Beam, with our permissions as the content).
4. **A frame and a voice.** Hairline gutter rules and mono micro-labels give the page the look of a spec sheet (Congrue) without changing the daylight palette.
5. **The running product stays the hero** (Kivo), with a travelling beam on the card to say "live".

### The owner app (used when something needs deciding, no scroll effects)

Scope: **car owners only.** The staff consoles (fleet, service operations, plant quality, security, in-car) are left exactly as they are; this pass is about the one person who opens the app to decide one thing about one car.

The test for every addition: *does it change what the owner can understand or do, or only how it looks?* Looks alone is not enough.

1. **Let them try the decision.** On the warning card, "What if I wait?": a switch between *Fix it now* and *Wait*, and a slider for how long. The rupee total, the saving and a bar move as they do. The owner reaches the conclusion themselves instead of reading our claim. (Congrue's switch, our data.)
2. **Readings you can open.** Each reading (oil pressure, battery, coolant...) opens to its value, what normal looks like and a trend sentence, with a sparkline you can scrub with a finger or the arrow keys.
3. **Evidence you can read off.** The chart on "Why this part?" has a crosshair that follows the pointer or the keyboard, shows the exact reading and time, and a range switch (last 6 hours / 24 hours).
4. **A visit is a card you can open.** Service history rows expand to show what was replaced and what it cost.
5. **A booking you can take with you.** Add it to a calendar (a standard file, made in the browser), open the route in a map, copy the booking number. Each answers with a short toast.
6. **Feedback that arrives where the thumb is.** Toasts for small results ("Booking number copied"), a loading mark with character, and buttons that visibly sink when pressed.
7. **The assistant stays the one place to ask.** Everything above that could raise a question links to it ("Ask about this reading").

### What stays out, on purpose

No scroll-triggered reveals in the app. No parallax. No full-screen shaders or cursor takeovers. No animation longer than about 450 ms in the app, and nothing that blocks the next click. Colour keeps its meaning in the app (red, amber, green are states, not decoration). Everything honours `prefers-reduced-motion`, works with the keyboard and with a screen reader, and uses the type scale and tokens the guard tests enforce.
