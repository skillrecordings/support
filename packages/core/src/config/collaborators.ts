export const collaboratorEmails = ['alex@indyhall.org']

export function isCollaboratorEmail(email: string): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return collaboratorEmails.some(
    (collaborator) => collaborator.toLowerCase() === normalized
  )
}
