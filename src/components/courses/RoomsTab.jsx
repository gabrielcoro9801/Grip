import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Users } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function RoomsTab({ data, reload }) {
  const { rooms, events } = data;
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", capacity: "", description: "" });

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.capacity || Number(form.capacity) <= 0) return;
    await base44.entities.Room.create({ ...form, capacity: Number(form.capacity) });
    toast({ title: "Sala creata" });
    setShowForm(false);
    setForm({ name: "", capacity: "", description: "" });
    reload();
  };

  const eventCount = (roomId) => events.filter(e => e.room_id === roomId).length;

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuova sala</Button>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map(room => (
          <Card key={room.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-heading font-semibold">{room.name}</h3>
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <Users className="w-3.5 h-3.5" /> Capienza: <strong className="text-foreground">{room.capacity}</strong> posti
              </div>
              {room.description && <p className="text-sm text-muted-foreground mt-2">{room.description}</p>}
              <div className="mt-2 text-xs text-muted-foreground">{eventCount(room.id)} eventi assegnati</div>
            </CardContent>
          </Card>
        ))}
        {rooms.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessuna sala</p>}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuova sala</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Capienza massima *</Label><Input type="number" required min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} /></div>
            <div><Label>Descrizione</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <Button type="submit" className="w-full">Crea sala</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}