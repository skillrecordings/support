-- Gold Data Pipeline schema for DuckDB

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  has_self_serve BOOLEAN NOT NULL DEFAULT FALSE,
  launch_date DATE
);

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR PRIMARY KEY,
  product VARCHAR NOT NULL,
  request_type VARCHAR NOT NULL,
  quality_score DOUBLE NOT NULL,
  is_gold BOOLEAN NOT NULL DEFAULT FALSE,
  raw_json JSON,
  FOREIGN KEY (product) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS messages (
  conversation_id VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  content VARCHAR NOT NULL,
  timestamp TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS classifications (
  conversation_id VARCHAR NOT NULL,
  request_type VARCHAR NOT NULL,
  confidence DOUBLE NOT NULL,
  classifier_version VARCHAR NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
