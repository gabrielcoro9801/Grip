import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const StaffAuthContext = createContext(null);

const STORAGE_KEY = "grip_staff_user";

export function StaffAuthProvider({ children }) {
  const [staffUser, setStaffUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setStaffUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email, password) => {
    const accounts = await base44.entities.StaffAccount.filter({ email });
    const account = accounts[0];
    if (!account) return { ok: false, error: "Account non trovato." };
    if (!account.attivo) return { ok: false, error: "Account disattivato. Contattare l'amministratore." };
    if (account.password !== password) return { ok: false, error: "Password non corretta." };

    const userData = {
      id: account.id,
      nome: account.nome,
      email: account.email,
      ruolo: account.ruolo,
      linked_collaboratore_id: account.linked_collaboratore_id || null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    setStaffUser(userData);

    // Aggiorna last activity
    try {
      await base44.entities.StaffAccount.update(account.id, {
        last_activity_date: new Date().toISOString(),
      });
    } catch {}

    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
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