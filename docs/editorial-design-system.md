# BrainOS editorial design system

A paper workspace with a charcoal navigation rail and a restrained mineral-green accent. The public DVNI surface shares the visual language but only reads approved public records. Daniel remains the creator; the typographic DVNI mark/favicon is a design draft for his review.

## Typography and tokens

Newsreader variable serif for editorial headlines; Manrope variable sans for UI and body; IBM Plex Mono for IDs, timestamps and provenance. Latin WOFF2 files cover Spanish and English, are vendored with SIL OFL licenses, and loaded through `next/font/local`. Font variables live on the root HTML element so semantic tokens inherit correctly. No external font request or build-time font download is needed. Monospace is not preloaded.

`src/app/design-system.css` owns semantic surfaces, four text levels, borders, status colors, type scale, spacing, radii, shadows, motion, layout and stacking tokens. It maps established component variables to the system so legacy form and approval contracts remain intact. `globals.css` retains existing structural layouts. A single excellent paper theme is intentional; there is no fragile theme toggle.

## Components and motion

`components/design` provides native controls, five button treatments, status chips, field groups, action bars, notices and the draft mark. Native form names, values, submission handlers and confirmation requirements are retained. The desktop rail has Editorial, Creation and Workspace groups; mobile uses a native modal drawer with an explicit keyboard loop and a three-action dock. One semantic main landmark owns the skip-link target.

Page/list/status/disclosure entrances use short CSS opacity/transform animations. Editorial scroll reveals use one IntersectionObserver per surface, disconnect after entry/unmount, and keep content visible without JavaScript. Internal forms have no scroll reveals. Reduced-motion removes all nonessential animation and shows all content.

## Connection versus capability

A verified provider account shows Connected even when publishing is provider-limited. YouTube scoped uploads are labelled Private upload while `YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY` remains intact. beehiiv reads/analytics are separate from `BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED`. Send authorization is independently displayed and still requires account consent plus final-approved content and delivery confirmation. Raw IDs/codes are available in technical details. X recovery state is displayed without modifying or connecting an account.

## Verification boundaries

Browser tests cover real-state fixtures, unchanged consent payloads, keyboard drawer behavior, reduced motion, fonts, public/private separation and 390/768/desktop layouts. Original editorial, rights, immutable outbox, exact revision, production, discovery and media-worker tests remain. Hosted QA uses authenticated read-only page and health requests; actual release/recording mutations are tested only with local fixtures. No production promotion, social post, media upload, email or paid service is part of this design pass.
