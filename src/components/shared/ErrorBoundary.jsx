import React from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * L'ultima rete, quando una schermata smette di funzionare.
 *
 * Senza, un errore dentro un componente porta via **tutta** l'applicazione: React smonta
 * l'albero e resta una pagina bianca, senza un messaggio, senza un pulsante, senza niente
 * che dica cosa fare. Non è un'ipotesi — è già successo in questo progetto: una icona tolta
 * da un import lasciava la scheda del socio completamente vuota, e dall'esterno sembrava
 * che l'applicazione fosse morta.
 *
 * Qui l'errore resta confinato: si spiega cosa è successo, si offre di riprovare e di
 * tornare a casa. Il dettaglio tecnico si mostra solo in sviluppo, perché a chi sta usando
 * il gestionale non serve e in produzione racconterebbe più del dovuto.
 *
 * Deve essere una classe: `componentDidCatch` non ha un equivalente fra gli hook.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errore: null };
  }

  static getDerivedStateFromError(errore) {
    return { errore };
  }

  componentDidCatch(errore, info) {
    // In produzione qui andrebbe un servizio di raccolta errori. Intanto resta in console:
    // è comunque più di quanto si avesse prima, che era una pagina bianca e basta.
    console.error("Errore non gestito nell'interfaccia:", errore, info?.componentStack);
  }

  riprova = () => {
    this.setState({ errore: null });
  };

  render() {
    if (!this.state.errore) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-background"
      >
        <AlertCircle className="w-10 h-10 text-destructive" aria-hidden="true" />
        <div className="space-y-1 max-w-md">
          <h1 className="text-lg font-heading font-semibold text-foreground">
            Questa schermata si è bloccata
          </h1>
          <p className="text-sm text-muted-foreground">
            Non è colpa di quello che hai fatto. Riprova: se succede di nuovo, segnala
            quando è capitato e cosa stavi aprendo.
          </p>
        </div>

        {import.meta.env.DEV && (
          <pre className="text-xs text-left text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3 max-w-xl overflow-auto max-h-48">
            {String(this.state.errore?.stack || this.state.errore)}
          </pre>
        )}

        <div className="flex gap-2">
          <Button onClick={this.riprova}>
            <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" /> Riprova
          </Button>
          {/* Un ricaricamento vero, non una navigazione: se lo stato in memoria è quello
              rotto, riportarlo in vita non serve a niente. */}
          <Button variant="outline" onClick={() => { window.location.href = "/"; }}>
            <Home className="w-4 h-4 mr-1" aria-hidden="true" /> Torna all'inizio
          </Button>
        </div>
      </div>
    );
  }
}
