/**
 * Thin live-side of Shopify connect: register the orders/create webhook after a
 * successful OAuth so sales flow in on their own. Kept out of shopify.ts so the
 * pure helpers there stay network-free and fixture-testable.
 */

const SHOPIFY_API_VERSION = "2024-10";

export async function registerOrdersWebhook(
  shop: string,
  accessToken: string,
  callbackUrl: string,
): Promise<void> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      webhook: { topic: "orders/create", address: callbackUrl, format: "json" },
    }),
  });
  if (!res.ok) {
    throw new Error(`webhook register failed: ${res.status}`);
  }
}
