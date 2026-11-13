-- Matching v2: 80 is the strong-match threshold (DEFAULT_MATCH_CONFIG.strongMatch), so new Auto Apply
-- settings start there. Existing users keep the minimum they chose.
alter table public.auto_apply_settings alter column min_score set default 80;
