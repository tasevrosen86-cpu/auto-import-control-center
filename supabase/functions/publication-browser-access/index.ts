import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "npm:@supabase/server";

const ADMIN_EMAIL = "tasevrosen86@gmail.com";
const SITE_ORIGIN = "https://autoimportcontrolcenter.biz";
const cors = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });

function base64url(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode64url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function signingSecret() {
  // No client receives this. The platform supplies one of these server-only
  // variables; the JSON fallback is still private and only serves as HMAC key.
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || Deno.env.get("SUPABASE_SECRET_KEY")
    || Deno.env.get("SUPABASE_SECRET_KEYS")
    || "";
}
async function signature(payload: string) {
  const secret = signingSecret();
  if (!secret) throw new Error("Липсва вътрешен ключ за защитения браузърен достъп.");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validateTicket(ticket: string) {
  const [payload, sig, extra] = ticket.split(".");
  if (!payload || !sig || extra) return false;
  if (!same(await signature(payload), sig)) return false;
  let data: { uid?: unknown; exp?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(decode64url(payload))); } catch { return false; }
  return typeof data.uid === "string" && typeof data.exp === "number" && data.exp > Date.now();
}

export default {
  fetch: async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/validate")) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      try {
        const original = request.headers.get("x-original-uri") || url.pathname;
        const ticket = new URL(original, SITE_ORIGIN).searchParams.get("ticket") || "";
        return await validateTicket(ticket)
          ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
          : new Response("Forbidden", { status: 403 });
      } catch {
        return new Response("Access configuration unavailable", { status: 503 });
      }
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "Използвайте POST." }, 405);

    const { data: ctx, error } = await createSupabaseContext(request, { auth: "user" });
    if (error || !ctx?.userClaims?.id) return reply({ error: "Сесията е изтекла. Влезте отново в сайта." }, 401);
    if (ctx.userClaims.email?.toLowerCase() !== ADMIN_EMAIL) return reply({ error: "Само Admin може да отвори браузъра." }, 403);

    try {
      const payload = base64url(new TextEncoder().encode(JSON.stringify({
        uid: ctx.userClaims.id,
        exp: Date.now() + 15 * 60 * 1000,
        nonce: crypto.randomUUID(),
      })));
      const ticket = payload + "." + await signature(payload);
      const browserUrl = SITE_ORIGIN + "/publications-browser/vnc.html?autoconnect=true&resize=remote&ticket="
        + encodeURIComponent(ticket)
        + "&path=" + encodeURIComponent("websockify?ticket=" + ticket);
      return reply({ browser_url: browserUrl, expires_in_seconds: 900 });
    } catch (cause) {
      console.error("Publication browser ticket failure", cause);
      return reply({ error: "Неуспешно създаване на защитен браузърен достъп." }, 500);
    }
  },
};