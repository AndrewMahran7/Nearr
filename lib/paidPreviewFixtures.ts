import type { usePlus } from '../hooks/usePlus';
import type { PlusStatus, TokenOffer } from './plusClient';
import { paidUsage } from './paidClientModel';
import { PLUS_PRODUCT_ID } from './plusEntitlements';

/** Presentation fixtures only; never passed to auth, StoreKit or a backend. */
export function paidPreviewFixture(mode:string,locale:string):ReturnType<typeof usePlus> {
  const now=new Date(); const active=['active','cancelled','grace'].includes(mode);
  const price=(n:number)=>new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(n);
  const status:PlusStatus={ok:true,releaseMode:'paid',subscriptionBenefit:'unlimited',catalogVerified:true,
    salesEnabled:true,purchaseEligible:true,restoreAvailable:true,appUserId:'fixture-only',offeringId:'fixture-only',
    productId:PLUS_PRODUCT_ID,freeFinds:3,plusFinds:null,tokenPurchasesReady:true,
    usage:{unlimited:active,paid:active,verificationRequired:false,canSubmit:true,paymentPriority:'plus_free_tokens',
      free:{limit:3,used:1,reserved:1,remaining:1,periodStart:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(),resetAt:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString()},
      tokens:{available:47,reserved:3,nonExpiring:true}},
    entitlement:['active','cancelled','grace','expired','revoked'].includes(mode)?{
      state:mode as any,productId:PLUS_PRODUCT_ID,verifiedAt:now.toISOString(),periodStart:new Date(now.getTime()-86400000).toISOString(),
      expiresAt:new Date(now.getTime()+(active?86400000:-86400000)).toISOString(),accessUntil:new Date(now.getTime()+(active?86400000:-86400000)).toISOString(),environment:'SANDBOX',periodKey:'fixture-only'}:null};
  const unavailable=['unavailable','offline','loading','restricted'].includes(mode);
  const tokenOffers:TokenOffer[]=unavailable?[]:([20,50,200] as const).map((quantity,i)=>({quantity,productId:`com.nearr.tokens.${quantity}.v2`,price:price([1.19,2.49,5][i]),package:{}}));
  const offer=active||unavailable?null:{productId:PLUS_PRODUCT_ID,price:price(1.99),package:{}};
  if(mode==='restricted'){status.purchaseEligible=false;status.salesEnabled=false;status.purchaseBlockedReason='purchase_ineligible';}
  return {userId:'fixture-only',status:['offline','loading'].includes(mode)?null:status,offer,tokenOffers,purchasePending:mode==='pending',usage:paidUsage(status.usage),
    loading:mode==='loading',refresh:async()=>{},freeOnly:false,canOffer:!!offer&&mode!=='pending',hasPlus:active,canManage:!unavailable};
}
