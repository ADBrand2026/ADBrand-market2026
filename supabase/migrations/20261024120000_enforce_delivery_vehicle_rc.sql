-- Fix frontend/backend delivery document mismatch: vehicle_rc is collected by the application.
-- Enforce approved vehicle RC for motorized riders before marking a delivery profile verified.
-- This migration is additive and safe to re-run.
-- Align delivery application document types with the existing frontend.
-- Vehicle insurance remains accepted for historical records but is not required for verification.
ALTER TABLE public.private_document_registry
  DROP CONSTRAINT IF EXISTS private_document_registry_doc_type_check;
ALTER TABLE public.private_document_registry
  ADD CONSTRAINT private_document_registry_doc_type_check
  CHECK (doc_type = ANY (ARRAY[
    'business_registration','tax_document','shop_photo','address_proof',
    'vehicle_photo','vehicle_rc','driving_license','vehicle_insurance','identity_document',
    'identity_proof','pan_card','bank_proof','food_license'
  ]::text[]));

CREATE OR REPLACE FUNCTION public.register_role_document(
  p_application_id uuid,
  p_doc_type text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_app public.role_applications%rowtype;
  v_profile public.profiles%rowtype;
  v_doc_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_doc_type NOT IN (
    'business_registration','tax_document','food_license','shop_photo',
    'address_proof','vehicle_photo','vehicle_rc','driving_license','vehicle_insurance',
    'identity_document','identity_proof','pan_card','bank_proof'
  ) THEN RAISE EXCEPTION 'Invalid document type'; END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','application/pdf') THEN
    RAISE EXCEPTION 'Only JPG, PNG or PDF documents are accepted';
  END IF;
  IF length(coalesce(p_original_name,'')) < 1 OR length(p_original_name) > 200 THEN
    RAISE EXCEPTION 'Invalid file name';
  END IF;
  IF length(coalesce(p_storage_path,'')) > 500
     OR split_part(p_storage_path,'/',1) <> (SELECT auth.uid())::text
     OR position('..' IN p_storage_path) > 0 THEN
    RAISE EXCEPTION 'Private storage path must be inside your own folder';
  END IF;

  SELECT * INTO v_app
  FROM public.role_applications
  WHERE id=p_application_id AND status='pending'
  FOR SHARE;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'A pending role application is required'; END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id=v_app.profile_id AND user_id=(SELECT auth.uid())
    AND role='customer' AND is_active=true
  LIMIT 1;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'This application does not belong to the signed-in applicant';
  END IF;

  IF v_app.requested_role='seller'
     AND p_doc_type NOT IN ('business_registration','tax_document','food_license','shop_photo','address_proof') THEN
    RAISE EXCEPTION 'This document type is only for delivery applications';
  END IF;
  IF v_app.requested_role='seller' AND p_doc_type='food_license'
     AND v_app.seller_type IS DISTINCT FROM 'food' THEN
    RAISE EXCEPTION 'Food license documents are only accepted for food sellers';
  END IF;
  IF v_app.requested_role='delivery'
     AND p_doc_type NOT IN ('vehicle_photo','vehicle_rc','driving_license','vehicle_insurance',
       'identity_document','identity_proof','pan_card','bank_proof','address_proof') THEN
    RAISE EXCEPTION 'This document type is only for delivery applications';
  END IF;

  INSERT INTO public.private_document_registry
    (application_id,profile_id,user_id,doc_type,storage_path,original_name,mime_type)
  VALUES
    (v_app.id,v_profile.id,(SELECT auth.uid()),p_doc_type,p_storage_path,
     left(p_original_name,200),p_mime_type)
  RETURNING id INTO v_doc_id;
  RETURN jsonb_build_object('ok',true,'document_id',v_doc_id,'status','pending');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_delivery_verification(
  p_delivery_id uuid,
  p_verified boolean,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin public.profiles%rowtype;
  v_delivery public.delivery_profiles%rowtype;
  v_vehicle text;
BEGIN
  SELECT * INTO v_admin FROM public.profiles
  WHERE user_id=(SELECT auth.uid()) AND role='admin' AND is_active IS TRUE
  LIMIT 1;
  IF v_admin.id IS NULL THEN RAISE EXCEPTION 'Active administrator access required'; END IF;

  SELECT * INTO v_delivery FROM public.delivery_profiles
  WHERE id=p_delivery_id FOR UPDATE;
  IF v_delivery.id IS NULL THEN RAISE EXCEPTION 'Delivery partner not found'; END IF;

  IF p_verified IS TRUE THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.private_document_registry d
      WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
        AND d.doc_type IN ('identity_proof','identity_document')
    ) THEN RAISE EXCEPTION 'Approve the delivery identity proof before verification'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.private_document_registry d
      WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
        AND d.doc_type='pan_card'
    ) THEN RAISE EXCEPTION 'Approve the delivery PAN document before verification'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.private_document_registry d
      WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
        AND d.doc_type='vehicle_photo'
    ) THEN RAISE EXCEPTION 'Approve the delivery vehicle photo before verification'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.private_document_registry d
      WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
        AND d.doc_type='address_proof'
    ) THEN RAISE EXCEPTION 'Approve delivery partner address proof before verification'; END IF;

    v_vehicle:=lower(trim(coalesce(v_delivery.vehicle_type,'')));
    IF v_vehicle NOT IN ('bicycle','cycle','cycling','electric_bicycle','electric cycle','e-cycle') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.private_document_registry d
        WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
          AND d.doc_type='vehicle_rc'
      ) THEN RAISE EXCEPTION 'Approve the vehicle registration certificate before motor vehicle rider verification'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.private_document_registry d
        WHERE d.profile_id=v_delivery.profile_id AND d.status='approved'
          AND d.doc_type='driving_license'
      ) THEN RAISE EXCEPTION 'Approve a valid driving licence before motor vehicle rider verification'; END IF;
    END IF;
  END IF;

  UPDATE public.delivery_profiles
  SET is_verified=p_verified,
      is_active=p_active,
      is_online=CASE WHEN p_verified AND p_active THEN is_online ELSE false END,
      updated_at=now()
  WHERE id=p_delivery_id;
  RETURN jsonb_build_object('ok',true,'delivery_id',p_delivery_id,
    'verified',p_verified,'active',p_active);
END;
$function$;
