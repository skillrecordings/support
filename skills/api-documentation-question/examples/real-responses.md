# Real Responses (verbatim)

## cnv_m52qw3r

**Question**

```text
The ‘id’ here may be an empty string when url is `/path?id`. At this time, the
behavior of the `if (id)` and `if (typeof id === ‘string‘)` is inconsistent,
although both can do Narrowing.
```

**Answer**

```text
Hey there,


For code questions like this, asking on the Total TypeScript Discord will be the fastest way to get a response (with the added benefit of community members benefitting as well!)


Thanks!
```

## cnv_qzalrwn

**Question**

```text
isolatedModules: true is implied by setting verbatimModuleSyntax: true.

Also, if have a project with both server code (nodejs) and browser code
co-located - What should my ”module”: setting be?
```

**Answer**

```text
Hi,


Could you ask this on our discord since that's where we do code support https://www.totaltypescript.com/discord. 



Plus, your questions and insights can help others too.


I hope this helps!


Best,
```

## cnv_qqxm1c7

**Question**

```text
Hi [NAME], do you need to build new API endpoints to support your MCP server?
I usually heard people complaining that MCP servers are just wrappers of
public APIs, so I wonder if the LLMs can have access to the public API
documentation, wouldn’t be able to do the same using the terminal?

thanks!

[NAME] Salazar


On Mon, Aug 25, 2025 at 5:34 PM [NAME] C. Dodds <[EMAIL]> wrote:

> Hi [NAME],
>
> In my last email, I talked a lot about how MCP is already providing a lot
> of value despite the number of improvements that still need to be made to
> the user experience and the number of available MCP servers.
>
> The fact is that there are quite a few really great MCP servers that you
> can use *today* that will enhance your productivity and improve your
> experience with certain applications.
>
> For a few examples:
>
>    - The Stripe MCP server makes it much easier to interact with your
>    Stripe account
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/z2hgh7ueo33825ip/aHR0cHM6Ly94LmNvbS9qZWZmX3dlaW5zdGVpbi9zdGF0dXMvMTk1ODM5Mzk1ODMxODY3ODA1Mw==>
>    ​
>    - The Sentry MCP server enables your AI assistant to triage and fix
>    issues
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/p8hehqu49zzlwmuq/aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g_dj1KWFJ3S0MyMU1oSQ==>
>    reported in Sentry
>    - The Jira MCP server enables an LLM to write JQL
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/x0hph3uenwwlv2t5/aHR0cHM6Ly94LmNvbS9TdGV2ZTg3MDgvc3RhdHVzLzE5NTgxODczOTE3MTk0ODU4NzE=>
>    for you.
>    - Notion just updated their MCP server
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/6qhehoulp77d8eto/aHR0cHM6Ly94LmNvbS9Ob3Rpb25BUEkvc3RhdHVzLzE5NTU2NjYwNDMyMzU2OTI2MjI=>
>    to be a lot more useful in interacting with everything you have in
>    Notion
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/kkhmh2un8ll30qal/aHR0cHM6Ly94LmNvbS9Ob3Rpb25BUEkvc3RhdHVzLzE5NTU2NjYwNTEzMTM5MDU2ODc=>
>    ​
>
> ​
>
> Every week more examples like these pop up!
> But my personal favorite… is the Epic Workshop MCP server
>
> Okay yes I’m biased, but I want to show you the power of this MCP server
> that I built personally. My goal with this MCP server is to make your life
> better while following Epic workshops.
>
> Follow along with this ~10 minute demo video right now to see it in action!
> [image: [NAME] is onscreen explaining while his computer shows Cursor’s MCP
> tools. The interface highlights Epicshop MCP features like workshop
> navigation, playground management, and progress analysis.]
> <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/58hvh8ug5mmzddc6/aHR0cHM6Ly93d3cuZXBpY2FpLnByby95b3VyLWFpLWFzc2lzdGFudC1pbnN0cnVjdG9yLXRoZS1lcGljc2hvcC1tY3Atc2VydmVyLTBlYXpy>
> ​Your AI Assistant Instructor: The epicshop mcp server
> <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/58hvh8ug5mmzddc6/aHR0cHM6Ly93d3cuZXBpY2FpLnByby95b3VyLWFpLWFzc2lzdGFudC1pbnN0cnVjdG9yLXRoZS1lcGljc2hvcC1tY3Atc2VydmVyLTBlYXpy>
> ​
>
> As you’ll see in the video, right now the workshop MCP server supports:
>
>    1. Changing your playground
>    2. Getting context about the entire workshop or specific exercise
>    3. Getting context about the specific code changes from one step to
>    another
>    4. Getting your progress
>    5. Quizzing you on a specific (or random) exercise
>
> ​
>
> Since the video, I’ve added more tools around managing your own account
> info and progress tracking.
>
> Getting all that context into your LLM means that it can be super helpful
> in answering your questions and evaluating your solutions, ultimately
> leading to a much better learning experience for you. It’s like having a *personal
> guide* to help keep you going in your learning journey!
> How I think about designing an MCP Server
>
> When I'm building an MCP server, I pretty much think of the website that I
> would build or have already built for the service that I'm trying to
> expose. Then I turn all of the UI elements that would be necessary for
> using the website into tools that the user can access and interact with
> inside their LLM using natural language.
>
> Done right, the result is a fabulous user experience because they are able
> to use natural language and the context that the LLM already has to
> interact with my website as if they have a smart, capable, experienced
> assistant working right alongside them.
>
> When I originally created the Epic Workshop app, I KNEW I wanted to give
> learners an AI-assisted learning experience as a built-in feature of the
> workshop app.
>
> *What MCP gave us was even better.* What makes it better is the fact that
> you can plug this into whatever AI assistant you are* already* familiar
> with and using in your day to day workflows, and you have access to all of
> the features that AI assistant has.
>
> In the example from my video, you see that I'm using Cursor as my editor.
> Cursor has access to the file system. It knows what file I have open. It
> knows whatever specific rules that I've given it to customize it to my
> liking. And the Epic Workshop MCP server simply gives it additional context
> to make it even more useful within the context of your own customizations
> and environment. And of course, this works just as well with VSCode or
> other AI-assisted editors or CLIs as well.
>
> Another huge advantage is that instead of building a brand new, custom AI
> chat application from scratch for the workshop app, students use it with
> the AI assistant that they're already paying for. This has three main
> benefits: 1. Attendees get to use the LLM they prefer, 2. I don't have to
> develop it from scratch, and 3. I don't have to manage token limits.
> And that’s just one example you can try for free, TODAY.
>
> The Epic Workshop MCP Server is a fantastic example of the kinds of things
> that you can do with MCP that really unlock awesome features for your
> users. If you haven't already tried it, I suggest you give it a shot for
> yourself.
>
>    1. If you don’t already have a current version of my Epic Workshop
>    repos running on your computer, pick one here
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/25h2h9u3722epku3/aHR0cHM6Ly9naXRodWIuY29tL3NlYXJjaD9xPXRvcGljJTNBd29ya3Nob3AlMjBvcmclM0FlcGljd2ViLWRldiZ0eXBlPVJlcG9zaXRvcmllcw==>.
>    Follow the readme instructions to get it running.
>    ​
>    2. Once the workshop app is running, follow this video and written
>    instructions
>    <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/58hvh8ug5mmzddc6/aHR0cHM6Ly93d3cuZXBpY2FpLnByby95b3VyLWFpLWFzc2lzdGFudC1pbnN0cnVjdG9yLXRoZS1lcGljc2hvcC1tY3Atc2VydmVyLTBlYXpy>
>    for connecting Cursor, VSCode, or your favorite agent that supports MCP to
>    the Epic Workshop.
>    ​
>    3. Try asking your agent to test your knowledge on the material in
>    that workshop. I think you're going to be blown away!
>
> ​
>
> And based on my Sentry insights, people have already been using this MCP
> server and it’s working for them. Pretty cool!!
>
> Later this week I'm going to send you another email I've been thinking a
> lot about: the *skills I think you need* to add to your repertoire in
> this new AI development world.
>
> And then I'm going to share something super exciting that I have been
> preparing for you to help you take your place in this new world of user
> interaction. Stay tuned for more.
>
> — [NAME]
>
> P.S. I really do read replies. If you have any questions or thoughts to
> share, hit me up by hitting reply!
>
>
> Mute EpicAI.pro emails
> <https://click.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov/qvhpz96gi8ud8rr0mktl/aHR0cHM6Ly9rZW50Y2RvZGRzLmNvbS8_bWVzc2FnZT1Eb25lJTJDJTIweW91JTIwc2hvdWxkJTIwbm8lMjBsb25nZXIlMjByZWNlaXZlJTIwZW1haWxzJTIwYWJvdXQlMjBFcGljQUkucHJv>
> | Unsubscribe
> <https://unsubscribe.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov>
> | Update your profile
> <https://preferences.convertkit-mail.com/lmuk2n8kn5tmhn3rdl7c6h83v7v00bgh4xov>
> | P.O. Box 562, American Fork, Utah 84003
>
```

