/**
 * Meta organic publishing — posts to the customer's own Page + Instagram using
 * the page token stored by the OAuth connect flow. This is what makes the
 * self-serve posting lane run on YOUR integration instead of a paid middleman.
 *
 * Facebook: one call to /{pageId}/feed (text) or /photos (with image).
 * Instagram: two calls — create a media container, then publish it (IG needs
 * an image/video, so a text-only post skips IG).
 * Pure param builders are fixture-tested; the calls are thin.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
const GRAPH = "https://graph.facebook.com/v21.0";

export interface PublishInput {
  message: string;
  link?: string;
  imageUrl?: string;
}

/** Pure: Facebook params — a photo post when an image is present, else a link/text post. */
export function buildFacebookParams(input: PublishInput): {
  endpoint: "photos" | "feed";
  params: Record<string, string>;
} {
  if (input.imageUrl) {
    const params: Record<string, string> = { url: input.imageUrl };
    if (input.message) params.caption = input.message;
    return { endpoint: "photos", params };
  }
  const params: Record<string, string> = { message: input.message };
  if (input.link) params.link = input.link;
  return { endpoint: "feed", params };
}

async function post(url: string, params: Record<string, string>): Promise<{ id: string }> {
  const res = await fetchWithTimeout(url, { method: "POST", body: new URLSearchParams(params) });
  const data = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } };
  if (data.error) throw new Error(`Meta publish: ${data.error.message ?? "error"}`);
  const id = data.id ?? data.post_id;
  if (!id) throw new Error("Meta publish: no id returned");
  return { id };
}

export async function publishToFacebook(
  pageId: string,
  pageToken: string,
  input: PublishInput,
): Promise<{ postId: string }> {
  const { endpoint, params } = buildFacebookParams(input);
  const { id } = await post(`${GRAPH}/${pageId}/${endpoint}`, {
    ...params,
    access_token: pageToken,
  });
  return { postId: id };
}

export async function publishToInstagram(
  igId: string,
  token: string,
  input: { caption: string; imageUrl: string },
): Promise<{ postId: string }> {
  if (!input.imageUrl) throw new Error("Instagram requires an image or video");
  const container = await post(`${GRAPH}/${igId}/media`, {
    image_url: input.imageUrl,
    caption: input.caption ?? "",
    access_token: token,
  });
  const published = await post(`${GRAPH}/${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  return { postId: published.id };
}
