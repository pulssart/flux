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
  // Ignore les modules natifs comme 'canvas' en environnement serverless (Netlify)
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // Remplace toute tentative d'import de 'canvas' par un module vide
      canvas: false as unknown as string,
    };
    return config;
  },
};

export default nextConfig;
