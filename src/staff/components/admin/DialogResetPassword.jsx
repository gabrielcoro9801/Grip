import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";

// La password temporanea la genera qrUtils, con lo stesso generatore crittografico del
// seme d'accesso: Math.random() e prevedibile, e questa e una credenziale.
import { generaPasswordTemporanea as passwordTemporanea } from "@/staff/lib/qrUtils";

/**
 * Reimposta la password di un account, staff o socio che sia.
 *
 * Esisteva due volte con lo stesso alfabeto e la stessa lunghezza copiati a mano — in
 * Admin e nella scheda del socio. Il registro delle azioni lo scrive il server.
 */
export default function DialogResetPassword({ account, onClose, onDone }) {
	const { toast } = useToast();
	const [generata, setGenerata] = useState("");
	const [saving, setSaving] = useState(false);

	const genera = async () => {
		setSaving(true);
		try {
			const pwd = passwordTemporanea();
			await api.entities.StaffAccount.update(account.id, { password: pwd });
			setGenerata(pwd);
			toast({ title: "Password reimpostata" });
			onDone?.();
		} catch (err) {
			toast({ title: "Errore", description: err.message, variant: "destructive" });
		}
		setSaving(false);
	};

	return (
		<Dialog open onOpenChange={(aperto) => { if (!aperto) { setGenerata(""); onClose(); } }}>
			<DialogContent className="max-w-sm">
				<DialogHeader><DialogTitle>Reimposta password — {account.nome}</DialogTitle></DialogHeader>
				{generata ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">Nuova password temporanea:</p>
						<div className="p-3 rounded-lg bg-muted font-mono text-lg text-center break-all">{generata}</div>
						<p className="text-xs text-warning">
							Comunicala alla persona: non sarà più visibile dopo aver chiuso questa finestra. Al
							primo accesso dovrà sceglierne una sua.
						</p>
						<Button className="w-full" onClick={() => { setGenerata(""); onClose(); }}>Chiudi</Button>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							Verrà generata una nuova password temporanea per <strong>{account.nome}</strong>.
							Quella attuale smette subito di funzionare, e chi è già collegato viene fatto uscire.
						</p>
						<Button className="w-full" onClick={genera} disabled={saving}>
							{saving ? "Generazione…" : "Genera nuova password"}
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
