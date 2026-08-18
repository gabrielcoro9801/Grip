import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import { TrendingUp, TrendingDown, DollarSign, Plus, Download } from "lucide-react";
import moment from "moment";

export default function Finance() {
  const [revenue, setRevenue] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expForm, setExpForm] = useState({ category: "Rent", amount: "", date: new Date().toISOString().split("T")[0], description: "", notes: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = () => {
    Promise.all([
      base44.entities.Revenue.list('-date'),
      base44.entities.Expense.list('-date'),
    ]).then(([r, e]) => { setRevenue(r); setExpenses(e); setLoading(false); });
  };
  useEffect(() => { loadData(); }, []);

  const filteredRevenue = useMemo(() => {
    return revenue.filter(r => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      return true;
    });
  }, [revenue, dateFrom, dateTo]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      return true;
    });
  }, [expenses, dateFrom, dateTo]);

  const totalIn = filteredRevenue.reduce((s, r) => s + (r.amount || 0), 0);
  const totalOut = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const net = totalIn - totalOut;

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    await base44.entities.Expense.create({ ...expForm, amount: Number(expForm.amount) });
    setShowExpenseForm(false);
    setExpForm({ category: "Rent", amount: "", date: new Date().toISOString().split("T")[0], description: "", notes: "" });
    loadData();
  };

  const exportCSV = () => {
    let csv = "Type,Date,Description,Category,Amount\n";
    filteredRevenue.forEach(r => {
      csv += `Revenue,${r.date},"${r.member_name} - ${r.plan_name}",${r.category},${r.amount}\n`;
    });
    filteredExpenses.forEach(e => {
      csv += `Expense,${e.date},"${e.description}",${e.category},-${e.amount}\n`;
    });
    csv += `\nSummary,,,,\nTotal Revenue,,,,${totalIn}\nTotal Expenses,,,,-${totalOut}\nNet,,,,${net}\n`;

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fitgym-ledger-${moment().format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Finance" description="Revenue, expenses, and balance overview">
        <Button size="sm" variant="outline" onClick={exportCSV}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
        <Button size="sm" onClick={() => setShowExpenseForm(true)}><Plus className="w-4 h-4 mr-1" /> Add Expense</Button>
      </PageHeader>

      {/* Date Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total In</p>
                <p className="text-2xl font-bold text-emerald-600">€{totalIn.toLocaleString()}</p>
              </div>
              <div className="bg-emerald-50 p-2 rounded-lg"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Out</p>
                <p className="text-2xl font-bold text-red-500">€{totalOut.toLocaleString()}</p>
              </div>
              <div className="bg-red-50 p-2 rounded-lg"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Balance</p>
                <p className={`text-2xl font-bold ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>€{net.toLocaleString()}</p>
              </div>
              <div className="bg-blue-50 p-2 rounded-lg"><DollarSign className="w-5 h-5 text-blue-600" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ledger Tabs */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="revenue">Revenue ({filteredRevenue.length})</TabsTrigger>
          <TabsTrigger value="expenses">Expenses ({filteredExpenses.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <LedgerTable items={[
            ...filteredRevenue.map(r => ({ ...r, type: "revenue", desc: `${r.member_name} — ${r.plan_name}`, cat: r.category })),
            ...filteredExpenses.map(e => ({ ...e, type: "expense", desc: e.description, cat: e.category })),
          ].sort((a, b) => b.date.localeCompare(a.date))} />
        </TabsContent>
        <TabsContent value="revenue">
          <LedgerTable items={filteredRevenue.map(r => ({ ...r, type: "revenue", desc: `${r.member_name} — ${r.plan_name}`, cat: r.category }))} />
        </TabsContent>
        <TabsContent value="expenses">
          <LedgerTable items={filteredExpenses.map(e => ({ ...e, type: "expense", desc: e.description, cat: e.category }))} />
        </TabsContent>
      </Tabs>

      {/* Add Expense Dialog */}
      <Dialog open={showExpenseForm} onOpenChange={setShowExpenseForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
          <form onSubmit={handleExpenseSubmit} className="space-y-3">
            <div>
              <Label>Category *</Label>
              <Select value={expForm.category} onValueChange={v => setExpForm({...expForm, category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Rent", "Utilities", "Equipment", "Supplies", "Insurance", "Marketing", "Maintenance", "Other"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Amount (€) *</Label><Input type="number" required value={expForm.amount} onChange={e => setExpForm({...expForm, amount: e.target.value})} /></div>
            <div><Label>Date *</Label><Input type="date" required value={expForm.date} onChange={e => setExpForm({...expForm, date: e.target.value})} /></div>
            <div><Label>Description *</Label><Input required value={expForm.description} onChange={e => setExpForm({...expForm, description: e.target.value})} /></div>
            <div><Label>Notes</Label><Textarea value={expForm.notes} onChange={e => setExpForm({...expForm, notes: e.target.value})} /></div>
            <Button type="submit" className="w-full">Add Expense</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LedgerTable({ items }) {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-3 px-4 font-medium text-muted-foreground">Date</th>
            <th className="py-3 px-4 font-medium text-muted-foreground">Description</th>
            <th className="py-3 px-4 font-medium text-muted-foreground">Category</th>
            <th className="py-3 px-4 font-medium text-muted-foreground text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id || i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-3 px-4 text-muted-foreground">{moment(item.date).format("MMM D, YYYY")}</td>
              <td className="py-3 px-4">{item.desc}</td>
              <td className="py-3 px-4 text-muted-foreground">{item.cat}</td>
              <td className={`py-3 px-4 text-right font-medium ${item.type === "revenue" ? "text-emerald-600" : "text-red-500"}`}>
                {item.type === "revenue" ? "+" : "-"}€{item.amount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}