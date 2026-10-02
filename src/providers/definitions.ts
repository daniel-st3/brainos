import type { Provider } from "../control/model";
export const providerVersion = "2026-10-02/v1";
export const definitions = {
  instagram: {
    version: "v25.0",
    auth: "https://www.instagram.com/oauth/authorize",
    token: "https://api.instagram.com/oauth/access_token",
    api: "https://graph.instagram.com/v25.0",
    scopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ],
    pkce: false,
    signup: "https://www.instagram.com/accounts/emailsignup/",
    bio: 150,
    title: 2200,
  },
  tiktok: {
    version: "v2",
    auth: "https://www.tiktok.com/v2/auth/authorize/",
    token: "https://open.tiktokapis.com/v2/oauth/token/",
    api: "https://open.tiktokapis.com/v2",
    scopes: [
      "user.info.basic",
      "user.info.profile",
      "video.list",
      "video.publish",
    ],
    pkce: false,
    signup: "https://www.tiktok.com/signup",
    bio: 80,
    title: 2200,
  },
  x: {
    version: "v2",
    auth: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    api: "https://api.x.com/2",
    scopes: [
      "tweet.read",
      "tweet.write",
      "users.read",
      "offline.access",
      "media.write",
    ],
    pkce: true,
    signup: "https://x.com/i/flow/signup",
    bio: 160,
    title: 280,
  },
  youtube: {
    version: "v3",
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    api: "https://www.googleapis.com/youtube/v3",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    pkce: true,
    signup: "https://www.youtube.com/create_channel",
    bio: 1000,
    title: 100,
  },
  beehiiv: {
    version: "v2",
    auth: "",
    token: "",
    api: "https://api.beehiiv.com/v2",
    scopes: [
      "publications:read",
      "posts:read",
      "posts:write",
      "subscriptions:read",
      "subscriptions:write",
    ],
    pkce: false,
    signup: "https://app.beehiiv.com/signup",
    bio: 500,
    title: 200,
  },
} satisfies Record<
  Provider,
  {
    version: string;
    auth: string;
    token: string;
    api: string;
    scopes: string[];
    pkce: boolean;
    signup: string;
    bio: number;
    title: number;
  }
>;
export function appConfig(p: Provider) {
  const prefix = p.toUpperCase(),
    clientId = process.env[`${prefix}_CLIENT_ID`],
    clientSecret = process.env[`${prefix}_CLIENT_SECRET`],
    origin = process.env.CONTENT_OS_ORIGIN;
  if (p === "beehiiv")
    throw Error(
      "beehiiv uses private API-key installation; no fabricated OAuth endpoint",
    );
  if (
    !clientId ||
    !clientSecret ||
    !origin ||
    new URL(origin).protocol !== "https:"
  )
    throw Error(
      `${p}: developer application credentials and stable HTTPS origin required`,
    );
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/providers/${p}/callback`,
  };
}
export function constraints(p: Provider) {
  return {
    version: providerVersion,
    title: definitions[p].title,
    caption:
      p === "instagram" || p === "tiktok"
        ? 2200
        : p === "x"
          ? 280
          : p === "youtube"
            ? 5000
            : 50000,
    mimes: ["video/mp4", "image/png", "image/jpeg"],
    shortVideoMax: p === "youtube" ? 180 : null,
  };
}
