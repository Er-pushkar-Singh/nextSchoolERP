import type { MetadataRoute } from "next";

/** The family portal can be installed on a phone's home screen (parents and students). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "School — parents & students",
    short_name: "My school",
    description: "Fees, attendance, results, homework, leave and messages for parents and students.",
    start_url: "/family",
    scope: "/family/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6fb",
    theme_color: "#0b1b33",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
