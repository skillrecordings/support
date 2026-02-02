# Edge Cases

## Example 1: Student Requesting Discount (Route to Scholarship)

**Question:**
```
I'm a high school student and I don't have enough money to purchase the course even at the reduced rate. Is it possible to get a student discount?
```

**Answer:**
```
Hey there,

Thanks for reaching out! I appreciate your interest in learning TypeScript.

I've flagged your request for review. Someone from our team will follow up with you about options for students.

Best,
```

**Why it's an edge case:** Student specifically requesting discount → Route to scholarship-financial-aid skill for human review rather than just providing general pricing info.

---

## Example 2: Already Purchased (Different Email)

**Question:**
```
I bought it but under a different email!
```

**Answer:**
```
Hey there,

Great to hear! Thanks for letting us know - we can help link accounts if needed.

What email did you purchase under? I can make sure everything is properly connected.

Best,
```

**Why it's an edge case:** Not actually pricing feedback - they've already bought. Transition to account help.

---

## Example 3: Comparing to Other Programs

**Question:**
```
I'm part of many of these kinds of deals - Lets Get Rusty, Papa React. Both have content updates and split over 3 payments. I would have preferred payment split over 3 payments. This is my 2 cents!
```

**Answer:**
```
Hey there,

Thanks for the thoughtful feedback and the comparison to other programs! Really appreciate you sharing what payment structures work for you.

I'll pass this feedback about payment plans and content updates to the team - it's valuable insight for how we might structure things.

Best,
```

**Why it's an edge case:** Specific feature request (payment plans) rather than general affordability. Log as product feedback.

---

## Example 4: Seeking Employer Sponsorship

**Question:**
```
I'm currently in process of seeing if my employer will pay for it. At the moment I'm an apprentice on a lowish salary so the price tag for training is quite high.
```

**Answer:**
```
Hey there,

Thanks for sharing! Getting employer sponsorship is a great approach - many companies have learning budgets specifically for this.

Good luck with the request! If your employer needs an invoice or has questions about team licensing, let us know.

Best,
```

**Why it's an edge case:** They're actively seeking solutions. Support their effort rather than just offering alternatives.

---

## Example 5: Exchange Rate Fluctuations

**Question:**
```
Still with the regional pricing, it's a good amount of money in my country because of the exchange rate fluctuations. I'll try to make it before the deal ends.
```

**Answer:**
```
Hey there,

Thanks for sharing that feedback! We understand that even with regional pricing, exchange rate fluctuations can make courses challenging to afford.

Good luck with making the decision! If you have any questions in the meantime, feel free to reach out.

Best,
```

**Why it's an edge case:** Acknowledges PPP but notes it's still difficult. Validate their experience without promising additional discounts.

---

## Example 6: Time AND Money Constraints

**Question:**
```
It's the time of year; I can't afford your course after spending so much for Christmas. Also, time... I wish I had more time to dedicate to your course.
```

**Answer:**
```
Hey there,

Thanks for sharing! Totally understand - the holidays can be tough on both budget and time.

The courses are self-paced and your access doesn't expire, so whenever you're ready works. And we do run sales throughout the year.

Hope you have a great holiday season!

Best,
```

**Why it's an edge case:** Multiple concerns (money + time). Address both, note that courses are self-paced.

---

## Example 7: Already Knowledgeable (Value Question)

**Question:**
```
Your courses are great and the free tutorials were well designed. I've done a ton of research and tutorials. I think paying when I just can read the docs and have really good understanding... the more you know is kind of a handicap.
```

**Answer:**
```
Hey there,

Thanks for the thoughtful feedback! You make a fair point - if you're already comfortable with the fundamentals and have good resources, the value proposition shifts.

The courses are really designed for those who want structured, deep-dive learning or need to level up quickly. Sounds like you have a solid foundation already.

Best of luck with your learning journey!

Best,
```

**Why it's an edge case:** Not about affordability - about value proposition. Acknowledge their point honestly.

---

## Example 8: Student in Low-Income Country (Double Barrier)

**Question:**
```
I cannot afford the core volume as I'm still a student in 3rd year engineering even after PPP as I'm from India. Would love to know if you can giveaway the course for students?
```

**Answer:**
```
Hey there,

Thanks for following along and working through the modules! That's great dedication.

I've flagged your request for review - someone from our team will follow up with you about student options.

Best,
```

**Why it's an edge case:** Student + PPP still insufficient = scholarship-financial-aid territory. Route to human review.
