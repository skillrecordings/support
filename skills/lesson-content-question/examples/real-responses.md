# Real Responses (verbatim)

## cnv_qibtxc7

**Question**

```text
 [EMAIL] writes:

This is the wrong video, isn't it? It's the first video from "Scripting Local Language Models with Ollama and the Vercel AI SDK".


---
lesson: Foundation: Building AI Memory with MCP and Cursor: https://app.egghead.io/lessons/foundation-building-ai-memory-with-mcp-and-cursor~duu9m
```

**Answer**

```text
Thanks for flagging this lesson video, we updated with the correct one
```

## cnv_n2h5vpj

**Question**

```text
Any advice on strictNullChecks?
```

**Answer**

```text
Yes! strictNullChecks is baked into strict, so it's on by default in my cheat sheet.
```

## cnv_ifmgv5z

**Question**

```text
Hello Team,

I found a mistmach between what is say in the video and what you find in the notes. The mismatch happens in Function Overloads vs Union Types - Solution video. In the video Matt say:

" Function overloads are the best when you have different return types and Union Types when you have the same return types"

But in the notes you find the opposite:

[imagen.png]

This lead to confusion. I'm sure the notes are correct but I'm not 100% sure of this.

Greetings, Said.
```

**Answer**

```text
Hello Said,
Thanks for bringing this to our attention! You are correct-- the advice should be "same types? Use a union. Different types? Function overloads".


We have updated the lesson text accordingly.


-Taylor
```

## cnv_dkz4s93

**Question**

```text
I was wondering if the Epic React Course (Pro version) was taught in Typescript? Or are there modules within the course that utilize TS?


Thanks,
Brandon
```

**Answer**

```text
Hey Brandon,


Thanks for reaching out!


Kent was in the process of updating the course to use Typescript, but had to put the updates on hold indefinitely. Several of the workshops have a `next` branch that contains the updated version of the workshop that were going to be used as part of the update. Those repositories also have an issue titled "Changelog" with details on what changed. Only three workshops don't have a `next` branch: React Performance, React Suspense, and Bookshelf.


The Performance Workshop has a pull request from someone who updated everything to TypeScript, so it can be used as a reference as well.
```

## cnv_b12btl3

**Question**

```text
Hi there,

I am trying to find the background materials for the *useCallback: custom
hooks* lesson but I can't find it.

Kent says the following at the beginning of the lesson (taken from the
transcript)
In the background here, feel free to read through this. I explained what
the use case of useCallback is. You can read through that, get a good idea
of the API and the use cases. Make sure to not skip over this blog post
where I talked about why you shouldn't use useCallback everywhere and use
it more surgically.

Apologies if this is mentioned in an earlier lesson. I'm dipping in and out
and at the moment I need to learn about custom hooks.

Kind regards,
Ann-Marie
```

**Answer**

```text
Hi Ann,


Every workshop has a repo that you're supposed to download and install (as explained in https://epicreact.dev/welcome). That's where you can run the app and go through exercises and that's where the background information is.


Specifically for that exercise, you'll find the repo here: https://github.com/kentcdodds/advanced-react-hooks and the background for that exercise is here: https://github.com/kentcdodds/advanced-react-hooks/blob/827bcdfcdc3e29b187024800f31c90e64d07d2be/src/exercise/02.md


I hope that helps!
```

## cnv_mpbl6h3

**Question**

```text
Hi! I’m not on X, so I wanted to ask a question about the TSConfig cheatsheet. I
was wondering if the option “preserve” for “module” is a typo, as I can’t find
it anywhere in the ts docs. I currently use “esnext”, is “nodenext” better?
What about the “incremental”: true option? Is it useful to add to the
cheatsheet, to speed up the compilation?

Thank you for your effort and amazing work.
Giovanni Incammicia
```

**Answer**

```text
Thanks for emailing!


"Preserve" is a new option in 5.4, built to reflect how Bun handles modules.


"Incremental" has been a bit hit and miss for me, I've found that it's a bit too aggressive in its caching so ends up causing weird issues. I prefer leaving it off.
```

## cnv_i24asef

**Question**

```text
Ehy,


thanks for this great course, it’s being very useful so far. Something I don’t
understand regarding the DatePicker implemenation:


- if I try to navigate the table cells with VoiceOver on Mac for the Cranberry
Lake page, I don’t see the roving tabindex moving. Is that expected? do I need
to turn on specific VoiceOver mode to see the arrow navigation work properly?


- Another thing I found is that axe tools are reporting that aria-selected is
not a valid attribute for a button, so in my implementation I made the table
cell interactive (without button inside it), but in this way if I try to
activate a date button with “Enter” key, it doesn’t work for some reason.

Have a great day!

Stefania Mellai (I’m also in the a11y slack)
```

**Answer**

