-- Normalize and infer product values for conversations.

CREATE OR REPLACE TEMP TABLE _canonical_products AS
SELECT *
FROM (
  VALUES
    ('total-typescript', 'Total TypeScript', FALSE),
    ('ai-hero', 'AI Hero', FALSE),
    ('epic-web', 'Epic Web', FALSE),
    ('course-builder', 'Course Builder', TRUE),
    ('other', 'Other', FALSE)
) AS t(id, name, has_self_serve);

INSERT INTO products (id, name, has_self_serve)
SELECT id, name, has_self_serve
FROM _canonical_products
WHERE id NOT IN (SELECT id FROM products);

UPDATE conversations
SET product = CASE
  WHEN lower(split_part(customer_email, '@', 2)) LIKE '%totaltypescript%' THEN 'total-typescript'
  WHEN lower(split_part(customer_email, '@', 2)) LIKE '%ai-hero%' OR lower(split_part(customer_email, '@', 2)) LIKE '%aihero%' THEN 'ai-hero'
  WHEN lower(split_part(customer_email, '@', 2)) LIKE '%epicweb%' OR lower(split_part(customer_email, '@', 2)) LIKE '%epic-web%' THEN 'epic-web'
  WHEN lower(split_part(customer_email, '@', 2)) LIKE '%coursebuilder%' OR lower(split_part(customer_email, '@', 2)) LIKE '%course-builder%' THEN 'course-builder'
  WHEN lower(subject) LIKE '%total typescript%' OR lower(subject) LIKE '%totaltypescript%' OR lower(subject) LIKE '%total-typescript%' THEN 'total-typescript'
  WHEN lower(subject) LIKE '%ai hero%' OR lower(subject) LIKE '%aihero%' OR lower(subject) LIKE '%ai-hero%' THEN 'ai-hero'
  WHEN lower(subject) LIKE '%epic web%' OR lower(subject) LIKE '%epicweb%' OR lower(subject) LIKE '%epic-web%' THEN 'epic-web'
  WHEN lower(subject) LIKE '%course builder%' OR lower(subject) LIKE '%coursebuilder%' OR lower(subject) LIKE '%course-builder%' THEN 'course-builder'
  WHEN lower(CAST(tags AS VARCHAR)) LIKE '%total typescript%' OR lower(CAST(tags AS VARCHAR)) LIKE '%totaltypescript%' OR lower(CAST(tags AS VARCHAR)) LIKE '%total-typescript%' THEN 'total-typescript'
  WHEN lower(CAST(tags AS VARCHAR)) LIKE '%ai hero%' OR lower(CAST(tags AS VARCHAR)) LIKE '%aihero%' OR lower(CAST(tags AS VARCHAR)) LIKE '%ai-hero%' THEN 'ai-hero'
  WHEN lower(CAST(tags AS VARCHAR)) LIKE '%epic web%' OR lower(CAST(tags AS VARCHAR)) LIKE '%epicweb%' OR lower(CAST(tags AS VARCHAR)) LIKE '%epic-web%' THEN 'epic-web'
  WHEN lower(CAST(tags AS VARCHAR)) LIKE '%course builder%' OR lower(CAST(tags AS VARCHAR)) LIKE '%coursebuilder%' OR lower(CAST(tags AS VARCHAR)) LIKE '%course-builder%' THEN 'course-builder'
  ELSE 'other'
END
WHERE product IS NULL
  OR product = ''
  OR product NOT IN (SELECT id FROM _canonical_products);
