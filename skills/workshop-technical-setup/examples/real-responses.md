# Real Responses (verbatim)

## cnv_qfceatj

**Question**

```text
Hey,
I am Rahul and I purchased a ticket for the MCP workshop which is happening
on July 18th. I got the google calendar invite but when I open the
instructions page attached, I can't find any zoom or google meet link.
Since this is a remote session, I wanted to make sure before hand that I
have the meeting link.

Regards,
[NAME][image: Screenshot 2025-07-09 at 11.26.12 AM.png]
```

**Answer**

```text
Your screenshot shows that you are seeing the instructions. There's a link in the instructions for how to join the workshop, but I have updated the instructions to make it more explicit. Please make certain to read and follow all instructions before the workshop time arrives! Preparation will take some time!
```

## cnv_od2qeiv

**Question**

```text
Hey setting up the epic react workshop! I was able to run the app, watched the
getting started video, and then after I logged in (I may have used the wrong
email), I can’t run the app, I get an “Unexpected Server Error” and in my
terminal it says zod error: Expected object, recieved null. Any tips?
```

**Answer**

```text
Sorry about that! I pushed a bad validation. It should be fixed now. Just run:


npx update-epic-workshop 


From within the workshop directory and you should be good to go.
```

## cnv_p8evitj

**Question**

```text
I need help - my server keeps crashing.

I have downloaded the workshop, I’ve run npm run setup (all successful), but
after I run npm start, it will crash. I am unable to use playground and it
cannot detect the differences between my work and the solution. I cannot use the
course because of this issue, please help!

In addition, I can’t join the Discord server properly. I’m in as CatEye, but I
can’t access any of the channels. I’ve tried to follow the instructions in
how-to-join, but the https://kentcdodds.com/me [https://kentcdodds.com/login]
site doesn’t work for me. The magic links don’t work for me sadly.

I would love some help please. Thank you.
```

**Answer**

```text
Hey,

I can try and help you get the discord working since that's where we do code support!


Sometimes discord can be finicky. I've sent you a new login link to access kentcdodds.com. Let me know If that doesn't work.
```

## cnv_od4hurr

**Question**

```text
After I verified the device token, the workshop app show "Unexpected server
error"

Here are errors from the terminal

ZodError: [
  {
    "code": "invalid_type",
    "expected": "object",
    "received": "null",
    "path": [
      "discordProfile"
    ],
    "message": "Expected object, received null"
  }
]
    at Object.get error [as error]
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/zod/lib/index.mjs:587:31)
    at ZodEffects.parse
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/zod/lib/index.mjs:692:22)
    at getFreshValue
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/utils/epic-api.ts:638:26)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at getFreshValue
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/@epic-web/cachified/src/getFreshValue.ts:17:24)
    at Module.cachified
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/@epic-web/cachified/src/cachified.ts:89:17)
    at
file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/remix-utils/build/common/promise.js:30:106
    at async Promise.all (index 3)
    at promiseHash
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/remix-utils/build/common/promise.js:30:31)
    at loader$y
(file:///Users/pakaponk/workshops/epic-react-v2/react-fundamentals/epicshop/node_modules/@epic-web/workshop-app/app/root.tsx:106:21)
{
  issues: [
    {
      code: 'invalid_type',
      expected: 'object',
      received: 'null',
      path: [Array],
      message: 'Expected object, received null'
    }
  ],
  addIssue: [Function (anonymous)],
  addIssues: [Function (anonymous)],
  errors: [
    {
      code: 'invalid_type',
      expected: 'object',
      received: 'null',
      path: [Array],
      message: 'Expected object, received null'
    }
  ]
}

I guess it is probably related to Discord but it's 3am so I am not in
the mood to look further. Hope the above error is enough to help you figure
out the solution

Note that I owned [NAME] React V1 and have joined your discord a long time
ago.
```

**Answer**

```text
Hello [NAME],


I pushed some overly strict validation a while ago. This should be working again now with the latest version. Can you run:
npx update-epic-workshop
from within the workshop directory, and then try again. It should be working now. Let us know. Thanks!
```

## cnv_q9tjjlz

**Question**