**Answer**

```text
Hi [NAME]!


That's a common question. The answer is that an MCP server is a wrapper around an API in the same way a website is a wrapper around an API. That is to say it's much more than just a wrapper and people try to make it that way to their own demise. In fact, Notion's MCP server started as a simple wrapper and then they realized it didn't work that well and they "went back to the drawing board." Read more about this here: https://x.com/NotionAPI/status/[PHONE][PHONE]


Understanding how to design MCP servers is something I teach about on EpicAI.pro. Stay tuned for the announcement about this on Friday :)


Cheers!
```

## cnv_mxaebwn

**Question**

```text
E.g. in https://github.com/remix-run/remix/tree/main/templates/express
[https://github.com/remix-run/remix/tree/main/templates/express]
there is server.js and tsconfig.json. Instead of server.js I wanna use server.ts
where I wanna import a shared db/client.ts to gracefully shut down. The db dir
is not located in the app dir but in the root dir (with migrations etc.). I
wonder whether and how I need to configure one or many tsconfig.json files to be
able to use the dev server during dev and to serve JS on production. Currently I
am using tsx. Thank you!
```

**Answer**

```text
Hey there,


For code questions like this, asking on the Total TypeScript Discord will be the fastest way to get a response (with the added benefit of community members benefitting as well!)


Thanks!
```

