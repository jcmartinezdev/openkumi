// What settings pages are made of, in the way of the phone's own Settings: sections of rows on
// rounded cards, a row being a page to open, a switch, a choice with a check, a field or a fact.
// Each change is saved as it is made, as on the computer; nothing waits for a Save button.
import { Children, Fragment, type ReactNode, isValidElement, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Glyph, type GlyphName } from './icons'
import { ScreenTitle } from './ScreenTitle'
import { useTheme } from './theme'
import type { Bot } from '@openkumi/shared'
import { BotHead } from './Mascot'

/** A pushed settings page: its title in the bar, and its sections in a scroll view. */
export function SettingsPage({ title, subtitle, buttons, refresh, children }: { title: string; subtitle?: string; buttons?: number; refresh?: { busy: boolean; run: () => void }; children: ReactNode }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <>
      <ScreenTitle title={title} subtitle={subtitle} buttons={buttons} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.group }}
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={refresh && <RefreshControl refreshing={refresh.busy} onRefresh={refresh.run} tintColor={theme.muted} />}
      >
        {children}
      </ScrollView>
    </>
  )
}

/**
 * A card of rows, with a heading above it and a note below. The lines between rows start where
 * the rows' text does: `inset` is how far in that is (more when the rows have icons). A `bare`
 * section has no card, for what draws its own.
 */
export function Section({ title, footer, inset = 16, bare, children }: { title?: string; footer?: ReactNode; inset?: number; bare?: boolean; children: ReactNode }) {
  const theme = useTheme()
  // Fragments are looked into, so a page can hand over rows it builds in a list or behind a condition.
  const flat = (nodes: ReactNode): ReactNode[] => Children.toArray(nodes).flatMap((node) => (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment ? flat(node.props.children) : [node]))
  const rows = flat(children)
  return (
    <View style={styles.section}>
      {!!title && <Text accessibilityRole="header" style={[styles.heading, { color: theme.muted }]}>{title}</Text>}
      {bare ? children : rows.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.groupCard }]}>
          {rows.map((row, i) => (
            <Fragment key={i}>
              {i > 0 && <View style={[styles.line, { marginLeft: inset, backgroundColor: theme.border }]} />}
              {row}
            </Fragment>
          ))}
        </View>
      )}
      {typeof footer === 'string' ? <Text style={[styles.footer, { color: theme.faint }]}>{footer}</Text> : footer}
    </View>
  )
}

/** The inset of a section whose rows start with an icon. */
export const ICON_INSET = 52

export interface RowProps {
  /** A line icon at the start of the row. */
  icon?: GlyphName
  /** Anything else at the start of the row, such as a bot's avatar or a provider's mark. */
  leading?: ReactNode
  label: string
  /** Under the label, in fainter type. */
  detail?: ReactNode
  /** At the end of the row, in fainter type, such as what is chosen on the page it opens. */
  value?: string
  onPress?: () => void
  /** Opens a page, so it ends with a chevron. Rows that act at once (Run now, Unpair) do not. */
  opens?: boolean
  /** Picked among the rows of its section, so it ends with a check. */
  checked?: boolean
  tone?: 'normal' | 'action' | 'destructive'
  disabled?: boolean
  accessibilityHint?: string
  /** A control at the end of the row: beside its button, not in it, so each can be pressed on its own. */
  children?: ReactNode
}

export function Row({ icon, leading, label, detail, value, onPress, opens, checked, tone = 'normal', disabled, accessibilityHint, children }: RowProps) {
  const theme = useTheme()
  const color = tone === 'destructive' ? theme.err : theme.text
  const body = (
    <>
      {icon && <View style={styles.icon}><Glyph name={icon} size={20} color={tone === 'destructive' ? theme.err : theme.text} weight={1.7} /></View>}
      {leading}
      <View style={styles.text}>
        <Text style={[styles.label, { color, fontWeight: tone === 'action' ? '500' : '400' }]} numberOfLines={2}>{label}</Text>
        {typeof detail === 'string' ? <Text style={[styles.detail, { color: theme.faint }]}>{detail}</Text> : detail}
      </View>
      {!!value && <Text style={[styles.value, { color: theme.faint }]} numberOfLines={1}>{value}</Text>}
      {checked && <Glyph name="check" size={18} color={theme.text} weight={2.2} />}
      {opens && <Glyph name="chevron" size={15} color={theme.faint} weight={2.2} />}
    </>
  )
  return (
    <View style={[styles.row, disabled && { opacity: 0.4 }]}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !!disabled, ...(checked === undefined ? {} : { selected: checked }) }}
          accessibilityHint={accessibilityHint}
          disabled={disabled}
          style={({ pressed }) => [styles.main, pressed && { backgroundColor: theme.bubble }]}
          onPress={onPress}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.main} accessible={!children}>{body}</View>
      )}
      {children && <View style={styles.control}>{children}</View>}
    </View>
  )
}