```text
Hi [NAME]!

Nice to meet you. I’m looking forward to the MCP workshop tomorrow. I seem to recall seeing some instructions about how to prepare for a workshop but I can’t seem to find the link. Is there anything specific to prepare for the workshop tomorrow? See you there!

Thanks!

[NAME] Maes



> On May 21, 2025, at 10:42 PM, [NAME] AI Pro <[EMAIL]> wrote:
> 
> If you have any questions or feedback, please reply to this email and let me know.
> 
> Cheers,
> 
> [NAME] C. Dodds
> 
> unsubscribe <https://subscriptions.pstmrk.it/unsubscribe?m=1.LXHc_2mHWSl-7MZ6vXtCTg.vyFzT4t5xAgCqvuvKSYqmjpYoUaVoe_E7g_ffCC8LbSMOO50rVwfpVlhQaDgrA60-LqrGyCW4IYtTYoYpE8l1qED1O_6O6NW5rCGEklKjN0Pn6cA3ZDJBHDt1I5ZVXG6-EB194_H-FZTDQmLHoBryiPsMPCAlqnxRznRAICiH7HTkJl2nNNXhQxbRKYJJcqoVc0Hb22jdkGPUZoVsXfr9Ws7JJyb1_8PNd8HrRBDxm2kNJIvLlZ34hgVoR94Vmq5fynHYsAWuIZe-dY9-mkn3By4JAsZBd7-BMLrfTFkKri1lPY48TEQL-gzrL6wUWh2sw0Xy9zKp3MWuuDTE51iN_ADBi105LRQzt4hMf3ofgCklr6QW5dGxGhW1j0rFmFBOmc3-7Wx0NmjI-IXI49NkMS9Ii9snJrfCcI3Lh47pjsoMfM9sgIzhCfwixgmbkZ2taqy9Wt4GjYJceOWLwAIu5ME4TWazHyUJ9_WfrI_h2YneTTu7woZQn1kHNQuHOQ94PC3A0ggqRx1GDpVzt2PXLyyZxDwOH7xOnj8O1ocHlpth92Eiq-w0lz-vPBGPwPb>
> [ADDRESS], Ste. B, PMB #97429 Houston, TX [PHONE]
```

**Answer**

```text
Hi [NAME],


You should have received a calendar invite titled "Workshop: MCP Fundamentals (2025-06-17)" with details. I see you're on the invite list. Check your spam? See you tomorrow!
```

## cnv_1jbxen6t

**Question**

```text
Hi [NAME],

I just bought this course and tried to run the workshops locally but it
kept showing this (the screenshot) even after logging in numerous times.
would love to get some help
[image: Screenshot 2025-12-05 at 12.03.19 PM.png]

On Fri, Dec 5, 2025 at 11:24 AM [NAME] AI Pro <[EMAIL]> wrote:

> [NAME] AI Pro
>
>  ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿ ‌​‍‎‏﻿
>
> Log in as *[EMAIL] <[EMAIL]>* to [NAME] AI
> Pro.
> Log In
> <[AUTH_LINK]>
>
> or copy and paste this URL into your browser:
> [AUTH_LINK]
> ------------------------------
>
> The login link above is valid for 24 hours or until it is used once. You
> will stay logged in for 60 days. Click here to request another link
> <http://www.epicai.pro/login>if the link above isn't working.
>
> Once you are logged in, you can access all of your invoices here
> <http://www.epicai.pro/invoices>.
>
> Need additional help? Reply!
>
> If you did not request this email you can safely ignore it.
>
```

**Answer**

```text
Hi, 


Can you tell me more about where you're having trouble? In the actual "https://www.epicai.pro/" website or the workshop app locally? Just trying to understand your context because I'm not getting these type of requests. 


I logged in as you and you have access to all the lessons and workshops.
```

## cnv_mpu25xj

**Question**

```text
Hi [NAME],

Trying to fill out form, but I see this message on Google’s page:

You need permission

This form can only be viewed by users in the owner's organization.

Try contacting the owner of the form if you think this is a mistake.

Best,
[NAME] 25, 2024, at 7:00 PM, Pro Tailwind <[EMAIL]> wrote:

https://forms.gle/HuobUgMWkan9cZTa8<https://click.convertkit-mail2.com/92u36rwn9lanhqrnvn9h9h0x48633/n2hohqu3ewwm6gh0/aHR0cHM6Ly9mb3Jtcy5nbGUvSHVvYlVnTVdrYW45Y1pUYTg=>
```

