/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_PUBLIC_* vars are inlined automatically from .env.local, so they do not
  // need to be repeated here. Both consumers supply their own fallback:
  // NEXT_PUBLIC_PAYHUB_CONTRACT in src/lib/wallet.js, NEXT_PUBLIC_ARBITER_TOKEN
  // in src/app/demo/page.jsx.
};
module.exports = nextConfig;
