-- Initial seed data for eval environment
-- Test apps and trust scores for deterministic behavior

-- Test apps
INSERT INTO SUPPORT_apps (id, slug, name, front_inbox_id, instructor_teammate_id, stripe_account_id, integration_base_url, webhook_secret, capabilities)
VALUES 
  ('app_eval_tt', 'total-typescript-eval', 'Total TypeScript (Eval)', 'inb_eval_tt', 'tea_instructor_matt', 'acct_eval_tt', 'http://host.docker.internal:3456', 'eval_secret_tt', '["refund", "transfer", "magic_link"]'),
  ('app_eval_ah', 'ai-hero-eval', 'AI Hero (Eval)', 'inb_eval_ah', 'tea_instructor_matt', 'acct_eval_ah', 'http://host.docker.internal:3457', 'eval_secret_ah', '["refund", "transfer", "magic_link"]'),
  ('app_eval_generic', 'generic-eval', 'Generic Test App (Eval)', 'inb_eval_generic', NULL, 'acct_eval_generic', 'http://host.docker.internal:3458', 'eval_secret_generic', '["refund"]');

-- Trust scores (pre-seeded for deterministic auto-send behavior)
INSERT INTO SUPPORT_trust_scores (id, app_id, category, trust_score, sample_count)
VALUES
  ('ts_tt_refund', 'app_eval_tt', 'refund', 0.85, 50),
  ('ts_tt_access', 'app_eval_tt', 'access', 0.92, 100),
  ('ts_tt_technical', 'app_eval_tt', 'technical', 0.78, 30),
  ('ts_tt_general', 'app_eval_tt', 'general', 0.70, 40),
  ('ts_ah_refund', 'app_eval_ah', 'refund', 0.88, 45),
  ('ts_ah_access', 'app_eval_ah', 'access', 0.90, 80),
  ('ts_ah_technical', 'app_eval_ah', 'technical', 0.75, 25),
  ('ts_ah_general', 'app_eval_ah', 'general', 0.72, 35);
