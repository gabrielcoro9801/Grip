import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, Plus, History } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import SnapshotView from "@/components/profilo-fiscale/SnapshotView";
import SnapshotForm from "@/components/profilo-fiscale/SnapshotForm";
import SnapshotStorico from "@/components/profilo-fiscale/SnapshotStorico";
import FiscalYearTable from "@/components/profilo-fiscale/FiscalYearTable";
import DatiFatturazione from "@/components/profilo-fiscale/DatiFatturazione";
import { useToast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/shared/Spinner";

export default function ProfiloFiscale() {
  const { organization } = useOrganization();
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState([]);
  const [fiscalYears, setFiscalYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState(null);

  const loadData = async () => {
    if (!organization?.id) return;
    try {
      const [snaps, years] = await Promise.all([
        api.entities.FiscalProfileSnapshot.filter({ organization_id: organization.id }),
        api.entities.FiscalYearData.filter({ organization_id: organization.id }),
      ]);
      setSnapshots(snaps);
      setFiscalYears(years);
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [organization?.id]);

  const today = new Date().toISOString().split("T")[0];
  const currentSnapshot = snapshots
    .filter(s => s.data_decorrenza && s.data_decorrenza <= today)
    .sort((a, b) => new Date(b.data_decorrenza) - new Date(a.data_decorrenza))[0];
  const storico = [...snapshots].sort((a, b) => new Date(b.data_decorrenza) - new Date(a.data_decorrenza));

  const handleNewUpdate = () => { setEditingSnapshot(null); setShowForm(true); };
  const handleEditSnapshot = (snap) => { setEditingSnapshot(snap); setShowForm(true); };
  const handleDeleteSnapshot = async (snap) => {
    if (!confirm(`Eliminare lo snapshot con decorrenza ${snap.data_decorrenza}?`)) return;
    await api.entities.FiscalProfileSnapshot.delete(snap.id);
    toast({ title: "Snapshot eliminato" });
    loadData();
  };

  if (loading) {
    return <LoadingState minHeight="h-64" />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Profilo Fiscale" description="Inquadramento fiscale dell'ente nel tempo">
        <Button onClick={handleNewUpdate} size="sm"><Plus className="w-4 h-4 mr-1" /> Registra un aggiornamento</Button>
      </PageHeader>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800">
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p className="text-sm">
          Gli snapshot qui sotto tracciano l'inquadramento fiscale del tuo ente nel tempo: non influenzano nessun calcolo dell'app, servono a ricostruire com'era la situazione a una certa data. I <strong>dati per la fattura elettronica</strong>, invece, vengono usati davvero — finiscono nel file trasmesso allo SdI. Verifica sempre con il tuo commercialista.
        </p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading">Profilo attualmente in vigore</CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotView snapshot={currentSnapshot} />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading flex items-center gap-2"><History className="w-4 h-4" /> Storico snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotStorico snapshots={storico} currentId={currentSnapshot?.id} onEdit={handleEditSnapshot} onDelete={handleDeleteSnapshot} />
        </CardContent>
      </Card>

      <DatiFatturazione organization={organization} onSaved={loadData} />

      <FiscalYearTable organization={organization} years={fiscalYears} onRefresh={loadData} />

      <SnapshotForm
        open={showForm}
        onClose={() => setShowForm(false)}
        organization={organization}
        currentSnapshot={currentSnapshot}
        editingSnapshot={editingSnapshot}
        onSaved={() => { setShowForm(false); loadData(); }}
      />
    </div>
  );
}