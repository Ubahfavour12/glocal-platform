import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * WHY HERE AND NOT A WAF. A real edge firewall needs either Vercel Pro (custom
 * rules are not on Hobby) or the domain plus Cloudflare, and we have neither
 * yet. These headers are the part that does not wait for either, costs nothing,
 * and closes the classes of attack a WAF would not have caught anyway: a WAF
 * filters requests coming IN, while these instruct the browser about what it is
 * allowed to do with the response going OUT.
 *
 * Every one of these is deliberately chosen. Headers copied from a blog post
 * tend to include ones that do nothing (X-XSS-Protection, retired and in some
 * browsers actively harmful) or ones that quietly break the app.
 */
const securityHeaders = [
  {
    // Never speak HTTP to us again, for two years, including subdomains.
    // Vercel already redirects, but a redirect happens AFTER a request has left
    // the device — on a hostile network that first plaintext request is the
    // whole attack. This removes it. Safe here because we have never served
    // anything over plain HTTP and never will.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // Stop the browser second-guessing Content-Type. This is the header that
    // turns "a file claiming to be a PNG" into a file TREATED as a PNG, which
    // is the other half of the upload hardening already done server-side.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Nobody may frame us. The app uses no iframes of its own, so this costs
    // nothing and removes clickjacking — an invisible overlay of our approve
    // or withdraw buttons on someone else's page.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Send the full URL only to ourselves. Our URLs carry smart-link codes and
    // business ids; leaking those to every site a customer clicks through to
    // is a quiet data leak nobody would notice.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Turn off device capabilities the app never asks for, so a future
    // compromised dependency cannot silently ask on our behalf.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

/**
 * Content Security Policy — REPORT ONLY, on purpose.
 *
 * CSP is the header most likely to break a working site: one missed domain and
 * images stop loading or the app stops rendering, with no error a customer
 * could report usefully. Report-Only applies the policy, reports what WOULD
 * have been blocked, and blocks nothing.
 *
 * `'unsafe-inline'` for scripts is here because layout.tsx sets the theme with
 * an inline script before paint, to avoid a flash of the wrong theme. The
 * correct fix is a per-request nonce, which needs the proxy to generate one on
 * every request. That is a real change with real risk and it belongs in its own
 * pass — noted rather than half-done.
 *
 * Enforcing it is a deliberate later step: watch the reports, confirm nothing
 * legitimate is caught, then rename this key to `Content-Security-Policy`.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Supabase Storage serves customer photos; data: covers inlined placeholders.
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  // The app talks to Supabase from the browser; everything else is server-side.
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Everything, including API routes and the public /px tracking pixel.
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
