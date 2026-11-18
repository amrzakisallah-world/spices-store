-- Spices Store (عمر و يونس) — initial schema for Cloudflare D1 (SQLite)
-- MONEY RULE: every *_pt column is an INTEGER number of piasters (1 EGP = 100 pt).
-- Integers avoid floating-point rounding errors. Never store money as REAL.
-- DAY RULE: *_day columns are 'YYYY-MM-DD' in Africa/Cairo time, used for reports.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  unit_label TEXT NOT NULL DEFAULT '',
  price_pt INTEGER NOT NULL CHECK (price_pt >= 0),
  cost_pt INTEGER NOT NULL DEFAULT 0 CHECK (cost_pt >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images(product_id);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price_pt INTEGER NOT NULL,
  new_price_pt INTEGER NOT NULL,
  old_cost_pt INTEGER NOT NULL,
  new_cost_pt INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_price_history_product ON price_history(product_id);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale','purchase','adjustment','cancel_return','initial')),
  ref TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_inv_product ON inventory_movements(product_id);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  last_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  admin_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  subtotal_pt INTEGER NOT NULL CHECK (subtotal_pt >= 0),
  delivery_fee_pt INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_pt >= 0),
  discount_pt INTEGER NOT NULL DEFAULT 0 CHECK (discount_pt >= 0),
  total_pt INTEGER NOT NULL CHECK (total_pt >= 0),
  delivery_cost_pt INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cost_pt >= 0),
  paid_pt INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_day TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  completed_day TEXT
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_day ON orders(created_day);
CREATE INDEX idx_orders_completed_day ON orders(completed_day);
CREATE INDEX idx_orders_phone ON orders(phone);

-- Snapshot of name, price and cost at the moment of sale: history never changes
-- when the catalogue price changes later.
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  unit_label_snapshot TEXT NOT NULL DEFAULT '',
  unit_price_pt INTEGER NOT NULL CHECK (unit_price_pt >= 0),
  unit_cost_pt INTEGER NOT NULL CHECK (unit_cost_pt >= 0),
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_total_pt INTEGER NOT NULL CHECK (line_total_pt >= 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Positive amount = money received, negative amount = refund.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_pt INTEGER NOT NULL CHECK (amount_pt <> 0),
  method TEXT NOT NULL CHECK (method IN ('cash','vodafone_cash','instapay','bank','other')),
  note TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_payments_order ON payments(order_id);

-- Operating expenses (rent, salaries, packaging, ...). Stock purchases are NOT
-- expenses: they are tracked in supplier_purchases and reach profit through the
-- cost snapshot on each sold item (avoids counting the same money twice).
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  amount_pt INTEGER NOT NULL CHECK (amount_pt > 0),
  note TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_expenses_day ON expenses(day);

-- Every real cash movement (customer payments, expenses, supplier payments,
-- other income) is written here, so cash-flow reports have a single source.
CREATE TABLE cash_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_pt INTEGER NOT NULL CHECK (amount_pt > 0),
  category TEXT NOT NULL CHECK (category IN ('order_payment','order_refund','expense','supplier_payment','other_income','other_out')),
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_ledger_day ON cash_ledger(day);
CREATE INDEX idx_ledger_ref ON cash_ledger(ref_type, ref_id);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE supplier_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_no TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  total_pt INTEGER NOT NULL CHECK (total_pt >= 0),
  paid_pt INTEGER NOT NULL DEFAULT 0 CHECK (paid_pt >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_purchases_supplier ON supplier_purchases(supplier_id);

CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES supplier_purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL CHECK (qty > 0),
  unit_price_pt INTEGER NOT NULL CHECK (unit_price_pt >= 0),
  line_total_pt INTEGER NOT NULL CHECK (line_total_pt >= 0)
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);

-- Manual or purchase-generated price points per supplier (e.g. Harraz).
-- Rows are only ever appended, so history is preserved.
-- item_key = 'p<product_id>' when linked to a product, otherwise 'n:<name>'.
CREATE TABLE supplier_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  price_pt INTEGER NOT NULL CHECK (price_pt >= 0),
  day TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','purchase')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_supplier_prices_key ON supplier_prices(supplier_id, item_key, day);
CREATE INDEX idx_supplier_prices_product ON supplier_prices(product_id);
