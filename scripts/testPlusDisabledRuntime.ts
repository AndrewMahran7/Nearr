import assert from 'node:assert/strict';
import React from 'react';
import * as translations from '../lib/i18nEngine';
import { isFreeOnlyPlusStatus } from '../lib/plusReleasePolicy';

// Real Plus client and screen, mocked native/network boundaries; never purchases.
const Module = require('node:module');
const originalLoad = Module._load;
let sdkLoads = 0;
let networkError = false;
let plusState: any;
const status: any = { ok: true, salesEnabled: false, purchaseEligible: false, restoreAvailable: false,
  appUserId: null, offeringId: 'nearr_plus_v1', productId: 'nearr_plus_monthly_v1', freeFinds: 3, plusFinds: 10,
  usage: { used: 0, reserved: 0, limit: 3, remaining: 3 }, entitlement: null };
const supabase = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'owned-qa', is_anonymous: false } } } }) },
  functions: { invoke: async () => ({ data: networkError ? null : status, error: networkError ? new Error('offline') : null }) },
};
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'expo-constants') return { __esModule: true, default: { expoConfig: { extra: {} } } };
  if (request === 'expo-crypto') return { randomUUID: () => 'fixture-event-id' };
  if (request === './supabase' && /plusClient/.test(parent?.filename ?? '')) return { supabase };
  if (request === 'react-native-purchases') { sdkLoads++; throw new Error('disabled storefront must never load purchase SDK'); }
  if (request === '@/lib/i18n') return translations;
  if (request === '@/hooks/useLocale') return { useLocale: () => ({ locale: translations.i18n.language }) };
  if (request === '@/hooks/usePlus') return { usePlus: () => plusState };
  if (request === '@/lib/plusClient') return originalLoad(require.resolve('../lib/plusClient'), parent, isMain);
  if (request === '@/lib/plusEntitlements') return originalLoad(require.resolve('../lib/plusEntitlements'), parent, isMain);
  if (request === 'expo-router') return { useRouter: () => ({ back() {}, push() {} }) };
  if (request === 'react-native') return { ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Linking: { openURL: async () => {} } };
  if (request === '@/components') return { Screen: 'Screen', Card: 'Card', Button: (props: any) => React.createElement('Button', props, props.title) };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: { text: '#111', primary: '#f60' }, typography: {} }) };
  return originalLoad(request, parent, isMain);
};
async function main() {
  try {
    const client = require('../lib/plusClient') as typeof import('../lib/plusClient');
    assert.equal(await client.loadPlusOffer('owned-qa', status), null);
    assert.equal((await client.purchasePlus('owned-qa', { productId: status.productId, price: '$fixture', package: {} })).outcome, 'error');
    await assert.rejects(client.restorePlus('owned-qa'), /plus_store_unavailable/);
    assert.equal(sdkLoads, 0, 'suspended sales and restore cannot touch native purchase SDK');
    networkError = true;
    await assert.rejects(client.fetchPlusStatus('owned-qa'), /plus_unavailable/);
    assert.equal((await client.purchasePlus('owned-qa', { productId: status.productId, price: '$fixture', package: {} })).outcome, 'error');
    assert.equal(sdkLoads, 0, 'offline cannot activate purchases'); networkError = false;
    // A contradictory response must still never load StoreKit on a free route.
    status.releaseMode='free_only'; status.salesEnabled=true; status.purchaseEligible=true;
    status.restoreAvailable=true; status.appUserId='malicious-fixture';
    assert.equal(await client.loadPlusOffer('owned-qa',status),null);
    assert.equal((await client.purchasePlus('owned-qa',{productId:status.productId,price:'$fixture',package:{}})).outcome,'error');
    await assert.rejects(client.restorePlus('owned-qa'),/plus_store_unavailable/);
    status.salesEnabled=false; status.purchaseEligible=false; status.restoreAvailable=false; status.appUserId=null;
    delete status.releaseMode;
    const Renderer = require('react-test-renderer') as typeof import('react-test-renderer');
    const Plus = require('../app/plus').default;
    let renders = 0;
    for (const locale of ['en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans']) {
      await translations.i18n.changeLanguage(locale);
      for (const mode of ['disabled', 'offline', 'loading', 'free_only']) {
        const currentStatus=mode==='free_only' ? {...status,releaseMode:'free_only',usage:{...status.usage,enforced:true}} : status;
        plusState = { userId: 'owned-qa', status: ['disabled','free_only'].includes(mode) ? currentStatus : null, loading: mode === 'loading',
          freeOnly: mode==='free_only' && isFreeOnlyPlusStatus(currentStatus),
          offer: null, canOffer: false, hasPlus: false, canManage: false, refresh: async () => {} };
        let renderer!: ReturnType<typeof Renderer.create>;
        Renderer.act(() => { renderer = Renderer.create(React.createElement(Plus)); });
        const tree = JSON.stringify(renderer.toJSON());
        if(mode!=='free_only') assert.ok(tree.includes(translations.t('Your saved places stay yours, with or without a subscription.')));
        assert.equal(renderer.root.findAllByType('Button' as any).filter(n => String(n.props.title).includes('$fixture')).length, 0);
        if (mode === 'disabled') {
          assert.ok(tree.includes(translations.t('Plus is not available for purchase on this account right now.')));
          const restore = renderer.root.findAllByType('Button' as any).find(n => n.props.title === translations.t('Restore Purchases'));
          assert.equal(restore?.props.disabled, true);
        } else if(mode==='free_only') {
          assert.ok(tree.includes(translations.t('Free includes {{count}} successful video finds each calendar month.',{count:3})));
          assert.ok(tree.includes('UTC'));
          for(const key of ['Nearr Plus','Plus includes {{count}} successful video finds per billing month, including your free allowance.',
            'Restore Purchases','Manage Subscription','Plus is not available for purchase on this account right now.']) {
            assert.ok(!tree.includes(translations.t(key,{count:10})),`${locale} free-only must hide ${key}`);
          }
        } else if (mode === 'offline') assert.ok(tree.includes(translations.t('Purchases are unavailable right now. Your saved places are still available.')));
        else assert.equal(renderer.root.findAllByType('ActivityIndicator' as any).length, 1);
        Renderer.act(() => renderer.unmount()); renders++;
      }
    }
    assert.equal(sdkLoads, 0);
    console.log(`PASS Plus disabled/offline/free-only/restore client gates and ${renders} real-screen locale/state renders; zero native purchases`);
  } finally { Module._load = originalLoad; await translations.i18n.changeLanguage('en-US'); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
