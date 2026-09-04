-- Dev mock catalog configuration only. Product IDs stay stable so historical
-- purchase transaction references remain valid. No wallet, ledger, or billing
-- contract changes are made here, and this migration is applied to Nearr-Dev only.
update public.place_find_products
set use_count = 30,
    mock_display_price = '$8.99',
    mock_price_cents = 899,
    sort_order = 20,
    updated_at = now()
where product_id = 'dev.mock.nearr.place_finds.25'
  and product_kind = 'dev_mock';

update public.place_find_products
set use_count = 75,
    mock_display_price = '$15.99',
    mock_price_cents = 1599,
    sort_order = 30,
    updated_at = now()
where product_id = 'dev.mock.nearr.place_finds.50'
  and product_kind = 'dev_mock';
