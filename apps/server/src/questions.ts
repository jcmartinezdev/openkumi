// What a bot asks its owner with ask_user: a few questions, each with the answers it offers. They
// are read here from what the model gave, strictly, so that the model is told what was wrong and
// the apps are only ever given questions they can show.
import type { Question } from '@openkumi/shared'

/** How much a bot may ask at once, and how long each part may be. */
export const QUESTION_LIMITS = { questions: 4, options: 6, question: 300, header: 24, label: 80, description: 200 }

const line = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/**
 * The questions in what a model gave ask_user, tidied. Throws, in words the model can act on, when
 * they cannot be shown as given: none or too many, one with no text, too many options, the same
 * option twice.
 */
export function readQuestions(given: unknown): Question[] {
  const max = QUESTION_LIMITS
  if (!Array.isArray(given) || !given.length) throw new Error('Give questions: a list of one to four, each with its question and the options to choose from.')
  if (given.length > max.questions) throw new Error(`At most ${max.questions} questions can be asked at once. Ask what you need most first.`)
  return given.map((one, at) => {
    const which = given.length > 1 ? `Question ${at + 1}` : 'The question'
    const question = line(one?.question)
    if (!question) throw new Error(`${which} has no text: give question.`)
    if (question.length > max.question) throw new Error(`${which} is too long: keep it under ${max.question} characters, and say the rest in your reply.`)
    const listed: unknown[] = Array.isArray(one?.options) ? one.options : []
    // A model may give an option as its label alone.
    const options = listed
      .map((option: any) => ({ label: line(typeof option === 'string' ? option : option?.label), description: line(option?.description).slice(0, max.description) }))
      .filter((option) => option.label)
    if (options.length > max.options) throw new Error(`${which} offers more than ${max.options} options. Give the likeliest; the user can always write another answer.`)
    const long = options.find((option) => option.label.length > max.label)
    if (long) throw new Error(`${which} has an option that is too long: keep each label under ${max.label} characters, and put the rest in its description.`)
    if (new Set(options.map((option) => option.label.toLowerCase())).size < options.length) throw new Error(`${which} offers the same option twice.`)
    return { header: line(one?.header).slice(0, max.header), question, options, multiple: one?.multiple === true && options.length > 0 }
  })
}
