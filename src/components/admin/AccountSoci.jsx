import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { logAction } from "@/lib/auditLog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { KeyRound, Ban, CheckCircle2, Search, ExternalLink, Info, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { formatDataOra } from "@/lib/format";
import DialogResetPassword from "@/components/admin/DialogResetPassword";

/**
 * Gli account con cui i soci entrano nel portale.
 *
 * Non si creano da qui: nascono dalla scheda del socio, dove c'è già l'anagrafica a cui
 * agganciarli. Metterci un pulsante "nuovo" significherebbe poter creare un accesso al
 * portale non collegato a nessuno — un account che, entrando, non troverebbe niente da
 * mostrare. Da questa schermata si fa la manutenzione: password dimenticate e accessi da
 * sospendere.
 */
export default function AccountSoci({ accounts, members, reload }) {
	const { staffUser } = useStaffAuth();
	const { toast } = useToast();
	const [cerca, setCerca] = useState("");
	const [resetTarget, setResetTarget] = useState(null);

	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

	const righe = useMemo(() => {
		const q = cerca.trim().toLowerCase();
		return accounts
			.map((acc) => ({ acc, socio: acc.linked_member_id ? memberById.get(acc.linked_member_id) : null }))
			.filter(({ acc, socio }) => {
				if (!q) return true;
				return acc.nome?.toLowerCase().includes(q)
					|| acc.email?.toLowerCase().includes(q)
					|| socio?.full_name?.toLowerCase().includes(q)
					|| socio?.codice_socio?.toLowerCase().includes(q);
			});
	}, [accounts, memberById, cerca]);

	const commutaAttivo = async (acc) => {
		const attivo = !acc.attivo;
		try {
			await api.entities.StaffAccount.update(acc.id, { attivo });
			await logAction(
				staffUser, attivo ? "activate" : "deactivate", "staff_account",
				acc.nome, acc.id, attivo ? "Accesso al portale riattivato" : "Accesso al portale sospeso",
			);
			toast({ title: attivo ? "Accesso riattivato" : "Accesso sospeso", description: acc.nome });
			reload();
		} catch (err) {
			toast({ title: "Errore", description: err.message, variant: "destructive" });
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
				<Info className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />
				<span>
					Questi account si creano dalla <strong>scheda del socio</strong>, sotto «Portale
					socio»: è lì che c'è l'anagrafica a cui collegarli. Da qui si reimposta la password
					e si sospende l'accesso.
				</span>
			</div>

			<div className="relative max-w-xs">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
				<Input
					placeholder="Cerca per nome, email o codice…"
					value={cerca}
					onChange={(e) => setCerca(e.target.value)}
					className="pl-9"
				/>
			</div>

			<div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border text-left bg-muted/30">
							<th className="py-3 px-4 font-medium text-muted-foreground">Socio</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Email</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Ultimo accesso</th>
							<th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
						</tr>
					</thead>
					<tbody>
						{righe.length === 0 ? (
							<tr>
								<td colSpan={5} className="text-center py-8 text-muted-foreground">
									{cerca ? "Nessun account corrisponde alla ricerca" : "Nessun socio ha ancora un accesso al portale"}
								</td>
							</tr>
						) : righe.map(({ acc, socio }) => (
							<tr key={acc.id} className="border-b border-border/50 hover:bg-muted/30">
								<td className="py-3 px-4">
									{socio ? (
										<Link to={`/crm/soci/${socio.id}`} className="font-medium text-primary hover:underline inline-flex items-center gap-1">
											{socio.full_name}
											<ExternalLink className="w-3 h-3" aria-hidden="true" />
										</Link>
									) : (
										<span className="inline-flex items-center gap-1 font-medium">
											{acc.nome}
											{/* Un accesso al portale senza anagrafica dietro: chi lo usa entra e non
											    trova niente. Va segnalato, non nascosto. */}
											<Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] ml-1">
												<AlertTriangle className="w-3 h-3 mr-1" /> Senza anagrafica
											</Badge>
										</span>
									)}
									{socio?.codice_socio && (
										<span className="block text-xs text-muted-foreground font-mono">{socio.codice_socio}</span>
									)}
								</td>
								<td className="py-3 px-4 text-muted-foreground">{acc.email || "—"}</td>
								<td className="py-3 px-4">
									{acc.attivo ? (
										<Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Attivo</Badge>
									) : (
										<Badge className="bg-red-100 text-red-700 border-red-200">Sospeso</Badge>
									)}
								</td>
								<td className="py-3 px-4 text-muted-foreground text-xs">
									{acc.last_activity_date ? formatDataOra(acc.last_activity_date) : "Mai"}
								</td>
								<td className="py-3 px-4">
									<div className="flex items-center justify-end gap-1">
										<Button variant="ghost" size="icon" className="h-7 w-7" title="Reimposta password" onClick={() => setResetTarget(acc)}>
											<KeyRound className="w-3.5 h-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											title={acc.attivo ? "Sospendi l'accesso" : "Riattiva l'accesso"}
											onClick={() => commutaAttivo(acc)}
										>
											{acc.attivo
												? <Ban className="w-3.5 h-3.5 text-destructive" />
												: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
										</Button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{resetTarget && (
				<DialogResetPassword
					account={resetTarget}
					etichetta="Portale socio"
					onClose={() => setResetTarget(null)}
					onDone={reload}
				/>
			)}
		</div>
	);
}
