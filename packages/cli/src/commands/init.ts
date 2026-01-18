import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

/**
 * Prompt user for app name interactively
 */
async function promptForName(): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question('App name: ', (answer) => {
			rl.close()
			resolve(answer.trim() || 'my-app')
		})
	})
}

/**
 * Initialize command for registering new app with webhook secret
 * @param name - Optional name for the app
 */
export async function init(name?: string): Promise<void> {
	const appName = name || (await promptForName())
	const webhookSecret = randomBytes(32).toString('hex')

	// TODO: Save to DB when database connection is configured
	// For now, output the values for manual configuration

	console.log(`\n✓ App "${appName}" initialized\n`)
	console.log(`Webhook URL: https://your-domain.com/api/webhooks/front`)
	console.log(`Webhook Secret: ${webhookSecret}`)
	console.log(`\nAdd to your .env:`)
	console.log(`FRONT_WEBHOOK_SECRET=${webhookSecret}`)
}
