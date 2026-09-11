import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, getToken, setToken } from "@/core/api/client";
import { impostaMatrice, ripristinaMatricePredefinita } from "@/staff/lib/permissions";

/**
 * I permessi del ruolo arrivano dal server insieme all'utente: la matrice non è più una
 * costante del codice, e l'ente può averla ridefinita. Applicarli qui — nel punto in cui si
 * stabilisce chi è l'utente — fa sì che ogni controllo nelle pagine risponda secondo la
 * configurazione vera, senza che nessuna pagina debba saperlo.
 */
function applicaPermessiDi(user) {
  if (!user?.ruolo) return;
  impostaMatrice({
    permessi: { [user.ruolo]: user.permessi ?? {} },
    capacita: { [user.ruolo]: user.capacita ?? [] },
  });
}

const StaffAuthContext = createContext(null);

export function StaffAuthProvider({ children }) {
  const [staffUser, setStaffUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // La sessione viene ricostruita chiedendo al server chi è il portatore del token,
  // non rileggendo dati utente salvati nel browser: così un account disattivato o con
  // ruolo cambiato perde subito i privilegi, e il ruolo non è manomettibile lato client.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.auth
      .me()
      .then((user) => {
        // Il controllo del ruolo serve anche qui, non solo al momento dell'accesso: la
        // sessione si ripristina da un token già presente, e quel token può essere di un
        // socio. Senza, il portiere sta solo sulla porta d'ingresso e non sulla finestra —
        // e al socio si apriva il gestionale, vuoto perché non ha nessun permesso, invece
        // della schermata di accesso.
        if (user.ruolo === "member") {
          setToken(null);
          return;
        }
        applicaPermessiDi(user);
        setStaffUser(user);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const user = await api.auth.login(email, password);
      // Il portale soci ha un accesso separato: un account "member" non deve entrare
      // nel gestionale anche quando le credenziali sono corrette.
      if (user.ruolo === "member") {
        api.auth.logout();
        return { ok: false, error: "Questo account può accedere solo al portale soci." };
      }
      applicaPermessiDi(user);
      setStaffUser(user);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Credenziali non valide." };
    }
  }, []);

  const logout = useCallback(() => {
    api.auth.logout();
    // Uscendo si torna ai valori predefiniti: lasciare in memoria i permessi di chi se ne
    // è andato significherebbe che la schermata di accesso ragiona con i suoi.
    ripristinaMatricePredefinita();
    setStaffUser(null);
  }, []);

  return (
    <StaffAuthContext.Provider value={{ staffUser, loading, login, logout }}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth() {
  return useContext(StaffAuthContext);
}
