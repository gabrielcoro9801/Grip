-- Gli indici sulle chiavi esterne, che Postgres non crea da solo.
--
-- Ogni richiesta del portale ("i miei abbonamenti", "le mie serie") e ogni controllo sulle sale
-- era una lettura completa della tabella. Oggi non si nota, con qualche anno di prenotazioni e
-- di serie sì. Sono dichiarati anche nello schema Drizzle, così gli snapshot restano allineati.
CREATE INDEX "member_documents_member_id_idx" ON "member_documents" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "qr_accessi_cliente_id_idx" ON "qr_accessi" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "subscriptions_member_id_idx" ON "subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "bookings_session_id_idx" ON "bookings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "bookings_member_id_idx" ON "bookings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "events_room_id_start_date_idx" ON "events" USING btree ("room_id","start_date");--> statement-breakpoint
CREATE INDEX "events_course_id_idx" ON "events" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sessions_event_id_idx" ON "sessions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sessions_room_id_date_idx" ON "sessions" USING btree ("room_id","date");--> statement-breakpoint
CREATE INDEX "exercise_plans_member_id_idx" ON "exercise_plans" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "workout_logs_member_id_idx" ON "workout_logs" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "workout_logs_session_id_idx" ON "workout_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_member_id_idx" ON "workout_sessions" USING btree ("member_id");