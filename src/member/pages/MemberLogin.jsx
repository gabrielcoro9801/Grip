import React, { useState } from "react";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { LogIn, AlertCircle, KeyRound } from "lucide-react";
import MarchioLogin from "@/ui/MarchioLogin";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/ui/primitivi/dialog";

export default function MemberLogin() {
  const { login } = useMemberAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(email, password);
    if (!result.ok) setError(result.error);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <MarchioLogin area="Area cliente" sottotitolo="Accedi al tuo portale" />

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <Label htmlFor="socio-email">Email</Label>
                <Input
                  id="socio-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                />
              </div>
              <div>
                <Label htmlFor="socio-password">Password</Label>
                <Input
                  id="socio-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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

              <button
                type="button"
                onClick={() => setShowReset(true)}
                className="w-full text-sm text-muted-foreground hover:text-primary flex items-center justify-center gap-1.5 pt-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Password dimenticata?
              </button>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Non hai un account? Rivolgiti alla reception della palestra per l'attivazione.
        </p>
      </div>

      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password dimenticata</DialogTitle>
            <DialogDescription>
              Per reimpostare la tua password, rivolgiti direttamente alla reception della palestra.
              Lo staff provvederà a generare nuove credenziali per il tuo account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowReset(false)}>Ho capito</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}