# Buffer mixed Instagram media — 2026-10-06

## Observed, without social publication

The [September 28 release](https://buffer.com/changelog/mixed-media-posts)
and [current Instagram overview](https://support.buffer.com/en-us/articles/using-instagram-with-buffer-YSjg2dXFV8)
support mixed image/video carousels. Older image-only help text is stale.
The [API contract](https://developers.buffer.com/types/CreatePostInput.html)
uses an ordered `assets` list; each child has one image or video variant.
Instagram metadata is `type: post`, not `reel` or `carousel`.

Read-only discovery verified the connected `dvni.ai` business channel. Its
experimental configuration query exposed only comment constraints, despite
posting authorization `ok`. Missing content rules are not proof of rejection.

Daniel explicitly authorized one private draft test and cleanup. With
`saveToDraft: true`, no due date, and automatic scheduling type, the real API
accepted the exact Ghost V2 source URLs: four-second 1080×1350 H264 MP4, then
two 1080×1350 PNGs. Read-back preserved the exact caption (including its final
newline) and source order. The result was `draft`, with null due/sent times
and permalink. Draft `6ac511030c0a17c2690ce53b` was deleted; a subsequent read
returned `NOT_FOUND`. No BrainOS approval or outbox dispatch occurred.

Buffer returned `VideoAsset`, `ImageAsset`, `ImageAsset`. Although it retained
the original PNG source URLs, its image MIME metadata was `image/jpeg`.
Original BrainOS objects/checksums remain unchanged. Do not promise that
Buffer/Instagram processing preserves encoded bytes. Temporary signed source
URLs were used only for this immediately deleted test, not scheduled delivery.

This proves draft acceptance, not a completed Instagram publication. Buffer
documents that drafts bypass posting-limit checks. No live publish test was
authorized or performed.

## Narrow adapter correction

`BufferPayload.carousel` is an explicitly ordered image/video list, scoped to
the Instagram Buffer adapter. It does not combine unordered legacy `media`
and `media_urls`; ambiguous input still fails. Each asset retains its checksum
and metadata. PNG is accepted on this path. Carousel children do not inherit
Reel-only 9:16/five-second constraints. Thumbnail offset zero selects the
existing first video frame without uploading/replacing a cover.

The conservative BrainOS carousel policy is 2–10 children, matching aspect
ratios, 4:5–1.91:1, width 320–1440, JPEG/PNG up to 8 MB, and H264 MP4 of 3–60
seconds up to 50 MB. These local limits are not an exhaustive statement of
Buffer's current capabilities. The exact tested clip is four seconds.
Stable delivery URL requirements, account identity, write authorization,
idempotency checkpoints and provider reconciliation are unchanged.

## Remaining publication boundaries

Imported Ghost V2 is still an immutable review-only candidate. The new adapter
input is not an authorization to enqueue that import. Its source rights remain
MEDIUM / UNCLEAR, clearance pending. Creative approval does not grant rights.
The existing imported-package outbox guard remains; production delivery still
needs the normal rights-cleared publication binding and durable provider media
URLs. No final-approval contract was weakened to make this test pass.

There is no media-format requirement for Daniel's Mac after hosted ingestion.
Private review/storage and hosted outbox execution are server-side. Rights and
publication binding, not a Mac worker, are the remaining blockers for Ghost V2.
