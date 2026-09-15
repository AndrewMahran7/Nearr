-- Bind the Dev-only ledger to the verified RevenueCat Nearr Dev project and
-- Test Store app. These public catalog identifiers are intentionally explicit:
-- events from any other RevenueCat project, app, store, or environment fail
-- closed in both the Edge handler and the database RPC.

update public.token_monetization_config
set revenuecat_project_id = 'proj7d727ef6',
    revenuecat_app_id = 'app26505bdf1c',
    revenuecat_allowed_stores = array['TEST_STORE']::text[],
    updated_at = now()
where environment_name = 'development';
