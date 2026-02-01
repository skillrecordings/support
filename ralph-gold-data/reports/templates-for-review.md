# Template Review Report

Generated: 2026-01-31T21:38:37.861Z
Total Templates: 55

## Summary by Category

| Category | Count |
|----------|-------|
| support_technical | 14 |
| support_access | 10 |
| support_refund | 10 |
| presales_faq | 7 |
| support_billing | 5 |
| fan_mail | 3 |
| support_transfer | 3 |
| spam | 2 |
| presales_consult | 1 |

---

## Templates by Category

### fan_mail

**Pattern:** personal correspondence to an individual

> Thank you for reaching out. This appears to be personal correspondence intended for Matt directly. Since there's no instructor routing configured, I'll need to forward this manually to ensure Matt sees it. Please let me know if you have any other requests I can assist with.

- Variables: None
- Confidence: 100%
- Source: "Re: A quick question..."

---

**Pattern:** personal correspondence to employee

> I'm afraid I can't route this directly to Matt, as this appears to be personal correspondence that should go to him directly rather than support. Please forward this conversation to Matt, as Tasos is sharing thoughtful feedback about AI adoption and how it connects to developer productivity on his team. This is the kind of thing he would read personally.

- Variables: None
- Confidence: 100%
- Source: "Re: A quick question..."

---

**Pattern:** request for refund on TypeScript course

> Hello, we've initiated a refund for your purchase of the {{course_name}}. It can take 5-10 days for the banks to reconcile and return the money to your account.

- Variables: `{{course_name}}`
- Confidence: 90%
- Source: "Re: 👋 Feedback from [EMAIL] about Total TypeScript"

---

### presales_consult

**Pattern:** Request for a workshop on AI usage with Claude Code

> Thank you for your interest in a workshop on AI usage with Claude Code. I would be happy to discuss the possibility of offering a workshop for your engineers. Please let me know if you have any additional details you can provide, such as the specific topics you would like covered or the preferred duration of the workshop. I look forward to speaking with you further about how I can assist your team.

- Variables: `{{name}}`, `{{company}}`
- Confidence: 80%
- Source: "Re: 1 or 1/2 day workshop for my company"

---

### presales_faq

**Pattern:** Customer missed a discount and wants to still purchase the product

> Hi {{name}},
> 
> I've extended the coupon for you! This is valid for another week: {{coupon_link}}
> 
> Let me know if you have any other questions!

- Variables: `{{name}}`, `{{coupon_link}}`
- Confidence: 90%
- Source: "RE: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** personal correspondence between customer and AI hero team member

> Looks like this message is personal correspondence between you and a member of the AI Hero team. I'm unable to draft a response as this isn't a support request. The AI Hero team will need to review this directly.

- Variables: None
- Confidence: 90%
- Source: "Re: A quick question..."

---

**Pattern:** Asking about recording availability for a live workshop

> Hey {{name}},
> Good question on the recording. That's something {{instructor}} would need to confirm directly, since workshop setup details can vary. I'd suggest replying to this email chain to ask {{him|her}} directly, or reaching out through the workshop signup page if there's a contact option there.

- Variables: `{{name}}`, `{{instructor}}`
- Confidence: 90%
- Source: "Re: Live Autonomous AI Agents with Ralph Workshop (very limited seats)"

---

**Pattern:** request for student discount on Total TypeScript courses

> Hey,
> 
> Here's a discount coupon for you: https://www.totaltypescript.com/buy/?code={{code}}
> 
> Best,

- Variables: `{{code}}`
- Confidence: 90%
- Source: "Re: Question about Student Discount"

---

**Pattern:** Customer interested in AI applications for product development and software development lifecycle

> Thank you for your message about your interest in AI applications. I'd be happy to provide some insights on how AI can enhance product development, software development lifecycle, and more. Could you please share a few more details on your specific use cases or areas of focus so I can provide tailored recommendations? I look forward to discussing this further and helping you leverage AI to improve your products and workflows.

