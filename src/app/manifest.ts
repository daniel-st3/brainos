import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BrainOS",
    short_name: "BrainOS",
    description: "Daniel's human-led newsroom",
    start_url: "/actions",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1e9",
    theme_color: "#172b26",
    icons: [
      {
        src: "/app-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
