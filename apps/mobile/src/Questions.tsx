import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Bot, Thread } from '@openkumi/shared'
import { clearFlag } from '@openkumi/client/attention'
import { openQuestions, replied, sendAnswers, useAnswering } from '@openkumi/client/questions'
import { Glyph } from './icons'
import { useTextScale } from './prefs'
import { type Theme, useTheme } from './theme'

/**
 * What the bot asked with ask_user, over the composer for as long as it waits for the answer: one
 * question in front at a time, its options to tap, and room to write another answer. The answers
 * go to the bot as a message; the composer under it stays, to answer in writing instead. With the
 * keyboard up it keeps low, so that the question and what is typed both stay in view.
 */
export function Questions({ bot, thread, connected, keyboard, onError }: { bot: Bot; thread: Thread; connected: boolean; keyboard: boolean; onError: (message: string) => void }) {
  const theme = useTheme()
  const scale = useTextScale()
  const questions = openQuestions(thread)
  const answering = useAnswering(questions, thread.flag?.at ?? 0)
  // Sent, the card waits for the server to clear the mark, which takes it away: it is not sent twice meanwhile.
  const [sending, setSending] = useState(false)
  useEffect(() => setSending(false), [thread.flag?.at])
  // Going on to the next question by itself, a moment after one answer was chosen, so that the choice is seen.
  const onward = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(onward.current), [])
  if (!answering) return null
  const { at, question, reply, last } = answering
  const several = questions.length > 1
  const sendable = answering.ready && !sending && connected

  const send = () => {
    if (!sendable) return
    setSending(true)
    onError('')
    sendAnswers(thread, questions, answering.replies)
      // It never left: what was answered is still here, to send again.
      .catch((e) => (onError((e as Error).message), setSending(false)))
  }
  const pick = (label: string) => {
    clearTimeout(onward.current)
    answering.pick(label)
    if (!question.multiple && !last && !reply.chosen.includes(label)) onward.current = setTimeout(() => answering.go(at + 1), 220)
  }
  const go = (to: number) => (clearTimeout(onward.current), answering.go(to))

  return (
    <View accessibilityLabel={`${bot.name} asks`} style={[styles.card, { backgroundColor: theme.runTint, borderColor: theme.border }]}>
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { flex: 1, color: theme.runText }]} numberOfLines={1}>{bot.name} needs you{question.header ? ` · ${question.header}` : ''}</Text>
        {several && <Text accessibilityLabel={`Question ${at + 1} of ${questions.length}`} style={{ color: theme.muted, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>{at + 1} of {questions.length}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Clear this without answering" hitSlop={10} style={styles.clear} onPress={() => clearFlag(thread.id).catch((e) => onError((e as Error).message))}>
          <Glyph name="x" size={15} color={theme.muted} weight={2} />
        </Pressable>
      </View>
      <Text style={{ color: theme.text, fontSize: 16 * scale, lineHeight: 22 * scale, fontWeight: '600' }}>{question.question}</Text>
      {question.multiple && <Text style={{ color: theme.muted, fontSize: 13 }}>Choose any that fit.</Text>}
      {question.options.length > 0 && (
        <ScrollView style={{ maxHeight: keyboard ? 112 : 252, flexGrow: 0 }} contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled" accessibilityRole={question.multiple ? undefined : 'radiogroup'}>
          {question.options.map((option) => (
            <Option key={option.label} label={option.label} about={option.description} on={reply.chosen.includes(option.label)} box={question.multiple} theme={theme} scale={scale} onPress={() => pick(option.label)} />
          ))}
        </ScrollView>
      )}
      <TextInput
        // A field of its own for each question, so that one's words are never left in the next.
        key={at}
        accessibilityLabel="An answer of your own"
        style={[styles.own, { color: theme.text, backgroundColor: theme.raised, borderColor: theme.border }]}
        value={reply.written}
        // Writing instead, right after choosing, stays on this question.
        onFocus={() => clearTimeout(onward.current)}
        onChangeText={answering.write}
        placeholder={!question.options.length ? 'Your answer' : question.multiple ? 'Something else, too…' : 'Something else…'}
        placeholderTextColor={theme.faint}
        returnKeyType={last ? 'send' : 'next'}
        submitBehavior="submit"
        onSubmitEditing={() => (last ? send() : go(at + 1))}
      />
      <View style={styles.foot}>
        <View style={{ flex: 1 }} />
        {at > 0 && (
          <Pressable accessibilityRole="button" hitSlop={4} style={[styles.button, { borderColor: theme.border }]} onPress={() => go(at - 1)}>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>Back</Text>
          </Pressable>
        )}
        {!last && (
          <Pressable accessibilityRole="button" hitSlop={4} style={[styles.button, replied(reply) ? { backgroundColor: theme.primary, borderColor: 'transparent' } : { borderColor: theme.border }]} onPress={() => go(at + 1)}>
            <Text style={{ color: replied(reply) ? theme.onPrimary : theme.text, fontSize: 14, fontWeight: '600' }}>{replied(reply) ? 'Next' : 'Skip'}</Text>
          </Pressable>
        )}
        {last && (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !sendable }} disabled={!sendable} hitSlop={4} style={[styles.button, { backgroundColor: theme.primary, borderColor: 'transparent', opacity: sendable ? 1 : 0.35 }]} onPress={send}>
            <Text style={{ color: theme.onPrimary, fontSize: 14, fontWeight: '600' }}>{several ? 'Send answers' : 'Send answer'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

function Option({ label, about, on, box, theme, scale, onPress }: { label: string; about: string; on: boolean; box: boolean; theme: Theme; scale: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole={box ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: on }}
      accessibilityLabel={about ? `${label}, ${about}` : label}
      style={({ pressed }) => [styles.option, { backgroundColor: theme.raised, borderColor: on ? theme.runText : theme.border }, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <View style={[styles.mark, { borderRadius: box ? 6 : 11 }, on ? { backgroundColor: theme.primary, borderColor: 'transparent' } : { borderColor: theme.faint }]}>
        {on && <Glyph name="check" size={13} color={theme.onPrimary} weight={2.6} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15.5 * scale, lineHeight: 21 * scale, fontWeight: on ? '600' : '400' }}>{label}</Text>
        {!!about && <Text style={{ color: theme.muted, fontSize: 13.5 * scale, lineHeight: 18 * scale }}>{about}</Text>}
      </View>
    </Pressable>
  )
}

/**
 * Where the bot asked, in the conversation: the questions in its words, to read back once the card
 * over the composer is gone. What was answered is the message that follows.
 */
export function Asked({ questions, theme, scale }: { questions: string[]; theme: Theme; scale: number }) {
  return (
    <View style={[styles.asked, { borderColor: theme.border }]}>
      <Text style={[styles.eyebrow, { color: theme.faint }]}>Asked you</Text>
      {questions.map((question, i) => <Text key={i} style={{ color: theme.text, fontSize: 15 * scale, lineHeight: 21 * scale }}>{question}</Text>)}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 8, marginBottom: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  clear: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  options: { gap: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 44, paddingVertical: 8, paddingLeft: 11, paddingRight: 12, borderWidth: 1, borderRadius: 14 },
  mark: { width: 22, height: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  own: { height: 44, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, fontSize: 16 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { height: 36, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  asked: { alignSelf: 'flex-start', maxWidth: '86%', marginVertical: 6, gap: 3, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 },
})
