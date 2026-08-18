import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const MemberAuthContext = createContext(null);
const STORAGE_KEY = "grip_member_user";

export function MemberAuthProvider({ children }) {
  const [memberUser, setMemberUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setMemberUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email, password) => {
    const accounts = await base44.entities.StaffAccount.filter({ email, ruolo: "member" });
    const account = accounts[0];
    // Generic error — never reveal whether the email exists
    if (!account) return { ok: false, error: "Credenziali non valide." };
    if (!account.attivo) return { ok: false, error: "Credenziali non valide." };
    if (account.password !== password) return { ok: false, error: "Credenziali non valide." };
    if (!account.linked_member_id) return { ok: false, error: "Credenziali non valide." };

    const userData = {
      id: account.id,
      nome: account.nome,
      email: account.email,
      member_id: account.linked_member_id,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    setMemberUser(userData);

    try {
      await base44.entities.StaffAccount.update(account.id, {
        last_activity_date: new Date().toISOString(),
      });
    } catch {}

    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
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