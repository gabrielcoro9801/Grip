import React from "react";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { SESSI, codiceFiscaleValido, normalizzaCodiceFiscale } from "@/core/domain/anagrafica";

// Il consenso GDPR non è più fra i campi: non lo dà la segreteria, lo darà il socio dal portale.
// Toglierlo da qui vuol dire anche che correggere un'anagrafica non lo sovrascrive più.
export const ANAGRAFICA_VUOTA = {
  nome: "",
  cognome: "",
  sesso: "",
  codice_fiscale: "",
  email: "",
  phone: "",
  date_of_birth: "",
  address: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
};

/** Solo i campi dell'anagrafica, a partire da un socio letto dall'API. */
export function anagraficaDi(socio) {
  return Object.fromEntries(Object.keys(ANAGRAFICA_VUOTA).map((k) => [k, socio?.[k] ?? ANAGRAFICA_VUOTA[k]]));
}

/**
 * Cosa manca perché l'anagrafica si possa salvare, o null.
 *
 * Il server fa lo stesso controllo (entities/hooks.js): qui serve a tenere spento il pulsante
 * invece di far partire una richiesta destinata a tornare indietro.
 */
export function motivoAnagraficaIncompleta(v) {
  if (!v.nome.trim() || !v.cognome.trim()) return "Nome e cognome sono obbligatori.";
  if (!v.sesso) return "Indica il sesso.";
  if (!v.codice_fiscale.trim()) return "Il codice fiscale è obbligatorio.";
  if (!codiceFiscaleValido(v.codice_fiscale)) return "Il codice fiscale non è valido.";
  return null;
}

/**
 * L'anagrafica di un socio: la stessa quando lo si crea, quando la si corregge e quando un lead
 * diventa socio. Tre copie del modulo sarebbero diventate tre elenchi di campi diversi.
 *
 * L'ordine è quello in cui la segreteria chiede i dati allo sportello: chi è (nome, cognome,
 * codice fiscale, nascita, sesso), dove vive, come si raggiunge, chi chiamare in emergenza.
 * Una griglia sola a due colonne: da sinistra a destra e dall'alto in basso l'ordine resta
 * quello, anche col tasto Tab e su telefono, dove le colonne diventano una.
 *
 * `suggerimentoNascita` è un testo accanto alla data di nascita: nella trasformazione ricorda
 * l'anno che il lead aveva indicato.
 */
export default function CampiAnagrafica({ valori, onChange, suggerimentoNascita }) {
  // Aggiornamenti a funzione, non a partire da `valori`: due modifiche ravvicinate (il sesso
  // scelto dal menu e il campo dopo) partivano dalla stessa copia, e la seconda cancellava la
  // prima. `onChange` è sempre un setter di useState, che accetta una funzione.
  const aggiorna = (campo, valore) => onChange((v) => ({ ...v, [campo]: valore }));
  const imposta = (campo) => (e) => aggiorna(campo, e.target.value);
  const cfScritto = valori.codice_fiscale.trim().length > 0;
  // Si segnala solo a codice completo: dire "non valido" alla terza lettera non aiuta nessuno.
  const cfCompleto = normalizzaCodiceFiscale(valori.codice_fiscale).length >= 16;
  const cfErrato = cfScritto && cfCompleto && !codiceFiscaleValido(valori.codice_fiscale);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label htmlFor="anag-nome">Nome *</Label>
        <Input id="anag-nome" required value={valori.nome} onChange={imposta("nome")} autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="anag-cognome">Cognome *</Label>
        <Input id="anag-cognome" required value={valori.cognome} onChange={imposta("cognome")} autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="anag-cf">Codice fiscale *</Label>
        <Input
          id="anag-cf"
          required
          value={valori.codice_fiscale}
          onChange={(e) => aggiorna("codice_fiscale", e.target.value.toUpperCase())}
          maxLength={16}
          className="font-mono uppercase"
          aria-invalid={cfErrato}
          aria-describedby={cfErrato ? "anag-cf-errore" : undefined}
          autoComplete="off"
        />
        {cfErrato && (
          <p id="anag-cf-errore" className="text-xs text-destructive mt-1">Codice non valido: controlla di averlo scritto bene.</p>
        )}
      </div>
      <div>
        <Label htmlFor="anag-nascita">Data di nascita</Label>
        <Input id="anag-nascita" type="date" value={valori.date_of_birth ?? ""} onChange={imposta("date_of_birth")} />
        {suggerimentoNascita && <p className="text-xs text-muted-foreground mt-1">{suggerimentoNascita}</p>}
      </div>
      <div>
        <Label>Sesso *</Label>
        <Select value={valori.sesso || undefined} onValueChange={(sesso) => aggiorna("sesso", sesso)}>
          <SelectTrigger aria-label="Sesso"><SelectValue placeholder="Scegli" /></SelectTrigger>
          <SelectContent>
            {SESSI.map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        {/* La colonna resta `address`: cambia il nome che si legge, non il dato. */}
        <Label htmlFor="anag-residenza">Residenza</Label>
        <Input id="anag-residenza" value={valori.address} onChange={imposta("address")} placeholder="Via, civico, CAP, comune" />
      </div>
      <div>
        <Label htmlFor="anag-telefono">Telefono</Label>
        <Input id="anag-telefono" type="tel" value={valori.phone} onChange={imposta("phone")} />
      </div>
      <div>
        <Label htmlFor="anag-email">Email</Label>
        <Input id="anag-email" type="email" value={valori.email} onChange={imposta("email")} />
      </div>
      <div>
        <Label htmlFor="anag-emergenza">Contatto di emergenza</Label>
        <Input id="anag-emergenza" value={valori.emergency_contact_name} onChange={imposta("emergency_contact_name")} />
      </div>
      <div>
        <Label htmlFor="anag-emergenza-tel">Telefono di emergenza</Label>
        <Input id="anag-emergenza-tel" type="tel" value={valori.emergency_contact_phone} onChange={imposta("emergency_contact_phone")} />
      </div>
    </div>
  );
}
