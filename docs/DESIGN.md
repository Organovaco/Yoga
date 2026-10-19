# Design notes

**Idea:** calm and unhurried, built around one memorable moment: a slow breathing orb on the home page (4s in, 6s out). Everything else stays quiet.

**Colour:** Ink `#17262B`, Lagoon `#1F6F78` (actions), Mist `#E8F1F0` (surfaces), Paper `#F8FBFA` (background), Marigold `#F0B429` (focus rings and small highlights). A dark theme follows the system setting.
**Type:** Bricolage Grotesque for headings, Figtree for body text. Body 17px, line length about 62 characters.
**Voice:** plain, sentence case, buttons say exactly what happens ("Create account", "Pay by card").
**Brand:** "Stillwater Yoga" is a placeholder. Change `BRAND` in `wrangler.toml` and the logo/favicon in `public/`.

## Accessibility checklist (built in)
- Skip link, landmarks, one h1 per view, focus moves to the heading on every page change, page title updates, live-region announcement.
- Visible 3px focus ring, 48px minimum touch targets, labelled form fields with autocomplete hints and inline errors (`role="alert"`).
- Text contrast meets WCAG AA in light and dark themes; colour is never the only signal.
- `prefers-reduced-motion` stops the breathing animation. Native video controls (keyboard accessible).
- To do before launch: add captions (`<track kind="captions">`) to every class video, and run a screen-reader pass (VoiceOver, NVDA).

## Pages
Home, Classes (filter by level, style, length), Class (player or locked state), Membership (Stripe + PayPal), Sign in / Create account, Account, Welcome (payment confirmation).
