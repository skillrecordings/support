# Edge Cases

## Example 1: Conceptual Question Disguised as Feedback

**Question:**
```
In your article about useEffect vs useLayoutEffect, you say the DOM mutation via a DOM node ref is the key factor. But why does it matter how the UI is changed? If my effect fetches data, wouldn't the flicker problem apply too?
```

**Answer:**
```
Hey there,

Great question and good critical thinking! You're right that data fetching can also cause visual flickers.

The distinction in the article is about synchronous DOM mutations (which useLayoutEffect handles) vs async operations like data fetching (which have different patterns like Suspense).

I'll flag this feedback for the content team - the article could benefit from clarifying this distinction.

Thanks for the thoughtful question!

Best,
```

**Why it's an edge case:** Not strictly feedback - it's a technical question. Answer the question while also logging the clarity issue.

---

## Example 2: Bulk Typo Report

**Question:**
```
Throughout: import Calcualtor should be import Calculator
This: Jest DOM/extendexpect should be Jest DOM/extend-expect
This: snapshotSerialozers should be snapshotSerializers
[Multiple additional corrections listed]
```

**Answer:**
```
Hey there,

Thanks for the detailed list of corrections! I've logged all of these for the content team to fix.

Really appreciate you taking the time to document these so thoroughly - it helps us improve the course for everyone.

Best,
```

**Why it's an edge case:** Multiple issues in one report. Acknowledge all of them rather than addressing individually.

---

## Example 3: Feedback With External Resource

**Question:**
```
Good idea to touch the key prop topic. But I feel you oversimplified it. There's more nuance here: https://github.com/facebook/react/issues/11793
I'm sure there are things in that thread you could use to improve your article.
```

**Answer:**
```
Hey there,

Thanks for the feedback and the resource link! You're right that there's more nuance to the key prop topic.

I'll pass this along to the content team to review and potentially incorporate.

Appreciate you sharing the GitHub issue - community input like this helps make our content more comprehensive.

Best,
```

**Why it's an edge case:** Includes external resource for reference. Acknowledge both the feedback and the effort to find supporting material.

---

## Example 4: Testing/Philosophy Question

**Question:**
```
I am bought in to your idea of not testing implementation details. But if you have multiple components using common code, how would you test this? If taken to the extreme, every top level component would have to test everything beneath it.
```

**Answer:**
```
Hey there,

Great question! This is a common tension when applying the "don't test implementation details" principle.

The general guidance is to test shared utilities at the level they're used, not in isolation. But you're right that there's nuance here.

I'll share your question with the content team - this could be great material for a follow-up article!

Thanks for the thoughtful question.

Best,
```

**Why it's an edge case:** More of a philosophical/methodology question than feedback. Provide some guidance while flagging for deeper exploration.

---

## Example 5: Outdated Content Inquiry

**Question:**
```
Is there an update to the tsconfig sheet? Do you still recommend targeting es2022?
```

**Answer:**
```
Hey there,

Great question! The tsconfig recommendations do get updated over time as TypeScript and the ecosystem evolve.

I'll flag this for review and potential update with current best practices.

Thanks for asking - keeping content current is important to us!

Best,
```

**Why it's an edge case:** Asking about content freshness rather than reporting a specific error. Acknowledge and commit to review.

---

## Example 6: Positive Feedback With Suggestion

**Question:**
```
I was reading your newsletter about Hooks pitfalls and found it great as always! One pitfall that constantly bites me is stale closures when passing functions to components. The only way I've found to avoid this is to use a Ref. What do you think?
```

**Answer:**
```
Hey there,

Thanks for the kind words and for sharing your experience! The stale closure issue you're describing is definitely a common gotcha with hooks.

I've passed your feedback along to the content team. This could be great material for a future newsletter or blog post!

Thanks for taking the time to share this - feedback like yours helps improve our content.

Best,
```

**Why it's an edge case:** Combines praise, personal experience, and a question. Acknowledge all parts.

---

## Example 7: Exercise/Solution Discrepancy

**Question:**
```
Exercise 72.5 for reusable type guard provides an example of inferred type predicates but the solution itself is still showing that the value type is not inferred. The repo is using typescript 5.6.x. Is this an expected error for the solution?
```

**Answer:**
```
Hey there,

Thanks for the detailed report! This looks like it could be related to TypeScript version behavior - the feature might work differently across versions.

I've flagged this for the content team to review and clarify whether this is expected behavior or needs updating.

Appreciate you including the TypeScript version - that context really helps!

Best,
```

**Why it's an edge case:** Uncertainty about whether it's a bug or expected behavior. Don't commit to either - flag for expert review.
