CREATE TABLE IF NOT EXISTS product_content (
  product_id TEXT PRIMARY KEY REFERENCES product(id),
  content_json TEXT NOT NULL DEFAULT '{}'
);
