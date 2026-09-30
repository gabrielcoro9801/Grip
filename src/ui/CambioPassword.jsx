import React, { useState } from "react";
import { api } from "@/core/api/client";
import { motivoPasswordNonValida, LUNGHEZZA_MINIMA_PASSWORD } from "@/core/domain/password";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { AlertCircle, KeyRound, LogOut } from "lucide-react";

/**
 * Il modulo per cambiare la propria password: attuale, nuova, e la nuova una seconda volta.
 *
 * Sta in ui/ perché lo usano gestionale e portale, con la stessa regola (shared/password.js).
 * Il server chiude tutte le altre sessioni dell'account e rimanda un token nuovo per questa,
 * che il client tiene: chi ha appena cambiato la password resta dentro.
 *
 * @param onCambiata riceve l'utente aggiornato dal server.
 */
export function ModuloCambioPassword({ onCambiata, onAnnulla, testoConferma = "Cambia password" }) {
  const [form, setForm] = useState({ attuale: "", nuova: "", conferma: "" });
  const [errore, setErrore] = useState("");
  const [invio, setInvio] = useState(false);
  const imposta = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });

  const invia = async (e) => {
    e.preventDefault();
    setErrore("");
    const nonValida = motivoPasswordNonValida(form.nuova);
    if (nonValida) return setErrore(nonValida);
    if (form.nuova !== form.conferma) return setErrore("Le due password nuove non coincidono.");
    setInvio(true);
    try {
      const utente = await api.auth.changePassword(form.attuale, form.nuova);
      setForm({ attuale: "", nuova: "", conferma: "" });
      onCambiata?.(utente);
    } catch (err) {
      setErrore(err.message || "Password non cambiata.");
    } finally {
      setInvio(false);
    }
  };

  return (
    <form onSubmit={invia} className="space-y-3">
      <div>
        <Label htmlFor="pwd-attuale">Password attuale</Label>
        <Input id="pwd-attuale" type="password" autoComplete="current-password" required value={form.attuale} onChange={imposta("attuale")} />
      </div>
      <div>
        <Label htmlFor="pwd-nuova">Nuova password</Label>
        <Input
          id="pwd-nuova" type="password" autoComplete="new-password" required minLength={LUNGHEZZA_MINIMA_PASSWORD}
          value={form.nuova} onChange={imposta("nuova")} placeholder={`Almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`}
        />
      </div>
      <div>
        <Label htmlFor="pwd-conferma">Ripeti la nuova password</Label>
        <Input id="pwd-conferma" type="password" autoComplete="new-password" required value={form.conferma} onChange={imposta("conferma")} />
      </div>

      {errore && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errore}</span>
        </div>
      )}

      <div className="flex gap-2">
        {onAnnulla && (
          <Button type="button" variant="outline" className="flex-1" onClick={onAnnulla} disabled={invio}>Annulla</Button>
        )}
        <Button type="submit" className="flex-1" disabled={invio}>
          <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
          {invio ? "Salvataggio…" : testoConferma}
        </Button>
      </div>
    </form>
  );
}

/**
 * La pagina che blocca tutto finché la password non è cambiata.
 *
 * Compare quando la password l'ha scelta qualcun altro (reset, reception, primo avvio). Il
 * server rifiuta comunque ogni altra richiesta: questa è la schermata che spiega perché.
 */
export function CambioPasswordObbligatorio({ nome, onCambiata, onEsci }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <KeyRound className="w-7 h-7 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-heading font-bold">Scegli una nuova password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {nome ? `${nome}, la` : "La"} password che stai usando te l'ha data qualcun altro.
            Prima di continuare scegline una che conosci solo tu.
          </p>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <ModuloCambioPassword onCambiata={onCambiata} testoConferma="Salva e continua" />
          </CardContent>
        </Card>
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onEsci}>
          <LogOut className="w-4 h-4 mr-1" aria-hidden="true" /> Esci
        </Button>
      </div>
    </div>
  );
}

/** Il cambio volontario, in una finestra. */
export function DialogCambioPassword({ open, onClose, onCambiata }) {
  return (
    <Dialog open={open} onOpenChange={(aperto) => { if (!aperto) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Cambia password</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Le sessioni aperte su altri dispositivi verranno chiuse.
        </p>
        <ModuloCambioPassword onAnnulla={onClose} onCambiata={(utente) => { onCambiata?.(utente); onClose(); }} />
      </DialogContent>
    </Dialog>
  );
}
