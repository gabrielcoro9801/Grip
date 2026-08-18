import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function CategoriesTab({ data, reload }) {
  const { categories, courses } = data;
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", color: "#3b82f6" });

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.entities.Category.create(form);
      toast({ title: "Categoria creata" });
      setForm({ name: "", color: "#3b82f6" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const courseCount = (catId) => courses.filter(c => c.category_id === catId).length;

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label>Nuova categoria</Label>
              <Input placeholder="Nome categoria" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Colore</Label>
              <Input type="color" className="w-16 p-1 h-9" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
            </div>
            <Button type="submit" size="sm"><Plus className="w-4 h-4 mr-1" /> Crea</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map(c => (
          <Card key={c.id} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg" style={{ background: c.color || "#ccc" }} />
              <div>
                <h4 className="font-medium">{c.name}</h4>
                <p className="text-xs text-muted-foreground">{courseCount(c.id)} corsi collegati</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessuna categoria</p>}
      </div>
    </div>
  );
}