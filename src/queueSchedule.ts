/** True when `now` falls before today's `HH:MM` — i.e. the scheduled start
 *  hasn't arrived yet and the queue should stay held.
 *
 *  Malformed input returns false rather than throwing or holding: a bad time
 *  string in settings.json must never leave the queue stuck forever with no
 *  way for the user to tell why nothing is downloading. */
export function isBeforeTarget(now: Date, timeHHMM: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(timeHHMM);
  if (!m) return false;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return false;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  return now < target;
}
