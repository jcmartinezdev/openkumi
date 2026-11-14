// A picture on its own, full screen, to be pinched and moved around: one sent in a conversation
// (`threadId` and `id`), or one at a server path of its own, such as a file of a bot's workspace (`path`).
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { keptAt } from '@openkumi/client/attachments'
import { useServerFile } from '@openkumi/client/store'
import { Glyph } from '../src/icons'

export default function Picture() {
  const { threadId, id, path, name } = useLocalSearchParams<{ threadId?: string; id?: string; path?: string; name: string }>()
  const source = useServerFile(path ?? keptAt(threadId ?? '', id ?? ''))
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={styles.viewer}>
      <ScrollView maximumZoomScale={5} minimumZoomScale={1} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        {source && <Image source={source} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={name} />}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()} style={[styles.close, { top: insets.top + 8 }]}>
        <Glyph name="x" size={16} color="#fff" weight={2.4} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000' },
  close: { position: 'absolute', right: 16, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
})
