-- Un catalogo di esercizi da cui partire.
--
-- Sta in una migrazione e non in `db:seed` perché il seed crea solo l'amministratore e si
-- lancia a mano la prima volta: su Railway non gira mai. Le migrazioni sì, a ogni deploy
-- (`db:deploy` nel comando di avvio), quindi è l'unico posto da cui un contenuto iniziale
-- arriva davvero in produzione senza che qualcuno si colleghi al database a mano.
--
-- Non è un elenco esaustivo e non vuole esserlo: sono gli esercizi che si trovano in
-- qualunque sala pesi, uno o due per attrezzo, così che il personal trainer possa comporre
-- la prima scheda subito invece di dover digitare settanta nomi prima di cominciare. Il
-- resto lo aggiunge lui da Allenamento → Esercizi, con le parole della sua palestra.
--
-- L'inserimento salta i nomi già presenti: se una palestra ha già catalogato la sua "Panca
-- piana", questa migrazione non gliene mette accanto una seconda uguale.

--> statement-breakpoint
INSERT INTO "exercises" ("name", "muscle_group", "description")
SELECT v.nome, v.gruppo, v.descrizione
FROM (VALUES
	-- Petto
	('Panca piana con bilanciere', 'petto', 'Scapole addotte e piedi a terra. Scendi controllando fino a sfiorare lo sterno, poi spingi senza staccare la schiena dalla panca.'),
	('Panca inclinata con manubri', 'petto', 'Panca a 30-45 gradi. I manubri permettono un arco più ampio del bilanciere: scendi finché senti allungare il petto, non oltre.'),
	('Croci ai cavi', 'petto', 'Gomiti morbidi e fermi per tutto il movimento: se si aprono e chiudono stai facendo una spinta, non una croce.'),
	('Chest press (macchina)', 'petto', 'Regola il sedile in modo che le maniglie siano all''altezza del petto, non delle spalle.'),
	('Piegamenti sulle braccia', 'petto', 'Corpo in linea dalla testa ai talloni. Se il bacino cede, appoggia le ginocchia invece di inarcare la schiena.'),
	('Dip alle parallele', 'petto', 'Busto leggermente inclinato in avanti per portare il lavoro sul petto. Con il busto verticale lavorano di più i tricipiti.'),

	-- Dorsali
	('Trazioni alla sbarra', 'dorsali', 'Parti da braccia distese. Pensa a portare i gomiti verso il bacino invece che a tirare con le mani.'),
	('Lat machine avanti', 'dorsali', 'Barra al petto, non dietro la nuca. Petto in fuori e spalle basse per tutta la trazione.'),
	('Pulley basso', 'dorsali', 'Schiena ferma: il busto non deve dondolare avanti e indietro per accompagnare il peso.'),
	('Rematore con bilanciere', 'dorsali', 'Busto inclinato di circa 45 gradi e schiena in posizione neutra. Tira verso l''ombelico.'),
	('Rematore con manubrio a un braccio', 'dorsali', 'Ginocchio e mano sulla panca. Un braccio alla volta permette un allungo maggiore in basso.'),
	('Pullover ai cavi', 'dorsali', 'Braccia quasi tese, il movimento parte dalle spalle. Isola i dorsali senza coinvolgere i bicipiti.'),

	-- Parte superiore della schiena
	('Rematore ai cavi con presa larga', 'schiena_alta', 'Presa larga e gomiti alti: sposta il lavoro dai dorsali alla parte alta della schiena.'),
	('Croci inverse ai cavi', 'schiena_alta', 'Braccia che si aprono all''altezza delle spalle. Movimento lento: con il peso sbagliato diventa uno slancio.'),
	('Rematore alla T-bar', 'schiena_alta', 'Petto appoggiato al supporto quando c''è: toglie la schiena dall''equazione e lascia lavorare solo la tirata.'),

	-- Parte bassa della schiena
	('Stacco da terra', 'schiena_bassa', 'Schiena neutra dall''inizio alla fine. Il bilanciere resta a contatto con le gambe per tutta la salita.'),
	('Iperestensioni alla panca', 'schiena_bassa', 'Sali fino ad allineare il busto con le gambe, senza inarcare oltre.'),
	('Good morning', 'schiena_bassa', 'Carico leggero e ginocchia morbide. Il bacino va indietro, il busto scende di conseguenza.'),

	-- Trapezi
	('Scrollate con manubri', 'trapezi', 'Solo su e giù: ruotare le spalle non aggiunge niente e carica l''articolazione.'),
	('Scrollate con bilanciere', 'trapezi', 'Braccia distese, il movimento è tutto di spalla. Pausa breve in alto.'),
	('Face pull', 'trapezi', 'Cavo all''altezza del viso, gomiti alti. È anche l''esercizio che compensa le troppe spinte.'),

	-- Spalle
	('Lento avanti con bilanciere', 'spalle', 'In piedi o seduto, addome contratto. Il bilanciere sale in linea sopra la testa, non davanti al viso.'),
	('Lento avanti con manubri', 'spalle', 'I manubri lasciano libera la rotazione del polso: più comodo per chi ha spalle rigide.'),
	('Alzate laterali', 'spalle', 'Fino all''altezza delle spalle e non oltre. Se devi slanciare, il peso è troppo.'),
	('Alzate frontali', 'spalle', 'Un braccio per volta o entrambi, senza inarcare la schiena per aiutarsi.'),
	('Arnold press', 'spalle', 'Parti con i palmi verso di te e ruota salendo: unisce spinta e rotazione.'),

	-- Bicipiti
	('Curl con bilanciere', 'bicipiti', 'Gomiti fermi lungo i fianchi. Se si spostano in avanti, stai usando le spalle.'),
	('Curl con manubri alternato', 'bicipiti', 'Un braccio alla volta, con una leggera rotazione del polso verso l''esterno salendo.'),
	('Curl a martello', 'bicipiti', 'Presa neutra, palmi che si guardano. Lavora anche il brachiale, sotto il bicipite.'),
	('Curl alla panca Scott', 'bicipiti', 'Il supporto impedisce di barare con le spalle. Non distendere di scatto in basso.'),
	('Curl ai cavi', 'bicipiti', 'Il cavo mantiene la tensione anche in alto, dove con i manubri il peso scarica.'),

	-- Tricipiti
	('Push down ai cavi', 'tricipiti', 'Gomiti fermi ai fianchi: si muove solo l''avambraccio.'),
	('French press', 'tricipiti', 'Scendi dietro la testa controllando. Il carico giusto è quello che non fa aprire i gomiti.'),
	('Dip fra due panche', 'tricipiti', 'Busto verticale e vicino alla panca. Scendi finché il gomito è a 90 gradi.'),
	('Estensioni sopra la testa con manubrio', 'tricipiti', 'Un manubrio a due mani, gomiti stretti e rivolti in avanti.'),
	('Panca stretta', 'tricipiti', 'Presa alla larghezza delle spalle, gomiti vicini al corpo lungo la discesa.'),

	-- Avambracci
	('Curl ai polsi con bilanciere', 'avambracci', 'Avambracci appoggiati alla panca, si muovono solo i polsi. Serie lunghe.'),
	('Curl inverso', 'avambracci', 'Presa prona. Carico più basso di un curl normale: è normale, la leva è peggiore.'),
	('Farmer''s walk', 'avambracci', 'Cammina con due manubri pesanti, spalle basse e passo corto. Finisce quando cede la presa.'),

	-- Collo
	('Flessioni del collo', 'collo', 'Sdraiato o con fascia elastica. Movimento lento e corto: il collo non va mai forzato.'),
	('Estensioni del collo', 'collo', 'A pancia in giù, con una resistenza leggera. Vale la stessa regola: piano.'),

	-- Addominali
	('Crunch a terra', 'addominali', 'Stacca le scapole, non tutta la schiena. Il collo resta rilassato.'),
	('Plank', 'addominali', 'Corpo in linea, bacino né alto né cedevole. Si misura in secondi, non in ripetizioni.'),
	('Russian twist', 'addominali', 'Ruota il busto, non solo le braccia. Con o senza peso fra le mani.'),
	('Sollevamento gambe alla sbarra', 'addominali', 'Appeso alla sbarra, sali senza dondolare. Se dondoli, fallo da sdraiato a terra.'),
	('Ab wheel', 'addominali', 'Scendi solo fin dove riesci a tenere la schiena ferma. È un esercizio difficile: non partire dal massimo.'),

	-- Quadricipiti
	('Squat con bilanciere', 'quadricipiti', 'Piedi alla larghezza delle spalle, ginocchia in linea con le punte. Scendi fin dove la schiena resta neutra.'),
	('Leg press', 'quadricipiti', 'La schiena bassa resta appoggiata: se si stacca in fondo, stai scendendo troppo.'),
	('Leg extension', 'quadricipiti', 'Distendi senza sbattere il ginocchio in blocco. Pausa breve in alto.'),
	('Affondi con manubri', 'quadricipiti', 'Passo lungo, busto verticale. Il ginocchio dietro sfiora terra senza appoggiarsi.'),
	('Hack squat', 'quadricipiti', 'La macchina guida il movimento: utile per caricare le gambe senza chiedere niente alla schiena.'),
	('Bulgarian split squat', 'quadricipiti', 'Piede dietro sulla panca. Una gamba alla volta: mette in luce gli squilibri fra destra e sinistra.'),

	-- Femorali
	('Leg curl sdraiato', 'femorali', 'Bacino aderente alla panca: se si solleva, il peso è troppo.'),
	('Leg curl seduto', 'femorali', 'Schiena appoggiata e imbottitura ben stretta sulle cosce.'),
	('Stacco rumeno', 'femorali', 'Gambe quasi tese, il bacino va indietro. Scendi finché senti tirare dietro la coscia.'),
	('Nordic curl', 'femorali', 'Caviglie bloccate, si scende in avanti frenando il più possibile. Molto impegnativo.'),

	-- Glutei
	('Hip thrust', 'glutei', 'Schiena appoggiata alla panca, mento verso il petto. Spingi con i talloni e stringi in alto.'),
	('Ponte per glutei', 'glutei', 'La versione a terra dell''hip thrust: stesso movimento, senza attrezzatura.'),
	('Slanci ai cavi', 'glutei', 'Una gamba alla volta, busto fermo. Il movimento finisce quando il bacino inizierebbe a ruotare.'),
	('Stacco sumo', 'glutei', 'Piedi larghi e punte aperte. Rispetto allo stacco classico chiede di più a glutei e adduttori.'),

	-- Polpacci
	('Calf raise in piedi', 'polpacci', 'Escursione completa: scendi sotto il livello del gradino e sali sulle punte.'),
	('Calf raise da seduto', 'polpacci', 'Con il ginocchio piegato lavora il soleo, il muscolo sotto il polpaccio.'),
	('Calf press alla leg press', 'polpacci', 'Solo le punte sulla pedana. Attenzione a non bloccare le ginocchia.'),

	-- Abduttori e adduttori
	('Abductor machine', 'abduttori', 'Busto fermo contro lo schienale: spingi le ginocchia verso l''esterno senza inclinarti.'),
	('Abduzioni ai cavi', 'abduttori', 'Cavigliera alla caviglia, una gamba alla volta. Movimento corto e controllato.'),
	('Adductor machine', 'adduttori', 'Chiudi le ginocchia e trattieni un istante prima di riaprire.'),
	('Adduzioni ai cavi', 'adduttori', 'La gamba attraversa la linea del corpo. Utile anche in riscaldamento.'),

	-- Cardio
	('Tapis roulant', 'cardio', 'Camminata in pendenza o corsa. Per il riscaldamento bastano dieci minuti facili.'),
	('Cyclette', 'cardio', 'Sella all''altezza dell''anca: la gamba deve restare appena piegata in basso.'),
	('Vogatore', 'cardio', 'Prima si spinge con le gambe, poi si tira con le braccia. Al ritorno, l''ordine inverso.'),
	('Ellittica', 'cardio', 'Impatto quasi nullo sulle articolazioni: la scelta comoda quando le ginocchia fanno male.'),
	('Corda per saltare', 'cardio', 'Salti bassi e polsi morbidi. Scalda tutto il corpo in pochi minuti.'),

	-- Corpo intero
	('Burpee', 'corpo_intero', 'Dalla posizione in piedi a terra e ritorno, con un salto. Alza subito i battiti.'),
	('Kettlebell swing', 'corpo_intero', 'La spinta viene dall''anca, non dalle spalle. Il kettlebell arriva all''altezza del petto per inerzia.'),
	('Thruster', 'corpo_intero', 'Squat frontale che finisce in una spinta sopra la testa, in un movimento solo.'),
	('Clean and press', 'corpo_intero', 'Da terra alle spalle, poi sopra la testa. Tecnico: meglio impararlo scarico.'),

	-- Altro
	('Mobilità articolare', 'altro', 'Circonduzioni di spalle, anche e caviglie prima di iniziare. Pochi minuti, tutte le sedute.'),
	('Foam roller', 'altro', 'Rullo su quadricipiti, dorsali e polpacci. Utile dopo l''allenamento o nei giorni di scarico.'),
	('Stretching', 'altro', 'Allunga senza rimbalzare, tenendo ogni posizione venti o trenta secondi.')
) AS v(nome, gruppo, descrizione)
WHERE NOT EXISTS (
	SELECT 1 FROM "exercises" e WHERE lower(e."name") = lower(v.nome)
);
