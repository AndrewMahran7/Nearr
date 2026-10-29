import { useEffect,useState } from 'react';
import { Text } from 'react-native';
import { PaidFindsContent } from '../app/plus';
import { paidPreviewFixture } from '@/lib/paidPreviewFixtures';
import { i18n } from '@/lib/i18n';
import { isOnboardingV2DevelopmentResetAvailable } from '@/lib/onboardingV2DevReset';
const locales=['en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans'];
export function PaidFindsNativePreview({state,locale}:{state:string;locale:string}) {
  const [ready,setReady]=useState(false);
  useEffect(()=>{let mounted=true;const previous=i18n.language;
    void i18n.changeLanguage(locales.includes(locale)?locale:'en-US').then(()=>{if(mounted)setReady(true);});
    return()=>{mounted=false;void i18n.changeLanguage(previous);};
  },[locale]);
  if(!__DEV__||!isOnboardingV2DevelopmentResetAvailable())return null;
  if(!ready)return <Text>Loading Development fixture</Text>;
  return <PaidFindsContent preview plus={paidPreviewFixture(state,locale)}/>;
}
