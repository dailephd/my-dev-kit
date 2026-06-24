import { useState, useEffect } from 'react'

export interface WorkspaceEditorShellProps {
  initialContent: string
  onSave: (content: string) => void
  onDiscard: () => void
}

type ToolbarProps = {
  isDirty: boolean
  onSave: () => void
  onDiscard: () => void
}

const Toolbar = ({ isDirty, onSave, onDiscard }: ToolbarProps) => (
  <div data-testid="workspace-toolbar" aria-label="editor toolbar">
    <button
      type="button"
      data-testid="save-button"
      onClick={onSave}
      disabled={!isDirty}
    >
      Save
    </button>
    <button
      type="button"
      data-testid="discard-button"
      onClick={onDiscard}
    >
      Discard
    </button>
  </div>
)

type EmptyStateProps = {
  onAdd: () => void
}

const EmptyState = ({ onAdd }: EmptyStateProps) => (
  <div
    data-testid="workspace-editor-empty-state"
    aria-label="empty workspace"
  >
    <p>No structured-content blocks yet.</p>
    <button type="button" onClick={onAdd}>
      Add block
    </button>
  </div>
)

export function WorkspaceEditorShell({
  initialContent,
  onSave,
  onDiscard,
}: WorkspaceEditorShellProps) {
  const [content, setContent] = useState(initialContent)
  const [isDirty, setIsDirty] = useState(false)
  const [isEmpty, setIsEmpty] = useState(initialContent.length === 0)

  useEffect(() => {
    const draft = localStorage.getItem('workspace-editor-draft.v1')
    if (draft !== null) setContent(draft)
  }, [])

  useEffect(() => {
    setIsEmpty(content.length === 0)
    localStorage.setItem('workspace-editor-draft.v1', content)
  }, [content])

  const handleChange = (value: string) => {
    setContent(value)
    setIsDirty(value !== initialContent)
  }

  const handleSave = () => {
    onSave(content)
    setIsDirty(false)
  }

  const handleDiscard = () => {
    setContent(initialContent)
    setIsDirty(false)
    onDiscard()
  }

  const handleAddBlock = () => {
    handleChange(content + '\n' + 'structured-content')
  }

  return (
    <div data-testid="workspace-editor-shell" aria-label="workspace editor">
      <a href="/workspaces/new" data-testid="new-workspace-link">
        New workspace
      </a>
      <p data-testid="workspace-editor-empty-state" aria-label="workspace empty state">
        Workspace status
      </p>
      <Toolbar isDirty={isDirty} onSave={handleSave} onDiscard={handleDiscard} />
      {isEmpty ? (
        <EmptyState onAdd={handleAddBlock} />
      ) : (
        <textarea
          data-testid="workspace-editor-input"
          aria-label="workspace content"
          value={content}
          onChange={(e) => handleChange(e.target.value)}
        />
      )}
    </div>
  )
}
