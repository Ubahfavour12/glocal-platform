#!/usr/bin/env node
/**
 * Generate the two secrets the founder console needs.
 *
 * NO LONGER THE USUAL ROUTE. Enrolment happens in the browser now, at
 * /ops/enrol, from whatever device is to hand -- this script existed when the
 * seed could only live in an environment variable, and that turned out to
 * mean "you can only set up security from one specific laptop", which is how
 * the console ended up unusable the first time it was wanted.
 *
 * Kept for the case it is still good for: pre-seeding the environment
 * variables deliberately, or re-enrolling after a reset without using the
 * page.
 *
 * Run LOCALLY, paste the values into Vercel, and close the terminal. They are
 * printed here and stored nowhere: not in the repo, not in a file, not in any
 * chat. That is the point -- a TOTP secret that has been pasted into a
 * conversation or committed to a branch is a second factor in name only.
 *
 *   node scripts/ops-secrets.mjs
 */
import { randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 random bytes as base32, which is what authenticator apps expect. */
function base32Secret(bytes = 20) {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const totpSecret = base32Secret();
const sessionSecret = randomBytes(32).toString("base64url");
const account = process.argv[2] ?? "founder";
const issuer = "Glocal";
const uri =
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
  `?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

console.log(`
Add these two to Vercel (Project -> Settings -> Environment Variables,
Production), then redeploy:

  ADMIN_TOTP_SECRET     ${totpSecret}
  ADMIN_SESSION_SECRET  ${sessionSecret}

Then add the first one to your authenticator app. Either scan a QR made from
this URI, or choose "enter a setup key" and type the secret above:

  ${uri}

Check it worked before you rely on it: the app should show a 6-digit code that
changes every 30 seconds, and /ops/unlock should accept it.

Both values are shown once and saved nowhere. If you lose ADMIN_TOTP_SECRET,
run this again and re-enrol. If you change ADMIN_SESSION_SECRET, every open
console session is signed out immediately -- which is also how you revoke one.
`);