**Answer**

```text
Oh no 😢​


I am really sorry about this. I have changed the permissions so that the form can actually be filled now 😅
```

## cnv_qjkwbrb

**Question**

```text
Hello [NAME],
I am looking forward to the workshop. I have been attempting to access the instructions on the workshop page as indicated, but I am unable to do so as it displays "Page Not Found". I have attached a screenshot for your reference.


Regards,
[NAME] Kumar Chauhan
On 15 Jul 2025 at 8:50 AM +0530, [NAME] AI <[EMAIL]>, wrote:
> Workshop: MCP Fundamentals (2025-07-28)
>
> This event isn't in your calendar yet
> You haven’t interacted with [EMAIL] before. Do you want to automatically add this and future invitations from them to your calendar?
> Add to calendar
>
> IMPORTANT: Please take time before the workshop to review the instructions on the workshop page because there's some prep work you will need to complete before you can join the workshop.
> If you do not do this prep work, you may miss the first 20 minutes of the workshop getting things set up and will generally have a bad time.
> When
> Monday 28 Jul ⋅ 21:00 – Tuesday 29 Jul 2025 ⋅ 03:00 (India Standard Time - Kolkata)
> Organiser
> [NAME] AI
> [EMAIL]
> Guests
> (Guest list has been hidden at organiser's request)
> Reply for [EMAIL]
> Yes
> No
> Maybe
> More options
> Invitation from Google Calendar
> You are receiving this email because you are subscribed to Calendar notifications. To stop receiving these emails, go to Calendar settings, select this calendar and change ’Other notifications’.
> Forwarding this invitation could allow any recipient to send a response to the organiser, be added to the guest list, invite others regardless of their own invitation status or modify your RSVP. Learn more
```

**Answer**

```text
Hey [NAME],

Sorry about the dead link! Thanks for the heads up. 

Best,
```

## cnv_juotnwn

**Question**

```text
Hi!

It might be a silly question, but I have only a free plan for zoom which
allows me to be in the meeting room for 40 minutes.
Since this meeting is hosted by you, Can i stay up until the end of the
workshop regardless of my zoom plan?

Best regards

2023년 6월 6일 (화) 오후 6:59, [EMAIL] <[EMAIL]>님이
작성:

> Hey there! There are a few things you need to know in advance so we can
> make the most of the time we have together for the Advanced React with
> TypeScript workshop on Friday, June 9th at 9AM Pacific.
>
> We use Zoom, so be sure to have it installed.
>
> We will get started right away, so having the workshop repository
> installed and set up ahead of time is required. No time will be available
> for troubleshooting setup issues when the workshop begins.
>
> Here’s the link to the repo:
>
> https://github.com/total-typescript/react-typescript-tutorial
>
> We will be working through sections 4 through 8 for the workshop.
>
> Be sure to pull changes over the next couple of days leading up to the
> workshop, as there may be some updates!
>
> It may also be helpful to work through the React with TypeScript tutorial
> ahead of time:
> https://www.totaltypescript.com/tutorials/react-with-typescript
>
>
> During the workshop, you will be split into smaller breakout groups to
> work through challenges, before coming back together to discuss solutions.
>
> Meeting Info:
>
> Join Zoom Meeting at 9AM Pacific, Friday June 9th
> https://egghead.zoom.us/j/[PHONE]?pwd=QkpDdGtQdlFWdVRmMVRSZFFnakxwUT09
>
> Meeting ID: [PHONE] 1168
> Passcode: 831561
>
> This workshop is scheduled to run from 9AM to 2PM Pacific, with a break
> for lunch. No recording of the workshop will be provided.
>
> See you on Friday!
>
> [image: Sent from Front]
```

**Answer**

```text
The time limit is related to the host account and ours is paid!
```

## cnv_oxj1c93

**Question**

```text
Hey, I have issues running the workshop locally, specifically when logging in. I did the previous workshops in my Arch Linux setup, but due to the playwright dependency, I had to move to my Macbook for this one.

The setup finishes fine, but when I try to log in, I get this error: https://pastecode.io/s/ui65d2co

My setup: Node v21.6.1, MacOS 15.1.1 (24B91). 

Did I miss something?
```

**Answer**

```text
That's on me! Sorry about that. I've messaged you back in discord.
```