/** A row with a switch, for a setting that is on or off. */
export function SwitchRow({ value, onChange, disabled, ...row }: Omit<RowProps, 'children' | 'onPress' | 'value'> & { value: boolean; onChange: (on: boolean) => void }) {
  const theme = useTheme()
  return (
    <Row {...row} disabled={disabled}>
      <Switch accessibilityLabel={row.label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: theme.ok }} />
    </Row>
  )
}

/**
 * A field, saved when it is left or Return is pressed; or, in a form with a Save button, handed
 * over as it is typed (`onChange`). One line has its label beside it, as the phone's own forms do;
 * several lines are a box of their own, with the label as the placeholder.
 */
export function Field({ label, value, placeholder, onCommit, onChange, multiline, required, maxLength, autoCapitalize, keyboardType }: {
  label: string
  value: string
  placeholder?: string
  onCommit?: (value: string) => void
  onChange?: (value: string) => void
  multiline?: boolean
  /** What is left empty is not saved: the field goes back to what it was. */
  required?: boolean
  maxLength?: number
  autoCapitalize?: 'none' | 'sentences' | 'words'
  keyboardType?: 'default' | 'number-pad' | 'url'
}) {
  const theme = useTheme()
  const [typed, setTyped] = useState(value)
  // What was saved elsewhere, or by this field, is what it shows from then on.
  useEffect(() => setTyped(value), [value])
  const text = onChange ? value : typed
  const setText = onChange ?? setTyped
  const commit = () => {
    if (!onCommit) return
    const next = text.trim()
    if (next === value) return setText(value)
    if (required && !next) return setText(value)
    onCommit(next)
  }
  if (multiline) {
    return (
      <TextInput
        accessibilityLabel={label}
        style={[styles.area, { color: theme.text }]}
        value={text}
        onChangeText={setText}
        onEndEditing={commit}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        multiline
        textAlignVertical="top"
        scrollEnabled={false}
      />
    )
  }
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.field, { color: theme.text }]}
        value={text}
        onChangeText={setText}
        onEndEditing={commit}
        onSubmitEditing={commit}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        returnKeyType="done"
        textAlign="right"
        clearButtonMode="while-editing"
      />
    </View>
  )
}

/** A few choices side by side, the picked one raised, like the phone's own segmented controls. */
export function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  const theme = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: theme.bubble }]}>
      {options.map(([option, text]) => (
        <Pressable
          key={option}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option }}
          style={[styles.segment, value === option && [styles.segmentOn, { backgroundColor: theme.segment }]]}
          onPress={() => value !== option && onChange(option)}
        >
          <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: value === option ? '600' : '400' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{text}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/** Where a row's icon goes, for a mark that is not one of the line icons, so the two line up. */
export const Slot = ({ children }: { children: ReactNode }) => <View style={styles.icon}>{children}</View>

/** A bot's head, at the start of its row. The row says whose it is, so it is not read out. */
export function Avatar({ bot, size = 32 }: { bot: Pick<Bot, 'look' | 'emoji'> | undefined; size?: number }) {
  return <BotHead bot={bot} size={size} />
}

/** A short note in a section's place, such as what a page is about. */
export function Note({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  const theme = useTheme()
  return <Text accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.note, { color: tone === 'error' ? theme.err : theme.muted }]}>{children}</Text>
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 12, gap: 26 },
  section: { gap: 7 },
  heading: { fontSize: 13, fontWeight: '500', paddingHorizontal: 16 },
  card: { borderRadius: 16, overflow: 'hidden' },
  line: { height: StyleSheet.hairlineWidth },
  footer: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 11 },
  icon: { width: 24, alignItems: 'center' },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 16.5, lineHeight: 21 },
  detail: { fontSize: 13.5, lineHeight: 18 },
  value: { flexShrink: 1, maxWidth: '50%', fontSize: 16, textAlign: 'right' },
  control: { paddingRight: 16 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingLeft: 16, paddingRight: 12 },
  field: { flex: 1, height: 48, fontSize: 16.5 },
  area: { minHeight: 110, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 13, fontSize: 16, lineHeight: 22 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: 10 },
  segment: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 8 },
  segmentOn: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  note: { fontSize: 14, lineHeight: 20, paddingHorizontal: 16 },
})
