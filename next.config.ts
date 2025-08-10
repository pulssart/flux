import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "*" },
      { protocol: "https", hostname: "*" },
      // Common CDNs and domains for RSS images
      { protocol: "https", hostname: "i*.wp.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "miro.medium.com" },
      { protocol: "https", hostname: "*.*.cdn.*" },
    ],
  },
};

export default nextConfig;
