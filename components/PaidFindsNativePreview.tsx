import { useEffect,useRef,useState } from 'react';
import { Text } from 'react-native';
import { PaidFindsContent } from '../app/plus';
import { paidPreviewFixture } from '@/lib/paidPreviewFixtures';
import { i18n } from '@/lib/i18n';
import { isOnboardingV2DevelopmentResetAvailable } from '@/lib/onboardingV2DevReset';
import { useTheme,type ThemePreference } from '@/lib/theme';
const locales=['en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans'];
export function PaidFindsNativePreview({state,locale,theme}:{state:string;locale:string;theme?:'light'|'dark'}) {
  const enabled=__DEV__ && isOnboardingV2DevelopmentResetAvailable();
  const requestedLocale=locales.includes(locale)?locale:'en-US';
  const requestedTheme=theme === 'light' || theme === 'dark' ? theme : null;
  const {themePreference,setThemePreference,resolvedTheme,isThemeReady}=useTheme();
  const previousTheme=useRef<ThemePreference|null>(null);
  const [readyLocale,setReadyLocale]=useState<string|null>(null);
  useEffect(()=>{if(!enabled)return;let mounted=true;const previous=i18n.language;
    setReadyLocale(null);
    void i18n.changeLanguage(requestedLocale).then(()=>{if(mounted)setReadyLocale(requestedLocale);}).catch(()=>{if(mounted)setReadyLocale(null);});
    return()=>{mounted=false;void i18n.changeLanguage(previous);};
  },[enabled,requestedLocale]);
  useEffect(()=>{
    if(!enabled||!isThemeReady||!requestedTheme)return;
    // Capture the hydrated preference, once, even if fixture query values change.
    previousTheme.current??=themePreference;
    if(themePreference!==requestedTheme)setThemePreference(requestedTheme);
  },[enabled,isThemeReady,requestedTheme,themePreference,setThemePreference]);
  useEffect(()=>()=>{
    if(previousTheme.current!==null)setThemePreference(previousTheme.current);
  },[setThemePreference]);
  if(!__DEV__||!isOnboardingV2DevelopmentResetAvailable())return null;
  if(readyLocale!==requestedLocale||i18n.language!==requestedLocale||!isThemeReady||
    (requestedTheme&&(themePreference!==requestedTheme||resolvedTheme!==requestedTheme)))return <Text>Loading Development fixture</Text>;
  return <PaidFindsContent preview plus={paidPreviewFixture(state,requestedLocale)}/>;
}
