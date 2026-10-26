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

export const resources = {
  'en-US': { translation: enUS },
  'es-MX': { translation: esMX },
  'es-ES': { translation: esES },
  'pt-BR': { translation: ptBR },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  ja: { translation: ja },
  ko: { translation: ko },
  'zh-Hans': { translation: zhHans },
} as const;
