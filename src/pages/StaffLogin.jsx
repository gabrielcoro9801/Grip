import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, LogIn, AlertCircle, User } from "lucide-react";
import { ROLES } from "@/lib/permissions";

export default function StaffLogin() {
  const { login } = useStaffAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    base44.entities.StaffAccount.filter({ attivo: true }, "nome").then(setAccounts);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(email, password);
    if (!result.ok) setError(result.error);
    setLoading(false);
  };

  const quickFill = (acc) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setError("");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Dumbbell className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-heading font-bold">Grip Gestione Palestra</h1>
          <p className="text-sm text-muted-foreground mt-1">Accedi con il tuo account staff</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nome@fitgym.it"
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                <LogIn className="w-4 h-4 mr-1" />
                {loading ? "Accesso in corso..." : "Accedi"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo accounts — quick fill */}
        <Card className="border-0 shadow-sm bg-muted/30">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
              Account demo — clicca per compilare
            </p>
            <div className="space-y-1.5">
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => quickFill(acc)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{acc.nome}</p>
                    <p className="text-xs text-muted-foreground truncate">{acc.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {ROLES[acc.ruolo]?.label || acc.ruolo}
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}