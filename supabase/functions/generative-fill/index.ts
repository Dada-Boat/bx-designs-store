// BX Designs Generative Fill: the app sends the area around a selection (PNG), a mask of the
// selection (PNG, white = fill) and a prompt; this function checks the designer is signed in,
// spends a credit, asks fal.ai's FLUX.1 [pro] Fill for the result and returns it as a PNG.
// The fal key lives only here (secret FAL_KEY); it never reaches the app.
//
// POST { "action": "balance" }                            -> { "balance": n }
// POST { "action": "fill", "prompt", "image", "mask" }    -> { "image": base64 PNG, "balance": n }
// Errors -> { "error": "message" } with a 4xx/5xx status; failed fills are refunded.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FAL_URL = "https://fal.run/fal-ai/flux-pro/v1/fill";
const COST = 1;
// Base64 of a PNG up to about 9 MB; the app sends at most 1024 px on the long side.
const MAX_B64 = 12_000_000;
const MAX_PROMPT = 500;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function balanceOf(user: string): Promise<number> {
  const { data } = await admin.from("ai_credits").select("balance").eq("owner", user).maybeSingle();
  // No row yet: the starting balance the table gives on first use.
  return data?.balance ?? 10;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "use POST" });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !who?.user) return reply(401, { error: "sign in to BX Designs first" });
  const user = who.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "the request isn't JSON" });
  }
  if (body.action === "balance") return reply(200, { balance: await balanceOf(user) });
  if (body.action !== "fill") return reply(400, { error: "unknown action" });

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const image = typeof body.image === "string" ? body.image : "";
  const mask = typeof body.mask === "string" ? body.mask : "";
  if (prompt.length > MAX_PROMPT) return reply(400, { error: `the prompt is over ${MAX_PROMPT} characters` });
  if (!image || !mask || image.length > MAX_B64 || mask.length > MAX_B64) return reply(413, { error: "the image or mask is missing or too large" });

  const { data: usage, error: spendError } = await admin.rpc("ai_spend", { who: user, kind: "generative-fill", cost: COST });
  if (spendError) {
    const none = spendError.message.includes("no credits");
    return reply(none ? 402 : 500, { error: none ? "no AI credits left" : `couldn't spend a credit: ${spendError.message}` });
  }
  const finish = (ok: boolean, note: string) => admin.rpc("ai_finish", { usage_id: usage, ok, note });

  try {
    const fal = await fetch(FAL_URL, {
      method: "POST",
      headers: { authorization: `Key ${Deno.env.get("FAL_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({
        // An empty prompt fills from the surroundings, like Photoshop's.
        prompt: prompt || "fill naturally to match the surrounding image",
        image_url: `data:image/png;base64,${image}`,
        mask_url: `data:image/png;base64,${mask}`,
        output_format: "png",
        sync_mode: true,
        safety_tolerance: "2",
      }),
    });
    if (!fal.ok) {
      const text = (await fal.text()).slice(0, 300);
      await finish(false, `fal ${fal.status}: ${text}`);
      return reply(502, { error: `the AI service failed (${fal.status}); your credit was refunded` });
    }
    const out = await fal.json();
    if (out?.has_nsfw_concepts?.[0]) {
      await finish(false, "blocked by the safety filter");
      return reply(422, { error: "the result was blocked by the safety filter; your credit was refunded" });
    }
    const url: string | undefined = out?.images?.[0]?.url;
    if (!url) {
      await finish(false, "no image in the response");
      return reply(502, { error: "the AI service returned no image; your credit was refunded" });
    }
    // sync_mode gives a data URI; a hosted URL is fetched.
    let png: string;
    if (url.startsWith("data:")) {
      png = url.slice(url.indexOf(",") + 1);
    } else {
      const img = await fetch(url);
      if (!img.ok) throw new Error(`fetching the result failed (${img.status})`);
      png = toBase64(new Uint8Array(await img.arrayBuffer()));
    }
    await finish(true, prompt.slice(0, 200));
    return reply(200, { image: png, balance: await balanceOf(user) });
  } catch (e) {
    await finish(false, String(e).slice(0, 300));
    return reply(502, { error: "the AI service couldn't be reached; your credit was refunded" });
  }
});
