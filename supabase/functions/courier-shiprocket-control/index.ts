import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function safeText(v: unknown, max = 300) {
  return String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}
function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}
async function shiprocketToken(email: string, password: string) {
  const r = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error("SHIPROCKET_AUTH_FAILED");
  return String(j.token);
}
async function srRequest(token: string, path: string, method = "GET", payload?: unknown) {
  const r = await fetch("https://apiv2.shiprocket.in/v1/external/" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Shiprocket API failure", path, r.status, safeText(j.message || j.error || "provider_error", 120));
    throw new Error("SHIPROCKET_API_" + r.status);
  }
  return j;
}
function istDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply(401, { ok: false, code: "AUTH_REQUIRED" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(503, { ok: false, code: "BACKEND_NOT_CONFIGURED" });

  const token = auth.slice(7);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return reply(401, { ok: false, code: "AUTH_REQUIRED" });

    const { data: profile, error: profileError } = await adminClient.from("profiles")
      .select("id,role,is_admin,is_active").eq("user_id", authData.user.id).maybeSingle();
    if (profileError || !profile || profile.is_active !== true ||
        !(profile.role === "admin" || profile.is_admin === true)) {
      return reply(403, { ok: false, code: "ADMIN_REQUIRED" });
    }

    const body = await req.json().catch(() => null);
    const action = safeText(body?.action, 30);
    const orderId = safeText(body?.order_id, 64);
    if (!["health", "quote", "book", "pickup", "track", "ndr_list", "ndr_action"].includes(action) ||
        ( !["health", "ndr_list", "ndr_action"].includes(action) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))) {
      return reply(400, { ok: false, code: "INVALID_REQUEST" });
    }

    const email = Deno.env.get("SHIPROCKET_API_USER_EMAIL");
    const password = Deno.env.get("SHIPROCKET_API_USER_PASSWORD");
    if (!email || !password) return reply(503, {
      ok: false, code: "PROVIDER_CREDENTIALS_MISSING",
      message: "Shiprocket API user credentials have not been configured in Supabase Edge Function secrets.",
    });

    const { data: provider } = await adminClient.from("courier_provider_configs")
      .select("enabled").eq("provider_code", "shiprocket").maybeSingle();
    if (action !== "health" && !provider?.enabled) return reply(503, {
      ok: false, code: "PROVIDER_DISABLED",
      message: "Shiprocket is not enabled for live booking. Complete account/KYC and pickup-location checks first.",
    });

    if (action === "health") {
      const healthToken = await shiprocketToken(email, password);
      const now = new Date().toISOString();
      await adminClient.from("courier_provider_configs").update({ enabled: true, last_health_status: "healthy", last_health_checked_at: now, updated_at: now }).eq("provider_code", "shiprocket");
      return reply(200, { ok: true, code: "SHIPROCKET_CONNECTED", enabled: true, message: "Shiprocket API authentication succeeded. Provider is enabled for controlled testing." });
    }

    const srToken = await shiprocketToken(email, password);

    if (action === "ndr_list") {
      const ndrResponse = await srRequest(srToken, "ndr/all");
      const rawCases = ndrResponse?.data?.ndr_data || ndrResponse?.data || ndrResponse?.ndr_data || [];
      const list = Array.isArray(rawCases) ? rawCases : [];
      return reply(200, { ok: true, code: "NDR_CASES_FETCHED", cases: list.map((x: any) => ({
        awb: safeText(x.awb || x.awb_code, 80),
        courier_name: safeText(x.courier_name, 100),
        reason: safeText(x.ndr_reason || x.reason || x.current_status, 180),
        attempt: safeText(x.ndr_attempt || x.attempt, 40),
        status: safeText(x.status || x.current_status, 80),
      })).filter((x: any) => x.awb) });
    }
    if (action === "ndr_action") {
      const awb = safeText(body?.awb, 80);
      const ndrAction = safeText(body?.ndr_action, 30);
      const comments = safeText(body?.comments, 500);
      if (!awb || !["re-attempt", "return"].includes(ndrAction) || comments.length < 4) {
        return reply(400, { ok: false, code: "INVALID_NDR_ACTION" });
      }
      const { data: shipment } = await adminClient.from("external_shipments")
        .select("id,order_id,shipment_status,rto_charge").eq("awb_code", awb).maybeSingle();
      if (!shipment) return reply(404, { ok: false, code: "OUR_SHIPMENT_NOT_FOUND" });
      const ndrResult = await srRequest(srToken, "ndr/" + encodeURIComponent(awb) + "/action", "POST", {
        action: ndrAction, comments,
      });
      const now = new Date().toISOString();
      await adminClient.from("courier_shipment_events").insert({
        external_shipment_id: shipment.id, provider_code: "shiprocket",
        provider_event_id: "ndr-" + awb + "-" + ndrAction + "-" + now,
        awb_code: awb, event_code: "NDR_" + ndrAction.toUpperCase().replace(/-/g, "_"),
        event_status: ndrAction === "return" ? "returning" : "ndr_reattempt_requested",
        event_description: comments, event_time: now, source: "api",
        payload_safe: { action: ndrAction },
      });
      if (ndrAction === "return") {
        await adminClient.from("external_shipments").update({ shipment_status: "returning", last_tracking_status: "RTO_REQUESTED", updated_at: now }).eq("id", shipment.id);
        const { data: existingOrder } = await adminClient.from("orders").select("seller_shipping_status,seller_shipping_cost").eq("id", shipment.order_id).maybeSingle();
        const patch: Record<string, unknown> = { status: "returning", updated_at: now };
        if (existingOrder && !["rto_pending","rto_charged"].includes(existingOrder.seller_shipping_status)) {
          patch.seller_shipping_status = "rto_pending";
          patch.seller_shipping_cost = Number(existingOrder.seller_shipping_cost || 0) + Number(shipment.rto_charge || 0);
        }
        await adminClient.from("orders").update(patch).eq("id", shipment.order_id);
      }
      return reply(200, { ok: true, code: "NDR_ACTION_SUBMITTED", action: ndrAction, result: ndrResult });
    }

    const { data: order, error: orderError } = await adminClient.from("orders")
      .select("id,order_code,status,fulfillment_mode,subtotal,platform_fee,total_amount,payment_method,payment_status,address_id,seller_profile_id")
      .eq("id", orderId).maybeSingle();
    if (orderError || !order || order.fulfillment_mode !== "external_courier") {
      return reply(404, { ok: false, code: "EXTERNAL_ORDER_NOT_FOUND" });
    }

    const { data: shipment, error: shipmentError } = await adminClient.from("external_shipments")
      .select("*").eq("order_id", orderId).maybeSingle();
    if (shipmentError || !shipment) return reply(404, { ok: false, code: "SHIPMENT_NOT_FOUND" });

    const { data: seller } = await adminClient.from("seller_profiles")
      .select("id,shop_name,full_name,mobile,address,city,state,pincode,shiprocket_pickup_location")
      .eq("id", order.seller_profile_id).maybeSingle();
    const { data: address } = await adminClient.from("customer_addresses")
      .select("full_name,mobile,address_line,city,state,pincode,email")
      .eq("id", order.address_id).maybeSingle();
    const { data: pack } = await adminClient.from("order_package_details")
      .select("weight_kg,length_cm,width_cm,height_cm,package_count,declared_value")
      .eq("order_id", orderId).maybeSingle();

    if (!seller || !address || !pack || !seller.shiprocket_pickup_location || !address.email) {
      return reply(422, {
        ok: false, code: "SHIPMENT_DATA_INCOMPLETE",
        message: "Seller pickup location, customer address and actual package measurements must all be saved first.",
      });
    }
    if (!/^[1-9][0-9]{5}$/.test(String(seller.pincode || "")) ||
        !/^[1-9][0-9]{5}$/.test(String(address.pincode || "")) ||
        Number(pack.weight_kg) < 0.05 || Number(pack.length_cm) < 1 ||
        Number(pack.width_cm) < 1 || Number(pack.height_cm) < 1) {
      return reply(422, { ok: false, code: "INVALID_SHIPMENT_MEASUREMENTS" });
    }
    if (action !== "quote" && !shipment.seller_packed_at) {
      return reply(409, { ok: false, code: "SELLER_PACKING_REQUIRED" });
    }


    if (action === "quote") {
      if (!shipment.seller_packed_at || !["packed_for_courier", "external_booking_pending"].includes(order.status)) {
        return reply(409, { ok: false, code: "SELLER_PACKING_REQUIRED", message: "Seller must save actual package measurements and mark the parcel packed before rates are requested." });
      }
      if (shipment.quote_accepted_at || shipment.shipment_status === "booked" ||
          shipment.shipment_status === "picked_up" || shipment.shipment_status === "in_transit") {
        return reply(409, { ok: false, code: "QUOTE_LOCKED", message: "A quote cannot be replaced after customer acceptance or courier booking." });
      }
      const q = new URLSearchParams({
        pickup_postcode: String(seller.pincode),
        delivery_postcode: String(address.pincode),
        cod: order.payment_method === "cod" ? "1" : "0",
        weight: String(pack.weight_kg),
        length: String(Math.ceil(Number(pack.length_cm))),
        breadth: String(Math.ceil(Number(pack.width_cm))),
        height: String(Math.ceil(Number(pack.height_cm))),
        declared_value: String(Math.ceil(Number(pack.declared_value || order.subtotal))),
      });
      const response = await srRequest(srToken, "courier/serviceability/?" + q.toString());
      const available = response?.data?.available_courier_companies;
      if (!Array.isArray(available) || available.length === 0) {
        return reply(422, { ok: false, code: "NO_SERVICEABLE_COURIER", message: "Shiprocket returned no serviceable courier for these PIN codes and parcel measurements." });
      }
      const quoteRows = available.filter((c: any) => Number(c.blocked || 0) === 0 && Number(c.courier_company_id) > 0)
        .map((c: any) => {
          const freight = money(c.freight_charge ?? c.rate);
          const cod = money(c.cod_charges);
          const coverage = money(c.coverage_charges);
          const other = money(c.other_charges);
          const total = money(freight + cod + coverage + other);
          return {
            order_id: orderId, external_shipment_id: shipment.id, provider_code: "shiprocket",
            courier_code: String(c.courier_company_id), courier_name: safeText(c.courier_name, 100),
            service_type: Number(c.is_surface) === 1 ? "surface" : "standard",
            serviceable: total >= 0, freight_charge: freight, cod_charge: cod,
            insurance_charge: coverage, total_charge: total,
            estimated_days: Number(c.estimated_delivery_days) || null,
            quote_reference: String(c.id || c.courier_company_id),
            quote_payload_safe: {
              rating: Number(c.rating) || null,
              delivery_performance: Number(c.delivery_performance) || null,
              pickup_performance: Number(c.pickup_performance) || null,
              tracking_performance: Number(c.tracking_performance) || null,
              rto_charge: money(c.rto_charges), etd: safeText(c.etd, 40),
              secure_shipment_disabled: Boolean(c.secure_shipment_disabled),
            },
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          };
        }).filter((q: any) => q.total_charge > 0)
        .sort((a: any, b: any) => a.total_charge - b.total_charge || (a.estimated_days || 99) - (b.estimated_days || 99));
      if (!quoteRows.length) return reply(422, { ok: false, code: "NO_VALID_QUOTES" });

      const { data: inserted, error: insertError } = await adminClient.from("courier_rate_quotes")
        .insert(quoteRows).select("id,provider_code,courier_code,courier_name,service_type,freight_charge,cod_charge,insurance_charge,total_charge,estimated_days,expires_at,quote_payload_safe");
      if (insertError) {
        console.error("courier quote insert failed", insertError.code);
        return reply(500, { ok: false, code: "QUOTE_SAVE_FAILED" });
      }
      await adminClient.from("external_shipments").update({
        courier_provider: "shiprocket", shipment_status: "pending_quote",
        quote_sent_at: null, quote_accepted_at: null, quote_rejected_at: null,
        last_error_code: null, last_error_message: null, updated_at: new Date().toISOString(),
      }).eq("id", shipment.id);
      await adminClient.from("courier_provider_configs").update({
        last_health_status: "healthy", last_health_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("provider_code", "shiprocket");
      return reply(200, {
        ok: true, code: "COURIER_QUOTES_READY", order_id: orderId,
        quotes: inserted || [], selection_rule: "Compare total freight, COD and other charges; rating and estimated delivery days are shown separately.",
        customer_charge: Number(order.platform_fee || 0),
        seller_pays_actual_courier_cost: true,
      });
    }

    if (action === "book") {
      const resumable = shipment.shipment_status === "booking_failed" && Boolean(shipment.provider_order_id && shipment.provider_shipment_id);
      if (!shipment.quote_accepted_at || !shipment.selected_quote_id ||
          (shipment.shipment_status !== "pending_booking" && !resumable)) {
        return reply(409, { ok: false, code: "CUSTOMER_ACCEPTANCE_REQUIRED" });
      }
      if (shipment.awb_code || shipment.tracking_number || shipment.shipment_status === "booked") {
        return reply(409, { ok: false, code: "ALREADY_BOOKED", awb: shipment.awb_code || shipment.tracking_number });
      }
      if (shipment.shipment_status === "booking_in_progress") {
        return reply(409, { ok: false, code: "BOOKING_RECONCILIATION_REQUIRED", message: "A previous booking attempt is in progress. Do not retry automatically; reconcile the provider order first." });
      }
      const retryingPartialBooking = shipment.shipment_status === "booking_failed" && Boolean(shipment.provider_order_id && shipment.provider_shipment_id);
      if (shipment.shipment_status !== "pending_booking" && !retryingPartialBooking) return reply(409, { ok: false, code: "BOOKING_STAGE_INVALID" });
      if (shipment.shipment_status === "booking_failed" && shipment.provider_order_id && !shipment.provider_shipment_id) return reply(409, { ok: false, code: "MANUAL_RECONCILIATION_REQUIRED" });
      const { data: quote } = await adminClient.from("courier_rate_quotes")
        .select("*").eq("id", shipment.selected_quote_id).eq("order_id", orderId)
        .eq("provider_code", "shiprocket").not("accepted_at", "is", null).maybeSingle();
      if (!quote) {
        return reply(409, { ok: false, code: "ACCEPTED_QUOTE_NOT_FOUND" });
      }
      const { data: items } = await adminClient.from("order_items")
        .select("quantity,unit_price,product_id").eq("order_id", orderId);
      if (!items?.length) return reply(422, { ok: false, code: "ORDER_ITEMS_MISSING" });
      const productIds = items.map((x: any) => x.product_id);
      const { data: products } = await adminClient.from("products").select("id,name,product_code").in("id", productIds);
      const productMap = new Map((products || []).map((p: any) => [p.id, p]));
      const orderItems = items.map((x: any) => {
        const p: any = productMap.get(x.product_id);
        return { name: safeText(p?.name || "Product", 180), sku: safeText(p?.product_code || x.product_id, 80), units: Number(x.quantity), selling_price: Math.max(1, Math.round(Number(x.unit_price))) };
      });
      const { data: claim } = await adminClient.from("external_shipments").update({
        shipment_status: "booking_in_progress", booking_attempts: Number(shipment.booking_attempts || 0) + 1,
        idempotency_key: "ADBM-" + safeText(order.order_code || orderId, 24),
        last_error_code: null, last_error_message: null, updated_at: new Date().toISOString(),
      }).eq("id", shipment.id).eq("shipment_status", shipment.shipment_status).select("id").maybeSingle();
      if (!claim) return reply(409, { ok: false, code: "BOOKING_LOCKED" });

      let providerOrderId = shipment.provider_order_id;
      let providerShipmentId = shipment.provider_shipment_id;
      try {
        if (!providerOrderId || !providerShipmentId) {
          const fullName = safeText(address.full_name, 100).split(/\s+/);
          const firstName = fullName.shift() || "Customer";
          const lastName = fullName.join(" ");
          const payload: Record<string, unknown> = {
            order_id: safeText(order.order_code || orderId.replace(/-/g, "").slice(0, 20), 50),
            order_date: istDate() + " 12:00",
            pickup_location: safeText(seller.shiprocket_pickup_location, 36),
            billing_customer_name: firstName,
            billing_last_name: lastName,
            billing_email: safeText(address.email, 180),
            billing_address: safeText(address.address_line, 250),
            billing_city: safeText(address.city, 80),
            billing_pincode: Number(address.pincode),
            billing_state: safeText(address.state, 80),
            billing_country: "India",
            billing_phone: Number(String(address.mobile).replace(/\D/g, "").slice(-10)),
            shipping_is_billing: true,
            order_items: orderItems,
            payment_method: order.payment_method === "cod" ? "COD" : "Prepaid",
            shipping_charges: Math.round(Number(order.platform_fee || 0)),
            sub_total: Math.round(Number(order.subtotal || 0)),
            length: Math.ceil(Number(pack.length_cm)),
            breadth: Math.ceil(Number(pack.width_cm)),
            height: Math.ceil(Number(pack.height_cm)),
            weight: Number(pack.weight_kg),
            declared_value: Math.round(Number(pack.declared_value || order.subtotal)),
            cod: order.payment_method === "cod" ? 1 : 0,
          };
          const created = await srRequest(srToken, "orders/create/adhoc", "POST", payload);
          providerOrderId = String(created.order_id || created.data?.order_id || "");
          providerShipmentId = String(created.shipment_id || created.data?.shipment_id || "");
          if (!providerOrderId || !providerShipmentId) throw new Error("SHIPROCKET_ORDER_RESPONSE_INCOMPLETE");
          await adminClient.from("external_shipments").update({
            provider_order_id: providerOrderId, provider_shipment_id: providerShipmentId,
            courier_order_reference: providerOrderId, updated_at: new Date().toISOString(),
          }).eq("id", shipment.id);
        }

        const awbResult = await srRequest(srToken, "courier/assign/awb", "POST", {
          shipment_id: Number(providerShipmentId), courier_id: Number(quote.courier_code),
        });
        const awb = safeText(awbResult.response?.data?.awb_code || awbResult.awb_code || awbResult.data?.awb_code, 80);
        const courierName = safeText(awbResult.response?.data?.courier_name || awbResult.courier_name || quote.courier_name, 100);
        if (!awb) throw new Error("SHIPROCKET_AWB_NOT_RETURNED");

        const pickupStatus = "not_requested";
        let labelUrl = "";
        try {
          const label = await srRequest(srToken, "courier/generate/label", "POST", { shipment_id: [Number(providerShipmentId)] });
          labelUrl = safeText(label.label_url || label.response?.label_url || label.data?.label_url, 500);
        } catch (labelError) {
          console.error("Shiprocket label generation failed", safeText(labelError, 80));
        }

        const now = new Date().toISOString();
        const { error: saveError } = await adminClient.from("external_shipments").update({
          courier_provider: "shiprocket", provider_order_id: providerOrderId,
          provider_shipment_id: providerShipmentId, courier_order_reference: providerOrderId,
          awb_code: awb, tracking_number: awb, courier_name: courierName,
          label_url: labelUrl || null, pickup_status: pickupStatus, manifest_url: null,
          freight_charge: quote.freight_charge, cod_charge: quote.cod_charge,
          insurance_charge: quote.insurance_charge, rto_charge: quote.quote_payload_safe?.rto_charge ?? null,
          shipment_status: "booked", last_tracking_status: "AWB_ASSIGNED",
          last_tracking_at: now, updated_at: now,
          provider_response_safe: { order_id: providerOrderId, shipment_id: providerShipmentId, awb, courier_name: courierName, pickup_status: pickupStatus, label_available: Boolean(labelUrl), pickup_scheduling_deferred_until_barcode_verification: true },
        }).eq("id", shipment.id);
        if (saveError) throw new Error("DATABASE_SAVE_FAILED_AFTER_PROVIDER_BOOKING");

        await adminClient.from("orders").update({
          status: "booked", seller_shipping_cost: quote.total_charge,
          seller_shipping_status: "quoted", delivery_charge: 0,
          total_amount: Number(order.subtotal || 0) + Number(order.platform_fee || 0),
          updated_at: now,
        }).eq("id", orderId);
        await adminClient.from("courier_shipment_events").insert({
          external_shipment_id: shipment.id, provider_code: "shiprocket",
          provider_event_id: "awb-" + awb, awb_code: awb,
          event_code: "AWB_ASSIGNED", event_status: "booked",
          event_description: "AWB assigned by Shiprocket",
          event_time: now, source: "api",
          payload_safe: { courier_name: courierName, pickup_status: pickupStatus },
        });
        return reply(200, {
          ok: true, code: "COURIER_BOOKED", order_id: orderId,
          provider_order_id: providerOrderId, provider_shipment_id: providerShipmentId,
          awb, courier_name: courierName, label_url: labelUrl || null,
          pickup_status: pickupStatus, tracking_status: "AWB_ASSIGNED",
          seller_shipping_cost: quote.total_charge,
          customer_delivery_charge: 0,
          message: "AWB and label created. Scan the AD parcel barcode first; only then schedule the courier pickup.",
        });
      } catch (e) {
        const code = safeText(e instanceof Error ? e.message : "BOOKING_FAILED", 120);
        await adminClient.from("external_shipments").update({
          shipment_status: "booking_failed", last_error_code: code,
          last_error_message: "Provider booking step failed. Check Shiprocket panel before retrying.",
          provider_order_id: providerOrderId || null, provider_shipment_id: providerShipmentId || null,
          updated_at: new Date().toISOString(),
        }).eq("id", shipment.id);
        return reply(502, { ok: false, code: "PROVIDER_BOOKING_FAILED", provider_order_created: Boolean(providerOrderId), message: "Courier booking did not complete. Check provider dashboard before retrying to prevent duplicate shipments." });
      }
    }

    if (action === "pickup") {
      if (shipment.shipment_status !== "booked" || !shipment.awb_code ||
          !shipment.handoff_verified_at || !shipment.provider_shipment_id) {
        return reply(409, { ok: false, code: "BARCODE_HANDOFF_VERIFICATION_REQUIRED",
          message: "Verify the AD parcel barcode after AWB booking before scheduling courier pickup." });
      }
      if (shipment.pickup_status && !["not_requested","failed"].includes(shipment.pickup_status)) {
        return reply(409, { ok: false, code: "PICKUP_ALREADY_REQUESTED", pickup_status: shipment.pickup_status });
      }
      const pickupPayload: Record<string, unknown> = { shipment_id: [Number(shipment.provider_shipment_id)] };
      if (shipment.pickup_status === "failed") pickupPayload.status = "retry";
      const pickup = await srRequest(srToken, "courier/generate/pickup", "POST", pickupPayload);
      const pickupStatus = safeText(pickup.pickup_status || pickup.status || "requested", 60);
      let manifestUrl = "";
      try {
        const manifest = await srRequest(srToken, "manifests/generate", "POST", { shipment_id: [Number(shipment.provider_shipment_id)] });
        manifestUrl = safeText(manifest.manifest_url || manifest.response?.manifest_url || manifest.data?.manifest_url, 500);
      } catch (manifestError) {
        console.error("Shiprocket manifest generation failed", safeText(manifestError, 80));
      }
      const now = new Date().toISOString();
      await adminClient.from("external_shipments").update({
        pickup_status: pickupStatus, manifest_url: manifestUrl || null, updated_at: now,
        provider_response_safe: { ...(shipment.provider_response_safe || {}), pickup_status: pickupStatus, manifest_available: Boolean(manifestUrl) },
      }).eq("id", shipment.id);
      await adminClient.from("courier_shipment_events").insert({
        external_shipment_id: shipment.id, provider_code: "shiprocket",
        provider_event_id: "pickup-request-" + shipment.awb_code + "-" + now,
        awb_code: shipment.awb_code, event_code: "PICKUP_REQUESTED",
        event_status: "pickup_requested", event_description: "Courier pickup requested after AD barcode verification",
        event_time: now, source: "api", payload_safe: { pickup_status: pickupStatus, manifest_available: Boolean(manifestUrl) },
      });
      return reply(200, { ok: true, code: "PICKUP_REQUESTED", pickup_status: pickupStatus, manifest_url: manifestUrl || null,
        message: "Courier pickup requested after barcode verification. Wait for the provider's actual pickup scan." });
    }

    if (action === "track") {
      const awb = safeText(shipment.awb_code || shipment.tracking_number, 80);
      if (!awb) return reply(409, { ok: false, code: "AWB_NOT_AVAILABLE" });
      const tracked = await srRequest(srToken, "courier/track/awb/" + encodeURIComponent(awb));
      const info = tracked?.tracking_data?.shipment_track?.[0] || tracked?.tracking_data || tracked?.data || {};
      const statusText = safeText(info.current_status || info.shipment_status || info.status, 120);
      const statusId = Number(info.current_status_id || info.shipment_status_id || 0);
      const normalized = statusText.toUpperCase().includes("RTO") ? "returned" :
        statusText.toUpperCase().includes("DELIVERED") || statusId === 7 ? "delivered" :
        statusText.toUpperCase().includes("OUT FOR DELIVERY") || statusText.toUpperCase().includes("IN TRANSIT") || statusId === 6 || statusId === 19 ? "in_transit" :
        statusText.toUpperCase().includes("PICKED UP") ? "picked_up" :
        statusText.toUpperCase().includes("LOST") || statusText.toUpperCase().includes("EXCEPTION") ? "failed" : null;
      if (normalized && statusText) {
        const now = new Date().toISOString();
        const eventTime = info.track_date && !Number.isNaN(Date.parse(info.track_date)) ? new Date(info.track_date).toISOString() : now;
        await adminClient.from("external_shipments").update({
          shipment_status: normalized, last_tracking_status: statusText,
          last_tracking_at: eventTime, updated_at: now,
          ...(normalized === "picked_up" ? { picked_up_at: now } : {}),
          ...(normalized === "delivered" ? { delivered_at: now } : {}),
          ...(normalized === "returned" ? { returned_at: now } : {}),
        }).eq("id", shipment.id);
        await adminClient.from("courier_shipment_events").insert({
          external_shipment_id: shipment.id, provider_code: "shiprocket",
          provider_event_id: "poll-" + awb + "-" + statusId + "-" + eventTime,
          awb_code: awb, event_code: String(statusId || statusText),
          event_status: normalized, event_description: statusText,
          event_location: safeText(info.location || info.current_location, 120) || null,
          event_time: eventTime, source: "api",
          payload_safe: { status: statusText, status_id: statusId },
        });
        const mappedOrder = normalized === "delivered" ? "awaiting_customer_confirmation" :
          normalized === "returned" ? "returned" : normalized === "failed" ? "delivery_exception" :
          normalized === "picked_up" ? "picked_up" : normalized === "in_transit" ? "in_transit" : null;
        if (mappedOrder) await adminClient.from("orders").update({ status: mappedOrder, updated_at: now }).eq("id", orderId);
      }
      return reply(200, { ok: true, code: "TRACKING_FETCHED", awb, tracking: info });
    }
  } catch (e) {
    const message = safeText(e instanceof Error ? e.message : "INTERNAL_ERROR", 120);
    console.error("courier control failed", message);
    return reply(500, { ok: false, code: message.startsWith("SHIPROCKET_") ? message : "COURIER_CONTROL_FAILED" });
  }
});