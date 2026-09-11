import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, getToken, setToken } from "@/core/api/client";

const MemberAuthContext = createContext(null);

// La sessione del socio mantiene la forma di prima ({ id, nome, email, member_id }),
// così le pagine del portale continuano a leggere `memberUser.member_id` invariate.
function toMemberSession(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    member_id: user.linked_member_id,
  };
}

export function MemberAuthProvider({ children }) {
  const [memberUser, setMemberUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.auth
      .me()
      .then((user) => {
        // Lo stesso token vale per staff e soci: qui accettiamo solo i soci, altrimenti
        // un utente dello staff autenticato entrerebbe nel portale soci senza avere
        // un'anagrafica collegata da mostrare.
        if (user.ruolo === "member" && user.linked_member_id) {
          setMemberUser(toMemberSession(user));
        }
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    // Messaggio unico per ogni fallimento: non rivelare se l'indirizzo esiste.
    const invalid = { ok: false, error: "Credenziali non valide." };
    try {
      const user = await api.auth.login(email, password);
      if (user.ruolo !== "member" || !user.linked_member_id) {
        api.auth.logout();
        return invalid;
      }
      setMemberUser(toMemberSession(user));
      return { ok: true };
    } catch {
      return invalid;
    }
  }, []);

  const logout = useCallback(() => {
    api.auth.logout();
    setMemberUser(null);
  }, []);

  return (
    <MemberAuthContext.Provider value={{ memberUser, loading, login, logout }}>
      {children}
    </MemberAuthContext.Provider>
  );
}

export function useMemberAuth() {
  return useContext(MemberAuthContext);
}
