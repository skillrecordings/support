# Edge Cases

## Example 1: User Provides Solution

**Question:**
```
I was using node v20 something and I was not able to make the exercises work. I bumped up the version to 22 and it was fine. So if someone reports similar issue it might be from the node version.
```

**Answer:**
```
Hey!

Thanks so much for sharing this! This is really helpful info for others who might run into the same issue.

I've logged this in our notes for troubleshooting. Node version compatibility is definitely something we need to document better.

Appreciate you taking the time to let us know!
```

**Why it's an edge case:** Customer solved their own problem and is sharing the solution. Acknowledge and thank them for contributing back.

---

## Example 2: External Service/Dependency Issue

**Question:**
```
It seems like the problem in explainer 3.5 is that we're trying to connect to the remote GitHub MCP server using SSE, but it only supports HTTP right now. Here's the workaround I found...
```

**Answer:**
```
Hey!

Excellent detective work! Thanks for figuring this out and sharing the solution.

You're absolutely right about the transport type. I'll pass this along to the content team so we can update the course materials.

Really appreciate you taking the time to help other learners!

Best,
```

**Why it's an edge case:** Issue is with external service (GitHub), not our platform. Customer found workaround. Log for content update.

---

## Example 3: Security Report

**Question:**
```
Security Note: I found that the video encryption keys can be derived from JSON files stored alongside the videos. I was able to decrypt them in about 20 lines of JavaScript.
```

**Answer:**
```
Hey there,

Thanks for being a responsible user and bringing this to our attention! We really appreciate you taking the ethical approach and reporting this rather than exploiting it.

I've passed this along to our security team for review. You're right that the encryption is primarily meant to prevent casual sharing rather than be cryptographically unbreakable.

Thanks again for the heads up!

Best,
```

**Why it's an edge case:** Security vulnerability report. Thank them, don't dismiss concerns, escalate to appropriate team.

---

## Example 4: Content Gap (Missing Video/Exercise)

**Question:**
```
In video 22 you build on saving the post from the previous video. However, video 21 doesn't include saving the post. There's either a missing video or something missing out of video 21.
```

**Answer:**
```
Hey there,

Thanks for catching this! You're right - there appears to be a gap between the videos.

I've logged this with our content team so they can address the missing content or add clarifying information.

Appreciate you taking the time to let us know. It helps us improve the course for everyone!

Best,
```

**Why it's an edge case:** Not a technical bug but content continuity issue. Log for content team, acknowledge the problem.

---

## Example 5: Confusing UI/Messaging

**Question:**
```
Under each Episode there is text saying: "This module also has exercises for you to practice!" But I don't find them. Is the Quiz meant as the Exercise? If so I find this very misleading.
```

**Answer:**
```
Hey there,

Thanks for pointing this out! You're right that this messaging is confusing.

The quizzes are part of the exercise system, but the text doesn't make that clear. I've logged this as feedback for our content team to clarify.

Thanks for helping us improve!

Best,
```

**Why it's an edge case:** Not a crash/bug but UX confusion. Validate their concern, log for improvement.

---

## Example 6: License/Auth Issue Disguised as Bug

**Question:**
```
Videos won't play and console shows 403 error. Also shows "upgrade to pro" but I'm a pro user!
```

**Answer:**
```
Hey there,

Sorry you're experiencing this! The 403 error combined with the incorrect upgrade message suggests your session became disconnected from your license.

Please try:
1. Logging out completely
2. Clearing your browser cache
3. Logging back in fresh

If the issue persists, let me know your account email and I can investigate your license directly.

Best,
```

**Why it's an edge case:** Appears to be app bug but is actually auth/license issue. Guide through re-auth before investigating further.

---

## Example 7: Browser-Specific Issue

**Question:**
```
I love your downshift plugin but it works great on all browsers except IE11. On IE11, when you close the list, a white box remains. Also, the arrow doesn't change direction.
```

**Answer:**
```
Hey there,

Thanks for the detailed report! Unfortunately, IE11 has limited support these days due to its age and Microsoft's end of support for it.

Most modern web features and libraries, including our components, are optimized for evergreen browsers (Chrome, Firefox, Safari, Edge).

If you're able to use a different browser, that would be the recommended path forward.

Best,
```

**Why it's an edge case:** IE11 is deprecated. Be honest about limited support rather than promising fixes.
