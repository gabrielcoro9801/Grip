import { useState, useEffect, useRef, useCallback } from "react";
import { finestraCorrente, msResiduiFinestra } from "../../../shared/qrDinamico.js";
import { api } from "@/core/api/client";

/**
 * Il codice d'accesso del momento, chiesto al server a ogni cambio di minuto.
 *
 * Prima lo calcolava il browser da un seme che aveva già in mano. Sembrava elegante — i due
 * lati arrivavano allo stesso valore senza parlarsi — ma significava che la formula era
 * pubblica e il seme viaggiava in chiaro dentro al codice mostrato: da uno screenshot si
 * ricavavano tutti i codici futuri, cioè esattamente ciò che il QR a scadenza doveva
 * impedire. Ora firma il server, con una chiave che dal server non esce.
 *
 * Il battito resta al secondo perché serve al conto alla rovescia; la richiesta parte solo
 * quando la finestra cambia davvero — una al minuto, non sessanta.
 *
 * @param clienteId il socio di cui mostrare il codice. Il portale non lo passa (il server
 *   sa già chi sta chiedendo); la reception passa quello del socio che ha davanti.
 * @returns {{ codice: string|null, secondiResidui: number, stato: string|null, errore: Error|null }}
 */
export function useQrDinamico(clienteId, attivo = true) {
	const [codice, setCodice] = useState(null);
	const [stato, setStato] = useState(null);
	const [secondiResidui, setSecondiResidui] = useState(() => Math.ceil(msResiduiFinestra() / 1000));
	const [errore, setErrore] = useState(null);
	const finestraMostrata = useRef(null);

	const chiedi = useCallback(async () => {
		const risposta = await api.qr.codice(clienteId);
		return risposta;
	}, [clienteId]);

	useEffect(() => {
		if (!attivo) {
			setCodice(null);
			return undefined;
		}

		let vivo = true;
		// Cambiando socio il codice di quello precedente non deve restare a schermo nemmeno
		// per il tempo di una richiesta.
		finestraMostrata.current = null;
		setCodice(null);
		setErrore(null);

		const battito = async () => {
			const finestra = finestraCorrente();
			setSecondiResidui(Math.ceil(msResiduiFinestra() / 1000));
			if (finestra === finestraMostrata.current) return;
			try {
				const risposta = await chiedi();
				if (!vivo) return;
				finestraMostrata.current = finestra;
				setCodice(risposta.codice);
				setStato(risposta.stato);
			} catch (err) {
				// Un minuto senza rete non deve cancellare il codice che si sta mostrando:
				// resta quello di prima finché non scade, ed è comunque meglio di uno schermo
				// vuoto davanti alla reception.
				if (vivo) setErrore(err);
			}
		};

		battito();
		const id = setInterval(battito, 1000);
		return () => { vivo = false; clearInterval(id); };
	}, [chiedi, attivo]);

	return { codice, secondiResidui, stato, errore };
}
