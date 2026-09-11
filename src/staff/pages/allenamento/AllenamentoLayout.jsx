import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Dumbbell, LayoutTemplate, ClipboardList, History } from "lucide-react";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";

// Le quattro cose che l'allenamento contiene, nell'ordine in cui si usano: prima si
// cataloga un esercizio, poi lo si mette in un modello, poi il modello diventa la scheda di
// qualcuno, e infine si guarda cosa quel qualcuno ne ha fatto. Chi apre la sezione per la
// prima volta legge il procedimento nella barra.
const tabs = [
  { label: "Esercizi", path: "/allenamento", icon: Dumbbell, end: true },
  { label: "Schede modello", path: "/allenamento/modelli", icon: LayoutTemplate },
  { label: "Schede assegnate", path: "/allenamento/assegnate", icon: ClipboardList },
  { label: "Allenamenti svolti", path: "/allenamento/svolti", icon: History },
];

export default function AllenamentoLayout() {
  const { pathname } = useLocation();

  // L'editor di una scheda è una pagina a sé, non una quarta sezione: ci si arriva da un
  // elenco e si torna indietro col suo pulsante. Lasciando la barra sopra, nessuna voce
  // risulterebbe attiva e la barra resterebbe lì a non indicare niente — come già
  // succedeva alla scheda di un socio dentro i Soci.
  const editorAperto = pathname.startsWith("/allenamento/schede/");

  return (
    <div className="flex flex-col h-full">
      {!editorAperto && <SectionTabs tabs={tabs} label="Sezioni dell'allenamento" />}
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
