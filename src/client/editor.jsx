/**
 * The markdown source editor (CodeMirror 6).
 *
 * Built on `@lezer/markdown` configured with GFM rather than
 * `@codemirror/lang-markdown`: that package statically pulls in the HTML, CSS
 * and JavaScript languages for embedded code blocks, which triples the bundle
 * for a feature a preview panel does not need.
 *
 * The view is created once and the document is pushed in as an effect, so a
 * change arriving from disk (the agent rewrote the file while it was open) can
 * replace the text without tearing down the editor or losing undo history.
 */
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, LRLanguage, syntaxHighlighting } from '@codemirror/language'
import { GFM, parser } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

/** Markdown language support with GFM tables and strikethrough. */
const markdownLanguage = LRLanguage.define({ parser: parser.configure([GFM]) })

/** Source colours, taken from the shell's tokens so both presentations work. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.35em', fontWeight: '600' },
  { tag: [tags.heading2, tags.heading3], fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--dsw-alias-label-tertiary)' },
  { tag: tags.monospace, color: 'var(--dsw-alias-label-secondary)' },
  { tag: tags.quote, color: 'var(--dsw-alias-label-tertiary)' },
  { tag: tags.list, color: 'var(--dsw-alias-label-secondary)' },
  { tag: tags.contentSeparator, color: 'var(--dsw-alias-label-tertiary)' },
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { padding: '14px 18px', caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary)' },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.1))' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--dsw-alias-fill-l3, rgba(127,127,127,.24))',
  },
})

/**
 * @param props.value - the document text.
 * @param props.onChange - called with the new text on every edit.
 * @param props.onSave - called on Mod-s.
 */
export function MarkdownEditor({ value, onChange, onSave }) {
  const host = useRef(null)
  const view = useRef(null)
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        markdownLanguage,
        syntaxHighlighting(highlightStyle),
        editorTheme,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { handlers.current.onSave(); return true } },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
        }),
      ],
    })
    const instance = new EditorView({ state, parent: host.current })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // Mount once: later `value` changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Adopt text that changed underneath the editor without discarding history.
  useEffect(() => {
    const instance = view.current
    if (instance === null) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div className="mdp-editor" ref={host} />
}
