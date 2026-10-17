import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, type Lang } from "./i18n";

// The language this browser picked (the English | 中文 switch). English until it is changed.
export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}
