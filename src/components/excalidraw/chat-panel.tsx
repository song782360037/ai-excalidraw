import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { 
  Send, 
  Loader2, 
  Plus, 
  Trash2, 
  MessageSquare, 
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckSquare,
  Brain,
  ChevronDown,
  ChevronUp,
  Wrench,
  Check,
  X,
  Eye,
  Pencil,
  Move,
  LayoutGrid
} from 'lucide-react'
import { useChatHistory, type ChatMessage } from './use-chat-history'
import { parseExcalidrawElements, type ParsedElement } from './element-parser'
import { streamChat, isConfigValid, getAIConfig, type ToolExecutor } from '@/lib/ai'
import type { ExcalidrawWrapperRef } from './wrapper'

interface ChatPanelProps {
  className?: string
  onElementsGenerated?: (elements: ParsedElement[]) => void
  excalidrawRef?: React.RefObject<ExcalidrawWrapperRef | null>
}

export function ChatPanel({ className, onElementsGenerated, excalidrawRef }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isComposing, setIsComposing] = useState(false) // 输入法组合状态
  const [selectedCount, setSelectedCount] = useState(0) // 选中的元素数量
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]) // 选中元素的ID列表
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const {
    sessions,
    currentSession,
    currentSessionId,
    isLoaded,
    createSession,
    addMessage,
    updateMessage,
    deleteSession,
    switchSession,
  } = useChatHistory()

  // 滚动到底部（只在消息容器内滚动，不影响页面）
  const scrollToBottom = useCallback(() => {
    const container = messagesEndRef.current?.parentElement
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [currentSession?.messages, scrollToBottom])

  // 更新选中元素状态（统一使用 getSelectedElementsSummary，包含绑定元素）
  const updateSelectedElements = useCallback(() => {
    if (!excalidrawRef?.current) return
    try {
      const selectedElements = excalidrawRef.current.getSelectedElementsSummary()
      setSelectedCount(selectedElements.length)
      setSelectedElementIds(selectedElements.map(el => el.id))
    } catch (error) {
      console.error('Error updating selected elements:', error)
    }
  }, [excalidrawRef])

  // 初始化时检查一次，并定时更新选中状态
  useEffect(() => {
    updateSelectedElements()

    // 定时更新选中状态（每秒检查一次）
    const interval = setInterval(updateSelectedElements, 1000)

    return () => clearInterval(interval)
  }, [updateSelectedElements])

  // 在会话加载完成且有当前会话时，同步画布
  useEffect(() => {
    if (!isLoaded || !currentSessionId) return

    // 同步画布的函数
    const syncCanvas = () => {
      // 检查 excalidraw API 是否已准备好
      if (!excalidrawRef?.current?.isReady()) return false
      
      const canvasSessionId = excalidrawRef.current.getCurrentSessionId()
      if (canvasSessionId !== currentSessionId) {
        excalidrawRef.current.switchToSession(currentSessionId, currentSession?.useIndependentCanvas ?? false)
      }
      return true
    }

    // 如果 excalidrawRef 已准备好，直接同步
    if (syncCanvas()) return

    // 否则等待 excalidraw API 准备好后重试
    const interval = setInterval(() => {
      if (syncCanvas()) {
        clearInterval(interval)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [isLoaded, currentSessionId, currentSession?.useIndependentCanvas, excalidrawRef])

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    // 检查配置
    if (!isConfigValid(getAIConfig())) {
      alert('请先点击右上角设置按钮配置 AI API')
      return
    }

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    // 确保有会话
    let sessionId = currentSessionId
    if (!sessionId) {
      sessionId = createSession()
    }

    // 添加用户消息
    addMessage(sessionId, 'user', userMessage)

    // 添加空的助手消息占位
    const assistantMessageId = addMessage(sessionId, 'assistant', '')

    let fullText = ''
    let processedLength = 0

    // 获取选中的元素（如果有）
    const selectedElements = excalidrawRef?.current?.getSelectedElementsSummary() || []

    // 创建工具执行器
    const toolExecutor: ToolExecutor = {
      getCanvasElements: () => excalidrawRef?.current?.getCanvasState() || [],
      getElementsByIds: (ids: string[]) => excalidrawRef?.current?.getElementsByIds(ids) || { elements: [], notFound: ids },
      deleteElements: (ids: string[]) => excalidrawRef?.current?.deleteElements(ids) || { deleted: [], notFound: ids },
      updateElements: (updates) => excalidrawRef?.current?.updateElements(updates) || { updated: [], notFound: updates.map(u => u.id) },
      moveElements: (ids: string[], dx: number, dy: number) => excalidrawRef?.current?.moveElements(ids, dx, dy) || { moved: [], notFound: ids },
      checkAndFixLayout: (minGap?: number) => excalidrawRef?.current?.checkAndFixLayout(minGap) || { hasIssues: false, issues: [], fixedCount: 0, message: 'API 未准备好' }
    }

    // 获取历史消息（不包含当前这条，因为刚刚添加的用户消息和空的助手消息）
    const historyMessages = (currentSession?.messages || []).slice(0, -2)

    await streamChat(
      userMessage,
      (chunk) => {
        fullText += chunk
        updateMessage(sessionId!, assistantMessageId, fullText)

        // 解析元素并渲染
        const { elements, remainingBuffer } = parseExcalidrawElements(fullText, processedLength)
        if (elements.length > 0) {
          onElementsGenerated?.(elements)
          processedLength = fullText.length - remainingBuffer.length
        }
      },
      (error) => {
        console.error('Chat error:', error)
        updateMessage(sessionId!, assistantMessageId, `抱歉，发生了错误：${error.message}`)
      },
      undefined,
      selectedElements, // 传递选中的元素
      toolExecutor, // 传递工具执行器
      historyMessages // 传递历史消息
    )

    // 最终解析
    const { elements } = parseExcalidrawElements(fullText, processedLength)
    if (elements.length > 0) {
      onElementsGenerated?.(elements)
    }

    // 自动布局检查和修复（迭代执行，最多3次）
    if (excalidrawRef?.current) {
      let iteration = 0
      const maxIterations = 3
      while (iteration < maxIterations) {
        const result = excalidrawRef.current.checkAndFixLayout(40)
        if (!result.hasIssues || result.fixedCount === 0) break
        iteration++
      }
    }

    setIsLoading(false)
  }

  // 处理按键（输入法激活时不发送）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // 新建对话
  const handleNewChat = () => {
    const newSessionId = createSession()
    // 切换到新会话的独立画布（新会话 useIndependentCanvas 为 true）
    excalidrawRef?.current?.switchToSession(newSessionId, true)
    setIsSidebarOpen(false)
  }

  if (!isLoaded) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* 侧边栏 - 会话列表 */}
      <div className={cn(
        'absolute md:relative z-10 h-full bg-card border-r border-border transition-all duration-300',
        isSidebarOpen ? 'w-64' : 'w-0 md:w-0'
      )}>
        {isSidebarOpen && (
          <div className="flex flex-col h-full p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="w-full mb-3 gap-2"
            >
              <Plus className="w-4 h-4" />
              新对话
            </Button>
            
            <div className="flex-1 overflow-y-auto space-y-1">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                    session.id === currentSessionId
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-secondary/50'
                  )}
                  onClick={() => {
                    switchSession(session.id)
                    // 切换会话时同步切换画布（传递该会话是否使用独立画布）
                    excalidrawRef?.current?.switchToSession(session.id, session.useIndependentCanvas ?? false)
                    setIsSidebarOpen(false)
                  }}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate text-sm">{session.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(session.id)
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* 顶部栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-secondary/5">
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>AI 绘图助手</span>
          </div>

          {/* 顶部栏右侧 */}
          {excalidrawRef && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1.5 text-xs"
              onClick={handleNewChat}
            >
              <Plus className="w-3.5 h-3.5" />
              新对话
            </Button>
          )}
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {(!currentSession || currentSession.messages.length === 0) && (
            <div className="flex flex-col items-center justify-center h-full text-center text-foreground/50">
              <Sparkles className="w-12 h-12 mb-4 text-primary/30" />
              <p className="text-lg font-medium mb-2">AI 绘图助手</p>
              <p className="text-sm max-w-xs">
                描述你想要绘制的图形，AI 会自动生成并渲染到画布上
              </p>
              <div className="mt-6 space-y-2 text-xs text-foreground/40">
                <p>💡 试试这些：</p>
                <p>「画一个简单的流程图：开始→处理→结束」</p>
                <p>「画一个前后端架构图」</p>
                <p>「用矩形和箭头画一个组织架构」</p>
              </div>
            </div>
          )}
          
          {currentSession?.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          
          {isLoading && (
            <div className="flex items-center gap-2 text-foreground/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">AI 正在思考...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* 选中元素提示 */}
        {selectedCount > 0 && (
          <div className="px-3 py-2 bg-primary/10 border-b border-border">
            <div className="flex items-center gap-2 text-xs">
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium text-primary">
                已选中 {selectedCount} 个元素将发送给 AI
              </span>
            </div>
            {selectedElementIds.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {selectedElementIds.slice(0, 10).map((id) => (
                  <span
                    key={id}
                    className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] font-mono text-foreground/70"
                  >
                    {id.slice(0, 8)}
                  </span>
                ))}
                {selectedElementIds.length > 10 && (
                  <span className="px-1.5 py-0.5 text-[10px] text-foreground/50">
                    ...等 {selectedElementIds.length} 个
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 输入区 */}
        <div className="p-3 border-t border-border bg-card">
          <Card className="flex items-end gap-2 p-2 bg-secondary/5 border-border/50">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder="描述你想要绘制的图形..."
              className="min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 p-2"
              disabled={isLoading}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="shrink-0 w-9 h-9"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * 消息气泡组件
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-secondary/50 text-foreground rounded-bl-md'
        )}
      >
        <div className="whitespace-pre-wrap break-words">
          {isUser ? (
            message.content
          ) : (
            <AssistantMessage content={message.content} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 移除文本中的 JSON 对象（支持嵌套）
 */
function removeJsonObjects(text: string): string {
  let result = ''
  let i = 0
  
  while (i < text.length) {
    if (text[i] === '{') {
      // 尝试跳过完整的 JSON 对象
      let depth = 0
      let inString = false
      let escape = false
      let j = i
      
      for (; j < text.length; j++) {
        const char = text[j]
        
        if (escape) {
          escape = false
          continue
        }
        if (char === '\\' && inString) {
          escape = true
          continue
        }
        if (char === '"') {
          inString = !inString
          continue
        }
        if (inString) continue
        
        if (char === '{') depth++
        else if (char === '}') {
          depth--
          if (depth === 0) {
            // 检查是否是 Excalidraw 元素
            const jsonStr = text.slice(i, j + 1)
            if (/"type"\s*:\s*"(rectangle|ellipse|diamond|text|arrow|line)"/.test(jsonStr)) {
              // 跳过这个 JSON
              i = j + 1
              break
            } else {
              // 保留非元素 JSON
              result += text[i]
              i++
              break
            }
          }
        }
      }
      
      // JSON 未完成，保留当前字符
      if (depth !== 0) {
        result += text[i]
        i++
      }
    } else {
      result += text[i]
      i++
    }
  }
  
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 从内容中提取思考内容和正文
 */
function parseThinkingContent(content: string): { thinking: string; main: string } {
  let thinking = ''
  let main = content
  
  // 匹配所有 <think>...</think> 标签
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  let match
  while ((match = thinkRegex.exec(content)) !== null) {
    thinking += match[1]
  }
  
  // 移除 thinking 标签
  main = content.replace(/<think>[\s\S]*?<\/think>/g, '')
  
  return { thinking: thinking.trim(), main }
}

/**
 * 工具调用信息类型
 */
interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result: {
    success?: boolean
    message?: string
    error?: string
    [key: string]: unknown
  }
}

/**
 * 从内容中提取工具调用信息
 */
function parseToolCalls(content: string): { toolCalls: ToolCallInfo[]; cleanContent: string } {
  const toolCalls: ToolCallInfo[] = []
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g
  let match
  
  while ((match = toolCallRegex.exec(content)) !== null) {
    try {
      const info = JSON.parse(match[1]) as ToolCallInfo
      toolCalls.push(info)
    } catch {
      // 解析失败，跳过
    }
  }
  
  const cleanContent = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
  return { toolCalls, cleanContent }
}

/**
 * 获取工具的中文名称和图标
 */
function getToolMeta(name: string): { label: string; icon: React.ReactNode; color: string } {
  switch (name) {
    case 'get_canvas_elements':
      return { label: '获取画布', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-blue-500' }
    case 'get_elements_by_ids':
      return { label: '查询元素', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-blue-500' }
    case 'update_elements':
      return { label: '更新元素', icon: <Pencil className="w-3.5 h-3.5" />, color: 'text-green-500' }
    case 'move_elements':
      return { label: '移动元素', icon: <Move className="w-3.5 h-3.5" />, color: 'text-green-500' }
    case 'delete_elements':
      return { label: '删除元素', icon: <Trash2 className="w-3.5 h-3.5" />, color: 'text-red-500' }
    case 'check_and_fix_layout':
      return { label: '布局检查', icon: <LayoutGrid className="w-3.5 h-3.5" />, color: 'text-yellow-500' }
    default:
      return { label: name, icon: <Wrench className="w-3.5 h-3.5" />, color: 'text-gray-500' }
  }
}

/**
 * 工具调用卡片组件
 */
function ToolCallBlock({ info }: { info: ToolCallInfo }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { label, icon, color } = getToolMeta(info.name)
  const isSuccess = !info.result.error
  const message = info.result.message || info.result.error || ''
  
  return (
    <div className="my-2 rounded-lg border border-border/50 bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors"
      >
        <span className={cn("flex items-center justify-center", color)}>
          {icon}
        </span>
        <span className="text-xs font-medium flex-1 text-left">{label}</span>
        <span className={cn(
          "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded",
          isSuccess 
            ? "bg-green-500/10 text-green-600" 
            : "bg-red-500/10 text-red-600"
        )}>
          {isSuccess ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          {isSuccess ? '成功' : '失败'}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-foreground/50" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-foreground/50" />
        )}
      </button>
      
      {/* 结果摘要 */}
      {message && (
        <div className="px-3 pb-2 text-xs text-foreground/70">
          {message}
        </div>
      )}
      
      {/* 展开详情 */}
      {isExpanded && (
        <div className="px-3 py-2 border-t border-border/30 bg-secondary/10">
          {Object.keys(info.args).length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-foreground/50 mb-1">参数</div>
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all">
                {JSON.stringify(info.args, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <div className="text-[10px] text-foreground/50 mb-1">结果</div>
            <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {JSON.stringify(info.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 思考内容折叠组件
 */
function ThinkingBlock({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  if (!content) return null
  
  return (
    <div className="mb-2 rounded-lg bg-primary/5 border border-primary/20 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-primary/70 hover:bg-primary/10 transition-colors"
      >
        <Brain className="w-3.5 h-3.5" />
        <span className="font-medium">思考过程</span>
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {isExpanded && (
        <div className="px-3 py-2 text-xs text-foreground/60 border-t border-primary/10 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}

/**
 * 助手消息组件 - 隐藏 JSON 元素，显示思考内容、工具调用和正文，支持 Markdown 渲染
 */
function AssistantMessage({ content }: { content: string }) {
  // 先提取工具调用
  const { toolCalls, cleanContent: contentWithoutTools } = parseToolCalls(content)
  // 再提取思考内容
  const { thinking, main } = parseThinkingContent(contentWithoutTools)
  // 移除 JSON 元素
  const displayContent = removeJsonObjects(main)
  
  // 检查是否正在思考中（有未闭合的 think 标签）
  const isThinking = content.includes('<think>') && !content.includes('</think>')
  
  if (!displayContent && !thinking && toolCalls.length === 0) {
    // 检查原始内容是否包含 JSON 元素
    const hasElements = /"type"\s*:\s*"(rectangle|ellipse|diamond|text|arrow|line)"/.test(content)
    if (hasElements) {
      return <span className="text-foreground/50 italic">✨ 图形已生成到画布</span>
    }
    if (isThinking) {
      return (
        <div className="flex items-center gap-2 text-foreground/50 italic">
          <Brain className="w-4 h-4 animate-pulse" />
          <span>正在思考...</span>
        </div>
      )
    }
    return <span className="text-foreground/50 italic">正在生成...</span>
  }
  
  return (
    <>
      {thinking && <ThinkingBlock content={thinking} />}
      {toolCalls.map((tc, idx) => (
        <ToolCallBlock key={idx} info={tc} />
      ))}
      {displayContent ? (
        <div className="markdown-content prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              // 代码块样式
              code: ({ className, children, ...props }) => {
                const isInline = !className
                return isInline ? (
                  <code className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-xs font-mono" {...props}>
                    {children}
                  </code>
                ) : (
                  <code className={cn("block p-3 rounded-lg bg-secondary/50 text-xs font-mono overflow-x-auto", className)} {...props}>
                    {children}
                  </code>
                )
              },
              // 链接样式
              a: ({ children, ...props }) => (
                <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              ),
              // 列表样式
              ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
              li: ({ children }) => <li className="leading-normal">{children}</li>,
              // 标题样式
              h1: ({ children }) => <h1 className="text-lg font-bold mt-2 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-bold mt-1.5 mb-0.5">{children}</h3>,
              // 段落样式 - 减少间距
              p: ({ children }) => <p className="my-0.5 leading-normal">{children}</p>,
              // 表格样式
              table: ({ children }) => <table className="border-collapse border border-border my-2 text-xs">{children}</table>,
              th: ({ children }) => <th className="border border-border px-2 py-1 bg-secondary/30 font-medium">{children}</th>,
              td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
              // 引用样式
              blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/50 pl-3 my-2 text-foreground/70 italic">{children}</blockquote>,
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      ) : (
        <span className="text-foreground/50 italic">✨ 图形已生成到画布</span>
      )}
    </>
  )
}
