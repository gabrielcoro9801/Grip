import React, { useState } from "react";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dumbbell, LogIn, AlertCircle, KeyRound } from "lucide-react";
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
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Dumbbell className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-heading font-bold">GRIP — Area Cliente</h1>
          <p className="text-sm text-muted-foreground mt-1">Accedi al tuo portale</p>
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
                  placeholder="nome@email.it"
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