import React, { useState, useEffect } from "react";
import { caricaDocumenti } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { FileText, Download, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { formatData } from "@/core/domain/format";

export default function MemberDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    caricaDocumenti()
      .then(setDocuments)
      .finally(() => setLoading(false));
  }, []);

  // Se un documento sia scaduto o in scadenza lo dice il server. Stava qui, con la soglia
  // dei trenta giorni scritta dentro la pagina — e quella dei sette nella schermata
  // iniziale: la stessa politica in due punti, dove nessuno la cerca. Alla pagina resta
  // solo come mostrarla.
  const statoScadenza = (doc) => {
    if (!doc.scadenza) return null;
    if (doc.scaduto) return { label: "Scaduto", variant: "destructive", icon: AlertCircle };
    if (doc.in_scadenza) return { label: `In scadenza (${doc.giorni_alla_scadenza}g)`, variant: "secondary", icon: Clock };
    return { label: "Valido", variant: "default", icon: CheckCircle };
  };

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Documenti</h1>
        <p className="text-sm text-muted-foreground">I tuoi documenti caricati dallo staff</p>
      </div>

      {documents.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nessun documento disponibile</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map(doc => {
            const expiry = statoScadenza(doc);
            return (
              <Card key={doc.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm">{doc.tipo}</h3>
                      <p className="text-xs text-muted-foreground">
                        Caricato il {formatData(doc.caricato_il, "media")}
                        {doc.caricato_da && ` da ${doc.caricato_da}`}
                      </p>
                      {doc.note && <p className="text-xs text-muted-foreground mt-1">{doc.note}</p>}
                      {expiry && (
                        <Badge variant={expiry.variant} className="mt-2 text-xs flex items-center gap-1 w-fit">
                          <expiry.icon className="w-3 h-3" />
                          {expiry.label}
                        </Badge>
                      )}
                    </div>
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" download={doc.nome_file}>
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
                          <Download className="w-4 h-4 text-primary" />
                        </div>
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}