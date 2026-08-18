import moment from "moment";

/** Accoppia timbrature entrata/uscita e calcola le ore */
export function pairTimbrature(timbrature) {
  const sorted = [...timbrature].sort(
    (a, b) => new Date(a.data_ora_server) - new Date(b.data_ora_server)
  );
  const pairs = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].tipo === "entrata") {
      const next = sorted[i + 1];
      if (next && next.tipo === "uscita" && next.dipendente_id === sorted[i].dipendente_id) {
        const hours =
          (new Date(next.data_ora_server) - new Date(sorted[i].data_ora_server)) / 3600000;
        pairs.push({ entrata: sorted[i], uscita: next, hours: Math.max(0, hours) });
        i++;
      }
    }
  }
  return pairs;
}

/** Ore totali lavorate in un mese (year=full year, month=0-based) */
export function calcOreMese(timbrature, year, month) {
  return pairTimbrature(timbrature)
    .filter((p) => {
      const d = new Date(p.entrata.data_ora_server);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, p) => sum + p.hours, 0);
}

/** Straordinari: ore settimanali oltre la soglia contrattuale, nel mese selezionato */
export function calcStraordinari(timbrature, sogliaSettimanale = 40, year, month) {
  const pairs = pairTimbrature(timbrature).filter((p) => {
    const d = new Date(p.entrata.data_ora_server);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const byWeek = {};
  pairs.forEach((p) => {
    const weekKey = moment(new Date(p.entrata.data_ora_server)).format("YYYY-WW");
    byWeek[weekKey] = (byWeek[weekKey] || 0) + p.hours;
  });
  return Object.values(byWeek).reduce(
    (sum, hours) => sum + Math.max(0, hours - sogliaSettimanale),
    0
  );
}

/** Conta giorni di ferie approvati in un mese */
export function countFerieGiorni(richieste, year, month) {
  return richieste
    .filter((r) => r.stato === "approvata" && r.tipo === "ferie")
    .reduce((sum, r) => {
      const start = new Date(r.data_inizio + "T00:00:00");
      const end = new Date((r.data_fine || r.data_inizio) + "T00:00:00");
      let days = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() === year && d.getMonth() === month) days++;
      }
      return sum + days;
    }, 0);
}

/** Conta ore di permesso approvate in un mese */
export function countPermessoOre(richieste, year, month) {
  return richieste
    .filter((r) => r.stato === "approvata" && r.tipo === "permesso")
    .reduce((sum, r) => {
      const d = new Date(r.data_inizio + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) return sum + (r.ore || 0);
      return sum;
    }, 0);
}

/** Calcola ferie residue nell'anno corrente */
export function calcFerieResidue(richieste, giorniFerieAnno = 26, year) {
  const used = richieste
    .filter((r) => r.stato === "approvata" && r.tipo === "ferie")
    .reduce((sum, r) => {
      const start = new Date(r.data_inizio + "T00:00:00");
      const end = new Date((r.data_fine || r.data_inizio) + "T00:00:00");
      let days = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() === year) days++;
      }
      return sum + days;
    }, 0);
  return (giorniFerieAnno || 26) - used;
}

/** Genera CSV per export presenze */
export function generaCSVPresenze(righe) {
  const headers = [
    "Dipendente",
    "Mese",
    "Ore Lavorate",
    "Straordinari (h)",
    "Ferie (gg)",
    "Permessi (h)",
  ];
  const lines = [
    headers,
    ...righe.map((r) => [
      r.dipendente,
      r.mese,
      r.oreLavorate.toFixed(1),
      r.straordinari.toFixed(1),
      r.ferieGiorni,
      r.permessoOre.toFixed(1),
    ]),
  ];
  return lines
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

/** Download CSV file */
export function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}