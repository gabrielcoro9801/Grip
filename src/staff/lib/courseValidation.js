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

export function timeOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

export function getDayOfWeekFromDate(dateStr) {
  if (!dateStr) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(dateStr + "T00:00:00");
  return days[d.getDay()];
}