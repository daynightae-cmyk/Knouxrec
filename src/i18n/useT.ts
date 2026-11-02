import { useAppLanguage } from "../state/SettingsContext";
import { translate } from "./translate";

/**
 * Translation bound to the language in the settings store.
 *
 * Views build their own `t` from props; shared components use this so they can
 * translate without every call site threading a function down. Falls back to
 * English outside a provider rather than throwing.
 */
export function useT(): (key: string) => string {
  const language = useAppLanguage();
  return (key: string) => translate(language, key);
}
