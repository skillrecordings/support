import { readFileSync, writeFileSync } from 'fs';
import { 
  InternalStateLeakage, 
  MetaCommentary, 
  BannedPhrases, 
  ProductFabrication, 
  Helpfulness 
} from '../packages/core/src/evals/scorers';

const dataset = JSON.parse(readFileSync('fixtures/datasets/comprehensive-dataset.json', 'utf-8'));

const results = {
  total: dataset.length,
  scorers: {
    internal_state_leakage: { pass: 0, fail: 0, failures: [] },
    meta_commentary: { pass: 0, fail: 0, failures: [] },
    banned_phrases: { pass: 0, fail: 0, failures: [] },
    product_fabrication: { pass: 0, fail: 0, failures: [] },
    helpfulness: { pass: 0, fail: 0, failures: [] },
  },
  categories: {},
  byCategory: {},
};

for (const item of dataset) {
  const response = item.agentResponse?.text || '';
  const category = item.agentResponse?.category || 'unknown';
  
  // Track categories
  results.categories[category] = (results.categories[category] || 0) + 1;
  
  if (!results.byCategory[category]) {
    results.byCategory[category] = {
      internal_state_leakage: { pass: 0, fail: 0 },
      meta_commentary: { pass: 0, fail: 0 },
      banned_phrases: { pass: 0, fail: 0 },
      product_fabrication: { pass: 0, fail: 0 },
      helpfulness: { pass: 0, fail: 0 },
    };
  }
  
  // Run scorers
  const leakResult = InternalStateLeakage({ output: response });
  const metaResult = MetaCommentary({ output: response });
  const bannedResult = BannedPhrases({ output: response });
  const fabResult = ProductFabrication({ output: response });
  const helpResult = Helpfulness({ output: response });
  
  // Record results
  if (leakResult.score === 1) {
    results.scorers.internal_state_leakage.pass++;
    results.byCategory[category].internal_state_leakage.pass++;
  } else {
    results.scorers.internal_state_leakage.fail++;
    results.byCategory[category].internal_state_leakage.fail++;
    results.scorers.internal_state_leakage.failures.push({
      id: item.id,
      trigger: item.triggerMessage?.subject?.substring(0, 60),
      response: response.substring(0, 200),
      found: leakResult.metadata.foundLeaks
    });
  }
  
  if (metaResult.score === 1) {
    results.scorers.meta_commentary.pass++;
    results.byCategory[category].meta_commentary.pass++;
  } else {
    results.scorers.meta_commentary.fail++;
    results.byCategory[category].meta_commentary.fail++;
    results.scorers.meta_commentary.failures.push({
      id: item.id,
      trigger: item.triggerMessage?.subject?.substring(0, 60),
      response: response.substring(0, 200),
      found: metaResult.metadata.foundMeta
    });
  }
  
  if (bannedResult.score === 1) {
    results.scorers.banned_phrases.pass++;
    results.byCategory[category].banned_phrases.pass++;
  } else {
    results.scorers.banned_phrases.fail++;
    results.byCategory[category].banned_phrases.fail++;
    results.scorers.banned_phrases.failures.push({
      id: item.id,
      trigger: item.triggerMessage?.subject?.substring(0, 60),
      response: response.substring(0, 200),
      found: bannedResult.metadata.foundBanned
    });
  }
  
  if (fabResult.score === 1) {
    results.scorers.product_fabrication.pass++;
    results.byCategory[category].product_fabrication.pass++;
  } else {
    results.scorers.product_fabrication.fail++;
    results.byCategory[category].product_fabrication.fail++;
    results.scorers.product_fabrication.failures.push({
      id: item.id,
      trigger: item.triggerMessage?.subject?.substring(0, 60),
      response: response.substring(0, 200),
      found: fabResult.metadata.foundFabrication
    });
  }
  
  // Helpfulness uses 0.5 threshold
  if (helpResult.score >= 0.5) {
    results.scorers.helpfulness.pass++;
    results.byCategory[category].helpfulness.pass++;
  } else {
    results.scorers.helpfulness.fail++;
    results.byCategory[category].helpfulness.fail++;
    results.scorers.helpfulness.failures.push({
      id: item.id,
      trigger: item.triggerMessage?.subject?.substring(0, 60),
      response: response.substring(0, 200),
      score: helpResult.score,
      metadata: helpResult.metadata
    });
  }
}

// Calculate pass rates
const summary = {
  total: results.total,
  timestamp: new Date().toISOString(),
  passRates: {},
  byCategory: {},
  categories: results.categories,
};

for (const [scorer, data] of Object.entries(results.scorers)) {
  summary.passRates[scorer] = {
    pass: data.pass,
    fail: data.fail,
    rate: ((data.pass / results.total) * 100).toFixed(1) + '%'
  };
}

for (const [cat, data] of Object.entries(results.byCategory)) {
  summary.byCategory[cat] = {};
  const catTotal = results.categories[cat];
  for (const [scorer, scores] of Object.entries(data)) {
    summary.byCategory[cat][scorer] = {
      pass: scores.pass,
      fail: scores.fail,
      rate: ((scores.pass / catTotal) * 100).toFixed(1) + '%'
    };
  }
}

// Output summary
console.log('=== BASELINE ANALYSIS ===\n');
console.log(`Total responses: ${results.total}`);
console.log(`Categories:`, results.categories);
console.log('\n--- Pass Rates by Scorer ---');
for (const [scorer, data] of Object.entries(summary.passRates)) {
  console.log(`${scorer}: ${data.rate} (${data.pass}/${results.total})`);
}

console.log('\n--- Failures Detail ---');
for (const [scorer, data] of Object.entries(results.scorers)) {
  if (data.failures.length > 0) {
    console.log(`\n${scorer.toUpperCase()} (${data.failures.length} failures):`);
    for (const f of data.failures.slice(0, 5)) {
      console.log(`  - ${f.trigger}`);
      console.log(`    Found: ${JSON.stringify(f.found || f.score)}`);
    }
    if (data.failures.length > 5) {
      console.log(`  ... and ${data.failures.length - 5} more`);
    }
  }
}

// Save results
writeFileSync('fixtures/baselines/v1.0.json', JSON.stringify(summary, null, 2));
writeFileSync('fixtures/baselines/full-analysis.json', JSON.stringify(results, null, 2));

console.log('\n\nSaved to fixtures/baselines/v1.0.json');
