-- MUT-437 (TD-258): the look-alike candidates, a person's captures in a date window.
CREATE INDEX "inbox_entries_userId_occurredOn_idx" ON "inbox_entries"("userId", "occurredOn");
