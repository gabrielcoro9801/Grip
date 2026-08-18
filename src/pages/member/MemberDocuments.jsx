import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, AlertCircle, CheckCircle, Clock } from "lucide-react";
import moment from "moment";

export default function MemberDocuments() {
  const { memberUser } = useMemberAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    api.entities.MemberDocument.filter({ member_id: memberUser.member_id }, "-created_date").then(docs => {
      setDocuments(docs);
      setLoading(false);
    });
  }, [memberUser?.member_id]);

  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const days = moment(expiryDate).diff(moment(), "days");
    if (days < 0) return { label: "Scaduto", variant: "destructive", icon: AlertCircle };
    if (days <= 30) return { label: `In scadenza (${days}g)`, variant: "secondary", icon: Clock };
    return { label: "Valido", variant: "default", icon: CheckCircle };
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
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
            const expiry = getExpiryStatus(doc.expiry_date);
            return (
              <Card key={doc.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm">{doc.document_type}</h3>
                      <p className="text-xs text-muted-foreground">
                        Caricato il {moment(doc.created_date).format("D MMM YYYY")}
                        {doc.caricato_da && ` da ${doc.caricato_da}`}
                      </p>
                      {doc.notes && <p className="text-xs text-muted-foreground mt-1">{doc.notes}</p>}
                      {expiry && (
                        <Badge variant={expiry.variant} className="mt-2 text-xs flex items-center gap-1 w-fit">
                          <expiry.icon className="w-3 h-3" />
                          {expiry.label}
                        </Badge>
                      )}
                    </div>
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer" download={doc.file_name}>
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