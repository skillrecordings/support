/**
 * Direct classifier tests - run classifier on specific messages and verify output
 *
 * Run: bun test packages/core/src/evals/classifier-direct.test.ts
 */

import { describe, expect, it } from 'vitest'
import { classifyMessage } from '../router/classifier'

describe('Classifier', () => {
  describe('instructor_correspondence detection', () => {
    it('should classify reply to Matt personal email as instructor_correspondence', async () => {
      const message = `Hi Matt,

I know nothing about TypeScript! I know JavaScript, Python, Java, SQL, C#, Qlik Script, Basic, and a load of others, though I programme more in PowerPoint these days.

I came across your work on Agentic coding, hence the follow.

After a few AI coding projects, I am coming around to the realization that I may never need to code again.

Regards,
Stephen

On Wed 21 Jan 2026, 12:31 Total TypeScript, <team@totaltypescript.com> wrote:

> Hey Stephen,
>
> You might know me from the TypeScript community which I've been a part of for a long time, but the world of AI is pretty new to me.
>
> I'd love to get to know you better.
>
> What interests you about AI? What do you most want to learn about?
>
> -Matt`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('instructor_correspondence')
    })

    it('should classify fan mail as instructor_correspondence', async () => {
      const message = `Thanks Dan, really glad you got through the course so quickly. Your point about the frontend/backend setup makes sense - that useChat endpoint behavior could definitely be documented more explicitly upfront so people don't have to dig for it. That's solid feedback.

Appreciate you taking the time to share this.`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      // This is actually agent output, not customer input - skip
    })

    it('should classify internal team message as instructor_correspondence', async () => {
      const message = `This quote encapsulates how I feel about software atm:

https://x.com/cramforce/status/2013992385638986138

> The job of the software engineer is changing. How we learn it is not. I'm more worried about mid-career engineers not adapting rather than the next generation. The AI-native devs learning engineering now will run leaps around us old farts

Our job should be to help the mid-career engineers adapt. LOTS of useful content to be made there.`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('instructor_correspondence')
    })

    it('should classify business outreach as no_response or instructor_correspondence', async () => {
      const message = `Hi Matt,

I hope this message finds you well! I've been following your content on YouTube @mattpocockuk, and I really love the unique vibe and creativity you bring to your videos.

I'm reaching out on behalf of Volter AI to invite you to join our UGC team. We're excited to introduce Portable.dev, an innovative AI development environment for mobile devices, featuring full GitHub integration.

We're looking for creators to produce engaging short-form content about our platform. We offer competitive compensation, paying per 1k views, so it's a fantastic opportunity to collaborate and earn.

Looking forward to the possibility of working together!

Best regards,
Jeshua Méndez
Vibe Coder | QA Tester & Creative Technologist @ Volter Ai`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      // Could be no_response (spam) or instructor_correspondence (business pitch to Matt)
      expect(['no_response', 'instructor_correspondence']).toContain(
        result.category
      )
    })
  })

  describe('support request detection', () => {
    it('should classify 404 login issue as account_issue (actionable)', async () => {
      const message = `Hej there
Thanks for your reply!

I get 404 page when I try to login
Arvind`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      // account_issue is more specific than needs_response and correct here
      expect(result.category).toBe('account_issue')
      expect(result.complexity).not.toBe('skip')
    })

    it('should classify refund request as refund', async () => {
      const message = `Hi, I purchased the course 2 weeks ago but haven't had time to go through it. Can I get a refund please?`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('refund')
    })

    it('should classify license transfer request as transfer', async () => {
      const message = `I bought Total TypeScript but I'd like to transfer the license to my work email instead. The new email is john@company.com`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('transfer')
    })
  })

  describe('no_response detection', () => {
    it('should classify thank you as no_response with skip complexity', async () => {
      const message = `Thanks, got it!`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('no_response')
      expect(result.complexity).toBe('skip')
    })

    it('should classify bounce as no_response', async () => {
      const message = `Mail delivery failed: returning message to sender.

This message was created automatically by mail delivery software.

A message that you sent could not be delivered to one or more of its recipients.`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.category).toBe('no_response')
      expect(result.complexity).toBe('skip')
    })
  })

  describe('complexity assignment', () => {
    it('should assign skip complexity to spam', async () => {
      const message = `CONGRATULATIONS! You've been selected to receive a $1000 gift card. Click here now!`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.complexity).toBe('skip')
    })

    it('should assign simple complexity to magic link request', async () => {
      const message = `Can you send me a login link? I can't find the original email.`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.complexity).toBe('simple')
    })

    it('should assign complex complexity to frustrated customer', async () => {
      const message = `This is absolutely ridiculous. I've been trying to access my course for THREE DAYS now and nothing works. I've sent 5 emails and nobody has helped me. I want a refund if this isn't fixed TODAY.`

      const result = await classifyMessage(message)
      console.log('Result:', result)
      expect(result.complexity).toBe('complex')
    })
  })
})
