import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { useEffect, useRef } from 'react'
import type { Chapter } from '@shared/types'

interface EditorProps {
  chapter: Chapter | null
  onSave: (content: string) => void
  saving: boolean
  lastSavedAt: number | null
}

export function Editor({ chapter, onSave, saving, lastSavedAt }: EditorProps): JSX.Element {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastContentRef = useRef<string>('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Placeholder.configure({
        placeholder: '开始写作…'
      }),
      CharacterCount
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose-editor',
        spellcheck: 'false'
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      lastContentRef.current = html
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSave(html)
      }, 2000)
    }
  })

  useEffect(() => {
    if (!editor) return
    if (chapter) {
      const content = chapter.content || '<p></p>'
      lastContentRef.current = content
      editor.commands.setContent(content, { emitUpdate: false })
    } else {
      editor.commands.clearContent()
    }
  }, [chapter?.id, editor])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        if (lastContentRef.current) onSave(lastContentRef.current)
      }
    }
  }, [])

  const wordCount = editor?.storage.characterCount?.characters() ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-6 text-xs text-ink-faint">
        <span>{chapter ? chapter.title : '未选择章节'}</span>
        <span>
          {saving ? '保存中…' : lastSavedAt ? `已保存 ${formatTime(lastSavedAt)}` : ''}
          <span className="ml-4">{wordCount} 字</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {chapter ? (
          <div className="mx-auto max-w-3xl px-8 py-10">
            <EditorContent editor={editor} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            从左侧选择或创建一个章节开始写作
          </div>
        )}
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}