## cnv_mx54m6f

**Question**

```text
Can you please let us know how we can use top level await inside a TS Node
project ?
```

**Answer**

```text
Here you go!


https://www.totaltypescript.com/typescript-and-node
```

## cnv_qrbbzt3

**Question**

```text
Hey [NAME]!

I was wondering if you know of any MCP servers (or other APIs) which
currently offer a natural language “chat” interface like you describe here:

“the best non-trivial MCP servers will come with a built-in agent with a
“chat” tool”

I’m working on a talk about multi-agent apps and couldn’t really find any,
but I hadn’t considered MCP servers as potentially offering one.

Thanks!
Nimo

On Wed, Aug 27, 2025 at 15:50 [NAME] C. Dodds <[EMAIL]> wrote:

> Hey Nimo!
>
> As promised, today I want to talk about the skills I think will be
> critical for your success as a software developer in the next year. It
> really is difficult to predict the future, but we have to plan and prepare
> for it nonetheless.
>
> So here are a few of the most critical skills I’m developing to prepare
> myself for the future I expect. I recommend these to each of you as well.
> *1. Keep building software*
>
> We are now 3 years into hearing “6 months until AI takes all our jobs.”
>
> I don’t know about you, but I really have no idea whether AI will actually
> “take all our jobs.” I don’t think it will, but even if it does, there’s
> nothing we can really do to prepare for that anyway, so may as well keep
> doing what we do best, learning and growing.
>
> Instead, I plan on *continuing to build software* using the latest tools
> and technologies available to me within the constraints of my environment.
> *2. Stick to proven software principles*
>
> I promise to get to new skills in a minute, but I really want to emphasize
> that even though it seems like so much of our software development has
> changed thanks to AI, most of it has stayed the same. The same principles
> that make you a high performing software developer in the 2010s will
> continue to make you a high performing software developer in the 2020s.
>
> I’ve found that *treating AI agents like they’re humans* (for whom I have
> empathy) makes them perform better. Quality instructions/requirements, good
> documentation and tests, quality code review, etc etc.
>
> This is a good opportunity for me to remind you I have written out my
> personal software development principles and there’s even a cheat sheet you
> can download and print: https://www.epicweb.dev/principles
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/58hvh8ug5kgn9zb6/aHR0cHM6Ly93d3cuZXBpY3dlYi5kZXYvcHJpbmNpcGxlcw==>
> ​
>
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/25h2h9u37438oos3/aHR0cHM6Ly93d3cuZXBpY3dlYi5kZXYvcHJpbmNpcGxlcy9jaGVhdHNoZWV0>
> ​Free Printable Cheat Sheet
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/25h2h9u37438oos3/aHR0cHM6Ly93d3cuZXBpY3dlYi5kZXYvcHJpbmNpcGxlcy9jaGVhdHNoZWV0>
> of the Epic Programming Principles
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/58hvh8ug5kgn9zb6/aHR0cHM6Ly93d3cuZXBpY3dlYi5kZXYvcHJpbmNpcGxlcw==>
> ​ *3. Practice “Context Engineering”*
>
> This is a term that effectively means giving the right context to the AI
> agent so it performs the task you want. It’s about more than just
> prompting. It’s about how you organize your codebase, how you converse with
> it. Asking it questions to make sure it understands the requirements. Using
> an agent to generate a product requirements document (PRD) which you then
> hand off to an agent to actually implement and nudge it in the right
> direction.
>
> On the flip side, loading an agent with *too many* irrelevant details
> often results in a poor implementation that’s harder to understand and
> review. So there’s a lot to do to manage this communication channel and in
> some cases I think we should “make the computer do it,” and increasingly
> the models and the apps we use to interact with these models are doing more
> and more to make it easier for us to be lazy, but I’m working hard to
> improve my own skills in this area so I can take advantage of this now.
>
> Incidentally, *MCP helps with this as well*. Not only can you hook up
> your agent with good MCP servers that can feed in context from things like
> github issues and Sentry errors, but you can also create a custom MCP
> server for yourself that houses your personal prompts and allows the agent
> to run tasks as needed.
>
> This is a skill that will pay back big dividends. Like with all workflow
> changes, you'll feel less productive at first, but once you've adapted,
> you’ll start feeling more confident and productive.
> *4. Build MCP servers*
>
> This one’s probably obvious, but building MCP servers will be as critical
> a skill as building a browser-based user interface. So many skills transfer
> here, but there are new ones you’ll want to learn because to get the best
> results, the server instructions, tool descriptions and structure, prompts,
> and sampling all require you to learn how to effectively prompt the model.
>
> And taking a new technology as far as possible is a great way to learn its
> limitations and contribute to breaking down those barriers.
>
> For me, I’m building out some services that are exclusively accessible
> through MCP. This has been a really cool experiment and has taught me about
> the remaining gaps that stand between MCP as it is today, and the point at
> which MCP can offer a true replacement for a website.
>
> These experiments are what motivated me to kick off the conversation that
> led to MCP-UI and I’m still working on getting MCP to support
> mid-conversation authorization upgrades and more. When you’re *involved
> at this early stage*, you can make a really *huge impact* and that’s
> exciting to me.
> *5. Build an AI agent*
>
> The vast majority of developers will build the tools agents use than the
> actual agents themselves. Similar to the number of developers working on
> web browsers vs those working on web apps. We’ll eventually get to
> JARVIS-level AI Assistant and we’ll be able to use a single agent that can
> do all the things. That said, we’re not there yet. So understanding how
> agents work will be an important skill and there’s no better way to do that
> than to build one yourself.
>
> And to take it a step further, the best non-trivial MCP servers will come
> with a built-in agent with a “chat” tool. The user’s agent can then chat
> with your agent to get the job done. Gives a whole new meaning to the
> phrase *“have your people call my people.”* Except now everyone has
> “people,” not only Beyoncé and Ellen’s AMEX
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/qvh8h8ud8od468al/aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g_dj1TMmVDalNBekl0SQ==>
> 😉
>
> I'm excited to share more about this concept in the future, but the
> relevance of custom agents will continue to increase over time, and MCP
> will be how those agents communicate with (“call” 😉) one another.
> *6. Build Vectorized Search*
>
> Training or fine-tuning a model on your own data is cool, but it's a lot
> of work for limited utility. What’s more useful is getting a general-use
> model to be able to easily retrieve the context it needs to accomplish the
> task at hand. MCP enables this (that's what the “Model *Context*
> Protocol” is all about, after all), but until you also build a reasonable
> way for the model to search for the relevant context it’s kind of limited
> on what it can do for you.
>
> For example, my website has a mechanism for searching for content (you can
> use it with https://kentcdodds.com/s/{searchTerm}
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/g3hnhwume6mlz3ir/aHR0cHM6Ly9rZW50Y2RvZGRzLmNvbS9zL3NlYXJjaFRlcm0=>),
> but it’s pretty limited, simply text matches. If I ask an agent to use my
> MCP server to search for any time I interviewed someone about teaching
> themselves to code, it’s unlikely it would find my interview with Preethi
> Kassireddy
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/9qhzhdudgzd62dh9/aHR0cHM6Ly9rZW50Y2RvZGRzLmNvbS9jaGF0cy8wMy8wOS9wcmVldGhpLWthc2lyZWRkeS1yZWludmVudHMtaGVyc2VsZg==>
> with a simple text match.
>
> As *users get comfortable with using natural language*, exposing your
> knowledge base to (authorized) agents with the capability of vectorized
> search is powerful.
> *7. Building evals (AI testing) and observability*
>
> More and more of our business and user experience is going into the black
> box of AI models. So we need to find every opportunity we can to shine a
> light on whether the changes we’re making are improving things and keep an
> eye on how they’re performing.
>
> Again, this "new thing" isn't actually all that different from what we’ve
> been doing as software engineers. It’s always been important to validate
> that your changes actually improve UX and monitor what goes on in
> production. But *AI adds a new dimension of challenge*. Learning how to
> do this cost-effectively is a new frontier.
> *Looking forward*
>
> I love building software and I'm not going to stop. Instead I'm planning
> to take these powerful new tools and use them to keep pushing the
> boundaries of *great user experience*, and pursuing my mission to *make
> the world a better place*.
>
> At this point, all we can expect is for things to be different from what
> we planned, but *the version of you* who acquires the skills I’ve shared
> above will be better prepared and better off than the version of you who
> does not. And that’s worth working toward.
>
> Remember, I’ve got a really exciting *announcement coming on Friday*.
> You’re not going to want to miss it.
>
> — [NAME]
>
> ​
> ​
>
>
> Mute EpicAI.pro emails
> <https://click.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm/3oh4632dfdu3q432d4ur/aHR0cHM6Ly9rZW50Y2RvZGRzLmNvbS8_bWVzc2FnZT1Eb25lJTJDJTIweW91JTIwc2hvdWxkJTIwbm8lMjBsb25nZXIlMjByZWNlaXZlJTIwZW1haWxzJTIwYWJvdXQlMjBFcGljQUkucHJv>
> | Unsubscribe
> <https://unsubscribe.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm>
> | Update your profile
> <https://preferences.convertkit-mail.com/38ukxrrlvlukh27xgk0frh4lpxpnns7hzogm>
> | P.O. Box 562, American Fork, Utah 84003
>
```

