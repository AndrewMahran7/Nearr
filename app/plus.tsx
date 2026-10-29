import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen } from '@/components';
import { PaidFindsBalance } from '@/components/PaidFindsBalance';
import { useTheme } from '@/lib/theme';
import { usePlus } from '@/hooks/usePlus';
import { useLocale } from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { PLUS_MANAGE_URL, pendingPurchase, purchasePlus, purchaseTokenPack, reconcilePurchase, restorePlus, type TokenOffer } from '@/lib/plusClient';

const packNames = {20:'Starter',50:'Explorer',200:'Adventurer'} as const;
export default function PlusScreen() {
  const plus=usePlus();
  return <PaidFindsContent plus={plus}/>;
}
/** The Development QA route may render fixtures, but every action stays inert. */
export function PaidFindsContent({plus,preview=false}:{plus:ReturnType<typeof usePlus>;preview?:boolean}) {
  useLocale();
  const router=useRouter(); const {colors,typography}=useTheme();
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const currentUser=useRef(plus.userId); currentUser.current=plus.userId;
  useEffect(()=>{setMessage('');setBusy(false);},[plus.userId]);
  async function transact(offer?:TokenOffer) {
    const owner=plus.userId;
    if (preview || !owner || busy || plus.purchasePending || (!offer && !plus.offer)) return;
    setBusy(true); setMessage('');
    try {
      const result=offer ? await purchaseTokenPack(owner,offer) : await purchasePlus(owner,plus.offer!);
      if(currentUser.current!==owner)return;
      setMessage(result.outcome==='verified' ? 'Purchase verified. Your account is up to date.'
        : result.outcome==='pending' ? 'Purchase pending. Check its status before trying another payment.'
        : result.outcome==='cancelled' ? 'Purchase cancelled. Nothing has changed.'
        : 'Purchases are unavailable right now. Your saved places are still available.');
      await plus.refresh();
    } catch {if(currentUser.current===owner)setMessage('Purchases are unavailable right now. Your saved places are still available.');}
    finally {if(currentUser.current===owner)setBusy(false);}
  }
  async function recover(restore:boolean) {
    const owner=plus.userId; if(preview||!owner||busy)return; setBusy(true); setMessage('');
    try {
      if(restore) await restorePlus(owner); else await reconcilePurchase(owner);
      const pending=await pendingPurchase(owner);
      if(currentUser.current!==owner)return;
      setMessage(pending ? 'Purchase pending. Check its status before trying another payment.'
        : 'Account balances refreshed. Previously credited tokens are not credited again.');
      await plus.refresh();
    } catch {if(currentUser.current===owner)setMessage('We could not restore purchases. Check your connection and try again.');}
    finally {if(currentUser.current===owner)setBusy(false);}
  }
  const purchaseBlocked=preview||busy||plus.loading||!!plus.purchasePending;
  return <Screen><ScrollView contentContainerStyle={{gap:24,paddingBottom:48}}>
    {preview && <Text accessibilityRole="alert" style={typography.caption}>DEVELOPMENT FIXTURE · no live balance or Store price · purchases disabled</Text>}
    <Button title={t('Not now')} variant="ghost" onPress={()=>router.back()} />
    <View style={{gap:12}}>
      <Text style={typography.eyebrow}>{t('Your next discovery')}</Text>
      <Text accessibilityRole="header" style={[typography.largeTitle,{color:colors.text}]}>{t('Keep discovering places')}</Text>
      <Text style={typography.body}>{t('Your saved places stay yours, with or without a subscription.')}</Text>
    </View>
    {plus.loading && <ActivityIndicator color={colors.primary} accessibilityLabel={t('Loading subscription')} />}
    {!plus.loading && !plus.status && <Text accessibilityRole="alert" style={typography.body}>{t('Purchases are unavailable right now. Your saved places are still available.')}</Text>}
    {plus.status && <Card><PaidFindsBalance status={plus.status}/></Card>}
    {plus.status?.purchaseBlockedReason==='purchase_ineligible' && <Text accessibilityRole="alert" style={typography.body}>{t('Purchases are unavailable under this account’s age and country settings.')}</Text>}
    {!!plus.purchasePending && <Card><View style={{gap:12}}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={typography.bodyStrong}>{t('Purchase pending. Check its status before trying another payment.')}</Text>
      <Text style={typography.body}>{t('Apple or account verification may still be pending. Do not pay again to recover a missing balance.')}</Text>
      <Button title={t('Check purchase status')} onPress={()=>void recover(false)} disabled={preview||busy} loading={busy}/>
    </View></Card>}
    {!plus.freeOnly && <>
      <Card style={{borderColor:colors.primary}}><View style={{gap:16}}>
        <Text style={[typography.eyebrow,{color:colors.accent}]}>{t('Nearr Plus')}</Text>
        <Text accessibilityRole="header" style={typography.title}>{t('Unlimited finds')}</Text>
        <Text style={typography.body}>{t('Unlimited successful video finds while Plus is active. No token deductions.')}</Text>
        {plus.hasPlus ? <Text style={typography.bodyStrong}>{t('Nearr Plus is active')}</Text>
          : plus.offer ? <>
            <Text style={typography.title}>{t('{{price}} / month',{price:plus.offer.price})}</Text>
            <Button title={t('Get Nearr Plus')} onPress={()=>void transact()} disabled={purchaseBlocked||!plus.canOffer} loading={busy}/>
          </> : !plus.loading && <Text style={typography.body}>{t('Plus is not available for purchase on this account right now.')}</Text>}
        <Text style={typography.caption}>{t('Apple bills monthly and renews automatically unless cancelled in subscription settings. No free trial or annual plan.')}</Text>
        {plus.status?.entitlement?.state==='cancelled' && <Text style={typography.caption}>{t('Renewal is cancelled. Plus remains available until the paid period ends.')}</Text>}
        {plus.status?.entitlement?.state==='grace' && <Text style={typography.caption}>{t('Apple is resolving a billing issue. Check Manage Subscription for details.')}</Text>}
        {['expired','revoked'].includes(plus.status?.entitlement?.state??'') && <Text style={typography.body}>{t('Plus is no longer active. Your free finds, purchased tokens and saved places remain yours.')}</Text>}
      </View></Card>
      <View style={{gap:12}}>
        <Text accessibilityRole="header" style={typography.title}>{t('Or buy finds when you need them')}</Text>
        <Text style={typography.body}>{t('One token pays for one successful video find. Purchased tokens do not expire.')}</Text>
      </View>
      {([20,50,200] as const).map(quantity=>{
        const offer=plus.tokenOffers?.find(p=>p.quantity===quantity);
        return <Card key={quantity}><View style={{gap:12}}>
          <Text style={typography.eyebrow}>{t(packNames[quantity])}</Text>
          <Text accessibilityRole="header" style={typography.title}>{t('{{count}} tokens',{count:quantity})}</Text>
          {offer ? <Button title={t('Buy {{count}} tokens · {{price}}',{count:quantity,price:offer.price})} variant="secondary"
            onPress={()=>void transact(offer)} disabled={purchaseBlocked} loading={busy}/>
            : <Text style={typography.caption}>{t('Store price unavailable. This package cannot be purchased yet.')}</Text>}
        </View></Card>;
      })}
      <Text style={typography.caption}>{t('Plus is used first, then monthly free finds, then purchased tokens.')}</Text>
    </>}
    <Text style={typography.body}>{t('Free includes {{count}} successful video finds each calendar month.',{count:3})} (UTC)</Text>
    <Text style={typography.caption}>{t('One video counts once, even when it contains several places. Failed searches do not use your allowance.')}</Text>
    <Text style={typography.caption}>{t('Quick Check reserves a find until you save or the reservation expires. Monthly free finds do not roll over.')}</Text>
    {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={typography.body}>{t(message)}</Text>}
    {!plus.freeOnly && <View style={{gap:8}}>
      <Button title={t('Restore Purchases')} variant="secondary" onPress={()=>void recover(true)} disabled={preview||busy||!plus.canManage}/>
      <Text style={typography.caption}>{t('Restore reconnects verified purchases to your account. Spent tokens are not restored.')}</Text>
      <Button title={t('Manage Subscription')} variant="ghost" disabled={preview} onPress={()=>{if(!preview)void Linking.openURL(PLUS_MANAGE_URL).catch(()=>setMessage('Open your Apple account settings to manage subscriptions.'));}}/>
    </View>}
    <Button title={t('Refresh balance')} variant="ghost" onPress={()=>{if(!preview)void plus.refresh();}} disabled={preview||busy||plus.loading}/>
    <Button title={t('Terms of Service')} variant="ghost" onPress={()=>router.push('/legal/terms')}/>
    <Button title={t('Privacy Policy')} variant="ghost" onPress={()=>router.push('/legal/privacy')}/>
  </ScrollView></Screen>;
}
