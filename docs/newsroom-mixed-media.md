# Bounded mixed-media newsroom execution

The existing staging queue/worker accepts an optional `mixed_brief` (`newsroom-mixed-brief/v1`). A brief supplies primary source URLs, source asset URLs/descriptions and story-specific editorial constraints. It is not a layout template. The normal discovery pilot and original image runner are unchanged.

`produceMixed` fetches bounded public sources and media, records source hashes, extracts video metadata/stills, asks the subscription-authenticated Codex composer for distinct SVG compositions and timed video windows, and renders them using existing Sharp/FFmpeg. No API key, new rendering service or Canva editor session is required. The current proof uses an operator-researched source inventory: fully autonomous broad video discovery is not claimed.

Video windows are numeric, bounded and rendered at original speed. The model cannot supply shell commands or arbitrary file references. Source IDs and perceptual comparisons reject repeated source images. Every video is decoded and sampled across its complete duration. A different Codex model reviews phone-size images, complete video timelines and original source assets; this is a creative-review gate, not Daniel's approval or independent product testing. The operator must still inspect real playback for this first validation.

Final PNG/JPEG/MP4 outputs retain exact order, hashes, source association, duration, MIME type and evidence. The existing private staging completion route creates the immutable candidate and sends the scoped review email. No publication binding or rights clearance is granted by this worker. Original and derived source metadata remains in the private evidence archive. Existing review/outbox authorization is unchanged.

Configuration: `FFMPEG_BIN`, existing official `NEWSROOM_CODEX_BIN`/ChatGPT login, optional `NEWSROOM_QA_MODEL` (default `gpt-6-astra`, independent from default composer `gpt-6.1-sol`). Original worker credentials and hosted staging flag apply. The spare Mac must be installed/logged in before unattended spare-Mac operation can be claimed.

Canva preflight (2026-10-08): current Autofill documentation includes Pro eligibility and preview video fields; this does not authorize BrainOS. Neither the connected NEO design nor inspected brand template exposed fillable dataset fields. No Canva runtime OAuth credentials are configured in BrainOS/Vercel. No successful upload/autofill/export run is claimed. Existing FFmpeg/Sharp avoids introducing that dependency. Remotion was evaluated but not installed for simple source-video compositing; its company-license conditions are distinct from permissive MIT dependencies.

DVNI visual grammar remains unfrozen. A successful technical/automated review does not establish Daniel's aesthetic approval.