**Answer**

```text
Hey [NAME], I'm not aware of any servers right now, but I do know that Darren Shepherd (https://x.com/ibuildthecloud) is at least looking into building stuff like this. 


I'll be making a course about it before too long as well.
```

## cnv_os5j39j

**Question**

```text
Hi! I have an error when I tried to retrieve auth code. I am logged in but when
I pressed the button this error show up in the local terminal, where I have the
project running.

Error parsing auth rejected event ZodError: [

{

"code": "invalid_literal",

"expected": "AUTH_REJECTED",

"path": [

"type"

],

"message": "Invalid literal value, expected \"AUTH_REJECTED\""

}

]

at Object.get error [as error]
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/zod/lib/index.mjs:587:31)

at EventEmitter.handleAuthRejected
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/routes/login-sse.tsx:47:63)

at EventEmitter.emit (node:events:531:35)

at registerDevice
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/utils/auth.server.ts:71:15)

at processTicksAndRejections (node:internal/process/task_queues:95:5) {

issues: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

],

addIssue: [Function (anonymous)],

addIssues: [Function (anonymous)],

errors: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

]

} { error: 'self-signed certificate in certificate chain' }

Error parsing auth rejected event ZodError: [

{

"code": "invalid_literal",

"expected": "AUTH_REJECTED",

"path": [

"type"

],

"message": "Invalid literal value, expected \"AUTH_REJECTED\""

}

]

at Object.get error [as error]
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/zod/lib/index.mjs:587:31)

at EventEmitter.handleAuthRejected
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/routes/login-sse.tsx:47:63)

at EventEmitter.emit (node:events:531:35)

at registerDevice
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/utils/auth.server.ts:71:15)

at processTicksAndRejections (node:internal/process/task_queues:95:5) {

issues: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

],

addIssue: [Function (anonymous)],

addIssues: [Function (anonymous)],

errors: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

]

} { error: 'self-signed certificate in certificate chain' }

Error parsing auth rejected event ZodError: [

{

"code": "invalid_literal",

"expected": "AUTH_REJECTED",

"path": [

"type"

],

"message": "Invalid literal value, expected \"AUTH_REJECTED\""

}

]

at Object.get error [as error]
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/zod/lib/index.mjs:587:31)

at EventEmitter.handleAuthRejected
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/routes/login-sse.tsx:47:63)

at EventEmitter.emit (node:events:531:35)

at registerDevice
(file:///C:/Users/b061902/react/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/utils/auth.server.ts:71:15)

at processTicksAndRejections (node:internal/process/task_queues:95:5) {

issues: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

],

addIssue: [Function (anonymous)],

addIssues: [Function (anonymous)],

errors: [

{

received: undefined,

code: 'invalid_literal',

expected: 'AUTH_REJECTED',

path: [Array],

message: 'Invalid literal value, expected "AUTH_REJECTED"'

}

]

} { error: 'self-signed certificate in certificate chain' }
```

