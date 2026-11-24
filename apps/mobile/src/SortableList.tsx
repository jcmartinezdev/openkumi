// A scrolling list of rows of one height, which slide to their places when their order changes.
// While it is `sortable`, a row that is held is picked up and follows the finger; the others make
// room, and the list scrolls when it is carried to the top or bottom edge. Each row is placed by
// its own number rather than by where it comes in the list, so a row put down is already where
// the new order has it.
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, PanResponder, ScrollView, type ScrollViewInstance, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'

export interface RowHandle {
  /** For the row's `onLongPress`: picks it up. Does nothing while the list is not sortable. */
  lift: () => void
  /** For the row's `onPressOut`: puts down a row that was picked up and let go without being moved. */
  release: () => void
}

interface Props<T extends { id: string }> {
  items: T[]
  rowHeight: number
  sortable: boolean
  /** A row was put down at the place `to` of the list. */
  onMove: (id: string, to: number) => void
  renderRow: (item: T, row: RowHandle) => ReactNode
  /** How a row looks while it is carried, over its lifted shadow. */
  liftedStyle?: StyleProp<ViewStyle>
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode
  footer?: ReactNode
  contentContainerStyle?: StyleProp<ViewStyle>
}

/** The row being carried. */
interface Drag {
  id: string
  from: number
  /** The place it would be put down at. */
  to: number
  /** How far the finger has gone since it took the row. */
  dy: number
  /** Where the list was scrolled to when the row was picked up. */
  scrolled: number
  /** Where the finger is on the screen, once it has moved. */
  y: number | null
  /** The finger's moves come here now, rather than to the row. */
  held: boolean
}

/** How near the top or bottom of the list a carried row makes it scroll, and how far each frame. */
const EDGE = 64
const SPEED = 9

export function SortableList<T extends { id: string }>({ items, rowHeight, sortable, onMove, renderRow, liftedStyle, empty, footer, contentContainerStyle }: Props<T>) {
  const scroll = useRef<ScrollViewInstance>(null)
  /** How far down each row is drawn, and the place each is at or on its way to. */
  const tops = useRef(new Map<string, Animated.Value>()).current
  const slots = useRef(new Map<string, number>()).current
  const drag = useRef<Drag | null>(null)
  const frame = useRef(0)
  /** The list on the screen: where it starts, how tall it is, how tall what it holds is, how far it is scrolled. */
  const view = useRef({ top: 0, height: 0, content: 0, scrollY: 0 }).current
  const [lifted, setLifted] = useState<string | null>(null)
  // What is made once reads what is current from here.
  const now = useRef({ items, sortable, onMove })
  now.current = { items, sortable, onMove }

  const topOf = (id: string, place: number) => {
    let top = tops.get(id)
    if (!top) {
      top = new Animated.Value(place * rowHeight)
      tops.set(id, top)
      slots.set(id, place)
    }
    return top
  }
  const settle = (id: string, place: number, done?: () => void) => {
    slots.set(id, place)
    const top = tops.get(id)
    if (top) Animated.timing(top, { toValue: place * rowHeight, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(done)
    else done?.()
  }
  /** Sends a row to a place, unless it is there or on its way. */
  const slide = (id: string, place: number) => slots.get(id) !== place && settle(id, place)

  /** Puts the carried row where the finger has it, and has the others make room. */
  const follow = () => {
    const d = drag.current
    if (!d) return
    const last = now.current.items.length - 1
    const top = Math.max(0, Math.min(last * rowHeight, d.from * rowHeight + d.dy + view.scrollY - d.scrolled))
    tops.get(d.id)?.setValue(top)
    const to = Math.round(top / rowHeight)
    if (to === d.to) return
    d.to = to
    void Haptics.selectionAsync()
    let place = 0
    for (const item of now.current.items) {
      if (item.id === d.id) continue
      if (place === to) place++
      slide(item.id, place++)
    }
  }

  /** Scrolls the list while the row is carried at its top or bottom edge. */
  const edge = () => {
    const d = drag.current
    if (!d) return
    if (d.y !== null && view.height) {
      const step = d.y < view.top + EDGE ? -SPEED : d.y > view.top + view.height - EDGE ? SPEED : 0
      const y = Math.max(0, Math.min(view.content - view.height, view.scrollY + step))
      if (step && y !== view.scrollY) {
        view.scrollY = y
        scroll.current?.scrollTo({ y, animated: false })
        follow()
      }
    }
    frame.current = requestAnimationFrame(edge)
  }

  const lift = (id: string) => {
    const from = now.current.items.findIndex((item) => item.id === id)
    if (!now.current.sortable || now.current.items.length < 2 || from < 0 || drag.current) return
    drag.current = { id, from, to: from, dy: 0, scrolled: view.scrollY, y: null, held: false }
    scroll.current?.measureInWindow((_x, y, _width, height) => ((view.top = y), (view.height = height)))
    setLifted(id)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    frame.current = requestAnimationFrame(edge)
  }

  const drop = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    cancelAnimationFrame(frame.current)
    settle(d.id, d.to, () => setLifted((id) => (id === d.id && !drag.current ? null : id)))
    if (d.to !== d.from) now.current.onMove(d.id, d.to)
  }

  // Asked after the event is over: when the finger's moves were taken over here, the row is told
  // it was let go, and it was not.
  const release = (id: string) => setTimeout(() => drag.current?.id === id && !drag.current.held && drop(), 0)

  // Once a row is picked up, the finger's moves come here instead of scrolling the list.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: () => !!drag.current,
        onPanResponderGrant: () => void (drag.current && (drag.current.held = true)),
        onPanResponderMove: (e, gesture) => {
          const d = drag.current
          if (!d) return
          d.dy = gesture.dy
          d.y = e.nativeEvent.pageY
          follow()
        },
        onPanResponderRelease: () => drop(),
        onPanResponderTerminate: () => drop(),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  )

  // The order changed: every row slides to its place. One that was being carried is put down
  // where the new order has it.
  const order = items.map((item) => item.id).join('\n')
  useLayoutEffect(() => {
    const ids = new Set(items.map((item) => item.id))
    for (const id of [...tops.keys()]) if (!ids.has(id)) (tops.delete(id), slots.delete(id))
    const carried = drag.current?.id
    if (carried) {
      drag.current = null
      cancelAnimationFrame(frame.current)
      setLifted(null)
    }
    items.forEach((item, place) => (item.id === carried ? settle(item.id, place) : slide(item.id, place)))
  }, [order])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={!lifted}
      scrollEventThrottle={16}
      contentContainerStyle={contentContainerStyle}
      // While a row is carried the list is scrolled from here, which already knows where to.
      onScroll={(e) => void (drag.current || (view.scrollY = e.nativeEvent.contentOffset.y))}
      onLayout={(e) => void (view.height = e.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => void (view.content = height)}
    >
      {items.length ? (
        <View style={{ height: items.length * rowHeight }} {...pan.panHandlers}>
          {items.map((item, place) => (
            <Animated.View key={item.id} style={[styles.row, { height: rowHeight, transform: [{ translateY: topOf(item.id, place) }] }, lifted === item.id && [styles.lifted, liftedStyle]]}>
              {renderRow(item, { lift: () => lift(item.id), release: () => release(item.id) })}
            </Animated.View>
          ))}
        </View>
      ) : (
        empty
      )}
      {footer}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, top: 0 },
  lifted: { zIndex: 2, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
})
