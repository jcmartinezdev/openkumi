// Files in a conversation on the phone: picking them (a photo, the camera, any file), the ones
// waiting in the composer, and the ones that went with the owner's messages, as the conversation
// keeps them whatever the bot did with its own copies. Which files wait, and how they go up, is
// shared with the computer (@openkumi/client/attachments).
import { useState } from 'react'
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import type { Attachment } from '@openkumi/shared'
import { type Pending, type Picked, PICTURE_SIDE, isPicture, keptAt, kindOf, sizeOf } from '@openkumi/client/attachments'
import { request, useServerFile } from '@openkumi/client/store'
import { Glyph } from './icons'
import { useTheme } from './theme'

/** A file on the phone, as bytes to send. */
const bytesOf = async (uri: string) => (await fetch(uri)).blob()

/**
 * A photo as a JPEG no larger than models see. A phone's photos are HEIC, which models do not
 * take, and many times larger than they need.
 */
async function shrink(uri: string): Promise<Blob> {
  const image = await ImageManipulator.manipulate(uri).renderAsync()
  const long = Math.max(image.width, image.height)
  const sized = long > PICTURE_SIDE ? await ImageManipulator.manipulate(image).resize(image.width >= image.height ? { width: PICTURE_SIDE } : { height: PICTURE_SIDE }).renderAsync() : image
  const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })
  return bytesOf(saved.uri)
}

/** A name for a photo the camera took, which has none: "Photo 2026-11-13 at 12.41.07.jpg", as the Mac names screenshots. */
const photoName = () => {
  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `Photo ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} at ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`
}

function photo(uri: string, fileName?: string | null): Picked {
  const name = `${(fileName ?? photoName()).replace(/\.[^.]+$/, '')}.jpg`
  return { name, type: 'image/jpeg', preview: uri, read: async () => ({ body: await shrink(uri), name }) }
}

function document(asset: DocumentPicker.DocumentPickerAsset): Picked {
  const type = asset.mimeType ?? 'application/octet-stream'
  // A picture from Files is made smaller like one from Photos.
  if (type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml') return photo(asset.uri, asset.name)
  return { name: asset.name, type, read: async () => ({ body: await bytesOf(asset.uri), name: asset.name }) }
}

/** Asks where the files should come from (Photos, the camera or Files), and hands over the ones picked. */
export function chooseFiles(room: number, add: (picked: Picked[]) => void) {
  if (room <= 0) return Alert.alert('That is as many as can go', 'One message can take ten files. Send these first, or take some out.')
  ActionSheetIOS.showActionSheetWithOptions({ options: ['Photo Library', 'Take Photo', 'Choose Files', 'Cancel'], cancelButtonIndex: 3 }, async (choice) => {
    try {
      if (choice === 0) {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 })
        if (!result.canceled) add(result.assets.map((a) => photo(a.uri, a.fileName)))
      } else if (choice === 1) {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync()
        if (!granted) {
          return Alert.alert('OpenKumi cannot use the camera', 'You can let it in the iPhone’s Settings.', [{ text: 'Not now', style: 'cancel' }, { text: 'Settings', onPress: () => void Linking.openSettings() }])
        }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        if (!result.canceled) add(result.assets.map((a) => photo(a.uri)))
      } else if (choice === 2) {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
        if (!result.canceled) add(result.assets.slice(0, room).map(document))
      }
    } catch (e) {
      Alert.alert('The file could not be added', (e as Error).message)
    }
  })
}

/** What waits in the composer to go with the message, with a way to take each out. */
export function Tray({ files, remove }: { files: Pending[]; remove: (id: string) => void }) {
  const theme = useTheme()
  if (!files.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.tray}>
      {files.map((f) => (
        <View key={f.id} style={[styles.item, { borderColor: f.error ? theme.err : theme.border, backgroundColor: theme.bubble }]}>
          {f.preview ? (
            <Image source={{ uri: f.preview }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={styles.doc}>
              <Text style={{ color: theme.text, fontSize: 11.5, lineHeight: 14 }} numberOfLines={2}>{f.name}</Text>
              <Text style={{ color: f.error ? theme.err : theme.faint, fontSize: 10.5 }} numberOfLines={1}>{f.error ? 'Not sent' : kindOf(f.name, f.type)}</Text>
            </View>
          )}
          {!f.staged && !f.error && <View style={styles.wait}><ActivityIndicator color="#fff" /></View>}
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} hitSlop={10} style={styles.x} onPress={() => remove(f.id)}>
            <Glyph name="x" size={10} color="#fff" weight={2.6} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}

/** Files that are text, which the phone can show as they are. */
const isText = (type: string) => type.startsWith('text/') || type === 'application/json'

/**
 * The files that went with one of the owner's messages: pictures as pictures, anything else as a
 * card. A text file opens with `show`; others are for the computer.
 */
export function SentFiles({ threadId, files, show }: { threadId: string; files: Attachment[]; show: (name: string, text: string) => void }) {
  const theme = useTheme()
  const router = useRouter()
  const open = (f: Attachment) => {
    if (!isText(f.type)) return Alert.alert(f.name, 'This kind of file cannot be shown on the phone. On the computer, a copy can be saved from the conversation.')
    request('GET', keptAt(threadId, f.id)).then((res) => res.text()).then((text) => show(f.name, text), (e) => Alert.alert(f.name, (e as Error).message))
  }
  return (
    <View style={styles.sent}>
      {files.map((f) =>
        isPicture(f.type) ? (
          <SentPicture key={f.id} threadId={threadId} file={f} view={() => router.push({ pathname: '/picture', params: { threadId, id: f.id, name: f.name } })} />
        ) : (
          <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`Open ${f.name}`} onPress={() => open(f)} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.raised }]}>
            <Text style={{ color: theme.text, fontSize: 14 }} numberOfLines={1}>{f.name}</Text>
            <Text style={{ color: theme.faint, fontSize: 12 }}>{kindOf(f.name, f.type)} · {sizeOf(f.size)}</Text>
          </Pressable>
        ),
      )}
    </View>
  )
}

/** Pictures are shown at one height, as wide as they are, up to a point. */
const HEIGHT = 150

function SentPicture({ threadId, file, view }: { threadId: string; file: Attachment; view: () => void }) {
  const theme = useTheme()
  const source = useServerFile(keptAt(threadId, file.id))
  const [shape, setShape] = useState(1)
  const [gone, setGone] = useState(false)
  if (gone) {
    return (
      <View style={[styles.card, { borderColor: theme.border, opacity: 0.6 }]}>
        <Text style={{ color: theme.text, fontSize: 14 }} numberOfLines={1}>{file.name}</Text>
        <Text style={{ color: theme.faint, fontSize: 12 }}>Could not be loaded</Text>
      </View>
    )
  }
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open ${file.name}`} onPress={view} style={[styles.picture, { borderColor: theme.border, backgroundColor: theme.bubble }]}>
      {source && (
        <Image
          source={source}
          style={{ height: HEIGHT, width: Math.min(240, Math.max(90, HEIGHT * shape)) }}
          resizeMode="cover"
          onLoad={(e) => e.nativeEvent.source.height && setShape(e.nativeEvent.source.width / e.nativeEvent.source.height)}
          onError={() => setGone(true)}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tray: { gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  item: { width: 60, height: 60, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  doc: { flex: 1, padding: 6, justifyContent: 'space-between' },
  wait: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  x: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  sent: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginTop: 6 },
  picture: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', minWidth: 90, minHeight: HEIGHT },
  card: { maxWidth: 240, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
})
