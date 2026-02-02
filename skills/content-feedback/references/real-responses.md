# Real Responses

## Example 1 (cnv_1jajv0h1)

**Customer:**
```
Hi, nice videos, just a small note on your video "Use generics in React to make dynamic and flexible components". You don't need to use a normal function to use generics in JSX, you can define arrow function with generics files, but you need to add a comma in the generic to disambiguate from a JSX element. E.g. 
invalid syntax in jsx: const identity = <T>(a: T) => a 
valid: const identity = <T,>(a: T) => a
Don't know if it's info worth updating the post for, but there you go :)
```

**Agent:**
```
Hey there,

Thanks for this excellent tip! You're absolutely right about the comma trick for arrow functions with generics in JSX.

I've passed this along to the content team. It's definitely worth adding as a note since it's a common gotcha.

Really appreciate you taking the time to share this - it'll help other learners!

Best,
```

## Example 2 (cnv_1jbef3dx)

**Customer:**
```
Hey Matt, I noticed that in the AIhero crash course lesson 01-10 (Streaming Objects) you mention that the output of the model is being validated using the zod schema that we passed in. However, the documentation of the partialObjectStream property says: "Note that the partial object is not validated. If you want to be certain that the actual content matches your schema, you need to implement your own validation for partial results." This was a bit confusing to me.
```

**Agent:**
```
Hey there,

Thanks for catching this discrepancy! You're right that the documentation states partial objects aren't validated.

I've logged this with the content team so they can clarify the messaging in the video or update to match the current SDK behavior.

Really appreciate you taking the time to report this - it helps us keep the content accurate!

Best,
```

## Example 3 (cnv_1jbnegv9)

**Customer:**
```
Exercise 72.5 for reusable type guard provides an example of inferred type predicates but the solution itself is still showing that the value type is not inferred. The repo is using typescript 5.6.x, is this an expected error for the solution?
```

**Agent:**
```
Hey there,

Thanks for the detailed report! This looks like it could be related to TypeScript version behavior.

I've flagged this for the content team to review and clarify whether this is expected or needs updating.

Appreciate you including the TypeScript version - that context really helps!

Best,
```

## Example 4 (cnv_1jc5ryed)

**Customer:**
```
I wonder if that is a bug. Should not the logic being inverted here since it is actually checking if something IS an album in that example.

function assertIsAlbum(input: unknown): asserts input is Album {
  if (
    typeof input === "object" &&
    input !== null &&
    "id" in input &&
    "title" in input &&
    "artist" in input &&
    "year" in input
  ) {
    throw new Error("Not an Album!");
  }
}
```

**Agent:**
```
Hey there,

Good catch! You're absolutely right - the logic appears to be inverted. The function should throw when the conditions are NOT met, not when they are.

I've logged this as a bug for the content team to fix.

Thanks for spotting this and taking the time to report it!

Best,
```

## Example 5 (cnv_1jcles2t)

**Customer:**
```
Broken images: https://www.totaltypescript.com/workshops/typescript-pro-essentials/integrated-development-environments-superpowers/fast-imports-in-vs-code/solution
```

**Agent:**
```
Hey there,

Thanks for reporting the broken images! I've logged this page for the content team to fix.

Appreciate you taking the time to let us know!

Best,
```

## Example 6 (cnv_1jd2a0md)

**Customer:**
```
Hi! Is there an update to the tsconfig sheet? Do you still recommend targeting es2022?
```

**Agent:**
```
Hey there,

Great question! The tsconfig recommendations do get updated over time as TypeScript and the ecosystem evolve.

I'll flag this for Matt to review and potentially update with current best practices.

Thanks for asking - keeping content current is important to us!

Best,
```

## Example 7 (cnv_2ztprwn)

