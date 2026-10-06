import { ProviderError, type Payload } from "./client";

/** Explicit ordering prevents a video from becoming a Reel or a cover image. */
export type BufferCarouselAsset =
  | ({ kind: "image" } & NonNullable<Payload["images"]>[number])
  | ({ kind: "video" } & NonNullable<Payload["media"]>);
export type BufferPayload = Payload & { carousel?: BufferCarouselAsset[] };

/** Conservative delivery policy, not a claim to support every Buffer format.
 * Buffer's 2026-09-28 release supports mixed Instagram carousels. Its GraphQL
 * assets list preserves order and uses metadata.instagram.type = post.
 * https://buffer.com/changelog/mixed-media-posts
 * https://developers.buffer.com/types/CreatePostInput.html
 */
export function instagramCarousel(assets: BufferCarouselAsset[]) {
  if (assets.length < 2 || assets.length > 10)
    throw new ProviderError("BUFFER_CAROUSEL_COUNT_LIMIT");
  const first = assets[0];
  for (const asset of assets) {
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      !Number.isSafeInteger(asset.width) ||
      asset.width < 320 ||
      !Number.isSafeInteger(asset.height) ||
      asset.height <= 0 ||
      asset.width > 1440 ||
      asset.width / asset.height < 0.8 ||
      asset.width / asset.height > 1.91
    )
      throw new ProviderError("BUFFER_CAROUSEL_METADATA_INVALID");
    // Buffer crops children to the first item's ratio. Require matching inputs
    // so a BrainOS-approved composition never silently changes at dispatch.
    if (asset.width * first.height !== first.width * asset.height)
      throw new ProviderError("BUFFER_CAROUSEL_ASPECT_MISMATCH");
    if (asset.kind === "image") {
      if (
        !["image/jpeg", "image/png"].includes(asset.mime) ||
        asset.bytes > 8_000_000
      )
        throw new ProviderError("BUFFER_IMAGE_FORMAT_LIMIT");
    } else if (asset.kind === "video") {
      if (
        asset.mime !== "video/mp4" ||
        asset.codec !== "h264" ||
        asset.bytes > 50_000_000 ||
        !Number.isFinite(asset.duration) ||
        asset.duration < 3 ||
        asset.duration > 60
      )
        throw new ProviderError("BUFFER_CAROUSEL_VIDEO_POLICY_LIMIT");
    } else throw new ProviderError("BUFFER_CAROUSEL_ASSET_INVALID");
  }
  return assets.map((asset) =>
    asset.kind === "video"
      ? { video: { url: asset.url, metadata: { thumbnailOffset: 0 } } }
      : { image: { url: asset.url } },
  );
}
