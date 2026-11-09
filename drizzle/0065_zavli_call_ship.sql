-- Zavli ships only orders confirmed by its calling team (owner's request, 9 Nov 2026). Changeable in Shipping & RTO → Shipping rules.
UPDATE "stores" SET "ship_rule" = '{"mode":"confirmed","by":"team","prepaidNow":false}'::jsonb, "auto_ship" = true WHERE "id" = 3 AND "name" ILIKE 'zavli%';
