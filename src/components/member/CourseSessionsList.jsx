import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChevronLeft, CheckCircle2, AlertCircle, ListChecks, XCircle } from "lucide-react";
import CourseSessionCard from "@/components/member/CourseSessionCard";
import { getSessionAvailability, getMemberBooking } from "@/lib/bookingUtils";

export default function CourseSessionsList({
  course,
  categoryName,
  sessions,
  bookings,
  memberUser,
  onBook,
  onCancel,
  onBookAll,
  onCancelAll,
  actionLoading,
  onBack,
}) {
  const [showBookAllPreview, setShowBookAllPreview] = useState(false);
  const [showCancelAllPreview, setShowCancelAllPreview] = useState(false);
  const [bookAllResult, setBookAllResult] = useState(null);
  const [cancelAllResult, setCancelAllResult] = useState(null);

  const sessionsToBook = useMemo(() => {
    return sessions.filter(s => {
      const existing = bookings.find(
        b => b.session_id === s.id && b.member_id === memberUser.member_id && b.status !== "cancelled"
      );
      return !existing;
    });
  }, [sessions, bookings, memberUser]);

  const alreadyBookedCount = sessions.length - sessionsToBook.length;

  const memberActiveBookings = useMemo(() => {
    const sessionIds = new Set(sessions.map(s => s.id));
    return bookings.filter(b =>
      sessionIds.has(b.session_id) &&
      b.member_id === memberUser.member_id &&
      b.status !== "cancelled"
    );
  }, [sessions, bookings, memberUser]);

  const handleConfirmBookAll = async () => {
    setShowBookAllPreview(false);
    const result = await onBookAll(sessionsToBook);
    if (result) setBookAllResult({ ...result, alreadyBooked: alreadyBookedCount });
  };

  const handleConfirmCancelAll = async () => {
    setShowCancelAllPreview(false);
    const result = await onCancelAll(memberActiveBookings);
    if (result) setCancelAllResult(result);
  };

  return (
    <div className="space-y-4 mt-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> {categoryName || "Corsi della categoria"}
      </button>
      <h2 className="font-heading font-semibold text-lg">{course?.name}</h2>

      <div className="flex gap-2 flex-wrap">
        {sessionsToBook.length > 0 && (
          <Button size="sm" onClick={() => setShowBookAllPreview(true)} disabled={actionLoading}>
            <ListChecks className="w-4 h-4 mr-1" /> Prenota tutte ({sessionsToBook.length})
          </Button>
        )}
        {memberActiveBookings.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setShowCancelAllPreview(true)} disabled={actionLoading}>
            <XCircle className="w-4 h-4 mr-1" /> Annulla tutte ({memberActiveBookings.length})
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessuna sessione programmata</p>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => {
            const info = getSessionAvailability(session, bookings);
            const memberBooking = getMemberBooking(session.id, memberUser.member_id, bookings);
            return (
              <CourseSessionCard
                key={session.id}
                session={session}
                available={info.available}
                capacity={info.capacity}
                memberBooking={memberBooking}
                onBook={() => onBook(session)}
                onCancel={() => onCancel(memberBooking.id)}
                actionLoading={actionLoading}
              />
            );
          })}
        </div>
      )}

      {/* Preview Prenota tutte */}
      <Dialog open={showBookAllPreview} onOpenChange={setShowBookAllPreview}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Prenota tutte le sessioni</DialogTitle></DialogHeader>
          <DialogDescription>
            Verranno prenotate <strong>{sessionsToBook.length}</strong> sessioni di "{course?.name}".
            {alreadyBookedCount > 0 && ` ${alreadyBookedCount} già prenotate o escluse.`}
          </DialogDescription>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowBookAllPreview(false)}>Annulla</Button>
            <Button onClick={handleConfirmBookAll} disabled={actionLoading}>
              {actionLoading ? "Prenotazione..." : "Conferma"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Risultato Prenota tutte */}
      <Dialog open={!!bookAllResult} onOpenChange={v => { if (!v) setBookAllResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Riepilogo prenotazioni</DialogTitle></DialogHeader>
          {bookAllResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium text-emerald-700">{bookAllResult.confirmed} confermate</p>
              </div>
              {bookAllResult.waitlisted > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-sm font-medium text-amber-700">{bookAllResult.waitlisted} in lista d'attesa</p>
                </div>
              )}
              {bookAllResult.alreadyBooked > 0 && (
                <p className="text-sm text-muted-foreground">{bookAllResult.alreadyBooked} sessioni già prenotate o escluse</p>
              )}
              <Button onClick={() => setBookAllResult(null)} className="w-full">Chiudi</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Annulla tutte */}
      <Dialog open={showCancelAllPreview} onOpenChange={setShowCancelAllPreview}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Annulla tutte le prenotazioni</DialogTitle></DialogHeader>
          <DialogDescription>
            Verranno annullate <strong>{memberActiveBookings.length}</strong> prenotazioni su "{course?.name}".
            Le eventuali promozioni dalla lista d'attesa avverranno automaticamente.
          </DialogDescription>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowCancelAllPreview(false)}>Annulla</Button>
            <Button variant="destructive" onClick={handleConfirmCancelAll} disabled={actionLoading}>
              {actionLoading ? "Cancellazione..." : "Conferma"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Risultato Annulla tutte */}
      <Dialog open={!!cancelAllResult} onOpenChange={v => { if (!v) setCancelAllResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Riepilogo cancellazioni</DialogTitle></DialogHeader>
          {cancelAllResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium text-emerald-700">{cancelAllResult.cancelled} prenotazioni cancellate</p>
              </div>
              {cancelAllResult.promotions > 0 && (
                <p className="text-sm text-muted-foreground">{cancelAllResult.promotions} promozioni dalla lista d'attesa</p>
              )}
              <Button onClick={() => setCancelAllResult(null)} className="w-full">Chiudi</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}