**Answer**

```text

We appreciate the question! I always like to direct these to our discord server https://kcd.im/discord.


You can get immediate and great advice over there. Plus, your questions and insights can help others too.


I hope this helps!


Best,
```

## cnv_1jbg8zmt

**Question**

```text
Hi [NAME],

Sorry to reach out this way; I don’t use Twitter and couldn’t find another contact.

I’ve been watching many of your AI videos and building projects of my own, but I keep running into the same problem: resumable streams. I looked at the Vercel Resumable Stream repo (https://github.com/vercel/resumable-stream) and JoshTriedCoding’s post on Upstash (https://upstash.com/blog/resumable-llm-streams), and I understand the theory - using a Redis Stream as an intermediary, writing LLM chunks to it, and having another endpoint read them back - but I’m having trouble applying it in practice once the other abstractions are layered on.

Would you consider making a video that demonstrates resumable streaming? I’d especially appreciate a minimal, stripped-down example of a chatbot that uses only the AI SDK (no extra layers like the Vercel Chat SDK) and implements resumable streaming end-to-end.

Thanks for all the great content, I’d love to see this topic covered.

Marshall
```

**Answer**

```text

We appreciate the question! I'd ask this on our discord server since this inbox is for site support https://aihero.dev/discord.


Plus, your questions and insights can help others too.


I hope this helps!


Best,
```

## cnv_q0xx7lz

**Question**

```text
Thanks for the help with tsconfig! It’d be nice to have information about the
effect on the import instruction of each option. I always have issues when I
want to import blah from ‘../meh/somefile.ts’

That last .ts is necessary or throws depending on the config
```

**Answer**

```text

Hi,


We appreciate the feedback! I'd ask this on our discord server since this inbox Is more so for site support https://kcd.im/discord. 



Plus, your questions and insights can help others too.


I hope this helps!


Best,
```

## cnv_o7x5n9j

**Question**

```text
Greetings,

I need a help with creating a function, I have an array of string keys, and have
an object with type OBJ.

I need to map over these keys, and check if this object can contain this key or
not, but I searched a lot, then no results!

Please help me to know that!
Regards,
```

**Answer**

```text

Hi,


We appreciate the question! I always like to direct these to our discord server https://discord.com/invite/8S5ujhfTB3. 



You can get immediate and great advice over there. Plus, your questions and insights can help others too.


I hope this helps!


Best,
```
