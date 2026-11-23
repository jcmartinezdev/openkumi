// The people with bots on one computer go by a name there that is also a folder's: small
// letters, digits and dashes (apps/server/src/people.ts). This is how the apps show and take one.

/** A person's name as it is shown: "juan-cruz" is Juan Cruz. */
export const shownName = (name: string) => name.split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')

/** What was typed, made to fit a name as it is typed: "José Luis" becomes jose-luis. */
export const typedName = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 30)
