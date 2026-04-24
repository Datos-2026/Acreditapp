import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE } from "./constants";

export function formatDateTimeAr(value: Date | string): string {
  return formatInTimeZone(value, APP_TIMEZONE, "dd/MM/yyyy HH:mm");
}
