import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Receipt as ReceiptIcon, Download } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";

export default function MemberReceipts() {
  const { memberUser } = useMemberAuth();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    base44.entities.Receipt.filter({ member_id: memberUser.member_id }, "-data_emissione").then(recs => {
      setReceipts(recs);
      setLoading(false);
    });
  }, [memberUser?.member_id]);

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Ricevute</h1>
        <p className="text-sm text-muted-foreground">Storico dei tuoi pagamenti</p>
      </div>

      {receipts.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <ReceiptIcon className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nessuna ricevuta disponibile</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {receipts.map(rec => (
            <Card key={rec.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <ReceiptIcon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm">
                        {rec.plan_name || rec.tipo_documento || "Ricevuta"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {moment(rec.data_emissione || rec.date).format("D MMM YYYY")}
                        {rec.numero_progressivo && ` · N° ${rec.numero_progressivo}`}
                      </p>
                      <p className="text-sm font-semibold mt-1">
                        € {(rec.importo_lordo || rec.amount || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={rec.payment_status || rec.stato} />
                    {rec.pdf_url && (
                      <a href={rec.pdf_url} target="_blank" rel="noopener noreferrer" download>
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
                          <Download className="w-4 h-4 text-primary" />
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}