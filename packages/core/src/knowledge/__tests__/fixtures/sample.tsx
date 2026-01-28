// @ts-nocheck - Test fixture only, not runtime code
import React from 'react'

// FAQ data with content that should be extracted
export const faqData = {
  title: 'Frequently Asked Questions',
  content: `# How do I access my course?

After purchasing, you'll receive an email with login instructions.

1. Check your email for the welcome message
2. Click the login link
3. Create your password
4. Start learning!

If you don't see the email, check your spam folder.`,
}

const offlineContent = `
# Can I download videos for offline viewing?

Yes! All courses include downloadable video files.

## How to Download

1. Navigate to any lesson
2. Click the download button below the video
3. Choose your preferred quality
4. Save to your device

Downloads are DRM-free and yours to keep forever.
`

const FAQ: React.FC = () => {
  return (
    <div className="faq-container">
      <h1>FAQ</h1>
      <section>
        <h2>Access Questions</h2>
        <div dangerouslySetInnerHTML={{ __html: faqData.content }} />
      </section>
      <section>
        <h2>Downloads</h2>
        <div dangerouslySetInnerHTML={{ __html: offlineContent }} />
      </section>
    </div>
  )
}

export default FAQ

// Additional content in template literal
const supportInfo = `
# Getting Support

Our support team is here to help!

## Contact Methods

- Email: support@example.com
- Twitter: @example
- Discord: Join our community

## Response Times

We typically respond within 24 hours on business days.
`
