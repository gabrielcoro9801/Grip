import React, { useState, useMemo } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { logAction } from "@/staff/lib/auditLog";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Pencil, KeyRound, UserPlus, Ban, CheckCircle2, Search } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra } from "@/core/domain/format";
import DialogResetPassword from "@/staff/components/admin/DialogResetPassword";

const NESSUNO = "none";
const TIPO_RAPPORTO = { dipendente: "Dipendente", collaboratore_sportivo: "Coll. sportivo" };

const formVuoto = { nome: "", email: "", ruolo: "", password: "", linked_collaboratore_id: "" };

/**
 * Gli account di chi lavora nella struttura.
 *
 * Stavano nella stessa tabella degli account dei soci, che sono decine e nascono da soli
 * quando si compila un'anagrafica: due popolazioni con cicli di vita opposti mescolate in
 * una lista sola, dove per trovare la reception si scorreva mezzo tesseramento.
 *
 * Qui non compare il ruolo "socio" e non c'è il campo "socio collegato": un account del
 * portale non si crea da questa schermata, si crea dalla scheda della persona.
 */
export default function UtentiInterni({ accounts, collaboratori, ruoli, reload }) {
	const { staffUser } = useStaffAuth();
	const { toast } = useToast();
	const [cerca, setCerca] = useState("");
	const [mostraForm, setMostraForm] = useState(false);
	const [inModifica, setInModifica] = useState(null);
	const [form, setForm] = useState(formVuoto);
	const [resetTarget, setResetTarget] = useState(null);
	const [saving, setSaving] = useState(false);

	const etichettaRuolo = (nome) => ruoli.find((r) => r.nome === nome)?.label || nome;
	const collabAttivi = collaboratori.filter((c) => c.attivo !== false);
	const collabById = useMemo(
		() => new Map(collaboratori.map((c) => [c.id, c])),
		[collaboratori],
	);

	const filtrati = useMemo(() => {
		const q = cerca.trim().toLowerCase();
		if (!q) return accounts;
		return accounts.filter((a) =>
			a.nome?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q),
		);
	}, [accounts, cerca]);

	const apriNuovo = () => {
		setInModifica(null);
		setForm({ ...formVuoto, ruolo: ruoli[0]?.nome ?? "" });
		setMostraForm(true);
	};

	const apriModifica = (acc) => {
		setInModifica(acc);
		// La password non è più leggibile — sul server esiste solo il suo hash. Il campo
		// parte vuoto e viene inviato solo se ne viene digitata una nuova.
		setForm({
			nome: acc.nome,
			email: acc.email,
			ruolo: acc.ruolo,
			password: "",
			linked_collaboratore_id: acc.linked_collaboratore_id || "",
		});
		setMostraForm(true);
	};

	const salva = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			const comune = {
				nome: form.nome,
				email: form.email,
				ruolo: form.ruolo,
				linked_collaboratore_id: form.linked_collaboratore_id || null,
			};
			if (inModifica) {
				const ruoloCambiato = form.ruolo !== inModifica.ruolo;
				await api.entities.StaffAccount.update(inModifica.id, {
					...comune,
					...(form.password ? { password: form.password } : {}),
				});
				await logAction(
					staffUser,
					ruoloCambiato ? "role_change" : "update",
					"staff_account", form.nome, inModifica.id,
					ruoloCambiato
						? `Ruolo cambiato da ${etichettaRuolo(inModifica.ruolo)} a ${etichettaRuolo(form.ruolo)}`
						: "Modifica dati account",
				);
				toast({ title: "Account aggiornato", description: form.nome });
			} else {
				const creato = await api.entities.StaffAccount.create({
					...comune,
					password: form.password,
					attivo: true,
				});
				await logAction(
					staffUser, "create", "staff_account", form.nome, creato.id,
					`Nuovo account interno, ruolo ${etichettaRuolo(form.ruolo)}`,
				);
				toast({ title: "Account creato", description: form.nome });
			}
			setMostraForm(false);
			setInModifica(null);
			reload();
		} catch (err) {
			toast({ title: "Errore", description: err.message, variant: "destructive" });
		}
		setSaving(false);
	};

	const commutaAttivo = async (acc) => {
		const attivo = !acc.attivo;
		try {
			await api.entities.StaffAccount.update(acc.id, { attivo });
			await logAction(
				staffUser, attivo ? "activate" : "deactivate", "staff_account",
				acc.nome, acc.id, attivo ? "Account riattivato" : "Account disattivato",
			);
			toast({ title: attivo ? "Account riattivato" : "Account disattivato", description: acc.nome });
			reload();
		} catch (err) {
			toast({ title: "Errore", description: err.message, variant: "destructive" });
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="relative max-w-xs flex-1 min-w-[12rem]">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
					<Input
						placeholder="Cerca per nome o email…"
						value={cerca}
						onChange={(e) => setCerca(e.target.value)}
						className="pl-9"
					/>
				</div>
				<Button size="sm" onClick={apriNuovo} disabled={ruoli.length === 0}>
					<UserPlus className="w-4 h-4 mr-1" /> Nuovo utente interno
				</Button>
			</div>

			<div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border text-left bg-muted/30">
							<th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Email</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Ruolo</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Collaboratore</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
							<th className="py-3 px-4 font-medium text-muted-foreground">Ultima attività</th>
							<th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
						</tr>
					</thead>
					<tbody>
						{filtrati.length === 0 ? (
							<tr>
								<td colSpan={7} className="text-center py-8 text-muted-foreground">
									{cerca ? "Nessun utente corrisponde alla ricerca" : "Nessun utente interno"}
								</td>
							</tr>
						) : filtrati.map((acc) => {
							const collab = acc.linked_collaboratore_id ? collabById.get(acc.linked_collaboratore_id) : null;
							return (
								<tr key={acc.id} className="border-b border-border/50 hover:bg-muted/30">
									<td className="py-3 px-4 font-medium">{acc.nome}</td>
									<td className="py-3 px-4 text-muted-foreground">{acc.email}</td>
									<td className="py-3 px-4"><Badge variant="outline">{etichettaRuolo(acc.ruolo)}</Badge></td>
									<td className="py-3 px-4 text-muted-foreground text-xs">
										{collab ? `${collab.nome} ${collab.cognome}` : "—"}
									</td>
									<td className="py-3 px-4">
										{acc.attivo ? (
											<Badge className="bg-success/10 text-success border-success/30">Attivo</Badge>
										) : (
											<Badge className="bg-destructive/10 text-destructive border-destructive/30">Disattivato</Badge>
										)}
									</td>
									<td className="py-3 px-4 text-muted-foreground text-xs">
										{acc.last_activity_date ? formatDataOra(acc.last_activity_date) : "Mai"}
									</td>
									<td className="py-3 px-4">
										<div className="flex items-center justify-end gap-1">
											<Button variant="ghost" size="icon" className="h-9 w-9" title="Modifica" onClick={() => apriModifica(acc)}>
												<Pencil className="w-3.5 h-3.5" />
											</Button>
											<Button variant="ghost" size="icon" className="h-9 w-9" title="Reimposta password" onClick={() => setResetTarget(acc)}>
												<KeyRound className="w-3.5 h-3.5" />
											</Button>
											{/* Disattivare il proprio account chiuderebbe la porta dall'interno. */}
											<Button
												variant="ghost"
												size="icon"
												className="h-9 w-9"
												title={acc.id === staffUser?.id ? "Non puoi disattivare te stesso" : acc.attivo ? "Disattiva" : "Riattiva"}
												onClick={() => commutaAttivo(acc)}
												disabled={acc.id === staffUser?.id}
											>
												{acc.attivo
													? <Ban className="w-3.5 h-3.5 text-destructive" />
													: <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
											</Button>
										</div>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			<Dialog open={mostraForm} onOpenChange={(v) => { setMostraForm(v); if (!v) setInModifica(null); }}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>{inModifica ? "Modifica utente interno" : "Nuovo utente interno"}</DialogTitle>
					</DialogHeader>
					<form onSubmit={salva} className="space-y-3">
						<div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
						<div><Label>Email *</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
						<div>
							<Label>Ruolo *</Label>
							<Select value={form.ruolo} onValueChange={(v) => setForm({ ...form, ruolo: v })}>
								<SelectTrigger><SelectValue placeholder="Scegli un ruolo" /></SelectTrigger>
								<SelectContent>
									{ruoli.map((r) => <SelectItem key={r.nome} value={r.nome}>{r.label}</SelectItem>)}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground mt-1">
								Cosa comporta ciascun ruolo è nella scheda «Ruoli e permessi».
							</p>
						</div>
						<div>
							<Label>{inModifica ? "Password" : "Password *"}</Label>
							<Input
								type="password"
								required={!inModifica}
								value={form.password}
								onChange={(e) => setForm({ ...form, password: e.target.value })}
								placeholder={inModifica ? "Lascia vuoto per non cambiarla" : ""}
							/>
						</div>
						<div>
							<Label>Collaboratore collegato</Label>
							<Select
								value={form.linked_collaboratore_id || NESSUNO}
								onValueChange={(v) => setForm({ ...form, linked_collaboratore_id: v === NESSUNO ? "" : v })}
							>
								<SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
								<SelectContent>
									<SelectItem value={NESSUNO}>— Nessuno —</SelectItem>
									{collabAttivi.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.nome} {c.cognome} · {TIPO_RAPPORTO[c.tipo_rapporto] || c.tipo_rapporto}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground mt-1">
								Facoltativo: lega l'account all'anagrafica di chi lavora nella struttura.
							</p>
						</div>
						<Button type="submit" className="w-full" disabled={saving || !form.ruolo}>
							{saving ? "Salvataggio…" : inModifica ? "Salva modifiche" : "Crea account"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>

			{resetTarget && (
				<DialogResetPassword
					account={resetTarget}
					etichetta="Utente interno"
					onClose={() => setResetTarget(null)}
					onDone={reload}
				/>
			)}
		</div>
	);
}