- Variables: `{{customer_name}}`
- Confidence: 90%
- Source: "Re: A quick question..."

---

**Pattern:** Customer request for workshop materials ahead of event

> The workshop materials and code examples will be sent in a separate email within the next day or so. If you don't receive it by the end of the week, please let me know and I'll make sure you get it right away.

- Variables: None
- Confidence: 80%
- Source: "Re: You're in! Get Ready for Autonomous AI Agents Live Workshop Ticket! 🎉"

---

**Pattern:** Product is sold out or Buy button not working

> It does not appear the product is sold out. Can you please try the following:
> 
> - Open the link in an incognito/private browser window to rule out any browser extension issues
> - Let me know what browser you are using and if you see any error messages when clicking the Buy button

- Variables: `{{browser}}`
- Confidence: 80%
- Source: "Re: Live Autonomous AI Agents with Ralph Workshop (very limited seats)"

---

### spam

**Pattern:** casual message without support request

> This appears to be a casual message without an actual support request. If you have any questions or issues related to our product, please reach out and we'll be happy to assist.

- Variables: None
- Confidence: 90%
- Source: "Re: This is Crazy"

---

**Pattern:** spam email with unsubscribe link

> I'm not able to assist with this type of message. This appears to be a personal outreach from the instructor, Matt, to learn more about your interests in AI. I'll make sure he sees your response.

- Variables: None
- Confidence: 90%
- Source: "Re: A quick question..."

---

### support_access

**Pattern:** Customer has purchased a course but is having trouble accessing it

> Hi {{customer_name}},
> 
> Thanks for reaching out. I'd be happy to help you access the Total TypeScript course you purchased.
> 
> Can you please confirm the email address you used to make the purchase? I can then look up your order details and provide instructions for accessing the course materials.
> 
> Let me know if you have any other questions!

- Variables: `{{customer_name}}`
- Confidence: 90%
- Source: "Re: 👋 Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** missing Zoom link for scheduled event

> No need to worry. The confirmation email you received mentioned the Zoom link would come in a separate email. If you got the calendar invite but it's missing the Zoom link, check your inbox for another email from {{sender}} with the Zoom details. It might have landed in spam or gotten filtered. If you still can't find it, let me know and I'll track down what happened.

- Variables: `{{sender}}`
- Confidence: 90%
- Source: "Re: You're in! Get Ready for Autonomous AI Agents Live Workshop Ticket! 🎉"

---

**Pattern:** request for refund for recent purchase

> I'm running into a technical issue pulling up your account. Can you please provide the {{purchase_date}}, {{purchase_id}}, and {{purchase_amount}} or {{product_name}} so I can process the refund for you?

- Variables: `{{purchase_date}}`, `{{purchase_id}}`, `{{purchase_amount}}`, `{{product_name}}`
- Confidence: 90%
- Source: "Re: 😭 Feedback from Dewin Pena about Total TypeScript"

---

**Pattern:** Customer purchased course but can't access it under new email

> The purchase is still attached to {{email_1}}. It wasn't transferred to {{email_2}}, which is why you're seeing the purchase prompt there. Can you confirm which email you want the course on? Once you confirm, I can transfer it over.

- Variables: `{{email_1}}`, `{{email_2}}`
- Confidence: 90%
- Source: "Re: Welcome to AI SDK v5 Crash Course!"

---

**Pattern:** customer requests account deletion

> Thank you for your request to delete the account associated with {{email}}. We are processing your request and will confirm the account deletion once complete. Please let us know if you have any other questions.

- Variables: `{{email}}`
- Confidence: 90%
- Source: "Re: Account Deletion Request"

---

**Pattern:** customer lost access to purchased course

> Hi there, it looks like you may have purchased the course under a different email address. Could you please check your other email accounts or let me know the email you used when you originally purchased the course? I'd be happy to help you regain access without having to pay again.