```text
Hi Stefania,


Thanks so much for your message! I've been without internet for a few weeks, so thanks also for your patience in my response as I come back online.


To answer your question about the Date Picker implementation, I'll start with this:


Which version of the Cranberry Lake demo page did you test with VoiceOver? There are intentionally broken versions and partially implemented ones that will have varying results. 


Here's a link I would recommend as the roving tabindex is working for me in Safari with VoiceOver. I do have QuickNav turned off on my machine: https://workshop-interactions-mechanics.testingaccessibility.com/exercise3/listing-cranberry-lake


For your second question about aria-selected, I had debated on whether to use aria-selected or aria-pressed and ended up with the current implementation based on how it performed in testing. But looking at the ARIA spec, it pretty clearly indicates that aria-selected only goes on grid, option, or tab roles (as Axe is reporting). The button is inside of a table/grid implementation but it could be adjusted.


There are a few options I'd look at: 

removing the buttons and making the table cells interactive

suppressing table cell roles with role="presentation" and making the button elements do grid cell and interactive work with a mix of roles and other attributes

putting aria-pressed on the button. The last option is probably the easiest but I'd want to check support in screen readers.



I'd love to hear your thoughts!
```

## cnv_fy9mgw7

**Question**

```text
Hi team

When I learn React, everyone tells me setState is async because when I
console.log the state right after a setState, it will print the old value.
It seems correct at first, but I check the source code and useState doesn't
return any promise nor use async/await.

Meaning setState must be sync. But if it's sync then why React doesn't
re-render the component right away when I call setState? As you can see in
the code snippet below, console.log gets executed first, then "render1" is
printed later
[image: image.png]
```

**Answer**

```text
Hey Minh,


You may want to try asking again in Discord.
```

## cnv_njkngqv

**Question**

```text
First off thank you Matt,

You made me a better TS developer through your YouTube videos and
constantly get me excited for features and techniques of the language I've
never thought about.

I'm trying to understand the appropriate times to use React "HTML-like"
props:


   1. React.HTMLProps
   2. React.DetailedHTMLProps
   3. React.ComponentProps
   4. React.ComponentPropsWithRef
   5. React.ComponentPropsWithoutRef
   6. React.JSX.IntrinsicElements
   7. Any others I'm not aware of?

Is there a valid use case for each one, or are there ones we have no good
reason to be using?

I've always use the React.ComponentPropsWIthoutRef for mirroring html
elements as suggested by the React-TypeScript cheat sheet
<https://react-typescript-cheatsheet.netlify.app/docs/advanced/patterns_by_usecase/>,
but met developers who disagree and use DetailedHTMLProps.

Thanks even if you don't respond.


*STEPHEN KOO*
[EMAIL]
```

**Answer**

```text
Hi Stephen!


I think of DetailedHTMLProps as kind of an 'internal' type used to construct other types. So, it is probably more likely to change than something like ComponentPropsWithRef, which I consider to be more of a 'public' API.
```

## cnv_muyxhon

**Question**

```text
Hello!

Great courses!!!

I’m going through Type Transformations Workshop and I have a question.

In the last course challenge (Use Recursion and Mapped Types to Create a Type
Helper), in the solution video, you mention that { [K in keyof string]:
string[K] } is no-op.

But if you take a look at this simplified TS Playground:
https://www.typescriptlang.org/play?ts=5.4.5#code/C4TwDgpgBAIhFgAoEMBOwCWyA2AeAKgHxQC8UA3lANoDSUGAdlANYQgD2AZlPgLoBcseEjSYcBWr2IBfANwAoeaEhQAogA9kAWzDZoZOAhToseAM7BUjAOaFFQA,
[https://www.typescriptlang.org/play?ts=5.4.5#code/C4TwDgpgBAIhFgAoEMBOwCWyA2AeAKgHxQC8UA3lANoDSUGAdlANYQgD2AZlPgLoBcseEjSYcBWr2IBfANwAoeaEhQAogA9kAWzDZoZOAhToseAM7BUjAOaFFQA]you’ll
notice `{ [K in keyof string]: string[K] }` seems to in fact work, and returns
string.

Now if you take a look at
https://www.typescriptlang.org/play?#code/C4TwDgpgBAogHgQwLZgDbQLxQN5QNoDSUAlgHZQDWEIA9gGZQDOwATmQOYC6AXE6x4U5QAvkA,
[https://www.typescriptlang.org/play?#code/C4TwDgpgBAogHgQwLZgDbQLxQN5QNoDSUAlgHZQDWEIA9gGZQDOwATmQOYC6AXE6x4U5QAvkA]you
can see that Example type doesn’t return string, it seems to copy all attrs and
methods of string.

My question is: why in this playground
https://www.typescriptlang.org/play?#code/C4TwDgpgBAogHgQwLZgDYQIxQLxQN5QDaA0lAJYB2UA1hCAPYBmUAzsAE6UDmAugFysO3EjygBfAFATQkWIhToATAB4AKgD4c+IqUo06TKKv5GR4qTOjxkaCAGYt1hRBVtOFLuqA
[https://www.typescriptlang.org/play?#code/C4TwDgpgBAogHgQwLZgDYQIxQLxQN5QDaA0lAJYB2UA1hCAPYBmUAzsAE6UDmAugFysO3EjygBfAFATQkWIhToATAB4AKgD4c+IqUo06TKKv5GR4qTOjxkaCAGYt1hRBVtOFLuqA],
Example1 doesn’t return string like Example3?

It seems like that TypeScript “infers” `{ [K in keyof string]: string[K] }` as
string only when used within a generic.
```

**Answer**

```text

> It seems like that TypeScript “infers” `{ [K in keyof string]: string[K] }` as string only when used within a generic.



This seems correct! Very strange, and a nice find. It might be that "keyof string" resolves differently to "keyof T", where T is constrained to be a string.
```
