# Real Responses

## Example 1 (cnv_1j9ysi05)

**Customer:**
```
Hey, I've been getting a lot of application errors in the last couple of days. Looks like it happens when you go the next lesson. Deshi
```

**Agent:**
```
Hey Deshi,

Thanks for reporting this! Sorry you're running into errors.

Could you let me know:
1. Which course/workshop you're accessing?
2. What browser you're using?
3. Any specific error messages you're seeing?

This will help us investigate and get you back on track.

Best,
```

## Example 2 (cnv_1ja6j9t1)

**Customer:**
```
Hi there, Under each Episode there is a text saying: "This module also has exercises for you to practice! Don't skip them!". But I don't find them - I can only mark the Episode as read and then next up is a Quiz. Am I looking wrong, or is the Quiz meant as the Exercise? If so I find this very misleading and confusing.
```

**Agent:**
```
Hey Marvin,

Thanks for pointing this out! You're right that this messaging is confusing.

The quizzes are part of the exercise system, but the text doesn't make that clear. I've logged this as feedback for our content team to clarify.

Thanks for helping us improve!

Best,
```

## Example 3 (cnv_1jarpu05)

**Customer:**
```
I was using node v20 something and I was not able to make the exercises from the basics (the ones which connect ui with the endpoint). I bumped up the version to 22 and it was fine. So if someone reports similar issue it might be from the node version.
```

**Agent:**
```
Hey!

Thanks so much for sharing this! This is really helpful info for others who might run into the same issue.

I've logged this in our notes for troubleshooting. Node version compatibility is definitely something we need to document better.

Appreciate you taking the time to let us know!
```

## Example 4 (cnv_1jaxdx9h)

**Customer:**
```
I can't see the subtitle option in some of your workshop videos. Is this because I installed the npm packages incorrectly? I would appreciate it if you could help me.
```

**Agent:**
```
Hey there,

Subtitle availability isn't related to npm packages - it's handled by our video player.

Could you let me know:
1. Which specific videos are missing subtitles?
2. What browser you're using?

Some videos may not have subtitles yet, but I want to make sure there isn't a technical issue.

Best,
```

## Example 5 (cnv_1jazv55x)

**Customer:**
```
Hi Matt, I'm unable to run the dev server for any exercises that use runLocalDevServer. I keep getting TypeError [ERR_INVALID_URL_SCHEME]: The URL must be of scheme file. I've tried to resolve the issue by updating my tsconfig and import paths. No luck. Here is the full error message:

node:internal/modules/run_main:115
TypeError [ERR_INVALID_URL_SCHEME]: The URL must be of scheme file
at fileURLToPath (node:internal/url:1491:11)
at moduleResolve (node:internal/modules/esm/resolve:920:10)
```

**Agent:**
```
Hey there,

Thanks for the detailed error report! This looks like it might be related to your Node version or how the module resolution is configured.

A few things to try:
1. Make sure you're on Node 20+ (22 seems to work best)
2. Try deleting node_modules and reinstalling
3. Check that you're running from the project root

Let me know if any of that helps or if you need more troubleshooting.

Best,
```

## Example 6 (cnv_1jb556w5)

**Customer:**
```
Sorry, I get: 
> ai-sdk-v5-crash-course@1.0.0 dev
> ai-hero-cli exercise

webidl.is.File = webidl.util.MakeTypeAssertion(File);
^
I'll try to solve it in the meantime, just checking if it's happening to other users?
```

**Agent:**
```
Hey there,

This error typically happens with older Node versions. Could you check which version you're running with `node -v`?

We recommend Node 20 or higher for this workshop. That should resolve the issue.

Let me know if you're still seeing problems after updating!

Best,
```

## Example 7 (cnv_1jb59dk5)

**Customer:**
```
In video 22 Test Drive Mocking react-router's Redirect Component on a Form Submission, you build on saving the post from the previous video. However, the previous video doesn't include saving the post or handling the submit button click. It stops after testing that the button gets disabled after a click. There is either a missing video or just something missing out of video 21.
```

**Agent:**
```
Hey there,

Thanks for catching this! You're right - there appears to be a gap between the videos.

I've logged this with our content team so they can address the missing content or add clarifying information.

Appreciate you taking the time to let us know. It helps us improve the course for everyone!

Best,
```

## Example 8 (cnv_1jb5g95x)

**Customer:**
```
It seems like the problem in explainer 3.5 is that we're trying to connect to the remote GitHub MCP server using SSE, but it only supports HTTP right now. If we replace the code with the following, it works without issues:

const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}`,
    },
  },
});
```

**Agent:**
```
Hey!

Excellent detective work! Thanks for figuring this out and sharing the solution.

You're absolutely right about the transport type. I'll pass this along to the content team so we can update the course materials.

Really appreciate you taking the time to help other learners!

Best,
```

## Example 9 (cnv_1jbz63vp)

**Customer:**
```
Hello, I just purchased Epic MCP and set up the MCP Fundamentals workshop app locally on a Macbook Pro. I am seeing the message "Upgrade for transcripts" in place of where the transcripts should be. I can see the videos but not the transcripts. I logged in and authenticated my device, and connected to discord.
```

**Agent:**
```
Hey there,

Thanks for reaching out! This looks like a license verification issue.

Could you try:
1. Logging out and back in
2. Clearing your browser cache
3. Re-authenticating your device

If that doesn't work, let me know your email address and I can check your license status directly.

Best,
```

## Example 10 (cnv_1jbzkwit)

**Customer:**
```
All links to openAI docs link to the generic and rather short prompt engineering chapter at openAI and not where they're supposed to link. They might've restructured their docs.
```

**Agent:**
```
Hey!

Thanks for reporting this! You're right - OpenAI has restructured their docs and our links are now broken.

I've logged this for our content team to update. We'll get those links fixed.

Appreciate you taking the time to let us know!

Best,
```

## Example 11 (cnv_32tkm6f)

**Customer:**
```
Hi team, From last two days, I'm seeing error like this while I'm playing any video from any module. Frontend: No video is playing. Console: Failed to load resource: the server responded with a status of 403. Also, it shows upgrade to pro, but I'm a pro user. Please check this issue as soon as possible.
```

**Agent:**
```
Hey Siddharth,

Sorry you're experiencing this! The 403 error combined with the "upgrade to pro" message suggests your session might have become disconnected from your license.

Could you try:
1. Logging out completely
2. Clearing your browser cache
3. Logging back in

If that doesn't work, let me know and I can check your account directly.

Best,
```

## Example 12 (cnv_1jdnys85)

**Customer:**
```
Security Note: Offline Video Decryption - Key Derivation Inputs Are Exposed. I used Claude Code to poke around the epicshop code and figure out where the videos are downloaded. I then asked it to explain how they were encrypted. When I asked what it would take to decrypt them, it pointed out that all the ingredients for deriving the encryption key are stored in readable JSON files alongside the videos.
```

**Agent:**
```
Hey there,

Thanks for being a responsible user and bringing this to our attention! We really appreciate you taking the ethical approach and reporting this rather than exploiting it.

I've passed this along to our security team for review. You're right that the encryption is primarily meant to prevent casual sharing rather than be cryptographically unbreakable.

Thanks again for the heads up!

Best,
```
