import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, getToken, setToken } from "@/api/client";

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
      .then(setStaffUser)
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
      setStaffUser(user);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Credenziali non valide." };
    }
  }, []);

  const logout = useCallback(() => {
    api.auth.logout();
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
