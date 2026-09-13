/*
# Добавяне на таблици за клиентски търсения, продажби и обновяване на статуси

## Промени
1. Нови таблици:
   - **client_searches** — записва всяко търсене, което брокер прави за клиент. Съдържа марка, модел, година/диапазон, гориво, резултат и дата.
   - **sales** — записва продажби на превозни средства. Не изтрива, а маркира като SOLD. Съдържа цена, източник, дата, клиентска информация.
2. Обновени таблици:
   - **vehicles** — добавени колони за source_status (UNCHANGED, CHANGED, NEEDS_RECALCULATION, NEEDS_PUBLISHING, NO_VALID_REPLACEMENT, SOLD, PAUSED)
3. RLS политики за новите таблици (anon, authenticated — single-tenant).

## Бележки
- Permanent IDs остават неприкосновени.
- Продажбите не изтриват редове — маркират статуса.
- Client searches са business data за бъдеща статистика.
*/

-- ============ client_searches ============
CREATE TABLE IF NOT EXISTS client_searches (
  id            BIGSERIAL PRIMARY KEY,
  broker_name   TEXT,
  client_name   TEXT,
  make          TEXT NOT NULL,
  model         TEXT,
  year_from     INTEGER,
  year_to       INTEGER,
  fuel          TEXT,
  found_vehicle_id INTEGER REFERENCES vehicles(permanent_id) ON DELETE SET NULL,
  outcome       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_searches_created ON client_searches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_searches_make ON client_searches (make);
CREATE INDEX IF NOT EXISTS idx_client_searches_model ON client_searches (model);

-- ============ sales ============
CREATE TABLE IF NOT EXISTS sales (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL,
  sale_price_eur NUMERIC(12,2) NOT NULL,
  buyer_name    TEXT,
  sale_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  source        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_vehicle ON sales (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_make ON sales (vehicle_id);

-- ============ RLS ============
ALTER TABLE client_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- client_searches policies
DROP POLICY IF EXISTS "anon_select_client_searches" ON client_searches;
CREATE POLICY "anon_select_client_searches" ON client_searches FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_client_searches" ON client_searches;
CREATE POLICY "anon_insert_client_searches" ON client_searches FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_client_searches" ON client_searches;
CREATE POLICY "anon_update_client_searches" ON client_searches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_client_searches" ON client_searches;
CREATE POLICY "anon_delete_client_searches" ON client_searches FOR DELETE TO anon, authenticated USING (true);

-- sales policies
DROP POLICY IF EXISTS "anon_select_sales" ON sales;
CREATE POLICY "anon_select_sales" ON sales FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_sales" ON sales;
CREATE POLICY "anon_insert_sales" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_sales" ON sales;
CREATE POLICY "anon_update_sales" ON sales FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_sales" ON sales;
CREATE POLICY "anon_delete_sales" ON sales FOR DELETE TO anon, authenticated USING (true);