**Customer:**
```
Hi Kent, I was just reading your newsletter from today with the Hooks pitfalls and found it great as always! When I was reading about the 'pick a dog' issue I thought I knew where you were going with it, but it turned out to be a different pitfall than I was thinking. One that seems to constantly bite me is where you pass a function to another component which uses a prop... The only way I've found to avoid this is to also use a Ref. What do you think?
```

**Agent:**
```
Hey there,

Thanks for the kind words and for sharing your experience! The stale closure issue you're describing is definitely a common gotcha with hooks.

I've passed your feedback along to Kent. This could be great material for a future newsletter or blog post!

Thanks for taking the time to share this - feedback like yours helps improve our content.

Best,
```

## Example 8 (cnv_2ztqsuf)

**Customer:**
```
In your article about when to use useEffect vs. useLayoutEffect, you say the DOM mutation via a DOM node ref is the key factor. But why does it matter whether the UI is changed by "a DOM node ref" as distinct from some other way? If my component has a list of data and my effect fetches data, the flicker problem would apply too wouldn't it?
```

**Agent:**
```
Hey there,

Great question and good critical thinking! You're right that data fetching can also cause visual flickers.

The distinction in the article is about synchronous DOM mutations (which useLayoutEffect handles) vs async operations like data fetching (which have different patterns like Suspense).

I'll flag this feedback for the content team - the article could benefit from clarifying this distinction.

Thanks for the thoughtful question!

Best,
```

## Example 9 (cnv_2ztutzb)

**Customer:**
```
Not sure the best way to report - in https://kentcdodds.com/blog/how-to-use-react-context-effectively, in the 4th code example, you have:

const [state, setCount] = React.useReducer(countReducer, {count: 0})

I'm guessing the setCount should be dispatch, and the line came from a copy/paste of a useState() call. Not a huge deal, and might not actually be a mistake, but figured it might be.
```

**Agent:**
```
Hey there,

Thanks for catching this! You're right - `setCount` should probably be `dispatch` when using useReducer. Good eye!

I've logged this for Kent to review and update.

Really appreciate you taking the time to report it - these small fixes add up to a better experience for everyone.

Best,
```

## Example 10 (cnv_2ztwd8n)

**Customer:**
```
Hi Kent, I am bought in to your idea of not testing implementation details, but have a question. If you have multiple components using some common code - a custom hook, a util function, maybe even a sub component - how would you go about testing this. If you take this to the extreme every top level component would have to test everything beneath it.
```

**Agent:**
```
Hey there,

Great question! This is a common tension when applying the "don't test implementation details" principle.

The general guidance is to test shared utilities at the level they're used, not in isolation. But you're right that there's nuance here.

I'll share your question with Kent - this could be great material for a follow-up article!

Thanks for the thoughtful question.

Best,
```

## Example 11 (cnv_4vivdqf)

**Customer:**
```
Throughout: import Calcualtor from '../calculator' should be: import Calculator from '../calculator'

This: Jest DOM actually exposes a module that we can import called Jest DOM/extendexpect should be: Jest DOM actually exposes a module that we can import called Jest DOM/extend-expect

[Additional typo corrections...]
```

**Agent:**
```
Hey Steve,

Thanks for the detailed list of corrections! I've logged all of these for the content team to fix.

Really appreciate you taking the time to document these so thoroughly - it helps us improve the course for everyone.

Best,
```

## Example 12 (cnv_4ph8n2f)

**Customer:**
```
Hi. Good idea to touch key topic: https://kentcdodds.com/blog/understanding-reacts-key-prop
But, I have a feeling you have oversimplified it a bit and missed things from here: https://github.com/facebook/react/issues/11793
I am sure there are things in that thread you could use to improve your article.
```

**Agent:**
```
Hey there,

Thanks for the feedback and the resource link! You're right that there's more nuance to the key prop topic.

I'll pass this along to Kent to review and potentially incorporate into an article update.

Appreciate you sharing the GitHub issue - community input like this helps make our content more comprehensive.

Best,
```
