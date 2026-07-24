import type { MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownBlockProps {
  content: string
  onOpenLink?: (url: string) => void
}

export function MarkdownBlock({ content, onOpenLink }: MarkdownBlockProps) {
  return (
    <div className="message-markdown-block">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(onOpenLink)}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function buildComponents(onOpenLink?: (url: string) => void): Components {
  return {
    a: ({ href, children }) => {
      const url = href || ''
      const handleClick = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenLink?.(url)
      }
      return (
        <a
          className="message-markdown-link"
          href={onOpenLink ? undefined : url}
          onClick={onOpenLink ? handleClick : undefined}
          title={url}
        >
          {children}
        </a>
      )
    },
    table: ({ children }) => (
      <div className="message-markdown-table-wrap">
        <table>{children}</table>
      </div>
    ),
    p: ({ children }) => <p className="message-markdown-p">{children}</p>,
    ul: ({ children }) => <ul className="message-markdown-ul">{children}</ul>,
    ol: ({ children }) => <ol className="message-markdown-ol">{children}</ol>,
    li: ({ children }) => <li className="message-markdown-li">{children}</li>,
    code: ({ className, children, ...props }) => {
      const isBlock = /language-/.test(className || '')
      return isBlock ? (
        <pre className="message-markdown-codeblock">
          <code {...props}>{children}</code>
        </pre>
      ) : (
        <code className="message-markdown-code">{children}</code>
      )
    },
    blockquote: ({ children }) => (
      <blockquote className="message-markdown-blockquote">{children}</blockquote>
    ),
    h1: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
    h2: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
    h3: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
    h4: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
    h5: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
    h6: ({ children }) => <h6 className="message-markdown-h">{children}</h6>,
  }
}
