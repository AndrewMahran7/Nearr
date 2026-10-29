import de from './de.json';
import enUS from './en-US.json';
import esES from './es-ES.json';
import esMX from './es-MX.json';
import fr from './fr.json';
import it from './it.json';
import ja from './ja.json';
import ko from './ko.json';
import ptBR from './pt-BR.json';
import zhHans from './zh-Hans.json';
import { paidMonetizationTranslations as paid } from './paidMonetization';

export const resources = {
  'en-US': { translation: {...enUS,...paid['en-US']} },
  'es-MX': { translation: {...esMX,...paid['es-MX']} },
  'es-ES': { translation: {...esES,...paid['es-ES']} },
  'pt-BR': { translation: {...ptBR,...paid['pt-BR']} },
  fr: { translation: {...fr,...paid.fr} },
  de: { translation: {...de,...paid.de} },
  it: { translation: {...it,...paid.it} },
  ja: { translation: {...ja,...paid.ja} },
  ko: { translation: {...ko,...paid.ko} },
  'zh-Hans': { translation: {...zhHans,...paid['zh-Hans']} },
} as const;
