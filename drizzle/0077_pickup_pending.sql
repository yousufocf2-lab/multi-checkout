-- Booked shipments the courier hasn't picked up yet get their own status ("Ready for pickup")
UPDATE "orders" SET "ship_status" = 'pickup_pending'
WHERE "ship_status" = 'in_transit'
  AND (lower(coalesce("ship_status_raw", '')) ~ '(^|· )(manifest|not picked|ready to ship|pickup)' OR lower(coalesce("ship_status_raw", '')) = 'manifested');
