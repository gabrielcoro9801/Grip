import React from "react";
import { cn } from "@/lib/utils";

// Il contenuto cambiava larghezza passando da una scheda all'altra della
// stessa sezione: sei valori diversi (max-w-3xl…7xl) con lo stesso padding
// ripetuto venticinque volte. Restano due misure, e una sola le decide.
const LARGHEZZE = {
  // Liste, tabelle, cruscotti: tutto ciò che guadagna spazio.
  wide: "max-w-7xl",
  // Form e documenti: oltre questa misura le righe diventano illeggibili.
  form: "max-w-5xl",
  // Portale soci: una colonna sola, pensata prima per il telefono.
  narrow: "max-w-3xl",
};

/**
 * Il contenitore di una pagina: padding e larghezza massima, decisi qui.
 * Lo montano i layout attorno all'<Outlet>, così le pagine figlie non
 * ripetono più `p-4 sm:p-6 lg:p-8 max-w-…` ciascuna a modo suo.
 */
export default function PageContainer({ size = "wide", className, children, ...props }) {
  return (
    <div
      className={cn("p-4 sm:p-6 lg:p-8 mx-auto w-full", LARGHEZZE[size] || LARGHEZZE.wide, className)}
      {...props}
    >
      {children}
    </div>
  );
}
