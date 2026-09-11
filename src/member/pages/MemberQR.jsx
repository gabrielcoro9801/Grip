import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { AlertCircle, CheckCircle, Timer } from "lucide-react";
import { qrDataUrl } from "@/ui/qr/qrImmagine";
import { useQrDinamico } from "@/ui/hooks/useQrDinamico";
import { DURATA_FINESTRA_MS } from "../../../shared/qrDinamico.js";
import StatusBadge from "@/ui/StatusBadge";
import moment from "moment";
import { LoadingState } from "@/ui/Spinner";
import { formatData } from "@/core/domain/format";

const SECONDI_FINESTRA = DURATA_FINESTRA_MS / 1000;

export default function MemberQR() {
  const { memberUser } = useMemberAuth();
  const [qr, setQr] = useState(null);
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    (async () => {
      const [m, subs, qrs] = await Promise.all([
        api.entities.Member.get(memberUser.member_id),
        api.entities.Subscription.filter({ member_id: memberUser.member_id }),
        api.entities.QRAccesso.filter({ cliente_id: memberUser.member_id }),
      ]);
      setMember(m);
      setSubscriptions(subs);
      // La credenziale la emette la palestra, non il socio.
      //
      // Prima questa schermata se la creava da sola quando non la trovava, e siccome
      // nessuno controllava lo `stato` dichiarato, bastava aprirla dopo essere stati
      // revocati per rifarsene una attiva: la revoca durava fino alla successiva visita
      // del socio. Ora se non c'è, non c'è, e lo si dice.
      setQr(qrs[0] ?? null);
      setLoading(false);
    })();
  }, [memberUser?.member_id]);

  const isRevoked = qr?.stato === "revocato";
  // Il codice lo firma il server: qui si dice solo per chi (sé stessi) e se ha senso
  // chiederlo. Un QR revocato non si chiede nemmeno.
  const { codice, secondiResidui, stato, errore } = useQrDinamico(null, !isRevoked);
  const [immagine, setImmagine] = useState(null);

  // Il disegno del QR si rifà a ogni codice nuovo, cioè una volta al minuto, e resta sul
  // dispositivo: prima l'immagine la produceva un servizio esterno, e la credenziale
  // finiva nei suoi log a ogni apertura della schermata.
  useEffect(() => {
    let vivo = true;
    if (!codice) { setImmagine(null); return undefined; }
    qrDataUrl(codice, 300).then((url) => { if (vivo) setImmagine(url); }).catch(() => {});
    return () => { vivo = false; };
  }, [codice]);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  const activeSub = subscriptions.find(s => s.status === "active");
  const daysToExpiry = activeSub ? moment(activeSub.end_date).diff(moment(), "days") : null;
  const canAccess = activeSub && daysToExpiry >= 0 && !isRevoked;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-heading font-bold">QR accesso</h1>
        <p className="text-sm text-muted-foreground">{member?.full_name || memberUser.nome}</p>
      </div>

      {/* QR Code */}
      <Card className="border-0 shadow-lg w-full max-w-xs">
        <CardContent className="p-6 flex flex-col items-center gap-4">
          {isRevoked ? (
            <div className="w-56 h-56 rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-3">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <p className="text-sm text-destructive font-medium text-center px-4">
                QR revocato. Rivolgiti alla reception.
              </p>
            </div>
          ) : errore ? (
            <div className="w-56 h-56 rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-3">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <p className="text-sm text-destructive font-medium text-center px-4">
                Impossibile generare il codice su questa connessione. Rivolgiti alla reception.
              </p>
            </div>
          ) : stato === "assente" ? (
            <div className="w-56 h-56 rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-3">
              <AlertCircle className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground font-medium text-center px-4">
                Non hai ancora un codice d'accesso. Chiedilo alla reception.
              </p>
            </div>
          ) : !immagine ? (
            <div className="w-56 h-56 rounded-xl bg-muted/30 animate-pulse" />
          ) : (
            <div className="relative">
              <img
                src={immagine}
                alt="QR accesso"
                className="w-56 h-56 rounded-xl"
              />
              {!canAccess && (
                <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center">
                  <div className="text-center">
                    <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-1" />
                    <p className="text-xs text-destructive font-medium">Abbonamento non attivo</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isRevoked && !errore && (
            <div className="w-full space-y-2">
              {/* Il conto alla rovescia non è un vezzo: dice a chi lo mostra che il codice
                  sta per cambiare, invece di farglielo scoprire alla porta. */}
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Timer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Cambia tra {secondiResidui}s</span>
              </div>
              <div
                className="h-1 w-full rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-label="Tempo residuo del codice"
                aria-valuemin={0}
                aria-valuemax={SECONDI_FINESTRA}
                aria-valuenow={secondiResidui}
              >
                <div
                  className="h-full bg-primary transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(secondiResidui / SECONDI_FINESTRA) * 100}%` }}
                />
              </div>
              <div className="text-center pt-1">
                <p className="text-xs text-muted-foreground">Codice</p>
                <p className="font-mono text-sm font-medium break-all">{codice || "—"}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscription status */}
      <Card className="border-0 shadow-sm w-full max-w-xs">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Stato abbonamento</span>
            {activeSub ? <StatusBadge status={activeSub.status} /> : <Badge variant="destructive">Nessuno</Badge>}
          </div>
          {activeSub && (
            <p className="text-xs text-muted-foreground mt-1">
              {activeSub.plan_name} — scade il {formatData(activeSub.end_date, "media")}
            </p>
          )}
          {canAccess ? (
            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-success/10 border border-success/30 text-success text-xs">
              <CheckCircle className="w-4 h-4" /> Accesso consentito
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
              <AlertCircle className="w-4 h-4" /> Accesso non consentito
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Il codice cambia ogni minuto: uno screenshot inviato a qualcun altro scade prima di
        poter essere usato. Mostralo dal telefono al momento dell'ingresso.
      </p>
    </div>
  );
}
