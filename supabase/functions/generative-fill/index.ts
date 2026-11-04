// BX Designs Generative Fill: the app sends the area around a selection (PNG), a mask of the
// selection (PNG, white = fill), a prompt and the model to use; this function checks the designer
// is signed in, spends that model's credits, asks the model on fal.ai and returns the result.
// The fal key lives only here (secret FAL_KEY); it never reaches the app.
//
// POST { "action": "balance" }                                 -> { "balance": n, "models": [...], "default": id }
// POST { "action": "fill", "prompt", "image", "mask", "model"? } -> { "image": base64, "balance": n }
// Errors -> { "error": "message" } with a 4xx/5xx status; failed fills are refunded.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Base64 of a PNG up to about 9 MB; the app sends at most 1000 px on the long side.
const MAX_B64 = 12_000_000;
const MAX_PROMPT = 500;
// An empty prompt fills from the surroundings, like Photoshop's.
const DEFAULT_PROMPT = "fill naturally to match the surrounding image";

type Input = { prompt: string; image: string; mask: string; width: number; height: number };
type Model = {
  label: string;
  note: string;
  credits: number;
  endpoint: string;
  body: (i: Input) => Record<string, unknown>;
};

// The models designers may pick. Credits are what the designer pays; one credit is about the
// cost of one FLUX.1 [pro] Fill (US$0.05). Change prices here, not in the app.
const MODELS: Record<string, Model> = {
  "flux-pro-fill": {
    label: "FLUX.1 Pro Fill",
    note: "Best all-round quality; blends well with photos.",
    credits: 1,
    endpoint: "fal-ai/flux-pro/v1/fill",
    body: (i) => ({ prompt: i.prompt, image_url: i.image, mask_url: i.mask, output_format: "png", sync_mode: true, safety_tolerance: "2" }),
  },
  "flux-dev-fill": {
    label: "FLUX.1 Dev Inpaint",
    note: "Faster and lighter; a looser match to the surroundings.",
    credits: 1,
    endpoint: "fal-ai/flux-lora/inpainting",
    body: (i) => ({
      prompt: i.prompt, image_url: i.image, mask_url: i.mask, image_size: { width: i.width, height: i.height },
      strength: 0.85, output_format: "png", sync_mode: true, enable_safety_checker: true,
    }),
  },
  "qwen-inpaint": {
    label: "Qwen Image Edit",
    note: "Follows detailed prompts and text in images well.",
    credits: 1,
    endpoint: "fal-ai/qwen-image-edit/inpaint",
    body: (i) => ({
      prompt: i.prompt, image_url: i.image, mask_url: i.mask, image_size: { width: i.width, height: i.height },
      output_format: "png", sync_mode: true, enable_safety_checker: true,
    }),
  },
  "bria-genfill": {
    label: "Bria GenFill",
    note: "Trained on licensed images only: safest for commercial work.",
    credits: 1,
    endpoint: "bria/genfill/v2",
    body: (i) => ({ instruction: i.prompt, image_url: i.image, mask_url: i.mask, sync_mode: true }),
  },
  "gpt-image-2": {
    label: "GPT Image 2",
    note: "Strongest at complex scenes and lettering; slowest and dearest.",
    credits: 5,
    endpoint: "openai/gpt-image-2/edit",
    body: (i) => ({
      prompt: i.prompt, image_urls: [i.image], mask_url: i.mask, image_size: { width: i.width, height: i.height },
      quality: "high", output_format: "png", sync_mode: true,
    }),
  },
};
const DEFAULT_MODEL = "flux-pro-fill";

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

// A PNG's size from its IHDR chunk (bytes 16..24), or null when it isn't a PNG.
function pngSize(b64: string): { width: number; height: number } | null {
  try {
    const head = Uint8Array.from(atob(b64.slice(0, 44)), (c) => c.charCodeAt(0));
    if (head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null;
    const v = new DataView(head.buffer);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  } catch {
    return null;
  }
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
  if (body.action === "balance") {
    const models = Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, note: m.note, credits: m.credits }));
    return reply(200, { balance: await balanceOf(user), models, default: DEFAULT_MODEL });
  }
  if (body.action !== "fill") return reply(400, { error: "unknown action" });

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const image = typeof body.image === "string" ? body.image : "";
  const mask = typeof body.mask === "string" ? body.mask : "";
  const modelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const model = Object.hasOwn(MODELS, modelId) ? MODELS[modelId] : undefined;
  if (!model) return reply(400, { error: `unknown model "${modelId.slice(0, 40)}"; update BX Designs` });
  if (prompt.length > MAX_PROMPT) return reply(400, { error: `the prompt is over ${MAX_PROMPT} characters` });
  if (!image || !mask || image.length > MAX_B64 || mask.length > MAX_B64) return reply(413, { error: "the image or mask is missing or too large" });
  const size = pngSize(image);
  if (!size || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) return reply(400, { error: "the image isn't a PNG of a usable size" });

  const { data: usage, error: spendError } = await admin.rpc("ai_spend", { who: user, kind: `generative-fill:${modelId}`, cost: model.credits });
  if (spendError) {
    const none = spendError.message.includes("no credits");
    return reply(none ? 402 : 500, { error: none ? `not enough AI credits for ${model.label} (it takes ${model.credits})` : `couldn't spend a credit: ${spendError.message}` });
  }
  const finish = (ok: boolean, note: string) => admin.rpc("ai_finish", { usage_id: usage, ok, note });

  try {
    const fal = await fetch(`https://fal.run/${model.endpoint}`, {
      method: "POST",
      headers: { authorization: `Key ${Deno.env.get("FAL_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify(model.body({
        prompt: prompt || DEFAULT_PROMPT,
        image: `data:image/png;base64,${image}`,
        mask: `data:image/png;base64,${mask}`,
        ...size,
      })),
    });
    if (!fal.ok) {
      const text = (await fal.text()).slice(0, 300);
      await finish(false, `fal ${fal.status}: ${text}`);
      return reply(502, { error: `the AI service failed (${fal.status}); your credits were refunded` });
    }
    const out = await fal.json();
    if (out?.has_nsfw_concepts?.[0]) {
      await finish(false, "blocked by the safety filter");
      return reply(422, { error: "the result was blocked by the safety filter; your credits were refunded" });
    }
    const url: string | undefined = out?.images?.[0]?.url ?? out?.image?.url;
    if (!url) {
      await finish(false, `no image in the response: ${JSON.stringify(out).slice(0, 200)}`);
      return reply(502, { error: "the AI service returned no image; your credits were refunded" });
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
    await finish(true, `${modelId}: ${prompt.slice(0, 180)}`);
    return reply(200, { image: png, balance: await balanceOf(user) });
  } catch (e) {
    await finish(false, String(e).slice(0, 300));
    return reply(502, { error: "the AI service couldn't be reached; your credits were refunded" });
  }
});
