export const DAYS_IT = {
  Monday: "Lunedì",
  Tuesday: "Martedì",
  Wednesday: "Mercoledì",
  Thursday: "Giovedì",
  Friday: "Venerdì",
  Saturday: "Sabato",
  Sunday: "Domenica",
};

export const DAYS = Object.keys(DAYS_IT);

// Gli orari arrivano in due forme: "09:00" dal modulo, "09:00:00" dal database. Confrontate
// così come sono, "09:00" < "09:00:00" è vero (il prefisso più corto viene prima), e una
// lezione che comincia quando finisce la precedente risultava in conflitto con lei. Si
// confrontano solo ore e minuti.
const hhmm = (t) => String(t ?? "").slice(0, 5);

/** Vera se i due intervalli si sovrappongono; toccarsi agli estremi non è sovrapporsi. */
export function timeOverlap(s1, e1, s2, e2) {
  return hhmm(s1) < hhmm(e2) && hhmm(s2) < hhmm(e1);
}

export function getDayOfWeekFromDate(dateStr) {
  if (!dateStr) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(dateStr + "T00:00:00");
  return days[d.getDay()];
}