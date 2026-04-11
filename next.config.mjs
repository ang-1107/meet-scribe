/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    },
    serverComponentsExternalPackages: [
      "playwright",
      "playwright-extra",
      "puppeteer-extra-plugin-stealth",
      "puppeteer-extra-plugin",
      "clone-deep",
      "merge-deep",
      "@xenova/transformers",
      "onnxruntime-node",
      "sharp",
      "js-yaml"
    ]
  }
};

export default nextConfig;