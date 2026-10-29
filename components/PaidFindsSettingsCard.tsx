import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlus } from '@/hooks/usePlus';
import { useTheme } from '@/lib/theme';
import { t } from '@/lib/i18n';
import { Button } from './Button';
import { Card } from './Card';
import { PaidFindsBalance } from './PaidFindsBalance';

export function PaidFindsSettingsCard() {
  const plus=usePlus(); const router=useRouter(); const {typography,colors}=useTheme();
  if (!plus.userId) return null;
  return <Card><View style={{gap:16}}>
    {plus.loading ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('Loading subscription')} />
      : plus.status ? <PaidFindsBalance status={plus.status} />
      : <Text style={typography.body}>{t('Balance is unavailable. Check your connection and refresh.')}</Text>}
    <Button title={t('Finds, Plus and tokens')} variant="secondary" onPress={()=>router.push('/plus')} />
  </View></Card>;
}
