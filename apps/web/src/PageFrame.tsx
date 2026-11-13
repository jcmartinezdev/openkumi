// A page a bot showed (show_page), drawn in the conversation. It runs in a frame that is a site of
// its own (see apps/desktop/src/protocol.ts), so its scripts cannot reach the app; all it can do is
// say how tall it is and which link was clicked. It takes the app's colours, and follows them.
import { useEffect, useRef, useState } from 'react'
import { PAGE_MAX_HEIGHT, pageDocument, pageHeight, readPageMessage, themeMessage } from '@openkumi/client/page'
import { desktop } from './desktop'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { appearance, useAppearance } from './prefs'

/** The address of a page, once the app behind the window has it. The same page gets the same address. */
function usePageAddress(html: string): string | null {
  const [address, setAddress] = useState<{ html: string; url: string } | null>(null)
  useEffect(() => {
    let current = true
    desktop.showPage(pageDocument(html)).then((url) => current && setAddress({ html, url }), () => {})
    return () => void (current = false)
  }, [html])
  return address?.html === html ? address.url : null
}

function Frame({ html, title, fit, onHeight }: { html: string; title: string; fit: boolean; onHeight?: (height: number) => void }) {
  const url = usePageAddress(html)
  const frame = useRef<HTMLIFrameElement>(null)
  const theme = useAppearance()
  // The colours it starts with are in its address; later changes are sent to it, so it is not loaded again.
  const [first] = useState(theme)
  useEffect(() => frame.current?.contentWindow?.postMessage(themeMessage(theme), '*'), [theme])

  const latest = useRef(onHeight)
  latest.current = onHeight
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const message = readPageMessage(e.data)
      if (message?.kind === 'size') latest.current?.(message.height)
      // The app opens links in the computer's browser, when someone has just clicked in the page:
      // a page cannot open things by itself.
      else if (message?.kind === 'open' && document.activeElement === frame.current && navigator.userActivation?.isActive) window.open(message.url)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [])

  if (!url) return null
  return (
    <iframe
      ref={frame}
      src={`${url}#theme=${first}`}
      title={title}
      // Scripts, and nothing else: no access to the app, no forms, no taking over the window.
      sandbox="allow-scripts"
      scrolling={fit ? 'no' : undefined}
      onLoad={() => frame.current?.contentWindow?.postMessage(themeMessage(appearance()), '*')}
    />
  )
}

export function PageFrame({ title, html, height }: { title: string; html: string; height: number }) {
  // Until the page says how tall it is, the bot's own guess.
  const [measured, setMeasured] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  const shown = pageHeight(measured ?? height)
  return (
    <figure className="page" aria-label={title}>
      <div className="page-frame" style={{ height: shown }}>
        <Frame html={html} title={title} fit onHeight={setMeasured} />
      </div>
      {measured !== null && measured > PAGE_MAX_HEIGHT && <div className="page-more">The page is taller than shown here. Open it full size to see all of it.</div>}
      <div className="page-actions">
        <button className="icon" title="Open full size" aria-label={`Open ${title} full size`} onClick={() => setFull(true)}>
          <Icon name="expand" size={15} />
        </button>
      </div>
      {full && <PageViewer title={title} html={html} close={() => setFull(false)} />}
    </figure>
  )
}

/** A page at full size, over the app: one in the conversation, or a page a bot saved as a file. */
export function PageViewer({ title, html, close }: { title: string; html: string; close: () => void }) {
  return (
    <Dialog title={title} close={close} full>
      <div className="page-full">
        <Frame html={html} title={title} fit={false} />
      </div>
    </Dialog>
  )
}
