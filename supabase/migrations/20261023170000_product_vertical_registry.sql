-- Product vertical registry: isolated metadata for single-vertical cart validation.
-- Safe to run more than once. Existing product rows are backfilled from products.is_food.
DO $$
BEGIN
  CREATE TYPE public.product_vertical_type AS ENUM ('FOOD', 'NON_FOOD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.product_vertical_registry (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  vertical_type public.product_vertical_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_vertical_registry_vertical_type_idx
  ON public.product_vertical_registry (vertical_type);

ALTER TABLE public.product_vertical_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_vertical_registry FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_product_vertical_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.product_vertical_registry (product_id, vertical_type, updated_at)
  VALUES (
    NEW.id,
    CASE WHEN COALESCE(NEW.is_food, false)
      THEN 'FOOD'::public.product_vertical_type
      ELSE 'NON_FOOD'::public.product_vertical_type
    END,
    now()
  )
  ON CONFLICT (product_id) DO UPDATE
    SET vertical_type = EXCLUDED.vertical_type,
        updated_at = now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_product_vertical_registry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_sync_vertical_registry ON public.products;
CREATE TRIGGER products_sync_vertical_registry
AFTER INSERT OR UPDATE OF is_food ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_vertical_registry();

INSERT INTO public.product_vertical_registry (product_id, vertical_type)
SELECT p.id,
       CASE WHEN COALESCE(p.is_food, false)
         THEN 'FOOD'::public.product_vertical_type
         ELSE 'NON_FOOD'::public.product_vertical_type
       END
FROM public.products p
ON CONFLICT (product_id) DO UPDATE
  SET vertical_type = EXCLUDED.vertical_type,
      updated_at = now();
