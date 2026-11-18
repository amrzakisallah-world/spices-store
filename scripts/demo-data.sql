-- ⚠️ DEMO DATA ONLY — بيانات تجريبية لتجربة الواجهة. احذفها قبل الإطلاق الفعلي.
-- Optional. Not part of the migrations. Prices and costs below are invented placeholders,
-- NOT real market or supplier prices. Run once:
--   npx wrangler d1 execute spices-store-db --remote --file=scripts/demo-data.sql
INSERT INTO categories (name_ar, name_en, sort) VALUES ('بهارات ومكونات','Spices',1),('أعشاب طبيعية','Herbs',2),('توابل شرقية','Oriental spices',3);
INSERT INTO products (category_id, name_ar, unit_label, price_pt, cost_pt, stock_qty, low_stock_threshold, description_ar) VALUES
 (1,'كمون حب بلدي','250 جم',4500,3000,20,3,'منتج تجريبي (DEMO) — احذفه قبل الإطلاق'),
 (1,'فلفل أحمر ناعم','250 جم',4000,2500,12,3,'منتج تجريبي (DEMO) — احذفه قبل الإطلاق'),
 (1,'كزبرة حب','250 جم',4000,2600,15,3,'منتج تجريبي (DEMO) — احذفه قبل الإطلاق'),
 (2,'ينسون','250 جم',3500,2200,30,3,'منتج تجريبي (DEMO) — احذفه قبل الإطلاق'),
 (3,'حبهان','100 جم',9000,6500,8,3,'منتج تجريبي (DEMO) — احذفه قبل الإطلاق');
INSERT INTO inventory_movements (product_id, delta, reason, note) SELECT id, stock_qty, 'initial', 'رصيد افتتاحي (DEMO)' FROM products;
