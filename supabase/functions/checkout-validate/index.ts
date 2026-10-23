import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-app-locale",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const messages = {
  hi_IN: {
    method: "केवल POST अनुरोध स्वीकार है।",
    auth: "कृपया पहले लॉगिन करें।",
    body: "कार्ट में मान्य उत्पाद चुनें।",
    missing: "कुछ उत्पाद उपलब्ध नहीं हैं। कार्ट की जाँच करके फिर प्रयास करें।",
    mixed: "एक ऑर्डर में Food और Non-Food उत्पाद साथ नहीं खरीदे जा सकते। कार्ट साफ़ करके एक श्रेणी चुनें।",
    success: "कार्ट की श्रेणी सत्यापित हो गई।",
    server: "अभी कार्ट सत्यापित नहीं हो पाया। कृपया दोबारा प्रयास करें।",
  },
  en_IN: {
    method: "Only POST requests are accepted.",
    auth: "Please sign in first.",
    body: "Provide valid product IDs in the cart.",
    missing: "Some products are unavailable. Review your cart and try again.",
    mixed: "Food and Non-Food products cannot be checked out together. Clear the cart and choose one category.",
    success: "Cart vertical validated.",
    server: "The cart could not be validated right now. Please try again.",
  },
} as const;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const localeHeader = (request.headers.get("x-app-locale") || "").toLowerCase();
  const locale = localeHeader === "en_in" ? "en_IN" : "hi_IN";
  const t = messages[locale];

  if (request.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED", message: t.method });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, code: "AUTH_REQUIRED", message: t.auth });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(503, { ok: false, code: "SERVER_CONFIGURATION", message: t.server });
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData.user) return json(401, { ok: false, code: "AUTH_REQUIRED", message: t.auth });

    const body = await request.json().catch(() => null);
    const ids = body && Array.isArray(body.productIds) ? body.productIds : null;
    if (!ids || ids.length < 1 || ids.length > 100 ||
        ids.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return json(400, { ok: false, code: "INVALID_CART", message: t.body, clearCart: false });
    }

    const productIds = [...new Set(ids as string[])];
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: products, error: queryError } = await serviceClient
      .from("product_vertical_registry")
      .select("product_id,vertical_type")
      .in("product_id", productIds);

    if (queryError) {
      console.error("checkout-validate registry query failed", queryError.code);
      return json(503, { ok: false, code: "VALIDATION_UNAVAILABLE", message: t.server });
    }
    if (!products || products.length !== productIds.length) {
      return json(422, { ok: false, code: "PRODUCT_UNAVAILABLE", message: t.missing, clearCart: false });
    }

    const verticals = [...new Set(products.map((product) => product.vertical_type))];
    if (verticals.length !== 1) {
      return json(422, { ok: false, code: "MIXED_VERTICAL_CART", message: t.mixed, clearCart: true, allowedVerticals: ["FOOD", "NON_FOOD"] });
    }

    return json(200, { ok: true, code: "CART_VERTICAL_VALID", message: t.success, verticalType: verticals[0], productCount: productIds.length });
  } catch (error) {
    console.error("checkout-validate request failed", error instanceof Error ? error.name : "unknown");
    return json(400, { ok: false, code: "INVALID_REQUEST", message: t.body });
  }
});
