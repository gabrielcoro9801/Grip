import { useState, useEffect, useRef } from "react";
import { codiceDinamico, finestraCorrente, msResiduiFinestra } from "../../shared/qrDinamico.js";

/**
 * Il codice d'accesso del momento, ricalcolato a ogni cambio di minuto.
 *
 * Lo usano sia il portale del socio sia la scheda socio del gestionale: partendo dallo
 * stesso seme mostrano lo stesso codice negli stessi secondi, che è quello che serve alla
 * reception per confrontarli a vista.
 *
 * Il battito è al secondo perché serve comunque al conto alla rovescia; il codice però si
 * ricalcola solo quando la finestra cambia davvero — un digest al minuto, non sessanta.
 *
 * @returns {{ codice: string|null, secondiResidui: number, errore: Error|null }}
 */
export function useQrDinamico(seme) {
	const [codice, setCodice] = useState(null);
	const [secondiResidui, setSecondiResidui] = useState(() => Math.ceil(msResiduiFinestra() / 1000));
	const [errore, setErrore] = useState(null);
	const finestraMostrata = useRef(null);

	useEffect(() => {
		if (!seme) {
			setCodice(null);
			return undefined;
		}

		let vivo = true;
		// Cambiando socio il codice di quello precedente non deve restare a schermo
		// nemmeno per il tempo di un digest.
		finestraMostrata.current = null;
		setCodice(null);
		setErrore(null);

		const battito = async () => {
			const finestra = finestraCorrente();
			setSecondiResidui(Math.ceil(msResiduiFinestra() / 1000));
			if (finestra === finestraMostrata.current) return;
			try {
				const nuovo = await codiceDinamico(seme, finestra);
				if (!vivo) return;
				finestraMostrata.current = finestra;
				setCodice(nuovo);
			} catch (err) {
				// crypto.subtle esiste solo in contesto sicuro: senza HTTPS non c'è modo di
				// derivare il codice, e mostrare il seme nudo rimetterebbe in piedi il QR
				// statico senza dirlo a nessuno.
				if (vivo) setErrore(err);
			}
		};

		battito();
		const id = setInterval(battito, 1000);
		return () => { vivo = false; clearInterval(id); };
	}, [seme]);

	return { codice, secondiResidui, errore };
}