- Variables: `{{email}}`
- Confidence: 80%
- Source: "Re: 👋  Feedback from Brianna Iliev about Total TypeScript"

---

**Pattern:** customer purchased product but lost access

> I can see your account but there's no purchase showing up under {{email}}. This usually means you purchased with a different email address. Check your email from {{date}} for the purchase receipt - it'll show which email was used. If you find it, let me know what that email is and I can help transfer the purchase to your current account. If you can't find the receipt, what payment method did you use? I can try searching by that.

- Variables: `{{email}}`, `{{date}}`
- Confidence: 80%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** request to delete account and data

> Thank you for your request to delete your account and data. To complete this request, please reply with your full name and email address associated with the account. We will process your request as soon as possible. If you have any other questions, please let us know.

- Variables: `{{name}}`, `{{email}}`
- Confidence: 80%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** Customer wants to access their account with a different email address

> Hi {{name}},
> 
> Thank you for reaching out. I've updated the email address associated with your account to {{new_email}}.
> 
> You should now be able to log in using the new email address. Please let me know if you have any other issues accessing your account.
> 
> Best regards,
> {{agent_name}}

- Variables: None
- Confidence: 80%
- Source: "Re: Help access my account"

---

**Pattern:** request for 1-on-1 training or support

> Thanks for reaching out about {{training}}. I'm primarily available for community support through our Discord channel. If you have any specific questions about the course or platform, please feel free to ask there. Otherwise, you can try reaching out to {{instructor}} directly on their social channels. Let me know if there's anything else I can assist with!

- Variables: `{{training}}`, `{{instructor}}`
- Confidence: 80%
- Source: "Re: Do you offer 1:1 training?"

---

### support_billing

**Pattern:** customer requests VAT number for invoice

> We're a US-based company, so we don't have a VAT number. However, we can provide our EIN or issue a standard receipt/invoice for you to use. Please let me know if you need anything else!

- Variables: `{{vat_number}}`, `{{ein}}`
- Confidence: 90%
- Source: "Re: 👋  Feedback from annacv about Total TypeScript"

---

**Pattern:** request for applying a discount to a past purchase

> Hey {{name}},
> 
> No problem! This coupon gives you 50% off: {{discount_code}}
> 
> Let me know if you need anything else.

- Variables: `{{name}}`, `{{discount_code}}`
- Confidence: 90%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** Inquiring about price increase and promo codes for Total TypeScript Pro course

