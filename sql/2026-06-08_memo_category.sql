-- p1_501 — Memo categories (topic breakdown). Separate from department.
-- e.g. Cuti, Flow Kerja/SOP, Komisen, Polisi. Non-destructive add column.
ALTER TABLE memos ADD COLUMN IF NOT EXISTS category TEXT;
