import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

// Il frontend è diviso in quattro aree, e queste regole sono ciò che tiene in piedi la
// divisione. Senza, resta una convenzione: funziona finché qualcuno non ha fretta.
//
//   core/    la logica che non sa di stare in un browser — è ciò che un'app mobile
//            riuserebbe così com'è, qualunque tecnologia si scelga
//   member/  il portale soci
//   staff/   il gestionale
//   ui/      i pezzi di interfaccia web usati da entrambe le aree
//
// Un import sbagliato non rompe niente oggi: rompe il giorno in cui si prova a portare
// core/ altrove e ci si accorge che si tira dietro mezzo gestionale. Meglio accorgersene
// adesso, con un errore di lint.

const VIETATI_IN_CORE = [
  {
    group: ["react", "react-dom", "react-dom/*", "react-router-dom"],
    message:
      "core/ deve restare senza interfaccia: è la parte che un'app mobile riusa identica. La logica sta qui, il componente che la mostra sta in member/, staff/ o ui/.",
  },
  {
    group: ["@/ui", "@/ui/*", "@/member", "@/member/*", "@/staff", "@/staff/*"],
    message:
      "core/ non può dipendere da chi lo usa: può importare solo sé stesso, shared/ e pacchetti che girano ovunque.",
  },
];

// I soli globali che core/ può usare — ed è una lista bianca, non nera, perché è la
// definizione operativa di "gira anche fuori da un browser".
//
// Il modo di imporla è indiretto e vale la pena spiegarlo: a core/ non si danno i globali
// del browser, e a quel punto è `no-undef` a fare il lavoro. `localStorage.getItem` dentro
// core/ diventa un errore di lint — non una scoperta a runtime, sul telefono di qualcuno,
// sei mesi dopo. Vietarne cinque a mano avrebbe lasciato passare il sesto.
const GLOBALI_PORTABILI = {
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  AbortController: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  Uint8Array: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  Intl: "readonly",
  globalThis: "readonly",
};

export default [
  {
    // Tutto il frontend, non più solo components/ e pages/: le regole che contano — un nome
    // usato e mai importato, un confine attraversato — servono soprattutto nei file che
    // prima restavano fuori (App.jsx, il client API, i moduli di dominio).
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    // I primitivi di shadcn sono codice di terze parti che si aggiorna copiandolo di nuovo:
    // correggerne lo stile significherebbe rifare le correzioni a ogni aggiornamento.
    ignores: ["src/ui/primitivi/**/*"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      // Un nome usato e mai importato. Non è un caso di scuola: <SelettoreTema /> nel portale
      // soci era rimasto senza il suo import, e nessuno se n'era accorto perché il build non
      // se ne lamenta — il componente diventa una variabile libera e l'errore arriva solo
      // quando quel pezzo di pagina viene disegnato, cioè dopo il login, in produzione.
      //
      // Queste regole vivevano già in `recommended`, ma gli spread che stavano qui sopra
      // portavano le loro regole in un oggetto che questa chiave `rules` sostituisce per
      // intero: quindi erano spente.
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },

  // --- I confini fra le aree ---------------------------------------------------------
  {
    files: ["src/core/**/*.{js,mjs,cjs,jsx}"],
    // I globali del browser vanno **spenti**, non omessi: la configurazione flat di ESLint
    // fonde `languageOptions.globals` con quella del blocco precedente invece di
    // sostituirla, quindi non elencarli qui non basta — `localStorage` resterebbe noto e la
    // regola non direbbe niente. Spegnerli uno per uno è ciò che la rende vera.
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.browser).map((nome) => [nome, "off"])),
        ...GLOBALI_PORTABILI,
      },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: VIETATI_IN_CORE }],
    },
  },
  {
    // I test di core girano con `node --test`, senza Vite e senza browser: è la prova
    // pratica che il livello sia davvero portabile.
    files: ["src/core/**/*.test.js"],
    languageOptions: { globals: { ...GLOBALI_PORTABILI, ...globals.node } },
  },
  {
    files: ["src/member/**/*.{js,mjs,cjs,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/staff", "@/staff/*"],
              message:
                "Il portale soci non conosce il gestionale: un domani sarà un'applicazione a sé. Se il pezzo serve a entrambi, il suo posto è ui/ (interfaccia) o core/ (logica).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/staff/**/*.{js,mjs,cjs,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/member", "@/member/*"],
              message:
                "Il gestionale non importa dal portale soci: se il pezzo serve a entrambi, il suo posto è ui/ (interfaccia) o core/ (logica).",
            },
          ],
        },
      ],
    },
  },
  {
    // ui/ è interfaccia condivisa: può usare core/, non le due aree che la usano.
    files: ["src/ui/**/*.{js,mjs,cjs,jsx}"],
    ignores: ["src/ui/primitivi/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/member", "@/member/*", "@/staff", "@/staff/*"],
              message:
                "ui/ sta sotto le due aree, non sopra: se un componente ha bisogno di qualcosa che vive in member/ o staff/, allora appartiene a quell'area.",
            },
          ],
        },
      ],
    },
  },
];