> Thank you for your inquiry about the Total TypeScript Pro course pricing. We recently had to increase the price from $397.50 to $750, but we do offer various coupon codes and discounts that may be applicable. Please check the [Total TypeScript FAQ](https://www.totaltypescript.com/faq) or reach out to our support team at [EMAIL] for more information on current promotions. We're happy to help you get the best deal possible for the course.

- Variables: `{{original_price}}`, `{{new_price}}`
- Confidence: 80%
- Source: "Re: Was there a price increase recently?"

---

**Pattern:** discount for Total TypeScript course

> Thank you for your inquiry. I'd be happy to provide a discount code for the AI SDK v5 Crash Course for past Total TypeScript customers. Please let me know if you have any other questions.

- Variables: None
- Confidence: 70%
- Source: "Re: 👋  Feedback from Sylvester Hofstra about Total TypeScript"

---

**Pattern:** [lower price for the course]

> I'd be happy to explore alternative pricing options that better suit your current financial situation.

- Variables: None
- Confidence: 70%
- Source: "Re: Following up: Course inquiry / Regional pricing"

---

### support_refund

**Pattern:** request for refund on unused order

> Hello,
> 
> We've initiated a refund for order {{order_id}} placed on {{order_date}}. It can take 5-10 days for the banks to reconcile and return the money to your account {{email}}.

- Variables: `{{order_id}}`, `{{order_date}}`, `{{email}}`
- Confidence: 90%
- Source: "Re: Cancel order"

---

**Pattern:** request for a refund or discount to match a previous promotion

> Thank you for reaching out about your order. While we are unable to provide a refund for the full price, we would be happy to offer you a coupon code that will reduce the price to the previously discounted amount of {{amount}}. Please let me know if this would be helpful, and I'll be glad to get that set up for you.

- Variables: `{{amount}}`
- Confidence: 90%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** request for refund due to training mismatch

> We've initiated a refund for your purchase. It can take 5-10 days for the banks to process the refund and return the money to your account. Please let us know if you have any other questions.

- Variables: `{{order_id}}`
- Confidence: 90%
- Source: "Re: 😭  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** customer requests refund due to company approval

> We've initiated a refund for your purchase of {{product_name}}. The refund can take 5-10 days for the banks to process and return the money to your account at {{customer_email}}.

- Variables: `{{product_name}}`, `{{customer_email}}`
- Confidence: 90%
- Source: "Re: Refund"

---

**Pattern:** customer requesting refund for duplicate license

> Hi {{name}},
> 
> Thanks for reaching out. I've processed a refund for the duplicate license you purchased on December 19. You should see the refund in your account within the next 3-5 business days.
> 
> Please let me know if you have any other questions!
> 
> Best,
> {{agent}}

- Variables: `{{undefined}}`, `{{undefined}}`
- Confidence: 90%
- Source: "Re: Regain access"

---

**Pattern:** request for a refund for an online course purchase

> Sorry about that! I've gone ahead and processed a refund for your {{course_name}} order placed on {{order_date}}. The refund should appear in your account within 3-5 business days. Please let me know if you have any other questions!

- Variables: `{{course_name}}`, `{{order_date}}`
- Confidence: 90%
- Source: "Re: Cancel order"

---

**Pattern:** request for refund within 30 days

> Hey {{name}},
> 
> No worries! I've also gone ahead with this refund. It can take 5-10 days for the banks to process.
> 
> Let me know if you need anything else.
> 
> Best,

- Variables: `{{name}}`
- Confidence: 90%
- Source: "Re: 😭  Feedback from Bruno Paulino about Total TypeScript"

---

**Pattern:** Request for refund due to financial troubles

> Hello {{customer_name}},
> 
> We've initiated a refund for your order {{invoice_id}}. It can take 5-10 days for the banks to reconcile and return the money to your account.
> 
> Please let us know if you have any other questions.

- Variables: `{{customer_name}}`, `{{invoice_id}}`
- Confidence: 90%
- Source: "Re: Refund Request"

---

**Pattern:** request for refund within 30-day money-back guarantee

> Hey {{customer_name}},
> 
> We've initiated a refund for your {{product_name}} purchase. It can take 5-10 days for the banks to reconcile and return the money to your account.
> 
> Please let me know if you have any other questions!

- Variables: `{{customer_name}}`, `{{product_name}}`
- Confidence: 90%
- Source: "Re: 👋  Feedback from manao GmbH & Co. KG about Total TypeScript"

---

**Pattern:** refund course unenroll

> I'm sorry to hear you're no longer interested in the course. I've processed your refund and unenrolled you from the course. Please let me know if there's anything else I can assist with.

- Variables: None
- Confidence: 70%
- Source: "Re: 😭  Feedback from Nishant Kumar Mohapatra about Total TypeScript"

---

### support_technical

**Pattern:** customer request for advice or education materials

> I appreciate you reaching out, {{name}}, but this appears to be a personal conversation rather than a customer service issue. Since there's no purchase problem, access issue, or product question, I'm not able to assist with this. If you do have any questions about Total TypeScript courses or materials, just let me know and I'll be happy to help.

- Variables: `{{name}}`
- Confidence: 90%
- Source: "Re: A quick question..."

---

**Pattern:** Getting started with TypeScript

> Great! If you're just starting out with TypeScript, I'd recommend beginning with the fundamentals:
> 
> - Learn how TypeScript differs from JavaScript, type annotations, interfaces, and basic types. Work through exercises that show you how types prevent bugs.
> - Don't try to learn everything at once. Focus on types first, then move into more advanced concepts like generics, utility types, and advanced patterns once you're comfortable with the foundation.
> 
> Let me know if you have any specific areas you're curious about, or if you'd like help navigating the Total TypeScript resources available.

- Variables: `{{customer_message}}`
- Confidence: 90%
- Source: "Re: Please Help me"

---

**Pattern:** customer needs help with TypeScript

> I'm sorry to hear you're having trouble with TypeScript. What specific part is giving you trouble? I'd be happy to point you in the right direction. TypeScript is a powerful language, and with a bit of practice, I'm confident you'll get the hang of it. Let me know the details and I'll do my best to help!

- Variables: `{{customer_name}}`
- Confidence: 90%
- Source: "Re: Pleas help."

---

**Pattern:** customer request for information about integrating AI into their workflow

> Since this is a direct request from you about integrating AI, I'd recommend replying directly to {{email}} so they can assist you further. I'd be happy to help if you have any other questions, but for this specific request, it's best to continue the conversation directly with the original sender.

- Variables: `{{email}}`
- Confidence: 90%
- Source: "Re: A quick question..."

---

**Pattern:** typescript compilation issue with unexpected export token

> This is a module system issue, not a version problem. Your compiled JavaScript has export statements, but browsers need a module-aware script tag to understand them. In your HTML file, change the script tag from `<script src="example.js"></script>` to `<script type="module" src="example.js"></script>`. The `type="module"` tells the browser to treat the file as an ES module, which supports import/export syntax.

- Variables: None
- Confidence: 90%
- Source: "Re: pro-essentials-workshop - Issue with lesson 011"

---

**Pattern:** question about behavior of Ralph Wiggum technique

> Thanks for your question about the Ralph Wiggum technique! The number of iterations you specify applies to each individual task in your PRD. So if a task fails to implement successfully on the first try, the next iteration will try that task again. The loop will continue until either all tasks have been implemented successfully, or the max number of iterations is reached, regardless of the total number of tasks in your PRD. Let me know if you have any other questions!

- Variables: None
- Confidence: 90%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** Technical customer inquiring about harnessing AI capabilities while ensuring accuracy and repeatability

> Hi {{name}},
> 
> I understand your interest in leveraging AI to streamline your processes while maintaining quality and consistency. Achieving that balance can certainly be challenging, but it's a common goal for many organizations.
> 
> I'd be happy to discuss some potential strategies and best practices that may help you realize those objectives. Please feel free to provide more details on your specific use case and requirements, and I'll do my best to offer some guidance.
> 
> Looking forward to learning more about your AI initiatives.

- Variables: `{{name}}`
- Confidence: 80%
- Source: "Re: A quick question..."

---

**Pattern:** customer asking about light mode for a product

> I don't have definitive information on whether {{product}} supports light mode. I'll escalate this to someone who can provide a more detailed answer. Are you experiencing an issue with the display, or just checking if the feature is available before purchasing?

- Variables: `{{product}}`
- Confidence: 80%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** error playing video

> Thank you for reaching out about the issue you're experiencing with playing videos. We'd be happy to look into this further. Could you please provide a few more details, such as the specific error message you're seeing or any troubleshooting steps you've already tried? Once we have a bit more information, we'll be able to better assist you. Please let me know if you have any other questions!

- Variables: `{{name}}`, `{{phone}}`
- Confidence: 80%
- Source: "Re: Total TypeScript: Email Question"

---

**Pattern:** Customer is a software engineering manager interested in building reliable and trustworthy AI systems to integrate into engineering workflows

> Thank you for your message, {{customer_name}}. As a fellow software engineer, I understand your interest in building reliable and trustworthy AI systems to integrate into your engineering workflows. I would be happy to discuss strategies for using AI tools like Effect to achieve the level of controllability, repeatability, and compounding leverage you're looking for. Please feel free to provide more details on the specific challenges you're facing, and I'll do my best to offer guidance and suggestions based on my experience. I'm looking forward to learning more about your goals and how I can assist you in this endeavor.

- Variables: `{{customer_name}}`
- Confidence: 80%
- Source: "Re: A quick question..."

---

**Pattern:** I can't figure out TypeScript. AI has stolen my job. Now i sack groceries. Help!

> Hey {{name}},
> 
> I hear the frustration—TypeScript can feel overwhelming at first, but you've got this. The good news is you already have access to Total TypeScript, which is designed to take you from confused to confident.
> 
> Here's what I'd suggest:
> - Start with the fundamentals section if you haven't already—it's built to click things into place
> - Don't try to learn everything at once. Pick one concept and really nail it before moving on
> - TypeScript is actually going to *add* to your skillset, not replace it. The demand for TypeScript skills is growing, not shrinking
> 
> What specific part of TypeScript is throwing you off? Types? Generics? Syntax? Let me know and I can point you toward the exact lessons that'll help.
> 
> You've got the course—let's make sure you get real value from it.

- Variables: `{{undefined}}`
- Confidence: 80%
- Source: "Re: I am lost."

---

**Pattern:** Technical support request about agentic coding and AI

> Thanks for sharing your journey with agentic coding. The concept of 'backpressure' as a quality constraint is interesting, and it sounds like you're thinking deeply about how to maintain code standards while working with AI. I'm happy to discuss your questions about Ralph Wiggum and what you want to explore next. Please feel free to provide more details, and I'll do my best to assist you.

- Variables: None
- Confidence: 80%
- Source: "Re: A quick question..."

---

**Pattern:** Customer is struggling with generics in TypeScript

> Generics are one of the more challenging concepts in TypeScript, but they become more intuitive with practice. Could you share more about where you're getting stuck? Is it the basic syntax, understanding constraints, using generics with functions vs. types, or something else? I'd be happy to point you in the right direction once I know more about the specific issue you're facing.

- Variables: `{{customer_name}}`
- Confidence: 80%
- Source: "Re: TypeScript is so cool"

---

**Pattern:** Request for more details on frontend-backend setup

> Thanks for the feedback {{customer_name}}. You make a good point that the frontend/backend setup could be documented more clearly upfront. We'll look into enhancing the course materials to provide a more explicit walkthrough of how the frontend communicates with the backend via the `useChat` endpoint. Please let me know if there's anything else I can assist with.

- Variables: `{{customer_name}}`
- Confidence: 80%
- Source: "Re: Welcome to AI Hero!"

---

### support_transfer

**Pattern:** inquiry about upgrading a purchase to a larger course bundle

> Yes! If you purchase the *TypeScript Pro Essentials* bundle now, you'll be able to upgrade to the *TypeScript Pro Complete* bundle later by paying only the difference in price. We prorate what you paid into the upgrade. Let me know if you have any other questions.

- Variables: `{{bundle_essentials}}`, `{{bundle_complete}}`
- Confidence: 90%
- Source: "Re: Question About Upgrading from TypeScript Pro Essentials to Pro Complete"

---

**Pattern:** request to transfer a license from a deactivated company email

> Hi there, I'd be happy to help with that. Since the original account was tied to a company email that has been deactivated, the best way to transfer the license is to provide us with {{customer_name}}'s personal email address. Once we have that, we can update the license details accordingly. Please let me know the new email address whenever you're ready.

- Variables: `{{customer_name}}`
- Confidence: 90%
- Source: "Re: 👋  Feedback from [EMAIL] about Total TypeScript"

---

**Pattern:** transfer course to [email]

> Thank you for following up on the course license transfer. I have processed the transfer to [EMAIL]. Please let me know if you need anything else.

- Variables: None
- Confidence: 70%
- Source: "Re: Transfer Course"

---

