import { useLocation, Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * L'indirizzo che non porta da nessuna parte.
 *
 * Era rimasta l'unica schermata scritta col vecchio impianto: colori fissi invece dei
 * token del tema — quindi sarebbe restata bianca in tema scuro — e testo in inglese in
 * mezzo a un'applicazione tutta in italiano.
 */
export default function PageNotFound() {
    const location = useLocation();
    const percorso = location.pathname;

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="space-y-2">
                    <p className="text-7xl font-light text-muted-foreground/40">404</p>
                    <div className="h-0.5 w-16 bg-border mx-auto" />
                </div>

                <div className="space-y-3">
                    <h1 className="text-2xl font-heading font-medium text-foreground">
                        Questa pagina non esiste
                    </h1>
                    <p className="text-muted-foreground leading-relaxed">
                        L'indirizzo{' '}
                        <span className="font-mono text-sm text-foreground break-all">{percorso}</span>{' '}
                        non corrisponde a niente. Può darsi che sia un collegamento vecchio,
                        o che ci sia un refuso.
                    </p>
                </div>

                <div className="pt-2">
                    {/* Un collegamento del router, non un ricaricamento della pagina: da qui
                        si torna dentro l'applicazione senza riscaricarla da capo. */}
                    <Button asChild variant="outline">
                        <Link to="/">
                            <Home className="w-4 h-4 mr-2" aria-hidden="true" />
                            Torna all'inizio
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
