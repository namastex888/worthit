-- Synthetic source meter rows; amounts are reported by the tool, not scan output.
CREATE TABLE usage (id TEXT PRIMARY KEY, hour_ms INTEGER, harness TEXT, model TEXT, input_uncached INTEGER, cache_read INTEGER, cache_write_5m INTEGER, cache_write_1h INTEGER, output INTEGER, reasoning INTEGER, events INTEGER, reported_usd REAL);
CREATE TABLE pr (repo TEXT, pr INTEGER, merged_ms INTEGER);
CREATE TABLE cwd_repo (repo TEXT, cwd TEXT, checked_ms INTEGER);
INSERT INTO usage VALUES ('box-b-previous-0-omp', 1793620800000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-previous-0-dsh-tui', 1793620800000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
INSERT INTO usage VALUES ('box-b-previous-1-omp', 1793793600000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-previous-1-dsh-tui', 1793793600000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
INSERT INTO usage VALUES ('box-b-previous-2-omp', 1793966400000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-previous-2-dsh-tui', 1793966400000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
INSERT INTO usage VALUES ('box-b-current-0-omp', 1794225600000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-current-0-dsh-tui', 1794225600000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
INSERT INTO usage VALUES ('box-b-current-1-omp', 1794398400000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-current-1-dsh-tui', 1794398400000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
INSERT INTO usage VALUES ('box-b-current-2-omp', 1794571200000, 'omp', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 2);
INSERT INTO usage VALUES ('box-b-current-2-dsh-tui', 1794571200000, 'dsh-tui', 'synthetic-model', 0, 0, 0, 0, 200000, 0, 1, 4);
